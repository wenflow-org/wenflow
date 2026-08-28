/**
 * GET /virtual-learners/stats（A5 运行统计）：总会话/完成/failed/卡死/平均时长/完成率/失败率
 * 全量聚合口径；卡死阈值与 reclaim 服务同源（VLAB_STALE_SESSION_HOURS）。
 */
const mockSessionsGroupBy = jest.fn()
const mockSessionsFindMany = jest.fn()
const mockProfilesCount = jest.fn()
/** 今日虚拟调用查询：users 差集（findMany）+ agent_call_logs 计数 */
const mockUsersFindMany = jest.fn()
const mockAgentCallLogsCount = jest.fn()

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    virtual_sessions: { groupBy: mockSessionsGroupBy, findMany: mockSessionsFindMany },
    virtual_learner_profiles: { count: mockProfilesCount },
    users: { findMany: mockUsersFindMany },
    agent_call_logs: { count: mockAgentCallLogsCount }
  }
}))
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}))
jest.mock('../../coordinators/simulation.coordinator', () => ({ __esModule: true, default: {} }))
jest.mock('../../gateway', () => ({ getGateway: jest.fn(() => ({})) }))
jest.mock('../../skills/virtual-learner-persona-designer', () => ({ virtualLearnerPersonaDesignerDefinition: {} }))
jest.mock('../../skills/virtual-learner-scenario-designer', () => ({ virtualLearnerScenarioDesignerDefinition: {} }))
jest.mock('../../skills', () => ({ executeSkill: jest.fn() }))
jest.mock('../../services/learning/learning.service', () => ({ __esModule: true, default: {} }))
jest.mock('../../services/ai-teaching/TeachingSessionRepository', () => ({ teachingSessionRepository: {} }))
jest.mock('../../utils/projection-token', () => ({ signProjectionToken: jest.fn() }))
jest.mock('../../virtual-lab/blackbox-runner', () => ({ __esModule: true, default: {} }))
jest.mock('../../virtual-lab/session-mode', () => ({ assertAssistedSessionMode: jest.fn() }))
jest.mock('../../virtual-lab/session-reclaim.service', () => ({
  virtualSessionReclaimService: { getThresholdMs: jest.fn(() => 24 * 3600 * 1000) }
}))

import router from '../admin/virtual-learners'

function getGetHandler(path: string) {
  const layer = (router as any).stack.find((item: any) => item.route?.path === path && item.route?.methods?.get)
  if (!layer) throw new Error(`Route not found: ${path}`)
  return layer.route.stack[layer.route.stack.length - 1].handle
}

function createResponse() {
  const res: any = { status: jest.fn(), json: jest.fn() }
  res.status.mockReturnValue(res)
  res.json.mockReturnValue(res)
  return res
}

describe('GET /stats（虚拟实验运行统计）', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    /* 今日虚拟调用默认值：空虚拟用户集 → 0 次（功能用例自行覆盖） */
    mockUsersFindMany.mockResolvedValue([])
    mockAgentCallLogsCount.mockResolvedValue(0)
  })

  it('统计口径：全量分组计数 + 完成率/失败率（现状 0% 完成也应如实返回）', async () => {
    mockSessionsGroupBy.mockResolvedValue([
      { status: 'created', _count: { _all: 2 } },
      { status: 'running', _count: { _all: 4 } },
      { status: 'failed', _count: { _all: 3 } },
      { status: 'abandoned', _count: { _all: 1 } },
      { status: 'completed', _count: { _all: 0 } }
    ])
    mockProfilesCount.mockResolvedValue(10)
    // 今日虚拟调用：虚拟账号集合 + 计数 200（仿真看板指标）
    mockUsersFindMany.mockResolvedValue([{ id: 'virt1' }, { id: 'virt2' }])
    mockAgentCallLogsCount.mockResolvedValue(200)
    mockSessionsFindMany.mockResolvedValueOnce([
      { updatedAt: new Date('2026-08-10T10:00:00.000Z') },
      { updatedAt: new Date('2026-08-08T08:00:00.000Z') }
    ]).mockResolvedValueOnce([
      { createdAt: new Date('2026-08-01T00:00:00.000Z'), updatedAt: new Date('2026-08-01T02:00:00.000Z') },
      { createdAt: new Date('2026-08-02T00:00:00.000Z'), updatedAt: new Date('2026-08-02T00:30:00.000Z') }
    ])

    const handler = getGetHandler('/stats')
    const req: any = {}
    const res = createResponse()

    await handler(req, res)

    expect(mockSessionsGroupBy).toHaveBeenCalledWith(expect.objectContaining({ by: ['status'] }))
    expect(mockSessionsFindMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({ status: { in: ['running', 'created'] } })
    }))
    expect(mockSessionsFindMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({ status: { in: ['completed', 'failed', 'abandoned'] } })
    }))
    expect(mockUsersFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ OR: expect.any(Array) }) }))
    expect(mockAgentCallLogsCount).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ calledAt: expect.anything(), userId: { in: ['virt1', 'virt2'] } })
    }))
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        profileCount: 10,
        totalSessions: 10,
        created: 2,
        running: 4,
        failed: 3,
        abandoned: 1,
        completed: 0,
        completionRate: 0,
        failureRate: 40,
        staleCount: 2,
        avgDurationMs: expect.any(Number),
        reclaimThresholdMs: 24 * 3600 * 1000,
        todayCalls: 200
      })
    }))
  })

  it('平均时长 = 终态会话 (updatedAt - createdAt) 均值', async () => {
    mockSessionsGroupBy.mockResolvedValue([{ status: 'completed', _count: { _all: 3 } }])
    mockProfilesCount.mockResolvedValue(1)
    mockSessionsFindMany.mockResolvedValueOnce([])
    mockSessionsFindMany.mockResolvedValueOnce([
      { createdAt: new Date('2026-08-01T00:00:00.000Z'), updatedAt: new Date('2026-08-01T02:00:00.000Z') },
      { createdAt: new Date('2026-08-02T00:00:00.000Z'), updatedAt: new Date('2026-08-02T00:30:00.000Z') },
      { createdAt: new Date('2026-08-03T00:00:00.000Z'), updatedAt: new Date('2026-08-03T01:30:00.000Z') }
    ])

    const handler = getGetHandler('/stats')
    const res = createResponse()
    await handler({}, res)

    const data = res.json.mock.calls[0][0].data
    expect(data.avgDurationMs).toBe(80 * 60 * 1000)
    expect(data.completionRate).toBe(100)
    expect(data.failureRate).toBe(0)
  })

  it('无任何会话：完成率/失败率为 0，卡死与时长均 0，不崩溃', async () => {
    mockSessionsGroupBy.mockResolvedValue([])
    mockProfilesCount.mockResolvedValue(0)
    mockSessionsFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([])

    const handler = getGetHandler('/stats')
    const res = createResponse()
    await handler({}, res)

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        totalSessions: 0,
        completionRate: 0,
        failureRate: 0,
        staleCount: 0,
        maxStaleMins: 0,
        avgDurationMs: 0
      })
    }))
  })

  it('统计端点注册顺序先于 /:id（stats 不被当作 profile id）', () => {
    const stack = (router as any).stack as Array<{ route?: { path: string; methods: Record<string, boolean> } }>
    const statsIndex = stack.findIndex((l) => l.route?.path === '/stats' && l.route?.methods?.get)
    const detailIndex = stack.findIndex((l) => l.route?.path === '/:id' && l.route?.methods?.get)
    expect(statsIndex).toBeGreaterThanOrEqual(0)
    expect(detailIndex).toBeGreaterThan(statsIndex)
  })
})
