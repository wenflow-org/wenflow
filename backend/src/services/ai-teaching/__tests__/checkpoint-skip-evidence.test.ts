/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * H1 跳过路径留痕：submitCheckpoint(skip=true) 在提交成功后落一条
 * `checkpoint:attempt`（outcome=skipped），且不影响跳过主链（回执与状态清理不变）。
 * 负对照：不允许跳过的检查点被拒时不落任何留痕。
 */
const mockClaimOperation = jest.fn()
const mockCommitTurnState = jest.fn()
const mockReleaseOperation = jest.fn()
const mockRecordCheckpointAttemptEvidence = jest.fn(async () => undefined)

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {},
}))
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))
jest.mock('../../../skills', () => ({
  executeSkill: jest.fn(),
  peerAgentDefinition: {},
  auxSkillDefinitionMap: {},
}))
jest.mock('../teaching-turn-engine', () => ({ processStudentMessage: jest.fn() }))
jest.mock('../warmup-writeback', () => ({ applyWarmupExtractionForSession: jest.fn(async () => undefined) }))
jest.mock('../TeachingOperationLeaseGuard', () => ({
  TeachingOperationLeaseGuard: class {
    start() {}
    stop() {}
  },
}))
jest.mock('../teaching-classroom-flow', () => ({
  buildTeachingStateWithArtifacts: (state: unknown) => state,
}))
jest.mock('../teaching-checkpoint', () => {
  const actual = jest.requireActual('../teaching-checkpoint')
  return {
    ...actual,
    recordCheckpointAttemptEvidence: (...args: any[]) => mockRecordCheckpointAttemptEvidence(...(args as [])),
  }
})
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

import { submitCheckpoint } from '../teaching-session-ops'

const CHECKPOINT = {
  id: 'cp-1',
  title: '理解检查',
  type: 'single_choice' as const,
  question: '示例题',
  options: [
    { id: 'a', text: 'A' },
    { id: 'b', text: 'B' },
  ],
  correctOptionIds: ['a'],
  allowSkip: true,
}

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sess-1',
    userId: 'user-1',
    taskId: 'task-1',
    learningPathId: 'path-1',
    status: 'active',
    revision: 5,
    messages: [],
    knowledgeState: [],
    teachingState: {
      pendingCheckpoint: { ...CHECKPOINT },
      checkpointHistory: [],
      sessionArtifacts: {},
    },
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCommitTurnState.mockResolvedValue(undefined)
  mockRecordCheckpointAttemptEvidence.mockResolvedValue(undefined)
})

describe('skip 路径 H1 留痕', () => {
  it('skip=true 提交成功：清 pending、留历史、并落 checkpoint:attempt(skipped)', async () => {
    const session = makeSession()
    mockClaimOperation.mockResolvedValue({ operationId: 'op-1', session, messagesBaseCount: 0 })

    const result = await submitCheckpoint('sess-1', 'cp-1', { skip: true }, 5)

    expect(result.passed).toBe(false)
    const committed = (mockCommitTurnState.mock.calls[0][2] as any).teachingState
    expect(committed.pendingCheckpoint).toBeUndefined()
    expect(committed.sessionArtifacts?.pendingCheckpoint).toBeUndefined()
    expect(committed.checkpointHistory).toEqual([
      expect.objectContaining({ checkpointId: 'cp-1', skipped: true, passed: false }),
    ])
    // H1：跳过终局留痕
    expect(mockRecordCheckpointAttemptEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sess-1' }),
      expect.objectContaining({ id: 'cp-1' }),
      { outcome: 'skipped' },
    )
  })

  it('负对照：checkpoint.allowSkip=false 被拒 → 不提交、不留痕', async () => {
    const session = makeSession({
      teachingState: {
        pendingCheckpoint: { ...CHECKPOINT, allowSkip: false },
        checkpointHistory: [],
        sessionArtifacts: {},
      },
    })
    mockClaimOperation.mockResolvedValue({ operationId: 'op-1', session, messagesBaseCount: 0 })

    await expect(submitCheckpoint('sess-1', 'cp-1', { skip: true }, 5)).rejects.toThrow('该检查点不允许跳过')

    expect(mockCommitTurnState).not.toHaveBeenCalled()
    expect(mockRecordCheckpointAttemptEvidence).not.toHaveBeenCalled()
  })
})
