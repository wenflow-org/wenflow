/* eslint-disable @typescript-eslint/no-explicit-any -- 探针/测试：LLM I/O 与 JSON 载荷形状内在动态（对齐 verify-from-zero 先例） */
/**
 * teaching-turn 输出归一化：kcId 透传（#94 写入侧稳定键，2026-10-19）。
 *
 * 契约（prompts/core/teaching-turn.yaml）：kcId 是**可选**稳定键，模型从 scenario.taskKcs 原样回填，
 * 与 knowledge.points / analysis.ktEstimate.conceptMastery 两处同概念保持一致。
 * 归一化只做**透传**（去空白/限长/丢弃非法值），绝不按名字推断补写——模型没给就没有，
 * 写入侧据此回落自由文本名（宁缺勿错：编一个 kcId 会把两个概念并成一个身份）。
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
    taskKcs: [
      { kcId: 'kc-1a', name: '光反应' },
      { kcId: 'kc-2b', name: '暗反应' },
    ],
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

async function runWithKnowledge(raw: any, rawAnalysis?: any): Promise<any> {
  mockCallPrompt.mockReset();
  mockCallPrompt.mockImplementation(async (spec: any) => ({
    success: true,
    output: spec.normalizeOutput({
      ...basePayload,
      knowledge: raw,
      analysis: { ...basePayload.analysis, ...(rawAnalysis || {}) },
    }, input),
    runtimeEnvelope: null,
    debug: {},
  }));
  const output = await teachingTurnAgentHandler(input);
  return (output.internal?.ext as any)?.teaching;
}

describe('teaching-turn 归一化 · kcId 透传（#94 写入侧稳定键）', () => {
  beforeEach(() => mockCallPrompt.mockReset());

  it('knowledge.points 的 kcId 原样保留；未给的项不带该字段（回落文本名）', async () => {
    const teaching = await runWithKnowledge({
      currentPoint: '光反应',
      points: [
        { name: '光反应', kcId: 'kc-1a', status: 'learning', progress: 60 },
        { name: '暗反应', status: 'pending', progress: 0 },
      ],
    });

    const points = teaching.knowledge.points;
    expect(points[0]).toEqual(expect.objectContaining({ name: '光反应', kcId: 'kc-1a' }));
    // 没给 kcId 的点不得被推断补写（任务里有同名 KC 也不认——只认模型回填）
    expect(points[1]).not.toHaveProperty('kcId');
  });

  it('ktEstimate.conceptMastery 的 kcId 原样保留（与 points 同一稳定键），未给则不带', async () => {
    const teaching = await runWithKnowledge(
      { currentPoint: '光反应', points: [{ name: '光反应', kcId: ' kc-1a ', status: 'learning', progress: 60 }] },
      {
        ktEstimate: {
          conceptMastery: [
            { conceptKey: '光反应', kcId: ' kc-1a ', mastery: 0.4, evidence: '学生说"要光"' },
            { conceptKey: '暗反应', mastery: 0.5 },
          ],
          currentTaskDifficulty: 0.6,
          recommendation: 'scaffold',
        },
      },
    );

    expect(teaching.knowledge.points[0].kcId).toBe('kc-1a');
    const kt = teaching.analysis.ktEstimate.conceptMastery;
    expect(kt[0].kcId).toBe('kc-1a');
    expect(kt[1]).not.toHaveProperty('kcId');
    expect(teaching.analysis.ktEstimate.recommendation).toBe('scaffold');
  });

  it('非法 kcId（非字符串/空白/超长）被丢弃或截断，不污染稳定键', async () => {
    const teaching = await runWithKnowledge({
      currentPoint: '光反应',
      points: [
        { name: '光反应', kcId: 123, status: 'learning', progress: 60 },
        { name: '暗反应', kcId: '   ', status: 'learning', progress: 20 },
        { name: '卡尔文循环', kcId: 'x'.repeat(300), status: 'learning', progress: 10 },
      ],
    });

    const points = teaching.knowledge.points;
    expect(points[0]).not.toHaveProperty('kcId');
    expect(points[1]).not.toHaveProperty('kcId');
    expect(points[2].kcId).toHaveLength(120);
  });
});
