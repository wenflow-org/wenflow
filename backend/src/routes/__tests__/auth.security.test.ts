export {}

type RouteHandler = (...args: any[]) => any

const routes: Record<string, RouteHandler[]> = {}
const login = jest.fn()
const register = jest.fn()
const recordLoginAttempt = jest.fn()
const loginRateLimitMiddleware = jest.fn((_req, _res, next) => next())
const getPlatformSettings = jest.fn()
const isCapabilityBlocked = jest.fn()

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
    register,
    verifyToken: jest.fn()
  },
  InvalidCredentialsError: MockInvalidCredentialsError
}))

jest.mock('../../middleware/login-rate-limit.middleware', () => ({
  loginRateLimitMiddleware,
  recordLoginAttempt
}))

jest.mock('../../services/platform-settings.service', () => ({
  getPlatformSettings
}))

jest.mock('../../services/ai-capability-health.service', () => ({
  aiCapabilityHealthService: {
    isCapabilityBlocked
  }
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
    getPlatformSettings.mockResolvedValue({ registrationEnabled: true })
    isCapabilityBlocked.mockReturnValue(false)
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
    expect(recordLoginAttempt).toHaveBeenCalledWith('alice', '127.0.0.1', false, 'user', 'invalid_credentials')
    expect(next).not.toHaveBeenCalled()
  })

  it('核心学习能力不可用时公开状态保留管理员设置并临时关闭注册', async () => {
    isCapabilityBlocked.mockReturnValue(true)
    const req: any = {}
    const res = createResponse()
    const next = jest.fn()

    await routes['GET /registration-status'][0](req, res, next)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({
      success: true,
      data: {
        registrationEnabled: false,
        configuredRegistrationEnabled: true,
        temporaryUnavailable: true
      }
    })
    expect(next).not.toHaveBeenCalled()
  })

  it('核心学习能力不可用时注册返回可重试的 503', async () => {
    isCapabilityBlocked.mockReturnValue(true)
    const req: any = { body: { name: 'alice', password: 'password1' } }
    const res = createResponse()
    const next = jest.fn()

    await routes['POST /register'][0](req, res, next)

    expect(res.statusCode).toBe(503)
    expect(res.body.error).toEqual({
      message: '核心学习服务正在恢复，暂时无法创建账号',
      code: 'REGISTRATION_TEMPORARILY_UNAVAILABLE',
      status: 503
    })
    expect(register).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
  })

  it('管理员关闭注册时返回 403，而不是 AI 临时故障', async () => {
    getPlatformSettings.mockResolvedValue({ registrationEnabled: false })
    isCapabilityBlocked.mockReturnValue(false)
    const req: any = { body: { name: 'alice', password: 'password1' } }
    const res = createResponse()
    const next = jest.fn()

    await routes['POST /register'][0](req, res, next)

    expect(res.statusCode).toBe(403)
    expect(res.body.error.code).toBe('REGISTRATION_DISABLED')
    expect(register).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
  })
})
