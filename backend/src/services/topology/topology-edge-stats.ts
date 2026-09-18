/**
 * 拓扑隶属边（`<stage>-agent → skill:<id>`）运行时用量 join —— **纯函数**，不触库、不读盘。
 *
 * 背景（Q9 后续）：`handoff-edge-usage.ts` 已能把 `agent_call_logs` 聚合成
 * (callerAgent → agentId) 的运行边用量；本模块把该**已聚合**结果按 caller→callee
 * 精确配对，贴到 admin 拓扑的 membership 边上，供前端渲染：
 *   - 边宽 / 标签 ← totalCalls
 *   - 颜色 / 标注 ← successRate
 *   - tooltip     ← lastSeenAt
 *   - 死边        ← totalCalls === 0
 *
 * 口径：membership.source = 调用方（如 `path-agent`），membership.target = 被调方
 * （如 `skill:path-planning`），与 `HandoffEdgeUsage.caller/callee` 同源。
 *
 * 设计为纯定位：聚合仍由 `aggregateHandoffEdgeUsage` 负责，本模块只做确定性 join，
 * 便于单测与路由层复用。DB / 查询由调用方（routes/admin/platform.ts）负责。
 */
import {
  handoffEdgeKey,
  type HandoffEdgeUsage,
} from './handoff-edge-usage';

/** 拓扑隶属边最小结构（与 routes/admin/platform.ts 的 edges 元素兼容） */
export interface MembershipEdgeLike {
  id: string;
  source: string;
  target: string;
}

/** 单条边上贴的运行时统计 */
export interface EdgeRuntimeStats {
  /** 窗口内调用次数（未使用 = 0） */
  totalCalls: number;
  /** 失败次数（未使用 = 0） */
  failed: number;
  /** 成功率百分比（保留 1 位）；未使用 = null */
  successRate: number | null;
  /** 末次出现时间；未使用 = null */
  lastSeenAt: Date | null;
  /** 窗口内零调用（死边候选） */
  dead: boolean;
  /** 数据来源标注（与节点 stats.source 同口径） */
  source: 'agent_call_logs';
  /** 统计窗口（与节点 stats.range 同口径，如 '24h' / '7d' / '30d' / 'all'） */
  range: string;
}

export type MembershipEdgeWithStats<T extends MembershipEdgeLike> = T & { stats: EdgeRuntimeStats };

function normalizeEndpoint(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * 把**已聚合**的运行边用量贴到 membership 边上。
 *
 * - 按 `handoffEdgeKey(source, target)` 与 `HandoffEdgeUsage.key` 精确配对；
 * - 未命中的边默认 `{ totalCalls: 0, failed: 0, successRate: null, lastSeenAt: null, dead: true }`；
 * - 保留入参边的全部原始字段（如 `type`），仅新增 `stats`；
 * - 输出顺序与入参一致（确定性，可测）。
 */
export function attachEdgeStats<T extends MembershipEdgeLike>(
  edges: readonly T[],
  usageEdges: readonly HandoffEdgeUsage[],
  range: string,
): Array<MembershipEdgeWithStats<T>> {
  const usageByKey = new Map<string, HandoffEdgeUsage>();
  for (const usage of usageEdges) {
    if (!usage) continue;
    const caller = normalizeEndpoint(usage.caller);
    const callee = normalizeEndpoint(usage.callee);
    if (!caller || !callee) continue;
    usageByKey.set(usage.key || handoffEdgeKey(caller, callee), usage);
  }

  return edges.map((edge) => {
    const source = normalizeEndpoint(edge.source);
    const target = normalizeEndpoint(edge.target);
    const usage = source && target ? usageByKey.get(handoffEdgeKey(source, target)) : undefined;
    const totalCalls = usage?.calls ?? 0;
    const failed = usage?.failures ?? 0;
    const stats: EdgeRuntimeStats = {
      totalCalls,
      failed,
      successRate: usage ? usage.successRate : null,
      lastSeenAt: usage?.lastSeenAt ?? null,
      dead: totalCalls === 0,
      source: 'agent_call_logs',
      range,
    };
    return { ...edge, stats };
  });
}
