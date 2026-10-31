/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * H-3（2026-10-29 夜间审计）：收课解绑后的并发步不得把会话判死。
 *
 * 场景：non-convergence 收课（endSession + teachingSessionId=null，设计内保留现场等
 * restart-learning）之后，并行的下一个 teaching-step 发现无绑定教学会话。旧实现走
 * 「上游失败」分支把整个虚拟会话写成 status:'failed'（F07 实锤：autopilot 同步终态化、
 * wrapup 缺失，需人工 restart-learning）。修复后：跳过本步干净返回
 * （success:false + currentTaskStopped + error 保留「没有绑定教学会话」字样供
 * batch 驱动命中既有 regex），零会话状态写入。
 */
const mockVirtualSessionFindUnique = jest.fn()
const mockVirtualSessionUpdate = jest.fn()
const mockLearningPathFindUnique = jest.fn()
const mockExecuteSkill = jest.fn()
const mockProcessStudentMessage = jest.fn()

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    virtual_session_logs: {
      findMany: jest.fn(async (args: { select?: { bytes?: boolean } }) =>
        args.select && 'bytes' in args.select ? [] : [{ id: 1 }]),
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
    goal_conversations: {
      findFirst: jest.fn()
    }
  }
}))
jest.mock('../../services/learning/goal-conversation.service', () => ({ __esModule: true, default: {} }))
jest.mock('../../services/learning/learning.service', () => ({
  __esModule: true,
  default: { completeTask: jest.fn() }
}))
jest.mock('../path.coordinator', () => ({ __esModule: true, default: {} }))
jest.mock('../../services/ai-teaching/AITeachingCoordinator', () => ({
  __esModule: true,
  default: {
    startSession: jest.fn(),
    processStudentMessage: mockProcessStudentMessage,
    endSession: jest.fn(),
    getSessionDetail: jest.fn()
  }
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

describe('H-3：收课解绑后并发步不终局会话', () => {
  let sessionRecord: any
  let learningPath: any
  let coordinator: SimulationOrchestrator

  const task = (id: string, title: string, status = 'active') => ({
    id, title, status, estimatedMinutes: 20, order: 1
  })

  const buildPath = (...tasks: any[]) => ({
    id: 'path-1',
    milestones: [{ id: 'milestone-1', stageNumber: 1, title: '里程碑一', subtasks: tasks }]
  })

  // non-convergence 收课后的现场：teachingSessionId 已被清空，taskRuntime 保留原任务
  const buildLearningState = () => ({
    success: true,
    teachingSessionId: null,
    currentMilestone: 0,
    currentMilestoneTitle: '里程碑一',
    currentTaskIdx: 0,
    currentTaskId: 'task-1',
    currentTaskTitle: '任务一',
    totalMilestones: 1,
    conversationHistory: [],
    taskRuntime: { status: 'active', taskId: 'task-1', taskTitle: '任务一', teachingSessionId: null, turns: 3 }
  })

  beforeEach(() => {
    jest.clearAllMocks()
    coordinator = new SimulationOrchestrator()
    learningPath = buildPath(task('task-1', '任务一'))
    sessionRecord = {
      id: 'simulation-1',
      userId: 'user-1',
      status: 'running',
      currentStage: 'teaching',
      learningPathId: 'path-1',
      currentTaskId: 'task-1',
      stageResults: JSON.stringify({ teaching: buildLearningState(), runtimeStats: { aiCalls: 0 } }),
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
    }

    mockVirtualSessionFindUnique.mockImplementation(async () => sessionRecord)
    mockVirtualSessionUpdate.mockImplementation(async ({ data }: any) => {
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) sessionRecord[key] = value
      }
      return sessionRecord
    })
    mockLearningPathFindUnique.mockImplementation(async () => learningPath)
    mockExecuteSkill.mockResolvedValue({
      reply: '我没太懂，能再讲一下吗？',
      learnerState: { readyForNextTask: false },
      learnerFeedback: { selfReportedTaskDone: false, wantsMoreHelp: true, stopAsking: false, remainingBlockers: ['概念'] }
    })
  })

  it('无绑定教学会话 → 跳过本步（不写 failed，保留 currentTaskStopped 信号）', async () => {
    const result: any = await coordinator.executeLearningStep('simulation-1')

    expect(result.success).toBe(false)
    expect(result.error).toContain('没有绑定教学会话')
    expect(result.currentTaskStopped).toBe(true)

    // 会话非终局：保持 running，保留现场等 restart-learning
    expect(sessionRecord.status).toBe('running')
    // 任何 update 都不得携带 status:'failed'
    for (const call of mockVirtualSessionUpdate.mock.calls) {
      expect(call[0]?.data?.status).not.toBe('failed')
    }
    // 无绑定会话 = 不驱动教学回合
    expect(mockProcessStudentMessage).not.toHaveBeenCalled()
  })

  it('auto 循环遇到解绑现场 → 干净退出（不重启、不写 failed）', async () => {
    const result = await coordinator.executeAutoLearning('simulation-1', { maxTurns: 5 })

    expect(result.success).toBe(false)
    expect(String(result.error)).toContain('没有绑定教学会话')
    expect(sessionRecord.status).toBe('running')
    for (const call of mockVirtualSessionUpdate.mock.calls) {
      expect(call[0]?.data?.status).not.toBe('failed')
    }
  })
})
