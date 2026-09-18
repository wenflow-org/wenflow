import { reviewIntervalDays } from '../actr'

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
  it('intervalFactor 递增间隔（SM-2 式）', () => {
    expect(reviewIntervalDays(7, 1)).toBe(1)
    expect(reviewIntervalDays(7, 2)).toBe(2)
    expect(reviewIntervalDays(7, 4)).toBe(4)
    expect(reviewIntervalDays(30, 2)).toBe(9)
  })
  it('intervalFactor 计算侧 clamp 上限 32', () => {
    expect(reviewIntervalDays(7, 64)).toBe(34)
    expect(reviewIntervalDays(7, 32)).toBe(34)
    expect(reviewIntervalDays(7, 0.5)).toBe(1)
  })
})
