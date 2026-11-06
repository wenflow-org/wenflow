/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 175-3：教学回合 wall-clock 超时必须能真正取消底层调用。
 *
 * 缺陷形态：旧 `withTimeout` 自建 AbortController 却没人消费（注释还写着「调用方可传入 controller」，
 * 签名里根本没这个参数）——超时只是「上层不再等」，executeSkill 里的模型调用继续跑；同时 finally
 * 已经 releaseOperation（committed 尚未置真），于是租约释放后幽灵回合仍在烧 token，可并发新请求。
 *
 * 本用例跑真实引擎链（只 mock 外部协作者），让教学回合的 executeSkill 永不 resolve 模拟模型挂起，
 * 断言：超时后传给 executeSkill 的 abortSignal 为 aborted，且 releaseOperation 发生时底层已取消。
 */
const mockClaimOperation = jest.fn()
const mockCommitTurnState = jest.fn()
const mockReleaseOperation = jest.fn()
const mockTurnSkill = jest.fn()
const mockRecordCheckpointEvidence = jest.fn(async () => undefined)
const mockRecordCheckpointAttemptEvidence = jest.fn(async () => undefined)
const mockRecordAnchorProbeResult = jest.fn(async () => undefined)
const mockResolveAnchorTarget = jest.fn(async () => null)
const mockRecordDegradation = jest.fn()

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: { teacher_observations: {}, misconceptions: {}, learner_evidence: {} },
}))
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))
jest.mock('../../../skills', () => ({
  executeSkill: (...args: unknown[]) => mockTurnSkill(...args),
  executeSkillWithResult: jest.fn(),
  auxSkillDefinitionMap: {},
  peerAgentDefinition: {},
}))
jest.mock('../../../skills/teaching-turn', () => ({ teachingTurnAgentDefinition: {} }))
jest.mock('../../../skills/degradation-telemetry', () => ({
  recordDegradation: (...args: unknown[]) => mockRecordDegradation(...args),
  degradationCause: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}))
jest.mock('../TeachingContextBuilder', () => ({
  buildTeachingScenarioContext: jest.fn(async () => ({
    subject: '护理', topic: '数值与动作配对',
    taskTitle: '圈出数值旁边的护理动作词', taskDescription: '按课文圈词并配对', taskType: 'practice',
    taskProfile: { knowledgeType: 'procedural', cognitiveLevel: 'apply' },
    currentTaskContext: { description: '圈词配对', acceptanceCriteria: '能说出动作词与数值的对应' },
    cognitiveFrame: { targetRelation: '把数值与动作词配对成可回查的记录', transferGoal: null, cognitiveLevel: 'apply' }, learnerProjection: null,
    pathProgress: { pathTitle: '护考两科过线', pathSummary: null, currentMilestoneTitle: '数值与动作', currentStageNumber: 1, currentTaskOrder: 1, totalTasksInMilestone: 3 },
    taskKnowledgeSeeds: [], anchorMasteredLastSeenAt: null, learningState: null,
  })),
}))
jest.mock('../../field-dispatcher', () => ({
  assembleTeachingTurnChannels: jest.fn(async () => ({ channels: {}, skipped: [] })),
}))
jest.mock('../teaching-classroom-flow', () => {
  // 保留真实实现：withTimeoutSignal 正是被测对象
  const actual = jest.requireActual('../teaching-classroom-flow')
  return {
    ...actual,
    buildLearnerStateContext: () => ({}),
    buildTeachingControlContext: () => ({}),
    buildPathBackgroundContext: () => null,
  }
})
jest.mock('../TeachingContextCompressionService', () => ({
  teachingContextCompressionService: { compress: () => ({ messages: [] }) },
}))
jest.mock('../PeerTriggerService', () => ({
  peerTriggerService: { shouldTrigger: () => false },
}))
jest.mock('../teaching-visual.service', () => ({
  generateTeachingVisual: jest.fn(async () => null),
  buildVisualOpportunity: jest.fn(() => null),
  detectExerciseLeakInReply: jest.fn(() => false),
  hasDanglingFigureReference: jest.fn(() => false),
  stripDanglingFigureReferences: jest.fn((text: string) => text),
}))
jest.mock('../../../services/learning/learning-state.service', () => ({
  learningStateService: {
    coerceMetrics: (value: unknown) => value || { lss: 0, ktl: 0, lf: 0, lsb: 0 },
    calculateRuntimeState: () => ({ lss: 0.5, ktl: 0.5, lf: 0.5, lsb: 0.5 }),
  },
}))
jest.mock('../../memory/memory-trace.service', () => ({
  memoryTraceService: { applyKtEstimate: jest.fn(async () => undefined) },
}))
jest.mock('../../learner/misconception-ledger.service', () => ({
  recordMisconceptions: jest.fn(async () => undefined),
}))
jest.mock('../../background-task-tracker.service', () => ({
  runBackgroundTask: jest.fn(async (_name: string, fn: () => Promise<unknown>) => fn()),
}))
jest.mock('../TeachingOperationLeaseGuard', () => ({
  TeachingOperationLeaseGuard: class {
    start() {}
    stop() {}
  },
}))
jest.mock('../TeachingSessionRepository', () => {
  const actual = jest.requireActual('../TeachingSessionRepository')
  return {
    ...actual,
    teachingSessionRepository: {
      claimOperation: (...args: unknown[]) => mockClaimOperation(...args),
      commitTurnState: (...args: unknown[]) => mockCommitTurnState(...args),
      releaseOperation: (...args: unknown[]) => mockReleaseOperation(...args),
    },
  }
})
jest.mock('../teaching-checkpoint', () => {
  const actual = jest.requireActual('../teaching-checkpoint')
  return {
    ...actual,
    recordCheckpointResultEvidence: (...args: any[]) => mockRecordCheckpointEvidence(...(args as [])),
    recordCheckpointAttemptEvidence: (...args: any[]) => mockRecordCheckpointAttemptEvidence(...(args as [])),
    recordAnchorProbeResult: (...args: any[]) => mockRecordAnchorProbeResult(...(args as [])),
    resolveAnchorProbeTarget: (...args: any[]) => mockResolveAnchorTarget(...(args as [])),
  }
})

import { processStudentMessage } from '../teaching-turn-engine'

function sessionRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sess-1',
    userId: 'user-1',
    taskId: 'task-1',
    status: 'active',
    mode: 'tutor',
    messages: [
      { role: 'assistant', content: '我们开始吧', timestamp: new Date().toISOString() },
    ],
    knowledgeState: [],
    teachingState: {
      checkpointHistory: [],
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

function turnSkillResult(reply: string) {
  return {
    success: true,
    internal: {
      ext: {
        teachingTurnOutcome: {
          artifact: {
            reply,
            analysis: { understanding: 0.8, engagement: 0.7, confusionPoints: [] },
            knowledge: { currentPoint: '汇总动作', points: [] },
            control: {},
            pedagogy: { strategies: ['feedback'] },
          },
        },
      },
    },
  };
}

/** 永不 resolve：模拟上游模型挂起，只有 abortSignal 能停掉它 */
function hangingSkill(signalLog: Array<AbortSignal | undefined>) {
  return (_def: unknown, _input: unknown, options?: { abortSignal?: AbortSignal }) => {
    signalLog.push(options?.abortSignal);
    return new Promise(() => { /* 挂起 */ });
  };
}

afterEach(() => {
  jest.useRealTimers();
});

beforeEach(() => {
  jest.clearAllMocks();
  mockCommitTurnState.mockResolvedValue(undefined);
  mockReleaseOperation.mockResolvedValue(undefined);
  jest.useFakeTimers();
});

describe('教学回合超时取消（175-3）', () => {
  it('主回合超时：传入 executeSkill 的 signal 被 abort，且释放租约时底层已取消', async () => {
    const signals: Array<AbortSignal | undefined> = [];
    mockTurnSkill.mockImplementation(hangingSkill(signals));
    // 释放租约的那一刻，底层是否已经收到取消——这正是「超时后仍在跑 + 租约已释放」的判据
    let abortedAtRelease: boolean | null = null;
    mockReleaseOperation.mockImplementation(async () => {
      abortedAtRelease = signals[0]?.aborted ?? null;
    });

    const session = sessionRecord();
    mockClaimOperation.mockResolvedValue(claim(session));

    const pending = processStudentMessage('sess-1', '我试试这道题', {
      operationClaim: claim(session) as never,
    });
    const rejection = expect(pending).rejects.toThrow('TEACHING_TURN_TIMEOUT');
    // 阈值 300s（对齐 defaultRequestTimeoutMs）
    await jest.advanceTimersByTimeAsync(300_001);
    await rejection;

    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
    expect(mockReleaseOperation).toHaveBeenCalledWith('sess-1', 'op-1');
    expect(abortedAtRelease).toBe(true);
  });

  it('算式修复重调超时：重调的 signal 同样被 abort（随后放行原回复）', async () => {
    const signals: Array<AbortSignal | undefined> = [];
    let call = 0;
    mockTurnSkill.mockImplementation((_def: unknown, _input: unknown, options?: { abortSignal?: AbortSignal }) => {
      call += 1;
      signals.push(options?.abortSignal);
      // 首轮给出被确定性复算判定有误的算式（12×12 应为 144）→ 触发修复重调
      if (call === 1) return Promise.resolve(turnSkillResult('我们算一下：12 × 12 = 134。'));
      return new Promise(() => { /* 重调挂起 */ });
    });

    const session = sessionRecord();
    mockClaimOperation.mockResolvedValue(claim(session));

    const pending = processStudentMessage('sess-1', '我算算看', {
      operationClaim: claim(session) as never,
    });
    // 修复重调阈值 90s（ARITHMETIC_REPAIR_TIMEOUT_MS）
    await jest.advanceTimersByTimeAsync(90_001);
    const result = await pending;

    expect(signals).toHaveLength(2);
    expect(signals[1]?.aborted).toBe(true);
    // 修复失败不阻塞课堂：按原回复放行
    expect(result.aiResponse).toContain('12 × 12 = 134');
  });
});
