/**
 * 概念图谱的「掌握度有没有读数」判据 —— 单源。
 *
 * 背景（2026-11-10 逻辑矛盾检索）：`masteryScore = 0` 是上游「没测过」的哨兵值，
 * 不是「测出来 0 分」。但四处在各判各的：
 *   - 学员档案的概念行（masteryPctOf）把 0 当「没测到」，显示「—」；
 *   - 图谱的可见节点保留 0（当作已评估），画布把它画成红色、统计算进「记忆偏弱」。
 * 同一颗概念在档案页叫「未评估」、在图画上叫「0% 且脆弱」。
 *
 * 判据：分数 > 0，或者确实有提取证据（extractionCount > 0，此时 0% 是真的 0 分）。
 * 图谱的可见性、着色、徽章、读屏文案都从这里取，避免再次分叉。
 */
export interface MasterySignalLike {
  masteryScore?: number | null
  extractionCount?: number
}

export function hasMasterySignal(node: MasterySignalLike | null | undefined): boolean {
  if (!node) return false
  const score = typeof node.masteryScore === 'number' ? node.masteryScore : null
  if (score !== null && score > 0) return true
  return (node.extractionCount ?? 0) > 0
}

/**
 * 掌握度四档的**判据**单源（2026-11-10 口径统一）。
 *
 * 此前同名四档四处各算：
 *   - 图谱：`stability==='stable' || score>=0.8` 已掌握；`=== 'fragile' || score<0.45` 记忆偏弱；
 *   - 学员端学习状态：只认 `stability === 'stable'`；
 *   - 个人中心「已掌握知识点」：同样只认 `stability`；
 *   - 管理台学习者「概念信号」行：后端另用 0.55 阈值。
 * 于是同一颗概念（developing 且 score 0.9）在图谱是「已掌握」、在学习状态是「进行中」。
 * 这里把阈值与判据收敛成一份，前端各处（图谱着色/统计/学员端分布/个人中心）统一取用；
 * 后端信号行是「台账口径」（按 status 四态 + 0.55），暂不并入——两套的差异在接口层已可见。
 */
export type ConceptBand = 'stable' | 'learning' | 'fragile' | 'unknown'

/** 已掌握下界 / 记忆偏弱上界（四舍五入前的原始 masteryScore） */
export const BAND_STABLE_MIN = 0.8
export const BAND_FRAGILE_MAX = 0.45

export function conceptBandOf(
  node: MasterySignalLike & { stability?: string | null } | null | undefined
): ConceptBand {
  if (!hasMasterySignal(node)) return 'unknown'
  const score = node?.masteryScore ?? 0
  if (node?.stability === 'fragile' || score < BAND_FRAGILE_MAX) return 'fragile'
  if (node?.stability === 'stable' || score >= BAND_STABLE_MIN) return 'stable'
  return 'learning'
}
