// P3 审计日志查询路由测试：scope 分表 / timeRange 组装 / keyword 搜索 / 分页 / stats 计数 / success 解析 / 参数校验
export {}

type RouteHandler = (...args: any[]) => any

const routes: Record<string, RouteHandler[]> = {}
const auditFindMany = jest.fn()
const auditCount = jest.fn()
const attemptsFindMany = jest.fn()
const attemptsCount = jest.fn()

const mockRouter = () => ({
  get: (path: string, ...handlers: RouteHandler[]) => { routes[`GET ${path}`] = handlers },
  post: () => {},
  put: () => {},
  patch: () => {},
  delete: () => {}
})

jest.mock('express', () => ({
  __esModule: true,
  default: { Router: mockRouter },
  Router: mockRouter
}))

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    admin_audit_logs: {
      findMany: auditFindMany,
      count: auditCount
    },
    login_attempts: {
      findMany: attemptsFindMany,
      count: attemptsCount
    }
  }
}))

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() }
}))

require('../admin/audit-logs')

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

function adminReq(query: Record<string, unknown> = {}) {
  return { query, headers: {}, body: {}, params: {} } as any
}

async function run(method: string, path: string, req: any) {
  const res = createResponse()
  const handlers = routes[`${method} ${path}`]
  const next = jest.fn()
  await handlers[handlers.length - 1](req, res, next)
  return { res, next }
}

const baseLog = {
  id: 'l-1',
  adminId: 'admin-1',
  adminName: 'admin@example.com',
  action: 'user-update',
  targetType: 'user',
  targetId: 'u-1',
  beforeJson: '{}',
  afterJson: '{"name":"甲"}',
  requestJson: null,
  method: 'PATCH',
  path: '/api/admin/users/u-1',
  statusCode: 200,
  success: true,
  ip: '127.0.0.1',
  userAgent: 'jest',
  durationMs: 12,
  createdAt: new Date()
}

const baseAttempt = {
  id: 'a-1',
  scope: 'admin',
  username: 'admin@example.com',
  ip: '127.0.0.1',
  success: false,
  reason: 'invalid_credentials',
  createdAt: new Date()
}

beforeEach(() => {
  jest.clearAllMocks()
  auditFindMany.mockResolvedValue([baseLog])
  auditCount.mockResolvedValue(1)
  attemptsFindMany.mockResolvedValue([baseAttempt])
  attemptsCount.mockResolvedValue(1)
})

describe('路由注册顺序', () => {
  it('/stats 先于 / 注册（Express 匹配顺序）', () => {
    expect(Object.keys(routes)).toEqual(['GET /stats', 'GET /'])
  })
})

describe('GET /api/admin/audit-logs（scope=operation 默认）', () => {
  it('默认查 admin_audit_logs，返回 logs + pagination', async () => {
    auditCount.mockResolvedValue(37)
    const { res, next } = await run('GET', '/', adminReq())

    expect(next).not.toHaveBeenCalled()
    expect(auditCount).toHaveBeenCalledWith({ where: {} })
    expect(auditFindMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 50
    })
    expect(attemptsFindMany).not.toHaveBeenCalled()
    expect(res.body).toEqual({
      success: true,
      data: {
        logs: [baseLog],
        pagination: { total: 37, page: 1, limit: 50 }
      }
    })
  })

  it('adminId/adminName/action/targetType 过滤（可空参数）', async () => {
    await run('GET', '/', adminReq({
      adminId: 'admin-1',
      adminName: 'admin@example.com',
      action: 'user-delete',
      targetType: 'user'
    }))

    expect(auditFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        adminId: 'admin-1',
        adminName: 'admin@example.com',
        action: 'user-delete',
        targetType: 'user'
      }
    }))
  })

  it('keyword 搜索 adminName/action/path/targetId/ip（不含 JSON 列）', async () => {
    await run('GET', '/', adminReq({ keyword: '张三' }))

    expect(auditFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        OR: [
          { adminName: { contains: '张三' } },
          { action: { contains: '张三' } },
          { path: { contains: '张三' } },
          { targetId: { contains: '张三' } },
          { ip: { contains: '张三' } }
        ]
      }
    }))
  })

  it('success=true/false 字符串解析为布尔', async () => {
    await run('GET', '/', adminReq({ success: 'true' }))
    expect(auditFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { success: true } }))

    await run('GET', '/', adminReq({ success: 'false' }))
    expect(auditFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { success: false } }))
  })

  it('非法 success 参数 → 400', async () => {
    const { res } = await run('GET', '/', adminReq({ success: 'yes' }))

    expect(res.statusCode).toBe(400)
    expect(res.body.error.message).toContain('非法 success 参数')
    expect(auditFindMany).not.toHaveBeenCalled()
  })

  it('分页：page=3&limit=100 → skip=200&take=100', async () => {
    await run('GET', '/', adminReq({ page: '3', limit: '100' }))

    expect(auditFindMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 200, take: 100 }))
  })

  it('limit 超过 200 → 400', async () => {
    const { res } = await run('GET', '/', adminReq({ limit: '201' }))

    expect(res.statusCode).toBe(400)
    expect(res.body.error.message).toContain('limit 最大 200')
  })

  it('page=0 → 400', async () => {
    const { res } = await run('GET', '/', adminReq({ page: '0' }))

    expect(res.statusCode).toBe(400)
    expect(res.body.error.message).toContain('非法 page 参数')
  })

  it('timeRange=today：本地时区当日 00:00 起点', async () => {
    await run('GET', '/', adminReq({ timeRange: 'today' }))

    const today = new Date()
    const expected = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    expect(auditFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { createdAt: { gte: expected } }
    }))
  })

  it('timeRange=yesterday：[昨日 00:00, 今日 00:00)', async () => {
    await run('GET', '/', adminReq({ timeRange: 'yesterday' }))

    const today = new Date()
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    const yesterdayStart = new Date(todayStart)
    yesterdayStart.setDate(yesterdayStart.getDate() - 1)
    expect(auditFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { createdAt: { gte: yesterdayStart, lt: todayStart } }
    }))
  })

  it('timeRange=all 与省略等价（无时间过滤）', async () => {
    await run('GET', '/', adminReq({ timeRange: 'all' }))
    expect(auditFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }))
  })

  it('非法 timeRange → 400', async () => {
    const { res } = await run('GET', '/', adminReq({ timeRange: 'last-year' }))

    expect(res.statusCode).toBe(400)
    expect(res.body.error.message).toContain('非法 timeRange 参数')
  })

  it('startTime/endTime 精确时间优先于 timeRange', async () => {
    await run('GET', '/', adminReq({
      timeRange: 'week',
      startTime: '2026-08-01T00:00:00.000Z',
      endTime: '2026-08-02T00:00:00.000Z'
    }))

    expect(auditFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        createdAt: {
          gte: new Date('2026-08-01T00:00:00.000Z'),
          lte: new Date('2026-08-02T00:00:00.000Z')
        }
      }
    }))
  })

  it('非法 startTime → 400', async () => {
    const { res } = await run('GET', '/', adminReq({ startTime: 'not-a-date' }))

    expect(res.statusCode).toBe(400)
    expect(res.body.error.message).toContain('非法 startTime 参数')
  })
})

describe('GET /api/admin/audit-logs（scope=login）', () => {
  it('查 login_attempts，loginScope 默认 admin，返回 attempts + pagination', async () => {
    attemptsCount.mockResolvedValue(9)
    const { res } = await run('GET', '/', adminReq({ scope: 'login' }))

    expect(auditFindMany).not.toHaveBeenCalled()
    expect(attemptsCount).toHaveBeenCalledWith({ where: { scope: 'admin' } })
    expect(attemptsFindMany).toHaveBeenCalledWith({
      where: { scope: 'admin' },
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 50
    })
    expect(res.body).toEqual({
      success: true,
      data: {
        attempts: [baseAttempt],
        pagination: { total: 9, page: 1, limit: 50 }
      }
    })
  })

  it('loginScope=user 过滤 scope 字段', async () => {
    await run('GET', '/', adminReq({ scope: 'login', loginScope: 'user' }))

    expect(attemptsFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { scope: 'user' }
    }))
  })

  it('keyword 搜索 username/ip', async () => {
    await run('GET', '/', adminReq({ scope: 'login', keyword: 'admin@' }))

    expect(attemptsFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        scope: 'admin',
        OR: [
          { username: { contains: 'admin@' } },
          { ip: { contains: 'admin@' } }
        ]
      }
    }))
  })

  it('success 过滤生效', async () => {
    await run('GET', '/', adminReq({ scope: 'login', success: 'false' }))

    expect(attemptsFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { scope: 'admin', success: false }
    }))
  })

  it('scope=login 时忽略 adminId/action 等操作维度参数', async () => {
    await run('GET', '/', adminReq({
      scope: 'login',
      adminId: 'admin-1',
      action: 'user-delete',
      targetType: 'user',
      adminName: 'x'
    }))

    expect(attemptsFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { scope: 'admin' }
    }))
  })
})

describe('GET /api/admin/audit-logs/stats', () => {
  it('返回 total 与 failed（failed=success=false 计数）', async () => {
    auditCount.mockResolvedValueOnce(42).mockResolvedValueOnce(7)
    const { res } = await run('GET', '/stats', adminReq())

    expect(auditCount).toHaveBeenCalledTimes(2)
    expect(auditCount).toHaveBeenNthCalledWith(1, { where: {} })
    expect(auditCount).toHaveBeenNthCalledWith(2, { where: { success: false } })
    expect(res.body).toEqual({
      success: true,
      data: { stats: { total: 42, failed: 7 } }
    })
  })

  it('同筛选参数生效（scope=login + keyword + success 沿用）', async () => {
    attemptsCount.mockResolvedValueOnce(5).mockResolvedValueOnce(2)
    await run('GET', '/stats', adminReq({ scope: 'login', keyword: '127.0.0.1' }))

    expect(attemptsCount).toHaveBeenNthCalledWith(1, {
      where: {
        scope: 'admin',
        OR: [{ username: { contains: '127.0.0.1' } }, { ip: { contains: '127.0.0.1' } }]
      }
    })
    expect(attemptsCount).toHaveBeenNthCalledWith(2, {
      where: {
        scope: 'admin',
        OR: [{ username: { contains: '127.0.0.1' } }, { ip: { contains: '127.0.0.1' } }],
        success: false
      }
    })
  })

  it('非法 timeRange → 400（stats 同校验）', async () => {
    const { res } = await run('GET', '/stats', adminReq({ timeRange: 'bad' }))

    expect(res.statusCode).toBe(400)
    expect(attemptsCount).not.toHaveBeenCalled()
    expect(auditCount).not.toHaveBeenCalled()
  })
})
