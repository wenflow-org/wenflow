import prisma from '../../config/database';
import { timeoutErrorSignals } from './failure-classification';

/**
 * Agent 执行日志查询（GET /api/admin/agents/logs 与 /agents/logs/:id 的数据层）。
 * 由 routes/admin/platform.ts 下沉：where 组装留在路由（请求参数语义），
 * 本模块负责取数与状态计数（成功/超时/错误，与筛选口径同源）。
 *
 * canaryWhere：默认视图已排除 system-canary 行，前端「测试日志」入口的计数
 * 无法从主查询结果里数出来——路由层传入「同筛选、仅统计 system-canary」的
 * where，这里顺带统计；为空（显式 sourceEntry 筛选）时计 0。
 *
 * 性能批 2026-09-30：total/success/timeout/error/bySource 原本是 5 个独立 count/groupBy，
 * 每个都要为评估 metadata NOT LIKE 全窗读大文本列（周窗 ~1.4 万行 × 5）。
 * 收成两次扫描：groupBy(sourceEntry, success) 一次给 total/success/bySource，
 * 失败行小拉取一次给 timeout/error（分类口径镜像 buildTimeoutCondition，见 matchesTimeoutCondition）。
 *
 * 性能批 2026-10-04：扫描按「行 / 统计」拆为两个函数——
 * fetchAgentLogRows（列表行，实时）与 fetchAgentLogStats（统计，可被路由层做进程内缓存）。
 * 统计的失败行拉取要读 7k+ 行 error 文本（宽行回表），页缓存又被夜批写入持续冲刷，
 * 「页热」不可靠；进程内缓存 + 启动预热才让执行日志页稳定毫秒级。
 */

/** 统计八件套：[total, success, timeout, error, bySource, canary, byAgentErrors, latencyPercentiles] */
export type AgentLogErrorByAgent = { agentId: string; count: number };
/** 全窗口延迟分位（毫秒；窗口内无成功样本时为 null） */
export type AgentLogLatencyPercentiles = { p50: number | null; p99: number | null };
export type AgentLogStatsTuple = [number, number, number, number, any[], number, AgentLogErrorByAgent[], AgentLogLatencyPercentiles];

/** 列表行取数（实时，行窗口受 limit 限制，代价与窗口无关） */
export async function fetchAgentLogRows(params: {
  where: any;
  skip: number;
  limitNum: number;
  logOrderBy: any;
}): Promise<any[]> {
  const { where, skip, limitNum, logOrderBy } = params;
  // select 裁剪：列表仅消费下列字段（input/output 由详情接口按需拉取，不在列表传输）
  return prisma.agent_call_logs.findMany({
    where,
    skip,
    take: limitNum,
    orderBy: logOrderBy,
    select: {
      id: true,
      agentId: true,
      callerAgent: true,
      sourceEntry: true,
      success: true,
      error: true,
      errorCode: true,
      // 错误类别列（2026-10-05）：/agents/logs 列表需回传派生的错误类别，供错误摘要条
      // 的类别 chip 聚合与下钻查询值同源（此前漏选，前端只能把整列兜底成「其他」）
      errorCategory: true,
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
      promptTokens: true,
      completionTokens: true,
    },
  });
}

export async function fetchAgentLogStats(params: {
  where: any;
  canaryWhere?: any;
  /** 统计口径 where（2026-10-04 性能批二段）：默认视图 = where 去掉「排除 canary」子句，
   *  canarySourceEntry='system-canary' → total/success/bySource 与 canary 计数由**同一次
   *  groupBy 扫描**派生（JS 剔除 canary 分组），省掉第二趟全窗索引走查。
   *  显式 sourceEntry 筛选时两者均为缺省（统计不过滤、canary 计 0，与原语义一致）。 */
  statsWhere?: any;
  canarySourceEntry?: string | null;
}): Promise<AgentLogStatsTuple> {
  const { where, canaryWhere, statsWhere, canarySourceEntry } = params;
  const canaryFiltered = canaryWhere != null && canarySourceEntry != null;
  /* 延迟分位取数（2026-10-29 审计 M-3）：与 total/success 同窗口同口径（仅成功行、默认视图
     剔除 canary）的全窗 durationMs——前端 KPI 的 P50/P99 此前只能拿当前页 ≤30 行样本冒充
     全窗口，与并排的全窗口成功率互相矛盾。窄列（仅 durationMs）一扫，与下方两查询并行；
     结果随 stats 进程内缓存，代价被 SWR 摊平。取 where（canaryFiltered 时显式补 canary 排除）
     与下方失败行拉取同构：两种调用形态（路由默认视图/预热）下 where 均已含排除子句，
     与 statsWhere 的主口径逐行等价。 */
  const latencyWhere: any = { ...where, success: true, durationMs: { not: null } };
  if (canaryFiltered) {
    latencyWhere.AND = [...(Array.isArray(latencyWhere.AND) ? latencyWhere.AND : []), { sourceEntry: { not: canarySourceEntry } }];
  }
  const [sourceSuccessGroups, failedRows, durationRows] = await Promise.all([
    // total（组计数之和）/ success / bySource / canaryCount 同来自这一次扫描：
    // 默认视图扫 statsWhere（含 canary 行），JS 侧把 canary 分组从主口径剔除、单独计数
    prisma.agent_call_logs.groupBy({
      by: ['sourceEntry', 'success'],
      where: statsWhere ?? where,
      _count: { _all: true },
    }),
    // 失败行小拉取（周窗 ~7k 行）：timeout/error 拆分在端内按 buildTimeoutCondition 同口径分类；
    // agentId 一并选出（2026-10-28 数据审计）：总览待办/侧栏角标此前只能拿 200 行采样数
    // 「近 7 天失败 18 次」当全量讲（实际 66/1789），改为由统计侧给全量 by-agent 失败数
    prisma.agent_call_logs.findMany({
      where: { ...where, success: false },
      select: { agentId: true, errorCode: true, errorCategory: true, error: true },
    }),
    prisma.agent_call_logs.findMany({
      where: latencyWhere,
      select: { durationMs: true },
    }),
  ]);

  const isCanaryGroup = (g: { sourceEntry: string | null }) =>
    canaryFiltered && g.sourceEntry === canarySourceEntry;
  const statsGroups = sourceSuccessGroups.filter((g) =>
    canaryFiltered ? !isCanaryGroup(g) && g.sourceEntry != null : true
  );
  const canaryCount = canaryFiltered
    ? sourceSuccessGroups.filter(isCanaryGroup).reduce((sum, g) => sum + g._count._all, 0)
    : 0;

  const total = statsGroups.reduce((sum, g) => sum + g._count._all, 0);
  const successCount = statsGroups.filter((g) => g.success === true).reduce((sum, g) => sum + g._count._all, 0);
  const timeoutCount = failedRows.filter(matchesTimeoutCondition).length;
  const errorCount = failedRows.length - timeoutCount;
  /* 全量 by-agent 失败数（error 口径，与列表 status=error 筛选/执行日志页「失败（N）」一致）：
     Top 5 足够总览待办（取前 2）与角标（用总数）消费，不再让采样数冒充全量 */
  const byAgent = new Map<string, number>();
  for (const row of failedRows) {
    if (matchesTimeoutCondition(row)) continue;
    const agentId = String(row.agentId || '');
    if (!agentId) continue;
    byAgent.set(agentId, (byAgent.get(agentId) || 0) + 1);
  }
  const byAgentErrors = [...byAgent.entries()]
    .map(([agentId, count]) => ({ agentId, count }))
    .sort((a, b) => b.count - a.count || a.agentId.localeCompare(b.agentId))
    .slice(0, 5);
  // 全窗延迟分位：算法与前端 fallback 样本口径逐字对齐（ExecLogs.vue percentileMsOf——
  // 仅成功行、durationMs 为非负数、升序后取 round((n-1)*q) 下标）；空窗返回 null（前端回退样本计算）
  const durations = durationRows
    .map((row) => row.durationMs)
    .filter((d): d is number => typeof d === 'number' && d >= 0)
    .sort((a, b) => a - b);
  const latencyPercentiles: AgentLogLatencyPercentiles = {
    p50: percentileOfSorted(durations, 0.5),
    p99: percentileOfSorted(durations, 0.99),
  };
  // 路由消费形态保持 { sourceEntry, _count: { _all } }[]（仅按 sourceEntry 聚合的视图）
  const sourceTotals = new Map<string, number>();
  for (const g of statsGroups) {
    const key = g.sourceEntry || 'platform';
    sourceTotals.set(key, (sourceTotals.get(key) || 0) + g._count._all);
  }
  const bySourceRows = [...sourceTotals.entries()].map(([sourceEntry, _all]) => ({
    sourceEntry,
    _count: { _all },
  }));

  return [total, successCount, timeoutCount, errorCount, bySourceRows, canaryCount, byAgentErrors, latencyPercentiles];
}

/** 分位取值（与前端 percentileMsOf 同式）：升序数组取 round((n-1)*q) 下标，空数组 null */
function percentileOfSorted(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[idx];
}

/** 兼容组合（行 + 统计）：未接缓存的调用方（测试/其他入口）仍可用单函数形态 */
export async function fetchAgentLogPage(params: {
  where: any;
  skip: number;
  limitNum: number;
  logOrderBy: any;
  canaryWhere?: any;
  statsWhere?: any;
  canarySourceEntry?: string | null;
}): Promise<[any[], number, number, number, number, any[], number, AgentLogErrorByAgent[], AgentLogLatencyPercentiles]> {
  const { where, skip, limitNum, logOrderBy, canaryWhere, statsWhere, canarySourceEntry } = params;
  const [logs, stats] = await Promise.all([
    fetchAgentLogRows({ where, skip, limitNum, logOrderBy }),
    fetchAgentLogStats({ where, canaryWhere, statsWhere, canarySourceEntry }),
  ]);
  return [logs, ...stats] as [any[], number, number, number, number, any[], number, AgentLogErrorByAgent[], AgentLogLatencyPercentiles];
}

/**
 * buildTimeoutCondition（Prisma where）的端内镜像：errorCode 含 timeout 字样，
 * 或 error 文本含任一超时信号（SQLite LIKE 对 ASCII 不分大小写，此处 toLowerCase 对齐）。
 * 注意与 isTimeoutLog 并不等价（后者优先看 errorCategory 列）——计数口径必须跟随筛选条件。
 */
function matchesTimeoutCondition(log: { errorCode: string | null; errorCategory?: string | null; error: string | null }): boolean {
  const errorCode = String(log.errorCode || '').toLowerCase();
  if (errorCode.includes('timeout')) return true;
  const errorText = String(log.error || '').toLowerCase();
  return timeoutErrorSignals.some((signal) => errorText.includes(signal));
}

export async function fetchAgentLogWithAttempts(id: string): Promise<{ log: any; attempts: any[] } | null> {
  const log = await prisma.agent_call_logs.findUnique({ where: { id } });
  if (!log) {
    return null;
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
  return { log, attempts };
}
