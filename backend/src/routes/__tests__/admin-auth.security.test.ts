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

jest.mock('bcrypt', () => ({
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
})
