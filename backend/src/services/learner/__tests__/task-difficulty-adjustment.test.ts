/**
 * 任务级难度自动调整：档位由代码给（LLM 只出观测），且必须可审计、可回归。
 */
import {
  CHALLENGE_CAP_LIMITS,
  decideTaskDifficulty,
  resolveBaselineLevel,
} from '../TaskDifficultyAdjustmentService';

const metrics = (lss: number, ktl: number, lf: number) => ({ lss, ktl, lf, lsb: ktl - lf });

/** 基线：普通任务（cognitiveLoad=medium → 5）、课内/全局都正常 */
const normalInput = () => ({
  baselineLevel: 5,
  globalMetrics: metrics(2, 3, 1),
  lessonMetrics: metrics(2, 3, 1),
  learningControlState: { paceMode: 'steady', conceptLoad: 'medium', challengeLevelCap: 'medium' } as const,
  fatigueRisk: 'low',
  recommendedPacing: 'moderate',
  knowledgeSignals: { fragileCount: 0, strugglingCount: 0, prerequisiteGapCount: 0 },
});

describe('resolveBaselineLevel（任务基线是确定的，不随表述漂移）', () => {
  it('认知档位优先：low/medium/high → 3/5/7', () => {
    expect(resolveBaselineLevel({ cognitiveLoad: 'low' })).toBe(3);
    expect(resolveBaselineLevel({ cognitiveLoad: 'medium' })).toBe(5);
    expect(resolveBaselineLevel({ cognitiveLoad: 'high' })).toBe(7);
  });

  it('没有认知档位时回落到认知层级，都没有则取中位 5', () => {
    expect(resolveBaselineLevel({ cognitiveLevel: 'apply' })).toBe(5);
    expect(resolveBaselineLevel({ cognitiveLevel: 'create' })).toBe(8);
    expect(resolveBaselineLevel({})).toBe(5);
  });
});

describe('decideTaskDifficulty（调整档位与依据）', () => {
  it('状态正常 → 保持基线，无依据码', () => {
    const decision = decideTaskDifficulty(normalInput());
    expect(decision.direction).toBe('keep');
    expect(decision.adjusted).toBe(5);
    expect(decision.reasons).toEqual([]);
  });

  it('本路径最近压力大（课内 lss≥6）→ 降一档', () => {
    const decision = decideTaskDifficulty({ ...normalInput(), lessonMetrics: metrics(7.2, 3.7, 2.4) });
    expect(decision.direction).toBe('decrease');
    expect(decision.adjusted).toBe(4);
    expect(decision.reasons).toContain('lesson_stress_high');
  });

  it('没有本路径历史时不借用别的路径的单课压力（LSS 是会话级量）', () => {
    const decision = decideTaskDifficulty({
      ...normalInput(),
      lessonMetrics: null,
      globalMetrics: metrics(7.2, 3.7, 2.4), // 全局 lss 高（别的路径的难课），但全局疲劳不高
    });
    expect(decision.direction).toBe('keep');
    expect(decision.reasons).not.toContain('lesson_stress_high');
    expect(decision.evidence.lessonScopeIsPath).toBe(false);
  });

  it('路径失衡（lf≥6 或 lsb<0）→ 降一档', () => {
    const decision = decideTaskDifficulty({ ...normalInput(), lessonMetrics: metrics(2, 2, 4) }); // lsb = -2
    expect(decision.direction).toBe('decrease');
    expect(decision.reasons).toContain('path_load_unbalanced');
  });

  it('总负担高（疲劳）→ 降一档（学习者级信号，不分路径）', () => {
    const decision = decideTaskDifficulty({
      ...normalInput(),
      fatigueRisk: 'high',
      globalMetrics: metrics(3, 5, 7),
    });
    expect(decision.direction).toBe('decrease');
    expect(decision.reasons).toContain('fatigue_high');
  });

  it('知识证据（脆弱/挣扎/前置缺口）各降一档，但累计最多 -2', () => {
    const decision = decideTaskDifficulty({
      ...normalInput(),
      knowledgeSignals: { fragileCount: 1, strugglingCount: 1, prerequisiteGapCount: 2 },
    });
    expect(decision.delta).toBe(-2);
    expect(decision.adjusted).toBe(3);
    expect(decision.reasons).toEqual(['fragile_concepts', 'struggling_concepts', 'prerequisite_gaps']);
  });

  it('challengeLevelCap=low → 封顶 4（封顶不额外计一档，理由是"被上限截断"）', () => {
    const decision = decideTaskDifficulty({
      ...normalInput(),
      baselineLevel: 7,
      learningControlState: { paceMode: 'recover', conceptLoad: 'low', challengeLevelCap: 'low' },
    });
    expect(decision.cap).toBe(CHALLENGE_CAP_LIMITS.low);
    expect(decision.adjusted).toBe(4);
    expect(decision.reasons).toContain('capped_by_challenge_level');
    // 上限不是"再降一档"：没有独立的降档理由，delta 只来自封顶
    expect(decision.reasons).not.toContain('challenge_cap_low');
  });

  it('同一份证据不被算两次：本路径压力大 + 上限 low → 只降一档', () => {
    const decision = decideTaskDifficulty({
      ...normalInput(),
      lessonMetrics: metrics(7.2, 3.7, 2.4),
      learningControlState: { paceMode: 'recover', conceptLoad: 'low', challengeLevelCap: 'low' },
    });
    expect(decision.delta).toBe(-1);
    expect(decision.adjusted).toBe(4);
    expect(decision.reasons).toEqual(['lesson_stress_high']);
  });

  it('有余力（cap high + push + 课内低负荷）→ 升一档，且只升一档', () => {
    const decision = decideTaskDifficulty({
      ...normalInput(),
      lessonMetrics: metrics(3, 6, 2),
      learningControlState: { paceMode: 'push', conceptLoad: 'high', challengeLevelCap: 'high' },
    });
    expect(decision.direction).toBe('increase');
    expect(decision.delta).toBe(1);
    expect(decision.reasons).toEqual(['ready_to_accelerate']);
  });

  it('只要存在降档理由，就不升档', () => {
    const decision = decideTaskDifficulty({
      ...normalInput(),
      lessonMetrics: metrics(3, 6, 2),
      learningControlState: { paceMode: 'push', conceptLoad: 'high', challengeLevelCap: 'high' },
      knowledgeSignals: { fragileCount: 1, strugglingCount: 0, prerequisiteGapCount: 0 },
    });
    expect(decision.direction).toBe('decrease');
    expect(decision.reasons).toContain('fragile_concepts');
  });

  it('难度永远落在 [1, cap] 内，且不越过 0-10 刻度', () => {
    const floor = decideTaskDifficulty({
      ...normalInput(),
      baselineLevel: 1,
      fatigueRisk: 'high',
      knowledgeSignals: { fragileCount: 3, strugglingCount: 3, prerequisiteGapCount: 3 },
    });
    expect(floor.adjusted).toBe(1);
    expect(floor.delta).toBe(0); // 已在下限，调整后不变
    const ceiling = decideTaskDifficulty({
      ...normalInput(),
      baselineLevel: 10,
      learningControlState: { paceMode: 'push', conceptLoad: 'high', challengeLevelCap: 'high' },
      lessonMetrics: metrics(3, 6, 2),
    });
    expect(ceiling.adjusted).toBeLessThanOrEqual(10);
  });

  it('证据快照完整（可审计）', () => {
    const decision = decideTaskDifficulty({ ...normalInput(), lessonMetrics: metrics(7.2, 3.7, 2.4) });
    expect(decision.evidence).toMatchObject({
      lessonLss: 7.2,
      lessonScopeIsPath: true,
      challengeLevelCap: 'medium',
      globalPacing: 'moderate',
    });
  });
});
