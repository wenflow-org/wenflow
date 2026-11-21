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
  logger: { error: jest.fn(), warn: jest.fn() }
}))

import { adminAuthMiddleware, authMiddleware, authWithProjectionGrant } from '../auth.middleware'
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

  it.each([
    ['GET', 'read-only', false, 403],
    ['GET', 'read-only', true, 200],
    ['POST', 'read-only', true, 403],
    ['DELETE', 'read-only', true, 403],
    ['POST', 'write-enabled', true, 200],
    ['POST', 'write-enabled', false, 403],
  ] as const)('%s 的 %s 授权（路由开放 %s）返回 %s', async (method, accessMode, enabled, status) => {
    const req: any = {
      headers: {}, method, path: '/test',
      user: { userId: 'user-1', projection: { active: true, grantSource: 'access-grant', scope: 'full', scopeDefinition: JSON.stringify({ accessMode }) } },
    }
    const res = createResponse()
    const next = jest.fn()
    const middleware = enabled ? authWithProjectionGrant() : authMiddleware
    await middleware(req, res as any, next)
    expect(res.statusCode).toBe(status)
    expect(next).toHaveBeenCalledTimes(status === 200 ? 1 : 0)
    if (status === 200) {
      await authMiddleware(req, res as any, next)
      expect(next).toHaveBeenCalledTimes(2)
    }
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
