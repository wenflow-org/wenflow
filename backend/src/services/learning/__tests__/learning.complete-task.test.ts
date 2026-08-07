const mockPrisma: any = {
  subtasks: {
    findUnique: jest.fn()
  },
  $transaction: jest.fn()
}
const mockUpdateLearningMetrics = jest.fn()
const mockAchievementCheck = jest.fn()
const mockEvaluateTaskCompletion = jest.fn()
const mockEmitSignals = jest.fn()
const mockSnapshotRefresh = jest.fn()
const mockDashboardRefresh = jest.fn()

jest.mock('../../../config/database', () => ({ __esModule: true, default: mockPrisma }))
jest.mock('../../metrics/LearningMetricService', () => ({ updateLearningMetrics: mockUpdateLearningMetrics }))
jest.mock('../../achievements/achievement.service', () => ({
  __esModule: true,
  default: { triggerAchievementCheck: mockAchievementCheck }
}))
jest.mock('../../learner/LearnerProgressService', () => ({
  learnerProgressService: {
    evaluateTaskCompletion: mockEvaluateTaskCompletion,
    emitSignals: mockEmitSignals
  }
}))
jest.mock('../../learner/LearnerSnapshotRefreshService', () => ({
  learnerSnapshotRefreshService: { refresh: mockSnapshotRefresh }
}))
jest.mock('../../learner/DashboardGuidanceSnapshotService', () => ({
  dashboardGuidanceSnapshotService: { refreshInBackground: mockDashboardRefresh }
}))
jest.mock('../../background-task-tracker.service', () => ({
  runBackgroundTask: (_name: string, task: () => Promise<unknown>) => { void task().catch(() => undefined) }
}))
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}))
jest.mock('../../ai/ai.service', () => ({ __esModule: true, default: {} }))
jest.mock('../state-tracking.service', () => ({ __esModule: true, default: {} }))
jest.mock('../learning-state.service', () => ({ __esModule: true, default: {} }))
jest.mock('../../learner/LearnerProjectionService', () => ({ learnerProjectionService: {} }))
jest.mock('../../../gateway/event-bus', () => ({ getEventBus: () => ({ emit: jest.fn() }) }))
jest.mock('../../../skills', () => ({ executeSkill: jest.fn() }))
jest.mock('../../../skills/stage-designer', () => ({ stageDesignerDefinition: {} }))

import learningService from '../learning.service'

interface TaskState {
  id: string
  title: string
  milestoneId: string
  userId: string
  status: string
  estimatedMinutes: number
}

describe('LearningService.completeTask milestone progression', () => {
  const userId = 'user-1'
  const pathId = 'path-1'
  const tasks: TaskState[] = [
    { id: 'task-1', title: '任务一', milestoneId: 'milestone-1', userId, status: 'completed', estimatedMinutes: 30 },
    { id: 'task-2', title: '任务二', milestoneId: 'milestone-1', userId, status: 'in_progress', estimatedMinutes: 30 },
    { id: 'task-3', title: '任务三', milestoneId: 'milestone-2', userId, status: 'todo', estimatedMinutes: 30 }
  ]
  const milestones: any[] = [
    { id: 'milestone-1', learningPathId: pathId, stageNumber: 1, status: 'active', unlockedAt: new Date('2026-07-17T08:00:00.000Z') },
    { id: 'milestone-2', learningPathId: pathId, stageNumber: 2, status: 'locked', unlockedAt: null }
  ]
  const path: any = { id: pathId, status: 'active', completedMilestones: 0 }
  const outbox: any[] = []
  let xp = 0
  let tx: any

  function taskRecord(id: string) {
    const task = tasks.find(item => item.id === id)!
    const milestone = milestones.find(item => item.id === task.milestoneId)!
    return {
      ...task,
      linkedConceptName: null,
      coreConcept: null,
      milestones: {
        ...milestone,
        learning_paths: { userId }
      }
    }
  }

  beforeEach(() => {
    jest.clearAllMocks()
    tasks[0].status = 'completed'
    tasks[1].status = 'in_progress'
    tasks[2].status = 'todo'
    milestones[0].status = 'active'
    milestones[0].completedAt = null
    milestones[1].status = 'locked'
    milestones[1].unlockedAt = null
    milestones[1].completedAt = null
    path.status = 'active'
    path.completedMilestones = 0
    outbox.length = 0
    xp = 0

    mockPrisma.subtasks.findUnique.mockImplementation(async ({ where }: any) => taskRecord(where.id))
    mockUpdateLearningMetrics.mockResolvedValue(null)
    mockAchievementCheck.mockResolvedValue([])
    mockEvaluateTaskCompletion.mockResolvedValue({
      signal: { type: 'steady' },
      metrics: { reasoning: '稳定', suggestion: '继续' },
      recommendations: []
    })
    mockEmitSignals.mockResolvedValue(undefined)
    mockSnapshotRefresh.mockResolvedValue({})
    mockDashboardRefresh.mockResolvedValue({})

    tx = {
      subtasks: {
        updateMany: jest.fn(async ({ where, data }: any) => {
          const task = tasks.find(item => item.id === where.id && item.userId === where.userId)!
          if (!task || task.status === 'completed') return { count: 0 }
          Object.assign(task, data)
          return { count: 1 }
        }),
        count: jest.fn(async ({ where }: any) => {
          if (where.milestoneId) {
            return tasks.filter(task => task.milestoneId === where.milestoneId && task.status !== 'completed').length
          }
          if (where.milestones?.learningPathId) {
            const milestoneIds = milestones.filter(item => item.learningPathId === where.milestones.learningPathId).map(item => item.id)
            return tasks.filter(task => milestoneIds.includes(task.milestoneId) && task.status !== 'completed').length
          }
          return 0
        }),
        findUnique: jest.fn(async ({ where }: any) => taskRecord(where.id))
      },
      users: {
        update: jest.fn(async ({ data }: any) => {
          xp += data.xp.increment
          return { id: userId, xp }
        })
      },
      milestones: {
        updateMany: jest.fn(async ({ where, data }: any) => {
          const milestone = milestones.find(item => item.id === where.id)!
          if (!milestone || (where.learningPathId && milestone.learningPathId !== where.learningPathId)) return { count: 0 }
          if (where.status?.not === 'completed' && milestone.status === 'completed') return { count: 0 }
          Object.assign(milestone, data)
          return { count: 1 }
        }),
        findFirst: jest.fn(async ({ where }: any) => milestones
          .filter(item => item.learningPathId === where.learningPathId && item.stageNumber > where.stageNumber.gt && item.status === where.status)
          .sort((a, b) => a.stageNumber - b.stageNumber)[0] || null),
        update: jest.fn(async ({ where, data }: any) => {
          const milestone = milestones.find(item => item.id === where.id)!
          Object.assign(milestone, data)
          return milestone
        }),
        count: jest.fn(async ({ where }: any) => milestones
          .filter(item => item.learningPathId === where.learningPathId && item.status === where.status).length)
      },
      learning_paths: {
        update: jest.fn(async ({ data }: any) => {
          Object.assign(path, data)
          return path
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          if (path.id !== where.id || (where.userId && where.userId !== userId)) return { count: 0 }
          if (where.status?.not === 'completed' && path.status === 'completed') return { count: 0 }
          Object.assign(path, data)
          return { count: 1 }
        })
      },
      domain_event_outbox: {
        create: jest.fn(async ({ data }: any) => {
          outbox.push(data)
          return data
        })
      }
    }
    mockPrisma.$transaction.mockImplementation(async (callback: any) => callback(tx))
  })

  it('关闭当前里程碑、解锁下一里程碑，并在最后任务后完成路径', async () => {
    await learningService.completeTask({ taskId: 'task-2', userId })

    expect(milestones[0].status).toBe('completed')
    expect(milestones[1].status).toBe('active')
    expect(milestones[1].unlockedAt).toBeInstanceOf(Date)
    expect(path).toEqual(expect.objectContaining({ status: 'active', completedMilestones: 1 }))
    expect(xp).toBe(50)
    expect(outbox.map(item => item.eventType)).toEqual(['task:completed'])
    expect(tx.milestones.findFirst).toHaveBeenCalledWith({
      where: {
        learningPathId: pathId,
        stageNumber: { gt: 1 },
        status: 'locked'
      },
      orderBy: { stageNumber: 'asc' }
    })

    await learningService.completeTask({ taskId: 'task-3', userId })

    expect(milestones[1].status).toBe('completed')
    expect(path).toEqual(expect.objectContaining({ status: 'completed', completedMilestones: 2 }))
    expect(xp).toBe(100)
    expect(outbox.map(item => item.eventType)).toEqual(['task:completed', 'task:completed', 'path:completed'])
    expect(JSON.parse(outbox[2].payload)).toEqual({ pathId, completedByTaskId: 'task-3' })
    expect(tx.learning_paths.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: pathId, status: { not: 'completed' } }
    }))

    const duplicate = await learningService.completeTask({ taskId: 'task-3', userId })
    expect(duplicate.alreadyCompleted).toBe(true)
    expect(xp).toBe(100)
    expect(outbox.map(item => item.eventType)).toEqual(['task:completed', 'task:completed', 'path:completed'])
    expect(mockUpdateLearningMetrics).not.toHaveBeenCalled()
  })

  it('任务在事务获得父级写锁前被替换时返回冲突而不是伪造已完成', async () => {
    tx.subtasks.findUnique.mockResolvedValueOnce(null)

    await expect(learningService.completeTask({ taskId: 'task-2', userId }))
      .rejects.toMatchObject({ status: 409, code: 'PATH_TASK_REPLACED' })

    expect(xp).toBe(0)
    expect(outbox).toHaveLength(0)
  })

  it('回滚冲突生成时不会把已取消的旧 worker 恢复为可运行状态', async () => {
    const restoreTx = {
      learning_paths: {
        findUnique: jest.fn().mockResolvedValue({
          activeGenerationRunId: 'new-run',
          aiPromptTemplate: '{"during":true}',
          status: 'generating'
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      path_generation_runs: {
        findUnique: jest.fn().mockResolvedValue({
          rollbackSnapshot: JSON.stringify({
            version: 1,
            path: {
              activeGenerationRunId: 'old-run',
              aiPromptTemplate: '{"before":true}',
              status: 'active',
              restoreStatus: true
            },
            supersededRun: {
              id: 'old-run',
              status: 'processing',
              retryAllowed: false,
              finishedAt: null,
              leaseExpiresAt: null,
              errorCode: null,
              errorMessage: null
            }
          })
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    }
    mockPrisma.$transaction.mockImplementationOnce(async (callback: any) => callback(restoreTx))

    await (learningService as any).restorePathAfterMutationConflict('path-1', 'new-run', {
      status: 409,
      code: 'PATH_MUTATION_HAS_LEARNING_PROGRESS',
      message: 'blocked'
    })

    expect(restoreTx.path_generation_runs.updateMany).toHaveBeenCalledTimes(1)
    expect(restoreTx.learning_paths.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        activeGenerationRunId: null,
        aiPromptTemplate: '{"before":true}',
        status: 'active'
      })
    }))
  })

  it('现有路径普通生成失败时恢复快照并保留失败 run 供重试', async () => {
    const restoreTx = {
      learning_paths: {
        findUnique: jest.fn().mockResolvedValue({
          activeGenerationRunId: 'new-run',
          aiPromptTemplate: '{"during":true}',
          status: 'generating'
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      path_generation_runs: {
        findUnique: jest.fn().mockResolvedValue({
          rollbackSnapshot: JSON.stringify({
            version: 1,
            path: {
              activeGenerationRunId: 'old-run',
              aiPromptTemplate: '{"before":true}',
              status: 'active',
              restoreStatus: true
            },
            supersededRun: null
          })
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    }
    mockPrisma.$transaction.mockImplementationOnce(async (callback: any) => callback(restoreTx))

    await (learningService as any).restorePathAfterMutationConflict(
      'path-1',
      'new-run',
      new Error('provider unavailable'),
      {
        runStatus: 'failed',
        retryAllowed: true,
        errorCode: 'PATH_GENERATION_CORE_FAILED'
      }
    )

    expect(restoreTx.path_generation_runs.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'failed',
        retryAllowed: true,
        errorCode: 'PATH_GENERATION_CORE_FAILED'
      })
    }))
    expect(restoreTx.learning_paths.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'path-1', activeGenerationRunId: 'new-run', status: 'generating' },
      data: expect.objectContaining({
        activeGenerationRunId: 'new-run',
        aiPromptTemplate: '{"before":true}',
        status: 'active'
      })
    }))
  })

  it('现有路径在生成期间已完成时只标记 run 失败，不回滚路径状态或提示词', async () => {
    const restoreTx = {
      learning_paths: {
        findUnique: jest.fn().mockResolvedValue({
          activeGenerationRunId: 'new-run',
          aiPromptTemplate: '{"progress":true}',
          status: 'completed'
        }),
        updateMany: jest.fn()
      },
      path_generation_runs: {
        findUnique: jest.fn().mockResolvedValue({
          rollbackSnapshot: JSON.stringify({
            version: 1,
            path: {
              activeGenerationRunId: null,
              aiPromptTemplate: '{"before":true}',
              status: 'active',
              restoreStatus: true
            },
            supersededRun: null
          })
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    }
    mockPrisma.$transaction.mockImplementationOnce(async (callback: any) => callback(restoreTx))

    await (learningService as any).restorePathAfterMutationConflict(
      'path-1',
      'new-run',
      new Error('provider unavailable'),
      {
        runStatus: 'failed',
        retryAllowed: true,
        errorCode: 'PATH_GENERATION_CORE_FAILED'
      }
    )

    expect(restoreTx.path_generation_runs.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'failed', retryAllowed: true })
    }))
    expect(restoreTx.learning_paths.updateMany).not.toHaveBeenCalled()
  })
})
