/**
 * 数据流水线模型（DataFlowGraph 专用）
 *
 * 把编排阶段重建为一条「数据旅程」：
 *   上游交接 → 入口整装（桥接分发）→ Agent 内部 Skill 链（输入/产出 + 内部流转边）
 *   → 出口交接（交给下一阶段）
 *
 * 事实源与语义（与后端字段路由矩阵一致，不造数据）：
 * - routing 行 = 「agentId 产出的 fieldId，handoff 交给哪些目标」（agentId ∈ skill:* 或 &lt;stage&gt;-agent）
 * - 步骤顺序 = 编排文件 defSteps（服务步骤如实标注 unresolved，与状态条「未解析」同口径）
 * - 调用统计 = 运行时拓扑 skill 节点（liveTopoNodes），桥接 agent 为其下 skill 聚合
 */
import { shortName, type StageDetailLike } from './fieldFlowLayout'

/* ================= 常量 ================= */

export const STAGE_ORDER = ['goal', 'path', 'teaching', 'profile', 'simulation'] as const
export const STAGE_LABELS: Record<string, string> = {
  goal: '澄清', path: '规划', teaching: '教学', profile: '画像', simulation: '仿真',
}

/** 数据族（fieldId 首段）→ 身份色；未收录的按稳定哈希落入调色板 */
const FAMILY_COLORS: Record<string, string> = {
  understanding: '#2c63d0',     // 目标理解 · 蓝
  confirmedProposal: '#0ea5e9', // 确认提案 · 天蓝
  confidenceScores: '#0891b2',  // 置信 · 青
  structuredData: '#2563eb',
  core: '#64748b',              // 会话核心 · 灰
  normalizedInput: '#8b5cf6',   // 标准化输入 · 紫
  cognitiveCore: '#0d9488',     // 认知核心 · 青绿
  milestones: '#059669',        // 里程碑 · 绿
  path: '#16a34a',              // 路径 · 绿
  subtasks: '#65a30d',          // 子任务 · 橄榄
  previousMilestone: '#4d7c0f',
  analysis: '#e11d48',          // 学习者分析 · 玫红
  control: '#dc2626',           // 控制信号 · 红
  knowledge: '#b45309',         // 知识 · 琥珀
  pedagogy: '#d97706',          // 教学法 · 橙
  reply: '#f59e0b',             // 回复语 · 琥珀
  classroomContext: '#7c3aed',  // 课堂上下文 · 紫
  controls: '#9333ea',
  evaluation: '#db2777',        // 学习评估 · 粉
  summary: '#c026d3',           // 课后总结 · 紫红
  learner: '#a21caf',
  visibleDialogueContext: '#6d28d9',
  snapshot: '#1d4ed8',          // 学习者快照 · 靛
  profile: '#4338ca',           // 画像 · 靛蓝
  blockedFoundations: '#b45309',
  conceptLedger: '#ca8a04',
  knowledgeStateSummary: '#92400e',
  recurringConfusions: '#9a3412',
  reusableFoundations: '#a16207',
  transferSignals: '#854d0e',
  personaSeed: '#c2410c',
  consistencyNotes: '#ea580c',
  emotion: '#fb7185',
  learnerFeedback: '#f472b6',
  learnerState: '#be185d',
  memoryDelta: '#9f1239',
  masteredConcepts: '#166534',
  selfCalibration: '#3f6212',
  struggleConcepts: '#7c2d12',
  reaction: '#f43f5e',
  visibleRequestedChanges: '#e11d48',
  evidence: '#57534e',
  findings: '#78716c',
  recommendations: '#a8a29e',
  scores: '#35353a',
  verdict: '#44403c',
  debug: '#94a3b8',
}

/** 兜底调色板（未收录数据族按稳定哈希取色，同一族恒同色） */
const PALETTE = [
  '#2c63d0', '#0d9488', '#d97706', '#7c3aed', '#e11d48',
  '#0ea5e9', '#65a30d', '#9333ea', '#b45309', '#0891b2',
  '#c026d3', '#16a34a', '#dc2626', '#2563eb',
]

/** fieldId → 数据族名（首段；无点号则整体） */
export function familyOf(fieldId: string): string {
  const i = fieldId.indexOf('.')
  return i > 0 ? fieldId.slice(0, i) : fieldId
}

/** 稳定哈希 → 数据族色 */
export function familyHue(family: string): string {
  const known = FAMILY_COLORS[family]
  if (known) return known
  let h = 0
  for (let i = 0; i < family.length; i++) h = (h * 31 + family.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

/** 调用量缩写：2820 → 2.8k */
export function fmtCalls(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}w`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

/* ================= 类型 ================= */

/** 字段卡 = 一条 routing 行的投影（产出方 + 去向）；同一条卡可在多个槽位渲染（产出/输入/出口） */
export interface FlowChip {
  id: string            // `${agentId}\0${fieldId}` —— 全图唯一
  agentId: string       // 产出方（skill:*/<stage>-agent/服务）
  fieldId: string
  short: string         // 展示缩写
  family: string
  hue: string
  description: string
  valueType: string
  role: string
  render: string
  internal: boolean
  accumulate: boolean
  locked: boolean
  lockLevel: string
  handoffTargets: string[]
  pathInRawOutput: string
  persistKey: string
  notes: string
  /** 去向标签（渲染用，按目标归类）：内部 skill / 出口 / 阶段 */
  toTags: Array<{ label: string; target: string; kind: 'skill' | 'bridge' | 'stage' | 'agent' }>
}

export interface FlowStep {
  index: number              // 展示顺序（1 起）
  agentId: string
  kind: 'skill' | 'service' | 'bridge-entry' | 'cross-agent' | 'orphan'
  name: string               // 显示名（resolved 优先）
  role?: string
  loopOver?: string
  condition?: string
  unresolved: boolean
  calls: number | null       // 拓扑统计（有即显示）
  failed: number
  inputs: FlowChip[]         // 流入本步骤的字段（routing.handoff ∋ agentId）
  outputs: FlowChip[]        // 本步骤产出的字段（routing.agentId = agentId / bridge 归属）
  /** 步骤归属阶段（cross-agent 步骤标记来自其它阶段） */
  fromStage?: string
}

export interface FlowEdge {
  id: string
  from: string               // 源 chipId
  to: string                 // 目标 chipId（exit/entry 虚拟槽用固定 id）
  fieldId: string
  hue: string
  kind: 'internal' | 'exit' | 'entry'
}

export interface StageFlow {
  stageId: string
  stageName: string
  agentId: string
  fieldCount: number         // 该阶段字段定义数（去重）
  entry: FlowChip[]          // 上游 → 本阶段的字段（跨阶段）
  entryFrom: { stageId: string; stageName: string } | null
  exit: FlowChip[]           // 本阶段 → 下游的字段（跨阶段）
  exitTo: { stageId: string; stageName: string } | null
  steps: FlowStep[]
  edges: FlowEdge[]
  stats: { calls: number; failed: number; rate: number }
  families: Array<{ name: string; hue: string; count: number }>
}

/* ================= 输入 ================= */

export interface TopoNodeLike {
  id: string
  type: string
  parentAgentId?: string
  stats: { totalCalls: number; failed: number }
}

export interface DefStepLike {
  step?: number
  agentId?: string
  role?: string
  loopOver?: string
  condition?: string
  resolved?: { displayName?: string; kind?: string; unresolved?: boolean }
}

/* ================= 构建 ================= */

function toTagsOf(targets: string[], stageId: string): FlowChip['toTags'] {
  const out: FlowChip['toTags'] = []
  for (const t of targets) {
    if (t === `${stageId}-agent`) {
      out.push({ label: '出口闸口', target: t, kind: 'bridge' })
      continue
    }
    if (t.startsWith('skill:')) {
      out.push({ label: t.replace(/^skill:/, ''), target: t, kind: 'skill' })
      continue
    }
    if (STAGE_ORDER.includes(t as (typeof STAGE_ORDER)[number])) {
      out.push({ label: `交给 ${STAGE_LABELS[t] || t} 阶段`, target: t, kind: 'stage' })
      continue
    }
    out.push({ label: t, target: t, kind: 'agent' })
  }
  return out
}

/** 阶段身份集合：阶段名 / <stage>-agent / 阶段内全部 skill（handoff 目标判定） */
function identityOf(stageId: string, agents: string[]): Set<string> {
  return new Set([stageId, `${stageId}-agent`, ...agents])
}

export function buildStageFlow(
  stageId: string,
  detail: StageDetailLike,
  detailsById: Record<string, StageDetailLike | null>,
  defSteps: DefStepLike[],
  topoNodes: TopoNodeLike[],
  stageNames: Record<string, string>,
): StageFlow {
  const stageName = stageNames[stageId] || STAGE_LABELS[stageId] || stageId
  const agentId = `${stageId}-agent`
  const myAgents = detail.agents.map((a) => a.agentId)
  const myIdentity = identityOf(stageId, myAgents)
  const fieldById = new Map(detail.fields.map((f) => [f.fieldId, f]))

  const chipOf = (r: StageDetailLike['routings'][number]): FlowChip => {
    const f = fieldById.get(r.fieldId)
    return {
      id: `${r.agentId}\0${r.fieldId}`,
      agentId: r.agentId,
      fieldId: r.fieldId,
      short: shortName(r.fieldId),
      family: familyOf(r.fieldId),
      hue: familyHue(familyOf(r.fieldId)),
      description: f?.description || '',
      valueType: f?.valueType || '',
      role: f?.promptRole || '',
      render: r.render,
      internal: r.internal,
      accumulate: r.accumulate,
      locked: r.locks?.level === 'system-locked' || r.locks?.level === 'structure-locked',
      lockLevel: r.locks?.level || 'fully-editable',
      handoffTargets: Array.isArray(r.handoff) ? r.handoff : r.handoff ? [r.handoff] : [],
      pathInRawOutput: f?.pathInRawOutput || '',
      persistKey: f?.persistKey || '',
      notes: r.notes || '',
      toTags: toTagsOf(Array.isArray(r.handoff) ? r.handoff : r.handoff ? [r.handoff] : [], stageId),
    }
  }

  const allRoutings = detail.routings.map(chipOf)

  /* ----- 入口：其它阶段 handoff 指向本阶段身份（阶段名 / agent / 阶段内 skill） ----- */
  const entry: FlowChip[] = []
  let entryFrom: StageFlow['entryFrom'] = null
  for (const sid of STAGE_ORDER) {
    if (sid === stageId) continue
    const d = detailsById[sid]
    if (!d) continue
    for (const r of d.routings) {
      const targets = Array.isArray(r.handoff) ? r.handoff : r.handoff ? [r.handoff] : []
      if (!targets.some((t) => myIdentity.has(t))) continue
      entry.push(chipOf(r))
    }
    if (entry.length && !entryFrom) {
      entryFrom = { stageId: sid, stageName: stageNames[sid] || STAGE_LABELS[sid] || sid }
    }
  }
  // entry 去重（同字段可能被多目标命中同一来源？按 id 去重）
  const entryUnique = new Map<string, FlowChip>()
  for (const c of entry) entryUnique.set(c.id, c)

  /* ----- 出口：本阶段基座 agent 交接给其它阶段的字段 ----- */
  const bridgeChips = allRoutings.filter((c) => c.agentId === agentId)
  const exit: FlowChip[] = []
  let exitTo: StageFlow['exitTo'] = null
  for (const c of bridgeChips) {
    const cross = c.handoffTargets.find((t) => STAGE_ORDER.includes(t as (typeof STAGE_ORDER)[number]) && t !== stageId)
    if (!cross) continue
    exit.push(c)
    if (!exitTo) exitTo = { stageId: cross, stageName: stageNames[cross] || STAGE_LABELS[cross] || cross }
  }
  // 链尾阶段：桥接 agent 只吸收不转交（累积进学习者状态），「出口闸口」标签改为「链尾累积」
  if (!exitTo) {
    for (const c of allRoutings) {
      for (const t of c.toTags) {
        if (t.kind === 'bridge') t.label = '链尾累积'
      }
    }
  }

  /* ----- 步骤：编排 defSteps 顺序（服务/跨阶段步骤如实展示） ----- */
  const stepAgents = new Set(detail.agents.filter((a) => a.agentId !== agentId).map((a) => a.agentId))
  /** 桥接分发字段：闸口 → 内部 Skill（如 normalizedInput.* → skills）；跨阶段只进出口卡 */
  const bridgeDistribute = bridgeChips.filter((c) => c.handoffTargets.some((t) => stepAgents.has(t)))
  /** 跨阶段引用：步骤 agent 归属其它阶段（仿真链会内嵌 path-agent / teaching-agent） */
  const ownerStageOf = (a: string): string | null => {
    for (const sid of STAGE_ORDER) {
      if (sid === stageId) continue
      const d = detailsById[sid]
      if (d?.agents?.some((x) => x.agentId === a)) return sid
    }
    return null
  }
  const defList: DefStepLike[] = Array.isArray(defSteps) ? defSteps : []
  const stepOrder: Array<{ agentId: string; def?: DefStepLike }> = []
  const seen = new Set<string>()
  // 桥接分发步骤：bridge 直连内部 skill 的字段（如 normalizedInput.* → skills）
  if (bridgeDistribute.length) {
    stepOrder.push({ agentId })
    seen.add(agentId)
  }
  for (const d of defList) {
    const a = d.agentId || ''
    if (!a || seen.has(a)) continue
    stepOrder.push({ agentId: a, def: d })
    seen.add(a)
  }
  for (const a of stepAgents) {
    if (seen.has(a)) continue
    stepOrder.push({ agentId: a })
    seen.add(a)
  }

  const steps: FlowStep[] = []
  const statBySkill = new Map<string, { totalCalls: number; failed: number }>()
  for (const n of topoNodes) {
    if (n.type !== 'skill') continue
    const bare = n.id.replace(/^skill:/, '')
    statBySkill.set(bare, { totalCalls: n.stats.totalCalls, failed: n.stats.failed })
  }
  const aggregateOf = (parent: string) => {
    let calls = 0
    let failed = 0
    let found = false
    for (const n of topoNodes) {
      if (n.type !== 'skill' || n.parentAgentId !== parent) continue
      calls += n.stats.totalCalls
      failed += n.stats.failed
      found = true
    }
    return found ? { calls, failed } : null
  }

  stepOrder.forEach((item, i) => {
    const a = item.agentId
    const def = item.def
    const isBridge = a === agentId
    const isSkill = stepAgents.has(a)
    // 闸口卡只显示「分发给内部 Skill」的字段；跨阶段行为出口卡内容，不混入
    const outputs = isBridge ? bridgeDistribute : allRoutings.filter((c) => c.agentId === a)
    // 输入：跳过桥接派生（闸口只分发不消费），其它步骤 = 路由指向本步骤的字段
    const inputs = isBridge
      ? []
      : allRoutings.filter((c) => c.agentId !== a && c.handoffTargets.includes(a))
    let calls: number | null = null
    let failed = 0
    if (isSkill) {
      const st = statBySkill.get(a.replace(/^skill:/, ''))
      if (st) { calls = st.totalCalls; failed = st.failed }
    } else if (isBridge) {
      const agg = aggregateOf(agentId)
      if (agg) { calls = agg.calls; failed = agg.failed }
    }
    const resolvedName = def?.resolved?.displayName || ''
    const owner = isSkill || isBridge ? undefined : ownerStageOf(a)
    // orphan：已注册 agent（agents 清单/拓扑统计），但无字段契约（0 routing 行）且不在 defSteps
    // 如实呈现为「无契约 Skill」：保留调用统计（健康信号），标注 no-contract 而非误导性「0 产出」
    const isOrphan = isSkill && !outputs.length && !inputs.length && !def
    const kind = isBridge ? 'bridge-entry' as const
      : isOrphan ? 'orphan' as const
        : isSkill ? 'skill' as const
          : owner ? 'cross-agent' as const
            : (def?.resolved?.kind === 'service' ? 'service' as const : 'skill' as const)
    const name = isBridge ? `${stageName}闸口` : resolvedName || a.replace(/^skill:/, '')
    steps.push({
      index: i + 1,
      agentId: a,
      kind,
      name,
      role: def?.role,
      loopOver: def?.loopOver,
      condition: def?.condition,
      unresolved: Boolean(def?.resolved?.unresolved),
      calls,
      failed,
      inputs,
      outputs,
      fromStage: owner || undefined,
    })
  })

  /* ----- 边：内部流转（产出 chip → 消费 chip 副本）+ 出口聚合（产出 chip → 出口 chip） ----- */
  const edges: FlowEdge[] = []
  const edgeSeen = new Set<string>()
  const addEdge = (from: string, to: string, fieldId: string, hue: string, kind: FlowEdge['kind']) => {
    const id = `${from}→${to}`
    if (edgeSeen.has(id)) return
    edgeSeen.add(id)
    edges.push({ id, from, to, fieldId, hue, kind })
  }
  for (const c of allRoutings) {
    if (c.agentId === agentId) continue // 桥接分发边由入口/步骤槽位表达，不画
    const exitChip = exit.find((x) => x.fieldId === c.fieldId)
    const targets = new Set(c.handoffTargets)
    for (const t of targets) {
      if (stepAgents.has(t)) addEdge(c.id, c.id, c.fieldId, c.hue, 'internal') // 同 chip 槽位间连线
    }
    if (targets.has(agentId) && exitChip) {
      addEdge(c.id, exitChip.id, c.fieldId, c.hue, 'exit')
    }
  }
  // 入口 → 桥接闸口：语义连接（入口字段经闸口整装后分发给内部 skill）
  for (const c of entryUnique.values()) {
    if (bridgeDistribute.length) addEdge(c.id, `${agentId}\0__gate__`, c.fieldId, c.hue, 'entry')
  }

  /* ----- 汇总 ----- */
  // 数据族计数按字段去重（同一字段被多个 agent 产出/路由只计一次；goal 无跨 agent 时 = 定义数）
  const familiesMap = new Map<string, { hue: string; count: number }>()
  for (const r of detail.routings) {
    const fam = familyOf(r.fieldId)
    if (!familiesMap.has(fam)) {
      // 字段计数 = 该数据族在「字段定义」中的出现数（跨产出方去重）
      const uniq = new Set(detail.fields.filter((f) => familyOf(f.fieldId) === fam).map((f) => f.fieldId))
      familiesMap.set(fam, { hue: familyHue(fam), count: uniq.size })
    }
  }
  const stat = aggregateOf(agentId)
  return {
    stageId,
    stageName,
    agentId,
    fieldCount: detail.fields.length,
    entry: [...entryUnique.values()],
    entryFrom,
    exit,
    exitTo,
    steps,
    edges,
    stats: {
      calls: stat?.calls ?? 0,
      failed: stat?.failed ?? 0,
      rate: stat?.calls ? Math.round((stat.failed / stat.calls) * 1000) / 10 : 0,
    },
    families: [...familiesMap.entries()].sort((a, b) => b[1].count - a[1].count).map(([name, v]) => ({ name, hue: v.hue, count: v.count })),
  }
}
