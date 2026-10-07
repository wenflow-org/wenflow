// P2 管理员会话管理路由测试：列表过滤 / 强制下线 / 禁止下线自己 / revoke-all
export {}

type RouteHandler = (...args: any[]) => any

const routes: Record<string, RouteHandler[]> = {}
const sessionsFindMany = jest.fn()
const sessionsGroupBy = jest.fn()
const sessionsFindUnique = jest.fn()
const sessionsUpdate = jest.fn()
const sessionsUpdateMany = jest.fn()
const usersFindMany = jest.fn()

const mockRouter = () => ({
  get: (path: string, ...handlers: RouteHandler[]) => { routes[`GET ${path}`] = handlers },
  post: (path: string, ...handlers: RouteHandler[]) => { routes[`POST ${path}`] = handlers },
  delete: (path: string, ...handlers: RouteHandler[]) => { routes[`DELETE ${path}`] = handlers }
})

jest.mock('express', () => ({
  __esModule: true,
  default: { Router: mockRouter },
  Router: mockRouter
}))

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    users: { findMany: usersFindMany },
    admin_sessions: {
      findMany: sessionsFindMany,
      groupBy: sessionsGroupBy,
      findUnique: sessionsFindUnique,
      update: sessionsUpdate,
      updateMany: sessionsUpdateMany
    }
  }
}))

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() }
}))

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters'
import jwt from 'jsonwebtoken'
require('../admin/sessions')

function createResponse() {
  return {
    statusCode: 200,
    body: undefined as any,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: any) {
      this.body = payload
      return this
    }
  }
}

function adminReq(overrides: Record<string, unknown> = {}, jti?: string) {
  const req: any = {
    user: { userId: 'operator-1', email: 'op@example.com', isAdmin: true, sessionType: 'admin' },
    headers: {},
    body: {},
    query: {},
    params: {},
    ...overrides
  }
  if (jti) {
    req.headers.authorization = `Bearer ${jwt.sign(
      { userId: 'operator-1', isAdmin: true, jti },
      process.env.JWT_SECRET as string,
      { algorithm: 'HS256' }
    )}`
  }
  return req
}

async function run(method: string, path: string, req: any) {
  const res = createResponse()
  const handlers = routes[`${method} ${path}`]
  const next = jest.fn()
  await handlers[handlers.length - 1](req, res, next)
  return { res, next }
}

const baseSession = {
  id: 's-1',
  adminId: 'admin-1',
  jti: 'jti-1',
  ip: '127.0.0.1',
  userAgent: 'jest',
  remember: false,
  issuedAt: new Date(),
  expiresAt: new Date(Date.now() + 3600 * 1000),
  lastSeenAt: null,
  revokedAt: null,
  createdAt: new Date()
}

describe('GET /api/admin/sessions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    sessionsFindMany.mockResolvedValue([baseSession])
    sessionsGroupBy.mockResolvedValue([])
    usersFindMany.mockResolvedValue([{ id: 'admin-1', name: '管理员甲', email: 'admin@example.com' }])
  })

  it('无过滤条件时返回全部会话并附带 adminName/adminEmail', async () => {
    const { res } = await run('GET', '/', adminReq())

    expect(res.statusCode).toBe(200)
    expect(sessionsFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: {}, take: 100 }))
    expect(usersFindMany).toHaveBeenCalledWith({
      where: { id: { in: ['admin-1'] } },
      select: { id: true, name: true, email: true }
    })
    expect(res.body.data.sessions[0]).toEqual(expect.objectContaining({
      id: 's-1',
      adminName: '管理员甲',
      adminEmail: 'admin@example.com'
    }))
  })

  it('status=active 过滤：未吊销且未过期', async () => {
    await run('GET', '/', adminReq({ query: { status: 'active' } }))

    expect(sessionsFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { revokedAt: null, expiresAt: { gt: expect.any(Date) } }
    }))
  })

  it('status=revoked 过滤：已吊销', async () => {
    await run('GET', '/', adminReq({ query: { status: 'revoked' } }))

    expect(sessionsFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { revokedAt: { not: null } }
    }))
  })

  it('status=expired 过滤：未吊销但已过期', async () => {
    await run('GET', '/', adminReq({ query: { status: 'expired' } }))

    expect(sessionsFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { revokedAt: null, expiresAt: { lte: expect.any(Date) } }
    }))
  })

  it('adminId 过滤', async () => {
    await run('GET', '/', adminReq({ query: { adminId: 'admin-9' } }))

    expect(sessionsFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { adminId: 'admin-9' }
    }))
  })

  /* B13 F6-1：行窗口（limit）与全量统计口径分离——counts/adminCounts/window 恒按作用域全量，
     不受 limit 裁剪，供前端把「100 行窗口」与「真实全量」区分开。 */
  it('返回全量 counts + adminCounts + window（行窗口只约束 sessions）', async () => {
    sessionsFindMany.mockResolvedValue([baseSession])
    // 三次 groupBy 依次为 active / expired / revoked
    sessionsGroupBy
      .mockResolvedValueOnce([{ adminId: 'admin-1', _count: { _all: 467 } }])
      .mockResolvedValueOnce([{ adminId: 'admin-1', _count: { _all: 33 } }])
      .mockResolvedValueOnce([{ adminId: 'admin-1', _count: { _all: 5 } }])

    const { res } = await run('GET', '/', adminReq())

    expect(res.body.data.counts).toEqual({ total: 505, active: 467, expired: 33, revoked: 5 })
    expect(res.body.data.adminCounts).toEqual([
      { adminId: 'admin-1', total: 505, active: 467, expired: 33, revoked: 5 }
    ])
    expect(res.body.data.window).toEqual({ limit: 100, returned: 1 })
    // 统计查询不带 status 过滤（作用域全量），且不受 limit 影响
    expect(sessionsGroupBy).toHaveBeenCalledWith(expect.objectContaining({
      by: ['adminId'],
      where: { revokedAt: null, expiresAt: { gt: expect.any(Date) } }
    }))
  })

  it('adminId 作用域同时约束行与统计（统计不叠加 status 过滤）', async () => {
    await run('GET', '/', adminReq({ query: { adminId: 'admin-9', status: 'active' } }))

    expect(sessionsFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { adminId: 'admin-9', revokedAt: null, expiresAt: { gt: expect.any(Date) } }
    }))
    expect(sessionsGroupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: { adminId: 'admin-9', revokedAt: { not: null } }
    }))
  })
})

describe('DELETE /api/admin/sessions/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    sessionsFindUnique.mockResolvedValue({ ...baseSession, id: 's-1', jti: 'jti-other' })
    sessionsUpdate.mockResolvedValue({})
  })

  it('下线他人会话成功', async () => {
    const { res } = await run('DELETE', '/:id', adminReq({ params: { id: 's-1' } }, 'jti-operator'))

    expect(res.statusCode).toBe(200)
    expect(sessionsUpdate).toHaveBeenCalledWith({
      where: { id: 's-1' },
      data: { revokedAt: expect.any(Date) }
    })
    expect(res.body.data.message).toBe('会话已下线')
  })

  it('禁止下线自己的当前会话 → 409', async () => {
    sessionsFindUnique.mockResolvedValue({ ...baseSession, id: 's-1', jti: 'jti-operator' })
    const { res } = await run('DELETE', '/:id', adminReq({ params: { id: 's-1' } }, 'jti-operator'))

    expect(res.statusCode).toBe(409)
    expect(res.body.error.message).toBe('不能下线自己的当前会话')
    expect(sessionsUpdate).not.toHaveBeenCalled()
  })

  it('会话不存在 → 404', async () => {
    sessionsFindUnique.mockResolvedValue(null)
    const { res } = await run('DELETE', '/:id', adminReq({ params: { id: 'missing' } }, 'jti-operator'))

    expect(res.statusCode).toBe(404)
    expect(sessionsUpdate).not.toHaveBeenCalled()
  })
})

describe('POST /api/admin/sessions/revoke-all', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    sessionsUpdateMany.mockResolvedValue({ count: 3 })
  })

  it('按 adminId 批量吊销，excludeCurrent=true 时排除当前会话', async () => {
    const { res } = await run(
      'POST',
      '/revoke-all',
      adminReq({ body: { adminId: 'admin-1', excludeCurrent: true } }, 'jti-operator')
    )

    expect(res.statusCode).toBe(200)
    expect(sessionsUpdateMany).toHaveBeenCalledWith({
      where: { revokedAt: null, adminId: 'admin-1', jti: { not: 'jti-operator' } },
      data: { revokedAt: expect.any(Date) }
    })
    expect(res.body.data).toEqual({ count: 3 })
  })

  it('不带 adminId 时吊销全部管理员未吊销会话（当前会话除外）', async () => {
    const { res } = await run(
      'POST',
      '/revoke-all',
      adminReq({ body: { excludeCurrent: true } }, 'jti-operator')
    )

    expect(res.statusCode).toBe(200)
    expect(sessionsUpdateMany).toHaveBeenCalledWith({
      where: { revokedAt: null, jti: { not: 'jti-operator' } },
      data: { revokedAt: expect.any(Date) }
    })
    expect(res.body.data).toEqual({ count: 3 })
  })

  it('excludeCurrent 未开启时包含当前会话', async () => {
    await run('POST', '/revoke-all', adminReq({ body: { adminId: 'admin-1' } }, 'jti-operator'))

    expect(sessionsUpdateMany).toHaveBeenCalledWith({
      where: { revokedAt: null, adminId: 'admin-1' },
      data: { revokedAt: expect.any(Date) }
    })
  })
})
