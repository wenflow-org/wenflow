import { csrfMiddleware } from '../csrf.middleware'

function createReq(overrides: Record<string, unknown> = {}) {
  return {
    method: 'POST',
    headers: {},
    ...overrides
  } as any
}

function createRes() {
  const res: any = { status: jest.fn(), json: jest.fn() }
  res.status.mockReturnValue(res)
  return res
}

describe('csrfMiddleware（CSRF 缺来源头拒绝）', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.CORS_ORIGIN = 'http://localhost:5173'
  })

  afterEach(() => {
    delete process.env.CORS_ORIGIN
  })

  it('带 Cookie 的写请求缺少 Origin/Referer 时拒绝（403 缺少请求来源信息）', () => {
    const req = createReq({ headers: { cookie: 'wenflow_admin_session=1' } })
    const res = createRes()
    const next = jest.fn()

    csrfMiddleware(req, res, next)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(next).not.toHaveBeenCalled()
  })

  it('无 Cookie 的服务端内部写请求跳过来源校验（黑盒仿真平台适配器自调用）', () => {
    const req = createReq({ headers: {} })
    const res = createRes()
    const next = jest.fn()

    csrfMiddleware(req, res, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(res.status).not.toHaveBeenCalled()
  })

  it('带 Cookie 且 Origin 允许的写请求放行', () => {
    const req = createReq({ headers: { cookie: 'wenflow_admin_session=1', origin: 'http://localhost:5173' } })
    const res = createRes()
    const next = jest.fn()

    csrfMiddleware(req, res, next)

    expect(next).toHaveBeenCalledTimes(1)
  })

  it('带 Cookie 且 Origin 不在白名单时拒绝（403 请求来源不被允许）', () => {
    const req = createReq({ headers: { cookie: 'wenflow_admin_session=1', origin: 'https://evil.example' } })
    const res = createRes()
    const next = jest.fn()

    csrfMiddleware(req, res, next)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(next).not.toHaveBeenCalled()
  })

  it('局域网同源（Origin 与 Host 一致）放行——2026-11-07 用户报的「请求来源不被允许」', () => {
    /* 换设备访问：页面从 http://192.168.66.42:5183 打开，Origin 就是它；
       白名单里只有 localhost 的端口，此前这里会被判 403。 */
    const req = createReq({
      headers: { cookie: 'wenflow_session=1', origin: 'http://192.168.66.42:5183', host: '192.168.66.42:5183' }
    })
    const res = createRes()
    const next = jest.fn()

    csrfMiddleware(req, res, next)

    expect(res.status).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('跨站 Origin 仍拒绝（同源放行不是白名单失效）', () => {
    const req = createReq({
      headers: { cookie: 'wenflow_session=1', origin: 'https://evil.example', host: '192.168.66.42:5183' }
    })
    const res = createRes()
    const next = jest.fn()

    csrfMiddleware(req, res, next)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(next).not.toHaveBeenCalled()
  })

  it('公网域名即使与 Host 一致也拒绝（防 DNS rebinding 绕过）', () => {
    const req = createReq({
      headers: { cookie: 'wenflow_session=1', origin: 'http://app.public.com', host: 'app.public.com' }
    })
    const res = createRes()
    const next = jest.fn()

    csrfMiddleware(req, res, next)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(next).not.toHaveBeenCalled()
  })

  it('同源 Referer（有些浏览器只发 Referer）同样放行', () => {
    const req = createReq({
      headers: { cookie: 'wenflow_session=1', referer: 'http://192.168.66.42:5183/login', host: '192.168.66.42:5183' }
    })
    const res = createRes()
    const next = jest.fn()

    csrfMiddleware(req, res, next)

    expect(res.status).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalledTimes(1)
  })
})
