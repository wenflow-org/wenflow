/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 终局语义收敛回归（全量测试报告 #10）：僵尸回收（abandoned）/失败的会话不得再被任何
 * 「推进」入口继续驱动——报告证据为 62 个会话在回收 20~30 分钟后仍写 path-review/stage-transition
 * 推进日志（30 个至今 abandoned）。回收前的旧代码里 path 阶段入口没有终态闸门。
 *
 * 闸门覆盖：advanceToPathGeneration / reviewPathProposal / acceptPathReview /
 * replanPathFromReview / resolvePathReview / startLearningPhase。
 * 显式复活（restartLearningPhase / restartPathPhase）不受影响（先把状态恢复 running）。
 */
const mockVirtualSessionFindUnique = jest.fn()
const mockVirtualSessionUpdate = jest.fn()
const mockLearningPathFindUnique = jest.fn()
const mockMilestonesFindMany = jest.fn()
const mockExecuteSkill = jest.fn()
const mockUpdateStageResults = jest.fn()
const mockAddSessionLog = jest.fn()
const mockAddSessionLogs = jest.fn()
const mockProcessStudentMessage = jest.fn()

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    virtual_session_logs: {
      findMany: jest.fn(async () => []),
      createMany: jest.fn(async () => ({})),
      deleteMany: jest.fn(async () => ({}))
    },
    $transaction: async (callback: (tx: any) => Promise<any>) => callback({
      virtual_sessions: {
        findUnique: mockVirtualSessionFindUnique,
        update: mockVirtualSessionUpdate
      }
    }),
    virtual_sessions: {
      findUnique: mockVirtualSessionFindUnique,
      update: mockVirtualSessionUpdate
    },
    learning_paths: {
      findUnique: mockLearningPathFindUnique
    },
    milestones: {
      findMany: mockMilestonesFindMany
    },
    goal_conversations: {
      findFirst: jest.fn(),
      update: jest.fn()
    }
  }
}))
jest.mock('../../services/learning/goal-conversation.service', () => ({ __esModule: true, default: {} }))
jest.mock('../../services/learning/learning.service', () => ({ __esModule: true, default: {} }))
jest.mock('../path.coordinator', () => ({ __esModule: true, default: { generateFromGoal: jest.fn() } }))
jest.mock('../../services/ai-teaching/AITeachingCoordinator', () => ({
  __esModule: true,
  default: { startSession: jest.fn(), processStudentMessage: mockProcessStudentMessage, endSession: jest.fn(), getSessionDetail: jest.fn() }
}))
jest.mock('../../services/agentConfig.service', () => ({ getSimulationAgentConfig: jest.fn() }))
jest.mock('../../skills', () => ({
  executeSkill: mockExecuteSkill,
  virtualLearnerGoalDialogueSimulatorDefinition: {},
  virtualLearnerPathEvaluatorDefinition: {},
  virtualLearnerLearnTurnSimulatorDefinition: {}
}))
jest.mock('../../skills/virtual-learner-shared', () => ({
  normalizeFrictionBudget: (value: string) => value || 'normal'
}))
jest.mock('../../skills/session-wrapup', () => ({ sessionWrapupAgent: { generate: jest.fn() } }))
jest.mock('../../services/learning/goal-path-visible-summary', () => ({ buildGoalPathVisibleSummary: jest.fn() }))
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}))
jest.mock('../../services/virtual-lab/simulated-day.service', () => ({
  __esModule: true,
  default: { getTemporalContext: jest.fn().mockResolvedValue(null) },
  simulatedDayService: { getTemporalContext: jest.fn().mockResolvedValue(null) },
  temporalContextFromClock: jest.fn(() => null)
}))

import { SimulationOrchestrator } from '../simulation.coordinator'

describe('推进入口终态闸门（报告 #10：回收/失败后不得继续推进）', () => {
  let sessionRecord: any
  let coordinator: SimulationOrchestrator

  const reclaimedStageResults = () => JSON.stringify({
    staleReclaim: {
      reason: 'stale-session-timeout',
      reclaimedAt: '2026-10-04T10:10:00.000Z',
      staleMs: 25 * 60 * 60 * 1000,
      thresholdMs: 24 * 60 * 60 * 1000,
      previousStatus: 'running',
    },
    teaching: { teachingSessionId: 'teaching-1' },
  })

  const makeSession = (status: string) => ({
    id: 'simulation-1',
    userId: 'user-1',
    status,
    currentStage: 'path-accepted',
    learningPathId: 'path-1',
    goalConversationId: 'goal-1',
    stageResults: status === 'abandoned' ? reclaimedStageResults() : JSON.stringify({}),
    logs: '[]',
    virtual_learner_profiles: {
      id: 'profile-1',
      userId: 'user-1',
      profile: '{}',
      learningGoal: '完成任务',
      knowledgeLevel: 'beginner',
      knownConcepts: '[]',
      struggleConcepts: '[]',
      personalityTraits: '{}'
    }
  })

  beforeEach(() => {
    jest.clearAllMocks()
    coordinator = new SimulationOrchestrator()
    // 探针：任何 path/日志写入都要能被断言到
    jest.spyOn(coordinator, 'updateStageResults').mockImplementation(mockUpdateStageResults as any)
    jest.spyOn(coordinator, 'addSessionLog').mockImplementation(mockAddSessionLog as any)
    jest.spyOn(coordinator, 'addSessionLogs').mockImplementation(mockAddSessionLogs as any)
    mockVirtualSessionFindUnique.mockImplementation(async () => sessionRecord)
    mockVirtualSessionUpdate.mockImplementation(async ({ data }: any) => {
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) sessionRecord[key] = value
      }
      return sessionRecord
    })
    mockLearningPathFindUnique.mockImplementation(async () => ({ id: 'path-1', title: '路径', description: '描述', totalMilestones: 1, estimatedHours: 10, difficulty: 'medium' }))
    mockMilestonesFindMany.mockImplementation(async () => [])
    mockUpdateStageResults.mockResolvedValue(undefined)
    mockAddSessionLog.mockResolvedValue(undefined)
    mockExecuteSkill.mockResolvedValue({ reaction: '还行', debug: { internalDecision: 'accept' } })
  })

  it('abandoned（已回收）会话：五个推进入口全部拒绝，且零日志/零写入', async () => {
    sessionRecord = makeSession('abandoned')

    const review = await coordinator.reviewPathProposal('simulation-1')
    const resolve = await coordinator.resolvePathReview('simulation-1', { startLearning: true })
    const accept = await coordinator.acceptPathReview('simulation-1')
    const replan = await coordinator.replanPathFromReview('simulation-1')
    const start = await coordinator.startLearningPhase('simulation-1')

    for (const result of [review, resolve, accept, replan, start]) {
      expect(result.success).toBe(false)
      expect(String(result.error)).toContain('已停止')
    }
    // 零推进副作用：不调 LLM、不写日志、不写 stageResults
    expect(mockExecuteSkill).not.toHaveBeenCalled()
    expect(mockAddSessionLog).not.toHaveBeenCalled()
    expect(mockUpdateStageResults).not.toHaveBeenCalled()
  })

  it('failed 会话：同样拒绝评审与推进', async () => {
    sessionRecord = makeSession('failed')

    const review = await coordinator.reviewPathProposal('simulation-1')
    const resolve = await coordinator.resolvePathReview('simulation-1', { startLearning: true })

    expect(review.success).toBe(false)
    expect(resolve.success).toBe(false)
    expect(String(review.error)).toContain('已停止')
    expect(mockExecuteSkill).not.toHaveBeenCalled()
    expect(mockAddSessionLog).not.toHaveBeenCalled()
  })

  it('running 会话（对照）：闸门不误伤，评审正常进入执行链', async () => {
    sessionRecord = makeSession('running')

    const review = await coordinator.reviewPathProposal('simulation-1')

    // 通过闸门（LLM 被调用）——评审结果与闸门无关
    expect(mockExecuteSkill).toHaveBeenCalled()
    expect(review.success).toBe(true)
    expect(review.decision).toBe('accept')
  })

  it('abandoned 会话（如连续 error 收尾后被回收）：学习步骤被拒，错误链不再增长', async () => {
    sessionRecord = makeSession('abandoned')
    // 模拟「最后一轮还在报错」的残留状态：不清理、不再追加任何日志
    mockProcessStudentMessage.mockRejectedValue(new Error('PROVIDER_RETRY_BUDGET_EXHAUSTED'))

    const result = await coordinator.executeLearningStep('simulation-1')

    expect(result.success).toBe(false)
    expect(String(result.error)).toContain('已停止')
    expect(mockProcessStudentMessage).not.toHaveBeenCalled()
    expect(mockAddSessionLogs).not.toHaveBeenCalled()
    expect(mockAddSessionLog).not.toHaveBeenCalled()
  })
})
