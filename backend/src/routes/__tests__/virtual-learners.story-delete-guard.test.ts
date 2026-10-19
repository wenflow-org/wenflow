/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * DELETE /:id/stories/:storyIndex 在用守卫（issue #90 方案 B）
 *
 * 故事的引用不在表列上，而在会话 stageResults.story 快照里；读侧（GET /:id/stories）
 * 用 isSameStory 启发式把会话归到故事名下。本护栏锁：有引用 → 409 拒绝删除（不落库），
 * 无引用 → 原样删除；判据与读侧同源（storyId 精确匹配 + title/triggerEvent 启发式）。
 */
const mockProfileFindUnique = jest.fn()
const mockProfileUpdate = jest.fn()
const mockSessionFindMany = jest.fn()

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    virtual_learner_profiles: { findUnique: mockProfileFindUnique, update: mockProfileUpdate },
    users: {},
    virtual_sessions: { findMany: mockSessionFindMany },
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

const STORIES = [
  { id: 'story_a', title: '故事一', storyTriggerEvent: 'trig_a', storyOutline: 'o1' },
  { id: 'story_b', title: '故事二', storyTriggerEvent: 'trig_b', storyOutline: 'o2' },
]

function getDeleteHandler(path: string) {
  const layer = (router as any).stack.find((item: any) => item.route?.path === path && item.route?.methods?.delete)
  if (!layer) throw new Error(`Route not found: ${path}`)
  return layer.route.stack[layer.route.stack.length - 1].handle
}

function createResponse() {
  const res: any = { status: jest.fn(), json: jest.fn() }
  res.status.mockReturnValue(res)
  res.json.mockReturnValue(res)
  return res
}

function makeReq(storyIndex: string) {
  return { params: { id: 'p-1', storyIndex }, body: {} } as any
}

function sessionWithStory(story: Record<string, unknown> | null) {
  return {
    id: 'vs-1',
    status: 'completed',
    stageResults: JSON.stringify(story ? { story } : {}),
  }
}

describe('DELETE /:id/stories/:storyIndex 在用守卫（#90）', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockProfileFindUnique.mockResolvedValue({
      id: 'p-1',
      userId: 'u-1',
      profile: JSON.stringify({ storyPool: STORIES.map((s) => ({ ...s })) }),
    })
    mockProfileUpdate.mockImplementation(async ({ data }: any) => ({ id: 'p-1', profile: data.profile }))
    mockSessionFindMany.mockResolvedValue([])
  })

  it('会话按 storyId 引用 → 409 + code=STORY_IN_USE，不落库', async () => {
    mockSessionFindMany.mockResolvedValue([
      sessionWithStory({ storyId: 'story_a', title: '故事一', triggerEvent: 'trig_a' }),
    ])
    const res = createResponse()
    await getDeleteHandler('/:id/stories/:storyIndex')(makeReq('0'), res)

    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, code: 'STORY_IN_USE', data: { sessionCount: 1 } })
    )
    expect(mockProfileUpdate).not.toHaveBeenCalled()
  })

  it('会话无 storyId、按 title+triggerEvent 启发式命中（读侧同判据）→ 409', async () => {
    mockSessionFindMany.mockResolvedValue([
      sessionWithStory({ title: '故事二', triggerEvent: 'trig_b' }),
    ])
    const res = createResponse()
    await getDeleteHandler('/:id/stories/:storyIndex')(makeReq('1'), res)

    expect(res.status).toHaveBeenCalledWith(409)
    expect(mockProfileUpdate).not.toHaveBeenCalled()
  })

  it('引用检查看全量会话（按 virtualProfileId 拉取，不做样本截断）', async () => {
    const res = createResponse()
    await getDeleteHandler('/:id/stories/:storyIndex')(makeReq('0'), res)

    expect(mockSessionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { virtualProfileId: 'p-1' } })
    )
  })

  it('无会话引用 → 原样删除（正常路径行为不变）', async () => {
    mockSessionFindMany.mockResolvedValue([
      sessionWithStory({ storyId: 'story_b', title: '故事二', triggerEvent: 'trig_b' }),
    ])
    const res = createResponse()
    await getDeleteHandler('/:id/stories/:storyIndex')(makeReq('0'), res)

    expect(res.status).not.toHaveBeenCalledWith(409)
    const saved = JSON.parse(mockProfileUpdate.mock.calls[0][0].data.profile)
    expect(saved.storyPool.map((s: any) => s.id)).toEqual(['story_b'])
  })

  it('stageResults 解析失败/无 story 字段 → 不视为引用，不阻塞删除', async () => {
    mockSessionFindMany.mockResolvedValue([
      { id: 'vs-broken', status: 'running', stageResults: '{not json' },
      { id: 'vs-empty', status: 'created', stageResults: null },
    ])
    const res = createResponse()
    await getDeleteHandler('/:id/stories/:storyIndex')(makeReq('0'), res)

    expect(mockProfileUpdate).toHaveBeenCalledTimes(1)
  })

  it('无效索引 → 400（既有行为不变，且不做会话查询）', async () => {
    const res = createResponse()
    await getDeleteHandler('/:id/stories/:storyIndex')(makeReq('9'), res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockSessionFindMany).not.toHaveBeenCalled()
    expect(mockProfileUpdate).not.toHaveBeenCalled()
  })
})
