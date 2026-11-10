/**
 * 概念掌握四档的**名字单源**（学员端知识地图 / 管理台概念图谱 / 管理台学习者详情共用）。
 *
 * 此前各写一套：图谱叫「已掌握 / 进行中 / 记忆偏弱 / 待学习」，管理台学习者的「概念信号」行叫
 * 「已掌握 / 挣扎 / 脆弱 / 未开始」——同一批概念、同一种颜色（绿/琥珀/红/灰）两套名字，
 * 同屏对照时会被读成两批概念。这里只统一**叫法**，判据（阈值）仍由各处的计算函数决定。
 *
 * 本文件只放纯定义（无 import），好让 src/components/ 下的共享图谱组件也能引。
 */
export type ConceptBandKey = 'stable' | 'learning' | 'fragile' | 'unknown'

/** 键沿用图谱内部口径（计数、画布着色、读屏徽章都按这四个键走） */
export const CONCEPT_BAND_LABEL: Record<ConceptBandKey, string> = {
  stable: '已掌握',
  learning: '进行中',
  fragile: '记忆偏弱',
  unknown: '待学习'
}
