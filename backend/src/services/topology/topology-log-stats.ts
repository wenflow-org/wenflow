import prisma from '../../config/database';

/**
 * 字段级运行时命中率 query 上限（与 edges 路径的 200k 行上限同量级）。
 * ⚠ 性能：`prompt_call_logs.findMany` 走 `agentId startsWith 'skill:'` + 窗口，
 * 最坏扫描 200k 行；声明字段 / routing 图每次请求只读扫描 core / orchestration 目录。
 * 结果只做纯 join，无写库；`fieldStats` 计算失败时降级为 null（不阻断拓扑响应）。
 */
export const FIELD_STATS_ROW_CAP = 200000;

/**
 * 拓扑运行时日志聚合（/agents/topology 的取数层）。
 * Agent 节点统计（agent_call_logs）+ 隶属边用量行 + 字段命中率行（prompt_call_logs）。
 */
export async function fetchTopologyLogAggregates(since: Date | null): Promise<{
  callGroups: any[];
  successGroups: any[];
  edgeLogRows: any[];
  fieldLogRows: Array<{ agentId: string | null; extractedJson: string | null }>;
}> {
  const agentCallWhere = since ? { calledAt: { gte: since } } : {};
  // 字段命中率来自 prompt_call_logs（时间列为 createdAt，与 agent_call_logs.calledAt 不同表同窗口）
  const fieldLogWhere: any = since
    ? { createdAt: { gte: since }, agentId: { startsWith: 'skill:' } }
    : { agentId: { startsWith: 'skill:' } };

  const [callGroups, successGroups, edgeLogRows, fieldLogRows] = await Promise.all([
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
    // Q9 后续：隶属边（callerAgent → agentId）运行时用量；同一窗口，纯 join 在下方完成
    prisma.agent_call_logs.findMany({
      where: agentCallWhere,
      select: { callerAgent: true, agentId: true, success: true, calledAt: true },
      orderBy: { calledAt: 'desc' },
      take: 200000
    }),
    // Q9 后半程：字段级命中率（extractedJson 顶层键）；同窗口、独立表、只读，纯 join 在下方完成
    prisma.prompt_call_logs.findMany({
      where: fieldLogWhere,
      select: { agentId: true, extractedJson: true },
      orderBy: { createdAt: 'desc' },
      take: FIELD_STATS_ROW_CAP
    }),
  ]);
  return { callGroups, successGroups, edgeLogRows, fieldLogRows };
}
