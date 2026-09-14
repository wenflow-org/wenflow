/**
 * 站内通知 / 成就解锁记录：服务端排序（白名单 + 方向 + createdAt/earnedAt 稳定次级键）。
 */

export {}

type RouteHandler = (...args: any[]) => any

const notifFindMany = jest.fn()
const notifCount = jest.fn()
const achFindMany = jest.fn()
const achCount = jest.fn()

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    users: { findUnique: jest.fn(async () => ({ isAdmin: true })) },
    notifications: { findMany: notifFindMany, count: notifCount },
    achievements: { findMany: achFindMany, count: achCount },
  },
}))
jest.mock('../../../middleware/auth.middleware', () => ({ authMiddleware: jest.fn() }))
jest.mock('../../../middleware/audit-context', () => ({
  setAuditAction: jest.fn(),
  setAuditBefore: jest.fn(),
  setAuditAfter: jest.fn(),
}))
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}))
jest.mock('../../../services/achievements/achievement-system', () => ({ ACHIEVEMENTS: [] }))
jest.mock('../../../services/achievements/achievement.service', () => ({
  __esModule: true,
  default: { addXp: jest.fn(), checkAndUnlockAchievements: jest.fn() },
}))

import notificationsRouter from '../notifications'
import achievementsRouter from '../achievements'

function getRouteHandler(router: any, path: string, method: string): RouteHandler {
  const layer = router.stack.find(
    (item: any) => item.route?.path === path && item.route?.methods?.[method]
  )
  if (!layer) throw new Error(`Route not found: ${method.toUpperCase()} ${path}`)
  return layer.route.stack[layer.route.stack.length - 1].handle
}

function createResponse() {
  const res: any = { statusCode: 200, body: undefined }
  res.status = jest.fn((code: number) => {
    res.statusCode = code
    return res
  })
  res.json = (payload: any) => {
    res.body = payload
    return res
  }
  return res
}

async function run(handler: RouteHandler, req: any): Promise<any> {
  const res = createResponse()
  await handler(req, res, jest.fn())
  return res
}

const adminReq = () => ({ query: {} as Record<string, unknown>, user: { userId: 'admin-1' }, headers: {}, body: {}, params: {} })

beforeEach(() => {
  jest.clearAllMocks()
  notifFindMany.mockResolvedValue([])
  notifCount.mockResolvedValue(0)
  achFindMany.mockResolvedValue([])
  achCount.mockResolvedValue(0)
})

describe('站内通知列表（服务端排序）', () => {
  it('默认：createdAt 倒序 + id 稳定次级键', async () => {
    const res = await run(getRouteHandler(notificationsRouter, '/', 'get'), adminReq())
    expect(res.statusCode).toBe(200)
    expect(notifFindMany.mock.calls[0][0].orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }])
  })

  it('sort=isRead&order=asc：未读优先，createdAt 倒序 + id 兜底', async () => {
    const r = adminReq()
    r.query = { sort: 'isRead', order: 'asc' }
    await run(getRouteHandler(notificationsRouter, '/', 'get'), r)
    expect(notifFindMany.mock.calls[0][0].orderBy).toEqual([
      { isRead: 'asc' },
      { createdAt: 'desc' },
      { id: 'desc' },
    ])
  })

  it('非法 sort → 400 且不查库', async () => {
    const r = adminReq()
    r.query = { sort: 'password' }
    const res = await run(getRouteHandler(notificationsRouter, '/', 'get'), r)
    expect(res.statusCode).toBe(400)
    expect(notifFindMany).not.toHaveBeenCalled()
  })
})

describe('成就解锁记录（服务端排序）', () => {
  it('默认：earnedAt 倒序 + id 稳定次级键', async () => {
    await run(getRouteHandler(achievementsRouter, '/records', 'get'), adminReq())
    expect(achFindMany.mock.calls[0][0].orderBy).toEqual([{ earnedAt: 'desc' }, { id: 'desc' }])
  })

  it('sort=xpReward&order=asc：按 XP 升序，earnedAt 倒序 + id 兜底', async () => {
    const r = adminReq()
    r.query = { sort: 'xpReward', order: 'asc' }
    await run(getRouteHandler(achievementsRouter, '/records', 'get'), r)
    expect(achFindMany.mock.calls[0][0].orderBy).toEqual([
      { xpReward: 'asc' },
      { earnedAt: 'desc' },
      { id: 'desc' },
    ])
  })

  it('非法 order → 400 且不查库', async () => {
    const r = adminReq()
    r.query = { order: 'sideways' }
    const res = await run(getRouteHandler(achievementsRouter, '/records', 'get'), r)
    expect(res.statusCode).toBe(400)
    expect(achFindMany).not.toHaveBeenCalled()
  })
})
