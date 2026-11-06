/**
 * #187：adaptive-guidance-copy 的「4 个 view」实为 1 个可达。
 *
 * 现状契约（唯一真源见 skills/adaptive-guidance-copy/index.ts 的 inputSchema 注释）：
 *  - 模型侧唯一真实调用是 dashboard（DashboardGuidanceSnapshotService，view 硬编码 'dashboard'）；
 *  - learning-state 主路径复用 dashboard 快照的 copy（载荷里以 copySourceView 自报），
 *    仅快照缺失时才本地静态兜底——**不**为 learning-state 再跑一次 skill；
 *  - path-list / path-detail 无任何调用方，路由对它们返回 400。
 * 本用例把「哪些 view 可达、复用来源是否可见」钉住，防止契约再次漂移回「声明 4 个、实际 1 个」。
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
    mockLearningStateGet.mockResolvedValue({ copy: { headline: 'h' }, summary: {}, decisions: [], source: 'model' })
  })

  it.each(['path-list', 'path-detail'])('view=%s 无调用方 → 400（不再有永不产生文案的声明）', async (view) => {
    const res = createResponse()
    await handler({ query: { view }, user: { userId: 'u1' } }, res, jest.fn())

    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockDashboardGet).not.toHaveBeenCalled()
    expect(mockLearningStateGet).not.toHaveBeenCalled()
  })

  it('learning-state：返回载荷自报 copySourceView（复用 dashboard 快照时= dashboard）', async () => {
    mockLearningStateGet.mockResolvedValue({
      copy: { headline: '复用来的' },
      summary: {},
      decisions: [],
      source: 'model',
      copySourceView: 'dashboard',
    })
    const res = createResponse()
    await handler({ query: { view: 'learning-state' }, user: { userId: 'u1' } }, res, jest.fn())

    expect(mockLearningStateGet).toHaveBeenCalledWith('u1', { forceRefresh: false })
    const body = res.json.mock.calls[0][0]
    expect(body.success).toBe(true)
    expect(body.data.copySourceView).toBe('dashboard')
  })

  it('默认（无 view）走 dashboard 快照，且只查快照、不触发 learning-state 生成', async () => {
    mockDashboardGet.mockResolvedValue({ copy: { headline: 'dash' }, summary: {}, decisions: [] })
    const res = createResponse()
    await handler({ query: {}, user: { userId: 'u1' } }, res, jest.fn())

    expect(mockDashboardGet).toHaveBeenCalledWith('u1')
    expect(mockLearningStateGet).not.toHaveBeenCalled()
    expect(res.json.mock.calls[0][0].data.copy).toEqual({ headline: 'dash' })
  })
})
