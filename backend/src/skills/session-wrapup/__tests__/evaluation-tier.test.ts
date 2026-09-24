const mockCallPrompt = jest.fn();

jest.mock('../../../composers/prompt-composer', () => ({
  callPrompt: mockCallPrompt,
}));
jest.mock('../../../gateway/api-gateway', () => ({
  getAPIGateway: () => ({}),
}));

import {
  isZeroEvidenceSessionInput,
  sessionWrapupAgent,
  validateSessionWrapupParsedOutput,
  type SessionWrapupInput,
} from '../index';

const VALID_SUMMARY = {
  topicSummary: '本节课围绕"闭包"进行了学习。',
  knowledgeSummary: '本节共涉及2个知识点。',
  practiceAdvice: '复盘本节课核心概念。',
  learningEvaluation: '建议根据当前掌握情况继续推进。',
  knowledgeItems: [{ name: '闭包', status: 'learning', progress: 50, evidence: '继续练习' }],
  keyTakeaways: ['完成本节学习回顾'],
  actionPlan: ['继续完成下一步练习'],
  evaluationHighlights: { strengths: ['有知识点推进证据'], improvements: ['继续巩固'] },
  metricInterpretation: { session: '本节课总结已生成。', longTerm: '长期指标需后续观察。' },
  summaryVersion: 'v2',
};

const NORMAL_INPUT = {
  messages: [
    { role: 'user', content: '闭包是什么？' },
    { role: 'assistant', content: '先看词法作用域。' },
    { role: 'user', content: '懂了。' },
  ],
  knowledgePoints: [{ name: '闭包', status: 'learning', progress: 50 }],
  sessionInfo: {
    subject: 'JavaScript',
    topic: '闭包',
    durationMinutes: 25,
    userMessageCount: 2,
    assistantMessageCount: 1,
    taskType: 'practice',
  },
  sessionEvidence: { turnCount: 2, avgUnderstanding: 0.7 },
};

const asInput = (value: object): SessionWrapupInput => value as unknown as SessionWrapupInput;

function mockModelOutput(output: unknown) {
  mockCallPrompt.mockImplementation(() => Promise.resolve({
    success: true,
    output,
    debug: { attempts: [], extractedJson: null, rawModelOutput: '' },
  }));
}

const TIER_EVALUATION = {
  sessionKtl: { tier: 'high', evidence: '能独立复述并纠正先前的误解' },
  sessionLss: { tier: 'low', evidence: '全程无明显阻塞' },
  sessionLf: { tier: 'mid', evidence: '后段有一次停顿' },
  confidence: 0.8,
  reasoning: '后半段能稳定应用，整体负担不大',
};

describe('session-wrapup evaluation：档位输出（single-source 映射）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('档位对象形态通过 raw 契约校验', () => {
    expect(validateSessionWrapupParsedOutput({ summary: VALID_SUMMARY, evaluation: TIER_EVALUATION }))
      .toEqual({ valid: true });
  });

  it('档位字符串与 legacy 数值形态也兼容', () => {
    expect(validateSessionWrapupParsedOutput({
      summary: VALID_SUMMARY,
      evaluation: { sessionKtl: 'high', sessionLss: 'low', sessionLf: 'mid', confidence: 0.5, reasoning: 'x' },
    })).toEqual({ valid: true });

    expect(validateSessionWrapupParsedOutput({
      summary: VALID_SUMMARY,
      evaluation: { sessionKtl: 7, sessionLss: 3, sessionLf: 5, confidence: 0.5, reasoning: 'x' },
    })).toEqual({ valid: true });
  });

  it('非法档位被拒（不静默兜底）', () => {
    expect(validateSessionWrapupParsedOutput({
      summary: VALID_SUMMARY,
      evaluation: { sessionKtl: { tier: 'huge' }, sessionLss: 'low', sessionLf: 'mid', confidence: 0.5, reasoning: 'x' },
    })).toEqual({ valid: false, failureReason: 'SESSION_WRAPUP_EVALUATION_INVALID' });
  });

  it('generate：档位→0-10 由唯一映射转换，并保留档位与证据', async () => {
    mockModelOutput({ summary: VALID_SUMMARY, evaluation: TIER_EVALUATION });
    const result = await sessionWrapupAgent.generate(asInput(NORMAL_INPUT));

    expect(result.evaluationSource).toBe('model');
    expect(result.evaluation).toMatchObject({
      sessionKtl: 9, // high 区间中点
      sessionLss: 2.5, // low 区间中点
      sessionLf: 6, // mid 区间中点
      confidence: 0.8,
    });
    expect(result.evaluation?.metricTiers).toEqual({ sessionKtl: 'high', sessionLss: 'low', sessionLf: 'mid' });
    expect(result.evaluation?.metricEvidence?.sessionKtl).toContain('独立复述');
  });

  it('generate：legacy 数值输出直接透传（向后兼容）', async () => {
    mockModelOutput({
      summary: VALID_SUMMARY,
      evaluation: { sessionKtl: 7, sessionLss: 3, sessionLf: 5, confidence: 0.6, reasoning: 'legacy' },
    });
    const result = await sessionWrapupAgent.generate(asInput(NORMAL_INPUT));

    expect(result.evaluation).toMatchObject({ sessionKtl: 7, sessionLss: 3, sessionLf: 5, confidence: 0.6 });
    expect(result.evaluation?.metricTiers).toBeUndefined();
  });
});

describe('session-wrapup 零证据兜底：确定式（不靠 LLM 依从）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('isZeroEvidenceSessionInput 判定：消息<2 / 知识看板空 / 回合<1', () => {
    expect(isZeroEvidenceSessionInput(asInput({ ...NORMAL_INPUT, messages: [] }))).toBe(true);
    expect(isZeroEvidenceSessionInput(asInput({ ...NORMAL_INPUT, knowledgePoints: [] }))).toBe(true);
    expect(isZeroEvidenceSessionInput(asInput({ ...NORMAL_INPUT, sessionEvidence: { turnCount: 0 } }))).toBe(true);
    expect(isZeroEvidenceSessionInput(asInput({ ...NORMAL_INPUT, messages: [{ role: 'user', content: 'hi' }] }))).toBe(true);
    expect(isZeroEvidenceSessionInput(asInput(NORMAL_INPUT))).toBe(false);
  });

  it('零证据时即使 LLM 自由发挥成高/低/中，也覆盖为固定 3/3/3 + confidence 0.1', async () => {
    mockModelOutput({
      summary: VALID_SUMMARY,
      evaluation: {
        sessionKtl: { tier: 'high' },
        sessionLss: { tier: 'low' },
        sessionLf: { tier: 'mid' },
        confidence: 0.9,
        reasoning: '模型随便写的',
      },
    });
    const result = await sessionWrapupAgent.generate(asInput({ ...NORMAL_INPUT, knowledgePoints: [] }));

    expect(result.evaluation).toEqual({
      sessionLss: 3,
      sessionKtl: 3,
      sessionLf: 3,
      confidence: 0.1,
      reasoning: '无对话证据',
    });
    expect(result.evaluationSource).toBe('model');
  });

  it('零证据但 LLM 未产出 evaluation ⇒ 仍是 unavailable（不改变失败语义）', async () => {
    mockCallPrompt.mockImplementation(() => Promise.resolve({
      success: false,
      error: { code: 'SESSION_WRAPUP_FAILED', message: 'boom' },
      debug: { attempts: [], extractedJson: null, rawModelOutput: '' },
    }));
    const result = await sessionWrapupAgent.generate(asInput({ ...NORMAL_INPUT, knowledgePoints: [] }));

    expect(result.evaluation).toBeNull();
    expect(result.evaluationSource).toBe('unavailable');
  });
});
