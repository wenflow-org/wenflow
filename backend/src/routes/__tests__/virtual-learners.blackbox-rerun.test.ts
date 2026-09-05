const mockPrisma: any = {
  virtual_sessions: {
    findUnique: jest.fn(),
    create: jest.fn()
  },
  virtual_learner_profiles: {
    findUnique: jest.fn(),
    update: jest.fn()
  }
}
const mockCreateExperimentState = jest.fn()

jest.mock('../../config/database', () => ({ __esModule: true, default: mockPrisma }))
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
jest.mock('../../utils/projection-token', () => ({
  signProjectionToken: jest.fn(),
  verifyProjectionToken: jest.fn()
}))
jest.mock('../../virtual-lab/blackbox-runner', () => ({
  __esModule: true,
  default: { createExperimentState: mockCreateExperimentState }
}))
jest.mock('../../virtual-lab/session-mode', () => ({ assertAssistedSessionMode: jest.fn() }))

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

describe('POST blackbox-rerun', () => {
  const actorProfile = { profile: { role: '快照角色' }, learningGoal: '快照目标' }
  const runtimeSnapshot = {
    capturedAt: '2026-07-17T08:00:00.000Z',
    routingUserId: 'admin-original',
    actorProfile,
    story: null,
    frictionBudget: 'high',
    simulatorPrompts: { goal: 'goal prompt', teaching: 'learn prompt' },
    simulators: {
      goal: {
        temperature: 0.2,
        maxTokens: 1200,
        route: {
          providerId: 'provider-1', credentialFingerprint: 'hash-1', endpoint: 'https://example.test/v1', model: 'model-1'
        }
      },
      teaching: {
        temperature: 0.3,
        maxTokens: 800,
        route: {
          providerId: 'provider-1', credentialFingerprint: 'hash-1', endpoint: 'https://example.test/v1', model: 'model-1'
        }
      }
    }
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockPrisma.virtual_learner_profiles.findUnique.mockResolvedValue({
      id: 'profile-1',
      userId: 'user-1',
      profile: JSON.stringify({ role: '后来修改的画像', storyPool: [{ id: '', title: '' }] }),
      learningGoal: '后来修改的目标',
      knownConcepts: '[]',
      struggleConcepts: '[]',
      personalityTraits: '{}'
    })
    mockCreateExperimentState.mockImplementation(async (input: any) => ({
      experiment: {
        experimentId: input.experimentId,
        runId: 'run-new',
        parentRunId: input.parentRunId,
        mode: 'blackbox-api'
      },
      experimentSnapshot: input.experimentSnapshotOverride,
      blackbox: { publicTrace: [], control: {}, refereeTrace: [], learnerPrivateState: {}, learnerPrivateStateTrace: [] }
    }))
    mockPrisma.virtual_sessions.create.mockImplementation(async ({ data }: any) => ({ ...data }))
  })

  it('仅终态源 Run 使用完整快照创建新 lineage，忽略请求中的摩擦覆盖', async () => {
    mockPrisma.virtual_sessions.findUnique.mockResolvedValue({
      id: 'source-session',
      virtualProfileId: 'profile-1',
      status: 'completed',
      stageResults: JSON.stringify({
        experiment: { mode: 'blackbox-api', experimentId: 'exp-1', runId: 'run-1' },
        experimentSnapshot: runtimeSnapshot
      })
    })
    const handler = getPostHandler('/sessions/:sessionId/blackbox-rerun')
    const res = createResponse()

    await handler({
      params: { sessionId: 'source-session' },
      user: { userId: 'admin-new' },
      body: { frictionBudget: 'none' }
    }, res)

    expect(mockCreateExperimentState).toHaveBeenCalledWith({
      operatorId: 'admin-new',
      actorProfile,
      story: null,
      frictionBudget: 'high',
      experimentId: 'exp-1',
      parentRunId: 'run-1',
      experimentSnapshotOverride: runtimeSnapshot
    })
    expect(mockPrisma.virtual_learner_profiles.update).not.toHaveBeenCalled()
    expect(mockPrisma.virtual_sessions.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        virtualProfileId: 'profile-1',
        status: 'created',
        currentStage: 'goal',
        logs: '[]'
      })
    })
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        experiment: expect.objectContaining({
          experimentId: 'exp-1',
          runId: 'run-new',
          parentRunId: 'run-1'
        })
      })
    }))
  })

  it('旧 Run 缺少完整运行时快照时拒绝伪同配置重跑', async () => {
    mockPrisma.virtual_sessions.findUnique.mockResolvedValue({
      id: 'legacy-session',
      virtualProfileId: 'profile-1',
      status: 'failed',
      stageResults: JSON.stringify({
        experiment: { mode: 'blackbox-api', experimentId: 'exp-1', runId: 'run-1' },
        experimentSnapshot: { actorProfile, frictionBudget: 'high' }
      })
    })
    const handler = getPostHandler('/sessions/:sessionId/blackbox-rerun')
    const res = createResponse()

    await handler({
      params: { sessionId: 'legacy-session' },
      user: { userId: 'admin-new' },
      body: {}
    }, res)

    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: '旧实验缺少完整运行时快照，不能保证同配置重跑'
    })
    expect(mockCreateExperimentState).not.toHaveBeenCalled()
    expect(mockPrisma.virtual_sessions.create).not.toHaveBeenCalled()
  })
})
