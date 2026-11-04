/**
 * Agent 调用日志的会话级折叠（#220 / #225）。
 *
 * 列表 `GET /me/agent-logs` 把同一 goal/path 会话的多次调用折叠成一条，并把合成组键
 * `goal:<conversationId>` / `path:<conversationId>` 当作 `id` 返回。该键不是
 * `agent_call_logs` 的主键（真实主键形如 `acl_*`），详情端点拿它 `findFirst` 恒查不到。
 *
 * #225：详情必须与列表**同一条管线**——同一个 where 取数、同一套跨会话去重、同一套
 * 组代表/模型补全/排序。此前详情只按会话反查再单独折叠，输入集不同（跨会话去重会
 * 让同一秒同 agent 且无 traceId 的行互撞），模型补全也因网关行不带会话 id 而丢；
 * 于是同一条折叠行两处 groupCount/groupItems/model 不一致。折叠实现只保留这一份。
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

/** 参与模型补全的行：#230 补数查询只需 traceId + metadata，不必带展示字段 */
export interface AgentLogModelSourceRow {
  traceId?: string | null;
  metadata?: string | null;
  [key: string]: any;
}

/**
 * 提取一组日志行里去重后的非空 traceId（列优先，回退 metadata.traceId）。
 * 供调用方按已选中的 traceId 集合另取承载模型名的行——见 routes/users.buildAgentLogView。
 */
export function collectAgentLogTraceIds(logs: AgentLogModelSourceRow[]): string[] {
  const ids = new Set<string>();
  for (const log of logs) {
    const metadata = parseMetadata(log.metadata);
    const traceId = String(log.traceId || metadata.traceId || '').trim();
    if (traceId) ids.add(traceId);
  }
  return [...ids];
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

/** 会话级 agent + metadata 中的会话 id → 组键 */
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
 * 列表的完整折叠管线：去重 → 源优先级 → 会话分组 → 组记录/未归组行 → 模型归一化 → 排序。
 *
 * 详情端点必须用同一个 where 取数后调用本函数，再按 id 取其中一条；这样两处的
 * groupCount/groupItems/model 由构造保证相同（#225），而不是靠两套实现「看起来一致」。
 *
 * @param modelSourceRows #230：模型名只写在 api-gateway 行上，而网关行不在默认口径的
 *   userListed 白名单里、**不在本参数 logs 的取数集内**。调用方按已选 traceId 另取回
 *   网关行后从这里传入，仅用于建模型索引，不参与去重/分组/输出。
 */
export function collapseAgentLogGroups(
  logs: AgentLogGroupRow[],
  modelSourceRows: AgentLogModelSourceRow[] = []
): any[] {
  // 1) 去重：同 traceId + agentId + 秒级时间视为同一次调用的重复落库。
  //    注意这是**跨会话**去重（key 不含会话），列表一直如此；详情若按会话去重会多出条目。
  const dedupeMap = new Map<string, any>();
  for (const log of logs) {
    const metadata = parseMetadata(log.metadata);
    const traceId = log.traceId || metadata.traceId || '';
    const secondBucket = new Date(log.calledAt).toISOString().slice(0, 19);
    const dedupeKey = traceId
      ? `${traceId}|${log.agentId}|${secondBucket}`
      : `${log.agentId}|${secondBucket}`;
    const source = logSourceOf(log);
    const existing = dedupeMap.get(dedupeKey);
    if (!existing) {
      dedupeMap.set(dedupeKey, { ...log, logSource: source });
    } else if ((SOURCE_PRIORITY[source] || 0) > (SOURCE_PRIORITY[existing.logSource] || 0)) {
      dedupeMap.set(dedupeKey, { ...log, logSource: source });
    }
  }

  /* 同一 trace 的业务行与 api-gateway 行是两条日志（agentId 不同、不合并），
     但模型名只写在网关行的 metadata 里。先按 traceId 建索引，折叠后提到业务行顶层，
     用户侧「模型」列才显示实际模型而不是笼统的「内置模型」。

     #230：网关行同样不在默认口径的 userListed 白名单里，默认视图的取数集（logs）里
     根本没有它——所以索引不能只看 logs，还要合入调用方按已选 traceId 另取回的
     modelSourceRows（user.repo.listAgentLogModelRowsByTraceIds）。取数集内已有的模型
     优先级更高（先入先占），补数行只填空缺。 */
  const modelByTrace = new Map<string, string>();
  for (const value of [...dedupeMap.values(), ...modelSourceRows]) {
    const metadata = parseMetadata(value.metadata);
    const model = typeof metadata.model === 'string' ? metadata.model.trim() : '';
    const traceId = String(value.traceId || metadata.traceId || '');
    if (model && traceId && !modelByTrace.has(traceId)) modelByTrace.set(traceId, model);
  }

  // 2) 组：key=goal/path 会话；rep=组内优先级最高的代表日志；items=组内全部（去重后）调用明细
  const groupMap = new Map<string, { rep: any; items: any[] }>();
  for (const value of dedupeMap.values()) {
    const metadata = parseMetadata(value.metadata);
    const agent = String(value.agentId || '');
    const groupKey = conversationGroupKeyOf(agent, metadata);
    if (!groupKey) continue;
    const currentSource = value.logSource || 'runtime';
    const cur = groupMap.get(groupKey);
    if (!cur) {
      groupMap.set(groupKey, { rep: value, items: [value] });
    } else {
      groupMap.set(groupKey, {
        rep: (SOURCE_PRIORITY[currentSource] || 0) > (SOURCE_PRIORITY[cur.rep.logSource || 'runtime'] || 0)
          ? value
          : cur.rep,
        items: [...cur.items, value],
      });
    }
  }

  const collapsed = new Map<string, any>();
  for (const [groupKey, { rep, items }] of groupMap) {
    if (items.length <= 1) {
      collapsed.set(groupKey, rep);
      continue;
    }
    // 组时间取最近一次调用（排序/展示用）；id 用稳定 groupKey 供前端 dismiss/key
    const itemsAsc = [...items].sort(
      (a, b) => new Date(a.calledAt).getTime() - new Date(b.calledAt).getTime()
    );
    const lastAt = itemsAsc[itemsAsc.length - 1].calledAt;
    // path 组代表优先 path-planning（用户语义「生成学习路径」），避免 path-agent 阶段流水抢占展示
    const groupRep = groupKey.startsWith('path:')
      ? itemsAsc.find((i) => String(i.agentId) === 'skill:path-planning')
        || itemsAsc.find((i) => String(i.agentId) === 'skill:path-reviewer')
        || rep
      : rep;
    collapsed.set(groupKey, {
      ...groupRep,
      id: groupKey,
      calledAt: lastAt,
      groupCount: items.length,
      // 业务层代表行通常没有 model；模型名在同 trace 的网关行 metadata 里
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
    });
  }
  // 未折叠进任何会话组的日志（teaching-turn/session-wrapup/peer 等）仍逐条输出
  for (const [key, value] of dedupeMap) {
    const metadata = parseMetadata(value.metadata);
    const agent = String(value.agentId || '');
    const groupKey = conversationGroupKeyOf(agent, metadata);
    if (groupKey && collapsed.has(groupKey)) continue;
    // 未归组的 path-agent 阶段流水：附上 phase，前端据此显示「主结构/阶段任务」而非裸「agent」
    let item = value;
    if (agent === 'path-agent' && typeof metadata.phase === 'string') {
      item = { ...value, phase: metadata.phase };
    }
    collapsed.set(`item:${key}`, item);
  }

  // 3) 最终归一化：代表行自身 model → 同 trace 网关行 model → null；按最近调用倒序
  return Array.from(collapsed.values())
    .map((log) => {
      const ownMetadata = parseMetadata(log.metadata);
      const model = (typeof log.model === 'string' && log.model.trim())
        || (typeof ownMetadata.model === 'string' ? ownMetadata.model : '')
        || modelByTrace.get(String(log.traceId || ownMetadata.traceId || ''))
        || '';
      return { ...log, model: model.trim() ? model : null };
    })
    .sort((a, b) => new Date(b.calledAt).getTime() - new Date(a.calledAt).getTime());
}
