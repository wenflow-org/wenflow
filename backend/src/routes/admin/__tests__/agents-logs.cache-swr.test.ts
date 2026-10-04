/**
 * 回归：管理端执行日志进程内缓存的读路径语义（2026-10-04 性能批四段）
 *
 * 背景：夜批写入持续冲刷页缓存使「页热」不可靠，统计/行都改走进程内缓存；
 * 但若请求在 TTL 过期后撞上重算（夜批争抢下实测 7.8s），用户请求会被重算阻塞。
 * 本用例锁四条不变量：
 * 1. 冷键：请求阻塞在重算（首填）；
 * 2. 新鲜窗内：直接命中，不再触发查询；
 * 3. 过期但有旧值：SWR——立即返回旧值、重算转后台（绝不等待）；
 * 4. 周期刷新必须 force——TTL 内也要真正重算替换（否则定时刷新变 no-op）。
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

import platformRouter, {
  __clearExecLogsCachesForTests,
  __expireExecLogsCachesForTests,
  refreshExecLogsCache,
} from '../platform'

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

function makeRow(id: string) {
  return {
    id,
    agentId: 'agent-perf-test',
    callerAgent: null,
    sourceEntry: 'platform',
    success: true,
    error: null,
    errorCode: null,
    traceId: `trace-${id}`,
    durationMs: 5,
    calledAt: new Date('2026-10-04T10:00:00Z'),
    metadata: '{}',
    executionLayer: null,
    providerId: null,
    providerType: null,
    routeSource: null,
    model: null,
    statusCode: 200,
    attemptCount: 1,
    maxAttempts: 1,
    finishReason: null,
    promptTokens: 1,
    completionTokens: 1,
  }
}

/** 与预热形状逐字一致的查询（预热默认形状 = timeRange=week&limit=200） */
const WARM_SHAPE_QUERY = { timeRange: 'week', limit: '200' }

beforeEach(() => {
  jest.clearAllMocks()
  __clearExecLogsCachesForTests()
  findMany.mockResolvedValue([])
  count.mockResolvedValue(0)
  groupBy.mockResolvedValue([])
})

describe('执行日志缓存读路径（2026-10-04 性能批四段）', () => {
  it('冷键请求完成重算并填缓存；新鲜窗内第二次请求直接命中、零查询', async () => {
    findMany.mockResolvedValue([makeRow('log-1')] as any)

    const res1 = await run(getRouteHandler(platformRouter, '/agents/logs', 'get'), { query: { ...WARM_SHAPE_QUERY } })
    expect(res1.statusCode).toBe(200)
    // 一次完整取数 = 行 findMany + 失败行 findMany（统计 groupBy 同批）
    expect(findMany).toHaveBeenCalledTimes(2)
    expect(groupBy).toHaveBeenCalledTimes(1)

    findMany.mockClear()
    groupBy.mockClear()
    const res2 = await run(getRouteHandler(platformRouter, '/agents/logs', 'get'), { query: { ...WARM_SHAPE_QUERY } })
    expect(findMany).not.toHaveBeenCalled()
    expect(groupBy).not.toHaveBeenCalled()
    expect(res2.body.data.logs[0].id).toBe('log-1')
  })

  it('过期但有旧值：SWR 立即返回旧值（不等重算），重算落地后下一次命中新值', async () => {
    findMany.mockResolvedValue([makeRow('log-old')] as any)
    await run(getRouteHandler(platformRouter, '/agents/logs', 'get'), { query: { ...WARM_SHAPE_QUERY } })

    __expireExecLogsCachesForTests()
    let releaseRecompute!: () => void
    const gate = new Promise<void>((resolve) => { releaseRecompute = resolve })
    findMany.mockImplementationOnce(async () => {
      await gate // 重算挂起：若读路径错误地等待重算，本用例会超时
      return [makeRow('log-new')]
    })

    const t0 = Date.now()
    const res = await run(getRouteHandler(platformRouter, '/agents/logs', 'get'), { query: { ...WARM_SHAPE_QUERY } })
    expect(Date.now() - t0).toBeLessThan(500)
    expect(res.body.data.logs[0].id).toBe('log-old')

    releaseRecompute()
    await new Promise((resolve) => setTimeout(resolve, 20))
    const res2 = await run(getRouteHandler(platformRouter, '/agents/logs', 'get'), { query: { ...WARM_SHAPE_QUERY } })
    expect(res2.body.data.logs[0].id).toBe('log-new')
  })

  it('周期刷新必须 force：TTL 内也重算替换（防定时刷新变 no-op）', async () => {
    findMany.mockResolvedValue([makeRow('v1')] as any)
    await run(getRouteHandler(platformRouter, '/agents/logs', 'get'), { query: { ...WARM_SHAPE_QUERY } })

    findMany.mockResolvedValue([makeRow('v2')] as any)
    await refreshExecLogsCache()

    const res = await run(getRouteHandler(platformRouter, '/agents/logs', 'get'), { query: { ...WARM_SHAPE_QUERY } })
    expect(res.body.data.logs[0].id).toBe('v2')
  })
})
