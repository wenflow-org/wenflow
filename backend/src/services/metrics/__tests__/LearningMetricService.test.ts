const mockPrisma: any = {
  teaching_sessions: {
    findMany: jest.fn()
  }
}
const mockCommitDerivedDisplayMetrics = jest.fn()
const mockToDisplayMetrics = jest.fn((metrics: any) => ({
  ...metrics,
  lss: metrics.lss * 10,
  ktl: metrics.ktl * 10,
  lf: metrics.lf * 10,
  lsb: metrics.lsb * 10
}))

jest.mock('../../../config/database', () => ({ __esModule: true, default: mockPrisma }))
jest.mock('../../learning/learning-state.service', () => ({
  __esModule: true,
  default: {
    commitDerivedDisplayMetrics: mockCommitDerivedDisplayMetrics,
    toDisplayMetrics: mockToDisplayMetrics,
    getCurrentState: jest.fn()
  }
}))

import {
  calculateKTL,
  calculateLF,
  reconcileTaskCompletionMetric,
  updateLearningMetrics
} from '../LearningMetricService'

describe('LearningMetricService task completion persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPrisma.teaching_sessions.findMany.mockResolvedValue([])
    mockCommitDerivedDisplayMetrics.mockResolvedValue({
      lss: 0.8,
      ktl: 0.4,
      lf: 0,
      lsb: 0.4,
      timestamp: new Date()
    })
  })

  it('uses the stable task source key and reuse guard', async () => {
    await updateLearningMetrics({
      userId: 'user-1',
      taskId: 'task-1',
      durationMinutes: 30,
      completed: true
    })

    expect(mockCommitDerivedDisplayMetrics).toHaveBeenCalledWith(
      'user-1',
      expect.any(Function),
      { sourceKey: 'task-completion:task-1', reuseExisting: true }
    )
  })

  it('reconciles the durable task event through the same stable metric path', async () => {
    const occurredAt = new Date('2026-07-19T08:30:00.000Z')
    await reconcileTaskCompletionMetric({
      id: 'event-1',
      type: 'task:completed',
      schemaVersion: 1,
      aggregateType: 'task',
      aggregateId: 'task-1',
      userId: 'user-1',
      source: 'test',
      data: {
        taskId: 'task-1',
        actualMinutes: 45,
        subjectiveDifficulty: 7
      },
      occurredAt
    })

    expect(mockCommitDerivedDisplayMetrics).toHaveBeenCalledWith(
      'user-1',
      expect.any(Function),
      { sourceKey: 'task-completion:task-1', reuseExisting: true, asOf: occurredAt }
    )
    const deriveMetrics = mockCommitDerivedDisplayMetrics.mock.calls[0][1]
    await expect(deriveMetrics(null)).resolves.toEqual(expect.objectContaining({ timestamp: occurredAt }))
    expect(mockPrisma.teaching_sessions.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({
        startTime: {
          gte: new Date('2026-07-12T08:30:00.000Z'),
          lte: occurredAt
        },
        endTime: { lte: occurredAt }
      })
    }))
    expect(mockPrisma.teaching_sessions.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({
        startTime: {
          gte: new Date('2026-07-12T08:30:00.000Z'),
          lte: occurredAt
        },
        endTime: { lte: occurredAt }
      })
    }))
  })

  it('uses the supplied as-of time for LF day decay', async () => {
    const asOf = new Date('2026-07-19T08:30:00.000Z')
    mockPrisma.teaching_sessions.findMany.mockResolvedValue([{ 
      startTime: new Date('2026-07-19T01:00:00.000Z'),
      duration: 180,
      taskId: 'task-1'
    }])

    await expect(calculateLF('user-1', asOf)).resolves.toBe(10)
  })

  it('rejects KTL and LF query errors instead of returning fallback metrics', async () => {
    mockPrisma.teaching_sessions.findMany.mockRejectedValueOnce(new Error('ktl query failed'))
    await expect(calculateKTL('user-1', 80, 0)).rejects.toThrow('ktl query failed')

    mockPrisma.teaching_sessions.findMany.mockRejectedValueOnce(new Error('lf query failed'))
    await expect(calculateLF('user-1')).rejects.toThrow('lf query failed')
  })

  it('rejects canonical metric reconciliation when LF calculation fails', async () => {
    mockCommitDerivedDisplayMetrics.mockImplementation(async (_userId: string, derive: any) => derive(null))
    mockPrisma.teaching_sessions.findMany
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('lf query failed'))

    await expect(updateLearningMetrics({
      userId: 'user-1',
      taskId: 'task-1',
      durationMinutes: 30,
      completed: true,
      timestamp: new Date('2026-07-19T08:30:00.000Z')
    })).rejects.toThrow('lf query failed')
  })
})
