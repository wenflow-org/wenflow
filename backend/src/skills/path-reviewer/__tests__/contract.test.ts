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

describe('path-reviewer 档位制 + 合取闸（2026-11-22）', () => {
  const TIER_DIMENSIONS = {
    clarity: 'adequate',
    integrity: 'strong',
    depth: 'weak',
    practicality: 'adequate',
    pertinence: 'strong',
  };

  it('档位输出：按锚点映射数值并加权（adequate/strong/weak → 0.85/1.0/0.6）', () => {
    const verdict = validatePathReviewOutput({ dimensions: TIER_DIMENSIONS, issues: [] });
    expect(verdict.valid).toBe(true);
    if (verdict.valid === false) return;
    expect(verdict.dimensions.clarity).toBe(0.85);
    expect(verdict.dimensions.integrity).toBe(1.0);
    expect(verdict.dimensions.depth).toBe(0.6);
    expect(verdict.failTiers.size).toBe(0);
    // 0.2*0.85 + 0.25*1.0 + 0.2*0.6 + 0.2*0.85 + 0.15*1.0 = 0.8575 ≥ 0.75
    expect(verdict.score).toBeGreaterThanOrEqual(PATH_REVIEW_PASS_THRESHOLD);
    expect(verdict.needsReplan).toBe(false);
  });

  it('合取闸①：任一 issue severity=high → needsReplan，且必须带返工指令', () => {
    const noInstructions = validatePathReviewOutput({
      dimensions: { clarity: 'strong', integrity: 'strong', depth: 'strong', practicality: 'strong', pertinence: 'strong' },
      issues: [{ dimension: 'integrity', severity: 'high', description: 'M1 把终点概念当验收' }],
    });
    expect(noInstructions).toEqual({ valid: false, failureReason: 'PATH_REVIEWER_REPLAN_INSTRUCTIONS_REQUIRED' });

    const withInstructions = validatePathReviewOutput({
      dimensions: { clarity: 'strong', integrity: 'weak', depth: 'strong', practicality: 'strong', pertinence: 'strong' },
      issues: [{ dimension: 'integrity', severity: 'high', description: 'M1 把终点概念当验收' }],
      replanInstructions: 'milestone-1 只保留本阶段概念的验收，终点概念移到末阶段',
    });
    expect(withInstructions.valid).toBe(true);
    if (withInstructions.valid === false) return;
    // 五维全是 strong/weak 加权 ≥0.75，但 severity=high 结构红线一票否决
    expect(withInstructions.score).toBeGreaterThanOrEqual(PATH_REVIEW_PASS_THRESHOLD);
    expect(withInstructions.needsReplan).toBe(true);
  });

  it('合取闸②：任一维度 fail → needsReplan，legacy 数值输出不触发 fail 语义', () => {
    const tierFail = validatePathReviewOutput({
      dimensions: { ...TIER_DIMENSIONS, depth: 'fail' },
      issues: [],
      replanInstructions: 'milestone-2/3 原地换芯，删除目录式导论',
    });
    expect(tierFail.valid).toBe(true);
    if (tierFail.valid === false) return;
    expect([...tierFail.failTiers]).toEqual(['depth']);
    expect(tierFail.needsReplan).toBe(true);

    const legacyNumeric = validatePathReviewOutput({
      dimensions: { clarity: 0.9, integrity: 0.9, depth: 0.9, practicality: 0.9, pertinence: 0.9 },
      issues: [],
    });
    expect(legacyNumeric.valid).toBe(true);
    if (legacyNumeric.valid === false) return;
    expect(legacyNumeric.failTiers.size).toBe(0);
    expect(legacyNumeric.needsReplan).toBe(false);
  });

  it('非法档位词 → 无效（挡住模型自由发挥的枚举）', () => {
    const verdict = validatePathReviewOutput({
      dimensions: { clarity: 'good', integrity: 'strong', depth: 'weak', practicality: 'adequate', pertinence: 'strong' },
      issues: [],
    });
    expect(verdict).toEqual({ valid: false, failureReason: 'PATH_REVIEWER_DIMENSION_INVALID:clarity' });
  });
});
