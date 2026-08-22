/**
 * executeFullSession（一键全流程）诚实返回 + 按 path 实际任务数跑完边界
 * 2026-08-22 修复验证：
 *  - Goal 未收敛 / 未进入 Path 生成 / Path 未就绪 / 未能进入教学阶段 → error（不再静默 success）
 *  - 任务边界预算按 path 实际任务数计算（多任务 path 一次点击可跑完）
 *  - 无进展（0 回合）/ 边界耗尽未完成 → 显式 error
 */
const mockVirtualSessionFindUnique = jest.fn()
const mockVirtualSessionUpdate = jest.fn()
const mockLearningPathFindUnique = jest.fn()
const mockMilestonesCount = jest.fn()
const mockMilestonesFindMany = jest.fn()
const mockExecuteSkill = jest.fn()

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    virtual_sessions: {
      findUnique: mockVirtualSessionFindUnique,
      update: mockVirtualSessionUpdate
    },
    learning_paths: {
      findUnique: mockLearningPathFindUnique
    },
    milestones: {
      count: mockMilestonesCount,
      findMany: mockMilestonesFindMany
    },
    goal_conversations: {
      findFirst: jest.fn()
    }
  }
}))
jest.mock('../../services/learning/goal-conversation.service', () => ({
  __esModule: true,
  default: {}
}))
jest.mock('../../services/learning/learning.service', () => ({
  __esModule: true,
  default: {}
}))
jest.mock('../path.coordinator', () => ({
  __esModule: true,
  default: {}
}))
jest.mock('../../services/ai-teaching/AITeachingCoordinator', () => ({
  __esModule: true,
  default: {}
}))
jest.mock('../../services/agentConfig.service', () => ({
  getSimulationAgentConfig: jest.fn().mockResolvedValue({ maxRounds: 10 })
}))
jest.mock('../../skills', () => ({
  executeSkill: mockExecuteSkill,
  virtualLearnerGoalDialogueSimulatorDefinition: {},
  virtualLearnerPathEvaluatorDefinition: {},
  virtualLearnerLearnTurnSimulatorDefinition: {}
}))
jest.mock('../../skills/virtual-learner-shared', () => ({
  normalizeFrictionBudget: (value: string) => value || 'normal'
}))
jest.mock('../../skills/session-wrapup', () => ({
  sessionWrapupAgent: { generate: jest.fn() }
}))
jest.mock('../../services/learning/goal-path-visible-summary', () => ({
  buildGoalPathVisibleSummary: jest.fn()
}))
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}))

import { SimulationOrchestrator } from '../simulation.coordinator'

describe('SimulationOrchestrator.executeFullSession 诚实返回', () => {
  let coordinator: SimulationOrchestrator
  let sessionRecord: any

  const buildSession = (stage: string, status = 'running') => ({
    id: 'simulation-1',
    userId: 'user-1',
    status,
    currentStage: stage,
    learningPathId: stage === 'teaching' ? 'path-1' : null,
    currentTaskId: stage === 'teaching' ? 'task-1' : null,
    completedTasks: 0,
    totalTasks: 0,
    stageResults: JSON.stringify({}),
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
    sessionRecord = buildSession('goal')
    mockVirtualSessionFindUnique.mockImplementation(async () => sessionRecord)
    mockVirtualSessionUpdate.mockImplementation(async ({ data }: any) => {
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) sessionRecord[key] = value
      }
      return sessionRecord
    })
  })

  it('Goal 未在 maxRounds 内收敛 → error，不再静默 success', async () => {
    ;(coordinator as any).executeAutoLoop = jest.fn().mockResolvedValue([
      { success: true, goalReady: false, error: undefined }
    ])

    const result = await coordinator.executeFullSession('simulation-1', { maxRounds: 10 })

    expect(result.success).toBe(false)
    expect(result.error).toContain('未收敛')
    expect(result.goalRounds).toBe(1)
  })

  it('Goal 已收敛但未进入 Path 生成（阶段停在 goal）→ error', async () => {
    ;(coordinator as any).executeAutoLoop = jest.fn().mockResolvedValue([
      { success: true, goalReady: true }
    ])

    const result = await coordinator.executeFullSession('simulation-1', { maxRounds: 10 })

    expect(result.success).toBe(false)
    expect(result.error).toContain('未进入 Path 生成')
  })

  it('Path 未就绪（waitForPathReady 不 ready）→ error', async () => {
    sessionRecord = buildSession('path')
    ;(coordinator as any).executeAutoLoop = jest.fn().mockResolvedValue([
      { success: true, goalReady: true }
    ])
    ;(coordinator as any).waitForPathReady = jest.fn().mockResolvedValue({
      ready: false,
      reason: '路径生成未产出里程碑（path status=failed）'
    })

    const result = await coordinator.executeFullSession('simulation-1', { maxRounds: 10 })

    expect(result.success).toBe(false)
    expect(result.error).toContain('路径生成未产出里程碑')
  })

  it('任务边界预算按 path 实际任务数：5 任务 path 一次点击全部跑完（旧上限 3 会截断）', async () => {
    sessionRecord = buildSession('teaching', 'running')
    mockLearningPathFindUnique.mockResolvedValue({ id: 'path-1', status: 'active' })
    // path 实际 5 个任务
    mockMilestonesFindMany.mockResolvedValue([
      { subtasks: [{ id: 't1' }, { id: 't2' }] },
      { subtasks: [{ id: 't3' }] },
      { subtasks: [{ id: 't4' }, { id: 't5' }] }
    ])
    const learnStub = jest.fn()
      .mockImplementationOnce(async () => (sessionRecord.completedTasks = 1, { success: true, totalSteps: 4 }))
      .mockImplementationOnce(async () => (sessionRecord.completedTasks = 2, { success: true, totalSteps: 3 }))
      .mockImplementationOnce(async () => (sessionRecord.completedTasks = 3, { success: true, totalSteps: 5 }))
      .mockImplementationOnce(async () => (sessionRecord.completedTasks = 4, { success: true, totalSteps: 2 }))
      .mockImplementationOnce(async () => (sessionRecord.status = 'completed', { success: true, totalSteps: 1 }))
    ;(coordinator as any).executeAutoLearning = learnStub

    const result = await coordinator.executeFullSession('simulation-1', {
      maxRounds: 10,
      maxMilestones: 1 // 旧逻辑 budget=1*3=3 < 5 会提前截断；新逻辑按任务数 5+2
    })

    expect(result.isPathCompleted).toBe(true)
    expect(result.success).toBe(true)
    expect(learnStub).toHaveBeenCalledTimes(5)
    expect(result.error).toBeUndefined()
  })

  it('边界预算耗尽仍未完成 → 显式 error（不再静默 success）', async () => {
    sessionRecord = buildSession('teaching', 'running')
    mockMilestonesFindMany.mockResolvedValue([
      { subtasks: [{ id: 't1' }, { id: 't2' }] }
    ])
    // 2 任务 → budget = 2+2 = 4；循环 4 次后仍未 completed
    const learnStub = jest.fn().mockImplementation(async () => ({ success: true, totalSteps: 3 }))
    ;(coordinator as any).executeAutoLearning = learnStub

    const result = await coordinator.executeFullSession('simulation-1', {})

    expect(result.success).toBe(false)
    expect(result.error).toContain('预算')
    expect(learnStub).toHaveBeenCalledTimes(4)
  })

  it('自动学习无进展（0 回合）→ 显式 error', async () => {
    sessionRecord = buildSession('teaching', 'running')
    mockMilestonesFindMany.mockResolvedValue([
      { subtasks: [{ id: 't1' }] }
    ])
    ;(coordinator as any).executeAutoLearning = jest.fn()
      .mockResolvedValue({ success: true, totalSteps: 0 })

    const result = await coordinator.executeFullSession('simulation-1', {})

    expect(result.success).toBe(false)
    expect(result.error).toContain('无进展')
  })

  it('waitForPathReady：里程碑落地后 ready', async () => {
    mockMilestonesCount
      .mockResolvedValueOnce(0)
      .mockResolvedValue(1)
    const immediateSetTimeout = jest.spyOn(global, 'setTimeout').mockImplementation((fn: any) => {
      if (typeof fn === 'function') fn()
      return 0 as any
    })
    try {
      const result = await (coordinator as any).waitForPathReady('simulation-1', 'path-1', 200)
      expect(result).toEqual({ ready: true })
    } finally {
      immediateSetTimeout.mockRestore()
    }
  })

  it('waitForPathReady：path 已 failed 且无里程碑 → 拒绝等待并说明原因', async () => {
    mockMilestonesCount.mockResolvedValue(0)
    mockLearningPathFindUnique.mockResolvedValue({ id: 'path-1', status: 'failed' })
    const immediateSetTimeout = jest.spyOn(global, 'setTimeout').mockImplementation((fn: any) => {
      if (typeof fn === 'function') fn()
      return 0 as any
    })
    try {
      const result = await (coordinator as any).waitForPathReady('simulation-1', 'path-1', 200)
      expect(result.ready).toBe(false)
      expect(result.reason).toContain('未产出里程碑')
    } finally {
      immediateSetTimeout.mockRestore()
    }
  })
})