const mockRepository = {
  assertOwnership: jest.fn(),
  claimFinalization: jest.fn(),
  completeFinalizationStep: jest.fn(),
  failFinalization: jest.fn(),
}
const mockEndSession = jest.fn()
const mockCompleteTask = jest.fn()

jest.mock('../TeachingSessionRepository', () => ({
  teachingSessionRepository: mockRepository
}))
jest.mock('../AITeachingCoordinator', () => ({
  __esModule: true,
  default: { endSession: mockEndSession }
}))
jest.mock('../../learning/learning.service', () => ({
  __esModule: true,
  default: { completeTask: mockCompleteTask }
}))

import { SessionFinalizationService } from '../SessionFinalizationService'

function completedSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    userId: 'user-1',
    taskId: 'task-1',
    mode: 'tutor',
    status: 'completed',
    wrapup: { status: 'complete' },
    advisory: {},
    teachingState: {
      classroomContext: { stage: 'wrapup' },
      finalization: {
        sessionClosure: 'completed',
        taskCompletion: 'not_started',
        reviewCompletion: 'not_started',
        lastAction: 'end_only',
        lastOperationId: 'end-1',
        lastRequestedAt: '2026-07-19T00:00:00.000Z'
      }
    },
    revision: 4,
    updatedAt: new Date('2026-07-19T00:00:00.000Z'),
    endTime: new Date('2026-07-19T00:00:00.000Z'),
    ...overrides
  }
}

describe('SessionFinalizationService', () => {
  const service = new SessionFinalizationService()

  beforeEach(() => {
    jest.clearAllMocks()
    mockRepository.assertOwnership.mockResolvedValue(completedSession())
    mockRepository.failFinalization.mockResolvedValue(undefined)
  })

  it('任务完成失败时只标记 taskCompletion 失败，不调用 Wrapup', async () => {
    mockRepository.claimFinalization.mockResolvedValue({
      status: 'claimed',
      operationId: 'task-op',
      session: completedSession()
    })
    mockCompleteTask.mockRejectedValue(Object.assign(new Error('任务完成失败'), { code: 'PATH_TASK_STATE_CHANGED' }))

    await expect(service.finalize({
      sessionId: 'session-1',
      userId: 'user-1',
      action: 'complete_task',
      operationId: 'task-op',
      revision: 4
    })).rejects.toThrow('任务完成失败')

    expect(mockEndSession).not.toHaveBeenCalled()
    expect(mockRepository.failFinalization).toHaveBeenCalledWith(
      'session-1',
      'task-op',
      'complete_task',
      'PATH_TASK_STATE_CHANGED'
    )
  })

  it('任务完成重试成功后只提交任务步骤并保留 Wrapup', async () => {
    mockRepository.claimFinalization.mockResolvedValue({
      status: 'claimed',
      operationId: 'task-op-2',
      session: completedSession({ revision: 5 })
    })
    mockCompleteTask.mockResolvedValue({ alreadyCompleted: true, task: { id: 'task-1' } })
    mockRepository.completeFinalizationStep.mockResolvedValue(completedSession({
      revision: 6,
      teachingState: {
        classroomContext: { stage: 'wrapup' },
        finalization: {
          sessionClosure: 'completed',
          taskCompletion: 'completed',
          reviewCompletion: 'not_started',
          lastAction: 'complete_task',
          lastOperationId: 'task-op-2',
          lastRequestedAt: '2026-07-19T01:00:00.000Z',
          lastCompletedAt: '2026-07-19T01:01:00.000Z'
        }
      }
    }))

    const result = await service.finalize({
      sessionId: 'session-1',
      userId: 'user-1',
      action: 'complete_task',
      operationId: 'task-op-2',
      revision: 5
    })

    expect(mockEndSession).not.toHaveBeenCalled()
    expect(mockCompleteTask).toHaveBeenCalledTimes(1)
    expect(result).toEqual(expect.objectContaining({
      status: 'completed',
      revision: 6,
      wrapup: { status: 'complete' },
      taskCompletion: { status: 'completed', alreadyCompleted: true }
    }))
  })

  it('已有 Finalization 租约时返回 processing，不重复执行任务', async () => {
    mockRepository.assertOwnership.mockResolvedValue(completedSession({
      status: 'finalizing',
      wrapup: null,
      operationId: 'other-op',
      operationKind: 'finalize:end_only',
      operationLeaseExpiresAt: new Date(Date.now() + 60_000)
    }))
    mockRepository.claimFinalization.mockResolvedValue({
      status: 'processing',
      operationId: 'other-op',
      session: completedSession()
    })

    const result = await service.finalize({
      sessionId: 'session-1',
      userId: 'user-1',
      action: 'complete_task',
      operationId: 'task-op',
      revision: 4
    })

    expect(result).toEqual({
      operationId: 'other-op',
      status: 'processing',
      pollAfterMs: 1500,
      revision: 4
    })
    expect(mockCompleteTask).not.toHaveBeenCalled()
  })
})
