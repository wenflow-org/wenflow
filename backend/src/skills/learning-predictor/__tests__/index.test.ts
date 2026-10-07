const mockCallPrompt = jest.fn();

jest.mock('../../../composers/prompt-composer', () => ({ callPrompt: mockCallPrompt }));

import { learningPredictor, inferToneEnum, inferDepthEnum } from '../index';
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

describe('learning-predictor P1-13：自由描述透传（toneDetail/depthDetail）+ 枚举语义推断', () => {
  beforeEach(() => jest.clearAllMocks());

  function normalizeWith(raw: any) {
    mockCallPrompt.mockImplementation(async (spec: any, payload: any) => {
      const normalized = spec.normalizeOutput(raw, payload);
      return { success: true, output: normalized, debug: { durationMs: 5 } };
    });
    return learningPredictor(input);
  }

  it('自由描述不再被静默抹：原文透传为 toneDetail，枚举按语义推断为 struggle', async () => {
    // 审计实例 pcl_3679f85e：raw 自由描述 + stallRisk 0.65（<0.7，旧实现落 smooth 全速）
    const raw = '预计在材料/工具栏位区分环节反复卡壳，其余部分较顺畅';
    const result = await normalizeWith({ stallRisk: 0.65, predictedTone: raw });

    expect(result.output?.toneDetail).toBe(raw);
    // 旧 pick() 会落 smooth；新逻辑识别「反复卡壳」→ struggle（非乐观侧）
    expect(result.output?.predictedTone).toBe('struggle');
  });

  it('新契约：枚举字段与 toneDetail/depthDetail 分离时保留模型原文', async () => {
    const toneDetail = '当前缺少学习者知识状态、疲劳信号和任务具体描述，暂按可能需要放慢确认理解的基调处理';
    const depthDetail = '信息不足，先做标准讲解并在确认理解后再决定是否深入';
    const result = await normalizeWith({
      stallRisk: 0.4,
      predictedTone: 'struggle',
      toneDetail,
      suggestedDepth: 'standard',
      depthDetail,
    });

    expect(result.output?.predictedTone).toBe('struggle');
    expect(result.output?.toneDetail).toBe(toneDetail);
    expect(result.output?.suggestedDepth).toBe('standard');
    expect(result.output?.depthDetail).toBe(depthDetail);
  });

  it('深度自由描述原文透传为 depthDetail，枚举按语义推断', async () => {
    const result = await normalizeWith({ stallRisk: 0.4, suggestedDepth: '需要深挖原理并配对比练习' });
    expect(result.output?.depthDetail).toBe('需要深挖原理并配对比练习');
    expect(result.output?.suggestedDepth).toBe('deep');

    const r2 = await normalizeWith({ stallRisk: 0.4, suggestedDepth: '轻量带过即可' });
    expect(r2.output?.depthDetail).toBe('轻量带过即可');
    expect(r2.output?.suggestedDepth).toBe('shallow');
  });

  it('枚举值原样时不产生 detail（避免与枚举重复占位）', async () => {
    const result = await normalizeWith({ stallRisk: 0.4, predictedTone: 'struggle', suggestedDepth: 'deep' });
    expect(result.output?.toneDetail).toBeNull();
    expect(result.output?.depthDetail).toBeNull();
    expect(result.output?.predictedTone).toBe('struggle');
    expect(result.output?.suggestedDepth).toBe('deep');
  });

  it('混合描述按非乐观侧定枚举：句尾「较顺畅」不掩盖主卡点', async () => {
    const result = await normalizeWith({
      stallRisk: 0.55,
      predictedTone: '开头会顺畅推进，但预计在方法选择环节反复受阻、需要放慢',
    });
    expect(result.output?.predictedTone).toBe('struggle');
    expect(result.output?.toneDetail).toContain('反复受阻');
  });

  it('疲劳语义优先于顺畅：识别为 fatigue', async () => {
    const result = await normalizeWith({ stallRisk: 0.3, predictedTone: '今天状态不佳、精力不足，估计会疲劳' });
    expect(result.output?.predictedTone).toBe('fatigue');
  });

  it('纯无法分类的自由描述：枚举保持历史兜底 smooth，但原文不丢（toneDetail 保留）', async () => {
    const result = await normalizeWith({ stallRisk: 0.3, predictedTone: '说不好，看情况吧' });
    expect(result.output?.predictedTone).toBe('smooth');
    expect(result.output?.toneDetail).toBe('说不好，看情况吧');
  });

  it('inferToneEnum / inferDepthEnum 纯函数：枚举直通与关键词映射', () => {
    expect(inferToneEnum('struggle')).toBe('struggle');
    expect(inferToneEnum('会反复卡壳')).toBe('struggle');
    expect(inferToneEnum('状态很好，很顺畅')).toBe('smooth');
    expect(inferToneEnum('')).toBeNull();
    expect(inferDepthEnum('deep')).toBe('deep');
    expect(inferDepthEnum('需要深挖原理')).toBe('deep');
    expect(inferDepthEnum('基础复习即可')).toBe('shallow');
    expect(inferDepthEnum('')).toBeNull();
  });

  it('inferToneEnum 否定式轻松表达不得误判为吃力（复核反例）', () => {
    expect(inferToneEnum('无障碍')).toBe('smooth');
    expect(inferToneEnum('不困难')).toBe('smooth');
    expect(inferToneEnum('应该没什么障碍')).toBe('smooth');
    expect(inferToneEnum('不容易卡壳')).toBe('smooth');
  });

  it('inferToneEnum 负向难度信号不得回落乐观（复核反例：偏难→null）', () => {
    expect(inferToneEnum('偏难')).toBe('struggle');
    expect(inferToneEnum('这个任务偏难，可能要放慢')).toBe('struggle');
    expect(inferToneEnum('卡壳')).toBe('struggle');
  });

  it('显式 smooth 枚举与 toneDetail 负向语义冲突时取非乐观侧', async () => {
    const result = await normalizeWith({
      stallRisk: 0.5,
      predictedTone: 'smooth',
      toneDetail: '预计在方法选择环节反复卡壳',
    });
    expect(result.output?.predictedTone).toBe('struggle');
    expect(result.output?.toneDetail).toContain('反复卡壳');
  });

  it('buildUserPayload：稳定键前置，只传 taskContext 时首键仍为 fatigueSignal', async () => {
    let captured: any;
    mockCallPrompt.mockImplementation(async (spec: any, payload: any) => {
      captured = spec.buildUserPayload(payload);
      return { success: true, output: spec.normalizeOutput({ stallRisk: 0.5 }, payload), debug: { durationMs: 1 } };
    });
    await learningPredictor({ taskContext: { title: 't' } } as any);
    expect(Object.keys(captured).slice(0, 2)).toEqual(['fatigueSignal', 'knowledgeStateSummary']);
    expect(captured.taskContext).toEqual({ title: 't' });
  });

  it('新契约 detail 为空串时不占位（回落 null）', async () => {
    const result = await normalizeWith({ stallRisk: 0.4, predictedTone: 'smooth', toneDetail: '   ', suggestedDepth: 'deep', depthDetail: '' });
    expect(result.output?.toneDetail).toBeNull();
    expect(result.output?.depthDetail).toBeNull();
  });
});
