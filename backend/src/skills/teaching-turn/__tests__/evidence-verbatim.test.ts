/**
 * 误解台账 `evidence` 的**逐字核对**（2026-09-23 采纳外部评审建议）。
 *
 * 契约：`evidence` 必须是**学生本轮原话的逐字片段**（空白归一后包含即可）；
 * 定位不到 → **整条丢弃**（宁缺勿编：没有可定位证据就不该断言学生有这个误解）。
 * 对照本仓既有做法：`material-refs.ts#isQuoteVerbatim`。
 */
const mockCallPrompt = jest.fn();

jest.mock('../../../composers/prompt-composer', () => ({ callPrompt: mockCallPrompt }));

import { teachingTurnAgentHandler, isVerbatimEvidence, type TeachingTurnInput } from '../index';

const STUDENT = '我觉得「绝对值」就是把负号去掉，所以 |-3| 和 -3 是一回事';

const input: TeachingTurnInput = {
  messages: [{ role: 'user', content: STUDENT }],
  learner: {} as TeachingTurnInput['learner'],
  scenario: { subject: '数学', topic: '绝对值', taskTitle: '理解绝对值', taskDescription: '解释绝对值', taskType: 'practice' },
  knowledge: { points: [] },
};

function basePayload(evidence: string) {
  return {
    reply: '先别急着下结论，我们把 -3 放到数轴上看看。',
    analysis: {
      cognitiveLevel: 'understand',
      levelScore: 2,
      understanding: 0.4,
      confusionPoints: [],
      engagement: 0.6,
      emotionalState: 'neutral',
      loadIndex: 0.4,
      loadBasis: 'semantic',
      misconceptions: [{
        conceptKey: '绝对值与相反数混淆',
        hypothesis: '学生误以为绝对值等于去负号，因此 |-3| 与 -3 相同',
        confidence: 75,
        evidence,
        status: 'suspected',
      }],
    },
    knowledge: { currentPoint: '绝对值', points: [{ name: '绝对值', status: 'learning', progress: 40 }] },
    pedagogy: { strategies: ['explain'] },
    control: { isCompletionCandidate: false, shouldTriggerPeer: false },
  };
}

async function runWith(evidence: string): Promise<any> {
  mockCallPrompt.mockReset();
  mockCallPrompt.mockImplementation(async (spec: any) => ({
    success: true,
    output: spec.normalizeOutput(basePayload(evidence), input),
    runtimeEnvelope: null,
    debug: {},
  }));
  const output = await teachingTurnAgentHandler(input);
  return (output.internal?.ext as any)?.teaching;
}

describe('misconceptions.evidence 逐字核对', () => {
  beforeEach(() => mockCallPrompt.mockReset());

  it('逐字引用学生原话 → 保留', async () => {
    const teaching = await runWith('|-3| 和 -3 是一回事');
    expect(teaching.analysis.misconceptions).toHaveLength(1);
    expect(teaching.analysis.misconceptions[0].evidence).toBe('|-3| 和 -3 是一回事');
  });

  it('模型"修饰过"的引文（不在原话里）→ 整条丢弃', async () => {
    const teaching = await runWith('学生认为绝对值就是把负号去掉');
    expect(teaching.analysis.misconceptions ?? []).toHaveLength(0);
  });

  it('空白/换行差异不影响判定（空白归一后比对）', async () => {
    const teaching = await runWith('我觉得「绝对值」就是把负号去掉');
    expect(teaching.analysis.misconceptions).toHaveLength(1);
  });

  it('evidence 为空 → 丢弃', async () => {
    const teaching = await runWith('');
    expect(teaching.analysis.misconceptions ?? []).toHaveLength(0);
  });
});

describe('isVerbatimEvidence（纯函数）', () => {
  it('逐字片段为真；修饰/改写为假', () => {
    expect(isVerbatimEvidence('|-3| 和 -3 是一回事', STUDENT)).toBe(true);
    expect(isVerbatimEvidence('学生认为绝对值就是去负号', STUDENT)).toBe(false);
    expect(isVerbatimEvidence('', STUDENT)).toBe(false);
    expect(isVerbatimEvidence('原话', '')).toBe(false);
    expect(isVerbatimEvidence('a', STUDENT)).toBe(false);
  });
});
