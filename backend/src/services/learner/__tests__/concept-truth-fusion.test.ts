/**
 * Q7 概念真值裁决测试（纯函数，无 IO）。
 * 覆盖：多源冲突（代码压过 LLM/自评）、单源行为不变、缺源/读取失败结构化打标、
 * 元认知校准、锚题证据解析与归一。
 */
import {
  CONCEPT_TRUTH_MASTERY_THRESHOLD,
  adjudicateConceptTruth,
  parseAnchorCodeClaims,
} from '../concept-truth-fusion';

describe('adjudicateConceptTruth（Q7 多源真值裁决）', () => {
  it('多源冲突：代码裁决 0 与 LLM 推断 1 → 代码赢，判未掌握 + 来源拆解', () => {
    const result = adjudicateConceptTruth({
      conceptKey: 'c1',
      code: [{ value: 0, confidence: 0.95 }],
      llm: [{ value: 1 }],
    });
    // 手算：code 有效权重 0.95×0.95=0.9025，llm 0.5 → (0 + 0.5) / 1.4025 = 0.356506...
    expect(result.value).toBeCloseTo(0.5 / (0.95 * 0.95 + 0.5), 10);
    expect(result.value).toBeLessThan(CONCEPT_TRUTH_MASTERY_THRESHOLD);
    expect(result.observed).toBe(false);
    expect(result.hasEvidence).toBe(true);
    expect(result.dominantSource).toBe('code_judged');
    expect(result.contributions.map((item) => item.source)).toEqual(['code_judged', 'llm_inference']);
    expect(result.disagreement).toBeGreaterThan(0);
    expect(result.sourceStatus).toEqual({
      code_judged: 'ok',
      structured_choice: 'missing',
      llm_inference: 'ok',
      self_report: 'missing',
    });
    expect(result.calibration).toBeNull();
  });

  it('多源冲突反向：代码裁决 1 与 LLM 推断 0 → 代码赢，判已掌握', () => {
    const result = adjudicateConceptTruth({
      conceptKey: 'c1',
      code: [{ value: 1 }],
      llm: [{ value: 0 }],
    });
    // (0.95×1 + 0.5×0) / 1.45 = 0.655172...
    expect(result.value).toBeCloseTo(0.95 / 1.45, 10);
    expect(result.value).toBeGreaterThanOrEqual(CONCEPT_TRUTH_MASTERY_THRESHOLD);
    expect(result.observed).toBe(true);
    expect(result.dominantSource).toBe('code_judged');
  });

  it('自评不作掌握依据：代码 0 + 自评 1 → 仍判未掌握，并给出 overconfident 校准', () => {
    const result = adjudicateConceptTruth({
      conceptKey: 'c1',
      code: [{ value: 0 }],
      selfReport: [{ value: 1 }],
    });
    expect(result.observed).toBe(false);
    expect(result.dominantSource).toBe('code_judged');
    expect(result.calibration?.bias).toBe('overconfident');
    expect(result.calibration?.gap).toBeGreaterThan(0);
    // 自评只贡献很小的权重，无法翻盘
    expect(result.value).toBeLessThan(CONCEPT_TRUTH_MASTERY_THRESHOLD);
  });

  it('单源行为不变：仅 LLM 时融合值 = 原值，阈值化与原二值判定一致', () => {
    const mastered = adjudicateConceptTruth({ conceptKey: 'c1', llm: [{ value: 1 }] });
    const not = adjudicateConceptTruth({ conceptKey: 'c1', llm: [{ value: 0 }] });
    expect(mastered.value).toBe(1);
    expect(mastered.observed).toBe(true);
    expect(not.value).toBe(0);
    expect(not.observed).toBe(false);
    expect(mastered.dominantSource).toBe('llm_inference');
  });

  it('单源行为不变：仅代码裁决时融合值 = 原值', () => {
    const result = adjudicateConceptTruth({ conceptKey: 'c1', code: [{ value: 1 }] });
    expect(result.value).toBe(1);
    expect(result.observed).toBe(true);
    expect(result.sourceStatus.code_judged).toBe('ok');
  });

  it('无有效主张：hasEvidence=false、observed=false，且所有来源标 missing（不伪造观测）', () => {
    const result = adjudicateConceptTruth({ conceptKey: 'c1' });
    expect(result.hasEvidence).toBe(false);
    expect(result.observed).toBe(false);
    expect(result.value).toBe(0);
    expect(result.sourceStatus).toEqual({
      code_judged: 'missing',
      structured_choice: 'missing',
      llm_inference: 'missing',
      self_report: 'missing',
    });
  });

  it('读取失败结构化打标：read_failed 显式覆盖，不静默当成"无证据"', () => {
    const result = adjudicateConceptTruth({
      conceptKey: 'c1',
      llm: [{ value: 1 }],
      sourceStatus: { code_judged: 'read_failed' },
    });
    expect(result.sourceStatus.code_judged).toBe('read_failed');
    // 读取失败不阻断 LLM 单源观测（行为与接线前一致）
    expect(result.observed).toBe(true);
  });

  it('结构化/自评多源参与融合（confidence 缩放有效权重）', () => {
    const result = adjudicateConceptTruth({
      conceptKey: 'c1',
      structured: [{ value: 1, confidence: 0.5 }],
      selfReport: [{ value: 0.9 }],
    });
    // structured 有效权重 0.75×0.5=0.375；self 0.2；融合值 = (0.375+0.18)/0.575
    expect(result.value).toBeCloseTo(0.555 / 0.575, 10);
    expect(result.observed).toBe(true);
    // 自评 0.9 略低于融合真值（0.965…）→ underconfident
    expect(result.calibration?.bias).toBe('underconfident');
  });

  it('非有限主张值被忽略，不产生污染', () => {
    const result = adjudicateConceptTruth({
      conceptKey: 'c1',
      llm: [{ value: Number.NaN }, { value: 1 }],
    });
    expect(result.contributions).toHaveLength(1);
    expect(result.value).toBe(1);
  });
});

describe('parseAnchorCodeClaims（anchor:result → 按概念分组的代码裁决主张）', () => {
  const rows = [
    { payload: JSON.stringify({ conceptKey: '剪辑节奏', passed: true }), confidence: 0.95 },
    { payload: JSON.stringify({ conceptKey: '剪辑节奏', passed: false }), confidence: 0.95 },
    { payload: JSON.stringify({ conceptKey: '转场', passed: null }), confidence: 0.95 },
    { payload: JSON.stringify({ passed: true }), confidence: 0.95 },
    { payload: 'not-json', confidence: 0.95 },
    { payload: JSON.stringify({ conceptKey: '色彩', passed: false }) },
  ];

  it('按概念分组；passed=null/缺 conceptKey/坏 payload 被跳过；confidence 透传', () => {
    const byConcept = parseAnchorCodeClaims(rows);
    expect(byConcept.get('剪辑节奏')).toEqual([{ value: 1, confidence: 0.95 }, { value: 0, confidence: 0.95 }]);
    expect(byConcept.has('转场')).toBe(false);
    expect(byConcept.get('色彩')).toEqual([{ value: 0 }]);
  });

  it('keyOf 归一后合并同义概念', () => {
    const byConcept = parseAnchorCodeClaims(rows, (key) => key.replace(/\s+/g, '').toLowerCase());
    expect(byConcept.get('剪辑节奏')).toHaveLength(2);
  });

  it('空/undefined 输入安全返回空 Map', () => {
    expect(parseAnchorCodeClaims([]).size).toBe(0);
    expect(parseAnchorCodeClaims(undefined).size).toBe(0);
  });
});
