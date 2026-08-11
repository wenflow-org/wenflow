export {}

process.env.JWT_SECRET = 'test-jwt-secret-with-at-least-thirty-two-characters'

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
  logger: { error: jest.fn() }
}))

import { adminAuthMiddleware, authMiddleware } from '../auth.middleware'
import { signSessionToken } from '../../utils/session-token'

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

function createRequest(token: string) {
  return {
    headers: { authorization: `Bearer ${token}` }
  } as any
}

describe('auth middleware session domains', () => {
  it('普通认证接受用户 Token 并建立用户会话上下文', async () => {
    const token = signSessionToken({ userId: 'user-1', email: 'user@example.com' }, 'user', '1h')
    const req = createRequest(token)
    const res = createResponse()
    const next = jest.fn()

    await authMiddleware(req, res as any, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(req.user).toEqual({
      userId: 'user-1',
      email: 'user@example.com',
      isAdmin: false,
      sessionType: 'user'
    })
  })

  it('普通认证拒绝 Admin Bearer Token', async () => {
    const token = signSessionToken({
      userId: 'admin-1',
      email: 'admin@example.com',
      isAdmin: true
    }, 'admin', '1h')
    const req = createRequest(token)
    const res = createResponse()
    const next = jest.fn()

    await authMiddleware(req, res as any, next)

    expect(res.statusCode).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('Admin 认证拒绝普通用户 Bearer Token', async () => {
    const token = signSessionToken({ userId: 'user-1', email: 'user@example.com' }, 'user', '1h')
    const req = createRequest(token)
    const res = createResponse()
    const next = jest.fn()

    await adminAuthMiddleware(req, res as any, next)

    expect(res.statusCode).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('外层 Admin 认证建立上下文后，旧子路由的重复普通认证保持幂等', async () => {
    const req: any = {
      headers: {},
      user: {
        userId: 'admin-1',
        email: 'admin@example.com',
        isAdmin: true,
        sessionType: 'admin'
      }
    }
    const res = createResponse()
    const next = jest.fn()

    await authMiddleware(req, res as any, next)

    expect(next).toHaveBeenCalledTimes(1)
  })
})
