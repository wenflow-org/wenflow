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
  })

  it('derives 0-10 display metrics via the learning-state EWMA semantics (KTL/LF 收敛)', async () => {
    const asOf = new Date('2026-07-19T08:30:00.000Z')
    mockPrisma.teaching_sessions.findMany.mockResolvedValue([])
    let derived: any = null
    mockCommitDerivedDisplayMetrics.mockImplementation(async (_userId: string, derive: any) => {
      derived = await derive(null)
      return { lss: derived.lss, ktl: derived.ktl, lf: derived.lf, lsb: derived.lsb, timestamp: asOf }
    })

    await updateLearningMetrics({
      userId: 'user-1',
      taskId: 'task-1',
      durationMinutes: 30,
      subjectiveDifficulty: 6,
      completed: true,
      timestamp: asOf
    })

    expect(derived).toEqual(expect.objectContaining({
      lss: expect.any(Number),
      ktl: expect.any(Number),
      lf: expect.any(Number),
      lsb: expect.any(Number),
    }))
    // 0-10 尺度（internal-10）：所有值在 [-10, 10] 内，不再产出 0-100
    for (const key of ['lss', 'ktl', 'lf', 'lsb'] as const) {
      expect(derived[key]).toBeGreaterThanOrEqual(-10)
      expect(derived[key]).toBeLessThanOrEqual(10)
    }
    expect(derived.source).toBe('task-completion')
    expect(derived.primaryMetric).toBe('lsb')
  })

  it('rejects metric commit errors instead of returning fallback metrics', async () => {
    mockCommitDerivedDisplayMetrics.mockRejectedValue(new Error('commit failed'))

    await expect(updateLearningMetrics({
      userId: 'user-1',
      taskId: 'task-1',
      durationMinutes: 30,
      completed: true,
      timestamp: new Date('2026-07-19T08:30:00.000Z')
    })).rejects.toThrow('commit failed')
  })
})
