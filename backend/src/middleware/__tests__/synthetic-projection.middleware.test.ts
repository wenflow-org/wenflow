import { enforceSyntheticProjectionAccess, getRequiredSyntheticCapability } from '../synthetic-projection.middleware'
import prisma from '../../config/database'

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: { virtual_sessions: { findUnique: jest.fn() } }
}))

function response() {
  const res: any = {
    statusCode: 200,
    body: null,
    status(code: number) { this.statusCode = code; return this },
    json(body: unknown) { this.body = body; return this }
  }
  return res
}

describe('synthetic projection access', () => {
  it('映射普通用户 API 到最小 capability', () => {
    expect(getRequiredSyntheticCapability('POST', '/api/goal-conversation/abc/reply')).toBe('goal:write')
    expect(getRequiredSyntheticCapability('GET', '/api/learning/paths/path-1')).toBe('path:read')
    expect(getRequiredSyntheticCapability('POST', '/api/learning/paths/path-1/replan')).toBeNull()
    expect(getRequiredSyntheticCapability('POST', '/api/ai-teaching/sessions/s1/messages')).toBe('teaching:write')
    expect(getRequiredSyntheticCapability('GET', '/api/admin/users')).toBeNull()
  })

  it('默认拒绝 synthetic token 访问未列入白名单的认证接口', async () => {
    const req: any = {
      method: 'GET',
      originalUrl: '/api/users/me',
      user: { projection: { grantSource: 'synthetic', capabilities: ['goal:write'] } }
    }
    const res = response()
    const next = jest.fn()

    await enforceSyntheticProjectionAccess(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(next).not.toHaveBeenCalled()
  })

  it('仅在 token 拥有所需 capability 且实验与资源匹配时放行', async () => {
    // eslint-disable-next-line no-extra-semi -- 行首分号是 ASI 保护
    ;(prisma.virtual_sessions.findUnique as jest.Mock).mockResolvedValue({
      id: 'vs1',
      userId: 'u1',
      virtualProfileId: 'p1',
      stageResults: JSON.stringify({
        experiment: { mode: 'blackbox-api', experimentId: 'exp1', runId: 'run1' },
        blackbox: { control: { conversationId: 'g1' } }
      })
    })
    const req: any = {
      method: 'POST',
      originalUrl: '/api/goal-conversation/g1/reply',
      user: { projection: {
        grantSource: 'synthetic',
        capabilities: ['goal:write'],
        virtualSessionId: 'vs1',
        targetUserId: 'u1',
        sourceProfileId: 'p1',
        experimentId: 'exp1',
        runId: 'run1'
      } }
    }
    const res = response()
    const next = jest.fn()

    await enforceSyntheticProjectionAccess(req, res, next)

    expect(next).toHaveBeenCalledTimes(1)
  })

  it('拒绝访问当前实验控制面之外的资源', async () => {
    // eslint-disable-next-line no-extra-semi -- 行首分号是 ASI 保护
    ;(prisma.virtual_sessions.findUnique as jest.Mock).mockResolvedValue({
      id: 'vs1',
      userId: 'u1',
      virtualProfileId: 'p1',
      stageResults: JSON.stringify({
        experiment: { mode: 'blackbox-api', experimentId: 'exp1', runId: 'run1' },
        blackbox: { control: { conversationId: 'g1' } }
      })
    })
    const req: any = {
      method: 'POST',
      originalUrl: '/api/goal-conversation/other/reply',
      user: { projection: {
        grantSource: 'synthetic', capabilities: ['goal:write'], virtualSessionId: 'vs1',
        targetUserId: 'u1', sourceProfileId: 'p1', experimentId: 'exp1', runId: 'run1'
      } }
    }
    const res = response()
    const next = jest.fn()

    await enforceSyntheticProjectionAccess(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(next).not.toHaveBeenCalled()
  })

  it('允许尚未创建 conversation 的 Goal start', async () => {
    // eslint-disable-next-line no-extra-semi -- 行首分号是 ASI 保护
    ;(prisma.virtual_sessions.findUnique as jest.Mock).mockResolvedValue({
      id: 'vs1',
      userId: 'u1',
      virtualProfileId: 'p1',
      stageResults: JSON.stringify({
        experiment: { mode: 'blackbox-api', experimentId: 'exp1', runId: 'run1' },
        blackbox: { control: {} }
      })
    })
    const req: any = {
      method: 'POST',
      originalUrl: '/api/goal-conversation/start',
      user: { projection: {
        grantSource: 'synthetic', capabilities: ['goal:write'], virtualSessionId: 'vs1',
        targetUserId: 'u1', sourceProfileId: 'p1', experimentId: 'exp1', runId: 'run1'
      } }
    }
    const res = response()
    const next = jest.fn()

    await enforceSyntheticProjectionAccess(req, res, next)

    expect(next).toHaveBeenCalledTimes(1)
  })
})
