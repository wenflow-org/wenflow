/**
 * requestStopLearning（旁路紧急停止）测试：
 * ① 租约空闲 → 标志写入 + 就地终态化（status=failed）
 * ② 租约被活跃循环持有（P2002）→ 返回 deferred，标志已写、状态保持 running，由循环退出时终态化
 * ③ 会话已是终态 → alreadyStopped，零写入
 */
const mockLeaseUpdateMany = jest.fn()
const mockLeaseCreate = jest.fn()
const mockLeaseDeleteMany = jest.fn()
const mockVirtualSessionFindUnique = jest.fn()
const mockVirtualSessionUpdate = jest.fn()

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    $transaction: async (callback: (tx: any) => Promise<any>) => callback({
      virtual_sessions: {
        findUnique: mockVirtualSessionFindUnique,
        update: mockVirtualSessionUpdate
      }
    }),
    virtual_experiment_leases: {
      updateMany: mockLeaseUpdateMany,
      create: mockLeaseCreate,
      deleteMany: mockLeaseDeleteMany
    },
    virtual_sessions: {
      findUnique: mockVirtualSessionFindUnique,
      update: mockVirtualSessionUpdate
    }
  }
}))
jest.mock('../../services/learning/goal-conversation.service', () => ({ __esModule: true, default: {} }))
jest.mock('../../services/learning/learning.service', () => ({ __esModule: true, default: {} }))
jest.mock('../path.coordinator', () => ({ __esModule: true, default: {} }))
jest.mock('../../services/ai-teaching/AITeachingCoordinator', () => ({
  __esModule: true,
  default: { resetSession: jest.fn(async () => ({})) }
}))
jest.mock('../../services/agentConfig.service', () => ({ getSimulationAgentConfig: jest.fn() }))
jest.mock('../../skills', () => ({
  executeSkill: jest.fn(),
  virtualLearnerGoalDialogueSimulatorDefinition: {},
  virtualLearnerPathEvaluatorDefinition: {},
  virtualLearnerLearnTurnSimulatorDefinition: {}
}))
jest.mock('../../skills/virtual-learner-shared', () => ({
  normalizeFrictionBudget: (value: string) => value || 'normal'
}))
jest.mock('../../skills/session-wrapup', () => ({ sessionWrapupAgent: { generate: jest.fn() } }))
jest.mock('../../services/learning/goal-path-visible-summary', () => ({
  buildGoalPathVisibleSummary: jest.fn()
}))
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}))

import { SimulationOrchestrator } from '../simulation.coordinator'

describe('SimulationOrchestrator requestStopLearning（旁路紧急停止）', () => {
  let sessionRecord: any
  let coordinator: SimulationOrchestrator

  const buildSession = (overrides: Record<string, unknown> = {}) => ({
    id: 'simulation-1',
    userId: 'user-1',
    status: 'running',
    currentStage: 'teaching',
    stageResults: JSON.stringify({ teaching: { teachingSessionId: null, taskRuntime: { status: 'active' } } }),
    logs: '[]',
    currentTaskId: 'task-1',
    virtual_learner_profiles: { id: 'profile-1', profile: '{}' },
    ...overrides
  })

  beforeEach(() => {
    jest.clearAllMocks()
    coordinator = new SimulationOrchestrator()
    sessionRecord = buildSession()

    // 无过期租约可接管
    mockLeaseUpdateMany.mockResolvedValue({ count: 0 })
    mockLeaseDeleteMany.mockResolvedValue({ count: 1 })
    mockVirtualSessionFindUnique.mockImplementation(async () => sessionRecord)
    mockVirtualSessionUpdate.mockImplementation(async ({ data }: any) => {
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) sessionRecord[key] = value
      }
      return sessionRecord
    })
  })

  it('租约空闲：写入 manualStop 标志并就地终态化（status=failed）', async () => {
    mockLeaseCreate.mockResolvedValue({})

    const result = await coordinator.requestStopLearning('simulation-1', 'admin-emergency-stop')

    expect(result).toEqual({ success: true })
    // 标志已落库
    const teaching = JSON.parse(sessionRecord.stageResults).teaching
    expect(teaching.manualStop).toBe(true)
    expect(teaching.stoppedReason).toBe('admin-emergency-stop')
    // 状态已终态化
    expect(sessionRecord.status).toBe('failed')
    // 租约已释放
    expect(mockLeaseDeleteMany).toHaveBeenCalledWith({ where: { sessionId: 'simulation-1', ownerId: expect.stringContaining('stop_') } })
  })

  it('租约被活跃循环持有：返回 deferred，标志已写但状态保持 running（由循环退出时终态化）', async () => {
    mockLeaseCreate.mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }))

    const result = await coordinator.requestStopLearning('simulation-1', 'admin-emergency-stop')

    expect(result).toEqual({ success: true, deferred: true })
    const teaching = JSON.parse(sessionRecord.stageResults).teaching
    expect(teaching.manualStop).toBe(true)
    expect(sessionRecord.status).toBe('running')
  })

  it('会话已是终态：alreadyStopped，零写入', async () => {
    sessionRecord = buildSession({ status: 'completed' })

    const result = await coordinator.requestStopLearning('simulation-1')

    expect(result).toEqual({ success: true, alreadyStopped: true })
    expect(mockLeaseCreate).not.toHaveBeenCalled()
    expect(mockVirtualSessionUpdate).not.toHaveBeenCalled()
  })

  it('重复停止：manualStop 已为 true 时跳过标志写入，仍尝试终态化', async () => {
    sessionRecord = buildSession({
      stageResults: JSON.stringify({ teaching: { manualStop: true, stoppedReason: 'admin-emergency-stop' } })
    })
    mockLeaseCreate.mockResolvedValue({})

    const result = await coordinator.requestStopLearning('simulation-1')

    expect(result).toEqual({ success: true })
    expect(sessionRecord.status).toBe('failed')
  })
})
