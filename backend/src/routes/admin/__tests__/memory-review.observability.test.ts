/**
 * Admin · 记忆与复习观测（GET /memory-review、GET /:userId、POST /:userId/recompute）
 *
 * 覆盖：
 * - 权限：非管理员 403（三个入口）
 * - 总览：按痕迹倒序 + 到期计数（口径与 review-plan 一致：extractionCount > 0）+ 审计汇总 + 虚拟学习者排除
 * - 明细：同族重复分组（size > 1 = 「过多过杂」证据）+ 到期预览按记忆强度升序
 * - 重新观察：只走 observe + force，不暴露执行
 */

export {}

type RouteHandler = (...args: any[]) => any

const usersFindUnique = jest.fn()
const usersFindMany = jest.fn()
const tracesGroupBy = jest.fn()
const tracesFindMany = jest.fn()
const projectionsFindMany = jest.fn()

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    users: { findUnique: usersFindUnique, findMany: usersFindMany },
    memory_traces: { groupBy: tracesGroupBy, findMany: tracesFindMany },
    learner_projections: { findMany: projectionsFindMany },
  },
}))

jest.mock('../../../middleware/auth.middleware', () => ({ authMiddleware: jest.fn() }))
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}))

const buildReviewPlan = jest.fn()
jest.mock('../../../services/memory/review-plan.service', () => ({
  reviewPlanService: { buildReviewPlan: (...args: any[]) => buildReviewPlan(...args) },
}))

const getAudit = jest.fn()
const consolidate = jest.fn()
jest.mock('../../../services/learner/ConceptConsolidatorService', () => ({
  CONSOLIDATION_AUDIT_PROJECTION_SCOPE: 'concept-consolidation',
  conceptConsolidatorService: {
    getAudit: (...args: any[]) => getAudit(...args),
    consolidate: (...args: any[]) => consolidate(...args),
  },
}))

import memoryReviewRouter from '../memory-review'

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

const adminReq = { user: { userId: 'admin-1' }, query: {}, params: {} }

const auditPayload = {
  mode: 'observe',
  generatedAt: '2026-09-15T10:00:00.000Z',
  stats: { candidates: 12, proposed: 4, autoApplicable: 2, applied: 0, deleted: 0 },
  ambiguous: [{ a: 'x', b: 'y', reason: 'r' }],
  dropCandidates: [],
  proposals: [],
  appliedMerges: [],
}

beforeEach(() => {
  jest.clearAllMocks()
  usersFindUnique.mockResolvedValue({ isAdmin: true })
})

describe('权限', () => {
  it('非管理员访问三个入口都 403', async () => {
    usersFindUnique.mockResolvedValue({ isAdmin: false })
    const list = await run(getRouteHandler(memoryReviewRouter, '/', 'get'), { ...adminReq })
    expect(list.statusCode).toBe(403)
    const detail = await run(getRouteHandler(memoryReviewRouter, '/:userId', 'get'), { ...adminReq, params: { userId: 'u1' } })
    expect(detail.statusCode).toBe(403)
    const recompute = await run(getRouteHandler(memoryReviewRouter, '/:userId/recompute', 'post'), { ...adminReq, params: { userId: 'u1' } })
    expect(recompute.statusCode).toBe(403)
  })
})

describe('总览', () => {
  it('按痕迹倒序 + 到期口径 + 审计汇总 + 排除虚拟学习者', async () => {
    usersFindMany
      .mockResolvedValueOnce([{ id: 'virtual-1' }])
      .mockResolvedValueOnce([
        { id: 'u1', name: '小明', email: 'a@b.c', isVirtualLearner: false },
        { id: 'u2', name: '小红', email: 'd@e.f', isVirtualLearner: false },
      ])
    tracesGroupBy
      .mockResolvedValueOnce([
        { userId: 'u1', _count: { _all: 20 } },
        { userId: 'u2', _count: { _all: 5 } },
      ])
      .mockResolvedValueOnce([{ userId: 'u1', _count: { _all: 9 } }])
    projectionsFindMany.mockResolvedValue([
      { userId: 'u1', payload: JSON.stringify(auditPayload), generatedAt: new Date('2026-09-15T10:00:00Z') },
      { userId: 'u2', payload: '{bad json', generatedAt: new Date('2026-09-15T09:00:00Z') },
    ])

    const res = await run(getRouteHandler(memoryReviewRouter, '/', 'get'), { ...adminReq })
    const body = res.body.data

    expect(body.users.map((row: any) => row.userId)).toEqual(['u1', 'u2'])
    expect(body.users[0]).toMatchObject({ name: '小明', traces: 20, due: 9 })
    expect(body.users[0].audit).toMatchObject({ proposed: 4, autoApplicable: 2, ambiguous: 1, applied: 0, deleted: 0 })
    expect(body.users[1].audit).toBeNull() // 脏 payload 不影响其它行
    expect(body.totals).toMatchObject({ users: 2, traces: 25, due: 9, usersWithAudit: 2, proposed: 4 })

    // 到期口径：dueAt <= now 且 extractionCount > 0（与复习队列一致，排除 kt-estimate 孤儿）
    const dueCall = tracesGroupBy.mock.calls[1][0]
    expect(dueCall.where.extractionCount).toEqual({ gt: 0 })
    expect(dueCall.where.dueAt.lte).toBeInstanceOf(Date)
    // 默认排除虚拟学习者
    expect(tracesGroupBy.mock.calls[0][0].where.userId).toEqual({ notIn: ['virtual-1'] })
  })
})

describe('单用户明细', () => {
  it('同族重复分组 + 到期预览按记忆强度升序 + 温故计划', async () => {
    usersFindUnique.mockImplementation(async (args: any) => (
      args?.select?.isAdmin ? { isAdmin: true } : { id: 'u1', name: '小明', email: null, isVirtualLearner: false }
    ))
    buildReviewPlan.mockResolvedValue({
      items: [{ conceptKey: '离开前翻页立好', label: '离开前翻页立好', retention: 0.4, reason: 'below-threshold', load: 1, loadFactors: [], originPathTitle: null }],
      budget: 2,
      usedLoad: 1,
      backlogCount: 7,
      successRate: 0.6,
      relearnSuggestions: [{ conceptKey: '老卡点', label: '老卡点', consecutiveAgain: 3 }],
    })
    const now = new Date()
    tracesFindMany.mockResolvedValue([
      // 同族两条（归一化后同键）
      { conceptKey: '离开前翻页立好', label: 'A', source: 'derived', masteryScore: 0.6, extractionCount: 7, lastSeenAt: now, dueAt: new Date(now.getTime() - 1000), fsrsStability: null, fsrsDifficulty: null },
      { conceptKey: '离开前翻页立好：动作先于评价', label: 'B', source: 'derived', masteryScore: 0.5, extractionCount: 2, lastSeenAt: now, dueAt: null, fsrsStability: null, fsrsDifficulty: null },
      // 到期更弱的一条（应排在前面）
      { conceptKey: 'CAP 定理', label: 'CAP', source: 'derived', masteryScore: 0.3, extractionCount: 4, lastSeenAt: new Date(now.getTime() - 86400000 * 10), dueAt: new Date(now.getTime() - 5000), fsrsStability: null, fsrsDifficulty: null },
      // 从未提取 → 不进到期
      { conceptKey: '孤儿点', label: '孤儿', source: 'kt-estimate', masteryScore: 0.3, extractionCount: 0, lastSeenAt: null, dueAt: null, fsrsStability: null, fsrsDifficulty: null },
    ])
    getAudit.mockResolvedValue(auditPayload)

    const res = await run(getRouteHandler(memoryReviewRouter, '/:userId', 'get'), { ...adminReq, params: { userId: 'u1' } })
    const body = res.body.data

    expect(body.summary).toMatchObject({ traces: 4, due: 2, duplicatedFamilies: 1, duplicatedTraces: 2, neverExtracted: 1, withFsrsState: 0 })
    expect(body.duePreview.map((row: any) => row.conceptKey)).toEqual(['CAP 定理', '离开前翻页立好'])
    expect(body.duePreview[0].retention).toBeLessThan(body.duePreview[1].retention)
    expect(body.duplicatedFamilies[0]).toMatchObject({ family: '离开前翻页立好', size: 2 })
    expect(body.reviewPlan.backlogCount).toBe(7)
    expect(body.reviewPlan.relearnSuggestions).toHaveLength(1)
    expect(body.audit.mode).toBe('observe')
  })

  it('用户不存在 → 404', async () => {
    usersFindUnique.mockImplementation(async (args: any) => (args?.select?.isAdmin ? { isAdmin: true } : null))
    const res = await run(getRouteHandler(memoryReviewRouter, '/:userId', 'get'), { ...adminReq, params: { userId: 'nope' } })
    expect(res.statusCode).toBe(404)
  })
})

describe('重新观察', () => {
  it('只走 observe + force，不暴露执行', async () => {
    usersFindUnique.mockImplementation(async (args: any) => (args?.select?.isAdmin ? { isAdmin: true } : { id: 'u1' }))
    consolidate.mockResolvedValue(auditPayload)

    const res = await run(getRouteHandler(memoryReviewRouter, '/:userId/recompute', 'post'), { ...adminReq, params: { userId: 'u1' } })

    expect(consolidate).toHaveBeenCalledWith('u1', { mode: 'observe', force: true })
    expect(res.body.data.audit).toMatchObject({ mode: 'observe' })
  })
})
