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
  asDisplayHundred,
  asDisplayBalance,
  toInternalTenScale,
  toInternalBalance,
  type LearningStateMetrics
} from '../learning-state.service'

describe('LearningStateService display metric concurrency', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    jest.clearAllMocks()
  })

  it('recomputes derived metrics from the latest committed snapshot after a CAS conflict', async () => {
    const firstSnapshot: LearningStateMetrics = {
      lss: toInternalTenScale(2),
      ktl: toInternalTenScale(2),
      lf: toInternalTenScale(1),
      lsb: toInternalBalance(1),
      timestamp: new Date('2026-07-19T00:00:00.000Z')
    }
    const latestSnapshot: LearningStateMetrics = {
      lss: toInternalTenScale(6),
      ktl: toInternalTenScale(7),
      lf: toInternalTenScale(3),
      lsb: toInternalBalance(4),
      timestamp: new Date('2026-07-19T00:01:00.000Z')
    }
    jest.spyOn(learningStateService, 'getCurrentStateSnapshot')
      .mockResolvedValueOnce({ revision: 3, metrics: firstSnapshot })
      .mockResolvedValueOnce({ revision: 4, metrics: latestSnapshot })
    const commit = jest.spyOn(learningStateService, 'commitDisplayMetrics')
      .mockRejectedValueOnce(new LearningStateRevisionConflictError())
      .mockResolvedValueOnce({
        lss: toInternalTenScale(7),
        ktl: toInternalTenScale(8),
        lf: toInternalTenScale(4),
        lsb: toInternalBalance(4),
        timestamp: new Date('2026-07-19T00:02:00.000Z')
      })
    // display 契约必须经过命名转换器（品牌类型保证：普通 number 塞不进来）
    const derive = jest.fn((previous: LearningStateMetrics | null) => ({
      lss: asDisplayHundred((previous?.lss || 0) + 1),
      ktl: asDisplayHundred((previous?.ktl || 0) + 1),
      lf: asDisplayHundred((previous?.lf || 0) + 1),
      lsb: asDisplayBalance(previous?.lsb || 0),
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
      lss: asDisplayHundred(display),
      ktl: asDisplayHundred(display),
      lf: asDisplayHundred(display),
      lsb: asDisplayBalance(-display),
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
      lss: toInternalTenScale(1),
      ktl: toInternalTenScale(1),
      lf: toInternalTenScale(1),
      lsb: toInternalBalance(0),
      timestamp: new Date()
    })

    await learningStateService.commitDerivedDisplayMetrics('user-1', () => ({
      lss: asDisplayHundred(10),
      ktl: asDisplayHundred(10),
      lf: asDisplayHundred(10),
      lsb: asDisplayBalance(0)
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
      lss: toInternalTenScale(1),
      ktl: toInternalTenScale(2),
      lf: toInternalTenScale(0.5),
      lsb: toInternalBalance(1.5),
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
      lss: toInternalTenScale(3),
      ktl: toInternalTenScale(4),
      lf: toInternalTenScale(2),
      lsb: toInternalBalance(2),
      timestamp: asOf
    })
    const derive = jest.fn(() => ({
      lss: asDisplayHundred(30),
      ktl: asDisplayHundred(40),
      lf: asDisplayHundred(20),
      lsb: asDisplayBalance(20),
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
