import prisma from '../../config/database';
import { buildTimeoutCondition } from './failure-classification';

/**
 * Agent 执行日志查询（GET /api/admin/agents/logs 与 /agents/logs/:id 的数据层）。
 * 由 routes/admin/platform.ts 下沉：where 组装留在路由（请求参数语义），
 * 本模块负责取数与状态计数（成功/超时/错误，与筛选口径同源）。
 */
export async function fetchAgentLogPage(params: {
  where: any;
  skip: number;
  limitNum: number;
  logOrderBy: any;
}): Promise<[any[], number, number, number, number, any[]]> {
  const { where, skip, limitNum, logOrderBy } = params;
  const [logs, total, successCount, timeoutCount, errorCount, bySourceRows] = await Promise.all([
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
  return [logs, total, successCount, timeoutCount, errorCount, bySourceRows];
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
