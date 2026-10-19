/* eslint-disable @typescript-eslint/no-explicit-any -- 路由桩：handler/res 外观无类型导出 */
// /auth/refresh 路由并发语义（#116 方案 A）：
// concurrent → 200 且不清/不覆盖 Cookie（赢家 Cookie 保留）；reuse/unknown → 401 且清 Cookie
export {}

type RouteHandler = (...args: any[]) => any

const routes: Record<string, RouteHandler[]> = {}

process.env.JWT_SECRET = 'test-jwt-secret-with-at-least-thirty-two-characters'

const mockFindRefreshSessionUser = jest.fn()
const mockGenerateTokenPair = jest.fn()
const mockRotateUserSession = jest.fn()

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
    login: jest.fn(),
    register: jest.fn(),
    verifyToken: jest.fn(),
    findRefreshSessionUser: (...args: unknown[]) => mockFindRefreshSessionUser(...args),
    generateTokenPair: (...args: unknown[]) => mockGenerateTokenPair(...args)
  },
  InvalidCredentialsError: class InvalidCredentialsError extends Error {},
  ResetTokenInvalidError: class ResetTokenInvalidError extends Error {},
  UsernameTakenError: class UsernameTakenError extends Error {}
}))

jest.mock('../../services/auth/user-session.service', () => ({
  __esModule: true,
  rotateUserSession: (...args: unknown[]) => mockRotateUserSession(...args),
  revokeUserSessionByToken: jest.fn()
}))

jest.mock('../../middleware/login-rate-limit.middleware', () => ({
  loginRateLimitMiddleware: jest.fn((_req: unknown, _res: unknown, next: () => void) => next()),
  recordLoginAttempt: jest.fn()
}))

jest.mock('../../services/platform-settings.service', () => ({
  getPlatformSettings: jest.fn()
}))

jest.mock('../../services/ai-capability-health.service', () => ({
  aiCapabilityHealthService: { isCapabilityBlocked: jest.fn() }
}))

jest.mock('../../services/auth/register-quota.service', () => ({
  registerQuotaService: {
    assertWithinDailyQuota: jest.fn(),
    recordSuccessfulRegistration: jest.fn()
  },
  resolveIpDailyQuota: jest.fn(() => 5),
  IpRegisterQuotaExceededError: class IpRegisterQuotaExceededError extends Error {},
  DEFAULT_IP_DAILY_QUOTA: 5
}))

require('../auth')

import { signRefreshToken } from '../../utils/session-token'

const USER_REFRESH_COOKIE = 'wenflow_refresh_token'

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

function createRequest() {
  return {
    cookies: { [USER_REFRESH_COOKIE]: signRefreshToken('user-1', 0) },
    headers: {}
  } as any
}

const callRefresh = async () => {
  const handlers = routes['POST /refresh']
  const req = createRequest()
  const res = createResponse()
  const next = jest.fn()
  await handlers[handlers.length - 1](req, res, next)
  return { req, res, next }
}

describe('/auth/refresh 并发语义（#116 方案 A）', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFindRefreshSessionUser.mockResolvedValue({
      id: 'user-1',
      name: 'alice',
      tokenVersion: 0,
      deletedAt: null
    })
    mockGenerateTokenPair.mockReturnValue({
      accessToken: 'access-token-new',
      refreshToken: 'refresh-token-new'
    })
  })

  it('rotated：200 并写入新 Cookie', async () => {
    mockRotateUserSession.mockResolvedValue('rotated')

    const { res, next } = await callRefresh()

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ success: true, data: { message: '令牌已刷新' } })
    expect(res.cookie).toHaveBeenCalledTimes(2)
    expect(res.clearCookie).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
  })

  it('concurrent：容忍窗内上一代令牌 → 200 且既不设置也不清除 Cookie', async () => {
    mockRotateUserSession.mockResolvedValue('concurrent')

    const { res, next } = await callRefresh()

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ success: true, data: { message: '令牌已刷新' } })
    // 关键：不覆盖（本请求签发的未登记 token 写入会让下次刷新 fail-closed）
    expect(res.cookie).not.toHaveBeenCalled()
    // 也不清除（清除会抹掉并发赢家刚写入的新 Cookie）
    expect(res.clearCookie).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
  })

  it('reuse-detected：仍 401 并清 Cookie（严格吊销路径不变）', async () => {
    mockRotateUserSession.mockResolvedValue('reuse-detected')

    const { res } = await callRefresh()

    expect(res.statusCode).toBe(401)
    expect(res.body.error.message).toBe('检测到会话异常，请重新登录')
    expect(res.clearCookie).toHaveBeenCalledTimes(2)
    expect(res.cookie).not.toHaveBeenCalled()
  })

  it('unknown-token：仍 401 并清 Cookie（严格拒绝路径不变）', async () => {
    mockRotateUserSession.mockResolvedValue('unknown-token')

    const { res } = await callRefresh()

    expect(res.statusCode).toBe(401)
    expect(res.body.error.message).toBe('会话已失效，请重新登录')
    expect(res.clearCookie).toHaveBeenCalledTimes(2)
    expect(res.cookie).not.toHaveBeenCalled()
  })
})
