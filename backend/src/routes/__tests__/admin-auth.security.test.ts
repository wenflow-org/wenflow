export {}

type RouteHandler = (...args: any[]) => any

const routes: Record<string, RouteHandler[]> = {}
const usersFindFirst = jest.fn()
const bcryptCompare = jest.fn()
const jwtSign = jest.fn(() => 'admin-token')
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
    }
  }
}))

jest.mock('bcryptjs', () => ({
  __esModule: true,
  default: { compare: bcryptCompare }
}))

jest.mock('jsonwebtoken', () => ({
  __esModule: true,
  default: { sign: jwtSign }
}))

jest.mock('../../middleware/login-rate-limit.middleware', () => ({
  adminLoginRateLimitMiddleware,
  recordLoginAttempt
}))

jest.mock('../../middleware/auth.middleware', () => ({ adminAuthMiddleware: jest.fn() }))
jest.mock('../../middleware/admin.middleware', () => ({ adminMiddleware: jest.fn() }))
jest.mock('../../utils/logger', () => ({ logger: { error: jest.fn() } }))

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters'
require('../admin-auth')

function createResponse() {
  return {
    statusCode: 200,
    body: undefined as any,
    cookie: jest.fn(),
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
})
