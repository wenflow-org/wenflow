import {
  calculateRetention,
  reviewIntervalDays,
  isReviewDue,
} from '../actr'

const DAY_MS = 24 * 60 * 60 * 1000
const at = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY_MS)

describe('actr 幂律衰减（记忆引擎 M2）', () => {
  it('从未提取过返回原始强度（无衰减）', () => {
    expect(calculateRetention(0.8, null)).toBe(0.8)
    expect(calculateRetention(0.8, undefined)).toBe(0.8)
  })

  it('按 1/(1+t)^d 衰减，d=0.5', () => {
    const retention = calculateRetention(0.8, at(3), new Date(), 0.5)
    expect(retention).toBeCloseTo(0.8 / Math.pow(4, 0.5), 5)
  })

  it('衰减随时间单调下降', () => {
    const r1 = calculateRetention(0.8, at(1), new Date())
    const r7 = calculateRetention(0.8, at(7), new Date())
    expect(r1).toBeGreaterThan(r7)
  })

  it('d 越大衰减越快', () => {
    const fast = calculateRetention(0.8, at(7), new Date(), 1.0)
    const slow = calculateRetention(0.8, at(7), new Date(), 0.3)
    expect(fast).toBeLessThan(slow)
  })

  it('结果钳制在 0-1', () => {
    expect(calculateRetention(1.5, at(1))).toBeLessThanOrEqual(1)
    expect(calculateRetention(-1, at(1))).toBe(0)
  })
})

describe('Cepeda 间隔规则（10%-20% → 取 15%）', () => {
  it('目标保留 7 天 → 间隔约 1 天', () => {
    expect(reviewIntervalDays(7)).toBe(1)
  })
  it('目标保留 30 天 → 间隔约 4-5 天', () => {
    expect(reviewIntervalDays(30)).toBe(5)
  })
  it('目标保留 90 天 → 间隔约 14 天', () => {
    expect(reviewIntervalDays(90)).toBe(14)
  })
  it('非法目标时间回落 1 天', () => {
    expect(reviewIntervalDays(0)).toBe(1)
    expect(reviewIntervalDays(-5)).toBe(1)
    expect(reviewIntervalDays(NaN)).toBe(1)
  })
})

describe('isReviewDue 到期判定', () => {
  it('从未提取不判到期', () => {
    const result = isReviewDue({ masteryScore: 0.8, retentionTargetDays: 7 })
    expect(result.due).toBe(false)
    expect(result.reason).toBe('never-seen')
  })

  it('保留率跌破阈值判到期（below-threshold）', () => {
    // 低初始强度 + 长时间 → 保留率低于 0.7
    const result = isReviewDue({ masteryScore: 0.5, lastSeenAt: at(3), retentionTargetDays: 30 })
    expect(result.due).toBe(true)
    expect(result.reason).toBe('below-threshold')
  })

  it('超过计划间隔判到期（interval-elapsed）', () => {
    // 高初始强度保留率仍在阈值上，但间隔已到（阈值 0.4 < 实际保留率 ~0.475）
    const result = isReviewDue({
      masteryScore: 0.95,
      lastSeenAt: at(3),
      retentionTargetDays: 7, // 间隔 1 天，已超
      retentionThreshold: 0.4,
    })
    expect(result.due).toBe(true)
    expect(result.reason).toBe('interval-elapsed')
  })

  it('未到期返回 not-due', () => {
    const result = isReviewDue({
      masteryScore: 0.95,
      lastSeenAt: at(0.5),
      retentionTargetDays: 30, // 间隔 5 天，未到
      retentionThreshold: 0.7,
    })
    expect(result.due).toBe(false)
    expect(result.reason).toBe('not-due')
  })

  it('自定义阈值生效', () => {
    const low = isReviewDue({
      masteryScore: 0.75,
      lastSeenAt: at(0.2),
      retentionTargetDays: 30,
      retentionThreshold: 0.9,
    })
    expect(low.due).toBe(true)
    expect(low.reason).toBe('below-threshold')
  })
})
