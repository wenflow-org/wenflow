/**
 * 结构容量缺口可观测化（2026-09-29 I2b）。
 *
 * 背景：容量上界同时受两道**有意设计**约束——① 每阶段 30 课封顶（防 filler 换皮复读）；
 * ② 单课分钟上界按用户单次坐姿校准（一节课要能一次上完）。长周期/大预算诉求装不下是
 * 正常结果，问题从来不是「要不要夹」。修的是**观测**：此前 targetHoursPerMilestone 被钳到
 * 容量上界（对规划器诚实），但缺口本身既不落库也无处可看——用户侧只见
 * `learning_paths.estimatedHours`（如 26h）而不知自述可用时间是 650h。
 *
 * 现在 hints 新增 `capacityDeficit` 字段，随 `buildFramedNormalizedInput` 落库到
 * `aiPromptTemplate.normalizedInput.normalizedInput.planningHints`，使缺口可复核。
 */
import { derivePlanningHints, type CapacityDeficitReport } from '../path-planning-hints';

/**
 * 用 `timeDimensions.estimatedHours` 作预算源：只有它能同时推出 targetMilestones
 * 与 targetTotalHours（totalWeeks 单独给不出里程碑数，缺口判定便不成立）。
 * 900h / 5 阶段 ⇒ 每阶段需 180h，结构容量 30课×90min=45h/阶段 ⇒ 必然装不下。
 */
const BIG = { estimatedHours: 900 };
/** 36h / 5 阶段 ⇒ 每阶段 7.2h < 容量 45h ⇒ 装得下 */
const FITS = { estimatedHours: 36 };

function hints(td: Record<string, number> | null) {
  return derivePlanningHints(null, null, null, null, [], td ? { ...td } : null, null, null, null);
}

const cap = (r: CapacityDeficitReport) =>
  r.bounds.subtasksPerStage * r.bounds.subtaskMinutes * r.bounds.milestones / 60;

describe('结构容量缺口 capacityDeficit', () => {
  it('预算远超结构容量 → 报缺口，口径与 bounds 自洽', () => {
    const h = hints(BIG);
    const r = h.capacityDeficit!;
    expect(r).toBeTruthy();
    // capacityHours == 上界乘积；deficitRatio == 1 - capacity/requested
    expect(Math.abs(r.capacityHours - cap(r))).toBeLessThan(0.15);
    expect(Math.abs(r.deficitRatio - (1 - r.capacityHours / r.requestedHours))).toBeLessThan(0.002);
    expect(r.requestedHours).toBe(900);
    expect(r.deficitRatio).toBeGreaterThan(0.05);
  });

  it('缺口字段 JSON 可序列化（= 能随 hints 落库）', () => {
    const round = JSON.parse(JSON.stringify(hints(BIG)));
    expect(round.capacityDeficit).toBeTruthy();
    expect(Object.keys(round.capacityDeficit).sort()).toEqual(
      ['bounds', 'capacityHours', 'deficitRatio', 'limitingFactor', 'requestedHours'].sort(),
    );
    expect(round.capacityDeficit.bounds).toEqual({
      subtasksPerStage: 30,
      subtaskMinutes: 90,
      milestones: 5,
    });
  });

  it('装得下 → 缺口为 null（不制造假缺口）', () => {
    expect(hints(FITS).capacityDeficit).toBeNull();
  });

  it('无预算信息 → 缺口为 null（缺信号时不编造）', () => {
    expect(hints(null).capacityDeficit).toBeNull();
  });

  it('课数上界仍封顶 30（防 filler 复读的有意设计不被缺口判定突破）', () => {
    const h = hints(BIG);
    expect(h.capacityDeficit!.bounds.subtasksPerStage).toBeLessThanOrEqual(30);
    expect(h.subtasksPerStageRange[1]).toBeLessThanOrEqual(30);
  });

  it('targetHoursPerMilestone 仍被钳到容量上界（对规划器诚实），与缺口报告不矛盾', () => {
    const h = hints(BIG);
    const r = h.capacityDeficit!;
    const perMilestone = h.targetHoursPerMilestone!;
    const capacityPerMilestone = cap(r) / r.bounds.milestones;
    // 锚 == 容量上界/阶段（45h），正是"诚实装不下"而非注水
    expect(Math.abs(perMilestone - capacityPerMilestone)).toBeLessThan(0.15);
  });

  it('limitingFactor 取值在枚举内，且与 bounds 一致反映"哪道 lever 最先触顶"', () => {
    const r = hints(BIG).capacityDeficit!;
    expect(['lesson_count', 'lesson_minutes', 'milestone_count']).toContain(r.limitingFactor);
    // 本 fixture：课数与分钟都已封顶（30/90）⇒ 缺口只能由阶段数吸收
    expect(r.limitingFactor).toBe('milestone_count');
  });

  it('缺口报告的单课上界与 targetHoursPerMilestone 钳制口径逐字一致', () => {
    // 用户单次坐姿只支持 30 分钟时，报告必须写 30 而不是 90：
    // 写 90 等于把"一节课上不完"的约束瞒报，缺口会被低估。
    const h = hints({ estimatedHours: 900, sessionsLengthMin: 30, sessionsPerWeek: 5 });
    const r = h.capacityDeficit!;
    expect(r.bounds.subtaskMinutes).toBe(h.subtaskMinutesRange[1]);
    // 锚 == 容量上界/阶段，两者口径必须同源
    const capacityPerMilestone = cap(r) / r.bounds.milestones;
    expect(Math.abs((h.targetHoursPerMilestone ?? 0) - capacityPerMilestone)).toBeLessThan(0.15);
  });

  it('缺口比例随预算增大而增大（单调，可用于按比例排序）', () => {
    const a = hints({ estimatedHours: 900 }).capacityDeficit!;
    const b = hints({ estimatedHours: 2340 }).capacityDeficit!;
    expect(b.deficitRatio).toBeGreaterThan(a.deficitRatio);
  });
});

/**
 * 用户口径修正（2026-09-29）：「没有数据支撑学习者每天不能学八小时，学校里的学生就是这样」。
 *
 * 据此去掉两处无实证的收紧：① 单课上界的 0.8×会话系数（白吃 20% 结构容量）；
 * ② 课数反推里额外的 90 封顶（与容量报告用的分钟档不一致 → 两张皮）。
 * 保留：课 ≤ 用户自述会话时长（rw-school-15 实证）、每阶段 30 课（防 filler 复读，有实证）。
 */
describe('单课分钟档 = 用户自述会话时长（去 0.8 系数）', () => {
  /** CPA 实测输入：自述一次 2h，goal 层锚 416h / 5 阶段 */
  const cpa = () => derivePlanningHints(
    null, '每天2小时', null, null, [],
    { totalWeeks: 52, estimatedHours: 416, sessionsPerWeek: 4, sessionsLengthMin: 120, totalSessions: 208 },
    null, null, null,
  );

  it('单课上界取会话时长本身（120），不再打 0.8 折（96）', () => {
    expect(cpa().subtaskMinutesRange[1]).toBe(120);
  });

  it('结构容量随之抬升：240h → 300h（对 416h 目标缺口 42% → 28%）', () => {
    const r = cpa().capacityDeficit!;
    expect(r.capacityHours).toBeCloseTo(300, 0);
    expect(r.deficitRatio).toBeLessThan(0.3);
    expect(r.deficitRatio).toBeGreaterThan(0.2);
  });

  it('课数反推与容量报告用同一个分钟档（去掉 90 封顶后的同源契约）', () => {
    const h = cpa();
    // 结构容量/阶段 == 课数上界 × 单课分钟上界 / 60，两者必须同一个数
    const perStage = (h.subtasksPerStageRange[1] * h.subtaskMinutesRange[1]) / 60;
    expect(h.targetHoursPerMilestone).toBeCloseTo(Math.min(perStage, h.budgetDerivation!.perMilestoneRequested!), 0);
    expect(h.capacityDeficit!.bounds.subtaskMinutes).toBe(h.subtaskMinutesRange[1]);
  });

  it('真正的瓶颈仍是阶段数（不是单课时长、也不是课数）', () => {
    // 30 课 × 120min = 60h/阶段已顶格；416h 目标要 ~7 个阶段，而目标只给了 5 个
    expect(cpa().capacityDeficit!.limitingFactor).toBe('milestone_count');
  });

  it('每阶段 30 课封顶不动（防 filler 换皮复读是有实证的设计，不在本次放宽范围）', () => {
    expect(cpa().subtasksPerStageRange[1]).toBe(30);
  });
});
