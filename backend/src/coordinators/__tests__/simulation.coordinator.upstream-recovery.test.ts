/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 错误链回归（全量测试报告 #9/#12）：
 *  - 上游重试预算耗尽（RETRY_BUDGET_EXHAUSTED，transient）→ 非终局暂停：会话保持 running、
 *    保留同一 task、不伪造教师回复、不终局化；
 *  - 「重试耗尽后仍能推进」：下一次 advance 成功续跑，并可一路推进到 task/path completed
 *    （报告缺口原文：「无『重试耗尽后仍能推进到下一个 task/completed』断言」）。
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

import { SimulationOrchestrator } from '../simulation.coordinator'

/** 网关重试预算耗尽的终止错误（category 决定 transient 归类，与 executor.ts:1136 同形状） */
function retryBudgetError() {
  return Object.assign(new Error('RETRY_BUDGET_EXHAUSTED: provider retry budget exhausted'), {
    code: 'RETRY_BUDGET_EXHAUSTED',
    category: 'provider_timeout',
    statusCode: 503
  })
}

describe('上游重试耗尽 → 暂停 → 续跑到 completed（报告 #9/#12）', () => {
  let sessionRecord: any
  let learningPath: any
  let coordinator: SimulationOrchestrator
  let addSessionLogsSpy: jest.SpyInstance
  let completeTaskSpy: jest.SpyInstance
  let wrapupSpy: jest.SpyInstance

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
  const getRuntimeStats = () => JSON.parse(sessionRecord.stageResults).runtimeStats

  const runStep = async () => {
    jest.useFakeTimers()
    try {
      const pending = coordinator.executeLearningStep('simulation-1')
      await jest.advanceTimersByTimeAsync(20_000)
      return await pending
    } finally {
      jest.useRealTimers()
    }
  }

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

    addSessionLogsSpy = jest.spyOn(coordinator, 'addSessionLogs').mockResolvedValue(undefined as any)
    completeTaskSpy = jest.spyOn(coordinator, 'completeCheckpointedSimulationTask')
      .mockResolvedValue({ success: true, isPathCompleted: true, taskCompleted: true } as any)
    wrapupSpy = jest.spyOn(coordinator, 'generateWrapupForSession').mockResolvedValue({ success: true } as any)
  })

  it('重试预算耗尽 → 非终局暂停：保持 running、保留 task、不伪造回复、不终局化', async () => {
    mockProcessStudentMessage.mockRejectedValueOnce(retryBudgetError())

    const result = await runStep()

    expect(result.success).toBe(false)
    expect(String(result.error)).toContain('retry budget exhausted')

    // 非终局：会话保持 running，供下一次 advance 续跑
    expect(sessionRecord.status).toBe('running')
    const stats = getRuntimeStats()
    expect(stats.lastError).toEqual(expect.objectContaining({
      code: 'LEARN_UPSTREAM_TRANSIENT_PAUSED',
      retryable: true
    }))

    // 暂停证据落日志（action 区分上游突发 vs 模型抖动）
    const pauseLog = result.logs?.find((entry: any) => entry.phase === 'teaching-interrupted')
    expect(pauseLog?.details?.output?.action).toBe('teaching-step-upstream-paused')
    expect(pauseLog?.details?.output?.retryable).toBe(true)

    // 不伪造教师回复：对话历史不变、无 assistant 追加
    const learning = getLearningState()
    expect(learning.conversationHistory).toEqual([])
    expect(learning.taskRuntime.status).toBe('active')
    expect(mockEndSession).not.toHaveBeenCalled()
  })

  it('暂停后下一次 advance 成功续跑，并可推进到 path completed', async () => {
    // 第 1 轮：预算耗尽 → 暂停
    mockProcessStudentMessage.mockRejectedValueOnce(retryBudgetError())
    const paused = await runStep()
    expect(paused.success).toBe(false)

    // 第 2 轮：上游恢复；学习者自评完成 + 教师侧给收束信号 → 应推进到完成
    mockExecuteSkill.mockResolvedValue({
      reply: '我这边已经能讲清楚了，这个任务我觉得完成了。',
      learnerState: { readyForNextTask: true },
      learnerFeedback: { selfReportedTaskDone: true, wantsMoreHelp: false, stopAsking: true, remainingBlockers: [] }
    })
    mockProcessStudentMessage.mockResolvedValue({
      revision: 2,
      aiResponse: '不错，这一轮你独立讲清了关键步骤，本任务可以收束了。',
      isCompletion: true,
      autoEnded: false,
      analysis: { cognitiveLevel: 'apply' },
      knowledgePoints: [],
      strategies: []
    })

    const completed = await runStep()

    // 会话没有因一次上游突发而停摆：推进到了 task/path 完成
    expect(completed.success).toBe(true)
    expect((completed as any).isPathCompleted).toBe(true)
    expect(completeTaskSpy).toHaveBeenCalled()
    expect(mockEndSession).toHaveBeenCalled()

    // 完成留痕：stage-transition → completed + 生成学习总结
    const persistedLogs = addSessionLogsSpy.mock.calls.flatMap((call) => call[1] as any[])
    expect(persistedLogs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        phase: 'stage-transition',
        details: expect.objectContaining({
          output: expect.objectContaining({ from: 'teaching', to: 'completed' })
        })
      })
    ]))
    expect(wrapupSpy).toHaveBeenCalledWith('simulation-1')

    // 暂停标记已被清除（续跑成功路径不被污染）
    expect(getRuntimeStats().lastError).toBeUndefined()
  })
})
