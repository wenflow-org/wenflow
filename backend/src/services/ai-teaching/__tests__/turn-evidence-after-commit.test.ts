/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #173-1①：回合证据写入必须晚于 `commitTurnState` 成功。
 *
 * 缺陷：checkpoint:result / anchor:result / checkpoint:attempt 三处证据在提交**之前**写，
 * 且各自 best-effort 吞错——提交失败回滚后「证据在、状态不在」，重试会再记一次，
 * 成功率分母与校准样本双双失真。
 *
 * 本测试用 mock 让 `commitTurnState` 抛错，断言三条证据写一次都没发生；
 * 正对照（提交成功）再断言三处都写了、且调用顺序在 commit 之后。
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

const CHECKPOINT = {
  id: 'cp-1',
  title: '理解检查',
  type: 'short_answer' as const,
  question: '下个月产量汇总这个动作，改用手动复制粘贴会带来什么额外工作？',
  expectedKeywords: ['重新|重填', '再做'],
  allowSkip: true,
  conceptName: '汇总动作',
  conceptKey: 'cpt_sum',
  conceptSource: 'derived' as const,
  purpose: 'anchor' as const,
  anchorExpectedBelief: 'mastered' as const,
}

function sessionRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sess-1',
    userId: 'user-1',
    taskId: 'task-1',
    status: 'active',
    mode: 'tutor',
    messages: [{ role: 'assistant', content: '我们开始吧', timestamp: new Date().toISOString() }],
    knowledgeState: [],
    teachingState: {
      pendingCheckpoint: CHECKPOINT,
      // 历史一次答错 + 本轮 = 2 = CHECKPOINT_MAX_ATTEMPTS → 触发 attempts_exhausted 终局留痕
      checkpointHistory: [
        { checkpointId: 'cp-1', title: '理解检查', type: 'short_answer', passed: false, judgedBy: 'code', submittedAt: new Date(Date.now() - 60_000).toISOString() },
      ],
      classroomContext: { stage: { current: 'teaching' } },
      sessionArtifacts: {},
    },
    revision: 5,
    startTime: new Date(),
    ...overrides,
  }
}

function turnSkillResult() {
  return {
    success: true,
    internal: {
      ext: {
        teachingTurnOutcome: {
          artifact: {
            reply: '我们再对照一遍：这道题的关键动作是重填。',
            analysis: { understanding: 0.8, engagement: 0.7, confusionPoints: [] },
            knowledge: { currentPoint: '汇总动作', points: [] },
            control: {},
            pedagogy: { strategies: ['feedback'] },
          },
        },
      },
    },
  }
}

const judgement = { judgedBy: 'code' as const, passed: false, detail: '缺少要点：重新' }

beforeEach(() => {
  jest.clearAllMocks()
  mockCommitTurnState.mockResolvedValue(undefined)
  mockTurnSkill.mockResolvedValue(turnSkillResult())
})

describe('#173-1① 回合证据写入晚于状态提交', () => {
  it('commitTurnState 抛错 → 三处证据写一次都不发生（不留「证据在、状态不在」的孤儿行）', async () => {
    const session = sessionRecord()
    mockClaimOperation.mockResolvedValue({ operationId: 'op-1', session, messagesBaseCount: session.messages.length })
    mockCommitTurnState.mockRejectedValueOnce(new Error('SQLITE_BUSY: database is locked'))

    await expect(processStudentMessage('sess-1', '我的答案：我先按常规观察记录处理。', {
      operationClaim: { operationId: 'op-1', session, messagesBaseCount: session.messages.length } as never,
      checkpointId: 'cp-1',
      checkpointJudgement: judgement,
      checkpointSubmission: {},
    })).rejects.toThrow('SQLITE_BUSY')

    expect(mockCommitTurnState).toHaveBeenCalledTimes(1)
    expect(mockRecordCheckpointEvidence).not.toHaveBeenCalled()
    expect(mockRecordAnchorProbeResult).not.toHaveBeenCalled()
    expect(mockRecordCheckpointAttemptEvidence).not.toHaveBeenCalled()
    // 提交失败 → finally 释放操作租约（既有行为不变）
    expect(mockReleaseOperation).toHaveBeenCalledWith('sess-1', 'op-1')
  })

  it('正对照：commitTurnState 成功 → 三处证据都写，且调用顺序在提交之后', async () => {
    const session = sessionRecord()
    mockClaimOperation.mockResolvedValue({ operationId: 'op-1', session, messagesBaseCount: session.messages.length })

    await processStudentMessage('sess-1', '我的答案：我先按常规观察记录处理。', {
      operationClaim: { operationId: 'op-1', session, messagesBaseCount: session.messages.length } as never,
      checkpointId: 'cp-1',
      checkpointJudgement: judgement,
      checkpointSubmission: {},
    })

    expect(mockRecordCheckpointEvidence).toHaveBeenCalledTimes(1)
    // 锚题（purpose='anchor' 且 code 裁决）另写一行待复核信号
    expect(mockRecordAnchorProbeResult).toHaveBeenCalledTimes(1)
    // 到顶强消 → attempts_exhausted 终局留痕
    expect(mockRecordCheckpointAttemptEvidence).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'cp-1' }),
      expect.objectContaining({ outcome: 'attempts_exhausted', attempts: 2 }),
    )
    const commitOrder = mockCommitTurnState.mock.invocationCallOrder[0]
    for (const mock of [mockRecordCheckpointEvidence, mockRecordAnchorProbeResult, mockRecordCheckpointAttemptEvidence]) {
      expect(mock.mock.invocationCallOrder[0]).toBeGreaterThan(commitOrder)
    }
    expect(mockReleaseOperation).not.toHaveBeenCalled()
  })
})
