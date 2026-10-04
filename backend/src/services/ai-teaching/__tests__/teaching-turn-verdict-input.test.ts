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
