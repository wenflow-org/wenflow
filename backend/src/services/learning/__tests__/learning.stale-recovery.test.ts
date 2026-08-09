const mockPrisma: any = {
  path_generation_runs: {
    findMany: jest.fn(),
    updateMany: jest.fn()
  },
  learning_paths: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn()
  },
  $transaction: jest.fn()
}
const mockRunBackgroundTask = jest.fn()

jest.mock('../../../config/database', () => ({ __esModule: true, default: mockPrisma }))
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}))
jest.mock('../../ai/ai.service', () => ({ __esModule: true, default: {} }))
jest.mock('../learning-state.service', () => ({ __esModule: true, default: {} }))
jest.mock('../../achievements/achievement.service', () => ({ __esModule: true, default: {} }))
jest.mock('../../learner/LearnerSnapshotRefreshService', () => ({ learnerSnapshotRefreshService: {} }))
jest.mock('../../learner/DashboardGuidanceSnapshotService', () => ({
  dashboardGuidanceSnapshotService: { refreshInBackground: jest.fn() }
}))
jest.mock('../../learner/LearnerProjectionService', () => ({ learnerProjectionService: {} }))
jest.mock('../../learner/LearnerProgressService', () => ({ learnerProgressService: {} }))
jest.mock('../../background-task-tracker.service', () => ({ runBackgroundTask: mockRunBackgroundTask }))
jest.mock('../../../skills', () => ({ executeSkill: jest.fn() }))
jest.mock('../../../skills/stage-designer', () => ({ stageDesignerDefinition: {} }))
jest.mock('../../../skills/path-planning', () => ({ pathAgentDefinition: {} }))

import learningService from '../learning.service'

describe('LearningService stale core recovery', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPrisma.path_generation_runs.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.learning_paths.findUnique.mockResolvedValue({
      status: 'generating',
      activeGenerationRunId: 'run-1',
      _count: { milestones: 1 }
    })
    mockPrisma.learning_paths.updateMany.mockImplementation(async ({ where }: any) => {
      if (where.id !== 'path-1') return { count: 0 }
      const current = await mockPrisma.learning_paths.findUnique({ where: { id: where.id } })
      if (where.status && current?.status !== where.status) return { count: 0 }
      return { count: 1 }
    })
    mockPrisma.learning_paths.findMany.mockResolvedValue([])
    mockPrisma.$transaction.mockImplementation(async (callback: any) => callback(mockPrisma))
    jest.spyOn(learningService as any, 'updatePathGenerationStatus').mockResolvedValue(undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('restores a stale pre-existing core path without overwriting its legacy prompt', async () => {
    mockPrisma.path_generation_runs.findMany.mockResolvedValue([
      staleRun({ createdPlaceholder: false }, {
        status: 'active',
        aiPromptTemplate: '{"legacy":true}'
      })
    ])

    await expect(learningService.recoverStaleGeneratingPaths()).resolves.toBe(1)

    expect(mockPrisma.path_generation_runs.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'failed',
        retryAllowed: true,
        errorCode: 'GENERATION_LEASE_EXPIRED'
      })
    }))
    expect(mockPrisma.learning_paths.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'path-1', activeGenerationRunId: 'run-1', status: 'generating' },
      data: expect.objectContaining({
        status: 'active',
        aiPromptTemplate: '{"legacy":true}'
      })
    }))
    expect((learningService as any).updatePathGenerationStatus).not.toHaveBeenCalled()
  })

  it('keeps a stale newly-created placeholder failed', async () => {
    mockPrisma.path_generation_runs.findMany.mockResolvedValue([
      staleRun({ createdPlaceholder: true }, {
        status: 'generating',
        aiPromptTemplate: null
      })
    ])

    await expect(learningService.recoverStaleGeneratingPaths()).resolves.toBe(1)

    expect((learningService as any).updatePathGenerationStatus).toHaveBeenCalledWith(
      'path-1',
      { core: 'failed', lastError: 'GENERATION_LEASE_EXPIRED' },
      'run-1',
      'failed'
    )
    expect(mockPrisma.learning_paths.updateMany).toHaveBeenCalledWith({
      where: { id: 'path-1', activeGenerationRunId: 'run-1', status: 'generating' },
      data: { status: 'failed', updatedAt: expect.any(Date) }
    })
  })

  it('propagates placeholder provenance into an automatic replacement run', async () => {
    mockPrisma.path_generation_runs.findMany.mockResolvedValue([
      staleRun({ createdPlaceholder: false }, {
        status: 'active',
        aiPromptTemplate: '{"legacy":true}'
      }, 1)
    ])
    jest.spyOn(learningService as any, 'createAndClaimGenerationRun').mockResolvedValue({ id: 'replacement-run' })
    const generate = jest.spyOn(learningService, 'generateLearningPath').mockResolvedValue({} as any)

    await learningService.recoverStaleGeneratingPaths()
    const replacementTask = mockRunBackgroundTask.mock.calls[0][1]
    await replacementTask()

    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      existingPathId: 'path-1',
      generationRunId: 'replacement-run',
      createdPlaceholder: false
    }))
  })

  it('marks a stale run failed but preserves progress committed after generation began', async () => {
    mockPrisma.path_generation_runs.findMany.mockResolvedValue([
      staleRun({ createdPlaceholder: false }, {
        status: 'active',
        aiPromptTemplate: '{"legacy":true}'
      }, 1)
    ])
    const completedPath = {
      status: 'completed',
      activeGenerationRunId: 'run-1',
      _count: { milestones: 2 }
    }
    mockPrisma.learning_paths.findUnique.mockResolvedValue(completedPath)
    const createReplacement = jest.spyOn(learningService as any, 'createAndClaimGenerationRun')

    await expect(learningService.recoverStaleGeneratingPaths()).resolves.toBe(1)

    expect(mockPrisma.path_generation_runs.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'failed', retryAllowed: true })
    }))
    expect(mockPrisma.learning_paths.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'path-1', activeGenerationRunId: 'run-1', status: 'generating' }
    }))
    expect(completedPath).toEqual(expect.objectContaining({ status: 'completed' }))
    expect(createReplacement).not.toHaveBeenCalled()
    expect(mockRunBackgroundTask).not.toHaveBeenCalled()
  })

  it('preserves usable core content when an older run has no rollback snapshot', async () => {
    const run = staleRun({ createdPlaceholder: false }, {
      status: 'active',
      aiPromptTemplate: '{"legacy":true}'
    }, 1)
    run.rollbackSnapshot = null
    mockPrisma.path_generation_runs.findMany.mockResolvedValue([run])
    const createReplacement = jest.spyOn(learningService as any, 'createAndClaimGenerationRun')

    await expect(learningService.recoverStaleGeneratingPaths()).resolves.toBe(1)

    expect((learningService as any).updatePathGenerationStatus).not.toHaveBeenCalled()
    expect(mockPrisma.learning_paths.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'path-1' }),
      data: expect.objectContaining({ status: 'failed' })
    }))
    expect(createReplacement).not.toHaveBeenCalled()
    expect(mockRunBackgroundTask).not.toHaveBeenCalled()
  })

  it('scans all active generated paths for stage-design retries', async () => {
    mockPrisma.path_generation_runs.findMany.mockResolvedValue([])
    mockPrisma.learning_paths.findMany.mockResolvedValue([])

    await expect(learningService.retryEligibleFailedPathPreparations()).resolves.toBe(0)

    expect(mockPrisma.learning_paths.findMany.mock.calls[0][0]).not.toHaveProperty('take')
  })
})

function staleRun(
  input: Record<string, unknown>,
  path: { status: string; aiPromptTemplate: string | null },
  attempt = 3
) {
  return {
    id: 'run-1',
    learningPathId: 'path-1',
    phase: 'core',
    attempt,
    inputSnapshot: JSON.stringify({
      userId: 'user-1',
      description: 'existing goal',
      ...input
    }),
    rollbackSnapshot: JSON.stringify({
      version: 1,
      path: {
        activeGenerationRunId: null,
        status: path.status,
        aiPromptTemplate: path.aiPromptTemplate,
        restoreStatus: true
      },
      supersededRun: null
    }),
    learningPath: { activeGenerationRunId: 'run-1' }
  }
}
