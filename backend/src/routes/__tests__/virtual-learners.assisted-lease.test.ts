const mockRunLeasedExclusive = jest.fn()
const mockExecuteLearningStep = jest.fn()
const mockExecuteAutoLearning = jest.fn()
const mockExecuteFullSession = jest.fn()
const mockVirtualSessionFindUnique = jest.fn()
const mockVirtualSessionCount = jest.fn()
const mockVirtualProfileFindUnique = jest.fn()
const mockVirtualProfileDelete = jest.fn()
const mockUserDelete = jest.fn()
const mockGoalConversationDeleteMany = jest.fn()
const mockLearningPathFindFirst = jest.fn()
const mockLearningPathDeleteMany = jest.fn()
const mockSubtaskFindMany = jest.fn()
const mockTeachingSessionFindFirst = jest.fn()
const mockVirtualSessionDelete = jest.fn()
const mockAssertPathMutationSafe = jest.fn()
const mockTransaction = jest.fn()
const mockBlackboxRunLeasedExclusive = jest.fn()
const mockBlackboxReferee = jest.fn()
const mockBlackboxActorAudit = jest.fn()

const mockSimulationCoordinator = {
  runLeasedExclusive: mockRunLeasedExclusive,
  executeLearningStep: mockExecuteLearningStep,
  executeAutoLearning: mockExecuteAutoLearning,
  executeFullSession: mockExecuteFullSession
}

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    virtual_sessions: {
      findUnique: mockVirtualSessionFindUnique,
      count: mockVirtualSessionCount
    },
    virtual_learner_profiles: { findUnique: mockVirtualProfileFindUnique },
    $transaction: mockTransaction
  }
}))
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}))
jest.mock('../../coordinators/simulation.coordinator', () => ({
  __esModule: true,
  default: mockSimulationCoordinator
}))
jest.mock('../../gateway', () => ({ getGateway: jest.fn(() => ({})) }))
jest.mock('../../skills/virtual-learner-persona-designer', () => ({ virtualLearnerPersonaDesignerDefinition: {} }))
jest.mock('../../skills/virtual-learner-scenario-designer', () => ({ virtualLearnerScenarioDesignerDefinition: {} }))
jest.mock('../../skills', () => ({ executeSkill: jest.fn() }))
jest.mock('../../services/learning/learning.service', () => ({ __esModule: true, default: {} }))
jest.mock('../../services/learning/path-mutation-safety', () => ({
  assertPathMutationSafe: mockAssertPathMutationSafe
}))
jest.mock('../../services/ai-teaching/TeachingSessionRepository', () => ({ teachingSessionRepository: {} }))
jest.mock('../../utils/projection-token', () => ({
  signProjectionToken: jest.fn(),
  verifyProjectionToken: jest.fn()
}))
jest.mock('../../virtual-lab/blackbox-runner', () => ({
  __esModule: true,
  default: {
    runLeasedExclusive: mockBlackboxRunLeasedExclusive,
    referee: mockBlackboxReferee,
    actorAudit: mockBlackboxActorAudit
  }
}))

import router from '../admin/virtual-learners'

function getPostHandler(path: string) {
  const layer = (router as any).stack.find((item: any) => item.route?.path === path && item.route?.methods?.post)
  if (!layer) throw new Error(`Route not found: ${path}`)
  return layer.route.stack[layer.route.stack.length - 1].handle
}

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

describe('assisted virtual learner route leases', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockVirtualSessionFindUnique.mockResolvedValue({
      id: 'session-1',
      userId: 'user-1',
      stageResults: '{}'
    })
    mockRunLeasedExclusive.mockImplementation(
      async (_sessionId: string, work: (assertLeaseOwned: () => void) => Promise<any>) => work(jest.fn())
    )
    mockExecuteLearningStep.mockResolvedValue({ success: true })
    mockExecuteAutoLearning.mockResolvedValue({ success: true, totalSteps: 1 })
    mockExecuteFullSession.mockResolvedValue({ success: true })
    mockVirtualSessionCount.mockResolvedValue(0)
    mockVirtualProfileFindUnique.mockResolvedValue({ id: 'profile-1', userId: 'user-1' })
    mockVirtualProfileDelete.mockResolvedValue({ id: 'profile-1' })
    mockUserDelete.mockResolvedValue({ id: 'user-1' })
    mockGoalConversationDeleteMany.mockResolvedValue({ count: 1 })
    mockLearningPathFindFirst.mockResolvedValue({ id: 'path-1' })
    mockLearningPathDeleteMany.mockResolvedValue({ count: 1 })
    mockSubtaskFindMany.mockResolvedValue([])
    mockTeachingSessionFindFirst.mockResolvedValue(null)
    mockVirtualSessionDelete.mockResolvedValue({ id: 'session-1' })
    mockAssertPathMutationSafe.mockResolvedValue(undefined)
    mockBlackboxRunLeasedExclusive.mockImplementation(async (_sessionId: string, work: () => Promise<any>) => work())
    mockBlackboxReferee.mockResolvedValue({ id: 'report-1' })
    mockBlackboxActorAudit.mockResolvedValue({ id: 'audit-1' })
    mockTransaction.mockImplementation(async (work: (tx: any) => Promise<any>) => work({
      virtual_learner_profiles: {
        findUnique: mockVirtualProfileFindUnique,
        delete: mockVirtualProfileDelete
      },
      users: { delete: mockUserDelete },
      virtual_sessions: {
        count: mockVirtualSessionCount,
        delete: mockVirtualSessionDelete
      },
      goal_conversations: { deleteMany: mockGoalConversationDeleteMany },
      learning_paths: {
        findFirst: mockLearningPathFindFirst,
        deleteMany: mockLearningPathDeleteMany
      },
      subtasks: { findMany: mockSubtaskFindMany },
      teaching_sessions: { findFirst: mockTeachingSessionFindFirst }
    }))
  })

  it('blocks profile deletion while virtual sessions still exist', async () => {
    mockVirtualSessionCount.mockResolvedValueOnce(1)
    const handler = getDeleteHandler('/:id')
    const res = createResponse()

    await handler({ params: { id: 'profile-1' }, user: { userId: 'admin-1' } }, res)

    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: '虚拟用户仍有模拟会话，请先逐个删除会话',
      code: 'VIRTUAL_PROFILE_HAS_SESSIONS'
    })
    expect(mockTransaction).not.toHaveBeenCalled()
    expect(mockVirtualProfileDelete).not.toHaveBeenCalled()
    expect(mockUserDelete).not.toHaveBeenCalled()
  })

  it('atomically rechecks sessions and deletes the profile with its user', async () => {
    const handler = getDeleteHandler('/:id')
    const res = createResponse()

    await handler({ params: { id: 'profile-1' }, user: { userId: 'admin-1' } }, res)

    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockVirtualSessionCount).toHaveBeenNthCalledWith(1, {
      where: { virtualProfileId: 'profile-1' }
    })
    expect(mockVirtualSessionCount).toHaveBeenNthCalledWith(2, {
      where: { virtualProfileId: 'profile-1' }
    })
    expect(mockVirtualProfileDelete).toHaveBeenCalledWith({ where: { id: 'profile-1' } })
    expect(mockUserDelete).toHaveBeenCalledWith({ where: { id: 'user-1' } })
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: '虚拟用户已删除'
    })
  })

  it('wraps teaching-step around the assisted check and coordinator mutation', async () => {
    const handler = getPostHandler('/sessions/:sessionId/teaching-step')
    const res = createResponse()

    await handler({ params: { sessionId: 'session-1' }, body: {} }, res)

    expect(mockRunLeasedExclusive).toHaveBeenCalledWith('session-1', expect.any(Function))
    expect(mockVirtualSessionFindUnique).toHaveBeenCalledWith({ where: { id: 'session-1' } })
    expect(mockExecuteLearningStep).toHaveBeenCalledWith('session-1')
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { success: true },
      error: undefined
    })
  })

  it('wraps the complete auto-learning operation once', async () => {
    const handler = getPostHandler('/sessions/:sessionId/auto-learning')
    const res = createResponse()

    await handler({ params: { sessionId: 'session-1' }, body: { maxMilestones: 4 } }, res)

    expect(mockRunLeasedExclusive).toHaveBeenCalledTimes(1)
    expect(mockRunLeasedExclusive).toHaveBeenCalledWith('session-1', expect.any(Function))
    expect(mockExecuteAutoLearning).toHaveBeenCalledWith('session-1', { maxMilestones: 4 })
  })

  it('performs a final lease assertion after the assisted mutation returns', async () => {
    const assertLeaseOwned = jest.fn()
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('模拟会话执行租约已丢失，请重试'), {
          code: 'VIRTUAL_SESSION_LEASE_LOST',
          statusCode: 409,
          retryable: true
        })
      })
    mockRunLeasedExclusive.mockImplementation(
      async (_sessionId: string, work: (assertLeaseOwned: () => void) => Promise<any>) => work(assertLeaseOwned)
    )
    const handler = getPostHandler('/sessions/:sessionId/teaching-step')
    const res = createResponse()

    await handler({ params: { sessionId: 'session-1' }, body: {} }, res)

    expect(mockExecuteLearningStep).toHaveBeenCalledWith('session-1')
    expect(assertLeaseOwned).toHaveBeenCalledTimes(2)
    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: '模拟会话执行租约已丢失，请重试',
      code: 'VIRTUAL_SESSION_LEASE_LOST',
      retryable: true
    })
  })

  it.each([
    ['/sessions/:sessionId/auto', { maxRounds: 51 }],
    ['/sessions/:sessionId/auto-learning', { maxMilestones: 0 }],
    ['/sessions/:sessionId/run-full', { maxRounds: 1.5, maxMilestones: 10 }],
    ['/sessions/:sessionId/run-full', { maxRounds: 20, maxMilestones: 21 }]
  ])('rejects invalid assisted simulation limits for %s', async (path, body) => {
    const handler = getPostHandler(path)
    const res = createResponse()

    await handler({ params: { sessionId: 'session-1' }, body }, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      code: 'INVALID_SIMULATION_LIMIT'
    }))
    expect(mockRunLeasedExclusive).not.toHaveBeenCalled()
  })

  it('rejects an invalid regression flow round limit before creating a session', async () => {
    const handler = getPostHandler('/:profileId/regression-run')
    const res = createResponse()

    await handler({
      params: { profileId: 'profile-1' },
      body: { maxGoalRounds: 51 },
      user: { userId: 'admin-1' }
    }, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      code: 'INVALID_SIMULATION_LIMIT'
    }))
    expect(mockVirtualSessionFindUnique).not.toHaveBeenCalled()
    expect(mockRunLeasedExclusive).not.toHaveBeenCalled()
  })

  it('returns the stable busy lease response as HTTP 409', async () => {
    mockRunLeasedExclusive.mockRejectedValue(Object.assign(
      new Error('当前模拟会话正在执行其他写操作，请稍后重试'),
      { code: 'VIRTUAL_SESSION_BUSY', statusCode: 409, retryable: true }
    ))
    const handler = getPostHandler('/sessions/:sessionId/teaching-step')
    const res = createResponse()

    await handler({ params: { sessionId: 'session-1' }, body: {} }, res)

    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: '当前模拟会话正在执行其他写操作，请稍后重试',
      code: 'VIRTUAL_SESSION_BUSY',
      retryable: true
    })
    expect(mockExecuteLearningStep).not.toHaveBeenCalled()
  })

  it.each([
    ['/sessions/:sessionId/blackbox-evaluations', '生成黑盒双评估报告失败']
  ])('uses the shared typed response for %s', async (path) => {
    mockBlackboxRunLeasedExclusive.mockRejectedValue(Object.assign(
      new Error('租约数据库暂时繁忙，请稍后重试'),
      { code: 'DB_BUSY', statusCode: 503, retryable: true }
    ))
    const handler = getPostHandler(path)
    const res = createResponse()

    await handler({ params: { sessionId: 'session-1' }, user: { userId: 'admin-1' } }, res)

    expect(res.status).toHaveBeenCalledWith(503)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: '租约数据库暂时繁忙，请稍后重试',
      code: 'DB_BUSY',
      retryable: true
    })
  })

  it('wraps deletion in the shared lease and atomically removes related records for blackbox sessions', async () => {
    const session = {
      id: 'session-1',
      userId: 'user-1',
      goalConversationId: 'goal-1',
      learningPathId: 'path-1',
      stageResults: JSON.stringify({ experiment: { mode: 'blackbox-api' } })
    }
    mockVirtualSessionFindUnique.mockResolvedValue(session)
    mockRunLeasedExclusive.mockImplementation(async (_sessionId: string, work: (assertLeaseOwned: () => void) => Promise<any>) => work(jest.fn()))
    const handler = getDeleteHandler('/sessions/:sessionId')
    const res = createResponse()

    await handler({ params: { sessionId: 'session-1' } }, res)

    expect(mockRunLeasedExclusive).toHaveBeenCalledWith(
      'session-1',
      expect.any(Function),
      { skipFinalLeaseCheck: true }
    )
    expect(mockVirtualSessionFindUnique).toHaveBeenCalledTimes(2)
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockLearningPathFindFirst).toHaveBeenCalledWith({
      where: { id: 'path-1', userId: 'user-1' },
      select: { id: true }
    })
    expect(mockAssertPathMutationSafe).toHaveBeenCalledWith(expect.any(Object), 'path-1', 'delete-path')
    expect(mockGoalConversationDeleteMany).toHaveBeenCalledWith({
      where: { id: 'goal-1', userId: 'user-1' }
    })
    expect(mockLearningPathDeleteMany).toHaveBeenCalledWith({
      where: { id: 'path-1', userId: 'user-1' }
    })
    expect(mockVirtualSessionDelete).toHaveBeenCalledWith({ where: { id: 'session-1' } })
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: '模拟会话已删除'
    })
  })

  it('rejects a leased session whose learning path is owned by another user', async () => {
    mockVirtualSessionFindUnique.mockResolvedValue({
      id: 'session-1',
      userId: 'user-1',
      goalConversationId: 'goal-1',
      learningPathId: 'path-other',
      stageResults: '{}'
    })
    mockLearningPathFindFirst.mockResolvedValue(null)
    const handler = getDeleteHandler('/sessions/:sessionId')
    const res = createResponse()

    await handler({ params: { sessionId: 'session-1' } }, res)

    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: '学习路径不属于当前虚拟学习者',
      code: 'VIRTUAL_SESSION_PATH_OWNERSHIP_MISMATCH'
    })
    expect(mockAssertPathMutationSafe).not.toHaveBeenCalled()
    expect(mockGoalConversationDeleteMany).not.toHaveBeenCalled()
    expect(mockLearningPathDeleteMany).not.toHaveBeenCalled()
    expect(mockVirtualSessionDelete).not.toHaveBeenCalled()
  })

  it('maps path mutation guard rejection to 409 and performs no deletion', async () => {
    mockVirtualSessionFindUnique.mockResolvedValue({
      id: 'session-1',
      userId: 'user-1',
      goalConversationId: 'goal-1',
      learningPathId: 'path-1',
      stageResults: '{}'
    })
    mockAssertPathMutationSafe.mockRejectedValue(Object.assign(
      new Error('学习路径已有学习进度，不能删除'),
      { code: 'PATH_MUTATION_HAS_LEARNING_PROGRESS', status: 409 }
    ))
    const handler = getDeleteHandler('/sessions/:sessionId')
    const res = createResponse()

    await handler({ params: { sessionId: 'session-1' } }, res)

    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: '学习路径已有学习进度，不能删除',
      code: 'PATH_MUTATION_HAS_LEARNING_PROGRESS'
    })
    expect(mockGoalConversationDeleteMany).not.toHaveBeenCalled()
    expect(mockLearningPathDeleteMany).not.toHaveBeenCalled()
    expect(mockVirtualSessionDelete).not.toHaveBeenCalled()
  })

  it('blocks deletion when the simulation still has an associated teaching record', async () => {
    mockVirtualSessionFindUnique.mockResolvedValue({
      id: 'session-1',
      userId: 'user-1',
      goalConversationId: 'goal-1',
      learningPathId: null,
      stageResults: JSON.stringify({ teaching: { teachingSessionId: 'teaching-1' } })
    })
    mockTeachingSessionFindFirst.mockResolvedValue({ id: 'teaching-1' })
    const handler = getDeleteHandler('/sessions/:sessionId')
    const res = createResponse()

    await handler({ params: { sessionId: 'session-1' } }, res)

    expect(mockTeachingSessionFindFirst).toHaveBeenCalledWith({
      where: { OR: [{ id: 'teaching-1' }] },
      select: { id: true }
    })
    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: '模拟会话仍有关联课堂记录，不能删除',
      code: 'VIRTUAL_SESSION_HAS_TEACHING_RECORDS'
    })
    expect(mockGoalConversationDeleteMany).not.toHaveBeenCalled()
    expect(mockLearningPathDeleteMany).not.toHaveBeenCalled()
    expect(mockVirtualSessionDelete).not.toHaveBeenCalled()
  })

  it('returns the stable busy response without starting the deletion transaction', async () => {
    mockRunLeasedExclusive.mockRejectedValue(Object.assign(
      new Error('当前模拟会话正在执行其他写操作，请稍后重试'),
      { code: 'VIRTUAL_SESSION_BUSY', statusCode: 409, retryable: true }
    ))
    const handler = getDeleteHandler('/sessions/:sessionId')
    const res = createResponse()

    await handler({ params: { sessionId: 'session-1' } }, res)

    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: '当前模拟会话正在执行其他写操作，请稍后重试',
      code: 'VIRTUAL_SESSION_BUSY',
      retryable: true
    })
    expect(mockTransaction).not.toHaveBeenCalled()
  })
})
