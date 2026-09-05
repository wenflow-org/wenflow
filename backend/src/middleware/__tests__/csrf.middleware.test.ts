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
})
