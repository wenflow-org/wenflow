/**
 * 回归：管理端执行日志 GET /agents/logs 默认排除「系统金丝雀」探针流量
 *
 * 背景：能力健康探针以 sourceEntry='system-canary' 走网关，超时中断会被记成
 * CALLER_ABORTED 的失败调用行；总览「待排查项」按 agentId 聚合失败 span，
 * 若不排除会把系统自检噪声当成业务故障。
 */

export {}

type RouteHandler = (...args: any[]) => any

const findMany = jest.fn()
const count = jest.fn()
const groupBy = jest.fn()

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    agent_call_logs: { findMany, count, groupBy },
    users: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
  },
}))
jest.mock('../../../config/system-database', () => ({
  __esModule: true,
  default: { $executeRawUnsafe: jest.fn().mockResolvedValue([]), $disconnect: jest.fn() },
}))
jest.mock('../../../middleware/auth.middleware', () => ({ authMiddleware: jest.fn() }))
jest.mock('../../../middleware/audit-context', () => ({
  setAuditAction: jest.fn(),
  setAuditBefore: jest.fn(),
  setAuditAfter: jest.fn(),
}))
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}))
jest.mock('../../../services/learning/goal-conversation.service', () => ({
  generateLearningPathFromConversation: jest.fn(),
}))

import platformRouter from '../platform'

function getRouteHandler(router: any, path: string, method: string): RouteHandler {
  const layer = router.stack.find(
    (item: any) => item.route?.path === path && item.route?.methods?.[method]
  )
  if (!layer) throw new Error(`Route not found: ${method.toUpperCase()} ${path}`)
  return layer.route.stack[layer.route.stack.length - 1].handle
}

function createResponse() {
  const res: any = { statusCode: 200, body: undefined }
  res.status = jest.fn((code: number) => {
    res.statusCode = code
    return res
  })
  res.json = (payload: any) => {
    res.body = payload
    return res
  }
  return res
}

async function run(handler: RouteHandler, req: any): Promise<any> {
  const res = createResponse()
  await handler(req, res, jest.fn())
  return res
}

// sourceEntry 为非空列（String @default("platform")），排除条件不能带 { sourceEntry: null }
const CANARY_EXCLUSION = { sourceEntry: { not: 'system-canary' } }

function hasCanaryExclusion(and: any[]): boolean {
  return (and || []).some((clause: any) => clause?.sourceEntry?.not === 'system-canary')
}

beforeEach(() => {
  jest.clearAllMocks()
  findMany.mockResolvedValue([])
  count.mockResolvedValue(0)
  groupBy.mockResolvedValue([])
})

describe('执行日志默认排除金丝雀探针（回归）', () => {
  it('未显式按 sourceEntry 筛选时，默认追加 system-canary 排除条件', async () => {
    const res = await run(getRouteHandler(platformRouter, '/agents/logs', 'get'), { query: {} })

    expect(res.statusCode).toBe(200)
    const where = findMany.mock.calls[0][0].where
    expect(where.AND).toEqual(expect.arrayContaining([CANARY_EXCLUSION]))
  })

  it('显式 sourceEntry=system-canary 时不追加排除，便于排查探针本身', async () => {
    const res = await run(getRouteHandler(platformRouter, '/agents/logs', 'get'), {
      query: { sourceEntry: 'system-canary' },
    })

    expect(res.statusCode).toBe(200)
    const where = findMany.mock.calls[0][0].where
    expect(where.sourceEntry).toBe('system-canary')
    expect(hasCanaryExclusion(where.AND)).toBe(false)
  })

  it('默认查询时 canary 计数与统计同源自一次 groupBy（2026-10-04 性能批：省第二趟全窗走查）', async () => {
    groupBy.mockResolvedValue([
      { sourceEntry: 'platform', success: true, _count: { _all: 10 } },
      { sourceEntry: 'platform', success: false, _count: { _all: 2 } },
      { sourceEntry: 'system-canary', success: true, _count: { _all: 3 } },
    ] as any)
    const res = await run(getRouteHandler(platformRouter, '/agents/logs', 'get'), {
      query: { timeRange: 'week', status: 'error' },
    })

    expect(res.statusCode).toBe(200)
    // 独立的 canary count 已退役：统计与 canary 由同一 groupBy 扫描派生
    expect(count).not.toHaveBeenCalled()
    expect(groupBy).toHaveBeenCalledTimes(1)
    const statsWhere = groupBy.mock.calls[0][0].where
    // 统计口径 where 不含 canary 排除子句（canary 行随扫描返回，JS 侧从主口径剔除）
    expect(hasCanaryExclusion(statsWhere.AND)).toBe(false)
    expect(statsWhere.calledAt).toBeDefined()
    expect(res.body.data.stats.canary).toBe(3)
    expect(res.body.data.stats.total).toBe(12)
  })

  it('显式 sourceEntry 筛选时不追加 canary 计数（stats.canary = 0）', async () => {
    const res = await run(getRouteHandler(platformRouter, '/agents/logs', 'get'), {
      query: { sourceEntry: 'system-canary' },
    })

    expect(res.statusCode).toBe(200)
    expect(count).not.toHaveBeenCalled()
    expect(res.body.data.stats.canary).toBe(0)
  })
})
