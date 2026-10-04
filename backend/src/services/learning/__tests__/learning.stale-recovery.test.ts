const mockPrisma: any = {
  path_generation_runs: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    updateMany: jest.fn()
  },
  learning_paths: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn()
  },
  milestones: {
    findMany: jest.fn()
  },
  $transaction: jest.fn()
}
const mockRunBackgroundTask = jest.fn()

jest.mock('../../../config/database', () => ({ __esModule: true, default: mockPrisma }))
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}))
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
    ;(learningService as any).pathTemplateMemo?.clear?.()
    mockPrisma.learning_paths.findMany.mockResolvedValue([])
    mockPrisma.milestones.findMany.mockResolvedValue([])
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

  it('P4：预检失败也会把重试计数落库（修复每分钟无限重试）', async () => {
    setRetrySweepCandidate(stageDesignCandidate())
    const queue = jest.spyOn(learningService as any, 'queuePathEnrichmentRetry')
      .mockRejectedValue(Object.assign(new Error('阶段任务生成失败'), { code: 'STAGE_DESIGN_TMP' }))

    await expect(learningService.retryEligibleFailedPathPreparations()).resolves.toBe(0)

    expect(queue).toHaveBeenCalledTimes(1)
    expect((learningService as any).updatePathGenerationStatus).toHaveBeenCalledWith(
      'path-1',
      expect.objectContaining({ stageDesignRetryCount: 1 })
    )
  })

  it('P4：不可自愈的路径变更冲突直接把重试次数顶到上限，终止自动重试', async () => {
    setRetrySweepCandidate(stageDesignCandidate())
    jest.spyOn(learningService as any, 'queuePathEnrichmentRetry')
      .mockRejectedValue(Object.assign(new Error('相关学习内容已有已完成课堂记录，不能删除或覆盖'), {
        code: 'PATH_MUTATION_HAS_COMPLETED_TEACHING_EVIDENCE',
        status: 409
      }))

    await expect(learningService.retryEligibleFailedPathPreparations()).resolves.toBe(0)

    expect((learningService as any).updatePathGenerationStatus).toHaveBeenCalledWith(
      'path-1',
      expect.objectContaining({ stageDesignRetryCount: 3 })
    )
  })

  it('P4：计数已达上限后不再触发新的重试（无新重试调用/无新日志）', async () => {
    setRetrySweepCandidate(stageDesignCandidate({ stageDesignRetryCount: 3 }))
    const queue = jest.spyOn(learningService as any, 'queuePathEnrichmentRetry')

    await expect(learningService.retryEligibleFailedPathPreparations()).resolves.toBe(0)

    expect(queue).not.toHaveBeenCalled()
    expect((learningService as any).updatePathGenerationStatus).not.toHaveBeenCalled()
  })

  it('报告 #52：排队撞瞬时 DB 故障（P1008）→ 预算与退避档位不消耗，参照时间保持原值', async () => {
    const candidate = setRetrySweepCandidate(stageDesignCandidate())
    jest.spyOn(learningService as any, 'getEnrichmentRetryReferenceTime').mockReturnValue(0)
    jest.spyOn(learningService as any, 'queuePathEnrichmentRetry').mockRejectedValue(
      Object.assign(
        new Error('Operations timed out after `N/A`. The database failed to respond to a query'),
        { code: 'P1008' }
      )
    )

    await expect(learningService.retryEligibleFailedPathPreparations()).resolves.toBe(0)

    const patch = (learningService as any).updatePathGenerationStatus.mock.calls[0][1]
    // 一次从未真正发出的重试不得消费预算/推进退避
    expect(patch).not.toHaveProperty('stageDesignRetryCount')
    expect(patch).not.toHaveProperty('lastStageDesignRetryAt')
    // 时间门参照点保持原失败时间 → 下一轮轮询按原档位立即重试
    const originalUpdatedAt = JSON.parse(String(candidate.aiPromptTemplate))._generation.updatedAt
    expect(patch.updatedAt).toBe(originalUpdatedAt)
  })

  it('报告 #52：单路径处理失败（DB 查询超时）不再拖垮整轮——其余路径照常重试', async () => {
    const broken = { ...stageDesignCandidate(), id: 'path-broken', activeGenerationRunId: 'run-broken' }
    const healthy = stageDesignCandidate()
    mockPrisma.learning_paths.findMany.mockResolvedValue([broken, healthy])
    mockPrisma.learning_paths.findUnique.mockImplementation(async ({ where }: any) => {
      const byId: Record<string, any> = { 'path-broken': broken, 'path-1': healthy }
      return { aiPromptTemplate: byId[where?.id]?.aiPromptTemplate ?? null }
    })
    mockPrisma.path_generation_runs.findFirst
      .mockRejectedValueOnce(Object.assign(new Error('Operations timed out'), { code: 'P1008' }))
      .mockResolvedValue(null)
    jest.spyOn(learningService as any, 'getEnrichmentRetryReferenceTime').mockReturnValue(0)
    const queue = jest.spyOn(learningService as any, 'queuePathEnrichmentRetry')
      .mockResolvedValue({ retryCount: 1, runId: 'run-2' })

    await expect(learningService.retryEligibleFailedPathPreparations()).resolves.toBe(1)

    expect(queue).toHaveBeenCalledTimes(1)
    expect(queue.mock.calls[0][0]).toMatchObject({ id: 'path-1' })
  })

  it('追加式自愈：replace 不可用（课堂证据永久冲突）但存在空白阶段 → 走追加通道', async () => {
    const recent = new Date().toISOString()
    const pendingCandidate = {
      ...stageDesignCandidate(),
      // pending + 刚更新 → resolveGenerationRetry 不 allowed（既非 failed 也非 stale）
      aiPromptTemplate: JSON.stringify({ _generation: { stageDesign: 'pending', updatedAt: recent } }),
      updatedAt: new Date(recent)
    }
    setRetrySweepCandidate(pendingCandidate)
    jest.spyOn(learningService as any, 'getEnrichmentRetryReferenceTime').mockReturnValue(0)
    jest.spyOn(learningService as any, 'listEmptyMilestoneIds').mockResolvedValue(['ms-1'])
    const append = jest.spyOn(learningService as any, 'queuePathEnrichmentAppend')
      .mockResolvedValue({ retryCount: 1, runId: 'run-append' })
    const replace = jest.spyOn(learningService as any, 'queuePathEnrichmentRetry')

    await expect(learningService.retryEligibleFailedPathPreparations()).resolves.toBe(1)

    expect(append).toHaveBeenCalledWith(expect.objectContaining({ id: 'path-1' }), expect.anything(), ['ms-1'])
    expect(replace).not.toHaveBeenCalled()
  })

  it('追加式自愈：replace 预算已被顶满但仍有空白阶段 → 改用追加通道（真实卡死路径场景）', async () => {
    setRetrySweepCandidate(stageDesignCandidate({ stageDesignRetryCount: 3 }))
    jest.spyOn(learningService as any, 'getEnrichmentRetryReferenceTime').mockReturnValue(0)
    jest.spyOn(learningService as any, 'listEmptyMilestoneIds').mockResolvedValue(['ms-1', 'ms-2'])
    const append = jest.spyOn(learningService as any, 'queuePathEnrichmentAppend')
      .mockResolvedValue({ retryCount: 1, runId: 'run-append' })
    const replace = jest.spyOn(learningService as any, 'queuePathEnrichmentRetry')

    await expect(learningService.retryEligibleFailedPathPreparations()).resolves.toBe(1)

    expect(append).toHaveBeenCalledWith(expect.objectContaining({ id: 'path-1' }), expect.anything(), ['ms-1', 'ms-2'])
    expect(replace).not.toHaveBeenCalled()
  })

  it('追加式自愈：没有空白阶段时不触发（保留原"不可自愈则放弃"语义）', async () => {
    const recent = new Date().toISOString()
    mockPrisma.learning_paths.findMany.mockResolvedValue([{
      ...stageDesignCandidate(),
      aiPromptTemplate: JSON.stringify({ _generation: { stageDesign: 'pending', updatedAt: recent } }),
      updatedAt: new Date(recent)
    }])
    jest.spyOn(learningService as any, 'listEmptyMilestoneIds').mockResolvedValue([])
    const append = jest.spyOn(learningService as any, 'queuePathEnrichmentAppend')

    await expect(learningService.retryEligibleFailedPathPreparations()).resolves.toBe(0)

    expect(append).not.toHaveBeenCalled()
  })
})

function stageDesignCandidate(overrides: { stageDesignRetryCount?: number } = {}) {
  const oldIso = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  return {
    id: 'path-1',
    status: 'active',
    userId: 'user-1',
    title: 't',
    name: 't',
    description: 'd',
    subject: 's',
    deadline: null,
    deadlineText: null,
    aiPromptTemplate: JSON.stringify({
      _generation: {
        stageDesign: 'failed',
        stageDesignRetryCount: overrides.stageDesignRetryCount ?? 0,
        updatedAt: oldIso
      }
    }),
    activeGenerationRunId: null,
    updatedAt: new Date(oldIso)
  }
}

/** 扫描夹具 + 按需模板读同步喂（2026-10-04 性能批：轮询不再携带 aiPromptTemplate 大列，
 *  retryOnePreparedPath 经 getPathTemplateMemoized 单行读取模板） */
function setRetrySweepCandidate(candidate: any) {
  mockPrisma.learning_paths.findMany.mockResolvedValue([candidate])
  mockPrisma.learning_paths.findUnique.mockResolvedValue({ aiPromptTemplate: candidate.aiPromptTemplate })
  return candidate
}

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
