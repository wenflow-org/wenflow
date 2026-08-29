/**
 * 字段流转图共享布局（FieldFlowGraph / Topology 运行时视图共用）
 *
 * 泳道 = 阶段（goal/path/teaching/profile/simulation），字段按产出 Skill 分组，
 * 组/字段全部绝对定位（top = JS 坐标），边线锚点与卡片位置严格一致。
 */

/* ================= 常量 ================= */
export const LANE_W = 380
export const LANE_GAP = 24
export const LANE_X0 = 16
export const HEAD_H = 48
export const GROUP_H = 30
export const FIELD_H = 34
export const FIELD_GAP = 8
export const FIELD_X = 12
export const FIELD_W = LANE_W - FIELD_X * 2
export const PAD_BOTTOM = 24
export const PAD_TOP = 14
/** 组级视图：组头下保留的字段预览数量（其余折叠为 +N 更多） */
export const PREVIEW_N = 2

export const STAGE_ORDER = ['goal', 'path', 'teaching', 'profile', 'simulation'] as const
export const STAGE_LABELS: Record<string, string> = {
  goal: '澄清', path: '规划', teaching: '教学', profile: '画像', simulation: '仿真',
}

/* ================= 类型 ================= */
export interface FlowField {
  id: string
  fieldId: string
  agentId: string
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
}
export interface FlowGroup {
  agentId: string
  bridge: boolean
  description: string
  fields: FlowField[]
}
export interface FlowStage {
  id: string
  order: string
  name: string
  agentId: string
  fieldCount: number
  groups: FlowGroup[]
}

/** 布局产物：泳道绝对坐标 + 组/字段 top（相对泳道顶部） */
export interface SlotLayout {
  agentId: string
  bridge: boolean
  fields: Array<{ field: FlowField; y: number }>
  foldedCount: number
  headY: number
}
export interface StageLayout {
  stage: FlowStage
  x: number
  slots: SlotLayout[]
  laneHeight: number
}
export interface EdgeGeom {
  d: string
  stroke: string
  width: number
  dashed: boolean
  from: string
  to: string
}

/** 次要角色（可选补充/控制信号/派生展示）默认折叠 */
export const FOLD_ROLES = new Set(['soft-info', 'control-signal', 'derived-presentation'])
export const minorRole = (f: FlowField) => FOLD_ROLES.has(f.role)

/** 长字段名缩写：保留前 2 段 + 末段 */
export function shortName(fieldId: string) {
  const parts = fieldId.split('.')
  if (parts.length <= 3) return fieldId
  return `${parts.slice(0, 2).join('.')}…${parts[parts.length - 1]}`
}

/** skill:<id> / <stage>-agent / 阶段名 → 阶段 id */
export function stageOfTarget(target: string): string | null {
  if (STAGE_ORDER.includes(target as (typeof STAGE_ORDER)[number])) return target
  const bare = target.replace(/^skill:/, '')
  const bySkill: Record<string, string> = {
    'goal-conversation': 'goal',
    'path-planning': 'path',
    'stage-designer': 'path',
    'teaching-turn': 'teaching',
    'peer-reinforcement': 'teaching',
    'session-wrapup': 'teaching',
    'adaptive-guidance-copy': 'teaching',
    'learner-model': 'profile',
    'lesson-knowledge-enricher': 'profile',
    'virtual-learner-goal-dialogue-simulator': 'simulation',
    'virtual-learner-path-evaluator': 'simulation',
    'virtual-learner-learn-turn-simulator': 'simulation',
    'virtual-learner-referee': 'simulation',
    'virtual-learner-actor-auditor': 'simulation',
    'virtual-learner-persona-designer': 'simulation',
    'virtual-learner-scenario-designer': 'simulation',
  }
  if (bySkill[bare]) return bySkill[bare]
  for (const s of STAGE_ORDER) {
    if (target === `${s}-agent`) return s
  }
  return null
}

/**
 * 计算泳道布局。
 * @param stages 全阶段（有数据的阶段才传）
 * @param isBridgeCollapsed 桥接组是否折叠（<stage>-agent）
 * @param isMinorExpanded 次要字段组是否展开（按 agentId）
 * @param groupsCollapsed 非桥接 Skill 组是否折叠（组级视图：默认只显示组头，点组头展开该组字段）
 */
export function computeLayouts(
  stages: FlowStage[],
  isBridgeCollapsed: (agentId: string) => boolean,
  isMinorExpanded: (agentId: string) => boolean,
  groupsCollapsed: (agentId: string) => boolean = () => false,
): StageLayout[] {
  const out: StageLayout[] = []
  let x = LANE_X0
  for (const st of stages) {
    let y = PAD_TOP + HEAD_H
    const slots: SlotLayout[] = []
    for (const g of st.groups) {
      const fieldSlots: SlotLayout['fields'] = []
      let foldedCount = 0
      const headY = y
      y += GROUP_H
      if (g.fields.length) {
        for (const f of g.fields) {
          const foldBridge = g.bridge && isBridgeCollapsed(g.agentId)
          // 组级折叠：保留前 PREVIEW_N 个字段作预览，其余折叠（预览字段不再被次要角色折叠）
          const idx = g.fields.indexOf(f)
          const foldGroup = !g.bridge && groupsCollapsed(g.agentId) && idx >= PREVIEW_N
          const foldMinor = !g.bridge && !groupsCollapsed(g.agentId) && minorRole(f) && !isMinorExpanded(g.agentId)
          if (foldBridge || foldMinor || foldGroup) {
            foldedCount++
            continue
          }
          fieldSlots.push({ field: f, y })
          y += FIELD_H + FIELD_GAP
        }
      }
      // 组级折叠且还有折叠字段：组尾预留 "+N 更多" 按钮空间（避免按钮压到下一组）
      if (foldedCount > 0 && !g.bridge && groupsCollapsed(g.agentId)) {
        y += 22
      }
      slots.push({ agentId: g.agentId, bridge: g.bridge, fields: fieldSlots, foldedCount, headY })
    }
    out.push({ stage: st, x, slots, laneHeight: y + PAD_BOTTOM })
    x += LANE_W + LANE_GAP
  }
  return out
}

export const canvasW = (layouts: StageLayout[]) =>
  layouts.length ? LANE_X0 * 2 + layouts.length * LANE_W + (layouts.length - 1) * LANE_GAP : 400
export const canvasH = (layouts: StageLayout[]) => Math.max(560, ...layouts.map((l) => l.laneHeight))

/* ================= 阶段聚焦共享（FieldFlowGraph / Topology 运行时视图共用） ================= */
export const ANCHOR_W = 240
export const ANCHOR_X0 = 16
export const ANCHOR_GAP = 24
/** 锚点列起始 y（对齐泳道组头下方） */
export const ANCHOR_Y0 = PAD_TOP + HEAD_H + 34
/** 聚焦模式下泳道 x（右移让出左锚点列） */
export const focusLaneX = ANCHOR_X0 + ANCHOR_W + ANCHOR_GAP
/** 聚焦画布宽（左锚点列 + 泳道 + 右锚点列） */
export const focusCanvasW = ANCHOR_X0 * 2 + ANCHOR_W * 2 + LANE_W + ANCHOR_GAP * 2

export interface FocusAnchor {
  id: string
  label: string
  sub: string
  stageId: string
  kind: 'field' | 'agent'
  y: number
  handoffTargets: string[]
  /** 聚合卡：指向本卡的字段数（上游）/ 本卡承接的字段数（下游） */
  fieldCount: number
}

/** 当前阶段身份集合：阶段名 / <stage>-agent / 所有组 agentId（handoff 目标匹配） */
export function focusIdentityOf(stages: FlowStage[], focusStageId: string): Set<string> {
  const st = stages.find((s) => s.id === focusStageId)
  const ids = new Set<string>()
  if (st) {
    ids.add(st.id)
    ids.add(st.agentId)
    for (const g of st.groups) ids.add(g.agentId)
  }
  return ids
}

/** 摘要卡行高（两行卡：agent 名 + 字段/统计行） */
export const FLOW_CARD_H = 64
export const FLOW_GAP = 12

/**
 * 上下游流量摘要（聚合版）：上游=来源 agent → 本阶段的字段流（按 agent 聚合，
 * handoff 本就是 agent 级，聚合卡比逐字段罗列更诚实也更干净）；下游=本阶段 → 目标 agent。
 */
export function computeFocusAnchors(
  stages: FlowStage[],
  focusStageId: string,
): { upItems: FocusAnchor[]; downItems: FocusAnchor[]; upH: number; downH: number } {
  const ids = focusIdentityOf(stages, focusStageId)
  // 上游：按来源 agent 聚合
  const upMap = new Map<string, { agentId: string; stage: FlowStage; targets: Set<string>; fieldCount: number }>()
  for (const s of stages) {
    if (s.id === focusStageId) continue
    for (const g of s.groups) for (const f of g.fields) {
      const hits = f.handoffTargets.filter((t) => ids.has(t))
      if (!hits.length) continue
      let entry = upMap.get(g.agentId)
      if (!entry) {
        entry = { agentId: g.agentId, stage: s, targets: new Set(), fieldCount: 0 }
        upMap.set(g.agentId, entry)
      }
      for (const t of hits) entry.targets.add(t)
      entry.fieldCount++
    }
  }
  const upItems: FocusAnchor[] = []
  let yUp = ANCHOR_Y0
  for (const entry of upMap.values()) {
    upItems.push({
      id: entry.agentId,
      label: entry.agentId.replace(/^skill:/, '').replace(/-agent$/, ''),
      sub: entry.stage.name,
      stageId: entry.stage.id,
      kind: 'agent',
      y: yUp,
      handoffTargets: [...entry.targets],
      fieldCount: entry.fieldCount,
    })
    yUp += FLOW_CARD_H + FLOW_GAP
  }
  // 下游：按目标 agent 聚合（统计承接字段数）
  const downMap = new Map<string, FocusAnchor>()
  let yDown = ANCHOR_Y0
  const cur = stages.find((s) => s.id === focusStageId)
  if (cur) {
    for (const g of cur.groups) for (const f of g.fields) {
      for (const t of f.handoffTargets) {
        const tStage = stageOfTarget(t)
        if (!tStage || tStage === focusStageId) continue
        let item = downMap.get(t)
        if (!item) {
          const st = stages.find((s) => s.id === tStage)
          item = {
            id: t,
            label: t.replace(/^skill:/, '').replace(/-agent$/, ''),
            sub: st?.name || tStage,
            stageId: tStage,
            kind: 'agent',
            y: yDown,
            handoffTargets: [],
            fieldCount: 0,
          }
          downMap.set(t, item)
          yDown += FLOW_CARD_H + FLOW_GAP
        }
        item.fieldCount++
      }
    }
  }
  return {
    upItems,
    downItems: [...downMap.values()],
    upH: yUp + 24,
    downH: yDown + 24,
  }
}

/** 聚焦跨列边：上游锚点 → 当前阶段目标组（蓝实线）；当前字段/折叠组头 → 下游锚点（灰虚线） */
export function computeFocusEdges(
  lane: StageLayout,
  upItems: FocusAnchor[],
  downItems: FocusAnchor[],
): EdgeGeom[] {
  const out: EdgeGeom[] = []
  const layouts = [lane]
  const rightX = focusLaneX + LANE_W + ANCHOR_GAP
  for (const item of upItems) {
    const from = { x: focusLaneX - ANCHOR_GAP, y: item.y + 17 }
    for (const t of item.handoffTargets) {
      const to = targetAnchor(layouts, t)
      if (!to) continue
      const midX = (from.x + to.x) / 2
      out.push({
        d: `M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`,
        stroke: '#2c63d0', width: 1.3, dashed: false,
        from: item.id, to: t,
      })
    }
  }
  for (const slot of lane.slots) {
    for (const fs of slot.fields) {
      const fp = fieldPos(lane, fs)
      for (const t of fs.field.handoffTargets) {
        const tStage = stageOfTarget(t)
        if (!tStage || tStage === lane.stage.id) continue
        const item = downItems.find((d) => d.id === t)
        if (!item) continue
        const to = { x: rightX, y: item.y + 17 }
        const midX = (fp.x + fp.w + to.x) / 2
        out.push({
          d: `M ${fp.x + fp.w} ${fp.cy} C ${midX} ${fp.cy}, ${midX} ${to.y}, ${to.x} ${to.y}`,
          stroke: '#8aa6d8', width: 1.2, dashed: true,
          from: fs.field.fieldId, to: t,
        })
      }
    }
    // 折叠组（桥接/次要）：组头右缘 → 下游锚点（聚合，按目标去重）
    if (slot.foldedCount > 0 && slot.fields.length === 0) {
      const from = { x: focusLaneX + LANE_W - 12, y: slot.headY + 15 }
      const fullGroup = lane.stage.groups.find((g) => g.agentId === slot.agentId)
      const seen = new Set<string>()
      for (const f of fullGroup?.fields || []) {
        for (const t of f.handoffTargets) {
          const tStage = stageOfTarget(t)
          if (!tStage || tStage === lane.stage.id || seen.has(t)) continue
          seen.add(t)
          const item = downItems.find((d) => d.id === t)
          if (!item) continue
          const to = { x: rightX, y: item.y + 17 }
          const midX = (from.x + to.x) / 2
          out.push({
            d: `M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`,
            stroke: '#8aa6d8', width: 1.2, dashed: true,
            from: slot.agentId, to: t,
          })
        }
      }
    }
  }
  return out
}

export function fieldPos(layout: StageLayout, f: { y: number }) {
  return {
    x: layout.x + FIELD_X,
    y: f.y,
    w: FIELD_W,
    h: FIELD_H,
    cx: layout.x + FIELD_X + FIELD_W / 2,
    cy: f.y + FIELD_H / 2,
  }
}

/** 目标 → 目标泳道内的锚点（找与目标同 id 的组；折叠组锚到组头右缘） */
export function targetAnchor(layouts: StageLayout[], target: string): { x: number; y: number } | null {
  const tStage = stageOfTarget(target)
  if (!tStage) return null
  const lane = layouts.find((l) => l.stage.id === tStage)
  if (!lane) return null
  const slot = lane.slots.find((s) => s.agentId === target || (target.startsWith('skill:') && s.agentId === target))
  if (slot) {
    if (slot.fields.length) {
      const first = slot.fields[0]
      return { x: lane.x + FIELD_X + FIELD_W / 2, y: first.y + FIELD_H / 2 }
    }
    return { x: lane.x + LANE_W - 10, y: slot.headY + GROUP_H / 2 }
  }
  return { x: lane.x + LANE_W / 2, y: PAD_TOP + HEAD_H + 20 }
}

/** 泳道/边：跨阶段边 + 段内桥接边 + 折叠组聚合边 */
export function computeEdges(layouts: StageLayout[]): EdgeGeom[] {
  const out: EdgeGeom[] = []
  if (!layouts.length) return out
  for (const lane of layouts) {
    for (const slot of lane.slots) {
      // 折叠组（桥接/次要）：聚合锚点引跨阶段边（锚点 = 折叠组头右缘，与 targetAnchor 同款坐标）
      const folded = slot.fields.length === 0 && slot.foldedCount > 0
      if (folded) {
        const from = { x: lane.x + LANE_W - 12, y: slot.headY + GROUP_H / 2 }
        const fullGroup = lane.stage.groups.find((g) => g.agentId === slot.agentId)
        const targets = new Set<string>()
        for (const f of fullGroup?.fields || []) {
          for (const t of f.handoffTargets) {
            const tStage = stageOfTarget(t)
            if (tStage && tStage !== lane.stage.id) targets.add(t)
          }
        }
        for (const t of targets) {
          const to = targetAnchor(layouts, t)
          if (!to) continue
          const midX = (from.x + to.x) / 2
          out.push({
            d: `M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`,
            stroke: '#8aa6d8',
            width: 1.2,
            dashed: true,
            from: slot.agentId,
            to: t,
          })
        }
        continue
      }
      for (const fs of slot.fields) {
        for (const t of fs.field.handoffTargets) {
          const tStage = stageOfTarget(t)
          if (!tStage) continue
          const from = fieldPos(lane, fs)
          if (tStage === lane.stage.id) {
            const tSlot = lane.slots.find((s) => s.agentId === t)
            if (tSlot) {
              if (tSlot.fields.length) {
                const first = tSlot.fields[0]
                const to = { x: lane.x + FIELD_X + FIELD_W / 2, y: first.y - 6 }
                out.push({
                  d: `M ${from.cx} ${from.cy} C ${from.cx} ${from.cy + 26}, ${to.x} ${to.y - 26}, ${to.x} ${to.y}`,
                  stroke: '#2c63d0',
                  width: 1.4,
                  dashed: fs.field.render === 'hidden',
                  from: fs.field.fieldId,
                  to: t,
                })
              }
              // 目标组折叠（桥接/次要）：不画字段→折叠组头的放射边（折叠态由聚合边表达，
              // 避免蜘蛛网；展开后自然出现段内边）
            }
            continue
          }
          const to = targetAnchor(layouts, t)
          if (!to) continue
          const midX = (from.cx + to.x) / 2
          out.push({
            d: `M ${from.cx} ${from.cy} C ${midX} ${from.cy}, ${midX} ${to.y}, ${to.x} ${to.y}`,
            stroke: '#2c63d0',
            width: 1.5,
            dashed: fs.field.render === 'hidden',
            from: fs.field.fieldId,
            to: t,
          })
        }
      }
    }
  }
  return out
}

/** 从路由行组装 FlowStage（供字段图 / 运行时视图共用） */
export interface StageDetailLike {
  stage: string
  fields: Array<{
    fieldId: string
    valueType?: string
    promptRole?: string
    description?: string | null
    pathInRawOutput?: string | null
    persistKey?: string | null
  }>
  agents: Array<{ agentId: string; description?: string }>
  routings: Array<{
    agentId: string
    fieldId: string
    render: string
    handoff: string | string[] | null
    internal: boolean
    accumulate: boolean
    locks?: { level?: string }
    notes?: string | null
  }>
}

export function parseHandoff(raw: string | string[] | null): string[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

export function buildStage(s: string, d: StageDetailLike): FlowStage {
  const fieldById = new Map(d.fields.map((f) => [f.fieldId, f]))
  const byAgent = new Map<string, StageDetailLike['routings']>()
  for (const r of d.routings) {
    const list = byAgent.get(r.agentId) || []
    list.push(r)
    byAgent.set(r.agentId, list)
  }
  const agentOrder = (a: string) => (a.startsWith('skill:') ? 0 : 1)
  const groups: FlowGroup[] = [...byAgent.entries()]
    .sort((a, b) => agentOrder(a[0]) - agentOrder(b[0]) || a[0].localeCompare(b[0]))
    .map(([agentId, routings]) => {
      const bridge = agentId.endsWith('-agent') && !agentId.startsWith('skill:')
      const fields: FlowField[] = routings
        .map((r): FlowField => {
          const f = fieldById.get(r.fieldId)
          return {
            id: `${agentId}\0${r.fieldId}`,
            fieldId: r.fieldId,
            agentId,
            description: f?.description || '',
            valueType: f?.valueType || '',
            role: f?.promptRole || '',
            render: r.render,
            internal: r.internal,
            accumulate: r.accumulate,
            locked: r.locks?.level === 'system-locked' || r.locks?.level === 'structure-locked',
            lockLevel: r.locks?.level || 'fully-editable',
            handoffTargets: parseHandoff(r.handoff),
            pathInRawOutput: f?.pathInRawOutput || '',
            persistKey: f?.persistKey || '',
            notes: r.notes || '',
          }
        })
        .sort((a, b) => a.fieldId.localeCompare(b.fieldId))
      const contract = d.agents.find((a) => a.agentId === agentId)
      return { agentId, bridge, description: contract?.description || '', fields }
    })
  const fieldCount = groups.reduce((s2, g) => s2 + g.fields.length, 0)
  return {
    id: s,
    order: String(STAGE_ORDER.indexOf(s as (typeof STAGE_ORDER)[number]) + 1),
    name: STAGE_LABELS[s] || s,
    agentId: `${s}-agent`,
    fieldCount,
    groups,
  }
}
