/* eslint-disable @typescript-eslint/no-explicit-any -- 路由测试桩按 Express 动态分发，handler 签名无需精确 */
// 运营可观测读侧路由测试：吞吐口径 / 空闲判定 / 参数夹取 / 洞察可靠性入参
export {}

type RouteHandler = (...args: any[]) => any

const routes: Record<string, RouteHandler[]> = {}
const attemptsFindMany = jest.fn()
const sessionsCount = jest.fn()
const batchJobsCount = jest.fn()
const batchJobsUpsert = jest.fn()
const batchJobsUpdateMany = jest.fn()
const leasesCount = jest.fn()
const getReliability = jest.fn()

const mockRouter = () => ({
  get: (path: string, ...handlers: RouteHandler[]) => { routes[`GET ${path}`] = handlers },
  post: (path: string, ...handlers: RouteHandler[]) => { routes[`POST ${path}`] = handlers },
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
    llm_execution_attempts: { findMany: attemptsFindMany },
    virtual_sessions: { count: sessionsCount },
    virtual_batch_jobs: { count: batchJobsCount, upsert: batchJobsUpsert, updateMany: batchJobsUpdateMany },
    virtual_experiment_leases: { count: leasesCount }
  }
}))

jest.mock('../../services/learner/insight-calibration.service', () => ({
  insightCalibrationService: { getReliability }
}))

require('../admin/ops-observability')

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

function httpReq(query: Record<string, unknown> = {}, body: Record<string, unknown> = {}) {
  return { query, body, headers: {}, params: {} } as any
}

async function run(method: string, path: string, req: any) {
  const res = createResponse()
  const handlers = routes[`${method} ${path}`]
  const next = jest.fn()
  await handlers[handlers.length - 1](req, res, next)
  return { res, next }
}

beforeEach(() => {
  jest.clearAllMocks()
  attemptsFindMany.mockResolvedValue([])
  sessionsCount.mockResolvedValue(0)
  batchJobsCount.mockResolvedValue(0)
  leasesCount.mockResolvedValue(0)
})

describe('GET /throughput', () => {
  it('没有运行中的批次/会话 → idle，低 rpm 不告警', async () => {
    const { res } = await run('GET', '/throughput', httpReq())

    expect(res.statusCode).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.idle).toBe(true)
    expect(res.body.data.alert).toBe(false)
    expect(res.body.data.alertReason).toBeNull()
    expect(res.body.data.longestLowRun).toBe(60)
  })

  it('有运行中的虚拟会话但零调用 → 不空闲，照常告警', async () => {
    sessionsCount.mockResolvedValue(2)
    const { res } = await run('GET', '/throughput', httpReq())

    expect(res.body.data.idle).toBe(false)
    expect(res.body.data.activeSessions).toBe(2)
    expect(res.body.data.alert).toBe(true)
    expect(res.body.data.alertReason).toContain('低于 20 rpm')
  })

  it('批量任务与未过期租约也算运行信号', async () => {
    batchJobsCount.mockResolvedValue(1)
    const { res } = await run('GET', '/throughput', httpReq())
    expect(res.body.data.idle).toBe(false)

    jest.clearAllMocks()
    attemptsFindMany.mockResolvedValue([])
    sessionsCount.mockResolvedValue(0)
    batchJobsCount.mockResolvedValue(0)
    leasesCount.mockResolvedValue(1)
    const second = await run('GET', '/throughput', httpReq())
    expect(second.res.body.data.idle).toBe(false)
    expect(second.res.body.data.activeLeases).toBe(1)
  })

  it('窗口与下限参数夹取到合法区间', async () => {
    const { res } = await run('GET', '/throughput', httpReq({ window: '1', minRpm: '0' }))

    expect(res.body.data.windowMinutes).toBe(5)
    expect(res.body.data.minRpm).toBe(1)
    const where = attemptsFindMany.mock.calls[0][0].where
    expect(where.startedAt.gte).toBeInstanceOf(Date)
  })
})

describe('POST /batch-heartbeat', () => {
  it('缺少 runId → 400', async () => {
    const { res } = await run('POST', '/batch-heartbeat', httpReq({}, {}))
    expect(res.statusCode).toBe(400)
    expect(batchJobsUpsert).not.toHaveBeenCalled()
  })

  it('心跳 upsert：同一 runId 复用 hb: 行，重复调用只刷新状态', async () => {
    const { res } = await run('POST', '/batch-heartbeat', httpReq({}, { runId: 'nightly-1021' }))
    expect(res.statusCode).toBe(200)
    expect(res.body.data).toMatchObject({ id: 'hb:nightly-1021', runId: 'nightly-1021', staleAfterMinutes: 5 })
    const args = batchJobsUpsert.mock.calls[0][0]
    expect(args.where).toEqual({ id: 'hb:nightly-1021' })
    expect(args.create).toMatchObject({ id: 'hb:nightly-1021', kind: 'throughput-heartbeat', status: 'running' })
    expect(args.update).toMatchObject({ status: 'running' })
  })

  it('停止心跳 → running 置 done（幂等）', async () => {
    batchJobsUpdateMany.mockResolvedValue({ count: 1 })
    const { res } = await run('POST', '/batch-heartbeat/stop', httpReq({}, { runId: 'nightly-1021' }))
    expect(res.body.data).toEqual({ runId: 'nightly-1021', stopped: 1 })
    expect(batchJobsUpdateMany.mock.calls[0][0].where).toEqual({ id: 'hb:nightly-1021', status: 'running' })
  })
})

describe('GET /insight-reliability', () => {
  it('缺 userId → 400，不查服务', async () => {
    const { res } = await run('GET', '/insight-reliability', httpReq())
    expect(res.statusCode).toBe(400)
    expect(getReliability).not.toHaveBeenCalled()
  })

  it('带 pathId 透传并返回可靠性', async () => {
    getReliability.mockResolvedValue({ n: 10, hits: 8, misses: 2, hitRate: 0.8 })
    const { res } = await run('GET', '/insight-reliability', httpReq({ userId: 'u-1', pathId: 'lp-1' }))

    expect(getReliability).toHaveBeenCalledWith('u-1', 'lp-1')
    expect(res.body.data.hitRate).toBe(0.8)
  })
})
