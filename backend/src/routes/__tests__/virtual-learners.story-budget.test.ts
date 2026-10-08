/**
 * PUT /:id/stories/:storyIndex 故事级预算校验：
 * 显式传入的越界值返回 400（中文错误说明允许区间），不再静默 clamp；
 * 未传字段=继承角色级（budget 空对象时清空故事级覆盖）。
 * 前端口径见 VirtualProfile.vue saveStory（审核 2026-10-06 低 [94]）。
 */
const mockProfileFindUnique = jest.fn()
const mockProfileUpdate = jest.fn()

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    virtual_learner_profiles: { findUnique: mockProfileFindUnique, update: mockProfileUpdate },
    users: {},
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

const STORY = { id: 'story_a', title: '故事一', storyOutline: 'o', budget: { maxRetriesPerStep: 3 } }

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

function makeReq(body: Record<string, unknown>) {
  return { params: { id: 'p-1', storyIndex: '0' }, body } as any
}

describe('PUT /:id/stories/:storyIndex 故事级预算校验', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockProfileFindUnique.mockResolvedValue({
      id: 'p-1',
      userId: 'u-1',
      profile: JSON.stringify({ storyPool: [{ ...STORY, budget: { ...STORY.budget } }] }),
    })
    mockProfileUpdate.mockImplementation(async ({ data }: any) => ({
      id: 'p-1',
      profile: data.profile || '{}',
    }))
  })

  it('maxRetriesPerStep 越界（25）返回 400，错误信息含允许区间', async () => {
    const handler = getPutHandler('/:id/stories/:storyIndex')
    const res = createResponse()
    await handler(makeReq({ budget: { maxRetriesPerStep: 25 } }), res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ success: false, error: '单步重试须为 1–20 的整数（或留空继承角色级）' })
    // 中止时不落库
    expect(mockProfileUpdate).not.toHaveBeenCalled()
  })

  it('maxRetriesTotal 越界（0）返回 400，错误信息含允许区间', async () => {
    const handler = getPutHandler('/:id/stories/:storyIndex')
    const res = createResponse()
    await handler(makeReq({ budget: { maxRetriesTotal: 0 } }), res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ success: false, error: '会话调用上限须为 1–1000 的整数（或留空继承角色级）' })
    expect(mockProfileUpdate).not.toHaveBeenCalled()
  })

  it('maxRetriesTotal 越界（2000）返回 400', async () => {
    const handler = getPutHandler('/:id/stories/:storyIndex')
    const res = createResponse()
    await handler(makeReq({ budget: { maxRetriesTotal: 2000 } }), res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockProfileUpdate).not.toHaveBeenCalled()
  })

  it('合法值原样写入（3.7 → 4，500）', async () => {
    const handler = getPutHandler('/:id/stories/:storyIndex')
    const res = createResponse()
    await handler(makeReq({ budget: { maxRetriesPerStep: 3.7, maxRetriesTotal: 500 } }), res)
    expect(res.status).not.toHaveBeenCalledWith(400)
    const arg = mockProfileUpdate.mock.calls[0][0]
    const saved = JSON.parse(arg.data.profile)
    expect(saved.storyPool[0].budget).toEqual({ maxRetriesPerStep: 4, maxRetriesTotal: 500 })
  })

  it('budget 为空对象：清空故事级覆盖（继承角色级）', async () => {
    const handler = getPutHandler('/:id/stories/:storyIndex')
    const res = createResponse()
    await handler(makeReq({ budget: {} }), res)
    const arg = mockProfileUpdate.mock.calls[0][0]
    const saved = JSON.parse(arg.data.profile)
    expect(saved.storyPool[0].budget).toBeUndefined()
  })

  it('不携带 budget：既有 story.budget 原样保留', async () => {
    const handler = getPutHandler('/:id/stories/:storyIndex')
    const res = createResponse()
    await handler(makeReq({ title: '新标题' }), res)
    const arg = mockProfileUpdate.mock.calls[0][0]
    const saved = JSON.parse(arg.data.profile)
    expect(saved.storyPool[0].budget).toEqual({ maxRetriesPerStep: 3 })
    expect(saved.storyPool[0].title).toBe('新标题')
  })
})
