/**
 * 课时充实度诚实声明（2026-09-29 通宵 R3）
 *
 * 实证：stage-designer 系统性少发课——school-12 每阶段请求 11-12 课只回 5-9 课；
 * life-06 课数合规但分钟集体缩水（avg 53 vs 档 90）；下发容量 persistently 只用 2-6 成。
 * 用户按预算锚（如「45 小时」）形成期待，任务分钟汇总却只有 18 小时——这一落差
 * 此前无任何声明。本函数与 path-planning 的缺口声明同构：任务分钟汇总 <70% 阶段
 * 学时锚时，向 milestone.description 追加一句容量说明。不阻断生成、不虚构内容、
 * 向用户诚实交付真实容量（宁少说，不多承诺）。
 */

/** 欠 fill 阈值：任务分钟汇总低于阶段锚的这个比例即声明 */
export const STAGE_FILL_DECLARE_RATIO = 0.7;

export function buildStageFillNote(
  anchorHours: number | null | undefined,
  stageHours: number | null | undefined,
  existingDescription?: string | null,
): string | null {
  const anchor = Number(anchorHours);
  const actual = Number(stageHours);
  if (!Number.isFinite(anchor) || anchor <= 0) return null;
  if (!Number.isFinite(actual) || actual <= 0) return null;
  // 幂等：追加/渐进模式下 milestone 可能已带声明，不重复追加
  if (existingDescription && /容量说明/.test(existingDescription)) return null;
  if (actual >= anchor * STAGE_FILL_DECLARE_RATIO) return null;
  const note = `容量说明：本阶段按你的时间预算约 ${Math.round(anchor)} 小时，当前拆出的学习任务合计约 ${Math.round(actual)} 小时；如需更完整的练习量，可在补充说明里要求加密。`;
  return existingDescription ? `${existingDescription}\n\n${note}` : note;
}
