import { derivePlanningHints, inferWeeksUntilDeadline } from '../path-planning-hints';

/**
 * R8 时间模型（2026-10-27）
 *
 * 口径：objectiveScopeHours 是最高优先级的「内容体量锚」——存在且 >0 时
 * 预算直接取 objective（1.0×），不再与日历/节奏乘法取 min；deadlineDate 是唯一
 * 日历权威，无期限时不生成总周数要求（maxWeeks 只受 52 周结构硬顶约束）。
 * objectiveScopeHours 缺失时完整回退 R7 的锚污染/双证据兜底逻辑。
 */
/** 与 derivePlanningHints 的 timeDimensions 入参同形（单一事实源，避免测试桩类型漂移） */
type TimeDimensionsArg = NonNullable<Parameters<typeof derivePlanningHints>[5]>;

function hintsOf(td: TimeDimensionsArg | null, keyStages = 3, narrowScopeSignal?: boolean, timePerSession: string | null = null) {
  return derivePlanningHints(
    null,
    timePerSession,
    null,
    null,
    Array.from({ length: keyStages }, (_, i) => `阶段${i + 1}`),
    td,
    null,
    null,
    null,
    narrowScopeSignal,
  );
}

describe('R8 objectiveScopeHours 最高优先级', () => {
  it('objective 优先于日历/节奏乘法：10h 客观体量 ⇒ 10h（1.0×），不被 90h 日历算术撑大', () => {
    const hints = hintsOf({
      timeModelVersion: 2,
      sessionsLengthMin: 60,
      objectiveScopeHours: 10,
      estimatedHours: 90,
      calendarCapacityHours: 60,
      totalWeeks: 26,
      sessionsPerWeek: 7,
    });
    expect(hints.targetTotalHours).toBe(10);
    expect(hints.budgetDerivation?.source).toBe('objective_scope_hours');
    expect(hints.budgetDerivation?.contentAnchorSource).toBe('objective_scope_hours');
    expect(hints.budgetDerivation?.objectiveScopeHours).toBe(10);
    expect(hints.budgetDerivation?.effectiveContentAnchorHours).toBe(10);
    expect(hints.budgetDerivation?.anchorSource).toBe('objective_scope_hours');
    expect(hints.budgetDerivation?.legacyArithmeticHours).toBeGreaterThan(10);
    expect(hints.budgetDerivation?.cadenceHours).toBe(182);
    expect(hints.maxWeeks).toBe(52);
    expect(hints.maxWeeksSource).toBe('hard_cap');
    expect(hints.budgetDerivation?.legacyTotalWeeksIgnored).toBe(true);
  });

  it('objective 近日历容量只告警、不弃用（日历 24h，objective 22h ⇒ 22h）', () => {
    const hints = hintsOf({ timeModelVersion: 2, objectiveScopeHours: 22, calendarCapacityHours: 24 });
    expect(hints.budgetDerivation?.objectiveScopeNearCalendar).toBe(true);
    expect(hints.budgetDerivation?.contentAnchorSource).toBe('objective_scope_hours');
    expect(hints.targetTotalHours).toBe(22);
  });

  it('objective ≤1h 触发「一节课」收口（只收结构上界，不改预算）', () => {
    const hints = hintsOf({ timeModelVersion: 2, objectiveScopeHours: 0.8, sessionsLengthMin: 30 });
    expect(hints.milestoneRange[1]).toBeLessThanOrEqual(2);
    expect(hints.targetMilestones).toBeLessThanOrEqual(2);
    expect(hints.subtasksPerStageRange[1]).toBeLessThanOrEqual(2);
    expect(hints.targetTotalHours).toBe(0.8);
  });

  it('单任务硬上界 90 分钟：会话 120 分钟不再产生 100-120 分钟巨型单课', () => {
    const hints = hintsOf({ sessionsLengthMin: 120, objectiveScopeHours: 20 }, 3, false, '2小时');
    expect(hints.subtaskMinutesRange[1]).toBeLessThanOrEqual(90);
    expect(hints.subtaskMinutesRange[0]).toBeLessThanOrEqual(hints.subtaskMinutesRange[1]);
  });

  it('浮点收尾保持 1 位小数', () => {
    const hints = hintsOf({ timeModelVersion: 2, objectiveScopeHours: 5.500000000000001 });
    expect(hints.targetTotalHours).toBe(5.5);
  });
});

describe('R8 无期限不产生总周数要求', () => {
  it('deadlineDate=null ⇒ maxWeeks=52/hard_cap，旧 totalWeeks 被忽略', () => {
    const hints = hintsOf({ timeModelVersion: 2, objectiveScopeHours: 20, deadlineDate: null, totalWeeks: 12 });
    expect(hints.maxWeeks).toBe(52);
    expect(hints.maxWeeksSource).toBe('hard_cap');
    expect(hints.budgetDerivation?.legacyTotalWeeksIgnored).toBe(true);
  });

  it('delta 合并删掉 deadlineDate 键后，靠 timeModelVersion=2 仍识别 R8 形状', () => {
    const hints = hintsOf({ timeModelVersion: 2, objectiveScopeHours: 20, totalWeeks: 12 });
    expect(hints.maxWeeks).toBe(52);
    expect(hints.maxWeeksSource).toBe('hard_cap');
    expect(hints.budgetDerivation?.legacyTotalWeeksIgnored).toBe(true);
  });

  it('有确定截止 ⇒ 按截止日反推周数（唯一日历权威）', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-27T00:00:00Z'));
    try {
      const hints = hintsOf({ timeModelVersion: 2, objectiveScopeHours: 20, deadlineDate: '2027-01-05' });
      const weeks = inferWeeksUntilDeadline('2027-01-05')!;
      expect(hints.maxWeeksSource).toBe('deadline_date');
      expect(hints.maxWeeks).toBe(Math.min(52, Math.max(1, Math.ceil(weeks))));
      expect(hints.targetTotalHours).toBe(20);
    } finally {
      jest.useRealTimers();
    }
  });

  it('截止日已过 ⇒ 按最紧 1 周收口，不回退 52 周', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-27T00:00:00Z'));
    try {
      const hints = hintsOf({ timeModelVersion: 2, objectiveScopeHours: 20, deadlineDate: '2026-10-01' });
      expect(hints.maxWeeks).toBe(1);
      expect(hints.maxWeeksSource).toBe('deadline_date');
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('R8 objectiveScopeHours 缺失时回退 R7 逻辑', () => {
  it('回退 legacy 未污染锚（scopeAnchorHours 15 vs 日历 78）', () => {
    const hints = hintsOf({ estimatedHours: 15, scopeAnchorHours: 15, calendarCapacityHours: 78 }, 4);
    expect(hints.targetTotalHours).toBe(15);
    expect(hints.budgetDerivation?.contentAnchorSource).toBe('scope_anchor_hours');
    expect(hints.budgetDerivation?.objectiveScopeHours).toBe(null);
  });

  it('回退 keyStages×2.5 兜底（42/42 + 窄目标 ⇒ 10h 锚，夹到 15h）', () => {
    const hints = hintsOf({ estimatedHours: 42, calendarCapacityHours: 42 }, 4, true);
    expect(hints.budgetDerivation?.contentAnchorSource).toBe('key_stages_fallback');
    expect(hints.targetTotalHours).toBe(15);
  });

  it('污染 legacy 锚不被使用（22≈24 + 窄目标 ⇒ 兜底 7.5h，11.3h）', () => {
    const hints = hintsOf({ estimatedHours: 22, calendarCapacityHours: 24, scopeAnchorHours: 22 }, 3, true);
    expect(hints.budgetDerivation?.scopeAnchorPolluted).toBe(true);
    expect(hints.budgetDerivation?.effectiveScopeAnchorHours).toBe(7.5);
    expect(hints.budgetDerivation?.contentAnchorSource).toBe('key_stages_fallback');
    expect(hints.targetTotalHours).toBe(11.3);
  });

  it('旧数据（无 R8 键）零行为变化：12 周 × 1.2 ⇒ maxWeeks 15', () => {
    const hints = hintsOf({ totalWeeks: 12, estimatedHours: 36, sessionsPerWeek: 3, sessionsLengthMin: 60 });
    expect(hints.maxWeeks).toBe(15);
    expect(hints.maxWeeksSource).toBe('legacy_total_weeks');
    expect(hints.budgetDerivation?.source).toBe('structured_estimated_hours');
    expect(hints.budgetDerivation?.contentAnchorSource).toBe(null);
    expect(hints.targetTotalHours).toBe(36);
  });

  it('归一化层写出的 deadlineDate:null 空键不被误判为 R8（v70 老数据仍走 totalWeeks）', () => {
    const hints = hintsOf({
      totalWeeks: 12,
      estimatedHours: 36,
      sessionsPerWeek: 3,
      sessionsLengthMin: 60,
      deadlineDate: null,
      objectiveScopeHours: null,
      timeModelVersion: null,
    });
    expect(hints.maxWeeks).toBe(15);
    expect(hints.maxWeeksSource).toBe('legacy_total_weeks');
    expect(hints.budgetDerivation?.legacyTotalWeeksIgnored).toBe(false);
  });
});

describe('R8 inferWeeksUntilDeadline', () => {
  it('null/过去日期 ⇒ null；合法日期 ⇒ 约 10.1 周', () => {
    const now = new Date('2026-10-27T00:00:00Z');
    expect(inferWeeksUntilDeadline(null, now)).toBe(null);
    expect(inferWeeksUntilDeadline('2026-10-01', now)).toBe(null);
    const weeks = inferWeeksUntilDeadline('2027-01-05', now);
    expect(weeks).toBeGreaterThan(9.9);
    expect(weeks).toBeLessThan(10.3);
  });
});
