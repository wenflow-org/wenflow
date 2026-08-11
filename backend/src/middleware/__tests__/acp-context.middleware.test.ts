import { getRequestContext } from '../../gateway/api-gateway/context'
import { acpContextMiddleware } from '../acp-context.middleware'

function runMiddleware(user: Record<string, unknown>) {
  let captured: ReturnType<typeof getRequestContext> | undefined
  const req: any = { headers: {}, user }
  const res: any = { setHeader: jest.fn() }

  acpContextMiddleware('admin')(req, res, () => {
    captured = getRequestContext()
  })
  return captured
}

describe('acpContextMiddleware userRole', () => {
  it('从已认证 Admin 会话派生管理员角色', () => {
    expect(runMiddleware({
      userId: 'admin-1',
      isAdmin: true,
      sessionType: 'admin'
    })).toEqual(expect.objectContaining({
      userId: 'admin-1',
      userRole: 'admin',
      sourceEntry: 'admin',
      abortSignal: expect.any(AbortSignal)
    }))
  })

  it('普通用户不能通过来源 Header 伪造 sourceEntry（固定为会话默认来源）', () => {
    let captured: ReturnType<typeof getRequestContext> | undefined
    const req: any = {
      headers: { 'x-source-entry': 'admin' },
      user: { userId: 'user-1', isAdmin: false, sessionType: 'user' }
    }
    const res: any = { setHeader: jest.fn() }

    acpContextMiddleware('user')(req, res, () => {
      captured = getRequestContext()
    })

    expect(captured).toEqual(expect.objectContaining({
      sourceEntry: 'user',
      userRole: 'user'
    }))
  })

  it('管理员会话可通过来源 Header 覆盖 sourceEntry（测试站点等受控场景）', () => {
    let captured: ReturnType<typeof getRequestContext> | undefined
    const req: any = {
      headers: { 'x-source-entry': 'test' },
      user: { userId: 'admin-1', isAdmin: true, sessionType: 'admin' }
    }
    const res: any = { setHeader: jest.fn() }

    acpContextMiddleware('admin')(req, res, () => {
      captured = getRequestContext()
    })

    expect(captured).toEqual(expect.objectContaining({
      sourceEntry: 'test',
      userRole: 'admin'
    }))
  })

  it('把语言和时区请求头放入 Context Envelope locale', () => {
    let captured: ReturnType<typeof getRequestContext> | undefined
    const req: any = {
      headers: {
        'accept-language': 'zh-CN,zh;q=0.9',
        'x-time-zone': 'Asia/Shanghai'
      },
      user: { userId: 'user-1', isAdmin: false, sessionType: 'user' }
    }
    const res: any = { setHeader: jest.fn() }

    acpContextMiddleware('user')(req, res, () => {
      captured = getRequestContext()
    })

    expect(captured).toEqual(expect.objectContaining({
      locale: { language: 'zh-CN', timeZone: 'Asia/Shanghai' },
      contextEnvelope: {
        schemaVersion: 'context-envelope/v1',
        locale: { language: 'zh-CN', timeZone: 'Asia/Shanghai' }
      }
    }))
  })
})
