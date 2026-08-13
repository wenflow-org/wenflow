import express, { Request, Response } from 'express';
import prisma from '../../config/database';
import systemPrisma from '../../config/system-database';
import { authMiddleware } from '../../middleware/auth.middleware';
import { getPlatformSettings, updatePlatformSettings } from '../../services/platform-settings.service';
import { getAgentCatalog, isOfficialAgent } from '../../services/agent-catalog.service';
import {
  getAgentManifest,
  getCanonicalAgentId,
  getMonitoringGroupMappings,
  getAgentRelations,
  isManifestAgent,
  listAgentManifest
} from '../../services/agent-manifest.service';
import { getGateway } from '../../gateway';
import {
  DEFAULT_PATH_AGENT_INPUT_CONFIG,
  getPathAgentInputConfig,
  savePathAgentInputConfig
} from '../../services/agentConfig.service';
import pathCoordinator from '../../coordinators/path.coordinator';
import { logger } from '../../utils/logger';
import {
  getPlatformReliabilitySettings,
  getReliabilityHardLimits,
  updatePlatformReliabilitySettings
} from '../../services/reliability-settings.service';
import {
  getPlatformCapabilityProbeEnabled,
  getPlatformCapabilityProbeInterval,
  DEFAULT_CAPABILITY_PROBE_ENABLED,
  DEFAULT_CAPABILITY_PROBE_INTERVAL_MS,
  MIN_CAPABILITY_PROBE_INTERVAL_MS,
  MAX_CAPABILITY_PROBE_INTERVAL_MS,
  updatePlatformCapabilityProbeEnabled,
  updatePlatformCapabilityProbeInterval
} from '../../services/capability-probe-settings.service';
import { aiCapabilityHealthService } from '../../services/ai-capability-health.service';
import { loadSkillsBookRaw, getActiveSkillIds } from '../../services/skill-registry/skills-file';
import { analyzeW2 } from '../../services/skills-readiness.service';
import { deriveTeachingSessionProgress } from './teaching-sessions.progress';

const router = express.Router();
router.use(authMiddleware);

const AGENT_NAME_TO_IDS: Record<string, string[]> = getMonitoringGroupMappings();

const MONITORED_AGENT_ORDER = [
  'RequirementCollection',
  'PathPlanning',
  'LearnerOrchestration',
  'Teaching',
  'TeachingOrchestration',
  'LearningCompanion',
  'SessionWrapup'
];

const AGENT_ID_TO_NAME = Object.entries(AGENT_NAME_TO_IDS).reduce((acc, [name, ids]) => {
  for (const id of ids) {
    acc[id] = name;
  }
  return acc;
}, {} as Record<string, string>);

const AGENT_RELATIONS = getAgentRelations();

/**
 * 生产统计用户过滤：排除虚拟学习者与测试/审计账号（合成流量），避免污染真实指标。
 * 测试账号按命名模式识别（e2e_/audit_probe_/ui_check/motion_review/qa_audit_/@test.local/virtual_）。
 * 注：utils/test-account.ts 是本地未入库的单点（gitignore test-*.ts），此处内联等价条件，
 * 保证统计口径在干净检出下可编译。
 */
const REAL_USER_WHERE = {
  isVirtualLearner: false,
  deletedAt: null,
  NOT: [
    { email: { startsWith: 'virtual_' } },
    { email: { endsWith: '@test.local' } },
    { email: { startsWith: 'e2e_' } },
    { email: { startsWith: 'audit_probe_' } },
    { email: { startsWith: 'ui_check' } },
    { email: { startsWith: 'motion_review' } },
    { email: { startsWith: 'qa_audit_' } },
  ],
};

const timeoutErrorSignals = [
  'timeout',
  'timed out',
  'etimedout',
  'deadline exceeded',
  'request timeout',
  'socket hang up'
];

// 超时识别：优先 errorCode/errorCategory（现代 gateway 行写 errorCode=ATTEMPT_TIMEOUT、errorCategory=provider_timeout），
// 兼容旧行 errorCode 中直接含 timeout 字样（ETIMEDOUT 等）。
const isTimeoutLog = (log: { errorCode: string | null; errorCategory?: string | null }) => {
  const errorCode = String(log.errorCode || '').toLowerCase();
  const errorCategory = String(log.errorCategory || '').toLowerCase();
  return errorCategory.includes('timeout')
    || timeoutErrorSignals.some(signal => errorCode.includes(signal));
};

/**
 * 失败归因分类（调用级，agent_call_logs）：
 * - 现代 gateway 行带 errorCategory 列 → 直接采用；
 * - 老平台/skill 行 errorCategory 为空 → 由 errorCode/error 文本启发式归并
 *   （CALLER_ABORTED/取消 → caller_abort；超时信号 → provider_timeout；限流信号 → rate_limit；其余 → internal）。
 * 与 buildErrorCategoryWhere（/agents/logs 筛选）同源，保证「归因计数 ↔ 日志列表」闭环一致。
 */
export function classifyFailureCategory(row: {
  errorCategory: string | null;
  errorCode: string | null;
  error: string | null;
}): string {
  const category = String(row.errorCategory || '').toLowerCase();
  if (category) return category;
  const code = String(row.errorCode || '').toUpperCase();
  const text = String(row.error || '').toLowerCase();
  if (code.includes('CALLER_ABORTED') || text.includes('cancel')) return 'caller_abort';
  if (isTimeoutLog(row) || timeoutErrorSignals.some(signal => text.includes(signal))) return 'provider_timeout';
  if (code.includes('RATE') || code.includes('429') || text.includes('rate limit') || text.includes('throttl')) {
    return 'rate_limit';
  }
  return 'internal';
}

/** 限流信号条件（classifyFailureCategory 的 rate_limit 分支镜像） */
const RATE_LIMIT_CONDITION = {
  OR: [
    { errorCode: { contains: 'RATE' } },
    { errorCode: { contains: '429' } },
    { error: { contains: 'rate limit' } },
  ],
};

/** 取消信号条件（classifyFailureCategory 的 caller_abort 分支镜像） */
const CALLER_ABORT_CONDITION = {
  OR: [
    { errorCode: { contains: 'CALLER_ABORTED' } },
    { error: { contains: 'cancel' } },
  ],
};

/** 超时信号条件（与 /agents/logs 状态筛选同构；provider_timeout 分支镜像） */
const TIMEOUT_CONDITION = {
  OR: [
    { errorCode: { contains: 'TIMEOUT' } },
    ...timeoutErrorSignals.map(signal => ({ error: { contains: signal } })),
  ],
};

/**
 * /agents/logs 的 errorCategory 筛选条件：列值精确匹配 + errorCategory 为空行的
 * 启发式归并（与 classifyFailureCategory 同口径，纯函数便于单测）。
 * 未知类别 → 仅精确匹配。
 */
export function buildErrorCategoryWhere(category: string): { OR: Record<string, unknown>[] } | null {
  const cat = String(category || '').toLowerCase();
  if (!cat) return null;
  const extra: Record<string, unknown>[] = [];
  if (cat === 'caller_abort') {
    extra.push({ errorCategory: null, ...CALLER_ABORT_CONDITION });
  } else if (cat === 'provider_timeout') {
    extra.push({ errorCategory: null, ...TIMEOUT_CONDITION });
  } else if (cat === 'rate_limit') {
    extra.push({ errorCategory: null, ...RATE_LIMIT_CONDITION });
  } else if (cat === 'internal') {
    extra.push({
      errorCategory: null,
      AND: [
        { NOT: CALLER_ABORT_CONDITION },
        { NOT: TIMEOUT_CONDITION },
        { NOT: RATE_LIMIT_CONDITION },
      ],
    });
  }
  return { OR: [{ errorCategory: cat }, ...extra] };
}

const inferRuntimeRole = (agentId: string, type?: string | null) => {
  const typeText = String(type || '').toLowerCase();
  if (agentId.startsWith('skill:')) return 'skill';
  if (isManifestAgent(agentId)) return 'agent';
  if (typeText.includes('skill')) return 'skill';
  if (typeText.includes('agent')) return 'agent';
  if (agentId.endsWith('-agent')) return 'agent';
  return 'skill';
};

const ensureAdmin = async (userId?: string) => {
  if (!userId) return false;
  const operator = await prisma.users.findUnique({
    where: { id: userId },
    select: { isAdmin: true }
  });
  return !!operator?.isAdmin;
};

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

const parseLogMetadata = (metadata: string | null): Record<string, any> => {
  if (!metadata) return {};
  try {
    return JSON.parse(metadata);
  } catch {
    return {};
  }
};

/**
 * 服务端截断日志详情大字段（input/output）。
 * 前端 live.ts fetchLogDetail 已按 4000 字符二次兜底截断；后端先截断避免全量传输。
 * 截断后含标记总长 ≤ 4000，不会触发前端二次截断标记。
 */
const truncateLogPayload = (value: string | null, limit = 4000): { value: string | null; truncated: boolean } => {
  if (!value || value.length <= limit) return { value, truncated: false };
  const marker = `\n…（已截断，共 ${value.length} 字符）`;
  const keep = Math.max(1, limit - marker.length);
  return { value: value.slice(0, keep) + marker, truncated: true };
};

const isPathGenerationFlowEventMetadata = (metadata: string | null): boolean => {
  const parsed = parseLogMetadata(metadata);
  return parsed.eventType === 'path-generation-stage';
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

router.get('/settings/registration', async (req: Request, res: Response) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) {
      return res.status(403).json({
        success: false,
        error: { message: '需要管理员权限' }
      });
    }

    const settings = await getPlatformSettings();
    res.json({
      success: true,
      data: settings
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { message: error.message || '获取设置失败', status: 500 }
    });
  }
});

router.put('/settings/registration', async (req: Request, res: Response) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) {
      return res.status(403).json({
        success: false,
        error: { message: '需要管理员权限' }
      });
    }

    const { registrationEnabled } = req.body;
    if (typeof registrationEnabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: { message: 'registrationEnabled 必须是布尔值', status: 400 }
      });
    }

    const settings = await updatePlatformSettings({ registrationEnabled });
    res.json({
      success: true,
      data: settings
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { message: error.message || '更新设置失败', status: 500 }
    });
  }
});

/**
 * Agent Manifest 一致性诊断
 * GET /api/admin/manifest/diagnostics
 */
router.get('/manifest/diagnostics', async (req: Request, res: Response) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) {
      return res.status(403).json({
        success: false,
        error: { message: '需要管理员权限' }
      });
    }

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

    // ---- skill_registrations 维度（SKILL_READINESS_SPEC §4.1）----
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

    res.json({
      success: true,
      data: {
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
      }
    });
  } catch (error: any) {
    logger.error('[admin-platform] 获取 manifest 诊断失败', { error });
    res.status(500).json({
      success: false,
      error: {
        message: '获取 manifest 诊断失败',
        status: 500
      }
    });
  }
});

/**
 * 获取平台概览数据
 * GET /api/admin/overview/stats
 */

/**
 * 获取 Agent 注册列表
 * GET /api/admin/agents/registry
 */

/**
 * 获取 Agent 设计详情（输入/输出 Schema + 运行契约）
 * GET /api/admin/agents/design/:agentId
 */

/**
 * 获取编排器与成员 Agent 关系
 * GET /api/admin/agents/relations
 */

/**
 * Agent 拓扑可视化 API
 * GET /api/admin/agents/topology
 *
 * 返回 5 顶层 Agent + 下辖 Skill 的节点图数据：
 *   - nodes: 5 Agent + N Skill（带统计）
 *   - edges: Agent -> Skill 隶属关系
 *
 * 时间窗口：?range=24h | 7d | 30d (默认 7d)
 */

/**
 * 获取平台概览数据
 * GET /api/admin/overview/stats
 *
 * 服务端缓存：45s TTL，避免每次进入概览页重复执行 20+ 条统计查询。
 * /overview/stats 无请求参数，使用固定 key；/activity 的 key 含 excludeTest 与 limit。
 */
const OVERVIEW_CACHE_TTL_MS = 45 * 1000;
const overviewStatsCache = new Map<string, { payload: unknown; cachedAt: number }>();

/** 测试辅助：清空概览/动态缓存（45s TTL 会跨用例复用，污染路由级断言） */
export function clearOverviewStatsCache(): void {
  overviewStatsCache.clear();
}

export interface HourlyTrendBucket {
  time: string;
  label: string;
  total: number;
  error: number;
  timeout: number;
}

/**
 * 24h 脉搏全量聚合（P0-1：替代 take:50 抽样）。
 * 桶窗口与查询窗口同源：windowStart = 当前整点 - 23h，覆盖 [windowStart, now] 恰好 24 个整点桶，
 * 「总数 = 各小时之和」恒成立；窗口外（含未来时间戳）的日志一律不计入。
 * 所有键用本地时间生成，与查询 where（gte windowStart）对齐，避免抽样/错位导致的静默失真。
 */
export function buildHourlyTrend(
  logs: Array<{
    calledAt: Date | string;
    success: boolean;
    errorCode: string | null;
    errorCategory?: string | null;
  }>,
  windowStart: Date,
  now: Date = new Date()
): HourlyTrendBucket[] {
  const hourKeys: string[] = [];
  const hourlyTrendMap: Record<string, { total: number; error: number; timeout: number }> = {};

  for (let i = 23; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() - i);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}-${d.getHours()}`;
    hourKeys.push(key);
    hourlyTrendMap[key] = { total: 0, error: 0, timeout: 0 };
  }

  for (const log of logs) {
    const d = new Date(log.calledAt);
    if (d.getTime() < windowStart.getTime() || d.getTime() > now.getTime()) continue;

    const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}-${d.getHours()}`;
    if (!hourlyTrendMap[key]) continue;

    hourlyTrendMap[key].total += 1;
    if (!log.success) {
      if (isTimeoutLog(log)) {
        hourlyTrendMap[key].timeout += 1;
      } else {
        hourlyTrendMap[key].error += 1;
      }
    }
  }

  return hourKeys.map(key => {
    const [year, month, day, hour] = key.split('-').map(Number);
    const d = new Date(year, month - 1, day, hour);
    const point = hourlyTrendMap[key];
    return {
      time: d.toISOString(),
      label: `${String(hour).padStart(2, '0')}:00`,
      total: point.total,
      error: point.error,
      timeout: point.timeout
    };
  });
}

async function computeOverviewStats(): Promise<unknown> {
    // 获取今日统计
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // 获取昨日统计
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const last24HoursStart = new Date(Date.now() - 24 * 3600000);

    // 脉搏窗口与桶窗口同源：当前整点 - 23h（[start, now] 恰好 24 个整点桶），
    // 保证「24h 总数 = 各小时之和」恒成立；活跃 Agent 统计仍用严格 24h 滚动窗口。
    const trendWindowStart = new Date();
    trendWindowStart.setMinutes(0, 0, 0);
    trendWindowStart.setHours(trendWindowStart.getHours() - 23);

    const businessExecutionWhere = {
      OR: [
        { executionLayer: null },
        { executionLayer: { not: 'api-gateway' } }
      ]
    };
    // 生产统计排除虚拟学习者与测试/审计账号：见模块级 REAL_USER_WHERE

    // 并行查询所有统计数据
    const [
      totalUsers,
      newUsersToday,
      activeUsersToday,
      totalPaths,
      failedPaths,
      activePaths,
      totalTasks,
      completedTasks,
      totalConversations,
      completedConversations,
      activeConversations,
      totalAgentLogs,
      agentCallsToday,
      agentSuccessToday,
      agentTimeoutToday,
      activeAgents24h,
      recentAgentLogs24h,
      wrapupLogs,
      usageTokens7d,
      usageCalls7d,
      usageModels7d,
      usageFailuresRows
    ] = await Promise.all([
      // 总用户数（不含虚拟学习者）
      prisma.users.count({
        where: REAL_USER_WHERE,
      }),
      
      // 今日新增用户（不含虚拟学习者）
      prisma.users.count({
        where: {
          ...REAL_USER_WHERE,
          createdAt: {
            gte: today,
            lt: tomorrow,
          },
        },
      }),
      
      // 今日活跃用户（有学习会话，不含虚拟学习者）
      prisma.teaching_sessions.findMany({
        where: {
          users: REAL_USER_WHERE,
          startTime: {
            gte: today,
            lt: tomorrow,
          },
        },
        distinct: ['userId'],
        select: { userId: true },
      }),
      
      // 总学习路径数（不含虚拟学习者/测试账号）
      prisma.learning_paths.count({
        where: { users: REAL_USER_WHERE },
      }),

      // 生成失败的学习路径数（断点归因用，不含虚拟学习者/测试账号）
      prisma.learning_paths.count({
        where: { users: REAL_USER_WHERE, status: 'failed' },
      }),
      
      // 活跃学习路径（有未完成的任务，不含虚拟学习者）
      prisma.learning_paths.findMany({
        where: {
          users: REAL_USER_WHERE,
          milestones: {
            some: {
              subtasks: {
                some: {
                  status: {
                    in: ['todo', 'in_progress'],
                  },
                },
              },
            },
          },
        },
        select: { id: true },
      }),
      
      // 总任务数（不含虚拟学习者）
      prisma.subtasks.count({
        where: { users: REAL_USER_WHERE },
      }),
      
      // 已完成任务数（不含虚拟学习者）
      prisma.subtasks.count({
        where: {
          users: REAL_USER_WHERE,
          status: 'completed',
        },
      }),
      
      // 总对话数（不含虚拟学习者/测试账号）
      prisma.goal_conversations.count({
        where: { users: REAL_USER_WHERE },
      }),

      // 完成澄清的对话数（漏斗"目标"口径，不含虚拟学习者/测试账号）
      prisma.goal_conversations.count({
        where: { users: REAL_USER_WHERE, status: 'completed' },
      }),
      
      // 活跃对话（不含虚拟学习者）
      prisma.goal_conversations.count({
        where: {
          users: REAL_USER_WHERE,
          status: 'active',
        },
      }),
      
      // Agent 调用统计 (使用 agentCallLog 表)
      prisma.agent_call_logs.groupBy({
        by: ['success'],
        where: businessExecutionWhere,
        _count: true,
      }),

      // 今日 Agent 调用数
      prisma.agent_call_logs.count({
        where: {
          ...businessExecutionWhere,
          calledAt: {
            gte: today,
            lt: tomorrow,
          },
        },
      }),

      // 今日 Agent 成功调用
      prisma.agent_call_logs.count({
        where: {
          ...businessExecutionWhere,
          calledAt: {
            gte: today,
            lt: tomorrow,
          },
          success: true,
        },
      }),

      // 今日超时调用（按 errorCode/errorCategory 识别）。
      // 保守保留 LIKE 查询：现代 gateway 行带 errorCategory=provider_timeout / errorCode=ATTEMPT_TIMEOUT，
      // 但旧平台与 skill 行只有 error/errorCode 文本信号（无 errorCategory 列值），
      // 且 error 字段可能包含 'timed out' 等 errorCode 不含的信号，故不做枚举化改造。
      prisma.agent_call_logs.count({
        where: {
          AND: [
            businessExecutionWhere,
            {
              calledAt: { gte: today, lt: tomorrow },
              success: false,
              OR: [
                { errorCode: { contains: 'TIMEOUT' } },
                { error: { contains: 'timeout' } },
                { error: { contains: 'timed out' } },
                { error: { contains: 'etimedout' } },
                { error: { contains: 'deadline exceeded' } },
                { error: { contains: 'request timeout' } }
              ]
            }
          ]
        }
      }),

      // 最近 24h 活跃 Agent 数
      prisma.agent_call_logs.groupBy({
        by: ['agentId'],
        where: {
          ...businessExecutionWhere,
          calledAt: { gte: new Date(Date.now() - 24 * 3600000) }
        }
      }),

      // 最近 24h 调用趋势（P0-1：全量聚合，无 take 截断；时间窗 where 限定 [trendWindowStart, now]，
      // calledAt 已有索引 @@index([calledAt])；窄 select 避免拉取 error 全文，orderBy 保证聚合顺序稳定）
      prisma.agent_call_logs.findMany({
        where: {
          ...businessExecutionWhere,
          calledAt: { gte: trendWindowStart }
        },
        orderBy: { calledAt: 'asc' },
        select: {
          calledAt: true,
          success: true,
          errorCode: true,
          errorCategory: true
        }
      }),

      // wrapup 来源分布抽样（200 → 50：仅用于 wrapupSourceStats 比例估算）
      prisma.agent_call_logs.findMany({
        where: { agentId: 'skill:session-wrapup' },
        orderBy: { calledAt: 'desc' },
        take: 50,
        select: { output: true }
      }),

      // 近 7 天 LLM 用量聚合（token 总量，来自执行尝试表）
      prisma.llm_execution_attempts.aggregate({
        where: { startedAt: { gte: new Date(Date.now() - 7 * 86400000) } },
        _sum: { totalTokens: true },
        _count: true,
      }),

      // 近 7 天调用与失败数
      prisma.agent_call_logs.groupBy({
        by: ['success'],
        where: {
          ...businessExecutionWhere,
          calledAt: { gte: new Date(Date.now() - 7 * 86400000) }
        },
        _count: true,
      }),

      // 近 7 天模型用量分布（按解析后的模型名）
      prisma.llm_execution_attempts.groupBy({
        by: ['resolvedModel'],
        where: { startedAt: { gte: new Date(Date.now() - 7 * 86400000) } },
        _sum: { totalTokens: true },
        _count: true,
      }),

      // 近 7 天失败归因（调用级：与「失败 N」同表同口径，分类见 classifyFailureCategory，
      // 老行 errorCategory 为空时按 errorCode/error 启发式归并，保证归因之和恒等于失败总数）
      prisma.agent_call_logs.findMany({
        where: {
          ...businessExecutionWhere,
          calledAt: { gte: new Date(Date.now() - 7 * 86400000) },
          success: false,
        },
        orderBy: { calledAt: 'desc' },
        select: { errorCategory: true, errorCode: true, error: true },
      })
    ]);

    const wrapupSourceStats = {
      sampleSize: 0,
      summaryModel: 0,
      summaryFallback: 0,
      evaluationModel: 0,
      evaluationAiFallback: 0,
      evaluationFailed: 0,
    };

    for (const log of wrapupLogs) {
      if (!log.output) continue;
      try {
        const parsed = JSON.parse(log.output);
        const summarySource = parsed?.sources?.summary || parsed?.summarySource;
        const evaluationSource = parsed?.sources?.evaluation || parsed?.evaluationSource;
        wrapupSourceStats.sampleSize += 1;
        if (summarySource === 'model') wrapupSourceStats.summaryModel += 1;
        if (summarySource === 'fallback') wrapupSourceStats.summaryFallback += 1;
        if (evaluationSource === 'model') wrapupSourceStats.evaluationModel += 1;
        if (evaluationSource === 'ai-fallback') wrapupSourceStats.evaluationAiFallback += 1;
        if (evaluationSource === 'failed' || evaluationSource === 'unavailable') wrapupSourceStats.evaluationFailed += 1;
      } catch {
        continue;
      }
    }

    // 计算活跃用户数
    const activeUsersCount = activeUsersToday.length;
    
    // 计算活跃路径数
    const activePathsCount = activePaths.length;

    // 计算 Agent 成功率 (使用 agentCallLog 的 success 字段)
    const agentStats = {
      total: totalAgentLogs.reduce((sum, s) => sum + s._count, 0),
      success: totalAgentLogs.find(s => s.success === true)?._count || 0,
      error: totalAgentLogs.find(s => s.success === false)?._count || 0,
    };
    
    const agentSuccessRate = agentStats.total > 0 
      ? agentStats.success / agentStats.total 
      : 1.0;

    const agentTodaySuccessRate = agentCallsToday > 0
      ? ((agentSuccessToday / agentCallsToday) * 100).toFixed(1)
      : null;

    // 全量聚合：每行必落 24 桶之一，总数=各小时和；高峰小时在聚合内直接给出（不再前端从抽样推断）
    const hourlyTrend = buildHourlyTrend(recentAgentLogs24h, trendWindowStart);
    const last24hTotal = hourlyTrend.reduce((sum, b) => sum + b.total, 0);
    const peakBucket = hourlyTrend.reduce(
      (best, b) => (b.total > (best?.total || 0) ? b : best),
      undefined as HourlyTrendBucket | undefined
    );
    const last24hPeak = last24hTotal > 0 && peakBucket ? peakBucket.label : '—';

    /* 近 7 天 LLM 用量与失败归因 */
    const sum7d = (usageTokens7d as { _sum?: { totalTokens?: number | null } })._sum || {};
    const calls7dTotal = usageCalls7d.reduce((acc, g) => acc + g._count, 0);
    // 失败数 = 失败归因行数（同一查询源，二者恒等，消除「失败 234 vs 归因 168」双口径）
    const calls7dFailed = usageFailuresRows.length;
    const models7d = (usageModels7d || [])
      .filter(g => g.resolvedModel && g.resolvedModel !== 'null')
      .map(g => ({
        model: String(g.resolvedModel),
        calls: g._count,
        tokens: g._sum.totalTokens || 0,
      }))
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 5);
    const failureCategoryCounts = new Map<string, number>();
    for (const row of usageFailuresRows) {
      const cat = classifyFailureCategory(row);
      failureCategoryCounts.set(cat, (failureCategoryCounts.get(cat) || 0) + 1);
    }
    const failures7d = [...failureCategoryCounts.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    const usage = {
      calls7d: calls7dTotal,
      failed7d: calls7dFailed,
      totalTokens7d: Number(sum7d.totalTokens || 0),
      models7d,
      failures7d,
    };

    return {
        users: {
          total: totalUsers,
          newToday: newUsersToday,
          activeToday: activeUsersCount,
          activeRate: totalUsers > 0 ? (activeUsersCount / totalUsers * 100).toFixed(1) : '0.0',
        },
        learning: {
          totalPaths,
          failedPaths,
          activePaths: activePathsCount,
          totalTasks,
          completedTasks,
          completionRate: totalTasks > 0 ? (completedTasks / totalTasks * 100).toFixed(1) : '0.0',
        },
        conversations: {
          total: totalConversations,
          completed: completedConversations,
          active: activeConversations,
        },
        agents: {
          totalCalls: agentStats.total,
          successRate: (agentSuccessRate * 100).toFixed(1),
          failedCalls: agentStats.error,
          activeAgents24h: activeAgents24h.length,
          todayCalls: agentCallsToday,
          todaySuccessRate: agentTodaySuccessRate,
          todayTimeouts: agentTimeoutToday,
          last24h: hourlyTrend,
          last24hTotal,
          last24hPeak,
          wrapup: wrapupSourceStats,
        },
        usage,
    };
}

router.get('/overview/stats', async (req: Request, res: Response) => {
  try {
    const cacheKey = 'overview-stats';
    const cached = overviewStatsCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < OVERVIEW_CACHE_TTL_MS) {
      return res.json({ success: true, data: cached.payload });
    }
    const data = await computeOverviewStats();
    overviewStatsCache.set(cacheKey, { payload: data, cachedAt: Date.now() });
    res.json({ success: true, data });
  } catch (error: any) {
    logger.error('[admin-platform] 获取平台概览失败', { error });
    res.status(500).json({
      success: false,
      error: {
        message: '获取平台数据失败',
        status: 500,
      },
    });
  }
});
router.get('/agents/topology', async (req: Request, res: Response) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) {
      return res.status(403).json({
        success: false,
        error: { message: '需要管理员权限' }
      });
    }

    const range = String(req.query.range || 'all');
    const statsRange = range === '24h' || range === '7d' || range === '30d' || range === 'all'
      ? range
      : 'all';

    const { listTopLevelAgents, listAgentManifest, getCanonicalAgentId } = await import('../../services/agent-manifest.service');
    const {
      getUnifiedSkillStats,
      resolveEffectiveSkillRuntimeConfig,
    } = await import('../../services/skill-runtime-contract.service');
    const topAgents = listTopLevelAgents();
    const allManifest = listAgentManifest();
    const manifestMap = new Map(allManifest.map(m => [m.id, m]));

    const skillIds: string[] = [];
    for (const agent of topAgents) {
      for (const memberId of agent.agentMembers || []) {
        const canonical = getCanonicalAgentId(memberId);
        if (canonical.startsWith('skill:')) {
          skillIds.push(canonical.replace(/^skill:/, ''));
        }
      }
    }

    // Skill 统计与列表/抽屉统一；Agent 节点仍用 agent_call_logs（编排层）
    const sinceMs = statsRange === '24h' ? 24 * 3600 * 1000
      : statsRange === '30d' ? 30 * 24 * 3600 * 1000
        : statsRange === '7d' ? 7 * 24 * 3600 * 1000
          : null;
    const since = sinceMs ? new Date(Date.now() - sinceMs) : null;
    const agentCallWhere = since ? { calledAt: { gte: since } } : {};

    const [skillStatsMap, callGroups, successGroups] = await Promise.all([
      getUnifiedSkillStats(skillIds, statsRange as any),
      prisma.agent_call_logs.groupBy({
        by: ['agentId'],
        where: agentCallWhere,
        _count: { _all: true },
        _avg: { durationMs: true }
      }),
      prisma.agent_call_logs.groupBy({
        by: ['agentId', 'success'],
        where: agentCallWhere,
        _count: { _all: true }
      }),
    ]);

    const callMap = new Map<string, { total: number; avgDuration: number }>();
    for (const g of callGroups) {
      callMap.set(g.agentId, { total: g._count._all, avgDuration: Math.round(g._avg.durationMs || 0) });
    }
    const successMap = new Map<string, { success: number; failed: number }>();
    for (const g of successGroups) {
      const cur = successMap.get(g.agentId) || { success: 0, failed: 0 };
      if (g.success) cur.success += g._count._all; else cur.failed += g._count._all;
      successMap.set(g.agentId, cur);
    }

    const getAgentStats = (id: string) => {
      const c = callMap.get(id);
      const s = successMap.get(id) || { success: 0, failed: 0 };
      const total = c?.total ?? 0;
      const successRate = total > 0 ? Number(((s.success / total) * 100).toFixed(1)) : null;
      return { totalCalls: total, successRate, avgDuration: c?.avgDuration ?? 0, failed: s.failed, source: 'agent_call_logs', range: statsRange };
    };

    const nodes: any[] = [];
    const edges: any[] = [];
    const effectiveConfigCache = new Map<string, any>();

    for (const agent of topAgents) {
      const agentStats = getAgentStats(agent.id);

      nodes.push({
        id: agent.id,
        type: 'agent',
        label: agent.name,
        description: agent.description,
        monitoringGroup: agent.monitoringGroup,
        memberCount: (agent.agentMembers || []).length,
        stats: agentStats
      });

      for (const memberId of agent.agentMembers || []) {
        const canonical = getCanonicalAgentId(memberId);
        const skill = manifestMap.get(canonical);
        if (!skill) continue;

        const shortId = canonical.replace(/^skill:/, '');
        const unified = skillStatsMap.get(shortId);
        const skillStats = {
          totalCalls: unified?.callCount || 0,
          successRate: unified?.successRate ?? null,
          avgDuration: unified?.avgDurationMs || 0,
          failed: unified?.failureCount || 0,
          source: unified?.source || 'none',
          range: statsRange,
        };

        let modelConfig: Record<string, unknown> | null = skill.defaultModelConfig
          ? { ...skill.defaultModelConfig, source: 'manifest-default' }
          : null;
        try {
          let effective = effectiveConfigCache.get(shortId);
          if (!effective) {
            effective = await resolveEffectiveSkillRuntimeConfig(shortId);
            effectiveConfigCache.set(shortId, effective);
          }
          modelConfig = {
            model: effective.llmRequest.model,
            temperature: effective.llmRequest.temperature,
            maxTokens: effective.llmRequest.maxTokens,
            source: effective.llmRequest.source,
            routeSource: effective.route.source,
          };
        } catch {
          // keep manifest default as last resort
        }

        nodes.push({
          id: skill.id,
          type: 'skill',
          label: skill.name,
          description: skill.description,
          category: skill.category,
          parentAgentId: agent.id,
          ioContractVersion: skill.ioContractVersion,
          noPromptFile: !!skill.noPromptFile,
          modelConfig,
          stats: skillStats
        });

        edges.push({
          id: `${agent.id}__${skill.id}`,
          source: agent.id,
          target: skill.id,
          type: 'membership'
        });
      }
    }

    const summary = {
      agentCount: topAgents.length,
      skillCount: nodes.filter(n => n.type === 'skill').length,
      totalCalls: nodes.reduce((s, n) => s + (n.stats?.totalCalls || 0), 0),
      unhealthyCount: nodes.filter(n => n.stats?.totalCalls > 0 && (n.stats.successRate ?? 100) < 90).length,
      idleCount: nodes.filter(n => n.type === 'skill' && (!n.stats?.totalCalls || n.stats.totalCalls === 0)).length,
      range
    };

    res.json({
      success: true,
      data: { nodes, edges, summary }
    });
  } catch (error: any) {
    logger.error('[admin-topology] 加载拓扑失败', { error });
    res.status(500).json({
      success: false,
      error: { message: error?.message || '加载拓扑失败' }
    });
  }
});



router.put('/agents/:agentId/config', async (req: Request, res: Response) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) {
      return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });
    }

    const { agentId } = req.params;
    if (agentId !== 'path-agent') {
      return res.status(404).json({ success: false, error: { message: '当前仅支持路径编排器配置' } });
    }

    const config = await savePathAgentInputConfig(req.body || {});
    res.json({ success: true, data: { agentId, config } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message || '保存编排器配置失败', status: 500 } });
  }
});

/**
 * 获取 Agent 执行日志列表
 * GET /api/admin/agents/logs
 */
router.get('/agents/logs', async (req: Request, res: Response) => {
  try {
    const {
      page = 1,
      limit = 20,
      agentName,
      agentId,
      traceId,
      sessionId,
      status,
      sourceEntry,
      keyword,
      timeRange,
      startTime,
      endTime,
      errorCategory
    } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const timeoutErrorSignals = [
      'timeout',
      'timed out',
      'etimedout',
      'deadline exceeded',
      'request timeout',
      'socket hang up'
    ];

    const buildTimeoutCondition = () => ({
      OR: [
        { errorCode: { contains: 'TIMEOUT' } },
        ...timeoutErrorSignals.map(signal => ({ error: { contains: signal } }))
      ]
    });

    const where: any = {
      AND: [] as any[]
    };

    where.AND.push({
      OR: [
        { metadata: null },
        { NOT: { metadata: { contains: '"eventType":"path-generation-stage"' } } }
      ]
    });

    if (agentName) {
      const agentIds = AGENT_NAME_TO_IDS[agentName as string];
      if (agentIds) {
        where.agentId = { in: agentIds };
      } else {
        where.agentId = agentName;
      }
    }

    if (agentId) {
      const requestedAgentId = String(agentId);
      const canonicalAgentId = getCanonicalAgentId(requestedAgentId);
      const manifestEntry = getAgentManifest(canonicalAgentId);
      const candidateIds = Array.from(new Set([
        canonicalAgentId,
        ...(manifestEntry?.aliases || [])
      ]));

      where.agentId = candidateIds.length === 1
        ? candidateIds[0]
        : { in: candidateIds };
    }

    if (traceId) {
      where.AND.push({ traceId: { contains: String(traceId) } });
    }

    if (sessionId) {
      where.AND.push({ metadata: { contains: String(sessionId) } });
    }

    if (sourceEntry) {
      where.sourceEntry = String(sourceEntry);
    }

    if (status) {
      if (status === 'success') {
        where.AND.push({ success: true });
      } else if (status === 'error') {
        where.AND.push({ success: false });
        where.AND.push({ NOT: buildTimeoutCondition() });
      } else if (status === 'timeout') {
        where.AND.push({ success: false });
        where.AND.push(buildTimeoutCondition());
      }
    }

    // 失败归因/异常流跳转：错误类别筛选（列值精确匹配 + 空类别行的启发式归并，
    // 与总览失败归因 classifyFailureCategory 同口径，保证计数 ↔ 列表一致）
    if (errorCategory) {
      const categoryWhere = buildErrorCategoryWhere(String(errorCategory));
      if (categoryWhere) where.AND.push(categoryWhere);
    }

    // 时间范围筛选。精确时间优先，快捷范围作为默认筛选。
    if (startTime || endTime) {
      const calledAt: any = {};
      if (startTime) calledAt.gte = new Date(String(startTime));
      if (endTime) calledAt.lte = new Date(String(endTime));
      where.calledAt = calledAt;
    } else if (timeRange && timeRange !== 'all') {
      const rangeValue = String(timeRange);
      const validTimeRanges = ['today', 'yesterday', 'week', 'month'];
      if (!validTimeRanges.includes(rangeValue)) {
        return res.status(400).json({
          success: false,
          error: {
            message: `非法 timeRange 参数: ${rangeValue}（可选值: ${validTimeRanges.join('/')}/all）`,
            status: 400,
          },
        });
      }
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      
      switch (rangeValue) {
        case 'today':
          where.calledAt = { gte: today };
          break;
        case 'yesterday': {
          const yesterday = new Date(today);
          yesterday.setDate(yesterday.getDate() - 1);
          where.calledAt = { gte: yesterday, lt: today };
          break;
        }
        case 'week': {
          const weekAgo = new Date(today);
          weekAgo.setDate(weekAgo.getDate() - 7);
          where.calledAt = { gte: weekAgo };
          break;
        }
        case 'month': {
          const monthAgo = new Date(today);
          monthAgo.setDate(monthAgo.getDate() - 30);
          where.calledAt = { gte: monthAgo };
          break;
        }
      }
    }

    // 关键词搜索（搜索 input, output, error 字段）
    if (keyword) {
      const searchTerm = String(keyword);
      where.AND.push({
        OR: [
          { input: { contains: searchTerm } },
          { output: { contains: searchTerm } },
          { error: { contains: searchTerm } },
        ]
      });
    }

    if (!where.AND.length) {
      delete where.AND;
    }

    const buildStatusLabel = (log: { success: boolean; errorCode: string | null; error: string | null }) => {
      if (log.success) return 'success';

      const errorCode = String(log.errorCode || '').toLowerCase();
      const errorMessage = String(log.error || '').toLowerCase();
      const isTimeout = timeoutErrorSignals.some(signal =>
        errorCode.includes(signal) || errorMessage.includes(signal)
      );

      return isTimeout ? 'timeout' : 'error';
    };

    const extractSessionIdFromMetadata = (metadata: string | null) => {
      if (!metadata) return null;
      try {
        const parsed = JSON.parse(metadata);
        return parsed?.requestContext?.sessionId || parsed?.sessionId || null;
      } catch {
        return null;
      }
    };

    const extractPathPhaseInfo = (metadata: string | null) => {
      if (!metadata) {
        return {
          phase: null,
          phaseStatus: null,
          pathId: null,
          sourceConversationId: null,
          triggerSource: null
        };
      }

      try {
        const parsed = JSON.parse(metadata);
        return {
          phase: parsed?.phase || null,
          phaseStatus: parsed?.status || null,
          pathId: parsed?.pathId || null,
          sourceConversationId: parsed?.sourceConversationId || null,
          triggerSource: parsed?.triggerSource || null
        };
      } catch {
        return {
          phase: null,
          phaseStatus: null,
          pathId: null,
          sourceConversationId: null,
          triggerSource: null
        };
      }
    };

    const inferExecutionIdentity = (log: {
      agentId: string;
      callerAgent: string | null;
      metadata: string | null;
      executionLayer?: string | null;
      actorType?: string | null;
      actorId?: string | null;
      providerId?: string | null;
      providerType?: string | null;
      routeSource?: string | null;
      model?: string | null;
      statusCode?: number | null;
      attemptCount?: number | null;
      maxAttempts?: number | null;
      finishReason?: string | null;
    }) => {
      const parsed = parseLogMetadata(log.metadata);
      const providerId = log.providerId || (typeof parsed.providerId === 'string' ? parsed.providerId : null);
      const metadataActorType = log.actorType || (typeof parsed.actorType === 'string' ? parsed.actorType : null);
      const metadataActorId = log.actorId || (typeof parsed.actorId === 'string' ? parsed.actorId : null);
      const skillId = typeof parsed.skillId === 'string' ? parsed.skillId : null;
      const agentId = typeof parsed.agentId === 'string' ? parsed.agentId : null;
      const layer = log.executionLayer || (typeof parsed.executionLayer === 'string'
        ? parsed.executionLayer
        : (typeof parsed.layer === 'string' ? parsed.layer : null));

      const providerActorType = providerId?.startsWith('skill:')
        ? 'skill'
        : providerId?.startsWith('agent:')
          ? 'agent'
          : null;
      const providerActorId = providerId?.includes(':') ? providerId.split(':').slice(1).join(':') : null;

      const actorType = metadataActorType
        || (skillId ? 'skill' : null)
        || providerActorType
        || (agentId && agentId !== 'api-gateway' ? 'agent' : null)
        || (log.agentId !== 'api-gateway' ? 'agent' : 'system');

      const actorId = metadataActorId
        || skillId
        || providerActorId
        || agentId
        || log.agentId;

      const executionLayer = layer === 'api-gateway-v2'
        ? 'api-gateway'
        : (layer || (actorType === 'skill' ? 'skill' : actorType === 'agent' ? 'agent' : 'system'));

      const invokerId = typeof parsed.invokerId === 'string'
        ? parsed.invokerId
        : (log.callerAgent || null);
      const invokerType = typeof parsed.invokerType === 'string'
        ? parsed.invokerType
        : (log.callerAgent ? 'agent' : null);

      return {
        parsed,
        executionLayer,
        actorType,
        actorId,
        invokerId,
        invokerType,
        providerId,
        providerType: log.providerType || (typeof parsed.providerType === 'string' ? parsed.providerType : null),
        routeSource: log.routeSource || (typeof parsed.routeSource === 'string' ? parsed.routeSource : null),
        model: log.model || (typeof parsed.model === 'string' ? parsed.model : null),
        statusCode: log.statusCode ?? (typeof parsed.statusCode === 'number' ? parsed.statusCode : null),
        attempts: log.attemptCount ?? (typeof parsed.attempts === 'number' ? parsed.attempts : null),
        maxAttempts: log.maxAttempts ?? (typeof parsed.maxAttempts === 'number'
          ? parsed.maxAttempts
          : (typeof parsed.maxRetries === 'number' ? parsed.maxRetries + 1 : null)),
        messageCount: typeof parsed.messageCount === 'number' ? parsed.messageCount : null,
        finishReason: log.finishReason || (typeof parsed.finishReason === 'string' ? parsed.finishReason : null),
      };
    };

    const [logs, total, successCount, timeoutCount, errorCount, bySourceRows] = await Promise.all([
      // select 裁剪：列表仅消费下列字段（input/output 由详情接口按需拉取，不在列表传输）
      prisma.agent_call_logs.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { calledAt: 'desc' },
        select: {
          id: true,
          agentId: true,
          callerAgent: true,
          sourceEntry: true,
          success: true,
          error: true,
          errorCode: true,
          traceId: true,
          durationMs: true,
          calledAt: true,
          metadata: true,
          executionLayer: true,
          providerId: true,
          providerType: true,
          routeSource: true,
          model: true,
          statusCode: true,
          attemptCount: true,
          maxAttempts: true,
          finishReason: true,
        },
      }),
      prisma.agent_call_logs.count({ where }),
      prisma.agent_call_logs.count({
        where: {
          ...where,
          success: true
        }
      }),
      prisma.agent_call_logs.count({
        where: {
          ...where,
          success: false,
          AND: [
            ...(where.AND || []),
            buildTimeoutCondition()
          ]
        }
      }),
      prisma.agent_call_logs.count({
        where: {
          ...where,
          success: false,
          AND: [
            ...(where.AND || []),
            { NOT: buildTimeoutCondition() }
          ]
        }
      }),
      prisma.agent_call_logs.groupBy({
        by: ['sourceEntry'],
        where,
        _count: { _all: true },
      }),
    ]);

    const bySource = bySourceRows.reduce((acc, row) => {
      acc[row.sourceEntry || 'platform'] = row._count._all;
      return acc;
    }, {} as Record<string, number>);

    // 转换日志格式以兼容前端
    const formattedLogs = logs.map(log => {
      const phaseInfo = extractPathPhaseInfo(log.metadata);
      const identity = inferExecutionIdentity(log);
      return {
        id: log.id,
        agentName: identity.executionLayer === 'api-gateway'
          ? `API 网关 · ${identity.actorId}`
          : (AGENT_ID_TO_NAME[log.agentId] || log.agentId),
        agentId: log.agentId,
        sourceEntry: log.sourceEntry || 'platform',
        callerAgent: log.callerAgent,
        action: 'invoke',
        status: buildStatusLabel(log),
        // input/output 不再随列表传输（详情接口 /agents/logs/:id 按需拉取）
        error: log.error,
        errorCode: log.errorCode,
        traceId: log.traceId,
        sessionId: extractSessionIdFromMetadata(log.metadata),
        durationMs: log.durationMs,
        createdAt: log.calledAt,
        metadata: log.metadata,
        executionLayer: identity.executionLayer,
        actorType: identity.actorType,
        actorId: identity.actorId,
        invokerId: identity.invokerId,
        invokerType: identity.invokerType,
        providerId: identity.providerId,
        providerType: identity.providerType,
        routeSource: identity.routeSource,
        model: identity.model,
        statusCode: identity.statusCode,
        attempts: identity.attempts,
        maxAttempts: identity.maxAttempts,
        recoveredByRetry: Boolean(log.success && (identity.attempts || 0) > 1),
        messageCount: identity.messageCount,
        finishReason: identity.finishReason,
        phase: phaseInfo.phase,
        phaseStatus: phaseInfo.phaseStatus,
        pathId: phaseInfo.pathId,
        sourceConversationId: phaseInfo.sourceConversationId,
        triggerSource: phaseInfo.triggerSource,
      };
    });

    res.json({
      success: true,
      data: {
        logs: formattedLogs,
        stats: {
          total,
          success: successCount,
          timeout: timeoutCount,
          error: errorCount,
          bySource
        },
        pagination: {
          total,
          page: Number(page),
          limit: Number(limit),
        },
      },
    });
  } catch (error: any) {
    logger.error('[admin-platform] 获取 Agent 日志失败', { error });
    res.status(500).json({
      success: false,
      error: {
        message: '获取 Agent 日志失败',
        status: 500,
      },
    });
  }
});

router.get('/settings/reliability', async (req: Request, res: Response) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) {
      return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });
    }
    const settings = await getPlatformReliabilitySettings();
    res.json({ success: true, data: { settings, hardLimits: getReliabilityHardLimits() } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message || '获取 AI 可靠性设置失败' } });
  }
});

router.put('/settings/reliability', async (req: Request, res: Response) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) {
      return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });
    }
    const input = req.body || {};
    const integerFields = [
      'maxUpstreamAttempts',
      'maxTransportRetries',
      'maxLogicalRetries',
      'defaultRequestTimeoutMs',
      'retryBaseDelayMs',
      'maxRetryAfterMs'
    ];
    for (const field of integerFields) {
      if (!Number.isInteger(input[field])) {
        return res.status(400).json({ success: false, error: { message: `${field} 必须是整数` } });
      }
    }
    if (typeof input.jitterEnabled !== 'boolean') {
      return res.status(400).json({ success: false, error: { message: 'jitterEnabled 必须是布尔值' } });
    }
    const limits = getReliabilityHardLimits();
    const ranges: Record<string, [number, number]> = {
      maxUpstreamAttempts: [1, limits.maxUpstreamAttempts],
      maxTransportRetries: [0, limits.maxTransportRetries],
      maxLogicalRetries: [0, limits.maxLogicalRetries],
      defaultRequestTimeoutMs: [limits.minRequestTimeoutMs, limits.maxRequestTimeoutMs],
      retryBaseDelayMs: [limits.minRetryBaseDelayMs, limits.maxRetryBaseDelayMs],
      maxRetryAfterMs: [0, limits.maxRetryAfterMs]
    };
    for (const [field, [min, max]] of Object.entries(ranges)) {
      if (input[field] < min || input[field] > max) {
        return res.status(400).json({
          success: false,
          error: { message: `${field} 必须在 ${min} 到 ${max} 之间` }
        });
      }
    }
    const settings = await updatePlatformReliabilitySettings(input);
    res.json({ success: true, data: { settings, hardLimits: getReliabilityHardLimits() } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message || '更新 AI 可靠性设置失败' } });
  }
});

router.get('/settings/capability-probe', async (req: Request, res: Response) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) {
      return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });
    }
    const [enabled, intervalMs] = await Promise.all([
      getPlatformCapabilityProbeEnabled(),
      getPlatformCapabilityProbeInterval()
    ]);
    res.json({
      success: true,
      data: {
        enabled,
        intervalMs,
        defaultEnabled: DEFAULT_CAPABILITY_PROBE_ENABLED,
        defaultIntervalMs: DEFAULT_CAPABILITY_PROBE_INTERVAL_MS,
        minIntervalMs: MIN_CAPABILITY_PROBE_INTERVAL_MS,
        maxIntervalMs: MAX_CAPABILITY_PROBE_INTERVAL_MS,
        timerActive: aiCapabilityHealthService.isEnabled()
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message || '获取 AI 能力探测设置失败' } });
  }
});

router.put('/settings/capability-probe', async (req: Request, res: Response) => {
  try {
    const allowed = await ensureAdmin(req.user?.userId);
    if (!allowed) {
      return res.status(403).json({ success: false, error: { message: '需要管理员权限' } });
    }
    const { enabled, intervalMs } = req.body || {};
    if (enabled !== undefined && typeof enabled !== 'boolean') {
      return res.status(400).json({ success: false, error: { message: 'enabled 必须是布尔值' } });
    }
    if (intervalMs !== undefined) {
      const n = Number(intervalMs);
      if (!Number.isFinite(n) || !Number.isInteger(n)
        || n < MIN_CAPABILITY_PROBE_INTERVAL_MS || n > MAX_CAPABILITY_PROBE_INTERVAL_MS) {
        return res.status(400).json({
          success: false,
          error: {
            message: `intervalMs 必须是 ${MIN_CAPABILITY_PROBE_INTERVAL_MS}～${MAX_CAPABILITY_PROBE_INTERVAL_MS} 之间的整数毫秒`
          }
        });
      }
    }
    if (enabled === undefined && intervalMs === undefined) {
      return res.status(400).json({ success: false, error: { message: '请至少提供 enabled 或 intervalMs' } });
    }

    let nextEnabled = await getPlatformCapabilityProbeEnabled();
    let nextInterval = await getPlatformCapabilityProbeInterval();
    if (typeof enabled === 'boolean') {
      nextEnabled = await updatePlatformCapabilityProbeEnabled(enabled);
    }
    if (intervalMs !== undefined) {
      nextInterval = await updatePlatformCapabilityProbeInterval(intervalMs);
      await aiCapabilityHealthService.setIntervalMs(nextInterval);
    }
    if (typeof enabled === 'boolean') {
      await aiCapabilityHealthService.setEnabled(nextEnabled);
    }

    const intervalSec = Math.round(nextInterval / 1000);
    res.json({
      success: true,
      data: {
        enabled: nextEnabled,
        intervalMs: nextInterval,
        defaultEnabled: DEFAULT_CAPABILITY_PROBE_ENABLED,
        defaultIntervalMs: DEFAULT_CAPABILITY_PROBE_INTERVAL_MS,
        minIntervalMs: MIN_CAPABILITY_PROBE_INTERVAL_MS,
        maxIntervalMs: MAX_CAPABILITY_PROBE_INTERVAL_MS,
        timerActive: aiCapabilityHealthService.isEnabled()
      },
      message: nextEnabled
        ? `AI 能力探测已开启，将每 ${intervalSec} 秒自动向模型服务发送探活请求`
        : 'AI 能力探测已关闭，将停止周期性 LLM 探活请求'
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message || '更新 AI 能力探测设置失败' } });
  }
});

/**
 * 获取单条执行日志及 Provider Attempt 时间线
 * GET /api/admin/agents/logs/:id
 */
router.get('/agents/logs/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '').trim();
    const log = await prisma.agent_call_logs.findUnique({ where: { id } });
    if (!log) {
      return res.status(404).json({ success: false, error: { message: '执行日志不存在', status: 404 } });
    }

    const attempts = await prisma.llm_execution_attempts.findMany({
      where: log.executionLayer === 'api-gateway'
        ? { llmRequestId: id }
        : {
            OR: [
              { parentExecutionId: id },
              { rootExecutionId: id }
            ]
          },
      orderBy: [{ startedAt: 'asc' }, { transportAttemptNo: 'asc' }],
      take: 200
    });
    const logMetadata = parseLogMetadata(log.metadata);
    const attemptTelemetryComplete = logMetadata.attemptTelemetryComplete !== false;
    // 服务端截断 input/output（各 ≤4KB + truncated 标记），避免全量传输；前端 live.ts 已有 4000 字符兜底截断
    const inputInfo = truncateLogPayload(log.input);
    const outputInfo = truncateLogPayload(log.output);

    res.json({
      success: true,
      data: {
        log: {
          ...log,
          input: inputInfo.value,
          output: outputInfo.value,
          inputTruncated: inputInfo.truncated,
          outputTruncated: outputInfo.truncated,
          dataCompleteness: attempts.length > 0
            ? 'full'
            : log.executionLayer === 'api-gateway' && log.attemptCount === 0
              ? 'preflight'
              : log.executionLayer === 'api-gateway' && !attemptTelemetryComplete
                ? 'telemetry_failed'
                : log.executionLayer === 'skill'
                  ? 'none'
              : 'legacy'
        },
        attempts: attempts.map((attempt) => ({
          id: attempt.id,
          llmRequestId: attempt.llmRequestId,
          promptCallId: attempt.promptCallId,
          promptAttemptNo: attempt.promptAttemptNo,
          transportAttemptNo: attempt.transportAttemptNo,
          maxAttempts: attempt.maxAttempts,
          providerId: attempt.providerId,
          providerType: attempt.providerType,
          routeSource: attempt.routeSource,
          requestedModel: attempt.requestedModel,
          resolvedModel: attempt.resolvedModel,
          responseModel: attempt.responseModel,
          endpointHost: attempt.endpointHost,
          success: attempt.success,
          retryable: attempt.retryable,
          willRetry: attempt.willRetry,
          statusCode: attempt.statusCode,
          errorCategory: attempt.errorCategory,
          errorCode: attempt.errorCode,
          errorMessage: attempt.errorMessage,
          startedAt: attempt.startedAt,
          completedAt: attempt.completedAt,
          durationMs: attempt.durationMs,
          backoffMs: attempt.backoffMs,
          retryAfterMs: attempt.retryAfterMs,
          configuredTimeoutMs: attempt.configuredTimeoutMs,
          effectiveTimeoutMs: attempt.effectiveTimeoutMs,
          promptTokens: attempt.promptTokens,
          completionTokens: attempt.completionTokens,
          totalTokens: attempt.totalTokens,
          finishReason: attempt.finishReason,
          completionId: attempt.completionId,
          providerRequestId: attempt.providerRequestId,
          // KV 前缀缓存可观测（2026-08）：TTFT 与缓存命中透出
          ttftMs: attempt.ttftMs ?? null,
          promptCacheHitTokens: attempt.promptCacheHitTokens ?? null,
          promptCacheMissTokens: attempt.promptCacheMissTokens ?? null
        }))
      }
    });
  } catch (error) {
    logger.error('[admin-platform] 获取执行日志详情失败', { error });
    res.status(500).json({ success: false, error: { message: '获取执行日志详情失败', status: 500 } });
  }
});


/**
 * GET /api/admin/activity
 * 获取最近活动日志
 * 服务端缓存：45s TTL；key 含 excludeTest 与 limit（同概览统计，见 OVERVIEW_CACHE_TTL_MS）。
 */
router.get('/activity', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    // excludeTest=1 时过滤虚拟学习者与测试/审计账号（合成流量）
    const excludeTest = String(req.query.excludeTest || '') === '1';
    const cacheKey = `activity:${excludeTest ? 1 : 0}:${limit}`;
    const cached = overviewStatsCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < OVERVIEW_CACHE_TTL_MS) {
      return res.json({ success: true, data: cached.payload });
    }
    const ACTIVITY_USER_WHERE = excludeTest
      ? REAL_USER_WHERE
      : { isVirtualLearner: false };
    // 动态时间窗：仅近 24h（前端卡片标注「近 24h」；7 天前旧条目不再混入）
    const activityWindowStart = new Date(Date.now() - 24 * 3600000);

    // 最近的学习会话
    const recentSessions = await prisma.teaching_sessions.findMany({
      take: limit,
      orderBy: { startTime: 'desc' },
      where: {
        users: ACTIVITY_USER_WHERE,
        startTime: { gte: activityWindowStart },
      },
      include: {
        users: {
          select: { id: true, email: true, name: true }
        }
      }
    });

    const sessionTaskIds = Array.from(new Set(recentSessions.map((session) => session.taskId).filter(Boolean)));
    const sessionTasks = sessionTaskIds.length > 0
      ? await prisma.subtasks.findMany({
          where: { id: { in: sessionTaskIds } },
          select: { id: true, title: true },
        })
      : [];
    const sessionTaskMap = new Map(sessionTasks.map((task) => [task.id, task]));

    // 最近注册的用户（excludeTest 时排除虚拟学习者/测试账号；软删账号一律隐藏）
    const recentUsers = await prisma.users.findMany({
      take: 20,
      orderBy: { createdAt: 'desc' },
      where: {
        ...(excludeTest ? REAL_USER_WHERE : { deletedAt: null }),
        createdAt: { gte: activityWindowStart },
      },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true
      }
    });

    // 最近完成的任务（excludeTest 时排除虚拟学习者/测试账号）
    const completedTasks = await prisma.subtasks.findMany({
      take: 20,
      where: {
        status: 'completed',
        users: ACTIVITY_USER_WHERE,
        completedAt: { gte: activityWindowStart },
      },
      orderBy: { completedAt: 'desc' },
      include: {
        users: {
          select: { id: true, email: true, name: true }
        }
      }
    });

    // 近 24h 失败事件（异常流：动态 feed 的 bad/warn 事件源，含类别/错误码供跳转筛选）
    const recentFailures = await prisma.agent_call_logs.findMany({
      take: 10,
      where: { calledAt: { gte: activityWindowStart }, success: false },
      orderBy: { calledAt: 'desc' },
      select: {
        id: true,
        agentId: true,
        executionLayer: true,
        errorCode: true,
        errorCategory: true,
        error: true,
        calledAt: true,
        statusCode: true,
      },
    });

    const [recentProjectionGrantUses, activeProjectionGrantCount] = await Promise.all([
      prisma.projection_access_grants.findMany({
        take: 20,
        where: {
          lastUsedAt: { not: null }
        },
        orderBy: { lastUsedAt: 'desc' },
        include: {
          users: {
            select: { id: true, email: true, name: true }
          }
        }
      }),
      prisma.projection_access_grants.count({
        where: {
          revokedAt: null,
          expiresAt: { gt: new Date() }
        }
      })
    ]);

    const adminIds = Array.from(new Set(
      recentProjectionGrantUses
        .map((grant) => grant.lastUsedByAdminId)
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    ));

    const adminUsers = adminIds.length > 0
      ? await prisma.users.findMany({
          where: { id: { in: adminIds } },
          select: { id: true, email: true, name: true }
        })
      : [];
    const adminUserMap = new Map(adminUsers.map((user) => [user.id, user]));

    const data = {
        recentSessions: recentSessions.map((session) => ({
          ...session,
          user: session.users
            ? {
                id: session.users.id,
                email: session.users.email,
                name: session.users.name,
              }
            : null,
          task: sessionTaskMap.get(session.taskId)
            ? {
                id: session.taskId,
                title: sessionTaskMap.get(session.taskId)?.title,
              }
            : null,
        })),
        recentUsers,
        completedTasks,
        recentFailures: recentFailures.map((log) => ({
          id: log.id,
          agentId: log.agentId,
          executionLayer: log.executionLayer,
          errorCode: log.errorCode,
          // 归一到归因同款类别（空类别行启发式归并），保证跳转筛选计数一致
          errorCategory: classifyFailureCategory({
            errorCategory: log.errorCategory,
            errorCode: log.errorCode,
            error: log.error,
          }),
          error: log.error,
          calledAt: log.calledAt,
          statusCode: log.statusCode,
        })),
        activeProjectionGrantCount,
        recentProjectionGrantUses: recentProjectionGrantUses.map((grant) => ({
          id: grant.id,
          scope: grant.scope,
          purpose: grant.purpose || null,
          expiresAt: grant.expiresAt,
          revokedAt: grant.revokedAt,
          useCount: grant.useCount,
          lastUsedAt: grant.lastUsedAt,
          user: grant.users
            ? {
                id: grant.users.id,
                email: grant.users.email,
                name: grant.users.name,
              }
            : null,
          adminUser: grant.lastUsedByAdminId
            ? (() => {
                const adminUser = adminUserMap.get(grant.lastUsedByAdminId)
                return adminUser
                  ? {
                      id: adminUser.id,
                      email: adminUser.email,
                      name: adminUser.name,
                    }
                  : {
                      id: grant.lastUsedByAdminId,
                      email: null,
                      name: '管理员'
                    }
              })()
            : null,
        }))
    };
    overviewStatsCache.set(cacheKey, { payload: data, cachedAt: Date.now() });
    res.json({ success: true, data });
  } catch (error: any) {
    logger.error('[admin-platform] 获取活动日志失败', { error });
    res.status(500).json({
      success: false,
      error: {
        message: '获取活动日志失败',
        status: 500
      }
    });
  }
});

/**
 * GET /api/admin/teaching-sessions
 * 教学会话调试视图：聚焦 wrapup / advisory
 * 列表进度（遗留项「教学会话进度列」）：progress = 任务 x/y + 里程碑 n/m（milestones/subtasks 现表推导）
 */
function parseJsonSafe<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

router.get('/teaching-sessions', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string) || 20));
    const userId = (req.query.userId as string) || undefined;
    const status = (req.query.status as string) || undefined;
    const onlyWithAdvisory = String(req.query.onlyWithAdvisory || '') === 'true';
    const onlyMissingWrapup = String(req.query.onlyMissingWrapup || '') === 'true';

    const where: any = {
      ...(userId ? { userId } : {}),
      ...(status ? { status } : {}),
      ...(onlyWithAdvisory ? { advisory: { not: null } } : {}),
      // wrapup 为 JSON 文本列：缺失 = 无记录或内容中不含 topicSummary
      ...(onlyMissingWrapup
        ? { OR: [{ wrapup: null }, { NOT: { wrapup: { contains: 'topicSummary' } } }] }
        : {}),
    };

    const [total, sessions] = await Promise.all([
      prisma.teaching_sessions.count({ where }),
      prisma.teaching_sessions.findMany({
        where,
        orderBy: { startTime: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          users: {
            select: { id: true, name: true, email: true }
          }
        }
      })
    ]);

    const progressById = await deriveTeachingSessionProgress(sessions);

    const items = sessions.map((session) => {
      const wrapup = parseJsonSafe<any>(session.wrapup, null);
      const advisory = parseJsonSafe<any>(session.advisory, null);
      const messages = parseJsonSafe<any[]>(session.messages, []);
      const knowledgePoints = parseJsonSafe<any[]>(session.knowledgeState, []);

      return {
        id: session.id,
        userId: session.userId,
        userName: session.users?.name || null,
        email: session.users?.email || null,
        taskId: session.taskId,
        learningPathId: session.learningPathId,
        milestoneId: session.milestoneId,
        subject: session.subject,
        topic: session.topic,
        taskType: session.taskType,
        status: session.status,
        startTime: session.startTime,
        endTime: session.endTime,
        duration: session.duration,
        messageCount: Array.isArray(messages) ? messages.filter((m: any) => m?.role === 'user').length : 0,
        knowledgePointCount: Array.isArray(knowledgePoints) ? knowledgePoints.length : 0,
        progress: progressById.get(session.id) || null,
        wrapup,
        advisory,
      };
    });

    res.json({
      success: true,
      data: {
        page,
        limit,
        total,
        items,
      }
    });
  } catch (error: any) {
    logger.error('[admin-platform] 获取教学会话调试数据失败', { error });
    res.status(500).json({
      success: false,
      error: {
        message: '获取教学会话调试数据失败',
        status: 500
      }
    });
  }
});

/**
 * 获取学生状态基线
 * GET /platform/student-state
 */

export default router;
