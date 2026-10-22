/* eslint-disable @typescript-eslint/no-explicit-any -- 探针/测试：LLM I/O 与 JSON 载荷形状内在动态（对齐 kc-id-passthrough 先例） */
/**
 * ktEstimate.conceptMastery[].evidence 模型自述护栏（2026-10-22，T8 边界集 T8B-11）。
 *
 * 实测缺陷：模型把自己的估计过程写进 evidence（「本轮尚未作答，依据历史稳定掌握记录
 * 保守估计」——通篇无学生言行），随 ktEvidence 落库后成为检查器的假凭证。
 * 契约：黑名单命中 → evidence 丢弃（mastery 保留，字段缺失=落库 null）；
 * 转述型学生证据（非逐字）必须保留——这是与误解台账 isVerbatimEvidence 的刻意差异。
 */
const mockCallPrompt = jest.fn();

jest.mock('../../../composers/prompt-composer', () => ({ callPrompt: mockCallPrompt }));

import { teachingTurnAgentHandler, type TeachingTurnInput } from '../index';

const input: TeachingTurnInput = {
  messages: [{ role: 'user', content: '光合作用分几步？' }],
  learner: {} as TeachingTurnInput['learner'],
  scenario: {
    subject: '生物',
    topic: '光合作用',
    taskTitle: '拆解光反应',
    taskDescription: '说出光反应的产物',
    taskType: 'practice',
  },
  knowledge: { points: [] },
};

const basePayload = {
  reply: '我们先把光反应这一步拆开看。',
  analysis: {
    cognitiveLevel: 'understand',
    levelScore: 2,
    understanding: 0.6,
    confusionPoints: [],
    engagement: 0.8,
    emotionalState: 'neutral',
    loadIndex: 0.4,
    loadBasis: 'semantic',
  },
  knowledge: { currentPoint: '光反应', points: [] as any[] },
  pedagogy: { strategies: ['explain'] },
  control: { isCompletionCandidate: false, shouldTriggerPeer: false },
};

async function runWithKtEstimate(ktEstimate: any): Promise<any> {
  mockCallPrompt.mockReset();
  mockCallPrompt.mockImplementation(async (spec: any) => ({
    success: true,
    output: spec.normalizeOutput(
      { ...basePayload, analysis: { ...basePayload.analysis, ktEstimate } },
      input,
    ),
    runtimeEnvelope: null,
    debug: {},
  }));
  const output = await teachingTurnAgentHandler(input);
  return (output.internal?.ext as any)?.teaching?.analysis?.ktEstimate;
}

describe('ktEstimate evidence 模型自述护栏（T8B-11）', () => {
  it('模型自述证据（T8B-11 原文）被丢弃，mastery 保留', async () => {
    const kt = await runWithKtEstimate({
      conceptMastery: [
        { conceptKey: '光反应', mastery: 0.6, evidence: '本轮尚未作答，依据历史稳定掌握记录保守估计' },
      ],
    });
    expect(kt.conceptMastery[0].mastery).toBe(0.6);
    expect(kt.conceptMastery[0]).not.toHaveProperty('evidence');
  });

  it('转述型学生证据（非逐字）保留——掌握度窗口允许白描转述', async () => {
    const kt = await runWithKtEstimate({
      conceptMastery: [
        { conceptKey: '光反应', mastery: 0.7, evidence: '学生独立说出了光反应需要水和光' },
      ],
    });
    expect(kt.conceptMastery[0].evidence).toBe('学生独立说出了光反应需要水和光');
  });

  it('原话摘录证据保留', async () => {
    const kt = await runWithKtEstimate({
      conceptMastery: [
        { conceptKey: '光反应', mastery: 0.8, evidence: '光合作用分几步？' },
      ],
    });
    expect(kt.conceptMastery[0].evidence).toBe('光合作用分几步？');
  });

  it('缺失/空白证据不带该字段（列语义：null = 模型未报）', async () => {
    const kt = await runWithKtEstimate({
      conceptMastery: [
        { conceptKey: '光反应', mastery: 0.5 },
        { conceptKey: '暗反应', mastery: 0.5, evidence: '   ' },
      ],
    });
    expect(kt.conceptMastery[0]).not.toHaveProperty('evidence');
    expect(kt.conceptMastery[1]).not.toHaveProperty('evidence');
  });
});
