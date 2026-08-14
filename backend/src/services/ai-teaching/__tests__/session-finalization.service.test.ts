const mockRepository = {
  assertOwnership: jest.fn(),
  claimFinalization: jest.fn(),
  completeFinalizationStep: jest.fn(),
  failFinalization: jest.fn(),
  renewFinalizationLease: jest.fn(),
  recoverExpiredFinalizations: jest.fn(),
}
const mockEndSession = jest.fn()
const mockCompleteTask = jest.fn()

jest.mock('../TeachingSessionRepository', () => ({
  FinalizationOperationError: class FinalizationOperationError extends Error {},
  TeachingSessionConflictError: class TeachingSessionConflictError extends Error {},
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
    mockRepository.renewFinalizationLease.mockResolvedValue(new Date(Date.now() + 60_000))
    mockRepository.recoverExpiredFinalizations.mockResolvedValue(1)
  })

  it('任务完成失败时只标记 taskCompletion 失败，不调用 Wrapup', async () => {
    mockRepository.claimFinalization.mockResolvedValue({
      status: 'claimed',
      operationId: 'task-op',
      leaseOwner: 'lease-1',
      session: completedSession()
    })
    mockCompleteTask.mockRejectedValue(Object.assign(new Error('任务完成失败'), {
      code: 'PATH_TASK_STATE_CHANGED',
      status: 409
    }))

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
      'lease-1',
      'complete_task',
      'PATH_TASK_STATE_CHANGED',
      true
    )
  })

  it('complete_task 在会话未结束时自动先 end 生成 wrapup 再完成任务', async () => {
    const activeSession = { ...completedSession(), status: 'paused', wrapup: null }
    mockRepository.assertOwnership.mockResolvedValue(activeSession)
    mockEndSession.mockResolvedValue({ status: 'completed', operationId: 'auto-end-op', revision: 5 })
    mockRepository.assertOwnership
      .mockResolvedValueOnce(activeSession)
      .mockResolvedValueOnce({ ...activeSession, status: 'completed', wrapup: { status: 'complete' }, revision: 5 })
    mockRepository.claimFinalization.mockResolvedValue({
      status: 'claimed',
      operationId: 'task-op',
      leaseOwner: 'lease-1',
      session: { ...activeSession, status: 'completed', wrapup: { status: 'complete' }, revision: 5 }
    })
    mockCompleteTask.mockResolvedValue({ alreadyCompleted: false })
    mockRepository.completeFinalizationStep.mockResolvedValue({
      ...activeSession,
      status: 'completed',
      wrapup: { status: 'complete' },
      revision: 5,
      teachingState: { finalization: { taskCompletion: 'completed' } }
    })

    const result = await service.finalize({
      sessionId: 'session-1',
      userId: 'user-1',
      action: 'complete_task',
      operationId: 'task-op',
      revision: 4
    })

    expect(mockEndSession).toHaveBeenCalledWith(
      'session-1',
      'task-completed',
      4,
      'task-op',
      expect.any(String),
      expect.any(String)
    )
    expect(mockCompleteTask).toHaveBeenCalled()
    expect(result.status).toBe('completed')
    expect((result as any).taskCompletion).toEqual({ status: 'completed', alreadyCompleted: false })
  })

  it('任务完成重试成功后只提交任务步骤并保留 Wrapup', async () => {
    mockRepository.claimFinalization.mockResolvedValue({
      status: 'claimed',
      operationId: 'task-op-2',
      leaseOwner: 'lease-2',
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
    expect(mockRepository.renewFinalizationLease).toHaveBeenCalledWith(
      'session-1',
      'task-op-2',
      'lease-2'
    )
    expect(mockRepository.completeFinalizationStep).toHaveBeenCalledWith(
      'session-1',
      'task-op-2',
      'lease-2',
      'complete_task',
      {
        taskCompletion: {
          status: 'completed',
          alreadyCompleted: true
        }
      }
    )
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

  it('end_only 将幂等请求身份传给课堂结束链路', async () => {
    mockEndSession.mockResolvedValue({
      status: 'completed',
      operationId: 'end-op',
      revision: 5
    })
    mockRepository.assertOwnership
      .mockResolvedValueOnce(completedSession({ status: 'active', wrapup: null, revision: 4 }))
      .mockResolvedValueOnce(completedSession({ revision: 5 }))

    await service.finalize({
      sessionId: 'session-1',
      userId: 'user-1',
      action: 'end_only',
      operationId: 'end-op',
      revision: 4,
      endReason: 'manual-end'
    })

    expect(mockEndSession).toHaveBeenCalledWith(
      'session-1',
      'manual-end',
      4,
      'end-op',
      expect.stringMatching(/^[a-f0-9]{64}$/),
      JSON.stringify({
        action: 'end_only',
        actualMinutes: null,
        subjectiveDifficulty: null,
        endReason: 'manual-end'
      })
    )
  })

  it('状态轮询返回幂等操作 ID 而不是内部租约所有者', async () => {
    mockRepository.assertOwnership.mockResolvedValue(completedSession({
      status: 'finalizing',
      operationId: 'internal-lease-owner',
      operationKind: 'finalize:end_only',
      operationLeaseExpiresAt: new Date(Date.now() + 60_000),
      teachingState: {
        finalization: {
          sessionClosure: 'processing',
          taskCompletion: 'not_started',
          reviewCompletion: 'not_started',
          lastAction: 'end_only',
          lastOperationId: 'client-operation-id',
          lastRequestedAt: '2026-07-20T00:00:00.000Z'
        }
      }
    }))

    const result = await service.getStatus('session-1', 'user-1')

    expect(result.operationId).toBe('client-operation-id')
    expect(result.status).toBe('processing')
    expect(mockRepository.recoverExpiredFinalizations).not.toHaveBeenCalled()
  })

  it('状态轮询恢复当前课堂的过期 Finalization 后返回失败', async () => {
    mockRepository.assertOwnership
      .mockResolvedValueOnce(completedSession({
        status: 'finalizing',
        operationId: 'expired-lease-owner',
        operationKind: 'finalize:end_only',
        operationLeaseExpiresAt: new Date(Date.now() - 60_000),
        teachingState: {
          finalization: {
            sessionClosure: 'processing',
            taskCompletion: 'not_started',
            reviewCompletion: 'not_started',
            lastAction: 'end_only',
            lastOperationId: 'expired-operation-id',
            lastRequestedAt: '2026-07-20T00:00:00.000Z'
          }
        }
      }))
      .mockResolvedValueOnce(completedSession({
        status: 'finalization_failed',
        operationId: null,
        operationKind: null,
        operationLeaseExpiresAt: null,
        teachingState: {
          finalization: {
            sessionClosure: 'failed',
            taskCompletion: 'not_started',
            reviewCompletion: 'not_started',
            lastAction: 'end_only',
            lastOperationId: 'expired-operation-id',
            lastRequestedAt: '2026-07-20T00:00:00.000Z',
            lastErrorCode: 'FINALIZATION_LEASE_EXPIRED'
          }
        }
      }))

    const result = await service.getStatus('session-1', 'user-1')

    expect(mockRepository.recoverExpiredFinalizations).toHaveBeenCalledWith(
      1,
      'session-1',
      'expired-lease-owner'
    )
    expect(result.operationId).toBe('expired-operation-id')
    expect(result.status).toBe('failed')
  })
})
