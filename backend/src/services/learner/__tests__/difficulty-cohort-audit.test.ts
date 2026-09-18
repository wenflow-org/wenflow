import {
  auditDifficultyByCohort,
  resolveCohortKey,
  isDifficultyCohortStrategy,
  UNKNOWN_COHORT_KEY,
  DEFAULT_DIFFICULTY_COHORT_STRATEGY,
} from '../difficulty-cohort-audit';
import type { DifficultyAdjustmentEvent } from '../difficulty-fairness-audit';

const ev = (
  over: Partial<DifficultyAdjustmentEvent> & { userId: string; occurredAt: string },
): DifficultyAdjustmentEvent => ({
  baseline: 5,
  adjusted: 4,
  direction: 'decrease',
  reasons: ['fatigue_high'],
  ...over,
});

const decrease = (userId: string, occurredAt: string, adjusted = 3) =>
  ev({ userId, occurredAt, baseline: 5, adjusted, direction: 'decrease' });

describe('resolveCohortKey', () => {
  it('personaTag 直取；缺失时回退 presetKey', () => {
    expect(resolveCohortKey({ personaTag: 'shop-owner' })).toBe('shop-owner');
    expect(resolveCohortKey({ presetKey: 'student-geo-essay' })).toBe('student-geo-essay');
    // personaTag 为空串时不覆盖 presetKey 回退
    expect(resolveCohortKey({ personaTag: '   ', presetKey: 'nurse' })).toBe('nurse');
    // 数字标签也可确定性字符串化
    expect(resolveCohortKey({ personaTag: 42 })).toBe('42');
  });

  it('标签缺失/空白 → 统一回退桶 unknown', () => {
    expect(resolveCohortKey({})).toBe(UNKNOWN_COHORT_KEY);
    expect(resolveCohortKey(null)).toBe(UNKNOWN_COHORT_KEY);
    expect(resolveCohortKey(undefined)).toBe(UNKNOWN_COHORT_KEY);
    expect(resolveCohortKey({ personaTag: '  ' })).toBe(UNKNOWN_COHORT_KEY);
    // 非字符串/非有限数字（对象、布尔、NaN）一律视为无标签
    expect(resolveCohortKey({ personaTag: {} })).toBe(UNKNOWN_COHORT_KEY);
    expect(resolveCohortKey({ personaTag: true })).toBe(UNKNOWN_COHORT_KEY);
    expect(resolveCohortKey({ personaTag: Number.NaN })).toBe(UNKNOWN_COHORT_KEY);
  });

  it('frictionBudget 策略兼容驼峰与下划线两种键', () => {
    expect(resolveCohortKey({ frictionBudget: 'high' }, 'frictionBudget')).toBe('high');
    expect(resolveCohortKey({ friction_budget: 'stress_test' }, 'frictionBudget')).toBe('stress_test');
    expect(resolveCohortKey({ frictionBudget: '' }, 'frictionBudget')).toBe(UNKNOWN_COHORT_KEY);
  });

  it('storyId / sourceType 策略各取对应标签', () => {
    expect(resolveCohortKey({ storyId: 'story_a' }, 'storyId')).toBe('story_a');
    expect(resolveCohortKey({ story_id: 'story_b' }, 'storyId')).toBe('story_b');
    expect(resolveCohortKey({ sourceType: 'work' }, 'sourceType')).toBe('work');
    expect(resolveCohortKey({ storyId: 'story_a' }, 'sourceType')).toBe(UNKNOWN_COHORT_KEY);
  });

  it('默认策略与策略校验', () => {
    expect(DEFAULT_DIFFICULTY_COHORT_STRATEGY).toBe('personaTag');
    expect(resolveCohortKey({ presetKey: 'p' })).toBe('p');
    expect(isDifficultyCohortStrategy('storyId')).toBe(true);
    expect(isDifficultyCohortStrategy('nope')).toBe(false);
    expect(isDifficultyCohortStrategy(123)).toBe(false);
  });
});

describe('auditDifficultyByCohort', () => {
  it('空输入安全：无队列、disparity 归零且无队列 id', () => {
    const report = auditDifficultyByCohort([], {});
    expect(report.cohorts).toEqual([]);
    expect(report.disparity.increaseShare).toEqual({
      metric: 'increaseShare',
      min: 0,
      minCohortKey: null,
      max: 0,
      maxCohortKey: null,
      span: 0,
    });
    expect(report.disparity.meanDelta.span).toBe(0);
    expect(report.disparity.meanDelta.minCohortKey).toBeNull();
  });

  it('手算样例：聚合、share 与 meanDelta 与预期一致', () => {
    const events: DifficultyAdjustmentEvent[] = [
      // cohortA / u1：三次全降档（5→3），连续 3 次低于基线
      decrease('u1', '2026-09-01T00:00:00Z'),
      decrease('u1', '2026-09-02T00:00:00Z'),
      decrease('u1', '2026-09-03T00:00:00Z'),
      // cohortA / u2：一次升档 + 一次持平
      ev({ userId: 'u2', occurredAt: '2026-09-01T00:00:00Z', baseline: 5, adjusted: 6, direction: 'increase' }),
      ev({ userId: 'u2', occurredAt: '2026-09-02T00:00:00Z', baseline: 5, adjusted: 5, direction: 'keep', reasons: [] }),
      // cohortB / u3：一降一升
      decrease('u3', '2026-09-01T00:00:00Z', 4),
      ev({ userId: 'u3', occurredAt: '2026-09-02T00:00:00Z', baseline: 5, adjusted: 7, direction: 'increase' }),
    ];
    const report = auditDifficultyByCohort(events, { u1: 'cohortA', u2: 'cohortA', u3: 'cohortB' });

    expect(report.cohorts.map((c) => c.cohortKey)).toEqual(['cohortA', 'cohortB']);

    const a = report.cohorts[0];
    expect(a.learners).toBe(2);
    expect(a.tasks).toBe(5);
    expect(a.decreaseTasks).toBe(3);
    expect(a.increaseTasks).toBe(1);
    expect(a.keepTasks).toBe(1);
    expect(a.decreaseShare).toBeCloseTo(0.6, 6);
    expect(a.increaseShare).toBeCloseTo(0.2, 6);
    // 任务加权：(3 * -2 + 2 * 0.5) / 5 = -1
    expect(a.meanDelta).toBeCloseTo(-1, 6);
    expect(a.pinnedLowTasks).toBe(3);
    expect(a.pinnedLowShare).toBeCloseTo(0.6, 6);
    expect(a.floorAppliedTasks).toBe(0);
    expect(a.floorAppliedShare).toBe(0);
    // u1 命中全部标记，u2 不命中
    expect(a.flaggedLearners).toBe(1);
    expect(a.flaggedShare).toBeCloseTo(0.5, 6);

    const b = report.cohorts[1];
    expect(b.learners).toBe(1);
    expect(b.tasks).toBe(2);
    expect(b.decreaseShare).toBeCloseTo(0.5, 6);
    expect(b.increaseShare).toBeCloseTo(0.5, 6);
    expect(b.meanDelta).toBeCloseTo(0.5, 6);
    expect(b.flaggedLearners).toBe(0);
  });

  it('手算样例：disparity 为 max-min 且带取得该值的队列 id', () => {
    const events: DifficultyAdjustmentEvent[] = [
      decrease('u1', '2026-09-01T00:00:00Z'),
      decrease('u1', '2026-09-02T00:00:00Z'),
      decrease('u1', '2026-09-03T00:00:00Z'),
      ev({ userId: 'u2', occurredAt: '2026-09-01T00:00:00Z', baseline: 5, adjusted: 6, direction: 'increase' }),
      ev({ userId: 'u2', occurredAt: '2026-09-02T00:00:00Z', baseline: 5, adjusted: 5, direction: 'keep', reasons: [] }),
      decrease('u3', '2026-09-01T00:00:00Z', 4),
      ev({ userId: 'u3', occurredAt: '2026-09-02T00:00:00Z', baseline: 5, adjusted: 7, direction: 'increase' }),
    ];
    const report = auditDifficultyByCohort(events, { u1: 'cohortA', u2: 'cohortA', u3: 'cohortB' });

    expect(report.disparity.increaseShare.minCohortKey).toBe('cohortA');
    expect(report.disparity.increaseShare.min).toBeCloseTo(0.2, 6);
    expect(report.disparity.increaseShare.maxCohortKey).toBe('cohortB');
    expect(report.disparity.increaseShare.max).toBeCloseTo(0.5, 6);
    expect(report.disparity.increaseShare.span).toBeCloseTo(0.3, 6);

    expect(report.disparity.meanDelta.minCohortKey).toBe('cohortA');
    expect(report.disparity.meanDelta.min).toBeCloseTo(-1, 6);
    expect(report.disparity.meanDelta.maxCohortKey).toBe('cohortB');
    expect(report.disparity.meanDelta.max).toBeCloseTo(0.5, 6);
    expect(report.disparity.meanDelta.span).toBeCloseTo(1.5, 6);
  });

  it('未映射 / null / 空白 / 空串成员值都落到 unknown 桶', () => {
    const events: DifficultyAdjustmentEvent[] = [
      decrease('u4', '2026-09-01T00:00:00Z'),
      decrease('u5', '2026-09-01T00:00:00Z'),
      decrease('u6', '2026-09-01T00:00:00Z'),
      decrease('u7', '2026-09-01T00:00:00Z'), // 完全不在 map 里
    ];
    const report = auditDifficultyByCohort(events, { u4: 'cohortA', u5: null, u6: '   ' });
    expect(report.cohorts.map((c) => c.cohortKey)).toEqual(['cohortA', UNKNOWN_COHORT_KEY]);
    const unknown = report.cohorts.find((c) => c.cohortKey === UNKNOWN_COHORT_KEY);
    expect(unknown?.learners).toBe(3);
    expect(unknown?.tasks).toBe(3);
  });

  it('阈值透传：放宽 minTasksForPattern 会改变 flaggedShare', () => {
    const events: DifficultyAdjustmentEvent[] = [decrease('u1', '2026-09-01T00:00:00Z')];
    const strict = auditDifficultyByCohort(events, { u1: 'cohortA' });
    expect(strict.cohorts[0].flaggedLearners).toBe(0);
    expect(strict.cohorts[0].flaggedShare).toBe(0);

    const relaxed = auditDifficultyByCohort(events, { u1: 'cohortA' }, { thresholds: { minTasksForPattern: 1 } });
    expect(relaxed.cohorts[0].flaggedLearners).toBe(1);
    expect(relaxed.cohorts[0].flaggedShare).toBe(1);
  });

  it('确定性：并列时取 key 更小者，输出稳定不随输入顺序变化', () => {
    const events: DifficultyAdjustmentEvent[] = [
      decrease('u1', '2026-09-01T00:00:00Z', 4), // cohortB
      decrease('u2', '2026-09-01T00:00:00Z', 4), // cohortA
    ];
    const report = auditDifficultyByCohort(events, { u1: 'cohortB', u2: 'cohortA' });
    expect(report.cohorts.map((c) => c.cohortKey)).toEqual(['cohortA', 'cohortB']);
    expect(report.disparity.increaseShare.minCohortKey).toBe('cohortA');
    expect(report.disparity.increaseShare.maxCohortKey).toBe('cohortA');
    expect(report.disparity.increaseShare.span).toBe(0);
    expect(report.disparity.meanDelta.minCohortKey).toBe('cohortA');
    expect(report.disparity.meanDelta.maxCohortKey).toBe('cohortA');
    expect(report.disparity.meanDelta.span).toBe(0);

    // 颠倒输入顺序结果一致
    const reversed = auditDifficultyByCohort([...events].reverse(), { u1: 'cohortB', u2: 'cohortA' });
    expect(reversed).toEqual(report);
  });

  it('pinnedLow / floorApplied 份额按任务数计，且不良事件被忽略', () => {
    const events: DifficultyAdjustmentEvent[] = [
      decrease('u1', '2026-09-01T00:00:00Z', 3),
      ev({ userId: 'u1', occurredAt: '2026-09-02T00:00:00Z', baseline: 5, adjusted: 5, direction: 'keep', floorApplied: true, reasons: [] }),
      // 缺 userId 的脏数据被忽略
      { userId: '', occurredAt: '2026-09-03T00:00:00Z', baseline: 5, adjusted: 3, direction: 'decrease', reasons: [] },
    ];
    const report = auditDifficultyByCohort(events, { u1: 'cohortA' });
    const a = report.cohorts[0];
    expect(a.tasks).toBe(2);
    expect(a.pinnedLowTasks).toBe(1);
    expect(a.pinnedLowShare).toBeCloseTo(0.5, 6);
    expect(a.floorAppliedTasks).toBe(1);
    expect(a.floorAppliedShare).toBeCloseTo(0.5, 6);
  });
});
