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

const CANARY_EXCLUSION = { OR: [{ sourceEntry: null }, { sourceEntry: { not: 'system-canary' } }] }

function hasCanaryExclusion(and: any[]): boolean {
  return (and || []).some(
    (clause: any) =>
      clause?.OR?.some?.((item: any) => item?.sourceEntry?.not === 'system-canary')
  )
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
})
