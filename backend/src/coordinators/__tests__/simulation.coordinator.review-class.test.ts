/**
 * 复习课 assisted 轨（#104 校准取样）接线测试。
 *
 * 契约：
 *  - start-learning 传 mode=review → startSession(mode:'review')，learningState.classroomMode='review'
 *    （到期复习点由 startSession 注入 knowledgeState）；
 *  - 复习课收束 → 走 sessionFinalizationService.finalize(complete_review)（wrapup + 复习结果回写），
 *    **不结算任务**，一课一停（currentTaskStopped），并清空课堂绑定防误续；
 *  - complete_review 失败 → 降级 endSession(end_only)，课仍收束、错误留痕。
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
const mockFinalize = jest.fn()

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    virtual_session_logs: {
      findMany: jest.fn(async (args: { select?: { bytes?: boolean } }) =>
        args.select && 'bytes' in args.select ? [] : [{ id: 1 }]),
      createMany: jest.fn(async () => ({})),
      deleteMany: jest.fn(async () => ({}))
    },
    $transaction: async (callback: (tx: Record<string, unknown>) => Promise<unknown>) => callback({
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
jest.mock('../../services/ai-teaching/SessionFinalizationService', () => ({
  __esModule: true,
  sessionFinalizationService: { finalize: (...args: unknown[]) => mockFinalize(...args) },
  SessionFinalizationService: class {}
}))
jest.mock('../../services/agentConfig.service', () => ({ getSimulationAgentConfig: jest.fn() }))
jest.mock('../../skills', () => ({
  executeSkill: mockExecuteSkill,
  virtualLearnerGoalDialogueSimulatorDefinition: {},
  virtualLearnerPathEvaluatorDefinition: {},
  virtualLearnerLearnTurnSimulatorDefinition: {},
  virtualLearnerEpistemicGroundingDefinition: {}
}))
jest.mock('../../skills/virtual-learner-shared', () => ({
  normalizeFrictionBudget: (value: string) => value || 'normal'
}))
jest.mock('../../skills/session-wrapup', () => ({ sessionWrapupAgent: { generate: jest.fn() } }))
jest.mock('../../services/learning/goal-path-visible-summary', () => ({ buildGoalPathVisibleSummary: jest.fn() }))
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}))
jest.mock('../../services/virtual-lab/simulated-day.service', () => ({
  __esModule: true,
  default: { getTemporalContext: jest.fn().mockResolvedValue(null) },
  simulatedDayService: { getTemporalContext: jest.fn().mockResolvedValue(null) },
  temporalContextFromClock: jest.fn(() => null)
}))

import { SimulationOrchestrator } from '../simulation.coordinator'

describe('#104 复习课：开课与收束', () => {
  let sessionRecord: Record<string, unknown> & { stageResults: string }
  let learningPath: Record<string, unknown>
  let coordinator: SimulationOrchestrator

  const reviewLearningState = {
    success: true,
    classroomMode: 'review',
    teachingSessionId: 'review-1',
    teachingRevision: 1,
    currentMilestone: 0,
    currentMilestoneTitle: '里程碑一',
    currentTaskIdx: 0,
    currentTaskId: 'task-1',
    currentTaskTitle: '任务一',
    totalMilestones: 1,
    conversationHistory: []
  }

  beforeEach(() => {
    jest.clearAllMocks()
    coordinator = new SimulationOrchestrator()
    learningPath = {
      id: 'path-1',
      milestones: [{
        id: 'milestone-1',
        stageNumber: 1,
        title: '里程碑一',
        subtasks: [{ id: 'task-1', title: '任务一', status: 'active', estimatedMinutes: 20, order: 1 }]
      }]
    }
    sessionRecord = {
      id: 'simulation-1',
      userId: 'user-1',
      status: 'running',
      currentStage: 'teaching',
      learningPathId: 'path-1',
      currentTaskId: 'task-1',
      stageResults: JSON.stringify({ teaching: reviewLearningState }),
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
    mockVirtualSessionUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) sessionRecord[key] = value
      }
      return sessionRecord
    })
    mockLearningPathFindUnique.mockResolvedValue(learningPath)
    mockGetSessionDetail.mockResolvedValue(undefined)
    mockStartSession.mockResolvedValue({ sessionId: 'review-2', revision: 1, welcomeMessage: '复习课已开始' })
    mockEndSession.mockResolvedValue({ revision: 3 })
    mockFinalize.mockResolvedValue({ status: 'completed' })
    mockCompleteTask.mockResolvedValue({ task: { id: 'task-1', status: 'completed' } })
    mockExecuteSkill.mockResolvedValue({
      reply: '我再看一遍这个概念。',
      learnerState: {},
      learnerFeedback: { selfReportedTaskDone: true, wantsMoreHelp: false, stopAsking: true, remainingBlockers: [] }
    })
    mockProcessStudentMessage.mockResolvedValue({
      revision: 2,
      aiResponse: '好，我们把这几个到期概念过一遍，时间到了。',
      isCompletion: true,
      autoEnded: false,
      analysis: {},
      knowledgePoints: [],
      strategies: []
    })
  })

  it('start-learning mode=review → startSession(mode:review) 且状态标 classroomMode=review', async () => {
    sessionRecord.stageResults = JSON.stringify({})

    const result = await coordinator.startLearningPhase('simulation-1', { taskId: 'task-1', mode: 'review' })

    expect(result.success).toBe(true)
    expect(mockStartSession).toHaveBeenCalledWith({ userId: 'user-1', taskId: 'task-1', mode: 'review' })
    const learning = JSON.parse(sessionRecord.stageResults).teaching
    expect(learning.classroomMode).toBe('review')
    expect(learning.teachingSessionId).toBe('review-2')
  })

  it('复习课收束 → complete_review（不结算任务、一课一停、清课堂绑定）', async () => {
    const result = await coordinator.executeLearningStep('simulation-1')
    const learning = JSON.parse(sessionRecord.stageResults).teaching

    expect(result).toEqual(expect.objectContaining({
      success: true,
      taskCompleted: false,
      currentTaskStopped: true,
      isPathCompleted: false
    }))
    expect(mockFinalize).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'review-1',
      userId: 'user-1',
      action: 'complete_review',
      revision: 2
    }))
    expect(mockCompleteTask).not.toHaveBeenCalled()
    expect(learning.teachingSessionId).toBeNull()
    expect(learning.taskRuntime.status).toBe('review_completed')
    expect(learning.taskRuntime.error).toBeNull()
  })

  it('复习课跑满回合上限 → 有界收束（review-turn-cap），不结算任务', async () => {
    sessionRecord.stageResults = JSON.stringify({
      teaching: {
        ...reviewLearningState,
        taskRuntime: { status: 'active', taskId: 'task-1', taskTitle: '任务一', turns: 10 },
      },
    })
    mockProcessStudentMessage.mockResolvedValue({
      revision: 2,
      aiResponse: '我们先把这几个到期点过完了，今天的复习就到这儿。',
      isCompletion: false,
      autoEnded: false,
      analysis: {},
      knowledgePoints: [],
      strategies: []
    })

    const result = await coordinator.executeLearningStep('simulation-1')
    const learning = JSON.parse(sessionRecord.stageResults).teaching

    expect(result).toEqual(expect.objectContaining({ success: true, currentTaskStopped: true, taskCompleted: false }))
    expect(mockFinalize).toHaveBeenCalledWith(expect.objectContaining({ action: 'complete_review' }))
    expect(mockCompleteTask).not.toHaveBeenCalled()
    expect(learning.taskRuntime.status).toBe('review_completed')
  })

  it('complete_review 失败 → 降级 end_only 收束，错误留痕且不结算任务', async () => {
    mockFinalize.mockRejectedValue(new Error('课堂还有未完成的问答'))

    const result = await coordinator.executeLearningStep('simulation-1')
    const learning = JSON.parse(sessionRecord.stageResults).teaching

    expect(result).toEqual(expect.objectContaining({ success: true, currentTaskStopped: true }))
    expect(mockEndSession).toHaveBeenCalledWith('review-1', 'review-completed', 2)
    expect(mockCompleteTask).not.toHaveBeenCalled()
    expect(learning.taskRuntime.error).toContain('课堂还有未完成的问答')
  })
})
