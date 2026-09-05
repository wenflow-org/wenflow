const mockRunReclaimOnce = jest.fn()

jest.mock('../../config/database', () => ({ __esModule: true, default: {} }))
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
  virtualSessionReclaimService: { runReclaimOnce: mockRunReclaimOnce }
}))

import router from '../admin/virtual-learners'

function getPostHandler(path: string) {
  const layer = (router as any).stack.find((item: any) => item.route?.path === path && item.route?.methods?.post)
  if (!layer) throw new Error(`Route not found: ${path}`)
  return layer.route.stack[layer.route.stack.length - 1].handle
}

function createResponse() {
  const res: any = { status: jest.fn(), json: jest.fn() }
  res.status.mockReturnValue(res)
  res.json.mockReturnValue(res)
  return res
}

describe('POST /sessions/reclaim-stale（僵尸虚拟会话回收）', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRunReclaimOnce.mockResolvedValue({ dryRun: true, scanned: 0, reclaimed: 0, skippedActiveLease: 0, sessions: [] })
  })

  it('默认 dryRun=true（干跑确认清单），不落地任何状态', async () => {
    const handler = getPostHandler('/sessions/reclaim-stale')
    const req: any = { body: {} }
    const res = createResponse()

    await handler(req, res)

    expect(mockRunReclaimOnce).toHaveBeenCalledWith({ dryRun: true })
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ dryRun: true })
    }))
  })

  it('dryRun=false 执行落地标记', async () => {
    const handler = getPostHandler('/sessions/reclaim-stale')
    const req: any = { body: { dryRun: false } }
    const res = createResponse()

    await handler(req, res)

    expect(mockRunReclaimOnce).toHaveBeenCalledWith({ dryRun: false })
  })

  it('profileIds 透传：批量清理卡死只回收选中虚拟人的会话', async () => {
    const handler = getPostHandler('/sessions/reclaim-stale')
    const req: any = { body: { dryRun: true, profileIds: ['p-1', 'p-2'] } }
    const res = createResponse()

    await handler(req, res)

    expect(mockRunReclaimOnce).toHaveBeenCalledWith({ dryRun: true, profileIds: ['p-1', 'p-2'] })
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }))
  })

  it('失败时返回 500 与错误信息', async () => {
    mockRunReclaimOnce.mockRejectedValue(new Error('reclaim failed'))
    const handler = getPostHandler('/sessions/reclaim-stale')
    const req: any = { body: {} }
    const res = createResponse()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }))
  })
})
