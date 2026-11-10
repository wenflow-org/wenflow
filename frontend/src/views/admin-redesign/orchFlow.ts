/**
 * 编排管线总览 · 字段级交接（handoff）统计（2026-11-10）。
 *
 * 背景（用户「教学画像入为什么是 0，没有上下游传递数据吗」）：
 * 总览列脚的「入 / 出」原先取的是字段契约里的 promptRole —— 入 = hard-required 条数。
 * 但 hard-required 是**模型必须产出的字段**（goal 的 4 个都在 `internal.ext.goalConversation.
 * understanding.*` 输出路径上），既不是上游入参，也不含交接关系；教学/画像/仿真三阶段
 * 没有 hard-required，于是恒显示「入 0」，看着像链路断了。
 *
 * 真实的上/下游传递登记在字段路由的 `handoff` 上（目标可以是阶段 id，也可以是下游 Agent id）。
 * 这里按阶段汇总：入 = 从上游阶段交接进来的唯一字段数，出 = 交给下游的唯一字段数。
 * 上下文注入（会话上下文、路径状态、人设）不经过字段路由，不在本统计内。
 */

export interface StageFieldLike {
  fieldId: string
  camelName?: string | null
  description?: string | null
  promptRole?: string | null
}
export interface StageRoutingLike {
  fieldId?: string | null
  handoff?: string[] | null
}
export interface StageDetailLike {
  agents?: Array<{ agentId?: string | null; id?: string | null }>
  fields?: StageFieldLike[]
  routings?: StageRoutingLike[]
}

export interface StageFlow {
  inCount: number
  outCount: number
  /** 悬停明细：按来源阶段分组，列出中文名（英文标识） */
  inDetail: string
  outDetail: string
}

/** 每组明细最多列几个字段（goal→path 有 36 个，全列会把悬停撑成半屏） */
const MAX_LINES_PER_STAGE = 8

/** 字段注册表的 description 有的很长（一句带口径说明的完整话），悬停里截断到 40 字 */
function fieldLabelOf(f: StageFieldLike): string {
  const label = String(f.description || '').trim() || f.camelName || f.fieldId
  return label.length > 40 ? `${label.slice(0, 40)}…` : label
}

function unionSize(groups: Record<string, Map<string, string>>): number {
  const ids = new Set<string>()
  for (const m of Object.values(groups)) for (const id of m.keys()) ids.add(id)
  return ids.size
}

function detailOf(
  groups: Record<string, Map<string, string>>,
  dir: 'in' | 'out',
  stageOrder: string[],
  stageNameOf: (id: string) => string,
): string {
  const entries = Object.entries(groups).sort(
    (a, b) => stageOrder.indexOf(a[0]) - stageOrder.indexOf(b[0]),
  )
  if (!entries.length) return dir === 'in' ? '没有从上游交接进来的字段' : '没有交给下游的字段'
  return entries
    .map(([other, fields]) => {
      const list = [...fields.entries()]
      const shown = list.slice(0, MAX_LINES_PER_STAGE).map(([fid, label]) => `· ${label}（${fid}）`)
      const rest = list.length > MAX_LINES_PER_STAGE ? [`· …另 ${list.length - MAX_LINES_PER_STAGE} 个`] : []
      const head = dir === 'in' ? `从「${stageNameOf(other)}」收到 ${fields.size} 个` : `交给「${stageNameOf(other)}」${fields.size} 个`
      return [head, ...shown, ...rest].join('\n')
    })
    .join('\n')
}

/**
 * @param stageOrder 阶段顺序（用于明细分组排序）
 * @param stageNameOf 阶段 id → 展示名
 * @param details 已成功拉到的阶段详情（失败阶段不传，其列脚仍是「未加载」）
 */
export function computeStageFlow(
  stageOrder: string[],
  stageNameOf: (id: string) => string,
  details: Record<string, StageDetailLike>,
): Record<string, StageFlow> {
  const loaded = stageOrder.filter((id) => !!details[id])
  const agentStage = new Map<string, string>()
  for (const id of loaded) {
    for (const a of details[id].agents ?? []) {
      const aid = String(a.agentId || a.id || '')
      if (aid) agentStage.set(aid, id)
    }
  }
  /** handoff 目标可以是阶段 id，也可以是下游 Agent id；都不认识就忽略（历史脏数据不至于炸整块） */
  const stageOf = (target: string): string | null =>
    details[target] ? target : agentStage.get(target) || null

  const outgoing: Record<string, Record<string, Map<string, string>>> = {}
  const incoming: Record<string, Record<string, Map<string, string>>> = {}
  for (const from of loaded) {
    const labels = new Map((details[from].fields ?? []).map((f) => [f.fieldId, fieldLabelOf(f)]))
    for (const row of details[from].routings ?? []) {
      const fid = String(row.fieldId || '')
      if (!fid) continue
      for (const target of row.handoff ?? []) {
        const to = stageOf(String(target))
        if (!to || to === from) continue
        const label = labels.get(fid) || fid
        ;((outgoing[from] ||= {})[to] ||= new Map()).set(fid, label)
        ;((incoming[to] ||= {})[from] ||= new Map()).set(fid, label)
      }
    }
  }

  const flow: Record<string, StageFlow> = {}
  for (const id of loaded) {
    const inGroups = incoming[id] || {}
    const outGroups = outgoing[id] || {}
    flow[id] = {
      inCount: unionSize(inGroups),
      outCount: unionSize(outGroups),
      inDetail: detailOf(inGroups, 'in', stageOrder, stageNameOf),
      outDetail: detailOf(outGroups, 'out', stageOrder, stageNameOf),
    }
  }
  return flow
}
