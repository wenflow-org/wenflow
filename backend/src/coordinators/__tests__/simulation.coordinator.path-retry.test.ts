/**
 * retryPathGeneration —— 路径生成失败的自愈重试（新发现问题 #2）
 *
 * 平台既有重试能力（`getPathGenerationRetry` / `retryPathEnrichment` / `claimPathCoreGeneration`）
 * 此前虚拟 assisted 链路没有驱动。本用例锁定：
 *  - stageDesign → 走 `retryPathEnrichment`（补齐阶段任务，不重跑主结构）；
 *  - core → 先 `claimPathCoreGeneration` 原子认领，再 `runGoalAsync` 用同一 Goal 诉求异步重跑；
 *  - 不可重试 → 明确拒绝，不发起任何生成。
 */
const mockVirtualSessionFindUnique = jest.fn()
const mockVirtualSessionUpdate = jest.fn()
const mockGoalConversationFindFirst = jest.fn()
const mockGetPathGenerationRetry = jest.fn()
const mockRetryPathEnrichment = jest.fn()
const mockClaimPathCoreGeneration = jest.fn()
const mockMarkActiveGenerationFailed = jest.fn()
const mockRunGoalAsync = jest.fn()

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    virtual_sessions: {
      findUnique: mockVirtualSessionFindUnique,
      update: mockVirtualSessionUpdate
    },
    // 日志子表（appendSessionLogs）：侧表已有行 → 跳过播种；裁剪扫描返回空
    virtual_session_logs: {
      findMany: jest.fn(async (args: { select?: { bytes?: boolean } }) =>
        args.select && 'bytes' in args.select ? [] : [{ id: 1 }]),
      createMany: jest.fn(async () => ({})),
      deleteMany: jest.fn(async () => ({}))
    },
    goal_conversations: {
      findFirst: mockGoalConversationFindFirst
    }
  }
}))
jest.mock('../../services/learning/goal-conversation.service', () => ({ __esModule: true, default: {} }))
jest.mock('../../services/learning/learning.service', () => ({
  __esModule: true,
  default: {
    getPathGenerationRetry: mockGetPathGenerationRetry,
    retryPathEnrichment: mockRetryPathEnrichment,
    claimPathCoreGeneration: mockClaimPathCoreGeneration,
    markActiveGenerationFailed: mockMarkActiveGenerationFailed
  }
}))
jest.mock('../path.coordinator', () => ({
  __esModule: true,
  default: { runGoalAsync: mockRunGoalAsync }
}))
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
  buildGoalPathVisibleSummary: jest.fn(() => ({ rawGoal: 'x', confirmedProposal: null }))
}))
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}))

import { SimulationOrchestrator } from '../simulation.coordinator'

describe('SimulationOrchestrator.retryPathGeneration', () => {
  let coordinator: SimulationOrchestrator

  beforeEach(() => {
    jest.clearAllMocks()
    coordinator = new SimulationOrchestrator()

    mockVirtualSessionFindUnique.mockImplementation(async ({ select }: { select?: { logs?: boolean } }) => {
      if (select?.logs) return { logs: '[]' } // addSessionLog 只取 logs 列
      return {
        id: 'sim-1',
        userId: 'user-1',
        status: 'running',
        currentStage: 'path',
        learningPathId: 'path-1',
        goalConversationId: 'gc-1',
        stageResults: JSON.stringify({}),
        logs: '[]',
        virtual_learner_profiles: { id: 'profile-1', profile: '{}' }
      }
    })
    mockVirtualSessionUpdate.mockResolvedValue({})
    mockGoalConversationFindFirst.mockResolvedValue({
      id: 'gc-1',
      userId: 'user-1',
      description: '学会用历史客流数据预测高峰时段',
      collectedData: JSON.stringify({ understanding: {}, messages: [] })
    })
  })

  it('stageDesign 允许重试 → 调 retryPathEnrichment，不重跑主结构', async () => {
    mockGetPathGenerationRetry.mockResolvedValue({
      allowed: true, retryType: 'stageDesign', reason: 'failed', expectedActiveGenerationRunId: 'run-0'
    })
    mockRetryPathEnrichment.mockResolvedValue({ accepted: true, retryType: 'stageDesign', retryCount: 2, runId: 'run-1', mode: 'replace' })

    const result = await coordinator.retryPathGeneration('sim-1')

    expect(result).toMatchObject({ success: true, retryType: 'stageDesign', runId: 'run-1' })
    expect(mockRetryPathEnrichment).toHaveBeenCalledWith('path-1', 'user-1')
    expect(mockClaimPathCoreGeneration).not.toHaveBeenCalled()
    expect(mockRunGoalAsync).not.toHaveBeenCalled()
  })

  it('core 允许重试 → 先 claim 再 runGoalAsync（带 existingPathId/generationRunId）', async () => {
    mockGetPathGenerationRetry.mockResolvedValue({
      allowed: true, retryType: 'core', reason: 'failed', expectedActiveGenerationRunId: 'run-0'
    })
    mockClaimPathCoreGeneration.mockResolvedValue('run-9')

    const result = await coordinator.retryPathGeneration('sim-1')

    expect(result).toMatchObject({ success: true, retryType: 'core', runId: 'run-9' })
    expect(mockClaimPathCoreGeneration).toHaveBeenCalledWith('path-1', 'run-0')
    expect(mockRunGoalAsync).toHaveBeenCalledTimes(1)
    const [request, hooks] = mockRunGoalAsync.mock.calls[0]
    expect(request).toMatchObject({ existingPathId: 'path-1', generationRunId: 'run-9', source: 'goal' })
    expect(typeof hooks.onError).toBe('function')
    expect(mockRetryPathEnrichment).not.toHaveBeenCalled()
  })

  it('不可重试 → 明确拒绝，不发起任何生成', async () => {
    mockGetPathGenerationRetry.mockResolvedValue({
      allowed: false, retryType: null, reason: 'not-failed', expectedActiveGenerationRunId: null
    })

    const result = await coordinator.retryPathGeneration('sim-1')

    expect(result.success).toBe(false)
    expect(result.error).toContain('不能重试')
    expect(mockRetryPathEnrichment).not.toHaveBeenCalled()
    expect(mockClaimPathCoreGeneration).not.toHaveBeenCalled()
    expect(mockRunGoalAsync).not.toHaveBeenCalled()
  })
})
