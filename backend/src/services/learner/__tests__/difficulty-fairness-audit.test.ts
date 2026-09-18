import {
  auditDifficultyFairness,
  summarizeLearnerDifficulty,
  type DifficultyAdjustmentEvent,
} from '../difficulty-fairness-audit';

const ev = (over: Partial<DifficultyAdjustmentEvent> & { occurredAt: string }): DifficultyAdjustmentEvent => ({
  userId: 'u1',
  baseline: 5,
  adjusted: 4,
  direction: 'decrease',
  reasons: ['lesson_stress_high'],
  ...over,
});

describe('summarizeLearnerDifficulty', () => {
  it('按时间排序统计降/升/持平、均值与理由直方图', () => {
    const events = [
      ev({ occurredAt: '2026-09-03T00:00:00Z', adjusted: 6, direction: 'increase', reasons: ['ready_to_accelerate'] }),
      ev({ occurredAt: '2026-09-01T00:00:00Z', adjusted: 4 }),
      ev({ occurredAt: '2026-09-02T00:00:00Z', adjusted: 5, direction: 'keep', reasons: [] }),
    ];
    const s = summarizeLearnerDifficulty('u1', events);
    expect(s.tasks).toBe(3);
    expect(s.decreaseTasks).toBe(1);
    expect(s.increaseTasks).toBe(1);
    expect(s.keepTasks).toBe(1);
    expect(s.meanDelta).toBeCloseTo((-1 + 0 + 1) / 3, 6);
    expect(s.reasonHistogram).toEqual({ lesson_stress_high: 1, ready_to_accelerate: 1 });
  });

  it('连续低于基线：跨乱序输入仍按时间计算最大连击', () => {
    const events = [
      ev({ occurredAt: '2026-09-02T00:00:00Z' }),
      ev({ occurredAt: '2026-09-01T00:00:00Z' }),
      ev({ occurredAt: '2026-09-03T00:00:00Z', adjusted: 5, direction: 'keep', reasons: [] }),
      ev({ occurredAt: '2026-09-04T00:00:00Z' }),
      ev({ occurredAt: '2026-09-05T00:00:00Z' }),
      ev({ occurredAt: '2026-09-06T00:00:00Z' }),
    ];
    const s = summarizeLearnerDifficulty('u1', events);
    expect(s.maxConsecutiveBelowBaseline).toBe(3);
  });

  it('只统计目标用户；pinnedLow（<=3）与 floorApplied 计数', () => {
    const events = [
      ev({ occurredAt: '2026-09-01T00:00:00Z', baseline: 3, adjusted: 3, direction: 'keep', floorApplied: true, reasons: ['fatigue_high'] }),
      ev({ occurredAt: '2026-09-02T00:00:00Z', baseline: 10, adjusted: 9, floorApplied: true }),
      ev({ occurredAt: '2026-09-03T00:00:00Z', userId: 'u2' }),
    ];
    const s = summarizeLearnerDifficulty('u1', events);
    expect(s.tasks).toBe(2);
    expect(s.pinnedLowTasks).toBe(1);
    expect(s.floorAppliedTasks).toBe(2);
  });
});

describe('auditDifficultyFairness', () => {
  it('空输入安全：totals 归零', () => {
    const report = auditDifficultyFairness([]);
    expect(report.learners).toEqual([]);
    expect(report.flagged).toEqual([]);
    expect(report.totals).toMatchObject({ learners: 0, tasks: 0, meanDelta: 0 });
  });

  it('标记：连续低于基线 / 总是降档 / 多数贴地板', () => {
    const events: DifficultyAdjustmentEvent[] = [
      ...['01', '02', '03'].map((d) => ev({ occurredAt: `2026-09-${d}T00:00:00Z`, baseline: 5, adjusted: 3, reasons: ['fatigue_high'] })),
      ...['04', '05', '06'].map((d) => ev({ userId: 'u2', occurredAt: `2026-09-${d}T00:00:00Z`, baseline: 5, adjusted: 4 })),
    ];
    const report = auditDifficultyFairness(events);
    const u1 = report.flagged.find((f) => f.userId === 'u1');
    expect(u1?.flags).toContain('consecutive_below_baseline');
    expect(u1?.flags).toContain('always_decreased');
    expect(u1?.flags).toContain('majority_pinned_low');
    expect(u1?.flags).toContain('mean_delta_at_least_one_tier_down');
    // u2：连续 3 次也低于基线，但 delta=-1、adjusted=4 不贴地板；meanΔ=-1 触发均值标记
    const u2 = report.flagged.find((f) => f.userId === 'u2');
    expect(u2?.flags).toEqual(['consecutive_below_baseline', 'always_decreased', 'mean_delta_at_least_one_tier_down']);
    expect(report.totals.tasks).toBe(6);
    expect(report.totals.meanDelta).toBeCloseTo((-2 * 3 + -1 * 3) / 6, 6);
  });

  it('阈值可覆盖：放宽连续阈值后不再告警（用均值 0 的样本隔离连击）', () => {
    const events: DifficultyAdjustmentEvent[] = [
      ...['01', '02', '03'].map((d) => ev({ occurredAt: `2026-09-${d}T00:00:00Z`, baseline: 5, adjusted: 4 })),
      ...['04', '05', '06'].map((d) =>
        ev({ occurredAt: `2026-09-${d}T00:00:00Z`, baseline: 5, adjusted: 6, direction: 'increase', reasons: [] })),
    ];
    expect(auditDifficultyFairness(events).flagged[0]?.flags).toEqual(['consecutive_below_baseline']);
    expect(auditDifficultyFairness(events, { consecutiveBelowFlag: 5 }).flagged).toEqual([]);
  });
});
