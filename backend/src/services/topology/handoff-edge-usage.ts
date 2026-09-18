/**
 * 编排交接边（handoff edge）用量聚合 —— **纯函数**，不触库、不读盘
 *
 * 背景（升级方向 Q9）：admin 编排拓扑目前只在**节点**层展示运行时调用量
 * （`agent_call_logs` 按 `agentId` 聚合），**边**（调用方 → 被调方）没有运行时数据，
 * 无法回答"哪条 handoff 真的在跑、哪条是死边"。
 *
 * 数据口径（基于实际列，2026-09-18 核对 prisma/schema.prisma:32）：
 *   - 被调方（callee）= `agent_call_logs.agentId`（skill span 为 `skill:<skillId>`）
 *   - 调用方（caller）= `agent_call_logs.callerAgent`（可能为空）
 *   - 成败 = `agent_call_logs.success`；时间 = `agent_call_logs.calledAt`
 *   写入点：`backend/src/skills/executor.ts`（skill span：agentId=`skill:*`, callerAgent=ctx.callerAgent）
 *          `backend/src/gateway/api-gateway/executor.ts`（网关行：agentId='api-gateway', callerAgent=ctx.callerAgent）
 *
 * 本模块只做纯计算，DB / YAML 读取由 CLI（audit-handoff-edges.ts）负责，便于单测与复用。
 */

/** 聚合输入行：只依赖这 4 个真实列；其余字段忽略 */
export interface HandoffLogRow {
  /** 调用方（agent_call_logs.callerAgent）。null / 空串表示调用方未知，无法构成边。 */
  callerAgent: string | null | undefined;
  /** 被调方（agent_call_logs.agentId）。null / 空串表示被调方未知，无法构成边。 */
  agentId: string | null | undefined;
  /** 是否成功（agent_call_logs.success）。仅 `false` 计失败，缺省视为成功。 */
  success?: boolean | null;
  /** 调用时间（agent_call_logs.calledAt）。 */
  calledAt: Date | string | number;
}

/** 单条交接边的运行时用量 */
export interface HandoffEdgeUsage {
  caller: string;
  callee: string;
  /** 边键，见 handoffEdgeKey() */
  key: string;
  calls: number;
  failures: number;
  /** 成功率百分比（保留 1 位）；calls=0 时为 null */
  successRate: number | null;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
}

export interface HandoffAggregationOptions {
  /** 闭区间下界（含） */
  since?: Date | string | number;
  /** 闭区间上界（含） */
  until?: Date | string | number;
}

export interface HandoffAggregationResult {
  edges: HandoffEdgeUsage[];
  /** 输入总行数 */
  totalRows: number;
  /** 落在窗口内且两端齐全、计入统计的行数 */
  consideredRows: number;
  /** calledAt 非法 / 缺失，无法定位时间 */
  skippedInvalidTime: number;
  /** 在 [since, until] 之外 */
  skippedOutOfWindow: number;
  /** callerAgent 为空 */
  skippedMissingCaller: number;
  /** agentId 为空 */
  skippedMissingCallee: number;
}

/** 声明源（YAML）路由的最小结构：与 field-routing/orchestration-file 的 OrchestrationRouting 兼容 */
export interface HandoffDeclaredRouting {
  agentId: string;
  fieldId: string;
  handoff?: string[] | null;
}

/** 声明源阶段的最小结构：与 OrchestrationStage 兼容 */
export interface HandoffDeclaredStage {
  stage: string;
  contracts?: Array<{ agentId: string }>;
  routings?: HandoffDeclaredRouting[];
}

/** 从 YAML 提取出的一条声明边 */
export interface DeclaredHandoffEdge {
  caller: string;
  /** 归一化后的被调方（阶段别名会映射到该阶段的编排 agent，如 teaching → teaching-agent） */
  callee: string;
  /** 声明原文（保留用于追溯，如 `teaching`） */
  calleeRaw: string;
  /** 声明该边所属 stage */
  stage: string;
  /** 声明该边的 fieldId 列表（同一对 agent 可被多个字段引用） */
  fields: string[];
}

export interface DeclaredVsUsedComparison {
  declaredEdges: DeclaredHandoffEdge[];
  usedEdgeCount: number;
  matchedEdgeCount: number;
  declaredButNeverUsed: DeclaredHandoffEdge[];
  usedButUndeclared: HandoffEdgeUsage[];
}

export interface DeclaredVsUsedOptions {
  /**
   * 默认 true：按无向配对 (pair) 匹配。
   * 原因：YAML 声明的是**数据交付方向**（产出方 → 消费方，如 skill:goal-conversation → goal-agent），
   * 而日志记录的是**调用方向**（调用方 → 被调方，如 goal-agent → skill:goal-conversation），
   * 二者常相反；按无向配对才能回答"这条交接关系是否真有流量"。
   * 置 false 则严格按有向边匹配。
   */
  undirected?: boolean;
}

/**
 * 有向边键定义：`<caller> -> <callee>`。
 * 选 `->` 是因为 agent/skill id 不会包含该子串，键可读且无歧义。
 */
export function handoffEdgeKey(caller: string, callee: string): string {
  return `${caller} -> ${callee}`;
}

/** 无向配对键：两端按字典序排列，用于声明/运行方向相反的交接关系匹配。 */
export function handoffPairKey(a: string, b: string): string {
  return a <= b ? `${a} <-> ${b}` : `${b} <-> ${a}`;
}

function normalizeEndpoint(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toTimestamp(value: Date | string | number): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return new Date(value).getTime();
}

/**
 * 纯聚合：把日志行按 (caller, callee) 归并，输出调用数 / 失败数 / 首末次出现时间。
 * 排序：calls 降序 → failures 降序 → key 升序（确定、可测）。
 */
export function aggregateHandoffEdgeUsage(
  rows: readonly HandoffLogRow[],
  options: HandoffAggregationOptions = {},
): HandoffAggregationResult {
  const since = options.since === undefined ? null : toTimestamp(options.since);
  const until = options.until === undefined ? null : toTimestamp(options.until);
  const sinceMs = since !== null && Number.isFinite(since) ? since : null;
  const untilMs = until !== null && Number.isFinite(until) ? until : null;

  interface Acc {
    caller: string;
    callee: string;
    key: string;
    calls: number;
    failures: number;
    firstSeenAt: Date;
    lastSeenAt: Date;
  }
  const buckets = new Map<string, Acc>();
  const result: HandoffAggregationResult = {
    edges: [],
    totalRows: 0,
    consideredRows: 0,
    skippedInvalidTime: 0,
    skippedOutOfWindow: 0,
    skippedMissingCaller: 0,
    skippedMissingCallee: 0,
  };

  for (const row of rows) {
    result.totalRows += 1;
    const ts = toTimestamp(row.calledAt);
    if (!Number.isFinite(ts)) {
      result.skippedInvalidTime += 1;
      continue;
    }
    if (sinceMs !== null && ts < sinceMs) {
      result.skippedOutOfWindow += 1;
      continue;
    }
    if (untilMs !== null && ts > untilMs) {
      result.skippedOutOfWindow += 1;
      continue;
    }
    const caller = normalizeEndpoint(row.callerAgent);
    if (!caller) {
      result.skippedMissingCaller += 1;
      continue;
    }
    const callee = normalizeEndpoint(row.agentId);
    if (!callee) {
      result.skippedMissingCallee += 1;
      continue;
    }

    result.consideredRows += 1;
    const key = handoffEdgeKey(caller, callee);
    const seenAt = new Date(ts);
    const existing = buckets.get(key);
    if (existing) {
      existing.calls += 1;
      if (row.success === false) existing.failures += 1;
      if (seenAt.getTime() < existing.firstSeenAt.getTime()) existing.firstSeenAt = seenAt;
      if (seenAt.getTime() > existing.lastSeenAt.getTime()) existing.lastSeenAt = seenAt;
    } else {
      buckets.set(key, {
        caller,
        callee,
        key,
        calls: 1,
        failures: row.success === false ? 1 : 0,
        firstSeenAt: seenAt,
        lastSeenAt: seenAt,
      });
    }
  }

  const edges: HandoffEdgeUsage[] = [...buckets.values()]
    .map((acc) => ({
      caller: acc.caller,
      callee: acc.callee,
      key: acc.key,
      calls: acc.calls,
      failures: acc.failures,
      successRate: acc.calls > 0 ? Number((((acc.calls - acc.failures) / acc.calls) * 100).toFixed(1)) : null,
      firstSeenAt: acc.firstSeenAt,
      lastSeenAt: acc.lastSeenAt,
    }))
    .sort((a, b) => b.calls - a.calls || b.failures - a.failures || a.key.localeCompare(b.key));

  result.edges = edges;
  return result;
}

/**
 * 从声明源 stage（prompts/orchestration/*.yaml 解析结果）展平出声明边。
 * - 阶段别名归一化：目标若等于某个 stage 名（teaching / profile / path / goal / simulation），
 *   映射到该 stage 的编排 agent（contracts 里 `<stage>-agent`，兜底首个 `*-agent`）。
 * - 同一 (caller, callee) 被多个字段声明时合并 fields，保证声明边唯一。
 */
export function extractDeclaredHandoffEdges(stages: readonly HandoffDeclaredStage[]): DeclaredHandoffEdge[] {
  const stageOrchestrator = new Map<string, string>();
  for (const stage of stages) {
    const contracts = (stage.contracts || []).map((c) => c.agentId).filter(Boolean);
    const orchestrator = contracts.find((id) => id === `${stage.stage}-agent`)
      || contracts.find((id) => id.endsWith('-agent'));
    if (stage.stage && orchestrator) stageOrchestrator.set(stage.stage, orchestrator);
  }

  const merged = new Map<string, DeclaredHandoffEdge>();
  for (const stage of stages) {
    for (const routing of stage.routings || []) {
      const caller = normalizeEndpoint(routing.agentId);
      if (!caller) continue;
      for (const target of routing.handoff || []) {
        const raw = normalizeEndpoint(target);
        if (!raw) continue;
        const callee = stageOrchestrator.get(raw) || raw;
        const key = handoffEdgeKey(caller, callee);
        const existing = merged.get(key);
        if (existing) {
          if (!existing.fields.includes(routing.fieldId)) existing.fields.push(routing.fieldId);
        } else {
          merged.set(key, { caller, callee, calleeRaw: raw, stage: stage.stage, fields: [routing.fieldId] });
        }
      }
    }
  }

  return [...merged.values()].sort(
    (a, b) => a.caller.localeCompare(b.caller) || a.callee.localeCompare(b.callee),
  );
}

/**
 * 声明边 vs 运行边对比：
 * - declaredButNeverUsed：声明了但窗口内零命中（死边候选）
 * - usedButUndeclared：运行了但未在 YAML 声明（幽灵边候选）
 * 默认按无向配对匹配（见 DeclaredVsUsedOptions.undirected）。
 */
export function compareDeclaredVsUsed(
  declared: readonly DeclaredHandoffEdge[],
  used: readonly HandoffEdgeUsage[],
  options: DeclaredVsUsedOptions = {},
): DeclaredVsUsedComparison {
  const undirected = options.undirected !== false;
  const keyOf = (a: string, b: string) => (undirected ? handoffPairKey(a, b) : handoffEdgeKey(a, b));

  const usedKeys = new Set(used.map((edge) => keyOf(edge.caller, edge.callee)));
  const declaredKeys = new Set(declared.map((edge) => keyOf(edge.caller, edge.callee)));
  const declaredButNeverUsed = declared.filter((edge) => !usedKeys.has(keyOf(edge.caller, edge.callee)));
  const usedButUndeclared = used.filter((edge) => !declaredKeys.has(keyOf(edge.caller, edge.callee)));
  return {
    declaredEdges: [...declared],
    usedEdgeCount: used.length,
    matchedEdgeCount: declared.length - declaredButNeverUsed.length,
    declaredButNeverUsed,
    usedButUndeclared,
  };
}
