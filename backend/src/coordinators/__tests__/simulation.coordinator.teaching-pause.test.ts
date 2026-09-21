/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 新发现问题 #3：教学回合「模型抖动」（如 TEACHING_TURN_REPLY_MISSING）不再终局化会话。
 *
 * 固定行为：
 *  - 步骤级有界额外重试（prompt 级 2 次之外，再至多 2 次）；
 *  - 重试耗尽 → 会话保持 running（不 failed），落 runtimeStats.lastError 可续跑标记；
 *  - **绝不伪造教师回复**：暂停路径不追加任何 assistant 消息；
 *  - 抖动恢复后标记被清除，成功路径不被污染。
 */
const mockVirtualSessionFindUnique = jest.fn()
const mockVirtualSessionUpdate = jest.fn()
const mockLearningPathFindUnique = jest.fn()
const mockCompleteTask = jest.fn()
const mockExecuteSkill = jest.fn()
const mockProcessStudentMessage = jest.fn()
const mockEndSession = jest.fn()
const mockGetSessionDetail = jest.fn()
const mockStartSession = jest.fn()

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    // 日志子表（appendSessionLogs）：侧表已有行 → 跳过播种；裁剪扫描返回空
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
  default: { completeTask: mockCompleteTask }
}))
jest.mock('../path.coordinator', () => ({ __esModule: true, default: {} }))
jest.mock('../../services/ai-teaching/AITeachingCoordinator', () => ({
  __esModule: true,
  default: {
    startSession: mockStartSession,
    processStudentMessage: mockProcessStudentMessage,
    endSession: mockEndSession,
    getSessionDetail: mockGetSessionDetail
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

import { SimulationOrchestrator, isTeachingTurnHiccupError } from '../simulation.coordinator'

describe('SimulationOrchestrator 教学回合抖动（新发现问题 #3）', () => {
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

  const buildLearningState = () => ({
    success: true,
    teachingSessionId: 'teaching-1',
    teachingRevision: 1,
    currentMilestone: 0,
    currentMilestoneTitle: '里程碑一',
    currentTaskIdx: 0,
    currentTaskId: 'task-1',
    currentTaskTitle: '任务一',
    totalMilestones: 1,
    conversationHistory: [],
    taskRuntime: { status: 'active', taskId: 'task-1', taskTitle: '任务一', teachingSessionId: 'teaching-1', turns: 1 }
  })

  const getLearningState = () => JSON.parse(sessionRecord.stageResults).teaching

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
    mockProcessStudentMessage.mockResolvedValue({
      revision: 2,
      aiResponse: '我们从基础开始再走一遍。',
      isCompletion: false,
      autoEnded: false,
      analysis: { cognitiveLevel: 'understand' },
      knowledgePoints: [],
      strategies: []
    })
    mockEndSession.mockResolvedValue({ revision: 3 })
  })

  it('isTeachingTurnHiccupError 只认结构化抖动码', () => {
    expect(isTeachingTurnHiccupError(new Error('TEACHING_TURN_REPLY_MISSING'))).toBe(true)
    expect(isTeachingTurnHiccupError('TEACHING_TURN_REQUIRED_BLOCK_MISSING')).toBe(true)
    expect(isTeachingTurnHiccupError(new Error('TEACHING_TURN_REPLY_COMPLETION_MISMATCH'))).toBe(true)
    expect(isTeachingTurnHiccupError(new Error('VIRTUAL_LEARNER_LEARN_TURN_SIMULATION_FAILED'))).toBe(false)
    expect(isTeachingTurnHiccupError(new Error('fetch failed'))).toBe(false)
    expect(isTeachingTurnHiccupError(null)).toBe(false)
  })

  it('步骤级重试耗尽 → 保持 running + 暂停标记，不终局、不伪造回复', async () => {
    mockProcessStudentMessage.mockRejectedValue(new Error('TEACHING_TURN_REPLY_MISSING'))

    jest.useFakeTimers()
    let result: any
    try {
      const pending = coordinator.executeLearningStep('simulation-1')
      await jest.advanceTimersByTimeAsync(20_000)
      result = await pending
    } finally {
      jest.useRealTimers()
    }

    // 1 次 + 步骤级额外 2 次
    expect(mockProcessStudentMessage).toHaveBeenCalledTimes(3)
    expect(result).toEqual(expect.objectContaining({ success: false }))
    expect(result.error).toContain('TEACHING_TURN_REPLY_MISSING')

    // 会话非终局：保持 running，供下一次 advance-day 续跑
    expect(sessionRecord.status).toBe('running')
    // 可续跑标记
    const stats = JSON.parse(sessionRecord.stageResults).runtimeStats
    expect(stats.lastError).toEqual(expect.objectContaining({
      code: 'TEACHING_TURN_STEP_PAUSED',
      retryable: true
    }))
    expect(stats.lastError.message).toContain('TEACHING_TURN_REPLY_MISSING')

    // 未终局化、未收束
    expect(mockEndSession).not.toHaveBeenCalled()
    // 不伪造教师回复：暂停路径不写回 teaching（对话历史维持原样）
    const learning = getLearningState()
    expect(learning.conversationHistory).toEqual([])
    expect(learning.taskRuntime.status).toBe('active')
  })

  it('抖动后重试成功 → 成功路径不受影响，暂停标记被清除', async () => {
    // 先制造一次暂停标记（模拟上一次已暂停），再让本回合第一次重试成功
    sessionRecord.stageResults = JSON.stringify({
      teaching: buildLearningState(),
      runtimeStats: { aiCalls: 0, lastError: { code: 'TEACHING_TURN_STEP_PAUSED', message: 'TEACHING_TURN_REPLY_MISSING', retryable: true, at: '2026-09-19T00:00:00.000Z' } }
    })
    mockProcessStudentMessage
      .mockRejectedValueOnce(new Error('TEACHING_TURN_REPLY_MISSING'))
      .mockResolvedValueOnce({
        revision: 2,
        aiResponse: '好，我们继续。',
        isCompletion: false,
        autoEnded: false,
        analysis: { cognitiveLevel: 'understand' },
        knowledgePoints: [],
        strategies: []
      })

    jest.useFakeTimers()
    let result: any
    try {
      const pending = coordinator.executeLearningStep('simulation-1')
      await jest.advanceTimersByTimeAsync(20_000)
      result = await pending
    } finally {
      jest.useRealTimers()
    }

    expect(mockProcessStudentMessage).toHaveBeenCalledTimes(2)
    expect(result.success).toBe(true)
    expect(sessionRecord.status).toBe('running')
    const stats = JSON.parse(sessionRecord.stageResults).runtimeStats
    expect(stats.lastError).toBeUndefined()
  })
})
