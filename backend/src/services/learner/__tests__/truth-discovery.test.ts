/**
 * 轻量真值发现（Q7）测试：纯函数，无 IO。
 * 覆盖：权重序、融合数学（手算）、零/空输入、confidence 缩放、分歧度、
 * 元认知校准符号与幅度、覆盖配置、dominantSource、确定性。
 */
import {
  discoverTruth,
  dominantSource,
  metacognitiveCalibration,
  clamp01,
  DEFAULT_SOURCE_WEIGHTS,
  CALIBRATION_ACCURATE_BAND,
  type TruthClaim,
} from '../truth-discovery';

const W_CODE = 0.95;
const W_CHOICE = 0.75;
const W_LLM = 0.5;
const W_SELF = 0.2;

describe('truth-discovery（Q7 多源真值融合）', () => {
  describe('来源权重默认值', () => {
    it('权重序：code_judged > structured_choice > llm_inference > self_report', () => {
      expect(DEFAULT_SOURCE_WEIGHTS.code_judged).toBe(W_CODE);
      expect(DEFAULT_SOURCE_WEIGHTS.structured_choice).toBe(W_CHOICE);
      expect(DEFAULT_SOURCE_WEIGHTS.llm_inference).toBe(W_LLM);
      expect(DEFAULT_SOURCE_WEIGHTS.self_report).toBe(W_SELF);
      expect(DEFAULT_SOURCE_WEIGHTS.code_judged).toBeGreaterThan(DEFAULT_SOURCE_WEIGHTS.structured_choice);
      expect(DEFAULT_SOURCE_WEIGHTS.structured_choice).toBeGreaterThan(DEFAULT_SOURCE_WEIGHTS.llm_inference);
      expect(DEFAULT_SOURCE_WEIGHTS.llm_inference).toBeGreaterThan(DEFAULT_SOURCE_WEIGHTS.self_report);
    });
  });

  describe('discoverTruth 融合数学', () => {
    it('代码裁决 1 + 自评 0 → 0.95/1.15（手算），并给出逐条贡献', () => {
      const result = discoverTruth([
        { source: 'code_judged', value: 1 },
        { source: 'self_report', value: 0 },
      ]);
      expect(result.totalWeight).toBeCloseTo(1.15, 10);
      expect(result.value).toBeCloseTo(0.95 / 1.15, 10); // ≈ 0.826087
      expect(result.contributions).toEqual([
        { source: 'code_judged', weight: W_CODE, value: 1, contribution: W_CODE },
        { source: 'self_report', weight: W_SELF, value: 0, contribution: 0 },
      ]);
    });

    it('confidence 缩放有效权重：同源两条，低置信的一条权重按比例下降', () => {
      const result = discoverTruth([
        { source: 'code_judged', value: 1, confidence: 0.5 }, // 0.475
        { source: 'code_judged', value: 0, confidence: 1 }, // 0.95
      ]);
      expect(result.contributions.map((c) => c.weight)).toEqual([W_CODE * 0.5, W_CODE]);
      expect(result.totalWeight).toBeCloseTo(W_CODE * 1.5, 10);
      expect(result.value).toBeCloseTo(1 / 3, 10); // 0.475 / 1.425
    });

    it('覆盖默认权重后按新权重融合', () => {
      const result = discoverTruth(
        [
          { source: 'code_judged', value: 1 },
          { source: 'self_report', value: 0 },
        ],
        { weights: { self_report: 0.9 } },
      );
      expect(result.contributions[1].weight).toBeCloseTo(0.9, 10);
      expect(result.value).toBeCloseTo(0.95 / 1.85, 10); // ≈ 0.513514（自评几乎追平）
    });

    it('非法覆盖权重被忽略（保留默认）', () => {
      const result = discoverTruth([{ source: 'self_report', value: 1 }], {
        weights: { self_report: Number.NaN },
      });
      expect(result.contributions[0].weight).toBe(W_SELF);
    });

    it('value 越界被夹到 [0,1]', () => {
      const high = discoverTruth([{ source: 'llm_inference', value: 1.5 }]);
      const low = discoverTruth([{ source: 'llm_inference', value: -0.3 }]);
      expect(high.value).toBe(1);
      expect(low.value).toBe(0);
      expect(clamp01(2)).toBe(1);
      expect(clamp01(-2)).toBe(0);
    });
  });

  describe('零 / 空 / 坏值安全', () => {
    it('空数组：value=0、totalWeight=0、无贡献、分歧 0', () => {
      expect(discoverTruth([])).toEqual({
        value: 0,
        totalWeight: 0,
        contributions: [],
        disagreement: 0,
      });
    });

    it('null / undefined 输入安全退化', () => {
      expect(discoverTruth(undefined).totalWeight).toBe(0);
      expect(discoverTruth(null).value).toBe(0);
    });

    it('全部 confidence=0 → 总权重 0，不产生 NaN', () => {
      const result = discoverTruth([{ source: 'self_report', value: 0.9, confidence: 0 }]);
      expect(result.totalWeight).toBe(0);
      expect(result.value).toBe(0);
      expect(result.disagreement).toBe(0);
      expect(result.contributions).toHaveLength(1);
      expect(result.contributions[0].weight).toBe(0);
    });

    it('非有限 value 被跳过；非法 source 也被跳过', () => {
      const result = discoverTruth([
        { source: 'llm_inference', value: Number.NaN },
        { source: 'llm_inference', value: Number.POSITIVE_INFINITY },
        { source: 'llm_inference', value: 0.5 },
        // 运行时坏值：类型系统不认，但函数须安全
        { source: 'not_a_source' as never, value: 1 },
      ]);
      expect(result.contributions).toHaveLength(1);
      expect(result.value).toBeCloseTo(0.5, 10);
    });
  });

  describe('disagreement（加权标准差）', () => {
    it('两源取极值：期望加权标准差（手算 ≈ 0.379035）', () => {
      const result = discoverTruth([
        { source: 'code_judged', value: 1 },
        { source: 'self_report', value: 0 },
      ]);
      expect(result.disagreement).toBeCloseTo(0.379035, 5);
    });

    it('所有主张值一致 → 分歧 0', () => {
      const result = discoverTruth([
        { source: 'code_judged', value: 0.6 },
        { source: 'self_report', value: 0.6 },
      ]);
      expect(result.disagreement).toBeCloseTo(0, 10);
    });

    it('分歧度对 confidence 敏感（低置信极值拉低分歧）', () => {
      const strong = discoverTruth([
        { source: 'code_judged', value: 1 },
        { source: 'self_report', value: 0, confidence: 1 },
      ]);
      const weak = discoverTruth([
        { source: 'code_judged', value: 1 },
        { source: 'self_report', value: 0, confidence: 0.1 },
      ]);
      expect(weak.disagreement).toBeLessThan(strong.disagreement);
    });
  });

  describe('metacognitiveCalibration（元认知校准偏置）', () => {
    it('自评高于真值 → 正 gap、幅度 = 差、方向 overconfident', () => {
      const cal = metacognitiveCalibration(0.9, 0.4);
      expect(cal.gap).toBeCloseTo(0.5, 10);
      expect(cal.magnitude).toBeCloseTo(0.5, 10);
      expect(cal.bias).toBe('overconfident');
    });

    it('自评低于真值 → 负 gap、方向 underconfident', () => {
      const cal = metacognitiveCalibration(0.2, 0.7);
      expect(cal.gap).toBeCloseTo(-0.5, 10);
      expect(cal.magnitude).toBeCloseTo(0.5, 10);
      expect(cal.bias).toBe('underconfident');
    });

    it('差值在容差带内 → accurate', () => {
      const cal = metacognitiveCalibration(0.5, 0.5 + CALIBRATION_ACCURATE_BAND / 2);
      expect(cal.bias).toBe('accurate');
      expect(metacognitiveCalibration(0.5, 0.5).magnitude).toBe(0);
    });

    it('输入夹到 [0,1]（越界不放大偏差）', () => {
      const cal = metacognitiveCalibration(1.5, -1);
      expect(cal.selfValue).toBe(1);
      expect(cal.truthValue).toBe(0);
      expect(cal.gap).toBe(1);
      expect(cal.bias).toBe('overconfident');
    });

    it('与 discoverTruth 串联：自评相对融合真值偏高 → overconfident', () => {
      const truth = discoverTruth([
        { source: 'code_judged', value: 0.3 },
        { source: 'self_report', value: 0.9 },
      ]);
      const cal = metacognitiveCalibration(0.9, truth.value);
      expect(cal.gap).toBeGreaterThan(0);
      expect(cal.bias).toBe('overconfident');
    });
  });

  describe('dominantSource', () => {
    it('返回有效权重最大的来源（confidence 参与聚合）', () => {
      expect(dominantSource([{ source: 'code_judged', value: 1 }])).toBe('code_judged');
      expect(
        dominantSource([
          { source: 'code_judged', value: 1, confidence: 0.1 }, // 0.095
          { source: 'llm_inference', value: 0.5, confidence: 1 }, // 0.5
        ]),
      ).toBe('llm_inference');
    });

    it('空输入 → null', () => {
      expect(dominantSource([])).toBeNull();
      expect(dominantSource(undefined)).toBeNull();
    });
  });

  describe('确定性', () => {
    it('同一批 claims 重复调用结果深度相等', () => {
      const claims: TruthClaim[] = [
        { source: 'code_judged', value: 0.8, confidence: 0.9, at: '2026-09-01T00:00:00.000Z' },
        { source: 'llm_inference', value: 0.5 },
        { source: 'self_report', value: 0.95 },
      ];
      expect(discoverTruth(claims)).toEqual(discoverTruth(claims));
    });

    it('时间戳 at 只作元数据，不影响结果', () => {
      const base: TruthClaim[] = [
        { source: 'code_judged', value: 0.7 },
        { source: 'self_report', value: 0.2 },
      ];
      const withTimestamps: TruthClaim[] = [
        { ...base[0], at: '2020-01-01T00:00:00.000Z' },
        { ...base[1], at: '2026-09-19T12:00:00.000Z' },
      ];
      expect(discoverTruth(withTimestamps)).toEqual(discoverTruth(base));
    });
  });
});
