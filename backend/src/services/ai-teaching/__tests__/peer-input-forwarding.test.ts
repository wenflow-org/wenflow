/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P1-14（实录同型样本）与 P2-11 的**引擎链路**验收：
 *
 * 样本来源：prompt_call_logs
 * - 伴学行 createdAt=1791288425961（strategy=counterexample，输出即该题解题钥匙）
 * - 同轮 teaching-turn（1791288423304）control.shouldTriggerPeer=false、understanding=0.85
 *   ⇒ 只剩 help-keyword 路径：学生消息「你看我会**不会**又把三行挤成一行」的子串「不会」命中。
 *
 * 本文件刻意**不 mock PeerTriggerService**（走真实触发判定），只 mock 外部协作者
 * （LLM/上下文/仓储/观测），断言：
 *  ① 实录同型样本：老师布置独立作业 + 学生含「不会」子串 → 引擎不调用伴学（不被误触发）；
 *  ② model-control（老师显式要求）时伴学仍可触发，但策略降级为 encourage 且 peerHistory 已转发。
 */
const mockClaimOperation = jest.fn();
const mockCommitTurnState = jest.fn();
const mockReleaseOperation = jest.fn();
const mockExecuteSkill = jest.fn();
const mockPeerDefinition = { id: 'skill:peer-reinforcement', __kind: 'peer' };
const mockTurnDefinition = { id: 'skill:teaching-turn', __kind: 'teaching-turn' };

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: { teacher_observations: {}, misconceptions: {}, learner_evidence: {}, teaching_sessions: {} },
}));
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../../skills', () => ({
  executeSkill: (...args: unknown[]) => mockExecuteSkill(...args),
  executeSkillWithResult: jest.fn(),
  auxSkillDefinitionMap: {},
  peerAgentDefinition: mockPeerDefinition,
}));
jest.mock('../../../skills/teaching-turn', () => ({ teachingTurnAgentDefinition: mockTurnDefinition }));
jest.mock('../TeachingContextBuilder', () => ({
  buildTeachingScenarioContext: jest.fn(async () => ({
    subject: '数学', topic: '照示范仿写基础全等证明并逐行注明依据',
    taskTitle: '全等证明', taskDescription: '仿写证明', taskType: 'practice',
    taskProfile: { knowledgeType: 'procedural', cognitiveLevel: 'apply' },
    currentTaskContext: { description: '仿写证明', acceptanceCriteria: '每行有依据标注' },
    cognitiveFrame: { targetRelation: '缺口与工具', transferGoal: null, cognitiveLevel: 'apply' },
    learnerProjection: null,
    pathProgress: { pathTitle: '几何证明', pathSummary: null, currentMilestoneTitle: '全等', currentStageNumber: 1, currentTaskOrder: 1, totalTasksInMilestone: 3 },
    taskKnowledgeSeeds: [], anchorMasteredLastSeenAt: null, learningState: null,
  })),
}));
jest.mock('../../field-dispatcher', () => ({
  assembleTeachingTurnChannels: jest.fn(async () => ({ channels: {}, skipped: [] })),
}));
jest.mock('../teaching-classroom-flow', () => {
  const actual = jest.requireActual('../teaching-classroom-flow');
  return {
    ...actual,
    buildLearnerStateContext: () => ({}),
    buildTeachingControlContext: () => ({}),
    buildPathBackgroundContext: () => null,
  };
});
jest.mock('../TeachingContextCompressionService', () => ({
  teachingContextCompressionService: { compress: () => ({ messages: [] }) },
}));
jest.mock('../teaching-visual.service', () => ({
  generateTeachingVisual: jest.fn(async () => null),
  buildVisualOpportunity: jest.fn(() => null),
  detectExerciseLeakInReply: jest.fn(() => false),
}));
jest.mock('../../learning/learning-state.service', () => ({
  learningStateService: {
    coerceMetrics: (value: unknown) => value || { lss: 0, ktl: 0, lf: 0, lsb: 0 },
    calculateRuntimeState: () => ({ lss: 0.5, ktl: 0.5, lf: 0.5, lsb: 0.5 }),
  },
}));
jest.mock('../../memory/memory-trace.service', () => ({
  memoryTraceService: { applyKtEstimate: jest.fn(async () => undefined) },
}));
jest.mock('../../learner/misconception-ledger.service', () => ({
  recordMisconceptions: jest.fn(async () => undefined),
  rerouteMisconceptionConceptKey: jest.fn(),
}));
jest.mock('../../background-task-tracker.service', () => ({
  runBackgroundTask: jest.fn(async (_name: string, fn: () => Promise<unknown>) => fn()),
}));
jest.mock('../TeachingOperationLeaseGuard', () => ({
  TeachingOperationLeaseGuard: class { start() {} stop() {} },
}));
jest.mock('../TeachingSessionRepository', () => {
  const actual = jest.requireActual('../TeachingSessionRepository');
  return {
    ...actual,
    teachingSessionRepository: {
      claimOperation: (...args: unknown[]) => mockClaimOperation(...args),
      commitTurnState: (...args: unknown[]) => mockCommitTurnState(...args),
      releaseOperation: (...args: unknown[]) => mockReleaseOperation(...args),
    },
  };
});
jest.mock('../teaching-checkpoint', () => {
  const actual = jest.requireActual('../teaching-checkpoint');
  return {
    ...actual,
    recordCheckpointResultEvidence: jest.fn(async () => undefined),
    recordCheckpointAttemptEvidence: jest.fn(async () => undefined),
    recordAnchorProbeResult: jest.fn(async () => undefined),
    resolveAnchorProbeTarget: jest.fn(async () => null),
  };
});

import { processStudentMessage } from '../teaching-turn-engine';

const PCL_STUDENT_MESSAGE =
  '老师你这么一夸我有点虚——刚才那题我是知道最后要落 SAS，才倒着把那个角塞进去的。 下一道能不能先别告诉我用哪个判定，让我自己写一遍，你看我会不会又把三行挤成一行、对应边也不交代。';

const PCL_TUTOR_REPLY =
  '你刚才那句"我知道最后要落SAS，才倒着把那个角塞进去"非常诚实，这说明你的眼睛和脑子已经能区分"缺口"和"工具"了，只是手还没跟上。\n\n'
  + '下一题我完全不给提示，你自己从头写。题目："如图，点D在BC上，且 BD=CD，AD 垂直于 BC。求证：∠B = ∠C。"\n\n'
  + '直接把你打算写的那几行发给我。';

function sessionRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sess-peer-1',
    userId: 'user-1',
    taskId: 'task-1',
    status: 'active',
    mode: 'tutor',
    topic: '照示范仿写基础全等证明并逐行注明依据',
    messages: [
      { role: 'assistant', content: '上一轮老师讲解', timestamp: new Date(Date.now() - 60_000).toISOString() },
    ],
    knowledgeState: [],
    teachingState: {
      classroomContext: { stage: { current: 'teaching' } },
      sessionArtifacts: {},
    },
    revision: 5,
    startTime: new Date(),
    ...overrides,
  };
}

function claim(session: any) {
  return { operationId: 'op-1', session, messagesBaseCount: session.messages.length };
}

function turnSkillResult(reply: string, control: Record<string, unknown> = {}) {
  return {
    success: true,
    internal: {
      ext: {
        teachingTurnOutcome: {
          artifact: {
            reply,
            analysis: { understanding: 0.85, engagement: 0.7, confusionPoints: [], cognitiveLevel: 'apply' },
            knowledge: { currentPoint: '缺口元素', points: [] },
            control,
            pedagogy: { strategies: ['feedback'] },
          },
        },
      },
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCommitTurnState.mockResolvedValue(undefined);
  mockReleaseOperation.mockResolvedValue(undefined);
});

describe('P1-14 实录同型样本：老师布置独立作业 + 学生含「不会」子串', () => {
  it('真实触发判定下引擎不调用伴学（不被误触发）', async () => {
    const session = sessionRecord();
    mockClaimOperation.mockResolvedValue(claim(session));
    // 同轮 teaching-turn 实录：shouldTriggerPeer=false、understanding=0.85
    mockExecuteSkill.mockResolvedValue(turnSkillResult(PCL_TUTOR_REPLY, { shouldTriggerPeer: false }));

    await processStudentMessage('sess-peer-1', PCL_STUDENT_MESSAGE, {
      operationClaim: claim(session) as never,
    });

    const peerCalls = mockExecuteSkill.mock.calls.filter(([definition]) => definition === mockPeerDefinition);
    expect(peerCalls).toHaveLength(0);
  });
});

describe('P2-11：引擎路径伴学历史转发 + P1-14 修复③策略降级', () => {
  it('model-control 触发时：peerInput 带 peerHistory（peer 标记消息 + 内嵌插话），策略降级为 encourage', async () => {
    const session = sessionRecord({
      messages: [
        { role: 'assistant', content: '上一轮老师讲解', timestamp: new Date(Date.now() - 120_000).toISOString(), peerMessage: '小启：先说说你的直觉' },
        { role: 'user', content: '小启我觉得是公共边', timestamp: new Date(Date.now() - 90_000).toISOString(), peer: true },
        { role: 'assistant', content: '对，公共边是缺口', timestamp: new Date(Date.now() - 60_000).toISOString(), peer: true },
      ],
    });
    mockClaimOperation.mockResolvedValue(claim(session));
    mockExecuteSkill.mockImplementation(async (definition: any) => {
      if (definition === mockPeerDefinition) {
        return { internal: { ext: { peer: { message: '你先自己写，写完咱俩对一对。', strategy: 'encourage', followUpQuestions: [] } } } };
      }
      return turnSkillResult(PCL_TUTOR_REPLY, { shouldTriggerPeer: true });
    });

    await processStudentMessage('sess-peer-1', PCL_STUDENT_MESSAGE, {
      operationClaim: claim(session) as never,
    });

    const peerCalls = mockExecuteSkill.mock.calls.filter(([definition]) => definition === mockPeerDefinition);
    expect(peerCalls).toHaveLength(1);
    const peerInput = (peerCalls[0][1] as any).input;
    // P1-14 修复③：老师本轮在布置独立作业 → 策略降级（不再 counterexample）
    expect(peerInput.strategy).toBe('encourage');
    expect(peerInput.tutorLatestReply).toContain('完全不给提示');
    // P2-11：伴学历史已转发（此前恒为空）
    expect(peerInput.peerHistory).toEqual([
      { role: 'assistant', content: '小启：先说说你的直觉' },
      { role: 'user', content: '小启我觉得是公共边' },
      { role: 'assistant', content: '对，公共边是缺口' },
    ]);
  });

  it('无伴学历史时 peerHistory 为空数组（规则 11 不凭空假设追问次数）', async () => {
    const session = sessionRecord();
    mockClaimOperation.mockResolvedValue(claim(session));
    mockExecuteSkill.mockImplementation(async (definition: any) => {
      if (definition === mockPeerDefinition) {
        return { internal: { ext: { peer: { message: '嗯', strategy: 'analogy', followUpQuestions: [] } } } };
      }
      return turnSkillResult('对，这一栏填的是具体的几何量。', { shouldTriggerPeer: true });
    });

    await processStudentMessage('sess-peer-1', '这里我搞不懂', { operationClaim: claim(session) as never });

    const peerCalls = mockExecuteSkill.mock.calls.filter(([definition]) => definition === mockPeerDefinition);
    expect(peerCalls).toHaveLength(1);
    expect((peerCalls[0][1] as any).input.peerHistory).toEqual([]);
    expect((peerCalls[0][1] as any).input.strategy).toBe('counterexample'); // apply 层级，老师未在等作答
  });
});
