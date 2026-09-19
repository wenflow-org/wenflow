import prisma from '../config/database';

/**
 * Prompt 调用日志查询（主库 `prompt_call_logs`）。
 *
 * 供管理端 runtime-definitions 的只读列表消费；此处只负责按筛选条件取数，
 * 大文本列裁剪与响应整形仍由路由层完成（行为不变）。
 */

export interface PromptCallLogFilter {
  agentId: string | null;
  pathId: string | null;
  pipelineRunId: string | null;
  traceId: string | null;
  parentExecutionId: string | null;
  /** status=success|error|drift，其余不做 success/drift 过滤 */
  status: string;
  /** 结果条数（调用方已钳制 1..200） */
  limit: number;
}

export function listPromptCallLogs(filter: PromptCallLogFilter) {
  return prisma.prompt_call_logs.findMany({
    where: {
      ...(filter.agentId ? { agentId: filter.agentId } : {}),
      ...(filter.pathId ? { pathId: filter.pathId } : {}),
      ...(filter.pipelineRunId ? { pipelineRunId: filter.pipelineRunId } : {}),
      ...(filter.traceId ? { traceId: filter.traceId } : {}),
      ...(filter.parentExecutionId ? { parentExecutionId: filter.parentExecutionId } : {}),
      ...(filter.status === 'success' ? { success: true } : {}),
      ...(filter.status === 'error' ? { success: false } : {}),
      ...(filter.status === 'drift' ? { promptDrift: true } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: filter.limit,
  });
}
