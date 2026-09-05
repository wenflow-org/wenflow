/**
 * PUT /:id（编辑画像）runtimePrefs 写入：每课回合上限钳制 [1,100]、难度白名单兜底 normal；
 * 未携带 runtimePrefs 时不触碰 profile JSON。
 */
const mockProfileFindUnique = jest.fn()
const mockProfileUpdate = jest.fn()
const mockUsersUpdate = jest.fn()

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    virtual_learner_profiles: { findUnique: mockProfileFindUnique, update: mockProfileUpdate },
    users: { update: mockUsersUpdate },
    virtual_sessions: {},
    virtual_experiment_leases: {},
    admin_audit_logs: {}
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

function getPutHandler(path: string) {
  const layer = (router as any).stack.find((item: any) => item.route?.path === path && item.route?.methods?.put)
  if (!layer) throw new Error(`Route not found: ${path}`)
  return layer.route.stack[layer.route.stack.length - 1].handle
}

function createResponse() {
  const res: any = { status: jest.fn(), json: jest.fn() }
  res.status.mockReturnValue(res)
  res.json.mockReturnValue(res)
  return res
}

describe('PUT /:id（编辑画像）runtimePrefs 写入', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockProfileFindUnique.mockResolvedValue({
      id: 'p-1',
      userId: 'u-1',
      profile: JSON.stringify({ storyPool: [], runtimePrefs: { turnCapPerLesson: 24, frictionBudget: 'normal' } }),
      learningGoal: '',
      knowledgeLevel: '',
    })
    mockUsersUpdate.mockResolvedValue({})
    mockProfileUpdate.mockImplementation(async ({ data }: any) => ({
      id: 'p-1',
      profile: data.profile || '{}',
      learningGoal: '',
      knowledgeLevel: ''
    }))
  })

  it('runtimePrefs 写入：turnCap 超出钳制到 100，难度非法回退 normal', async () => {
    const handler = getPutHandler('/:id')
    const req: any = { params: { id: 'p-1' }, body: { runtimePrefs: { turnCapPerLesson: 500, frictionBudget: 'extreme' } }, user: {} }
    const res = createResponse()
    await handler(req, res)
    const arg = mockProfileUpdate.mock.calls[0][0]
    const saved = JSON.parse(arg.data.profile)
    expect(saved.runtimePrefs).toEqual({ turnCapPerLesson: 100, frictionBudget: 'normal' })
  })

  it('不携带 runtimePrefs 时 profile 原样保留', async () => {
    const handler = getPutHandler('/:id')
    const req: any = { params: { id: 'p-1' }, body: { name: '新名字' }, user: {} }
    const res = createResponse()
    await handler(req, res)
    expect(mockUsersUpdate).toHaveBeenCalled()
    // profile 未被 update 触碰（没有 profile 相关写入）
    const calls = mockProfileUpdate.mock.calls
    expect(calls.some(([arg]: any) => arg.data?.profile)).toBe(false)
  })

  it('难度合法值原样保留（high）', async () => {
    const handler = getPutHandler('/:id')
    const req: any = { params: { id: 'p-1' }, body: { runtimePrefs: { turnCapPerLesson: 60, frictionBudget: 'high' } }, user: {} }
    const res = createResponse()
    await handler(req, res)
    const arg = mockProfileUpdate.mock.calls[0][0]
    const saved = JSON.parse(arg.data.profile)
    expect(saved.runtimePrefs).toEqual({ turnCapPerLesson: 60, frictionBudget: 'high' })
  })
})