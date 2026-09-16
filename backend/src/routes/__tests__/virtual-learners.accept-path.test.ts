/**
 * POST /sessions/:sessionId/accept-path —— 运维「强制接受当前 Path」逃生口契约。
 *
 * 背景：Path 评审是独立质量旁路，不得成为 Learn 闸门。decision=modify/reject 时
 * `acceptPathReview` 默认会拒绝；本用例锁定「路由把 body.force 透传给协调器」，
 * 保证前端在 modify/reject 时仍能强制接受、不被评审堵死。
 */
const mockVirtualSessionFindUnique = jest.fn()
const mockAcceptPathReview = jest.fn()
const mockRunLeasedExclusive = jest.fn()

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    virtual_sessions: { findUnique: mockVirtualSessionFindUnique },
    virtual_learner_profiles: {},
    users: {},
    admin_audit_logs: {}
  }
}))
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}))
jest.mock('../../coordinators/simulation.coordinator', () => ({
  __esModule: true,
  default: {
    runLeasedExclusive: mockRunLeasedExclusive,
    acceptPathReview: mockAcceptPathReview,
    reviewPathProposal: jest.fn(),
    replanPathFromReview: jest.fn(),
    startLearningPhase: jest.fn()
  }
}))
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

describe('POST /sessions/:sessionId/accept-path（强制接受逃生口）', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockVirtualSessionFindUnique.mockResolvedValue({ id: 's1', userId: 'u1', stageResults: '{}' })
    mockRunLeasedExclusive.mockImplementation(async (_id: string, work: any) => work(async () => undefined))
    mockAcceptPathReview.mockResolvedValue({ success: true })
  })

  it('body.force=true → 透传 { force: true }（modify/reject 也能接受）', async () => {
    const handler = getPostHandler('/sessions/:sessionId/accept-path')
    const req: any = { params: { sessionId: 's1' }, body: { force: true }, user: {} }
    const res = createResponse()
    await handler(req, res)
    expect(mockAcceptPathReview).toHaveBeenCalledWith('s1', { force: true })
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { success: true }, error: undefined })
  })

  it('未带 force → 透传 { force: false }（保持默认语义）', async () => {
    const handler = getPostHandler('/sessions/:sessionId/accept-path')
    const req: any = { params: { sessionId: 's1' }, body: {}, user: {} }
    const res = createResponse()
    await handler(req, res)
    expect(mockAcceptPathReview).toHaveBeenCalledWith('s1', { force: false })
  })
})
