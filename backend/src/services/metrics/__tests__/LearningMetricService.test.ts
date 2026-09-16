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
// 刻度转换函数一律用**真实实现**：mock 里手抄一份就是"两套实现会漂移"的老毛病本身。
jest.mock('../../learning/learning-state.service', () => {
  const actual = jest.requireActual('../../learning/learning-state.service')
  return {
    __esModule: true,
    toInternalTenScale: actual.toInternalTenScale,
    internalTenToDisplay: actual.internalTenToDisplay,
    asDisplayHundred: actual.asDisplayHundred,
    asDisplayBalance: actual.asDisplayBalance,
    default: {
      commitDerivedDisplayMetrics: mockCommitDerivedDisplayMetrics,
      toDisplayMetrics: mockToDisplayMetrics,
      toInternalTenScale: actual.toInternalTenScale,
      getCurrentState: jest.fn()
    }
  }
})

import { toInternalTenScale } from '../../learning/learning-state.service'
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

  it('派生回调输出 display 刻度（0-100），落库时再收敛到 internal-10（KTL/LF EWMA）', async () => {
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
    // 断言**具体刻度**而不是"落在某个范围里"：difficulty 6 → 内部 LSS = 6×10×0.8 ÷10 = 4.8
    // → display 契约 = 48；无前值：ktl = 48×0.5 = 24、lf = 48×0.3 = 14.4、lsb = 9.6。
    // 只有具体值才能拦住"多除/少除一个 10"这类错误（范围断言对 0.4 与 40 都放行）。
    expect(derived.lss).toBe(48)
    expect(derived.ktl).toBeCloseTo(24, 6)
    expect(derived.lf).toBeCloseTo(14.4, 6)
    expect(derived.lsb).toBeCloseTo(9.6, 6)
    // 落库后经 /10 收敛到 internal-10（品牌类型保证这一步只能走转换器）
    expect(toInternalTenScale(derived.lss)).toBe(4.8)
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
