import {
  SESSION_EVALUATION_TIER_ANCHORS,
  SESSION_EVALUATION_TIERS,
  SESSION_EVALUATION_ZERO_EVIDENCE,
  isSessionEvaluationTier,
  resolveSessionEvaluationTier,
  sessionEvaluationTierToValue,
} from '../session-evaluation-scale';

describe('session-evaluation-scale：档位→数值的唯一映射（来源 = session-wrapup 锚点表）', () => {
  it('锚点表覆盖 1-4 / 5-7 / 8-10 连续三档', () => {
    expect(SESSION_EVALUATION_TIERS).toEqual(['low', 'mid', 'high']);
    expect(SESSION_EVALUATION_TIER_ANCHORS.map((a) => [a.min, a.max])).toEqual([
      [1, 4],
      [5, 7],
      [8, 10],
    ]);
    // 三档首尾相接、无空洞、无重叠
    for (let index = 1; index < SESSION_EVALUATION_TIER_ANCHORS.length; index += 1) {
      expect(SESSION_EVALUATION_TIER_ANCHORS[index].min).toBe(SESSION_EVALUATION_TIER_ANCHORS[index - 1].max + 1);
    }
  });

  it('档位边界：low=2.5 / mid=6 / high=9（区间中点），并携带 range 与 uncertainty', () => {
    expect(sessionEvaluationTierToValue('low')).toBe(2.5);
    expect(sessionEvaluationTierToValue('mid')).toBe(6);
    expect(sessionEvaluationTierToValue('high')).toBe(9);

    expect(resolveSessionEvaluationTier('low')).toEqual({
      tier: 'low',
      value: 2.5,
      range: { min: 1, max: 4 },
      uncertainty: 1.5,
    });
    expect(resolveSessionEvaluationTier('mid').uncertainty).toBe(1);
    expect(resolveSessionEvaluationTier('high')).toEqual({
      tier: 'high',
      value: 9,
      range: { min: 8, max: 10 },
      uncertainty: 1,
    });
  });

  it('isSessionEvaluationTier 只认三档字面量', () => {
    expect(isSessionEvaluationTier('low')).toBe(true);
    expect(isSessionEvaluationTier('mid')).toBe(true);
    expect(isSessionEvaluationTier('high')).toBe(true);
    expect(isSessionEvaluationTier('LOW')).toBe(false);
    expect(isSessionEvaluationTier(3)).toBe(false);
    expect(isSessionEvaluationTier('3')).toBe(false);
    expect(isSessionEvaluationTier(null)).toBe(false);
    expect(isSessionEvaluationTier(undefined)).toBe(false);
  });

  it('未知档位在 resolve 时抛错（不静默兜底）', () => {
    expect(() => resolveSessionEvaluationTier('huge' as never)).toThrow(/未知的会话评估档位/);
  });

  it('零证据常量固定为 3/3/3 + confidence 0.1', () => {
    expect(SESSION_EVALUATION_ZERO_EVIDENCE).toMatchObject({ lss: 3, ktl: 3, lf: 3, confidence: 0.1 });
  });
});
