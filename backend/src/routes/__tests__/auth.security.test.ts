export {}

type RouteHandler = (...args: any[]) => any

const routes: Record<string, RouteHandler[]> = {}
const login = jest.fn()
const recordLoginAttempt = jest.fn()
const loginRateLimitMiddleware = jest.fn((_req, _res, next) => next())

class MockInvalidCredentialsError extends Error {
  readonly status = 401
  readonly code = 'INVALID_CREDENTIALS'

  constructor() {
    super('用户名或密码错误')
    this.name = 'InvalidCredentialsError'
  }
}

jest.mock('express', () => ({
  __esModule: true,
  default: {
    Router: () => ({
      post: (path: string, ...handlers: RouteHandler[]) => { routes[`POST ${path}`] = handlers },
      get: (path: string, ...handlers: RouteHandler[]) => { routes[`GET ${path}`] = handlers }
    })
  }
}))

jest.mock('../../services/auth/auth.service', () => ({
  __esModule: true,
  default: {
    login,
    register: jest.fn(),
    verifyToken: jest.fn()
  },
  InvalidCredentialsError: MockInvalidCredentialsError
}))

jest.mock('../../middleware/login-rate-limit.middleware', () => ({
  loginRateLimitMiddleware,
  recordLoginAttempt
}))

jest.mock('../../services/platform-settings.service', () => ({
  getPlatformSettings: jest.fn()
}))

require('../auth')

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

describe('普通登录路由安全边界', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('无效凭据直接返回统一 401，而不是进入全局 500 错误处理', async () => {
    login.mockRejectedValue(new MockInvalidCredentialsError())
    const req: any = {
      body: { name: 'alice', password: 'wrong-password' },
      ip: '127.0.0.1',
      headers: {}
    }
    const res = createResponse()
    const next = jest.fn()
    const handlers = routes['POST /login']

    await handlers[handlers.length - 1](req, res, next)

    expect(res.statusCode).toBe(401)
    expect(res.body).toEqual({
      success: false,
      error: {
        message: '用户名或密码错误',
        code: 'INVALID_CREDENTIALS',
        status: 401
      }
    })
    expect(recordLoginAttempt).toHaveBeenCalledWith('alice', '127.0.0.1', false)
    expect(next).not.toHaveBeenCalled()
  })
})
