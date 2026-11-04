/**
 * Agent 调用日志的会话级折叠（#220：详情端点按组键反查）。
 *
 * 列表 `GET /me/agent-logs` 把同一 goal/path 会话的多次调用折叠成一条，并把合成组键
 * `goal:<conversationId>` / `path:<conversationId>` 当作 `id` 返回。该键不是
 * `agent_call_logs` 的主键（真实主键形如 `acl_*`），详情端点拿它 `findFirst` 恒查不到。
 * 本模块负责：从组键解出会话 id，并用与列表同一套折叠口径把该会话的真实行重建成
 * 「一条任务」的组记录（含 `groupItems`），使「列表返回的 id 一定能被详情取到」。
 *
 * 注意：折叠规则与 `routes/users.ts` 内联实现保持一致。列表侧折叠/分页正由
 * #218/#219 调整，故此处不强行抽成公共实现，待两条分道合流后再统一为单一事实源。
 */

const CONVERSATION_AGENTS = new Set([
  'skill:goal-conversation',
  'skill:path-planning',
  'skill:path-reviewer',
  'skill:stage-designer',
  'skill:kc-mapper',
  'path-agent',
]);

const SOURCE_PRIORITY: Record<string, number> = {
  business: 3,
  runtime: 2,
  infrastructure: 1,
};

export interface AgentLogGroupId {
  /** 列表返回的合成组键，原样回显给前端 */
  groupKey: string;
  /** 组键里的会话 id（metadata 中的 conversationId/sessionId） */
  conversationId: string;
}

export interface AgentLogGroupRow {
  id: string;
  agentId: string;
  traceId?: string | null;
  calledAt: Date | string;
  success: boolean;
  durationMs?: number | null;
  errorCode?: string | null;
  metadata?: string | null;
  [key: string]: any;
}

function parseMetadata(metadata: string | null | undefined): Record<string, any> {
  if (!metadata) return {};
  try {
    return JSON.parse(metadata) as Record<string, any>;
  } catch {
    return {};
  }
}

function logSourceOf(log: { id: string; agentId: string }): string {
  if (log.id.startsWith('acl_')) return 'business';
  if (log.agentId === 'system-call' || log.agentId === 'unknown') return 'infrastructure';
  return 'runtime';
}

/** 与列表同口径：会话级 agent + metadata 中的会话 id → 组键 */
function conversationGroupKeyOf(agentId: string, metadata: Record<string, any>): string | null {
  if (!CONVERSATION_AGENTS.has(agentId)) return null;
  const conv = metadata.sourceConversationId
    || metadata.conversationId
    || metadata.sessionId
    || null;
  if (!conv) return null;
  return agentId === 'skill:goal-conversation' ? `goal:${conv}` : `path:${conv}`;
}

/**
 * 识别列表折叠行的合成组键。真实主键（`acl_*`）与未折叠行的 id 不含该前缀，返回 null，
 * 详情端点据此走原来的主键查询。
 */
export function parseAgentLogGroupId(id: string): AgentLogGroupId | null {
  if (!id) return null;
  const match = /^(path|goal):(.+)$/.exec(id);
  if (!match) return null;
  return { groupKey: `${match[1]}:${match[2]}`, conversationId: match[2] };
}

/**
 * 把候选行按列表口径（去重 → 源优先级 → 代表行 → 明细正序）重建成指定组。
 * 候选行里不属于该组的行会被丢弃；组不存在时返回 null（由路由作答 404）。
 */
export function buildCollapsedAgentLogGroup(
  groupKey: string,
  rows: AgentLogGroupRow[]
): Record<string, any> | null {
  // 1) 去重：同 traceId + agentId + 秒级时间视为同一次调用的重复落库
  const dedupeMap = new Map<string, AgentLogGroupRow & { logSource: string }>();
  for (const row of rows) {
    const metadata = parseMetadata(row.metadata);
    const traceId = row.traceId || metadata.traceId || '';
    const secondBucket = new Date(row.calledAt).toISOString().slice(0, 19);
    const dedupeKey = traceId
      ? `${traceId}|${row.agentId}|${secondBucket}`
      : `${row.agentId}|${secondBucket}`;
    const source = logSourceOf(row);
    const existing = dedupeMap.get(dedupeKey);
    if (!existing) {
      dedupeMap.set(dedupeKey, { ...row, logSource: source });
    } else if ((SOURCE_PRIORITY[source] || 0) > (SOURCE_PRIORITY[existing.logSource] || 0)) {
      dedupeMap.set(dedupeKey, { ...row, logSource: source });
    }
  }

  // 2) 模型名只写在同 trace 的网关行 metadata 里，先按 traceId 建索引
  const modelByTrace = new Map<string, string>();
  for (const value of dedupeMap.values()) {
    const metadata = parseMetadata(value.metadata);
    const model = typeof metadata.model === 'string' ? metadata.model.trim() : '';
    const traceId = String(value.traceId || metadata.traceId || '');
    if (model && traceId && !modelByTrace.has(traceId)) modelByTrace.set(traceId, model);
  }

  // 3) 只收集属于该组的行；代表行取源优先级最高者（同优先级保留先入）
  const items: Array<AgentLogGroupRow & { logSource: string }> = [];
  let rep: (AgentLogGroupRow & { logSource: string }) | null = null;
  for (const value of dedupeMap.values()) {
    const metadata = parseMetadata(value.metadata);
    if (conversationGroupKeyOf(String(value.agentId || ''), metadata) !== groupKey) continue;
    items.push(value);
    if (!rep || (SOURCE_PRIORITY[value.logSource] || 0) > (SOURCE_PRIORITY[rep.logSource] || 0)) {
      rep = value;
    }
  }
  if (!rep || items.length === 0) return null;

  const itemsAsc = [...items].sort(
    (a, b) => new Date(a.calledAt).getTime() - new Date(b.calledAt).getTime()
  );
  const lastAt = itemsAsc[itemsAsc.length - 1].calledAt;
  // path 组代表优先 path-planning（用户语义「生成学习路径」），与列表一致
  const groupRep = groupKey.startsWith('path:')
    ? itemsAsc.find((i) => String(i.agentId) === 'skill:path-planning')
      || itemsAsc.find((i) => String(i.agentId) === 'skill:path-reviewer')
      || rep
    : rep;

  const group = {
    ...groupRep,
    id: groupKey,
    calledAt: lastAt,
    groupCount: items.length,
    model: modelByTrace.get(String(groupRep.traceId || '')) ?? null,
    groupItems: itemsAsc.map((item) => ({
      id: item.id,
      agentId: item.agentId,
      calledAt: item.calledAt,
      success: item.success,
      durationMs: item.durationMs,
      errorCode: item.errorCode,
      // path-agent 阶段流水透传 phase，前端可显示「主结构 / 阶段任务」等阶段名
      phase: (() => {
        const m = parseMetadata(item.metadata);
        return (m.phase && typeof m.phase === 'string') ? m.phase : null;
      })(),
    })),
  };

  // 4) 与列表最终归一化一致：代表行自身 model → 同 trace 网关行 model → null
  const ownMetadata = parseMetadata(group.metadata);
  const model = (typeof group.model === 'string' && group.model.trim())
    || (typeof ownMetadata.model === 'string' ? ownMetadata.model : '')
    || modelByTrace.get(String(group.traceId || ownMetadata.traceId || ''))
    || '';
  return { ...group, model: model.trim() ? model : null };
}
