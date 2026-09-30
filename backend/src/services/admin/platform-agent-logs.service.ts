import prisma from '../../config/database';
import { timeoutErrorSignals } from './failure-classification';

/**
 * Agent 执行日志查询（GET /api/admin/agents/logs 与 /agents/logs/:id 的数据层）。
 * 由 routes/admin/platform.ts 下沉：where 组装留在路由（请求参数语义），
 * 本模块负责取数与状态计数（成功/超时/错误，与筛选口径同源）。
 *
 * canaryWhere：默认视图已排除 system-canary 行，前端「测试日志」入口的计数
 * 无法从主查询结果里数出来——路由层传入「同筛选、仅统计 system-canary」的
 * where，这里顺带 count；为空（显式 sourceEntry 筛选）时计 0。
 *
 * 性能批 2026-09-30：total/success/timeout/error/bySource 原本是 5 个独立 count/groupBy，
 * 每个都要为评估 metadata NOT LIKE 全窗读大文本列（周窗 ~1.4 万行 × 5）。
 * 收成两次扫描：groupBy(sourceEntry, success) 一次给 total/success/bySource，
 * 失败行小拉取一次给 timeout/error（分类口径镜像 buildTimeoutCondition，见 matchesTimeoutCondition）。
 */
export async function fetchAgentLogPage(params: {
  where: any;
  skip: number;
  limitNum: number;
  logOrderBy: any;
  canaryWhere?: any;
}): Promise<[any[], number, number, number, number, any[], number]> {
  const { where, skip, limitNum, logOrderBy, canaryWhere } = params;
  const [logs, sourceSuccessGroups, failedRows, canaryCount] = await Promise.all([
    // select 裁剪：列表仅消费下列字段（input/output 由详情接口按需拉取，不在列表传输）
    prisma.agent_call_logs.findMany({
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
    }),
    // total（组计数之和）/ success / bySource 三笔来自同一次扫描
    prisma.agent_call_logs.groupBy({
      by: ['sourceEntry', 'success'],
      where,
      _count: { _all: true },
    }),
    // 失败行小拉取（周窗 ~470 行）：timeout/error 拆分在端内按 buildTimeoutCondition 同口径分类
    prisma.agent_call_logs.findMany({
      where: { ...where, success: false },
      select: { errorCode: true, errorCategory: true, error: true },
    }),
    canaryWhere ? prisma.agent_call_logs.count({ where: canaryWhere }) : Promise.resolve(0),
  ]);

  const total = sourceSuccessGroups.reduce((sum, g) => sum + g._count._all, 0);
  const successCount = sourceSuccessGroups.filter((g) => g.success === true).reduce((sum, g) => sum + g._count._all, 0);
  const timeoutCount = failedRows.filter(matchesTimeoutCondition).length;
  const errorCount = failedRows.length - timeoutCount;
  // 路由消费形态保持 { sourceEntry, _count: { _all } }[]（仅按 sourceEntry 聚合的视图）
  const sourceTotals = new Map<string, number>();
  for (const g of sourceSuccessGroups) {
    const key = g.sourceEntry || 'platform';
    sourceTotals.set(key, (sourceTotals.get(key) || 0) + g._count._all);
  }
  const bySourceRows = [...sourceTotals.entries()].map(([sourceEntry, _all]) => ({
    sourceEntry,
    _count: { _all },
  }));

  return [logs, total, successCount, timeoutCount, errorCount, bySourceRows, canaryCount];
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
