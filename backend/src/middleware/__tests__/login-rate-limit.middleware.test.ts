// M6 落库复核：mock 掉 prisma（count 恒 0 = DB 无锁定），本套件聚焦内存判定语义，
// 避免中间件的 DB 复核在测试环境触碰真实数据库
jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    login_attempts: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({})
    }
  }
}));

describe('loginRateLimitMiddleware', () => {
  const originalEnv = process.env.LOGIN_LOCK_DURATION_SECONDS
  const originalLegacyEnv = process.env.LOGIN_LOCK_DURATION
  const originalMaxAttempts = process.env.LOGIN_MAX_ATTEMPTS

  afterEach(() => {
    jest.resetModules()
    jest.useRealTimers()
    if (originalEnv === undefined) {
      delete process.env.LOGIN_LOCK_DURATION_SECONDS
    } else {
      process.env.LOGIN_LOCK_DURATION_SECONDS = originalEnv
    }
    if (originalLegacyEnv === undefined) {
      delete process.env.LOGIN_LOCK_DURATION
    } else {
      process.env.LOGIN_LOCK_DURATION = originalLegacyEnv
    }
    if (originalMaxAttempts === undefined) {
      delete process.env.LOGIN_MAX_ATTEMPTS
    } else {
      process.env.LOGIN_MAX_ATTEMPTS = originalMaxAttempts
    }
  })

  it('按秒配置锁定窗口，而不是把 900 当成毫秒', async () => {
    process.env.LOGIN_LOCK_DURATION_SECONDS = '900'
    jest.resetModules()
    const {
      loginRateLimitMiddleware,
      recordLoginAttempt,
      resetLoginAttemptsForTests
    } = require('../login-rate-limit.middleware')

    resetLoginAttemptsForTests()
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-07-17T00:00:00.000Z'))

    for (let i = 0; i < 5; i += 1) {
      recordLoginAttempt('alice', '127.0.0.1', false)
    }

    const req: any = { body: { name: 'alice' }, ip: '127.0.0.1', headers: {} }
    const res: any = {
      statusCode: 200,
      body: undefined,
      status(code: number) {
        this.statusCode = code
        return this
      },
      json(payload: unknown) {
        this.body = payload
        return this
      }
    }
    const next = jest.fn()

    await loginRateLimitMiddleware(req, res, next)
    expect(res.statusCode).toBe(429)
    expect(res.body.error.remainingTime).toBe(900)

    jest.advanceTimersByTime(899_000)
    const nextBeforeExpiry = jest.fn()
    await loginRateLimitMiddleware(req, res, nextBeforeExpiry)
    expect(nextBeforeExpiry).not.toHaveBeenCalled()

    jest.advanceTimersByTime(1_000)
    const nextAfterExpiry = jest.fn()
    await loginRateLimitMiddleware(req, res, nextAfterExpiry)
    expect(nextAfterExpiry).toHaveBeenCalledTimes(1)
  })

  it('兼容旧的 LOGIN_LOCK_DURATION 秒配置', () => {
    delete process.env.LOGIN_LOCK_DURATION_SECONDS
    process.env.LOGIN_LOCK_DURATION = '60'
    jest.resetModules()
    const {
      loginRateLimitMiddleware,
      recordLoginAttempt,
      resetLoginAttemptsForTests
    } = require('../login-rate-limit.middleware')

    resetLoginAttemptsForTests()
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-07-17T00:00:00.000Z'))
    for (let i = 0; i < 5; i += 1) {
      recordLoginAttempt('legacy-user', '127.0.0.1', false)
    }

    const req: any = { body: { name: 'legacy-user' }, ip: '127.0.0.1', headers: {} }
    const res: any = {
      statusCode: 200,
      status(code: number) {
        this.statusCode = code
        return this
      },
      json(payload: unknown) {
        this.body = payload
        return this
      }
    }

    loginRateLimitMiddleware(req, res, jest.fn())
    expect(res.statusCode).toBe(429)
    expect(res.body.error.remainingTime).toBe(60)
  })

  it('兼容旧启动脚本生成的 LOGIN_LOCK_DURATION 毫秒配置', () => {
    delete process.env.LOGIN_LOCK_DURATION_SECONDS
    process.env.LOGIN_LOCK_DURATION = '900000'
    jest.resetModules()
    const {
      loginRateLimitMiddleware,
      recordLoginAttempt,
      resetLoginAttemptsForTests
    } = require('../login-rate-limit.middleware')

    resetLoginAttemptsForTests()
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-07-17T00:00:00.000Z'))
    for (let i = 0; i < 5; i += 1) {
      recordLoginAttempt('legacy-ms-user', '127.0.0.1', false)
    }

    const req: any = { body: { name: 'legacy-ms-user' }, ip: '127.0.0.1', headers: {} }
    const res: any = {
      statusCode: 200,
      status(code: number) {
        this.statusCode = code
        return this
      },
      json(payload: unknown) {
        this.body = payload
        return this
      }
    }

    loginRateLimitMiddleware(req, res, jest.fn())
    expect(res.statusCode).toBe(429)
    expect(res.body.error.remainingTime).toBe(900)
  })

  it('成功登录后清除同一账号和来源的失败记录', async () => {
    const {
      loginRateLimitMiddleware,
      recordLoginAttempt,
      resetLoginAttemptsForTests
    } = require('../login-rate-limit.middleware')

    resetLoginAttemptsForTests()
    for (let i = 0; i < 5; i += 1) {
      recordLoginAttempt('recovered-user', '127.0.0.1', false)
    }
    recordLoginAttempt('recovered-user', '127.0.0.1', true)

    const req: any = { body: { name: 'recovered-user' }, ip: '127.0.0.1', headers: {} }
    const res: any = {
      status(code: number) {
        this.statusCode = code
        return this
      },
      json(payload: unknown) {
        this.body = payload
        return this
      }
    }
    const next = jest.fn()

    await loginRateLimitMiddleware(req, res, next)

    expect(next).toHaveBeenCalledTimes(1)
  })

  it('普通用户与 Admin 登录使用独立失败计数桶', async () => {
    const {
      adminLoginRateLimitMiddleware,
      loginRateLimitMiddleware,
      recordLoginAttempt,
      resetLoginAttemptsForTests
    } = require('../login-rate-limit.middleware')

    resetLoginAttemptsForTests()
    for (let i = 0; i < 5; i += 1) {
      recordLoginAttempt('shared-name', '127.0.0.1', false, 'user')
    }

    const req: any = { body: { name: 'shared-name' }, ip: '127.0.0.1', headers: {} }
    const userRes = createResponse()
    const adminRes = createResponse()
    const userNext = jest.fn()
    const adminNext = jest.fn()

    await loginRateLimitMiddleware(req, userRes, userNext)
    await adminLoginRateLimitMiddleware(req, adminRes, adminNext)

    expect(userRes.statusCode).toBe(429)
    expect(userNext).not.toHaveBeenCalled()
    expect(adminNext).toHaveBeenCalledTimes(1)
  })

  it('非法限流配置安全回退到默认值', () => {
    process.env.LOGIN_LOCK_DURATION_SECONDS = 'not-a-number'
    process.env.LOGIN_MAX_ATTEMPTS = 'invalid'
    jest.resetModules()
    const {
      loginRateLimitMiddleware,
      recordLoginAttempt,
      resetLoginAttemptsForTests
    } = require('../login-rate-limit.middleware')

    resetLoginAttemptsForTests()
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-07-17T00:00:00.000Z'))
    for (let i = 0; i < 5; i += 1) {
      recordLoginAttempt('fallback-user', '127.0.0.1', false)
    }

    const req: any = { body: { name: 'fallback-user' }, ip: '127.0.0.1', headers: {} }
    const res = createResponse()

    loginRateLimitMiddleware(req, res, jest.fn())

    expect(res.statusCode).toBe(429)
    expect(res.body.error.remainingTime).toBe(900)
  })
})

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
