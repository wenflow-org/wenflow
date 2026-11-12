/**
 * 时间预算来源与扩容判据（2026-11-11）
 *
 * 锁三类事实：
 * ① 用户显式说“每次 20 分钟”时，单课仍按 20 封顶；
 * ② 用户完全没提时，25 只是均值锚，单课允许 15-35，不再把 8h 内容锁成 3.75h；
 * ③ 扩容按“每阶段锚分钟 > 单阶段容量”触发，不再被 `perStageHours > 6` 挡住。
 */
import { derivePlanningHints } from '../path-planning-hints';

describe('sessionsLengthSource：显式 vs 静默默认', () => {
  it('显式 20 分钟：单课严格 ≤20，8h/4 阶段容量不足要如实报缺口', () => {
    const hints = derivePlanningHints(
      null, '每次只能抽 20 分钟', null, null,
      ['S1', 'S2', 'S3', 'S4'],
      { objectiveScopeHours: 8, sessionsLengthMin: 20, sessionsLengthSource: 'explicit', timeModelVersion: 2 },
      null,
    );
    expect(hints.subtaskMinutesRange[1]).toBe(20);
    expect(hints.targetTotalHours).toBe(8);
    expect(hints.targetMilestones).toBe(4);
    // 4 阶段 × 5 课 × 20min = 6.67h < 8h：装不下是事实，交给缺口报告，不偷偷拉长单课
    expect(hints.capacityDeficit).not.toBeNull();
    expect(hints.targetHoursPerMilestone).toBeLessThan(hints.rawTargetHoursPerMilestone!);
  });

  it('静默默认 25 分钟：25 是均值锚，单课区间放宽到 15-35，8h/4 阶段装得下', () => {
    const hints = derivePlanningHints(
      null, null, null, null,
      ['S1', 'S2', 'S3', 'S4'],
      { objectiveScopeHours: 8, sessionsLengthMin: 25, sessionsLengthSource: 'default', timeModelVersion: 2 },
      null,
    );
    expect(hints.subtaskMinutesRange).toEqual([15, 35]);
    expect(hints.targetTotalHours).toBe(8);
    expect(hints.capacityDeficit).toBeNull();
    expect(hints.targetHoursPerMilestone).toBe(2);
  });

  it('静默默认 25 分钟：8h/3 阶段扩到 5 课后装得下（不再被 3 课上限锁成 3.75h）', () => {
    const hints = derivePlanningHints(
      null, null, null, null,
      ['S1', 'S2', 'S3'],
      { objectiveScopeHours: 8, sessionsLengthMin: 25, sessionsLengthSource: 'default', timeModelVersion: 2 },
      null,
    );
    expect(hints.subtaskMinutesRange).toEqual([15, 35]);
    expect(hints.subtasksPerStageRange[1]).toBe(5);
    expect(hints.capacityDeficit).toBeNull();
    expect(hints.targetHoursPerMilestone).toBeCloseTo(2.7, 1);
  });

  it('显式 25 分钟：3 阶段封 5 课后仍装不下 8h，缺口如实保留', () => {
    const hints = derivePlanningHints(
      null, '每次 25 分钟', null, null,
      ['S1', 'S2', 'S3'],
      { objectiveScopeHours: 8, sessionsLengthMin: 25, sessionsLengthSource: 'explicit', timeModelVersion: 2 },
      null,
    );
    expect(hints.subtaskMinutesRange[1]).toBe(25);
    expect(hints.subtaskMinutesRange[0]).toBeLessThanOrEqual(10);
    expect(hints.subtasksPerStageRange[1]).toBe(5);
    expect(hints.capacityDeficit).not.toBeNull();
    expect(hints.capacityDeficit!.capacityHours).toBeCloseTo(6.3, 1);
  });
});

describe('perStageFromHours：按单课分钟反推，不再写死 1h/任务', () => {
  it('18h/4 阶段/60min → 5 个任务/阶段（不是 5 个 1h 任务）', () => {
    const hints = derivePlanningHints(
      null, '每次 1 小时', null, null,
      ['S1', 'S2', 'S3', 'S4'],
      { objectiveScopeHours: 18, sessionsLengthMin: 60, sessionsLengthSource: 'explicit', timeModelVersion: 2 },
      null,
    );
    expect(hints.targetMinutesPerTask).toBeLessThanOrEqual(60);
    expect(hints.targetSubtasksPerStage).toBe(5);
    expect(hints.capacityDeficit).toBeNull();
  });
});
