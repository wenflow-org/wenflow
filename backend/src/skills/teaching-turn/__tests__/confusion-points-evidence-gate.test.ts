/* eslint-disable @typescript-eslint/no-explicit-any -- 探针/测试：LLM I/O 与 JSON 载荷形状内在动态 */
/**
 * 卡点 chip 只认有证据的误解（2026-11-12 收口）。
 *
 * 实测事故（跑步咨询会话）：模型把**系统板书截断**脑补成「误以为板书只有五轮、
 * 不清楚任务要观察什么」直接写进 confusionPoints 并上屏——而学生看到的确实只有
 * 5 帧，归因与事实相反。旧归一化对 LLM 直接输出的 confusionPoints **零核对**，
 * 上屏闸门（confusionEvidenced，硬通道）与 chip 内容（软通道）不同源。
 *
 * 契约：confusionPoints 一律从**逐字核对通过**的 misconceptions 派生
 * （canonicalLabel 优先，其次 hypothesis）；evidence 定位不到学生原话的误解
 * 不产生卡点——宁缺勿编。
 */
const mockCallPrompt = jest.fn();

jest.mock('../../../composers/prompt-composer', () => ({ callPrompt: mockCallPrompt }));

import { teachingTurnAgentHandler, type TeachingTurnInput } from '../index';

const LEARNER_UTTERANCE = '我以为今天能跑多远只跟当天的状态有关，跟前面练的量没关系';

const input: TeachingTurnInput = {
  messages: [{ role: 'user', content: LEARNER_UTTERANCE }],
  learner: {} as TeachingTurnInput['learner'],
  scenario: { subject: '跑步', topic: '备赛训练', taskTitle: '归因训练量', taskDescription: '把成绩归因到可训练的量上', taskType: 'practice' },
  knowledge: { points: [] },
};

const basePayload = {
  reply: '我们一个一个变量拆：训练量、睡眠、当天状态，各自怎么影响长距离表现？',
  analysis: {
    cognitiveLevel: 'analyze',
    levelScore: 3,
    understanding: 0.45,
    confusionPoints: ['误以为板书只有五轮', '不清楚任务要观察什么'],
    engagement: 0.8,
    emotionalState: 'neutral',
    loadIndex: 0.4,
    loadBasis: 'semantic',
  },
  knowledge: { currentPoint: '训练量', points: [{ name: '训练量', status: 'learning', progress: 40 }] },
  pedagogy: { strategies: ['explain'] },
  control: { isCompletionCandidate: false, shouldTriggerPeer: false },
};

async function runWithAnalysis(analysis: any): Promise<any> {
  mockCallPrompt.mockReset();
  mockCallPrompt.mockImplementation(async (spec: any) => ({
    success: true,
    output: spec.normalizeOutput({ ...basePayload, analysis: { ...basePayload.analysis, ...analysis } }, input),
    runtimeEnvelope: null,
    debug: {},
  }));
  const output = await teachingTurnAgentHandler(input);
  return (output.internal?.ext as any)?.teaching;
}

describe('confusionPoints 只从有证据的误解派生', () => {
  it('模型编造的 confusionPoints（零核对直通）被丢弃，改为派生自有证据的误解', async () => {
    const teaching = await runWithAnalysis({
      misconceptions: [
        {
          conceptKey: '训练量',
          hypothesis: '把单次状态当成了唯一决定因素',
          canonicalLabel: '忽略累积训练量的作用',
          confidence: 75,
          evidence: '跟前面练的量没关系', // 逐字来自学生原话
          status: 'suspected',
        },
      ],
    });
    const points: string[] = teaching?.analysis?.confusionPoints ?? [];
    expect(points).toEqual(['忽略累积训练量的作用']);
    expect(points.join('')).not.toContain('板书只有五轮');
    // 与误解台账同源：有证据的误解保留
    expect(teaching.analysis.misconceptions).toHaveLength(1);
  });

  it('evidence 逐字核对不过的误解 → 不产生卡点（宁缺勿编）', async () => {
    const teaching = await runWithAnalysis({
      misconceptions: [
        {
          conceptKey: '板书',
          hypothesis: '以为板书有八轮',
          canonicalLabel: null,
          confidence: 50,
          evidence: '数了三遍都只有八帧', // 学生原话里没有
          status: 'suspected',
        },
      ],
    });
    expect(teaching?.analysis?.confusionPoints ?? []).toEqual([]);
    expect(teaching?.analysis?.misconceptions ?? []).toHaveLength(0);
  });

  it('canonicalLabel 缺失时回退 hypothesis', async () => {
    const teaching = await runWithAnalysis({
      misconceptions: [
        {
          conceptKey: '训练量',
          hypothesis: '把单次状态当成了唯一决定因素',
          canonicalLabel: null,
          confidence: 75,
          evidence: '只跟当天的状态有关',
          status: 'suspected',
        },
      ],
    });
    expect(teaching?.analysis?.confusionPoints).toEqual(['把单次状态当成了唯一决定因素']);
  });
});
