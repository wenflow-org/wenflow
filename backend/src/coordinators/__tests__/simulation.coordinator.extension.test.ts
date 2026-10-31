/**
 * 延伸学 assisted 轨（#124）接线测试。
 *
 * 修复的缺口：blackbox runner 已支持 request_extension，但 assisted 预置批量链路
 * （executeLearningStep）在正课收束时直接结算任务——学员表达「还想深入」被丢弃，
 * 延伸课在 assisted 轨永远开不出来（实测 0 节）。
 *
 * 钉死的契约：
 *  - 正课收束 + wantsExtension=true → 不结算任务，另起 mode=extension 课堂，
 *    learningState.teachingSessionId 指向延伸课并记 extensionRuntime（turns=0）；
 *  - 延伸回合按 turns 计数，未到上限不结算（extension 模式教师侧不产生完成信号）；
 *  - 跑到上限 → 合成收束，endSession 收尾延伸课，任务结算仍归属**正课会话**；
 *  - 开延伸课失败 → fail-open，按正常收束继续（延伸不得阻塞任务完成）。
 */
const mockVirtualSessionFindUnique = jest.fn()
const mockVirtualSessionUpdate = jest.fn()
const mockLearningPathFindUnique = jest.fn()
const mockCompleteTask = jest.fn()
const mockRequestPathReplan = jest.fn()
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
    // adopt 臂发起 replan 前会查「同一路径是否已有在途重排」（4048ac62 起不再看
    // learning_paths.activeGenerationRunId）；空结果表示没有在途运行，应直接发重排。
    path_generation_runs: {
      findFirst: jest.fn(async () => null)
    },
    teaching_sessions: {
      findFirst: jest.fn(async () => null)
    },
    goal_conversations: {
      findFirst: jest.fn()
    }
  }
}))
jest.mock('../../services/learning/goal-conversation.service', () => ({ __esModule: true, default: {} }))
jest.mock('../../services/learning/learning.service', () => ({
  __esModule: true,
  default: { completeTask: mockCompleteTask, requestPathReplan: mockRequestPathReplan }
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
import { LEARN_EXTENSION_MAX_TURNS } from '../simulation.learn.steps'
import { teachingSessionRepository } from '../../services/ai-teaching/TeachingSessionRepository'

describe('#124 assisted 延伸学：正课收束 → 延伸课堂 → 结算', () => {
  let sessionRecord: Record<string, unknown> & { stageResults: string }
  let learningPath: Record<string, unknown>
  let coordinator: SimulationOrchestrator

  const task = (id: string, title: string, status = 'active') => ({
    id,
    title,
    status,
    estimatedMinutes: 20,
    order: 1
  })

  const buildLearningState = (overrides: Record<string, unknown> = {}) => ({
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
    ...overrides
  })

  const setLearningState = (learning: Record<string, unknown>) => {
    sessionRecord.stageResults = JSON.stringify({ teaching: learning })
  }
  const setStage = (stage: Record<string, unknown>) => {
    sessionRecord.stageResults = JSON.stringify(stage)
  }
  const getLearningState = () => JSON.parse(sessionRecord.stageResults).teaching

  const extensionState = (turns: number) => buildLearningState({
    teachingSessionId: 'ext-1',
    teachingRevision: 1,
    extensionRuntime: {
      active: true,
      sourceSessionId: 'teaching-1',
      sourceTaskId: 'task-1',
      turns,
      maxTurns: LEARN_EXTENSION_MAX_TURNS,
      startedAt: '2026-10-20T00:00:00.000Z'
    },
    taskRuntime: {
      status: 'extension_running',
      taskId: 'task-1',
      taskTitle: '任务一',
      teachingSessionId: 'ext-1',
      lessonSessionId: 'teaching-1',
      turns: 6
    }
  })

  const wantsMoreFeedback = {
    selfReportedTaskDone: false,
    wantsMoreHelp: true,
    stopAsking: false,
    remainingBlockers: [],
    wantsExtension: true
  }

  beforeEach(() => {
    jest.clearAllMocks()
    coordinator = new SimulationOrchestrator()
    learningPath = {
      id: 'path-1',
      milestones: [{ id: 'milestone-1', stageNumber: 1, title: '里程碑一', subtasks: [task('task-1', '任务一')] }]
    }
    sessionRecord = {
      id: 'simulation-1',
      userId: 'user-1',
      status: 'running',
      currentStage: 'teaching',
      learningPathId: 'path-1',
      currentTaskId: 'task-1',
      stageResults: JSON.stringify({ teaching: buildLearningState() }),
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
    mockLearningPathFindUnique.mockImplementation(async () => learningPath)
    mockGetSessionDetail.mockResolvedValue(undefined)
    mockEndSession.mockResolvedValue({ revision: 3 })
    mockStartSession.mockResolvedValue({ sessionId: 'ext-1', revision: 1, welcomeMessage: '延伸课堂已启动' })
    mockCompleteTask.mockResolvedValue({ task: { id: 'task-1', status: 'completed' } })
    mockProcessStudentMessage.mockResolvedValue({
      revision: 2,
      aiResponse: '好，我们再深入一层。',
      isCompletion: false,
      autoEnded: false,
      analysis: {},
      knowledgePoints: [],
      strategies: []
    })
  })

  it('正课收束 + 学员表达延伸意愿 → 另起延伸课堂，本任务暂不结算', async () => {
    mockExecuteSkill.mockResolvedValue({
      reply: '我还想看看这个公式在真实数据里怎么用。',
      learnerState: { readyForNextTask: true },
      learnerFeedback: {
        selfReportedTaskDone: true,
        wantsMoreHelp: false,
        stopAsking: true,
        remainingBlockers: [],
        wantsExtension: true
      }
    })
    mockProcessStudentMessage.mockResolvedValue({
      revision: 2,
      aiResponse: '这节课就到这儿，你已经掌握了。',
      isCompletion: true,
      autoEnded: false,
      analysis: {},
      knowledgePoints: [],
      strategies: []
    })

    const result = await coordinator.executeLearningStep('simulation-1')
    const learning = getLearningState()

    expect(result).toEqual(expect.objectContaining({
      success: true,
      taskCompleted: false,
      isPathCompleted: false
    }))
    expect(mockStartSession).toHaveBeenCalledWith({ userId: 'user-1', taskId: 'task-1', mode: 'extension' })
    // 正课已收束（wrapup 落库），延伸课接管课堂
    expect(mockEndSession).toHaveBeenCalledWith('teaching-1', 'task-completed', 2)
    expect(mockCompleteTask).not.toHaveBeenCalled()
    expect(learning.teachingSessionId).toBe('ext-1')
    expect(learning.teachingRevision).toBe(1)
    expect(learning.extensionRuntime).toEqual(expect.objectContaining({
      active: true,
      sourceSessionId: 'teaching-1',
      sourceTaskId: 'task-1',
      turns: 0,
      maxTurns: LEARN_EXTENSION_MAX_TURNS
    }))
    expect(learning.taskRuntime.status).toBe('extension_running')
  })

  it('延伸回合未到上限 → 继续陪学，不结算任务', async () => {
    setLearningState(extensionState(2))
    mockExecuteSkill.mockResolvedValue({
      reply: '那它在真实数据里噪声大的时候会怎样？',
      learnerState: { readyForNextTask: false },
      learnerFeedback: wantsMoreFeedback
    })

    const result = await coordinator.executeLearningStep('simulation-1')
    const learning = getLearningState()

    expect(result).toEqual(expect.objectContaining({ success: true, taskCompleted: false }))
    expect(mockCompleteTask).not.toHaveBeenCalled()
    expect(mockEndSession).not.toHaveBeenCalled()
    expect(learning.extensionRuntime.turns).toBe(3)
    expect(learning.extensionRuntime.active).toBe(true)
  })

  it('跑到回合上限 → 收束延伸课，任务结算仍归属正课会话', async () => {
    setLearningState(extensionState(LEARN_EXTENSION_MAX_TURNS - 1))
    mockExecuteSkill.mockResolvedValue({
      reply: '还想再看看它在极端值下的表现。',
      learnerState: { readyForNextTask: false },
      learnerFeedback: wantsMoreFeedback
    })

    const result = await coordinator.executeLearningStep('simulation-1')
    const learning = getLearningState()

    expect(result).toEqual(expect.objectContaining({ success: true, taskCompleted: true }))
    // 先收尾延伸课，再对正课会话走 completed 幂等收束
    expect(mockEndSession).toHaveBeenNthCalledWith(1, 'ext-1', 'task-completed', 2)
    expect(mockEndSession).toHaveBeenNthCalledWith(2, 'teaching-1', 'task-completed', 3)
    expect(mockCompleteTask).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'task-1', sessionId: 'teaching-1' }))
    expect(learning.extensionRuntime.active).toBe(false)
    expect(learning.extensionRuntime.sourceTaskId).toBe('task-1')
  })

  it('未表达延伸意愿 → 保持原收束路径（不开延伸课）', async () => {
    mockExecuteSkill.mockResolvedValue({
      reply: '好的，我明白了。',
      learnerState: { readyForNextTask: true },
      learnerFeedback: {
        selfReportedTaskDone: true,
        wantsMoreHelp: false,
        stopAsking: true,
        remainingBlockers: [],
        wantsExtension: false
      }
    })
    mockProcessStudentMessage.mockResolvedValue({
      revision: 2,
      aiResponse: '这节课就到这儿。',
      isCompletion: true,
      autoEnded: false,
      analysis: {},
      knowledgePoints: [],
      strategies: []
    })

    const result = await coordinator.executeLearningStep('simulation-1')

    expect(result).toEqual(expect.objectContaining({ success: true, taskCompleted: true }))
    expect(mockStartSession).not.toHaveBeenCalled()
    expect(mockCompleteTask).toHaveBeenCalledTimes(1)
  })

  it('延伸课开课失败 → fail-open，按正常收束结算任务', async () => {
    mockStartSession.mockRejectedValue(new Error('课堂正在启动或结束，请稍后重试'))
    mockExecuteSkill.mockResolvedValue({
      reply: '我还想再深入一点。',
      learnerState: { readyForNextTask: true },
      learnerFeedback: {
        selfReportedTaskDone: true,
        wantsMoreHelp: false,
        stopAsking: true,
        remainingBlockers: [],
        wantsExtension: true
      }
    })
    mockProcessStudentMessage.mockResolvedValue({
      revision: 2,
      aiResponse: '这节课就到这儿。',
      isCompletion: true,
      autoEnded: false,
      analysis: {},
      knowledgePoints: [],
      strategies: []
    })

    const result = await coordinator.executeLearningStep('simulation-1')
    const learning = getLearningState()

    expect(result).toEqual(expect.objectContaining({ success: true, taskCompleted: true }))
    expect(mockCompleteTask).toHaveBeenCalledTimes(1)
    expect(learning.teachingSessionId).toBe('teaching-1')
    expect(learning.extensionRuntime).toBeUndefined()
    const logs = (result.logs || []).filter((entry) =>
      (entry.details?.output as Record<string, unknown> | undefined)?.action === 'extension-session-start-failed')
    expect(logs).toHaveLength(1)
  })

  // 2026-10-21：模型从不表达延伸意愿（5017/5017 false），功能没有样本可验证。
  // extensionProbe 是显式探针：每会话第一次正课收束时强制开一节延伸课。
  describe('extensionProbe / advisoryResponse 采样开关', () => {
    const completedFeedback = {
      selfReportedTaskDone: true,
      wantsMoreHelp: false,
      stopAsking: true,
      remainingBlockers: [],
      wantsExtension: false
    }

    const mockCompletion = () => {
      mockExecuteSkill.mockResolvedValue({
        reply: '好的，我明白了。',
        learnerState: { readyForNextTask: true },
        learnerFeedback: completedFeedback
      })
      mockProcessStudentMessage.mockResolvedValue({
        revision: 2,
        aiResponse: '这节课就到这儿。',
        isCompletion: true,
        autoEnded: false,
        analysis: {},
        knowledgePoints: [],
        strategies: []
      })
    }

    it('探针开启、模型未表达意愿 → 仍开延伸课并标记已用', async () => {
      setStage({ teaching: buildLearningState(), simulationConfig: { extensionProbe: true } })
      mockCompletion()

      const result = await coordinator.executeLearningStep('simulation-1')
      const learning = getLearningState()

      expect(result).toEqual(expect.objectContaining({ success: true, taskCompleted: false }))
      expect(mockStartSession).toHaveBeenCalledWith({ userId: 'user-1', taskId: 'task-1', mode: 'extension' })
      expect(learning.extensionRuntime).toEqual(expect.objectContaining({ active: true, turns: 0, extensionSessionId: 'ext-1' }))
      expect(learning.teachingSessionHistory).toEqual(expect.arrayContaining([
        expect.objectContaining({ teachingSessionId: 'ext-1', taskId: 'task-1', status: 'extension' })
      ]))
      expect(learning.extensionProbeUsed).toBe(true)
      expect(mockCompleteTask).not.toHaveBeenCalled()
      const startLog = (result.logs || []).find((entry) =>
        (entry.details?.output as Record<string, unknown> | undefined)?.action === 'extension-session-start')
      expect((startLog?.details?.output as Record<string, unknown>).probe).toBe(true)
    })

    it('探针每会话只用一次：已标记 used → 走正常收束', async () => {
      setStage({
        teaching: buildLearningState({ extensionProbeUsed: true }),
        simulationConfig: { extensionProbe: true }
      })
      mockCompletion()

      const result = await coordinator.executeLearningStep('simulation-1')

      expect(result).toEqual(expect.objectContaining({ success: true, taskCompleted: true }))
      expect(mockStartSession).not.toHaveBeenCalled()
      expect(mockCompleteTask).toHaveBeenCalledTimes(1)
    })

    it('advisoryResponse 配置 + 收束带建议 → 按真人端点语义记账', async () => {
      setStage({ teaching: buildLearningState(), simulationConfig: { advisoryResponse: 'later' } })
      mockCompletion()
      mockEndSession.mockResolvedValue({ revision: 3, advisory: { shouldSuggest: true } })
      const recordSpy = jest.spyOn(teachingSessionRepository, 'recordAdvisoryResponse')
        .mockResolvedValue({ status: 'ok' })

      try {
        await coordinator.executeLearningStep('simulation-1')
        expect(recordSpy).toHaveBeenCalledWith('teaching-1', 'user-1', 'later')
      } finally {
        recordSpy.mockRestore()
      }
    })

    it('adopt 臂 → 先真实 replan，成功后才记 adopt', async () => {
      setStage({ teaching: buildLearningState(), simulationConfig: { advisoryResponse: 'adopt' } })
      mockCompletion()
      mockEndSession.mockResolvedValue({
        revision: 3,
        advisory: { shouldSuggest: true, recommendation: 'reinforce', scope: 'next_milestone', targetStageNumber: 2 }
      })
      mockRequestPathReplan.mockResolvedValue({ status: 'completed', enabled: true })
      const recordSpy = jest.spyOn(teachingSessionRepository, 'recordAdvisoryResponse')
        .mockResolvedValue({ status: 'ok' })

      try {
        await coordinator.executeLearningStep('simulation-1')
        expect(mockRequestPathReplan).toHaveBeenCalledWith(expect.objectContaining({
          pathId: 'path-1',
          userId: 'user-1',
          triggerSource: 'ai-teaching',
          mode: 'overwrite',
          stageNumber: 2,
          requireConfirmation: false,
        }))
        expect(recordSpy).toHaveBeenCalledWith('teaching-1', 'user-1', 'adopt')
      } finally {
        recordSpy.mockRestore()
      }
    })

    it('未配置处置动作 → 不记建议响应', async () => {
      setStage({ teaching: buildLearningState() })
      mockCompletion()
      mockEndSession.mockResolvedValue({ revision: 3, advisory: { shouldSuggest: true } })
      const recordSpy = jest.spyOn(teachingSessionRepository, 'recordAdvisoryResponse')
        .mockResolvedValue({ status: 'ok' })

      try {
        await coordinator.executeLearningStep('simulation-1')
        expect(recordSpy).not.toHaveBeenCalled()
      } finally {
        recordSpy.mockRestore()
      }
    })
  })
})
