import prisma from '../../config/database';
import systemPrisma from '../../config/system-database';
import { getAgentCatalog } from '../agent-catalog.service';
import { listAgentManifest, getCanonicalAgentId } from '../agent-manifest.service';
import { loadSkillsBookRaw, getActiveSkillIds } from '../skill-registry/skills-file';
import { analyzeW2 } from '../skills-readiness.service';

/**
 * Agent Manifest 一致性诊断（GET /api/admin/manifest/diagnostics 的数据层）。
 * 由 routes/admin/platform.ts 下沉：注册表/模型配置/调用日志/目录/技能注册五向对账。
 */
type OutputContractBucket = 'v1' | 'legacy' | 'mixed' | 'unknown';

const LEGACY_OUTPUT_KEYS = ['goalConversation', 'path', 'progress', 'output'];

const parseOutputPayload = (raw: string | null): any | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const classifyOutputContract = (payload: any): OutputContractBucket => {
  if (!payload || typeof payload !== 'object') {
    return 'unknown';
  }

  const hasLegacy = LEGACY_OUTPUT_KEYS.some((key) => payload[key] !== undefined);
  const hasV1 =
    payload.schemaVersion === 'agent-output-v1' ||
    (typeof payload.userVisible === 'string' && payload.internal && typeof payload.internal === 'object');

  if (hasV1 && hasLegacy) return 'mixed';
  if (hasV1) return 'v1';
  if (hasLegacy) return 'legacy';
  return 'unknown';
};

const summarizeOutputContracts = (rows: Array<{ output: string | null }>) => {
  const summary = {
    sampleSize: rows.length,
    v1: 0,
    legacy: 0,
    mixed: 0,
    unknown: 0
  };

  for (const row of rows) {
    const bucket = classifyOutputContract(parseOutputPayload(row.output));
    summary[bucket] += 1;
  }

  return summary;
};

export async function collectManifestDiagnostics(): Promise<unknown> {
  const manifest = listAgentManifest();
  const canonicalManifestIds = new Set(
    manifest.filter(item => item.kind !== 'alias').map(item => item.id)
  );

  const infrastructureIds = new Set([
    'api-gateway',
    'gateway',
    'system-call',
    'arena-service',
    'ai-service'
  ]);

  const [registrations, modelConfigs, logGroups, catalog, agentCallOutputSamples, skillRegistrations] = await Promise.all([
    systemPrisma.agent_registrations.findMany({
      orderBy: { id: 'asc' },
      select: {
        id: true,
        name: true,
        type: true,
        updatedAt: true
      }
    }),
    systemPrisma.agent_model_configs.findMany({
      orderBy: { agentId: 'asc' },
      select: {
        agentId: true,
        enabled: true,
        updatedAt: true
      }
    }),
    prisma.agent_call_logs.groupBy({
      by: ['agentId'],
      _count: { _all: true }
    }),
    getAgentCatalog(),
    prisma.agent_call_logs.findMany({
      where: { output: { not: null } },
      orderBy: { calledAt: 'desc' },
      take: 500,
      select: { output: true }
    }),
    systemPrisma.skill_registrations.findMany({
      orderBy: { name: 'asc' },
      select: {
        name: true,
        updatedAt: true
      }
    })
  ]);

  const agentCallContractCounts = summarizeOutputContracts(agentCallOutputSamples);

  const registrationIds = registrations.map(item => item.id);
  const modelConfigIds = modelConfigs.map(item => item.agentId);
  const calledAgentIds = logGroups.map(item => item.agentId);
  const catalogIds = Object.keys(catalog || {});

  const missingRegistrations = Array.from(canonicalManifestIds).filter(
    id => !registrationIds.includes(id)
  );

  const unknownRegistrations = registrationIds.filter(id => {
    const canonicalId = getCanonicalAgentId(id);
    return !canonicalManifestIds.has(canonicalId);
  });

  const aliasRegistrations = registrationIds
    .map(id => ({ id, canonicalId: getCanonicalAgentId(id) }))
    .filter(item => item.id !== item.canonicalId && canonicalManifestIds.has(item.canonicalId));

  const unknownModelConfigs = modelConfigIds.filter(id => {
    const canonicalId = getCanonicalAgentId(id);
    return !canonicalManifestIds.has(canonicalId);
  });

  const aliasModelConfigs = modelConfigIds
    .map(id => ({ id, canonicalId: getCanonicalAgentId(id) }))
    .filter(item => item.id !== item.canonicalId && canonicalManifestIds.has(item.canonicalId));

  const unknownLogAgents = calledAgentIds.filter(id => {
    if (infrastructureIds.has(id)) {
      return false;
    }
    const canonicalId = getCanonicalAgentId(id);
    return !canonicalManifestIds.has(canonicalId);
  });

  const aliasLogAgents = logGroups
    .map(item => ({
      id: item.agentId,
      canonicalId: getCanonicalAgentId(item.agentId),
      calls: item._count._all
    }))
    .filter(item => item.id !== item.canonicalId && canonicalManifestIds.has(item.canonicalId));

  const catalogOnly = catalogIds.filter(id => !canonicalManifestIds.has(id));

  // ---- skill_registrations 维度----
  // 数据源：户口簿活跃集 vs skill_registrations（name 无 skill: 前缀）双向差集，
  // 复用 skills-readiness W2 分析纯函数（analyzeW2，同一对账口径，不复制逻辑）。
  const book = loadSkillsBookRaw();
  const bookActiveIds = getActiveSkillIds(book);
  const w2 = analyzeW2(book, skillRegistrations.map((item) => ({ name: item.name })));
  const missingSkillRegistrations = w2.missingRegistration; // 户口簿有、注册表无（agents/platform-direct 豁免）
  const unknownSkillRegistrations = w2.zombieRegistration;  // 注册表有、户口簿无（幽灵残留）

  // 别名行：注册 name（无前缀）经 getCanonicalAgentId 归一判定（对齐 :287-289 模式）
  const aliasSkillRegistrations = skillRegistrations
    .map(item => ({
      name: item.name,
      canonicalId: getCanonicalAgentId(item.name)
    }))
    .filter(item => item.name !== item.canonicalId && canonicalManifestIds.has(item.canonicalId));

  // 逐项明细：户口簿活跃集 ∪ 注册表 并集，每项 status = unregistered | orphan-registration | ok
  const registeredNames = new Set(skillRegistrations.map((item) => item.name));
  const exemptRegistrationPoints = new Set(['agents', 'platform-direct']);
  const skillRegistrationItems = [
    ...missingSkillRegistrations.map(skillId => ({ skillId, status: 'unregistered' as const })),
    ...unknownSkillRegistrations.map(skillId => ({ skillId, status: 'orphan-registration' as const })),
    ...[...bookActiveIds]
      .filter(id => registeredNames.has(id) || exemptRegistrationPoints.has(book.skills.find(e => e.skillId === id)?.registrationPoint || ''))
      .map(skillId => ({
        skillId,
        status: 'ok' as const,
        detail: registeredNames.has(skillId)
          ? 'skill_registrations 有行'
          : 'agents/platform-direct 豁免（不落 skill_registrations 是预期）'
      })),
  ].sort((a, b) => a.skillId.localeCompare(b.skillId));

  return {
    summary: {
      manifestTotal: canonicalManifestIds.size,
      registrationTotal: registrations.length,
      modelConfigTotal: modelConfigs.length,
      calledAgentTotal: calledAgentIds.length,
      catalogTotal: catalogIds.length,
      outputContractSampleSize: agentCallContractCounts.sampleSize,
      skillRegistrationTotal: skillRegistrations.length,
      driftCount:
        missingRegistrations.length +
        unknownRegistrations.length +
        unknownModelConfigs.length +
        unknownLogAgents.length +
        catalogOnly.length +
        missingSkillRegistrations.length +
        unknownSkillRegistrations.length
    },
    outputContracts: {
      agentCallLogs: agentCallContractCounts
    },
    drift: {
      missingRegistrations,
      unknownRegistrations,
      aliasRegistrations,
      unknownModelConfigs,
      aliasModelConfigs,
      unknownLogAgents,
      aliasLogAgents,
      catalogOnly,
      skillRegistrations: {
        missingSkillRegistrations,
        unknownSkillRegistrations,
        aliasSkillRegistrations,
        items: skillRegistrationItems
      }
    },
    samples: {
      registrations,
      modelConfigs,
      calledAgents: logGroups
    }
  };
}
