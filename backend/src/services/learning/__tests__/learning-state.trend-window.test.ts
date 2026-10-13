const mockPrisma = {
  users: { findUnique: jest.fn() },
  learning_metrics: { findMany: jest.fn() }
}

jest.mock('../../../config/database', () => ({ __esModule: true, default: mockPrisma }))
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}))

import { LearningStateService, type LearningStateMetrics } from '../learning-state.service'

function metric(iso: string, base = 5) {
  return { lss: base, ktl: base, lf: base, lsb: 1, timestamp: new Date(iso) }
}

// endDate 是「本地日界」的 UTC ISO，跨时区直接 slice 会差一天 → 统一按本地日历读。
function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// 跨日模拟回归：admin 证据接口无模拟钟上下文（today=真实今天），
// 已记录的模拟日（metric.timestamp 落在真实今天之后）不得被窗口循环裁掉。
describe('LearningStateService getStateTrendWindow 模拟未来日上界', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-10-13T09:00:00'))
    mockPrisma.users.findUnique.mockResolvedValue({ createdAt: new Date('2026-10-12T00:00:00') })
  })
  afterEach(() => jest.useRealTimers())

  it('窗口上界跟随最新模拟日：真实今天之后的模拟指标不被裁掉', async () => {
    const service = new LearningStateService()
    jest.spyOn(service, 'getTrendsSince').mockResolvedValue([
      metric('2026-10-13T12:00:00'),
      metric('2026-11-02T12:00:00', 6)
    ] as unknown as LearningStateMetrics[])
    jest.spyOn(service, 'getCurrentState').mockResolvedValue(null)
    jest.spyOn(service, 'getLatestCommittedMetricBefore').mockResolvedValue(null)

    const win = await service.getStateTrendWindow('u', { days: 90, mode: 'recent' })
    const last = win.trends[win.trends.length - 1]

    // 曲线走到模拟末日（11-02），而非停在真实今天（10-13）
    expect(localDay(last.date)).toBe('2026-11-02')
    expect(win.trends.length).toBeGreaterThan(3)
    expect(localDay(new Date(win.range.endDate))).toBe('2026-11-02')
  })

  it('无模拟未来指标时窗口仍以真实今天为上界（真实用户零变化）', async () => {
    const service = new LearningStateService()
    jest.spyOn(service, 'getTrendsSince').mockResolvedValue([metric('2026-10-13T12:00:00')] as unknown as LearningStateMetrics[])
    jest.spyOn(service, 'getCurrentState').mockResolvedValue(null)
    jest.spyOn(service, 'getLatestCommittedMetricBefore').mockResolvedValue(null)

    const win = await service.getStateTrendWindow('u', { days: 90, mode: 'recent' })
    const last = win.trends[win.trends.length - 1]

    expect(localDay(last.date)).toBe('2026-10-13')
    expect(localDay(new Date(win.range.endDate))).toBe('2026-10-13')
  })
})
