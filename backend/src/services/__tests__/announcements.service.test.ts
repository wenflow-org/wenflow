/**
 * 公告受众过滤（2026-11-26 全站 UI 走查 LD-07 / LS-08 / LM-14）：
 * 此前 announcements 没有受众维度，运维巡检公告（「夜间体检」）会原样出现在
 * 学习者顶部横幅。学习者端查询必须在数据层就把 audience='admin' 滤掉——
 * 不能指望前端按字段隐藏（响应里本来就不该有这条）。
 */
const mockFindMany = jest.fn()

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: { announcements: { findMany: (...args: unknown[]) => mockFindMany(...args) } },
}))

import { listActiveAnnouncements } from '../announcements.service'

describe('listActiveAnnouncements（受众过滤）', () => {
  beforeEach(() => mockFindMany.mockReset())

  it('学习者端只查 all / learner 两档', async () => {
    mockFindMany.mockResolvedValue([])
    const now = new Date('2026-11-26T12:00:00Z')
    await listActiveAnnouncements(3, now)
    const where = mockFindMany.mock.calls[0][0].where
    expect(where.status).toBe('published')
    expect(where.audience).toEqual({ in: ['all', 'learner'] })
    // 过期过滤不被受众条件挤掉
    expect(where.OR).toEqual([{ expiresAt: null }, { expiresAt: { gt: now } }])
  })

  it('仍按发布时间倒序并受 limit 约束', async () => {
    mockFindMany.mockResolvedValue([])
    await listActiveAnnouncements(2)
    const args = mockFindMany.mock.calls[0][0]
    expect(args.orderBy).toEqual({ publishedAt: 'desc' })
    expect(args.take).toBe(2)
  })
})
