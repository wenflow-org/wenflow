import prisma from '../config/database';
import systemPrisma from '../config/system-database';
import { Prisma } from '@prisma/client';
import { getAPIGateway } from '../gateway/api-gateway';
import {
  getAgentManifest,
  getAgentOfSkill,
  getCanonicalAgentId,
} from './agent-manifest.service';
import {
  getPlatformReliabilitySettings,
  type PlatformReliabilitySettings,
} from './reliability-settings.service';
import skillModelConfigService from './skillModelConfig.service';

export type SkillStatsRange = '24h' | '7d' | '30d' | 'all';

export interface UnifiedSkillStats {
  skillId: string;
  canonicalId: string;
  callCount: number;
  successCount: number;
  failureCount: number;
  successRate: number | null;
  avgDurationMs: number;
  lastCalledAt: Date | null;
  source: 'prompt_call_logs' | 'agent_call_logs' | 'none';
  range: SkillStatsRange;
}

export interface EffectiveSkillRuntimeConfig {
  skillId: string;
  canonicalId: string;
  route: {
    model: string | null;
    temperature: number | null;
    maxTokens: number | null;
    timeoutMs: number | null;
    thinkingMode: string | null;
    reasoningEffort: string | null;
    source: 'skill-override' | 'agent-or-platform' | 'platform-default' | 'unresolved';
    hasSkillOverride: boolean;
  };
  /** 实际 LLM 请求参数（callPrompt 路径）：模型绑定来自 route；prompt 只贡献 temperature/maxTokens 意图 */
  llmRequest: {
    model: string | null;
    temperature: number | null;
    maxTokens: number | null;
    source: 'active-prompt' | 'route' | 'none';
    /** 历史遗留：ACTIVE prompt 上的 model 副本已废弃（运行时仅作最后兜底）。非 null = 建议清理 */
    deprecatedPromptModel?: string | null;
    activePrompt: {
      id: string;
      version: number;
      model: string | null;
      temperature: number | null;
      maxTokens: number | null;
    } | null;
  };
  override: {
    enabled: boolean;
    model: string | null;
    temperature: number | null;
    maxTokens: number | null;
    maxLogicalRetries: number | null;
    requestTimeoutMs: number | null;
  } | null;
  reliability: {
    maxUpstreamAttempts: number;
    maxTransportRetries: number;
    maxLogicalRetries: number;
    logicalRetrySource: 'platform-default' | 'skill-override';
    platformMaxLogicalRetries: number;
  };
}

function toShortSkillId(skillId: string): string {
  return String(skillId || '').replace(/^skill:/, '').trim();
}

function toCanonicalSkillId(skillId: string): string {
  const raw = String(skillId || '').trim();
  if (!raw) return raw;
  // 避免 bare "goal-conversation" 被别名解析成 goal-agent
  const preferred = raw.startsWith('skill:') ? raw : `skill:${raw}`;
  const canonical = getCanonicalAgentId(preferred);
  if (canonical.startsWith('skill:')) return canonical;
  const short = toShortSkillId(raw);
  return short ? `skill:${short}` : raw;
}

function rangeToSince(range: SkillStatsRange): Date | null {
  if (range === 'all') return null;
  const ms =
    range === '24h' ? 24 * 3600_000
      : range === '30d' ? 30 * 24 * 3600_000
        : 7 * 24 * 3600_000;
  return new Date(Date.now() - ms);
}

/* ===== metadata 兜底嗅探门（性能批 2026-10-04） =====
 * 非前缀行按 metadata.skillId 归属是既定契约，但读取 metadata 大列很贵（本库非前缀行
 * ~5k 条 / 142MB）。先做一次窗口无关的存在性嗅探（instr 快检，含嵌套误报宁可多跑），
 * 结果按 10 分钟 TTL 缓存：无此形态数据 → 常态零成本；有 → 照旧执行原兜底扫描。 */
const METADATA_SKILL_ID_SNIFF_TTL_MS = 10 * 60 * 1000;
let metadataSkillIdSniff: { present: boolean; checkedAt: number } | null = null;

async function hasNonPrefixedMetadataSkillId(): Promise<boolean> {
  if (metadataSkillIdSniff && Date.now() - metadataSkillIdSniff.checkedAt < METADATA_SKILL_ID_SNIFF_TTL_MS) {
    return metadataSkillIdSniff.present;
  }
  const rows = await prisma.$queryRaw<Array<{ one: number }>>`
    SELECT 1 AS "one"
    FROM "agent_call_logs"
    WHERE ("executionLayer" IS NULL OR "executionLayer" != 'api-gateway')
      AND "agentId" NOT LIKE 'skill:%'
      AND "metadata" IS NOT NULL
      AND instr("metadata", '"skillId"') > 0
    LIMIT 1`;
  const present = rows.length > 0;
  metadataSkillIdSniff = { present, checkedAt: Date.now() };
  return present;
}

/** 测试辅助：清掉嗅探缓存 */
export function __clearMetadataSkillIdSniffForTests(): void {
  metadataSkillIdSniff = null;
}

async function resolveMetadataFallbackRows(
  since: Date | null
): Promise<Array<{ agentId: string; skillId: string | null; success: boolean | number; durationMs: number | null; calledAt: Date | string | null }>> {
  if (!(await hasNonPrefixedMetadataSkillId())) return [];
  return prisma.$queryRaw<Array<{ agentId: string; skillId: string | null; success: boolean | number; durationMs: number | null; calledAt: Date | string | null }>>`
    SELECT "agentId",
           CASE WHEN "metadata" IS NOT NULL AND json_valid("metadata")
                THEN json_extract("metadata", '$.skillId') END AS "skillId",
           "success", "durationMs", "calledAt"
    FROM "agent_call_logs"
    WHERE ("executionLayer" IS NULL OR "executionLayer" != 'api-gateway')
      AND "agentId" NOT LIKE 'skill:%'
      ${since ? Prisma.sql`AND "calledAt" >= ${since}` : Prisma.empty}`;
}

function emptyStats(skillId: string, range: SkillStatsRange): UnifiedSkillStats {
  const short = toShortSkillId(skillId);
  return {
    skillId: short,
    canonicalId: toCanonicalSkillId(skillId),
    callCount: 0,
    successCount: 0,
    failureCount: 0,
    successRate: null,
    avgDurationMs: 0,
    lastCalledAt: null,
    source: 'none',
    range,
  };
}

function finalizeStats(
  skillId: string,
  range: SkillStatsRange,
  total: number,
  success: number,
  avgDurationMs: number,
  lastCalledAt: Date | null,
  source: UnifiedSkillStats['source']
): UnifiedSkillStats {
  const short = toShortSkillId(skillId);
  return {
    skillId: short,
    canonicalId: toCanonicalSkillId(skillId),
    callCount: total,
    successCount: success,
    failureCount: Math.max(0, total - success),
    successRate: total > 0 ? Number(((success / total) * 100).toFixed(1)) : null,
    avgDurationMs: Math.round(avgDurationMs || 0),
    lastCalledAt,
    source,
    range,
  };
}

/**
 * 统一 Skill 运行统计：
 * 1) 有 prompt_call_logs → 以 prompt 调用为准（LLM skill）
 * 2) 否则 skill 层 agent_call_logs（排除 api-gateway）
 * 3) 同一 range 口径
 *
 * 性能批 2026-10-04：原实现一次全表原生扫描（业务行）逐行 json_extract(metadata) 端内归属——
 * range='all' 实测 68.7s（124k 业务行 × metadata 大列 183MB 全读）；7d 窗口同样付 metadata 列读。
 * 实测业务行 96%（119k/124k）以 `skill:` 前缀 agentId 归属，非前缀行仅 path-agent（~5k）且
 * 顶层 metadata.skillId 命中 0。改写为：
 *   ① 前缀行按 agentId 精确 IN → SQL 侧 GROUP BY 聚合（索引驱动，完全不读 metadata 列）；
 *   ② metadata 兜底分支保留（既定契约），由「嗅探门」门控：先按 10 分钟 TTL 检查非前缀行是否
 *      存在顶层 skillId，有才跑原兜底扫描（付费仅当该形态数据真实存在）。
 * 端内归属语义与改造前逐行等价（前缀优先、短 id 精确匹配、prompt 命中者跳过）。
 */
export async function getUnifiedSkillStats(
  skillIds: string[],
  range: SkillStatsRange = 'all'
): Promise<Map<string, UnifiedSkillStats>> {
  const result = new Map<string, UnifiedSkillStats>();
  const shortIds = Array.from(
    new Set(skillIds.map(toShortSkillId).filter(Boolean))
  );
  if (!shortIds.length) return result;

  for (const id of shortIds) {
    result.set(id, emptyStats(id, range));
  }

  const since = rangeToSince(range);
  const promptAgentIds = shortIds.map((id) => `skill:${id}`);
  const promptWhere: any = { agentId: { in: promptAgentIds } };
  if (since) promptWhere.createdAt = { gte: since };

  const [promptGroups, promptSuccessGroups, prefixedGroups, metadataFallbackRows] = await Promise.all([
    prisma.prompt_call_logs.groupBy({
      by: ['agentId'],
      where: promptWhere,
      _count: { _all: true },
      _avg: { durationMs: true },
      _max: { createdAt: true },
    }),
    prisma.prompt_call_logs.groupBy({
      by: ['agentId', 'success'],
      where: promptWhere,
      _count: { _all: true },
    }),
    /* ① 前缀行聚合：agentId IN（skill:xxx…）精确命中，走 agentId 索引，不读 metadata 大列 */
    prisma.$queryRaw<Array<{ agentId: string; success: number | boolean; n: number | bigint; durSum: number | bigint | null; lastAt: Date | string | null }>>`
      SELECT "agentId",
             "success",
             COUNT(*) AS "n",
             SUM(COALESCE("durationMs", 0)) AS "durSum",
             MAX("calledAt") AS "lastAt"
      FROM "agent_call_logs"
      WHERE ("executionLayer" IS NULL OR "executionLayer" != 'api-gateway')
        ${since ? Prisma.sql`AND "calledAt" >= ${since}` : Prisma.empty}
        AND "agentId" IN (${Prisma.join(promptAgentIds)})
      GROUP BY "agentId", "success"`,
    /* ② metadata 兜底（非前缀行按 metadata.skillId 归属）：先过嗅探门，未命中形态零成本 */
    resolveMetadataFallbackRows(since),
  ]);

  const promptSuccessMap = new Map<string, number>();
  for (const group of promptSuccessGroups) {
    if (group.success) {
      promptSuccessMap.set(group.agentId, group._count._all);
    }
  }

  const promptBacked = new Set<string>();
  for (const group of promptGroups) {
    const short = group.agentId.replace(/^skill:/, '');
    if (!shortIds.includes(short)) continue;
    promptBacked.add(short);
    result.set(
      short,
      finalizeStats(
        short,
        range,
        group._count._all,
        promptSuccessMap.get(group.agentId) || 0,
        group._avg.durationMs || 0,
        group._max.createdAt || null,
        'prompt_call_logs'
      )
    );
  }

  const agentAgg = new Map<
    string,
    { total: number; success: number; durationTotal: number; lastCalledAt: Date | null }
  >();
  const bumpAgg = (short: string, success: boolean, durationMs: number, calledAt: Date | null) => {
    const current = agentAgg.get(short) || {
      total: 0,
      success: 0,
      durationTotal: 0,
      lastCalledAt: null,
    };
    current.total += 1;
    current.success += success ? 1 : 0;
    current.durationTotal += durationMs || 0;
    if (calledAt && (!current.lastCalledAt || calledAt > current.lastCalledAt)) {
      current.lastCalledAt = calledAt;
    }
    agentAgg.set(short, current);
  };
  // ① 前缀聚合行（GROUP BY 后每 skill 至多两行：success/failed）
  for (const group of prefixedGroups) {
    const short = String(group.agentId || '').replace(/^skill:/, '');
    if (!shortIds.includes(short)) continue;
    if (promptBacked.has(short)) continue;
    const n = Number(group.n) || 0;
    const durSum = Number(group.durSum) || 0;
    const successFlag = group.success === true || group.success === 1;
    const lastAt = group.lastAt ? new Date(group.lastAt) : null;
    const current = agentAgg.get(short) || {
      total: 0,
      success: 0,
      durationTotal: 0,
      lastCalledAt: null,
    };
    current.total += n;
    current.success += successFlag ? n : 0;
    current.durationTotal += durSum;
    if (lastAt && (!current.lastCalledAt || lastAt > current.lastCalledAt)) {
      current.lastCalledAt = lastAt;
    }
    agentAgg.set(short, current);
  }
  // ② 兜底行（已由嗅探门过滤，常态为空集）
  for (const log of metadataFallbackRows) {
    // metadata.skillId 已由 json_extract 在库端取出（无效 JSON → null）
    const raw = typeof log.skillId === 'string' ? log.skillId : '';
    const short = raw.replace(/^skill:/, '');
    if (!shortIds.includes(short)) continue;
    if (promptBacked.has(short)) continue;
    bumpAgg(short, log.success === true || Number(log.success) === 1, Number(log.durationMs) || 0, log.calledAt ? new Date(log.calledAt) : null);
  }

  for (const [short, stats] of agentAgg.entries()) {
    result.set(
      short,
      finalizeStats(
        short,
        range,
        stats.total,
        stats.success,
        stats.total > 0 ? stats.durationTotal / stats.total : 0,
        stats.lastCalledAt,
        'agent_call_logs'
      )
    );
  }

  return result;
}

export async function getUnifiedSkillStat(
  skillId: string,
  range: SkillStatsRange = 'all'
): Promise<UnifiedSkillStats> {
  const short = toShortSkillId(skillId);
  const map = await getUnifiedSkillStats([short], range);
  return map.get(short) || emptyStats(short, range);
}

/**
 * 统一生效配置：
 * - route：平台 → agent → skill_model_configs（与 resolveRoute 一致）
 * - llmRequest：模型绑定来自 route；ACTIVE prompt 只贡献 temperature/maxTokens 意图（与 callPrompt 一致）
* - deprecatedPromptModel：ACTIVE prompt 上残留的 model 副本（已废弃，供清理提示）
 */
export async function resolveEffectiveSkillRuntimeConfig(
  skillId: string
): Promise<EffectiveSkillRuntimeConfig> {
  const short = toShortSkillId(skillId);
  const canonicalId = toCanonicalSkillId(skillId);
  const parentAgent = getAgentOfSkill(canonicalId);
  const manifest = getAgentManifest(canonicalId);

  const [override, activePrompt, reliability, resolvedRoute] = await Promise.all([
    skillModelConfigService.get(short).catch(() => null),
    systemPrisma.agent_prompts.findFirst({
      where: {
        agentId: { in: Array.from(new Set([canonicalId, short, `skill:${short}`])) },
        status: { in: ['ACTIVE', 'published'] },
      },
      orderBy: [{ publishedAt: 'desc' }, { version: 'desc' }],
      select: {
        id: true,
        version: true,
        model: true,
        temperature: true,
        maxTokens: true,
      },
    }),
    getPlatformReliabilitySettings(),
    getAPIGateway()
      .resolveRoute({
        agentId: parentAgent?.id,
        skillId: short,
      })
      .catch(() => null),
  ]);

  const hasSkillOverride = !!(override?.enabled);
  const routeSource: EffectiveSkillRuntimeConfig['route']['source'] = hasSkillOverride
    ? 'skill-override'
    : resolvedRoute
      ? parentAgent
        ? 'agent-or-platform'
        : 'platform-default'
      : 'unresolved';

  const routeModel = resolvedRoute?.model || override?.model || null;
  // Phase 3：route 投影不再读 skill_model_configs 陈旧 T/maxTokens（运行时本就不覆盖）
  const routeTemperature =
    resolvedRoute?.temperature
    ?? manifest?.defaultModelConfig?.temperature
    ?? null;
  const routeMaxTokens =
    resolvedRoute?.maxTokens
    ?? manifest?.defaultModelConfig?.maxTokens
    ?? null;
  const routeTimeoutMs =
    resolvedRoute?.timeoutMs ??
    override?.requestTimeoutMs ??
    null;

  // 与运行时 resolveLlmGenerationParams 同源
  const { resolveLlmGenerationParams } = await import('./resolve-llm-call-params');
  const llmResolved = resolveLlmGenerationParams({
    promptConfig: activePrompt,
    routeFallback: {
      model: routeModel,
      temperature: routeTemperature,
      maxTokens: routeMaxTokens,
    },
  });
  const llmModel = llmResolved.model ?? null;
  const llmTemperature = llmResolved.temperature ?? null;
  const llmMaxTokens = llmResolved.maxTokens ?? null;
  const mapSource = (
    s: string
  ): EffectiveSkillRuntimeConfig['llmRequest']['source'] => {
    if (s === 'active-prompt') return 'active-prompt';
    if (s === 'route-fallback' || s === 'code-defaults') return 'route';
    if (s === 'runtime-override') return 'active-prompt';
    return 'none';
  };
  const llmSource = mapSource(llmResolved.sources.maxTokens !== 'none'
    ? llmResolved.sources.maxTokens
    : llmResolved.sources.temperature !== 'none'
      ? llmResolved.sources.temperature
      : llmResolved.sources.model);

  const platformMaxLogical = reliability.maxLogicalRetries;
  const logicalRetry =
    override?.maxLogicalRetries == null
      ? platformMaxLogical
      : Math.min(override.maxLogicalRetries, platformMaxLogical);

  return {
    skillId: short,
    canonicalId,
    route: {
      model: routeModel,
      temperature: routeTemperature,
      maxTokens: routeMaxTokens,
      timeoutMs: routeTimeoutMs,
      thinkingMode: resolvedRoute?.thinkingMode || override?.thinkingMode || 'default',
      reasoningEffort: resolvedRoute?.reasoningEffort || override?.reasoningEffort || 'default',
      source: routeSource,
      hasSkillOverride,
    },
    llmRequest: {
      model: llmModel,
      temperature: llmTemperature,
      maxTokens: llmMaxTokens,
      source: llmSource,
      deprecatedPromptModel: typeof activePrompt?.model === 'string' && activePrompt.model.trim()
        ? activePrompt.model.trim()
        : null,
      activePrompt: activePrompt
        ? {
            id: activePrompt.id,
            version: activePrompt.version,
            model: typeof activePrompt.model === 'string' && activePrompt.model.trim()
              ? activePrompt.model.trim()
              : null,
            temperature: typeof activePrompt.temperature === 'number'
              ? activePrompt.temperature
              : null,
            maxTokens: typeof activePrompt.maxTokens === 'number'
              ? activePrompt.maxTokens
              : null,
          }
        : null,
    },
    override: override
      ? {
          enabled: !!override.enabled,
          model: override.model || null,
          temperature: override.temperature ?? null,
          maxTokens: override.maxTokens ?? null,
          maxLogicalRetries: override.maxLogicalRetries ?? null,
          requestTimeoutMs: override.requestTimeoutMs ?? null,
        }
      : null,
    reliability: {
      maxUpstreamAttempts: reliability.maxUpstreamAttempts,
      maxTransportRetries: reliability.maxTransportRetries,
      maxLogicalRetries: logicalRetry,
      logicalRetrySource:
        override?.maxLogicalRetries == null ? 'platform-default' : 'skill-override',
      platformMaxLogicalRetries: platformMaxLogical,
    },
  };
}

export function toLegacySkillRuntimeStats(stats: UnifiedSkillStats): {
  callCount: number;
  successRate: number;
  avgLatency: number;
  lastCalledAt: Date | null;
} {
  return {
    callCount: stats.callCount,
    successRate: stats.callCount > 0 ? (stats.successCount / stats.callCount) : 1,
    avgLatency: stats.avgDurationMs,
    lastCalledAt: stats.lastCalledAt,
  };
}

export type { PlatformReliabilitySettings };
