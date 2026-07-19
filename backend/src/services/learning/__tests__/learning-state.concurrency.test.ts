const mockPrisma: any = {
  users: {
    findUnique: jest.fn()
  },
  learning_metrics: {
    findMany: jest.fn()
  },
  teaching_sessions: {
    findMany: jest.fn()
  }
}

jest.mock('../../../config/database', () => ({ __esModule: true, default: mockPrisma }))
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}))

import learningStateService, {
  LearningStateRevisionConflictError,
  type LearningStateMetrics
} from '../learning-state.service'

describe('LearningStateService display metric concurrency', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    jest.clearAllMocks()
  })

  it('recomputes derived metrics from the latest committed snapshot after a CAS conflict', async () => {
    const firstSnapshot: LearningStateMetrics = {
      lss: 2,
      ktl: 2,
      lf: 1,
      lsb: 1,
      timestamp: new Date('2026-07-19T00:00:00.000Z')
    }
    const latestSnapshot: LearningStateMetrics = {
      lss: 6,
      ktl: 7,
      lf: 3,
      lsb: 4,
      timestamp: new Date('2026-07-19T00:01:00.000Z')
    }
    jest.spyOn(learningStateService, 'getCurrentStateSnapshot')
      .mockResolvedValueOnce({ revision: 3, metrics: firstSnapshot })
      .mockResolvedValueOnce({ revision: 4, metrics: latestSnapshot })
    const commit = jest.spyOn(learningStateService, 'commitDisplayMetrics')
      .mockRejectedValueOnce(new LearningStateRevisionConflictError())
      .mockResolvedValueOnce({
        lss: 7,
        ktl: 8,
        lf: 4,
        lsb: 4,
        timestamp: new Date('2026-07-19T00:02:00.000Z')
      })
    const derive = jest.fn((previous: LearningStateMetrics | null) => ({
      lss: (previous?.lss || 0) + 1,
      ktl: (previous?.ktl || 0) + 1,
      lf: (previous?.lf || 0) + 1,
      lsb: previous?.lsb || 0,
      source: 'test',
      primaryMetric: 'lsb' as const
    }))

    await expect(learningStateService.commitDerivedDisplayMetrics('user-1', derive))
      .resolves.toMatchObject({ lss: 7, ktl: 8, lf: 4, lsb: 4 })

    expect(derive).toHaveBeenNthCalledWith(1, firstSnapshot)
    expect(derive).toHaveBeenNthCalledWith(2, latestSnapshot)
    expect(commit).toHaveBeenNthCalledWith(1, 'user-1', expect.objectContaining({
      expectedRevision: 3,
      lss: 3,
      ktl: 3
    }))
    expect(commit).toHaveBeenNthCalledWith(2, 'user-1', expect.objectContaining({
      expectedRevision: 4,
      lss: 7,
      ktl: 8
    }))
  })

  it.each([
    [1, 0.1],
    [5, 0.5],
    [10, 1],
    [11, 1.1]
  ])('converts display value %p to internal value %p without scale inference', async (display, internal) => {
    const commitPreparedMetric = jest.spyOn(learningStateService as any, 'commitPreparedMetric')
      .mockResolvedValue(undefined)
    jest.spyOn(learningStateService as any, 'buildMetricCreateData').mockResolvedValue({
      sourceKey: 'test-scale'
    })

    const result = await learningStateService.commitDisplayMetrics('user-1', {
      lss: display,
      ktl: display,
      lf: display,
      lsb: -display,
      expectedRevision: 0,
      sourceKey: 'test-scale'
    })

    expect(result).toMatchObject({
      lss: internal,
      ktl: internal,
      lf: internal,
      lsb: -internal
    })
    expect(commitPreparedMetric).toHaveBeenCalledWith(expect.objectContaining({
      sourceKey: 'test-scale',
      metrics: expect.objectContaining({ lss: internal, lsb: -internal })
    }))
  })

  it('excludes a stable source key while recomputing a replacement metric', async () => {
    jest.spyOn(learningStateService, 'getCurrentStateSnapshot')
      .mockResolvedValue({ revision: 2, metrics: null })
    jest.spyOn(learningStateService, 'commitDisplayMetrics').mockResolvedValue({
      lss: 1,
      ktl: 1,
      lf: 1,
      lsb: 0,
      timestamp: new Date()
    })

    await learningStateService.commitDerivedDisplayMetrics('user-1', () => ({
      lss: 10,
      ktl: 10,
      lf: 10,
      lsb: 0
    }), { sourceKey: 'task-completion:task-1' })

    expect(learningStateService.getCurrentStateSnapshot)
      .toHaveBeenCalledWith('user-1', {
        sourceKey: 'task-completion:task-1',
        asOf: undefined
      })
    expect(learningStateService.commitDisplayMetrics).toHaveBeenCalledWith('user-1', expect.objectContaining({
      sourceKey: 'task-completion:task-1'
    }))
  })

  it('reuses an existing stable metric without replacing or reordering it', async () => {
    const existing = {
      lss: 1,
      ktl: 2,
      lf: 0.5,
      lsb: 1.5,
      timestamp: new Date('2026-07-19T00:00:00.000Z')
    }
    jest.spyOn(learningStateService, 'getCommittedMetricBySourceKey').mockResolvedValue(existing)
    const snapshot = jest.spyOn(learningStateService, 'getCurrentStateSnapshot')
    const commit = jest.spyOn(learningStateService, 'commitDisplayMetrics')
    const derive = jest.fn()

    await expect(learningStateService.commitDerivedDisplayMetrics(
      'user-1',
      derive,
      { sourceKey: 'task-completion:task-1', reuseExisting: true }
    )).resolves.toBe(existing)

    expect(snapshot).not.toHaveBeenCalled()
    expect(commit).not.toHaveBeenCalled()
    expect(derive).not.toHaveBeenCalled()
  })

  it('derives a delayed event from the latest predecessor at or before its event time', async () => {
    const asOf = new Date('2026-07-19T00:01:00.000Z')
    const predecessor = {
      lss: 2,
      ktl: 3,
      lf: 1,
      lsb: 2,
      calculatedAt: new Date('2026-07-19T00:00:00.000Z')
    }
    const future = {
      lss: 8,
      ktl: 9,
      lf: 4,
      lsb: 5,
      calculatedAt: new Date('2026-07-19T00:02:00.000Z')
    }
    mockPrisma.users.findUnique.mockResolvedValue({ learningStateRevision: 7 })
    mockPrisma.learning_metrics.findMany.mockImplementation(({ where }: any) => Promise.resolve(
      [predecessor, future].filter((row) => row.calculatedAt <= where.calculatedAt.lte)
    ))
    const commit = jest.spyOn(learningStateService, 'commitDisplayMetrics').mockResolvedValue({
      lss: 3,
      ktl: 4,
      lf: 2,
      lsb: 2,
      timestamp: asOf
    })
    const derive = jest.fn(() => ({
      lss: 30,
      ktl: 40,
      lf: 20,
      lsb: 20,
      timestamp: asOf
    }))

    await learningStateService.commitDerivedDisplayMetrics('user-1', derive, {
      sourceKey: 'task-completion:delayed-task',
      asOf
    })

    expect(mockPrisma.learning_metrics.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        sourceKey: { not: 'task-completion:delayed-task' },
        calculatedAt: { lte: asOf }
      })
    }))
    expect(derive).toHaveBeenCalledWith(expect.objectContaining({
      lss: predecessor.lss,
      ktl: predecessor.ktl,
      lf: predecessor.lf,
      lsb: predecessor.lsb,
      timestamp: predecessor.calculatedAt
    }))
    expect(commit).toHaveBeenCalledWith('user-1', expect.objectContaining({
      expectedRevision: 7,
      sourceKey: 'task-completion:delayed-task',
      timestamp: asOf
    }))
  })
})
