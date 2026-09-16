/**
 * 难度调整的留痕与效果度量：主指标（同类降档理由是否缓解）、辅指标（lsb/lf 变化）、
 * 以及"层级要对得上"（路径级理由用本路径状态复算、全局级理由用全局聚合复算）。
 */
import {
  evaluateAdjustmentEffect,
  metricReasonsFromState,
  parseAdjustment,
  serializeAdjustment,
  summarizeAdjustmentEffects,
  type AdjustmentEffect,
  type TaskDifficultyAdjustmentRecord,
} from '../TaskDifficultyAdjustmentLedger';

const record = (overrides: Partial<TaskDifficultyAdjustmentRecord> = {}): TaskDifficultyAdjustmentRecord => ({
  userId: 'u1',
  taskId: 't1',
  pathId: 'lp-A',
  occurredAt: new Date('2026-08-16T09:00:00Z'),
  baseline: 9,
  adjusted: 7,
  direction: 'decrease',
  reasons: ['lesson_stress_high'],
  applied: true,
  evidence: { lessonLss: 7.2, lessonLf: 2.4, lessonLsb: 1.3 },
  ...overrides,
});

describe('留痕序列化', () => {
  it('往返一致；非法 payload 返回 null（不编造）', () => {
    const parsed = parseAdjustment(serializeAdjustment(record()));
    expect(parsed).toMatchObject({
      baseline: 9, adjusted: 7, direction: 'decrease', reasons: ['lesson_stress_high'], applied: true,
    });
    expect(parseAdjustment('{bad json')).toBeNull();
    expect(parseAdjustment(null)).toBeNull();
  });
});

describe('metricReasonsFromState（与判定器同阈值、同层级）', () => {
  it('有本路径状态 → 复算路径级理由', () => {
    expect(metricReasonsFromState({
      pathState: { lss: 7.2, ktl: 3.7, lf: 2.4, lsb: 1.3 },
      globalLf: 3, globalLsb: 1,
    })).toEqual(['lesson_stress_high']);

    expect(metricReasonsFromState({
      pathState: { lss: 2, ktl: 2, lf: 2.5, lsb: -0.5 },
      globalLf: 3, globalLsb: 1,
    })).toEqual(['path_load_unbalanced']);
  });

  it('没有本路径状态 → 绝不产出路径级理由（防跨路径泄漏），只出全局级', () => {
    const reasons = metricReasonsFromState({
      pathState: null,
      globalLf: 6.5,
      globalLsb: -1,
    });
    expect(reasons).toEqual(['fatigue_high', 'global_imbalance']);
    expect(reasons).not.toContain('lesson_stress_high');
    expect(reasons).not.toContain('path_load_unbalanced');
  });
});

describe('evaluateAdjustmentEffect', () => {
  it('下一条同路径状态不再触发同类理由 → relieved（并给出 Δlsb/Δlf）', () => {
    const effect = evaluateAdjustmentEffect({
      record: record(),
      nextState: { metrics: { lss: 5.6, ktl: 3.3, lf: 2.1, lsb: 1.2 }, taskId: 't2', calculatedAt: new Date() },
      nextPathState: { lss: 5.6, ktl: 3.3, lf: 2.1, lsb: 1.2 },
      globalLfAtNextState: 3,
      globalLsbAtNextState: 0.5,
    });
    expect(effect.outcome).toBe('relieved');
    expect(effect.lsbDelta).toBeCloseTo(-0.1, 6);
    expect(effect.lfDelta).toBeCloseTo(-0.3, 6);
    expect(effect.nextTaskId).toBe('t2');
  });

  it('同类理由仍成立 → still_triggered，并指出是哪条', () => {
    const effect = evaluateAdjustmentEffect({
      record: record(),
      nextState: { metrics: { lss: 7.2, ktl: 3.7, lf: 2.4, lsb: 1.3 }, taskId: 't2', calculatedAt: new Date() },
      nextPathState: { lss: 7.2, ktl: 3.7, lf: 2.4, lsb: 1.3 },
      globalLfAtNextState: 3,
      globalLsbAtNextState: 0.5,
    });
    expect(effect.outcome).toBe('still_triggered');
    expect(effect.stillTriggeredReasons).toEqual(['lesson_stress_high']);
  });

  it('知识类理由需要快照才能复算 → 明确标注 not_measurable（不假装度量过）', () => {
    const effect = evaluateAdjustmentEffect({
      record: record({ reasons: ['fragile_concepts'] }),
      nextState: { metrics: { lss: 1, ktl: 1, lf: 1, lsb: 0 }, taskId: 't2', calculatedAt: new Date() },
      nextPathState: { lss: 1, ktl: 1, lf: 1, lsb: 0 },
      globalLfAtNextState: 1,
      globalLsbAtNextState: 0,
    });
    expect(effect.outcome).toBe('not_measurable');
    expect(effect.lsbAfter).toBeNull();
  });

  it('还没有下一条状态 → no_next_state', () => {
    const effect = evaluateAdjustmentEffect({
      record: record(),
      nextState: null,
      nextPathState: null,
      globalLfAtNextState: null,
      globalLsbAtNextState: null,
    });
    expect(effect.outcome).toBe('no_next_state');
  });
});

describe('summarizeAdjustmentEffects', () => {
  const effect = (overrides: Partial<AdjustmentEffect>): AdjustmentEffect => ({
    taskId: 't', pathId: 'lp-A', baseline: 9, adjusted: 7,
    reasons: ['lesson_stress_high'], measurableReasons: ['lesson_stress_high'],
    applied: true, outcome: 'relieved', stillTriggeredReasons: [],
    lsbBefore: 1, lfBefore: 2, lsbAfter: 1.5, lfAfter: 1.8, lsbDelta: 0.5, lfDelta: -0.2,
    nextTaskId: 't2', nextAt: new Date(),
    ...overrides,
  });

  it('按"理由 × 是否执行"分组，对照组与实验组分开（这就是 A/B 对照）', () => {
    const groups = summarizeAdjustmentEffects([
      effect({ applied: true, outcome: 'relieved' }),
      effect({ applied: false, outcome: 'still_triggered', stillTriggeredReasons: ['lesson_stress_high'] }),
    ]);
    const appliedGroup = groups.find((group) => group.applied)!;
    const controlGroup = groups.find((group) => !group.applied)!;
    expect(appliedGroup).toMatchObject({ reason: 'lesson_stress_high', total: 1, relieved: 1, relievedRate: 1 });
    expect(controlGroup).toMatchObject({ total: 1, relieved: 0, relievedRate: 0 });
  });

  it('不可度量/无后续状态的锚点不计入分母', () => {
    const groups = summarizeAdjustmentEffects([
      effect({ outcome: 'not_measurable', measurableReasons: [] }),
      effect({ outcome: 'no_next_state' }),
    ]);
    expect(groups).toHaveLength(0);
  });

  it('给出辅指标均值（Δlsb / Δlf）', () => {
    const groups = summarizeAdjustmentEffects([
      effect({ lsbDelta: 0.4, lfDelta: -0.2 }),
      effect({ lsbDelta: 0.6, lfDelta: -0.4 }),
    ]);
    expect(groups[0].avgLsbDelta).toBeCloseTo(0.5, 6);
    expect(groups[0].avgLfDelta).toBeCloseTo(-0.3, 6);
  });
});
