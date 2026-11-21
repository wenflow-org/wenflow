import {
  PATH_REVIEW_PASS_THRESHOLD,
  computePathReviewScore,
  validatePathReviewOutput,
} from '../contract';

const GOOD_DIMENSIONS = {
  clarity: 0.9,
  integrity: 0.9,
  depth: 0.9,
  practicality: 0.9,
  pertinence: 0.9,
};

describe('path-reviewer 输出契约（2026-11-21）', () => {
  it('五维度齐全时用统一公式算分', () => {
    const score = computePathReviewScore({
      clarity: 1,
      integrity: 0.8,
      depth: 0.6,
      practicality: 0.4,
      pertinence: 0.2,
    });
    // 1*.2 + .8*.25 + .6*.2 + .4*.2 + .2*.15 = .63
    expect(score).toBeCloseTo(0.63, 10);
  });

  it('校验通过：五维度 + 高分 + 无返工指令', () => {
    const verdict = validatePathReviewOutput({
      score: 0.9,
      dimensions: GOOD_DIMENSIONS,
      issues: [],
      passed: true,
    });
    expect(verdict.valid).toBe(true);
    if (verdict.valid === false) return;
    expect(verdict.score).toBeCloseTo(0.9, 10);
    expect(verdict.needsReplan).toBe(false);
  });

  it('缺任一维度 → 无效（不再用默认值静默补 0.5）', () => {
    const missingDepth = {
      clarity: GOOD_DIMENSIONS.clarity,
      integrity: GOOD_DIMENSIONS.integrity,
      practicality: GOOD_DIMENSIONS.practicality,
      pertinence: GOOD_DIMENSIONS.pertinence,
    };
    const verdict = validatePathReviewOutput({ dimensions: missingDepth });
    expect(verdict).toEqual({
      valid: false,
      failureReason: 'PATH_REVIEWER_DIMENSION_INVALID:depth',
    });
  });

  it('维度越界或非数字 → 无效', () => {
    expect(validatePathReviewOutput({
      dimensions: { ...GOOD_DIMENSIONS, clarity: 85 },
    })).toEqual({ valid: false, failureReason: 'PATH_REVIEWER_DIMENSION_OUT_OF_RANGE:clarity' });
    expect(validatePathReviewOutput({
      dimensions: { ...GOOD_DIMENSIONS, integrity: 'high' },
    })).toEqual({ valid: false, failureReason: 'PATH_REVIEWER_DIMENSION_INVALID:integrity' });
  });

  it('低分且缺返工指令 → 无效（交给重试；重试耗尽后记证据不足）', () => {
    const verdict = validatePathReviewOutput({
      score: 0.5,
      dimensions: { clarity: 0.5, integrity: 0.5, depth: 0.5, practicality: 0.5, pertinence: 0.5 },
      replanInstructions: '   ',
    });
    expect(verdict).toEqual({
      valid: false,
      failureReason: 'PATH_REVIEWER_REPLAN_INSTRUCTIONS_REQUIRED',
    });
  });

  it('低分但给出具体返工指令 → 有效，且 needsReplan', () => {
    const verdict = validatePathReviewOutput({
      score: 0.4,
      dimensions: { clarity: 0.5, integrity: 0.4, depth: 0.5, practicality: 0.5, pertinence: 0.6 },
      replanInstructions: '将 milestone-2 的验收改为能独立复述判据',
    });
    expect(verdict.valid).toBe(true);
    if (verdict.valid === false) return;
    expect(verdict.needsReplan).toBe(true);
    expect(verdict.score).toBeLessThan(PATH_REVIEW_PASS_THRESHOLD);
  });

  it('模型自报 score 与维度不一致时，以统一公式重算为准', () => {
    const verdict = validatePathReviewOutput({
      score: 0.1,
      dimensions: GOOD_DIMENSIONS,
      replanInstructions: '不会被采用：维度分已通过',
    });
    expect(verdict.valid).toBe(true);
    if (verdict.valid === false) return;
    expect(verdict.score).toBeCloseTo(0.9, 10);
    expect(verdict.needsReplan).toBe(false);
  });

  it('非对象输出 → 无效', () => {
    expect(validatePathReviewOutput(null)).toEqual({ valid: false, failureReason: 'PATH_REVIEWER_OUTPUT_NOT_OBJECT' });
    expect(validatePathReviewOutput([])).toEqual({ valid: false, failureReason: 'PATH_REVIEWER_OUTPUT_NOT_OBJECT' });
  });
});
