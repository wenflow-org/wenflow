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
  // 幂等：追加/渐进模式下 milestone 可能已带声明，不重复追加（兼容存量「容量说明」旧文案）
  if (existingDescription && /(容量说明|时间说明)/.test(existingDescription)) return null;
  if (actual >= anchor * STAGE_FILL_DECLARE_RATIO) return null;
  // 面向学习者的措辞（2026-10-12 走查）：原句「可在补充说明里要求加密」引用了目标对话的
  // 内部字段名（补充说明）且「加密」歧义（指加任务密度），学习者读不懂——改成可执行的自然话。
  const note = `时间说明：这一阶段按你的时间预算约 ${Math.round(anchor)} 小时规划，目前拆出的学习任务合计约 ${Math.round(actual)} 小时；如果想让这一阶段练得更充分，可以在学习过程中告诉我，我会再补充任务。`;
  return existingDescription ? `${existingDescription}\n\n${note}` : note;
}
