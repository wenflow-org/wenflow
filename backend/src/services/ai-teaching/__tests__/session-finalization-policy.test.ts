import {
  getSessionFinalizationState,
  hasReliableSessionEvaluation,
  mergeFinalTeachingState,
  updateSessionFinalizationState
} from '../SessionFinalizationPolicy'

describe('SessionFinalizationPolicy', () => {
  it('failed 来源的保守评估不能提交长期状态', () => {
    expect(hasReliableSessionEvaluation({ sessionLss: 5 }, 'failed')).toBe(false)
    expect(hasReliableSessionEvaluation({ sessionLss: 5 }, 'ai-fallback')).toBe(true)
    expect(hasReliableSessionEvaluation(null, 'model')).toBe(false)
  })

  it('结束课堂时保留课堂上下文和历史，只覆盖最终指标与 artifacts', () => {
    const merged = mergeFinalTeachingState({
      classroomContext: { stage: 'checkpoint' },
      classroomEventHistory: [{ type: 'checkpoint-opened' }],
      stageHistory: [{ stage: 'teaching' }],
      lss: 2
    }, {
      lss: 4,
      ktl: 6
    }, {
      endReason: 'manual-end'
    })

    expect(merged).toEqual({
      classroomContext: { stage: 'checkpoint' },
      classroomEventHistory: [{ type: 'checkpoint-opened' }],
      stageHistory: [{ stage: 'teaching' }],
      lss: 4,
      ktl: 6,
      sessionArtifacts: { endReason: 'manual-end' }
    })
  })

  it('更新 Finalization 步骤时保留课堂历史和其他步骤状态', () => {
    const processing = updateSessionFinalizationState({
      classroomContext: { stage: 'wrapup' },
      finalization: {
        sessionClosure: 'completed',
        taskCompletion: 'not_started',
        reviewCompletion: 'not_started',
        lastAction: 'end_only',
        lastOperationId: 'end-1',
        lastRequestedAt: '2026-07-19T00:00:00.000Z'
      }
    }, 'complete_task', 'task-1', 'taskCompletion', 'processing', {
      requestedAt: '2026-07-19T01:00:00.000Z'
    })
    const failed = updateSessionFinalizationState(
      processing,
      'complete_task',
      'task-1',
      'taskCompletion',
      'failed',
      { errorCode: 'TASK_COMPLETION_FAILED' }
    )

    expect(failed.classroomContext).toEqual({ stage: 'wrapup' })
    expect(getSessionFinalizationState(failed)).toEqual(expect.objectContaining({
      sessionClosure: 'completed',
      taskCompletion: 'failed',
      reviewCompletion: 'not_started',
      lastOperationId: 'task-1',
      lastRequestedAt: '2026-07-19T01:00:00.000Z',
      lastErrorCode: 'TASK_COMPLETION_FAILED'
    }))
  })
})
