/**
 * 字段级运行时命中率 → 逻辑图（字段数据旅程）join —— **纯函数**，不触库、不读盘。
 *
 * 背景（Q9 后半程）：`field-hit-rates.ts` 已能把 `prompt_call_logs` 聚合成每个 skill
 * 的声明 / 观测字段命中率；本模块把该**已聚合**结果贴到 admin 逻辑图（DataFlowGraph）
 * 的字段节点（= routing 行）与 routing 边上，供前端渲染：
 *   - 字段芯片颜色 ← status（produced=默认 / dead=灰虚线 / drift=琥珀）
 *   - tooltip      ← hits / totalCalls / hitRate
 *   - routing 边   ← 产出字段为死字段 / routing 根从未产出时标为死边
 *
 * 口径（与 field-hit-rates / audit-field-hit-rates 一致）：
 *   - routing.agentId = 产出方（`skill:<skillId>`；非 skill 产出方无力字段统计）
 *   - routing.fieldId 首段（去数组后缀 `[]`）= 命中率聚合的顶层键（core `fields[].name`）
 *   - 死边判定：root 命中数 0 且（root 是 core 声明字段 → declared-field-zero-hits；
 *     否则若非平台豁免根 → routing-root-not-observed）；豁免根由调用方注入
 *
 * 设计为纯定位：聚合由 `aggregateFieldHitRates` 负责，本模块只做确定性 join，
 * 便于单测与路由层复用。DB / YAML 读取由调用方（routes/admin/platform.ts）负责。
 */
import {
  skillIdFromAgentId,
  type FieldHitRateEntry,
  type FieldHitRatesResult,
} from './field-hit-rates';

/** 字段运行时状态：产出 / 死字段（声明但零产出，或 routing 根从未观测）/ 契约漂移（产出但未声明） */
export type FieldRuntimeStatus = 'produced' | 'dead' | 'drift';

/** 逻辑图字段节点（与前端 FlowChip 的产出方 + 字段同构） */
export interface FieldNodeLike {
  agentId: string;
  fieldId: string;
}

/** 逻辑图 routing 边（字段从产出方 handoff 到下游目标） */
export interface RoutingEdgeLike extends FieldNodeLike {
  id?: string;
  handoff?: readonly string[];
  stage?: string;
}

/** 贴到字段节点上的运行时统计 */
export interface FieldRuntimeStats {
  /** 产出方 skillId（不含 `skill:` 前缀）；非 skill 产出方为 null */
  skillId: string | null;
  /** fieldId 首段（去 `[]`），与命中率聚合顶层键同口径 */
  root: string;
  /** 是否在 core.yaml 中声明 */
  declared: boolean;
  /** 窗口内出现该字段的调用数 */
  hits: number;
  /** hits / totalCalls（0..1，保留 4 位） */
  hitRate: number;
  /** 该 skill 窗口内总调用数（tooltip 用） */
  totalCalls: number;
  status: FieldRuntimeStatus;
}

export type FieldNodeWithStats<T extends FieldNodeLike> = T & { fieldStats: FieldRuntimeStats };

export type DeadRoutingEdgeReason = 'declared-field-zero-hits' | 'routing-root-not-observed';

/** 贴到 routing 边上的运行时标记 */
export interface RoutingEdgeStats {
  dead: boolean;
  status: FieldRuntimeStatus;
  reason: DeadRoutingEdgeReason | null;
}

export type RoutingEdgeWithStats<T extends RoutingEdgeLike> = T & { routingStats: RoutingEdgeStats };

/** 死边候选（供前端 / 审计展示；与 audit-field-hit-rates 同口径） */
export interface DeadRoutingEdge {
  id: string;
  skillId: string | null;
  agentId: string;
  fieldId: string;
  root: string;
  handoff: string[];
  stage?: string;
  reason: DeadRoutingEdgeReason;
}

/** 单 skill 字段命中率摘要（响应 `fieldStats.skills[]`，字段明细在扁平 `fields[]`） */
export interface SkillFieldSummary {
  skillId: string;
  agentId: string;
  totalCalls: number;
  parsedCalls: number;
  unparsedCalls: number;
  declaredFieldCount: number;
  producedFieldCount: number;
  /** 声明但窗口内零产出（保持声明顺序） */
  deadFields: string[];
  /** 产出但 core 未声明（按字段名升序） */
  driftFields: string[];
}

interface SkillRateIndexEntry {
  totalCalls: number;
  byField: Map<string, FieldHitRateEntry>;
}

/** fieldId → 顶层键（首段，去数组后缀 `[]`），与 field-hit-rates 聚合键同口径 */
export function fieldRoot(fieldId: string): string {
  if (typeof fieldId !== 'string') return '';
  const trimmed = fieldId.trim();
  if (!trimmed) return '';
  const head = trimmed.split('.')[0];
  return head.replace(/\[\]$/, '');
}

function buildRateIndex(rates: FieldHitRatesResult | null | undefined): Map<string, SkillRateIndexEntry> {
  const index = new Map<string, SkillRateIndexEntry>();
  for (const skill of rates?.skills ?? []) {
    const byField = new Map<string, FieldHitRateEntry>();
    for (const entry of skill.fields) byField.set(entry.field, entry);
    index.set(skill.skillId, { totalCalls: skill.totalCalls, byField });
  }
  return index;
}

/**
 * 单字段状态推导（确定性）：
 * - 观测到且未声明 → drift（漂移）
 * - 命中 > 0 → produced
 * - 其余（声明零命中 / 声明与观测均无该字段）→ dead
 */
function statForNode(node: FieldNodeLike, index: Map<string, SkillRateIndexEntry>): FieldRuntimeStats {
  const skillId = skillIdFromAgentId(node.agentId);
  const root = fieldRoot(node.fieldId);
  const bucket = skillId ? index.get(skillId) : undefined;
  const entry = root ? bucket?.byField.get(root) : undefined;
  const declared = entry?.declared ?? false;
  const hits = entry?.hits ?? 0;
  const hitRate = entry?.hitRate ?? 0;
  const totalCalls = bucket?.totalCalls ?? 0;
  const status: FieldRuntimeStatus = entry && !entry.declared ? 'drift' : hits > 0 ? 'produced' : 'dead';
  return { skillId, root, declared, hits, hitRate, totalCalls, status };
}

/**
 * 把**已聚合**的字段命中率贴到逻辑图字段节点上（纯 join）。
 * 每个节点新增 `fieldStats`；无对应 skill / 字段时按死字段零值处理（向后兼容、不抛错）。
 * 输出顺序与入参一致（确定性，可测）。
 */
export function attachFieldStats<T extends FieldNodeLike>(
  nodes: readonly T[],
  rates: FieldHitRatesResult | null | undefined,
): Array<FieldNodeWithStats<T>> {
  const index = buildRateIndex(rates);
  return nodes.map((node) => ({ ...node, fieldStats: statForNode(node, index) }));
}

function normalizeHandoff(value: readonly string[] | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((target): target is string => typeof target === 'string' && target.trim().length > 0)
    .map((target) => target.trim());
}

/**
 * 标记 routing 边是否为死边（纯 join，确定性）。
 * - 产出字段 status ∈ {produced, drift} → 存活；
 * - root 声明但零命中 → `declared-field-zero-hits`；
 * - root 从未观测且非平台豁免根 → `routing-root-not-observed`；
 * - 未观测但属平台豁免根（path/userVisible/core/...）→ 存活（reason=null）。
 */
export function markRoutingEdges<T extends RoutingEdgeLike>(
  edges: readonly T[],
  rates: FieldHitRatesResult | null | undefined,
  exemptRoots: ReadonlySet<string> = new Set<string>(),
): Array<RoutingEdgeWithStats<T>> {
  const index = buildRateIndex(rates);
  return edges.map((edge) => {
    const stat = statForNode(edge, index);
    let reason: DeadRoutingEdgeReason | null = null;
    if (stat.status !== 'produced' && stat.status !== 'drift') {
      if (stat.declared) reason = 'declared-field-zero-hits';
      else if (stat.root && !exemptRoots.has(stat.root)) reason = 'routing-root-not-observed';
    }
    return { ...edge, routingStats: { dead: reason !== null, status: stat.status, reason } };
  });
}

/** 从 routing 边集合中筛出死边候选，按 (agentId, fieldId, stage) 升序（确定性） */
export function collectDeadRoutingEdges<T extends RoutingEdgeLike>(
  edges: readonly T[],
  rates: FieldHitRatesResult | null | undefined,
  exemptRoots: ReadonlySet<string> = new Set<string>(),
): DeadRoutingEdge[] {
  const out: DeadRoutingEdge[] = [];
  for (const edge of markRoutingEdges(edges, rates, exemptRoots)) {
    if (!edge.routingStats.dead || !edge.routingStats.reason) continue;
    out.push({
      id: edge.id || `${edge.agentId}\0${edge.fieldId}`,
      skillId: skillIdFromAgentId(edge.agentId),
      agentId: edge.agentId,
      fieldId: edge.fieldId,
      root: fieldRoot(edge.fieldId),
      handoff: normalizeHandoff(edge.handoff),
      stage: edge.stage,
      reason: edge.routingStats.reason,
    });
  }
  return out.sort(
    (a, b) =>
      (a.skillId || '').localeCompare(b.skillId || '') ||
      a.fieldId.localeCompare(b.fieldId) ||
      (a.stage || '').localeCompare(b.stage || ''),
  );
}

/** 聚合结果 → 单 skill 摘要（字段明细由 `attachFieldStats` 的扁平 `fields[]` 承载） */
export function toSkillSummaries(rates: FieldHitRatesResult | null | undefined): SkillFieldSummary[] {
  return (rates?.skills ?? []).map((skill) => ({
    skillId: skill.skillId,
    agentId: skill.agentId,
    totalCalls: skill.totalCalls,
    parsedCalls: skill.parsedCalls,
    unparsedCalls: skill.unparsedCalls,
    declaredFieldCount: skill.declaredFields.length,
    producedFieldCount: skill.fields.filter((entry) => entry.hits > 0).length,
    deadFields: [...skill.deadFields],
    driftFields: skill.driftFields.map((entry) => entry.field),
  }));
}
