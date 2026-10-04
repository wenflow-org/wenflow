import express, { Request, Response } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { getPlatformSettings, updatePlatformSettings } from '../../services/platform-settings.service';
import { startOfDay } from '../../services/time/day-boundary';
import {
  getAgentManifest,
  getCanonicalAgentId,
  getMonitoringGroupMappings,
  getAgentRelations,
  isManifestAgent
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
, isFallbackEffectivelyDisabled } from '../../services/reliability-settings.service';
import { applyRpmLimitsFromSettings } from '../../services/rpm-limit-config.service';
import { telemetryWriter } from '../../services/telemetry-writer.service';
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
import { checkIsAdmin } from '../../services/admin-access.service';
import {
  timeoutErrorSignals,
  buildErrorCategoryWhere,
  buildTimeoutCondition
} from '../../services/admin/failure-classification';
import { computeOverviewStats, clearOverviewAllTimeCache } from '../../services/admin/platform-overview.service';
import { collectManifestDiagnostics } from '../../services/admin/platform-manifest-diagnostics.service';
import { fetchAgentLogPage, fetchAgentLogWithAttempts } from '../../services/admin/platform-agent-logs.service';
import { getPlatformActivityFeed } from '../../services/admin/platform-activity.service';
import { listTeachingSessionsDebug } from '../../services/admin/platform-teaching-sessions.service';

// 兼容 re-export：实现已下沉 service 层，单测/既有引用仍从本模块导入。
export { classifyFailureCategory, buildErrorCategoryWhere } from '../../services/admin/failure-classification';
export { buildHourlyTrend } from '../../services/admin/platform-overview.service';
export type { HourlyTrendBucket } from '../../services/admin/platform-overview.service';

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

const inferRuntimeRole = (agentId: string, type?: string | null) => {
  const typeText = String(type || '').toLowerCase();
  if (agentId.startsWith('skill:')) return 'skill';
  if (isManifestAgent(agentId)) return 'agent';
  if (typeText.includes('skill')) return 'skill';
  if (typeText.includes('agent')) return 'agent';
  if (agentId.endsWith('-agent')) return 'agent';
  return 'skill';
};

const ensureAdmin = checkIsAdmin;

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

    const { registrationEnabled, registerIpQuotaEnabled, registerIpDailyQuota } = req.body;
    if (registrationEnabled !== undefined && typeof registrationEnabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: { message: 'registrationEnabled 必须是布尔值', status: 400 }
      });
    }
    if (registerIpQuotaEnabled !== undefined && typeof registerIpQuotaEnabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: { message: 'registerIpQuotaEnabled 必须是布尔值', status: 400 }
      });
    }
    if (registerIpDailyQuota !== undefined) {
      const quota = Number(registerIpDailyQuota);
      if (!Number.isInteger(quota) || quota < 0 || quota > 100) {
        return res.status(400).json({
          success: false,
          error: { message: 'registerIpDailyQuota 必须是 0-100 的整数', status: 400 }
        });
      }
    }

    const settings = await updatePlatformSettings({
      registrationEnabled,
      registerIpQuotaEnabled,
      registerIpDailyQuota
    });
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

    const data = await collectManifestDiagnostics();

    res.json({
      success: true,
      data
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
 * 返回 5 顶层 Agent + 下辖 Skill 的节点图数据（纯定义视图）：
 *   - nodes: 5 Agent + N Skill（含生效模型配置，不带调用统计）
 *   - edges: Agent -> Skill 隶属关系
 *   - summary: { agentCount, skillCount, range }
 *
 * 2026-09-28 拆除调用次数统计层（原 Q9：节点 stats / 隶属边用量 / 字段命中率，
 * 聚合 prompt_call_logs 实测 9s+）：调用量不是编排图的判读对象，用量看执行日志 / 成本分析。
 * 聚合实现保留在 services/topology/*（audit-handoff-edges 等 CLI 仍用），本路由不再调用。
 * ?range= 兼容保留（旧前端仍会带），仅参与缓存 key 与 summary 回显，不再影响返回内容。
 */

/**
 * 获取平台概览数据
 * GET /api/admin/overview/stats
 *
 * 服务端缓存：60s TTL + 在途请求去重。单次全量聚合 20+ 条统计查询，1.7GB 库实测 4-5s，
 * 不缓存时每次进入概览页都要付一次全款；仪表盘统计对 ≤60s 陈旧可接受，故取 60s 换取命中窗口。
 * 去重：缓存失效窗口内的并发请求共享同一次在途计算（同一 Promise），不会叠加 DB 压力。
 * 失效语义：计算失败不写缓存且摘除在途句柄，下一次请求立即重算；无主动失效，
 * 仅等 TTL 自然过期。绕过：?fresh=1 跳过缓存与去重直接重算（结果仍写回缓存）。
 * /overview/stats 无业务查询参数，使用固定 key（fresh 仅作绕过开关，不参与 key）；
 * /activity 的 key 含 excludeTest 与 limit。
 */
/* 2026-10-01 性能批次：stats 缓存 60s→5min。背景：overview/stats 重算实测 21s
   （agent_call_logs 的 8 次独立扫描——trend7d/last24h/topSkills/bySource——全打在
   12 万行的同一张表上；数据增长后从文档口径 4-5s 恶化），60s 边界会让每页的
   boot 都周期性撞上 21s 重算并堵死整条请求队列。admin 统计页 5min 口径延迟
   可接受（与 token-cost 300s 同先例）；8 次扫描合一的根治另行批次。
   activity（动态流，标注「实时」）拆出独立短 TTL，不受本调整影响。 */
const OVERVIEW_STATS_TTL_MS = 300 * 1000;
const ACTIVITY_CACHE_TTL_MS = 60 * 1000;
const overviewStatsCache = new Map<string, { payload: unknown; cachedAt: number }>();
/** 在途计算去重：key → 未落地的计算 Promise（与缓存共用 key 空间，仅 overview/stats 写入） */
const overviewStatsInflight = new Map<string, Promise<unknown>>();

/** 拓扑接口缓存（按 range 分 key；45s TTL，负载与概览同量级但刷新要求更高，独立口径） */
const TOPOLOGY_CACHE_TTL_MS = 45 * 1000;
const topologyCache = new Map<string, { payload: unknown; cachedAt: number }>();

/** 测试辅助：清空概览/动态缓存与在途句柄（60s TTL 会跨用例复用，污染路由级断言）。
   * 全量累计子缓存（10min TTL，服务层）一并清：否则路由级用例间会复用上一用例的累计口径 */
export function clearOverviewStatsCache(): void {
  overviewStatsCache.clear();
  overviewStatsInflight.clear();
  clearOverviewAllTimeCache();
}

/** 预热/后台刷新（schedulers 装配调用）：把总览重算成本搬离用户请求路径。
 *  按 4 分钟节奏刷新（< 5min 主 TTL）→ 请求恒命中缓存；内部同时填服务层两个长缓存子层。
 *  失败静默（调用方 runBackgroundTask 记账），请求路径仍会按需重算，无功能依赖。 */
export async function warmOverviewStatsCache(): Promise<void> {
  const data = await computeOverviewStats(false);
  overviewStatsCache.set('overview-stats', { payload: data, cachedAt: Date.now() });
}

router.get('/overview/stats', async (req: Request, res: Response) => {
  try {
    const cacheKey = 'overview-stats';
    const wantsFresh = req.query?.fresh === '1';
    if (!wantsFresh) {
      const cached = overviewStatsCache.get(cacheKey);
      if (cached && Date.now() - cached.cachedAt < OVERVIEW_STATS_TTL_MS) {
        return res.json({ success: true, data: cached.payload });
      }
      // 在途去重：已有同 key 计算未落地时直接共享其结果，不再发起第二次聚合
      const inflight = overviewStatsInflight.get(cacheKey);
      if (inflight) {
        return res.json({ success: true, data: await inflight });
      }
    }
    const computation = computeOverviewStats(wantsFresh)
      .then((data) => {
        overviewStatsCache.set(cacheKey, { payload: data, cachedAt: Date.now() });
        return data;
      })
      .finally(() => {
        // 成败都摘除在途句柄：失败不缓存，下一请求直接重算（identity 比对防误删并发 fresh 计算的句柄）
        if (overviewStatsInflight.get(cacheKey) === computation) {
          overviewStatsInflight.delete(cacheKey);
        }
      });
    overviewStatsInflight.set(cacheKey, computation);
    const data = await computation;
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

    /* 拓扑聚合是后台最重的接口之一（range=all 全历史 groupBy + 字段命中率计算，
       实测 9s+；编排页还可能短时间重复进入）——按 range 缓存 45s，口径与
       overview/stats 的缓存模式一致。 */
    const topoCacheKey = `topology:${statsRange}`;
    const topoCached = topologyCache.get(topoCacheKey);
    if (topoCached && Date.now() - topoCached.cachedAt < TOPOLOGY_CACHE_TTL_MS) {
      return res.json({ success: true, data: topoCached.payload });
    }

    const { listTopLevelAgents, listAgentManifest, getCanonicalAgentId } = await import('../../services/agent-manifest.service');
    const { resolveEffectiveSkillRuntimeConfig } = await import('../../services/skill-runtime-contract.service');
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

    const nodes: any[] = [];
    const edges: any[] = [];
    const effectiveConfigCache = new Map<string, any>();

    /* 生效运行配置并行预解析（原在成员循环内串行 await，几十个 Skill 串成秒级；
       失败的条目留空 → 循环内回落 manifest 默认，与原行为一致） */
    await Promise.all(
      [...new Set(skillIds)].map(async (shortId) => {
        try {
          effectiveConfigCache.set(shortId, await resolveEffectiveSkillRuntimeConfig(shortId));
        } catch {
          // keep manifest default as last resort
        }
      })
    );

    for (const agent of topAgents) {
      nodes.push({
        id: agent.id,
        type: 'agent',
        label: agent.name,
        description: agent.description,
        monitoringGroup: agent.monitoringGroup,
        memberCount: (agent.agentMembers || []).length
      });

      for (const memberId of agent.agentMembers || []) {
        const canonical = getCanonicalAgentId(memberId);
        const skill = manifestMap.get(canonical);
        if (!skill) continue;

        const shortId = canonical.replace(/^skill:/, '');

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
          modelConfig
        });

        edges.push({
          id: `${agent.id}__${skill.id}`,
          source: agent.id,
          target: skill.id,
          type: 'membership'
        });
      }
    }

    /* 2026-09-28：调用次数统计整层拆除（总调用 / 成功率 / agent→skill 边用量 / 字段命中率）。
       依据：range=all 全历史 groupBy + 字段命中率 payload 解析实测 9s+，是编排页最重的一笔；
       而调用量本身不是编排图的判读对象（健康与用量在执行日志 / 成本分析有更对口的口径）。
       拓扑回归纯定义视图：Agent/Skill 清单 + 隶属边 + 生效模型配置。
       聚合实现保留在 services/topology/*（audit-handoff-edges 等 CLI 仍在用），只是本路由不再调。 */

    const summary = {
      agentCount: topAgents.length,
      skillCount: nodes.filter(n => n.type === 'skill').length,
      range
    };

    res.json({
      success: true,
      data: { nodes, edges, summary }
    });
    topologyCache.set(topoCacheKey, { payload: { nodes, edges, summary }, cachedAt: Date.now() });
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
    /* 分页参数校验（UI 复查实测：page=abc / limit=abc / page=-1 会让 Prisma 收到 NaN/-1 直接 500）。
       与 learning-content 路由同一范式：夹到合法范围，绝不把 NaN 传进 Prisma。 */
    const pageNum = Math.max(1, Math.floor(Number(page)) || 1);
    const limitNum = Math.min(200, Math.max(1, Math.floor(Number(limit)) || 20));
    const skip = (pageNum - 1) * limitNum;

    /* 服务端排序：白名单 + 方向校验（非法 400，与 timeRange 一致）。
       只暴露 agent_call_logs 自身列——token 列不参与：前端「输入 / 输出」是同 trace
       网关行合并后的口径，与本表单行不一致，服务端排序会误导。
       并列时以「时间倒序 + id」为稳定次级键，保证翻页不重不漏。 */
    const LOG_SORT_FIELDS = ['calledAt', 'durationMs'] as const;
    const sortRaw = req.query.sort === undefined ? 'calledAt' : String(req.query.sort);
    if (!(LOG_SORT_FIELDS as readonly string[]).includes(sortRaw)) {
      return res.status(400).json({
        success: false,
        error: { message: `非法 sort 参数: ${sortRaw}（可选值: ${LOG_SORT_FIELDS.join('/')}）`, status: 400 },
      });
    }
    const orderRaw = req.query.order === undefined ? 'desc' : String(req.query.order);
    if (orderRaw !== 'asc' && orderRaw !== 'desc') {
      return res.status(400).json({
        success: false,
        error: { message: `非法 order 参数: ${orderRaw}（可选值: asc/desc）`, status: 400 },
      });
    }
    const logOrderBy: any = sortRaw === 'calledAt'
      ? [{ calledAt: orderRaw }, { id: 'desc' }]
      : [{ [sortRaw]: orderRaw }, { calledAt: 'desc' }, { id: 'desc' }];


    const where: any = {
      AND: [] as any[]
    };

    /* stage 事件排除（2026-10-04 性能）：原用 metadata NOT LIKE '%"eventType":"path-generation-stage"%'
       过滤，需对窗口内全行读大文本列（冷缓存 27s/24 万行级）。实测双向等价（当天全库：
       agentId='path-agent' 的 4952 行 100% 是 stage 事件；非 path-agent 行 0 行带该元数据）→
       改写为列过滤走 agentId 索引，不再触碰 metadata。
       维护注意：若未来新增阶段事件的发射者/复用方，需同步本判据（stage 事件的写入方=path-agent）。 */
    where.AND.push({ NOT: { agentId: 'path-agent' } });

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
    } else {
      // 默认排除系统金丝雀探针流量（自检超时/中断会污染待办与失败列表）；
      // 显式按 sourceEntry 筛选时保留，便于排查探针本身。
      // 注意：sourceEntry 非空（String @default("platform")），不能用 { sourceEntry: null } 过滤（Prisma 校验会报错）。
      where.AND.push({ sourceEntry: { not: 'system-canary' } });
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
      const today = startOfDay(new Date());

      switch (rangeValue) {
        case 'today':
          where.calledAt = { gte: today };
          break;
        case 'yesterday': {
          const yesterday = new Date(today.getTime() - 86400000);
          where.calledAt = { gte: yesterday, lt: today };
          break;
        }
        case 'week': {
          const weekAgo = new Date(today.getTime() - 7 * 86400000);
          where.calledAt = { gte: weekAgo };
          break;
        }
        case 'month': {
          const monthAgo = new Date(today.getTime() - 30 * 86400000);
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

    /* 测试（金丝雀）日志计数：默认视图已排除 canary 行，前端「测试 N」入口从结果里
       数不到——用「同筛选、仅 system-canary」的 where 顺带 count（放在全部过滤条件
       组装完之后，保证入口计数与「仅看测试」视图条数对得上）。浅拷贝保留 where 里 Date 引用。 */
    let canaryWhere: any = null;
    if (!sourceEntry && Array.isArray(where.AND)) {
      canaryWhere = {
        ...where,
        AND: (where.AND as any[]).map((clause) =>
          clause?.sourceEntry?.not === 'system-canary' ? { sourceEntry: 'system-canary' } : clause
        ),
      };
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

    const [logs, total, successCount, timeoutCount, errorCount, bySourceRows, canaryCount] = await fetchAgentLogPage({
      where,
      skip,
      limitNum,
      logOrderBy,
      canaryWhere,
    });

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
        promptTokens: log.promptTokens,
        completionTokens: log.completionTokens,
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
          bySource,
          // 测试（金丝雀）日志计数（默认视图排除 canary，行内数不到；驱动前端「测试 N」入口）
          canary: canaryCount,
        },
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
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
    // 降级有效性派生值:当前重试配置下 fallback 是否永不触发(executor 降级守卫语义)
    const fallbackDisabled = isFallbackEffectivelyDisabled(settings.maxUpstreamAttempts, settings.maxTransportRetries);
    res.json({
      success: true,
      data: {
        settings,
        hardLimits: getReliabilityHardLimits(),
        // 遥测丢弃计数：prompt_call_logs / agent_call_logs 是后台写（仅 warn 不报错），
        // 缺行此前无法与「调用没发生」区分——此处给出进程内累计，供审计侧证伪。
        telemetry: telemetryWriter.getDropStats(),
        derived: {
          fallbackDisabled,
          ...(fallbackDisabled
            ? { reason: '降级要求「1 + 传输重试 < 上游最大尝试」,当前配置下模型降级永远不会触发' }
            : {})
        }
      }
    });
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
      'maxRetryAfterMs',
      'platformRpmLimit'
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
      maxRetryAfterMs: [0, limits.maxRetryAfterMs],
      platformRpmLimit: [0, 100_000]
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
    await applyRpmLimitsFromSettings().catch(() => undefined);
    // 配置可保存,但若会使降级永不触发,必须显式告警而非静默(前端 reliability PUT 响应展示)
    const fallbackDisabled = isFallbackEffectivelyDisabled(settings.maxUpstreamAttempts, settings.maxTransportRetries);
    const warnings = fallbackDisabled
      ? ['当前「上游最大尝试 / 传输重试」组合下,模型降级永远不会触发(要求 1 + 传输重试 < 上游最大尝试)。如需保留降级能力请调整后重新保存。']
      : [];
    if (fallbackDisabled) {
      logger.warn('[admin-platform] 可靠性配置使模型降级失效', { ...settings });
    }
    res.json({ success: true, data: { settings, hardLimits: getReliabilityHardLimits(), warnings } });
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
    const detail = await fetchAgentLogWithAttempts(id);
    if (!detail) {
      return res.status(404).json({ success: false, error: { message: '执行日志不存在', status: 404 } });
    }
    const { log, attempts } = detail;
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
          // 降级来源透出(fallbackFrom 此前只写不读):主模型重试耗尽后实际切换到的来源模型
          fallbackFrom: typeof logMetadata.fallbackFrom === 'string' ? logMetadata.fallbackFrom : null,
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
 * 服务端缓存：60s TTL（ACTIVITY_CACHE_TTL_MS，动态流标注「实时」故独立短窗）；key 含 excludeTest 与 limit。
 */
router.get('/activity', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    // excludeTest=1 时过滤虚拟学习者与测试/审计账号（合成流量）
    const excludeTest = String(req.query.excludeTest || '') === '1';
    const cacheKey = `activity:${excludeTest ? 1 : 0}:${limit}`;
    const cached = overviewStatsCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < ACTIVITY_CACHE_TTL_MS) {
      return res.json({ success: true, data: cached.payload });
    }
    const data = await getPlatformActivityFeed({ limit, excludeTest });
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
router.get('/teaching-sessions', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, Math.min(1000, parseInt(req.query.limit as string) || 20));
    const userId = (req.query.userId as string) || undefined;
    const status = (req.query.status as string) || undefined;
    const onlyWithAdvisory = String(req.query.onlyWithAdvisory || '') === 'true';
    const onlyMissingWrapup = String(req.query.onlyMissingWrapup || '') === 'true';
    // 数据隔离（A3）：默认仅真实用户（排除虚拟学习者与测试/审计账号，单点 REAL_USER_WHERE）；
    // includeTest=true 时显式包含（切换后前端对虚拟/测试行做灰标标记）
    const includeTest = String(req.query.includeTest || '') === 'true';

    const data = await listTeachingSessionsDebug({
      page,
      limit,
      userId,
      status,
      onlyWithAdvisory,
      onlyMissingWrapup,
      includeTest,
    });

    res.json({
      success: true,
      data,
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
