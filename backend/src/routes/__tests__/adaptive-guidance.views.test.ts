/**
 * #187：adaptive-guidance-copy 的 view 契约——**声明几个视图，就真实受理几个**。
 *
 * 病灶历史：skill 曾声明 dashboard / learning-state / path-list / path-detail 四个 view，
 * 但模型侧只有一处调用且硬编码 view='dashboard'，learning-state 页拿的是 dashboard 快照文案，
 * path 两个视图没有任何调用方——「声明 4 个 / 实际 1 个」。
 *
 * 现在收敛为两个真实视图（skills/adaptive-guidance-copy/views.ts 是唯一真源）：
 *  - dashboard：DashboardGuidanceSnapshotService 生成（事件驱动快照）；
 *  - learning-state：LearningStateGuidanceService 自己按 view='learning-state' 生成。
 * 本用例钉住：GUIDANCE_VIEWS 里每一个都必须被路由受理（不是 400），且路由到**各自的**服务；
 * 未声明的视图（如已退役的 path-list / path-detail）一律 400。
 */
const mockDashboardGet = jest.fn()
const mockLearningStateGet = jest.fn()

jest.mock('../../middleware/auth.middleware', () => ({
  authMiddleware: (_req: any, _res: any, next: () => void) => next(),
}))
jest.mock('../../services/learner/DashboardGuidanceSnapshotService', () => ({
  dashboardGuidanceSnapshotService: { get: mockDashboardGet },
}))
jest.mock('../../services/learner/LearningStateGuidanceService', () => ({
  learningStateGuidanceService: { get: mockLearningStateGet },
}))
jest.mock('../../services/auth/auth.service', () => ({
  __esModule: true,
  default: { isUserAdmin: jest.fn(async () => false) },
}))
jest.mock('../../utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}))

import router from '../adaptive-guidance.routes'
import { GUIDANCE_VIEWS } from '../../skills/adaptive-guidance-copy/views'

function getCopyHandler() {
  const layer = (router as any).stack.find((item: any) => item.route?.path === '/copy' && item.route?.methods?.get)
  if (!layer) throw new Error('Route not found: /copy')
  return layer.route.stack[layer.route.stack.length - 1].handle
}

function createResponse() {
  const res: any = { status: jest.fn(), json: jest.fn() }
  res.status.mockReturnValue(res)
  res.json.mockReturnValue(res)
  return res
}

describe('adaptive-guidance /copy 视图契约（#187）', () => {
  const handler = getCopyHandler()

  beforeEach(() => {
    jest.clearAllMocks()
    mockDashboardGet.mockResolvedValue(null)
    mockLearningStateGet.mockResolvedValue({
      view: 'learning-state',
      copy: { headline: 'h' },
      summary: {},
      decisions: [],
      source: 'model',
    })
  })

  it('声明的视图集合就是两个真实视图（dashboard / learning-state）', () => {
    expect([...GUIDANCE_VIEWS]).toEqual(['dashboard', 'learning-state'])
  })

  it.each([...GUIDANCE_VIEWS])('view=%s 是声明视图 → 必须受理（不是 400）', async (view) => {
    if (view === 'dashboard') {
      mockDashboardGet.mockResolvedValue({ view: 'dashboard', copy: { headline: 'dash' }, summary: {}, decisions: [] })
    }
    const res = createResponse()
    await handler({ query: { view }, user: { userId: 'u1' } }, res, jest.fn())

    expect(res.status).not.toHaveBeenCalledWith(400)
    const body = res.json.mock.calls[0][0]
    expect(body.success).toBe(true)
    expect(body.data.view).toBe(view)
  })

  it('learning-state 走本视图服务，**不**回落到 dashboard 快照（复用即 #187 复发）', async () => {
    const res = createResponse()
    await handler({ query: { view: 'learning-state' }, user: { userId: 'u1' } }, res, jest.fn())

    expect(mockLearningStateGet).toHaveBeenCalledWith('u1', { forceRefresh: false })
    expect(mockDashboardGet).not.toHaveBeenCalled()
    const body = res.json.mock.calls[0][0]
    expect(body.data.view).toBe('learning-state')
    expect(body.data.copy).toEqual({ headline: 'h' })
  })

  it('dashboard 只读快照，不触发 learning-state 生成', async () => {
    mockDashboardGet.mockResolvedValue({ view: 'dashboard', copy: { headline: 'dash' }, summary: {}, decisions: [] })
    const res = createResponse()
    await handler({ query: {}, user: { userId: 'u1' } }, res, jest.fn())

    expect(mockDashboardGet).toHaveBeenCalledWith('u1')
    expect(mockLearningStateGet).not.toHaveBeenCalled()
    expect(res.json.mock.calls[0][0].data.copy).toEqual({ headline: 'dash' })
  })

  it.each(['path-list', 'path-detail'])('view=%s 未在任何声明中登记 → 400，且不调用任何生成路径', async (view) => {
    const res = createResponse()
    await handler({ query: { view }, user: { userId: 'u1' } }, res, jest.fn())

    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockDashboardGet).not.toHaveBeenCalled()
    expect(mockLearningStateGet).not.toHaveBeenCalled()
    // 报错要列出真实支持的视图，避免再次出现「声明一份、受理另一份」
    expect(res.json.mock.calls[0][0].error.message).toContain('dashboard')
    expect(res.json.mock.calls[0][0].error.message).toContain('learning-state')
  })
})
