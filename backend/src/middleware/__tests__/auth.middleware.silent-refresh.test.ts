/* eslint-disable @typescript-eslint/no-explicit-any -- 测试桩：Express req/res 外观无类型导出 */
// auth.middleware 静默刷新并发语义（#116 方案 A）：
// rotated → 写新 Cookie；concurrent → 不清/不覆盖 Cookie 继续；reuse-detected → 401 拒绝
export {}

process.env.JWT_SECRET = 'test-jwt-secret-with-at-least-thirty-two-characters'

const mockRotateUserSession = jest.fn()

jest.mock('../../services/auth/user-session.service', () => ({
  __esModule: true,
  rotateUserSession: (...args: unknown[]) => mockRotateUserSession(...args)
}))

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    users: {
      findUnique: jest.fn(async () => ({ deletedAt: null, tokenVersion: 0 }))
    },
    projection_access_grants: {
      findUnique: jest.fn(),
      update: jest.fn()
    }
  }
}))

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}))

import { authMiddleware } from '../auth.middleware'
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

/** 模拟「access token 已过期、带 refresh Cookie」的请求（走静默刷新路径） */
function createRefreshRequest() {
  return {
    headers: {},
    cookies: { [USER_REFRESH_COOKIE]: signRefreshToken('user-1', 0) }
  } as any
}

describe('auth.middleware 静默刷新并发语义（#116 方案 A）', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('rotated：轮换成功 → 写入新 access/refresh Cookie 并继续', async () => {
    mockRotateUserSession.mockResolvedValue('rotated')
    const req = createRefreshRequest()
    const res = createResponse()
    const next = jest.fn()

    await authMiddleware(req, res as any, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(res.cookie).toHaveBeenCalledTimes(2)
    expect(res.statusCode).toBe(200)
    expect(req.user.userId).toBe('user-1')
  })

  it('concurrent：容忍窗内上一代令牌（并发落败方）→ 不清/不覆盖 Cookie，以现有会话继续', async () => {
    mockRotateUserSession.mockResolvedValue('concurrent')
    const req = createRefreshRequest()
    const res = createResponse()
    const next = jest.fn()

    await authMiddleware(req, res as any, next)

    // 不覆盖赢家的新 Cookie、也不清 Cookie
    expect(res.cookie).not.toHaveBeenCalled()
    expect(res.clearCookie).not.toHaveBeenCalled()
    // 请求继续：不得 401
    expect(next).toHaveBeenCalledTimes(1)
    expect(res.statusCode).toBe(200)
    expect(req.user).toEqual({
      userId: 'user-1',
      email: '',
      isAdmin: false,
      sessionType: 'user'
    })
  })

  it('reuse-detected：重放被拒 → 401 且不放行', async () => {
    mockRotateUserSession.mockResolvedValue('reuse-detected')
    const req = createRefreshRequest()
    const res = createResponse()
    const next = jest.fn()

    await authMiddleware(req, res as any, next)

    expect(res.statusCode).toBe(401)
    expect(next).not.toHaveBeenCalled()
    expect(res.cookie).not.toHaveBeenCalled()
  })

  it('unknown-token：未登记令牌 → 401 且不放行', async () => {
    mockRotateUserSession.mockResolvedValue('unknown-token')
    const req = createRefreshRequest()
    const res = createResponse()
    const next = jest.fn()

    await authMiddleware(req, res as any, next)

    expect(res.statusCode).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })
})
