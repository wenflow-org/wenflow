/**
 * 检查点代码裁决注入本轮输入（全量测试报告 #14）：有裁决 → controls.checkpointVerdict 显式进载荷；
 * 无裁决（无答案键/非提交回合）→ 字段缺失（提示词行为不变）。
 */
jest.mock('../../field-dispatcher', () => ({
  assembleTeachingTurnChannels: jest.fn(async () => ({ channels: {}, skipped: [] })),
}));
jest.mock('../TeachingContextCompressionService', () => ({
  teachingContextCompressionService: { compress: () => ({ messages: [] }) },
}));
jest.mock('../teaching-classroom-flow', () => ({
  buildLearnerStateContext: () => ({}),
  buildTeachingControlContext: () => ({}),
  buildPathBackgroundContext: () => null,
}));

import { buildTeachingTurnInput } from '../teaching-turn-shared';

const SESSION = {
  id: 'sess-1',
  userId: 'user-1',
  mode: 'tutor',
  messages: [],
  knowledgeState: [],
  teachingState: {},
} as never;

const CONTEXT = {
  subject: '数学',
  topic: '方程',
  taskTitle: '解一元二次方程',
  taskDescription: '会用配方法',
  taskType: 'practice',
  taskProfile: { knowledgeType: 'procedural', cognitiveLevel: 'apply' },
  currentTaskContext: { description: '练配方法', acceptanceCriteria: '能独立配方' },
  cognitiveFrame: null,
  pathProgress: {
    pathTitle: '二次方程',
    pathSummary: null,
    currentMilestoneTitle: 'M1',
    currentStageNumber: 1,
    currentTaskOrder: 1,
    totalTasksInMilestone: 3,
  },
} as never;

describe('buildTeachingTurnInput：checkpointVerdict 注入（报告 #14）', () => {
  it('提供裁决 → controls.checkpointVerdict 显式进载荷（含 detail）', async () => {
    const input = await buildTeachingTurnInput(SESSION, CONTEXT, {
      checkpointVerdict: { passed: false, detail: '缺少要点：再做/手动' },
    });

    expect(input.controls?.checkpointVerdict).toEqual({
      passed: false,
      detail: '缺少要点：再做/手动',
    });
  });

  it('通过裁决 → passed=true 原样进载荷', async () => {
    const input = await buildTeachingTurnInput(SESSION, CONTEXT, {
      checkpointVerdict: { passed: true, detail: '作答包含全部要点' },
    });

    expect(input.controls?.checkpointVerdict).toEqual({ passed: true, detail: '作答包含全部要点' });
  });

  it('无裁决（缺省/null）→ 字段缺失（既有回合行为不变）', async () => {
    const a = await buildTeachingTurnInput(SESSION, CONTEXT, {});
    expect(a.controls).not.toHaveProperty('checkpointVerdict');

    const b = await buildTeachingTurnInput(SESSION, CONTEXT, { checkpointVerdict: null });
    expect(b.controls).not.toHaveProperty('checkpointVerdict');
  });
});

/**
 * P1-13（LP-1）：learning-predictor 自由描述原文（toneDetail/depthDetail）必须透传到
 * teaching-turn 输入，不能在下发前丢失——旧实现只透传枚举值，模型说的「反复卡壳」到达
 * 开场策略时已被抹成 'smooth'。
 */
describe('buildTeachingTurnInput：learnerPrediction 自由描述透传（P1-13）', () => {
  const withPrediction = (learnerPrediction: unknown) =>
    Object.assign({}, CONTEXT as unknown as Record<string, unknown>, { learnerPrediction }) as never;

  const CONTEXT_WITH_PREDICTION = withPrediction({
    stallRisk: 0.65,
    predictedTone: 'struggle',
    toneDetail: '预计在材料/工具栏位区分环节反复卡壳，其余部分较顺畅',
    suggestedDepth: 'deep',
    depthDetail: '需要深挖原理并配对比练习',
    focusConcepts: ['材料区分'],
    rationale: '材料区分环节历史混淆',
    reliability: { total: 12, stallHitRate: 0.7 },
  });

  it('toneDetail/depthDetail 随 learnerPrediction 进载荷（原文不丢）', async () => {
    const input = await buildTeachingTurnInput(SESSION, CONTEXT_WITH_PREDICTION, {});
    expect(input.scenario.learnerPrediction).toMatchObject({
      stallRisk: 0.65,
      predictedTone: 'struggle',
      toneDetail: '预计在材料/工具栏位区分环节反复卡壳，其余部分较顺畅',
      suggestedDepth: 'deep',
      depthDetail: '需要深挖原理并配对比练习',
      reliability: { total: 12, stallHitRate: 0.7 },
    });
  });

  it('无 detail 时省略该键（不注入空键，旧行为不变）', async () => {
    const contextNoDetail = withPrediction({
      stallRisk: 0.4,
      predictedTone: 'smooth',
      suggestedDepth: 'standard',
      focusConcepts: [],
      rationale: '证据不足',
      reliability: null,
    });
    const input = await buildTeachingTurnInput(SESSION, contextNoDetail, {});
    expect(input.scenario.learnerPrediction).not.toHaveProperty('toneDetail');
    expect(input.scenario.learnerPrediction).not.toHaveProperty('depthDetail');
  });

  it('无 learnerPrediction 时字段缺失（不注入）', async () => {
    const input = await buildTeachingTurnInput(SESSION, CONTEXT, {});
    expect(input.scenario.learnerPrediction).toBeUndefined();
  });
});
