const mockCallPrompt = jest.fn();

jest.mock('../../../composers/prompt-composer', () => ({
  callPrompt: mockCallPrompt,
}));

import {
  judgeSemanticFreeze,
  decideSemanticGate,
  type SemanticFreezeJudgement,
} from '../semantic-freeze-judge';

const JUDGE_INPUT = {
  skillId: 'goal-conversation',
  coreText: 'skillId: goal-conversation\nrules:\n  - 规则一',
  candidateText: '## 身份\n…\n## 执行规则\n1. 规则一',
};

function judgeWith(overrides: Partial<SemanticFreezeJudgement> = {}): SemanticFreezeJudgement {
  return {
    verdict: 'equivalent',
    findings: [],
    rationale: '',
    durationMs: 1,
    degraded: false,
    ...overrides,
  };
}

describe('semantic-freeze-judge：judgeSemanticFreeze', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('LLM 判 equivalent 时透传 verdict 与 findings', async () => {
    mockCallPrompt.mockResolvedValue({
      success: true,
      output: {
        verdict: 'equivalent',
        findings: [{ aspect: 'rules', issue: '措辞差异但语义等价', severity: 'minor' }],
        rationale: '语义等价',
      },
      quality: 'model',
    });

    const result = await judgeSemanticFreeze(JUDGE_INPUT);
    expect(result.verdict).toBe('equivalent');
    expect(result.findings).toHaveLength(1);
    expect(result.degraded).toBe(false);
    expect(mockCallPrompt).toHaveBeenCalledTimes(1);
    const [spec] = mockCallPrompt.mock.calls[0];
    expect(spec.agentId).toBe('skill:semantic-freeze-judge');
  });

  it('LLM 判 divergent 时按原样返回（由决策层阻断）', async () => {
    mockCallPrompt.mockResolvedValue({
      success: true,
      output: {
        verdict: 'divergent',
        findings: [{ aspect: 'fields', issue: '字段 reply 功能描述含义改变', severity: 'critical' }],
        rationale: '字段语义改变',
      },
      quality: 'model',
    });

    const result = await judgeSemanticFreeze(JUDGE_INPUT);
    expect(result.verdict).toBe('divergent');
    expect(result.degraded).toBe(false);
  });

  it('LLM 调用抛错 → 降级 uncertain，绝不自动放行', async () => {
    mockCallPrompt.mockRejectedValue(new Error('gateway down'));

    const result = await judgeSemanticFreeze(JUDGE_INPUT);
    expect(result.verdict).toBe('uncertain');
    expect(result.degraded).toBe(true);
    expect(result.findings[0].issue).toContain('gateway down');
  });

  it('调用未产出有效结果 → 降级 uncertain', async () => {
    mockCallPrompt.mockResolvedValue({ success: false });
    const result = await judgeSemanticFreeze(JUDGE_INPUT);
    expect(result.verdict).toBe('uncertain');
    expect(result.degraded).toBe(true);
  });
});

describe('semantic-freeze-judge：decideSemanticGate', () => {
  it('equivalent → pass', () => {
    expect(decideSemanticGate(judgeWith({ verdict: 'equivalent' }))).toBe('pass');
  });

  it('divergent → block-divergent（confirmUncertain 也不可放行）', () => {
    expect(decideSemanticGate(judgeWith({ verdict: 'divergent' }))).toBe('block-divergent');
    expect(decideSemanticGate(judgeWith({ verdict: 'divergent' }), { confirmUncertain: true })).toBe('block-divergent');
  });

  it('uncertain → needs-confirm；confirmUncertain: true → pass', () => {
    expect(decideSemanticGate(judgeWith({ verdict: 'uncertain', degraded: true }))).toBe('needs-confirm');
    expect(decideSemanticGate(judgeWith({ verdict: 'uncertain', degraded: true }), { confirmUncertain: true })).toBe('pass');
  });
});
