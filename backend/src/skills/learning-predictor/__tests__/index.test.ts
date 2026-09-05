const mockCallPrompt = jest.fn();

jest.mock('../../../composers/prompt-composer', () => ({ callPrompt: mockCallPrompt }));

import { learningPredictor } from '../index';
import type { LearningPredictorInput } from '../index';

const input: LearningPredictorInput = {
  knowledgeStateSummary: '学习者已掌握 CSV 结构概念，但对合并聚合仍脆弱',
  fatigueSignal: 'low',
  taskContext: { title: '合并汇总脚本实战', learningObjectives: ['数据合并'] },
};

describe('learning-predictor 失败显式传播', () => {
  beforeEach(() => jest.clearAllMocks());

  it('callPrompt 抛错 → handler 直接 throw（预测失败由调用方决定是否降级）', async () => {
    mockCallPrompt.mockRejectedValue(new Error('provider timeout'));
    await expect(learningPredictor(input)).rejects.toThrow('provider timeout');
    expect(mockCallPrompt).toHaveBeenCalledTimes(1);
  });

  it('callPrompt success:false → handler throw（保留错误信息）', async () => {
    mockCallPrompt.mockResolvedValue({
      success: false,
      error: { code: 'SKILL_X_FAILED', message: 'validation failed' },
      debug: { durationMs: 12 },
    });
    await expect(learningPredictor(input)).rejects.toThrow('validation failed');
  });
});

describe('learning-predictor normalize（不注入伪值 + 自洽约束）', () => {
  beforeEach(() => jest.clearAllMocks());

  function normalizeWith(raw: any) {
    mockCallPrompt.mockImplementation(async (spec: any, payload: any) => {
      const normalized = spec.normalizeOutput(raw, payload);
      return { success: true, output: normalized, debug: { durationMs: 5 } };
    });
    return learningPredictor(input);
  }

  it('合法输出原样保留（stallRisk/tone/depth/concepts/rationale）', async () => {
    const result = await normalizeWith({
      stallRisk: 0.42,
      predictedTone: 'struggle',
      suggestedDepth: 'deep',
      focusConcepts: ['数据合并', '分组聚合'],
      rationale: '合并概念仍脆弱，建议慢速深入',
    });

    expect(result.output?.stallRisk).toBe(0.42);
    expect(result.output?.predictedTone).toBe('struggle');
    expect(result.output?.suggestedDepth).toBe('deep');
    expect(result.output?.focusConcepts).toEqual(['数据合并', '分组聚合']);
    expect(result.output?.rationale).toContain('合并概念');
  });

  it('stallRisk 越界钳制到 0-1；非法值回退 0.5（不虚报确定性）', async () => {
    const r1 = await normalizeWith({ stallRisk: 1.7 });
    expect(r1.output?.stallRisk).toBe(1);

    const r2 = await normalizeWith({ stallRisk: -0.4 });
    expect(r2.output?.stallRisk).toBe(0);

    const r3 = await normalizeWith({ stallRisk: 'abc' });
    expect(r3.output?.stallRisk).toBe(0.5);

    const r4 = await normalizeWith({});
    expect(r4.output?.stallRisk).toBe(0.5);
  });

  it('自洽约束：stallRisk >= 0.7 且 tone=smooth → 强制 struggle', async () => {
    const result = await normalizeWith({ stallRisk: 0.85, predictedTone: 'smooth' });
    expect(result.output?.predictedTone).toBe('struggle');
  });

  it('自洽约束不误伤：stallRisk < 0.7 时保留 smooth', async () => {
    const result = await normalizeWith({ stallRisk: 0.4, predictedTone: 'smooth' });
    expect(result.output?.predictedTone).toBe('smooth');
  });

  it('非法枚举兜底：tone → smooth、depth → standard（保守默认）', async () => {
    const result = await normalizeWith({ predictedTone: 'chaos', suggestedDepth: 'extreme' });
    expect(result.output?.predictedTone).toBe('smooth');
    expect(result.output?.suggestedDepth).toBe('standard');
  });

  it('focusConcepts：过滤空值 + 截断到 3 个', async () => {
    const result = await normalizeWith({
      focusConcepts: ['A', '', null, 'B', 'C', 'D', 'E'],
    });
    expect(result.output?.focusConcepts).toEqual(['A', 'B', 'C']);
  });

  it('rationale 非字符串 → 空字符串（不脑补）', async () => {
    const result = await normalizeWith({ rationale: 123 });
    expect(result.output?.rationale).toBe('');
  });
});
