/* eslint-disable @typescript-eslint/no-explicit-any -- wrapup 探针：模型 I/O 载荷形状内在动态（对齐 retention-claim-fidelity 先例） */
/**
 * wrapup summary 文本要点的算式自检（内容正确性第二刀，2026-10-08）。
 *
 * 契约：
 * - 只针对**文本要点**（keyTakeaways / actionPlan / evaluationHighlights.strengths|improvements
 *   的数组项）逐条复算，命中即剔除该要点、其余保留；
 * - 长文本字段（topicSummary 等）是 summary 必填契约，不整段剔除；
 * - 无命中时返回原对象（removed 空），不产生新引用；
 * - 与保持率剥离（stripUnsupportedRetentionClaims，P1-11）相互独立、可叠加。
 *
 * 遥测 mock：recordDegradation 真实现会落库 degradation_events——测试绝不能碰 dev.db。
 */
const mockCallPrompt = jest.fn();
const mockRecordDegradation = jest.fn();

jest.mock('../../../composers/prompt-composer', () => ({ callPrompt: mockCallPrompt }));
jest.mock('../../../gateway/api-gateway', () => ({ getAPIGateway: () => ({}) }));
jest.mock('../../degradation-telemetry', () => ({ recordDegradation: mockRecordDegradation }));

import {
  sessionWrapupAgent,
  stripArithmeticMismatchItems,
  validateSessionWrapupParsedOutput,
  type SessionWrapupInput,
  type SessionWrapupSummary,
} from '../index';

function buildSummary(overrides: Partial<SessionWrapupSummary> = {}): SessionWrapupSummary {
  return {
    topicSummary: '本节课围绕长除法进行了学习。',
    knowledgeSummary: '本节共涉及2个知识点。',
    practiceAdvice: '再做一道同类题巩固。',
    learningEvaluation: '本节推进顺利。',
    knowledgeItems: [{ name: '长除法', status: 'mastered', progress: 80, evidence: '能独立完成计算。' }],
    keyTakeaways: ['完成本节学习回顾'],
    actionPlan: ['继续完成下一步练习'],
    evaluationHighlights: { strengths: ['计算过程完整'], improvements: ['验算习惯待加强'] },
    metricInterpretation: { session: '本节课总结已生成。', longTerm: '长期指标需要后续观察。' },
    summaryVersion: 'v2',
    ...overrides,
  };
}

function buildInput(): SessionWrapupInput {
  return {
    messages: [
      { role: 'user', content: '老师好' },
      { role: 'assistant', content: '我们开始学长除法。' },
    ],
    knowledgePoints: [{ name: '长除法', status: 'mastered', progress: 80 }],
    sessionInfo: {
      subject: '数学',
      topic: '长除法',
      durationMinutes: 25,
      userMessageCount: 1,
      assistantMessageCount: 1,
    },
    knowledgeContext: { reviewHints: [{ concept: '长除法', retrievability: 0.7 }] },
  };
}

describe('stripArithmeticMismatchItems（纯函数）', () => {
  it('命中要点剔除、其余保留（含 highlights 两个数组）', () => {
    const summary = buildSummary({
      keyTakeaways: ['完成本节学习回顾', '7 个 15 元一共是 15 × 7 = 115 元'],
      actionPlan: ['重算一遍 728 ÷ 26 = 130 的例题', '继续完成下一步练习'],
      evaluationHighlights: {
        strengths: ['计算过程完整', '正确算出 12 × 15 = 181'],
        improvements: ['验算习惯待加强'],
      },
    });
    const { summary: cleaned, removed } = stripArithmeticMismatchItems(summary);
    expect(removed).toHaveLength(3);
    expect(cleaned.keyTakeaways).toEqual(['完成本节学习回顾']);
    expect(cleaned.actionPlan).toEqual(['继续完成下一步练习']);
    expect(cleaned.evaluationHighlights.strengths).toEqual(['计算过程完整']);
    expect(cleaned.evaluationHighlights.improvements).toEqual(['验算习惯待加强']);
    // 未命中的字段原样保留
    expect(cleaned.topicSummary).toBe(summary.topicSummary);
    expect(cleaned.knowledgeItems).toEqual(summary.knowledgeItems);
  });

  it('无命中返回原对象（removed 空，不产生新引用）', () => {
    const summary = buildSummary();
    const result = stripArithmeticMismatchItems(summary);
    expect(result.removed).toHaveLength(0);
    expect(result.summary).toBe(summary);
  });

  it('长文本字段不算要点：topicSummary 带错算式也不整段剔除（必填契约字段）', () => {
    const summary = buildSummary({ topicSummary: '我们先看了 728 ÷ 26 = 130 的例子。' });
    const { summary: cleaned, removed } = stripArithmeticMismatchItems(summary);
    expect(removed).toHaveLength(0);
    expect(cleaned.topicSummary).toContain('728 ÷ 26 = 130');
  });

  it('全数组项命中 → 数组为空但形状合法（isSummary 仍通过）', () => {
    const summary = buildSummary({
      keyTakeaways: ['15 × 7 = 115'],
      actionPlan: [],
      evaluationHighlights: { strengths: ['12 × 15 = 181'], improvements: [] },
    });
    const { summary: cleaned } = stripArithmeticMismatchItems(summary);
    expect(cleaned.keyTakeaways).toEqual([]);
    expect(cleaned.evaluationHighlights.strengths).toEqual([]);
    expect(validateSessionWrapupParsedOutput({ summary: cleaned, evaluation: {
      sessionKtl: 5, sessionLss: 5, sessionLf: 5, confidence: 0.8, reasoning: 'ok',
    } }).valid).toBe(true);
  });
});

describe('SessionWrapupAgent.generate 接线（模型 summary 剥离 + 遥测）', () => {
  beforeEach(() => {
    mockCallPrompt.mockReset();
    mockRecordDegradation.mockClear();
  });

  it('模型要点带错算式 → 剥离该要点（其余保留）+ MODEL_ARITHMETIC_MISMATCH 遥测', async () => {
    mockCallPrompt.mockResolvedValue({
      output: {
        summary: buildSummary({
          keyTakeaways: ['完成本节学习回顾', '回乘演示：728 ÷ 26 = 130'],
        }),
        evaluation: { sessionKtl: 5, sessionLss: 5, sessionLf: 5, confidence: 0.8, reasoning: '证据充分' },
      },
      runtimeEnvelope: null,
    });
    const result = await sessionWrapupAgent.generate(buildInput());
    expect(result.summarySource).toBe('model');
    expect(result.summary.keyTakeaways).toEqual(['完成本节学习回顾']);
    expect(mockRecordDegradation).toHaveBeenCalledWith(expect.objectContaining({
      source: 'ai-teaching/session-wrapup',
      faultCategory: 'MODEL_ARITHMETIC_MISMATCH',
      mitigationApplied: 'strip-mismatched-items',
    }));
  });

  it('要点全部干净 → summary 原样、零遥测', async () => {
    const summary = buildSummary();
    mockCallPrompt.mockResolvedValue({
      output: {
        summary,
        evaluation: { sessionKtl: 5, sessionLss: 5, sessionLf: 5, confidence: 0.8, reasoning: '证据充分' },
      },
      runtimeEnvelope: null,
    });
    const result = await sessionWrapupAgent.generate(buildInput());
    expect(result.summary.keyTakeaways).toEqual(summary.keyTakeaways);
    expect(mockRecordDegradation).not.toHaveBeenCalled();
  });

  it('与保持率剥离可叠加：错式要点与无数据保持率话术同时被清（P1-11 逻辑不受影响）', async () => {
    mockCallPrompt.mockResolvedValue({
      output: {
        summary: buildSummary({
          keyTakeaways: ['本节完成度高', '12 × 15 = 181 所以掌握扎实'],
          metricInterpretation: {
            session: '本节投入不错。',
            longTerm: '学生长期记忆保持率良好（85%）。',
          },
        }),
        evaluation: { sessionKtl: 5, sessionLss: 5, sessionLf: 5, confidence: 0.8, reasoning: '证据充分' },
      },
      runtimeEnvelope: null,
    });
    // 输入不带 reviewHints → 保持率剥离生效
    const input = buildInput();
    delete input.knowledgeContext;
    const result = await sessionWrapupAgent.generate(input);
    expect(result.summary.keyTakeaways).toEqual(['本节完成度高']);
    expect(result.summary.metricInterpretation.longTerm).not.toContain('85%');
    expect(result.summary.metricInterpretation.longTerm).not.toContain('保持率');
  });
});
