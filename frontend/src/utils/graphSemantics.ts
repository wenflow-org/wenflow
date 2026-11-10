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
