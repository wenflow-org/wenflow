export {}

type RouteHandler = (...args: any[]) => any

const routes: Record<string, RouteHandler[]> = {}
const usersFindFirst = jest.fn()
const bcryptCompare = jest.fn()
const jwtSign = jest.fn(() => 'admin-token')
const jwtVerify = jest.fn()
const sessionsCreate = jest.fn().mockResolvedValue({})
const sessionsUpdate = jest.fn().mockResolvedValue({})
const adminLoginRateLimitMiddleware = jest.fn((_req, _res, next) => next())
const recordLoginAttempt = jest.fn()

jest.mock('express', () => ({
  __esModule: true,
  default: {
    Router: () => ({
      post: (path: string, ...handlers: RouteHandler[]) => { routes[`POST ${path}`] = handlers },
      get: (path: string, ...handlers: RouteHandler[]) => { routes[`GET ${path}`] = handlers }
    })
  }
}))

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    users: {
      findFirst: usersFindFirst,
      findUnique: jest.fn()
    },
    admin_sessions: {
      create: sessionsCreate,
      update: sessionsUpdate
    }
  }
}))

jest.mock('bcryptjs', () => ({
  __esModule: true,
  default: { compare: bcryptCompare }
}))

jest.mock('jsonwebtoken', () => ({
  __esModule: true,
  default: { sign: jwtSign, verify: jwtVerify }
}))

jest.mock('../../middleware/login-rate-limit.middleware', () => ({
  adminLoginRateLimitMiddleware,
  recordLoginAttempt
}))

jest.mock('../../middleware/auth.middleware', () => ({ adminAuthMiddleware: jest.fn() }))
jest.mock('../../middleware/admin.middleware', () => ({ adminMiddleware: jest.fn() }))
jest.mock('../../utils/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn() } }))

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters'
require('../admin-auth')

function createResponse() {
  return {
    statusCode: 200,
    body: undefined as any,
    cookie: jest.fn(),
    clearCookie: jest.fn(),
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

async function runLogin(body: Record<string, unknown>) {
  const req: any = { body, ip: '127.0.0.1', headers: {} }
  const res = createResponse()
  const handlers = routes['POST /login']
  await handlers[handlers.length - 1](req, res)
  return res
}

describe('Admin 登录安全边界', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('挂载登录专用锁定中间件', () => {
    expect(routes['POST /login'][0]).toBe(adminLoginRateLimitMiddleware)
  })

  it.each([
    ['管理员不存在', null],
    ['密码错误', { id: 'admin-1', name: 'admin', email: 'admin@example.com', password: 'hash', isAdmin: true }]
  ])('%s 时返回相同的凭据错误', async (_caseName, admin) => {
    usersFindFirst.mockResolvedValue(admin)
    bcryptCompare.mockResolvedValue(false)

    const res = await runLogin({ name: 'admin', password: 'wrong-password' })

    expect(res.statusCode).toBe(401)
    expect(res.body).toEqual({
      success: false,
      error: {
        message: '用户名或密码错误',
        code: 'INVALID_CREDENTIALS',
        status: 401
      }
    })
    expect(bcryptCompare).toHaveBeenCalledTimes(1)
    expect(recordLoginAttempt).toHaveBeenCalledWith('admin', '127.0.0.1', false, 'admin')
  })

  it('软删管理员视为不存在：登录查询过滤 deletedAt: null', async () => {
    usersFindFirst.mockResolvedValue(null)
    bcryptCompare.mockResolvedValue(false)

    const res = await runLogin({ name: 'ghost-admin', password: 'whatever1' })

    expect(res.statusCode).toBe(401)
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS')
    expect(usersFindFirst).toHaveBeenCalledWith({
      where: {
        OR: [{ name: 'ghost-admin' }, { email: 'ghost-admin' }],
        isAdmin: true,
        deletedAt: null
      }
    })
    expect(recordLoginAttempt).toHaveBeenCalledWith('ghost-admin', '127.0.0.1', false, 'admin')
  })

  it('软删管理员即使密码正确也按普通凭据错误拒绝，不泄露删除状态', async () => {
    // 过滤语义：deletedAt 非空的账号不会命中查询，登录必然走凭据错误分支
    usersFindFirst.mockResolvedValue(null)
    bcryptCompare.mockResolvedValue(false)

    const res = await runLogin({ name: 'admin', password: 'correct-password' })

    expect(res.statusCode).toBe(401)
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS')
    expect(recordLoginAttempt).toHaveBeenCalledWith('admin', '127.0.0.1', false, 'admin')
  })

  it('登录成功时仅在 HttpOnly Cookie 中下发 token，响应不包含 token', async () => {
    usersFindFirst.mockResolvedValue({
      id: 'admin-1',
      name: 'admin',
      email: 'admin@example.com',
      password: 'hash',
      role: 'admin',
      isAdmin: true
    })
    bcryptCompare.mockResolvedValue(true)

    const res = await runLogin({ name: 'admin', password: 'correct-password', remember: false })

    expect(res.statusCode).toBe(200)
    expect(res.body.data).toEqual({
      user: {
        id: 'admin-1',
        name: 'admin',
        email: 'admin@example.com',
        role: 'admin',
        isAdmin: true
      }
    })
    expect(res.body.data).not.toHaveProperty('token')
    expect(JSON.stringify(res.body)).not.toContain('admin-token')
    expect(res.cookie).toHaveBeenCalledWith(
      'wenflow_admin_token',
      'admin-token',
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'strict',
        path: '/'
      })
    )
    expect(res.cookie.mock.calls[0][2]).not.toHaveProperty('maxAge')
  })

  it('登录成功时写入 admin_sessions 会话表（jti 关联 + remember/ip/userAgent）', async () => {
    usersFindFirst.mockResolvedValue({
      id: 'admin-1',
      name: 'admin',
      email: 'admin@example.com',
      password: 'hash',
      role: 'admin',
      isAdmin: true
    })
    bcryptCompare.mockResolvedValue(true)

    const req: any = {
      body: { name: 'admin', password: 'correct-password', remember: true },
      ip: '127.0.0.1',
      headers: { 'user-agent': 'jest-agent' }
    }
    const res = createResponse()
    const handlers = routes['POST /login']
    await handlers[handlers.length - 1](req, res)

    expect(res.statusCode).toBe(200)
    expect(sessionsCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        adminId: 'admin-1',
        jti: expect.any(String),
        ip: '127.0.0.1',
        userAgent: 'jest-agent',
        remember: true,
        issuedAt: expect.any(Date),
        expiresAt: expect.any(Date)
      })
    })
    const createdData = sessionsCreate.mock.calls[0][0].data
    expect(createdData.expiresAt.getTime() - createdData.issuedAt.getTime()).toBe(7 * 24 * 60 * 60 * 1000)
  })

  it('不记住登录（remember=false）时会话表写入 24h 有效期', async () => {
    usersFindFirst.mockResolvedValue({
      id: 'admin-1',
      name: 'admin',
      email: 'admin@example.com',
      password: 'hash',
      isAdmin: true
    })
    bcryptCompare.mockResolvedValue(true)

    const res = await runLogin({ name: 'admin', password: 'correct-password', remember: false })

    expect(res.statusCode).toBe(200)
    const createdData = sessionsCreate.mock.calls[0][0].data
    expect(createdData.remember).toBe(false)
    expect(createdData.expiresAt.getTime() - createdData.issuedAt.getTime()).toBe(24 * 60 * 60 * 1000)
  })

  it('会话表写入失败不阻塞登录（fail-open）', async () => {
    usersFindFirst.mockResolvedValue({
      id: 'admin-1',
      name: 'admin',
      email: 'admin@example.com',
      password: 'hash',
      isAdmin: true
    })
    bcryptCompare.mockResolvedValue(true)
    sessionsCreate.mockRejectedValueOnce(new Error('db down'))

    const res = await runLogin({ name: 'admin', password: 'correct-password', remember: false })

    expect(res.statusCode).toBe(200)
  })

  it('登出时按 Cookie 中 token 的 jti 撤销会话并清除 Cookie', async () => {
    jwtVerify.mockReturnValue({
      userId: 'admin-1',
      isAdmin: true,
      type: 'admin',
      jti: 'jti-logout-1'
    })

    const req: any = {
      cookies: { wenflow_admin_token: 'signed-token' },
      headers: {},
      body: {}
    }
    const res = createResponse()
    const handlers = routes['POST /logout']
    await handlers[handlers.length - 1](req, res)

    expect(sessionsUpdate).toHaveBeenCalledWith({
      where: { jti: 'jti-logout-1' },
      data: { revokedAt: expect.any(Date) }
    })
    expect(res.clearCookie).toHaveBeenCalledWith(
      'wenflow_admin_token',
      expect.objectContaining({ httpOnly: true, sameSite: 'strict', path: '/' })
    )
    expect(res.body).toEqual({ success: true, data: { message: '已退出登录' } })
  })

  it('登出时 Token 解析失败仍清除 Cookie（不阻塞退出）', async () => {
    jwtVerify.mockImplementation(() => { throw new Error('bad token') })

    const req: any = {
      cookies: { wenflow_admin_token: 'expired-token' },
      headers: {},
      body: {}
    }
    const res = createResponse()
    const handlers = routes['POST /logout']
    await handlers[handlers.length - 1](req, res)

    expect(sessionsUpdate).not.toHaveBeenCalled()
    expect(res.clearCookie).toHaveBeenCalledWith('wenflow_admin_token', expect.any(Object))
    expect(res.statusCode).toBe(200)
  })
})
