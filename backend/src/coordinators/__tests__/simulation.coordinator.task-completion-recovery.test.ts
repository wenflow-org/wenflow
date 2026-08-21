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
jest.mock('../../services/learning/goal-conversation.service', () => ({
  __esModule: true,
  default: {}
}))
jest.mock('../../services/learning/learning.service', () => ({
  __esModule: true,
  default: { completeTask: mockCompleteTask }
}))
jest.mock('../path.coordinator', () => ({
  __esModule: true,
  default: {}
}))
jest.mock('../../services/ai-teaching/AITeachingCoordinator', () => ({
  __esModule: true,
    default: {
      startSession: mockStartSession,
      processStudentMessage: mockProcessStudentMessage,
    endSession: mockEndSession,
    getSessionDetail: mockGetSessionDetail
  }
}))
jest.mock('../../services/agentConfig.service', () => ({
  getSimulationAgentConfig: jest.fn()
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
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}))

import { SimulationOrchestrator } from '../simulation.coordinator'

describe('SimulationOrchestrator durable task completion recovery', () => {
  let sessionRecord: any
  let learningPath: any
  let coordinator: SimulationOrchestrator

  const task = (id: string, title: string, status = 'active') => ({
    id,
    title,
    status,
    estimatedMinutes: 20,
    order: 1
  })

  const buildPath = (...tasks: any[]) => ({
    id: 'path-1',
    milestones: [{
      id: 'milestone-1',
      stageNumber: 1,
      title: '里程碑一',
      subtasks: tasks
    }]
  })

  const buildLearningState = (taskRuntime?: any) => ({
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
    ...(taskRuntime ? { taskRuntime } : {})
  })

  const setLearningState = (learning: any) => {
    sessionRecord.stageResults = JSON.stringify({ teaching: learning })
  }

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
    mockVirtualSessionUpdate.mockImplementation(async ({ data }: any) => {
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) sessionRecord[key] = value
      }
      return sessionRecord
    })
    mockLearningPathFindUnique.mockImplementation(async () => learningPath)
    mockExecuteSkill.mockResolvedValue({
      reply: '我已经完成了当前任务。',
      learnerState: { readyForNextTask: true },
      learnerFeedback: {
        selfReportedTaskDone: true,
        wantsMoreHelp: false,
        stopAsking: true,
        remainingBlockers: []
      }
    })
    mockProcessStudentMessage.mockResolvedValue({
      revision: 2,
      aiResponse: '当前任务已完成。',
      isCompletion: true,
      autoEnded: false,
      analysis: {},
      knowledgePoints: [],
      strategies: []
    })
    mockEndSession.mockResolvedValue({ revision: 3 })
    mockStartSession.mockResolvedValue({
      sessionId: 'teaching-2',
      revision: 1,
      welcomeMessage: '任务二课堂已启动'
    })
  })

  it('learn-turn 模拟器失败 → 单步 success:false、会话标 failed、teaching 状态保留可恢复', async () => {
    mockExecuteSkill.mockRejectedValue(new Error('VIRTUAL_LEARNER_LEARN_TURN_SIMULATION_FAILED'))

    const result = await coordinator.executeLearningStep('simulation-1')
    const learning = getLearningState()

    expect(result).toEqual(expect.objectContaining({
      success: false
    }))
    expect(result.error).toContain('VIRTUAL_LEARNER_LEARN_TURN_SIMULATION_FAILED')
    // 会话显式 failed（可重启 Learn 恢复），不再用伪 selfReportedTaskDone 驱动教师收束
    expect(sessionRecord.status).toBe('failed')
    expect(learning.taskRuntime).toEqual(expect.objectContaining({
      status: 'error'
    }))
    expect(learning.taskRuntime.error).toContain('VIRTUAL_LEARNER_LEARN_TURN_SIMULATION_FAILED')
    expect(learning.currentTaskId).toBe('task-1')
    expect(mockProcessStudentMessage).not.toHaveBeenCalled()
    expect(mockEndSession).not.toHaveBeenCalled()
  })

  it('endSession 成功后 completeTask 失败会留下 pending checkpoint，且虚拟会话不终态化', async () => {
    const longError = `transient-${'x'.repeat(1200)}`
    let runtimeWhenCompleteTaskStarted: any
    mockCompleteTask.mockImplementation(async () => {
      runtimeWhenCompleteTaskStarted = getLearningState().taskRuntime
      throw new Error(longError)
    })

    const result = await coordinator.executeLearningStep('simulation-1')
    const learning = getLearningState()

    expect(result).toEqual(expect.objectContaining({
      success: false,
      taskCompleted: false,
      currentTaskStopped: true,
      isPathCompleted: false
    }))
    expect(mockEndSession).toHaveBeenCalledWith('teaching-1', 'task-completed', 2)
    expect(runtimeWhenCompleteTaskStarted).toEqual(expect.objectContaining({
      status: 'task_completion_pending',
      taskId: 'task-1',
      taskTitle: '任务一',
      teachingSessionId: 'teaching-1',
      teachingRevision: 3,
      error: null
    }))
    expect(runtimeWhenCompleteTaskStarted.finalizedAt).toEqual(expect.any(String))
    expect(runtimeWhenCompleteTaskStarted.closureDecision.canCompleteTask).toBe(true)
    expect(learning.taskRuntime.status).toBe('task_completion_pending')
    expect(learning.taskRuntime.error).toHaveLength(1000)
    expect(sessionRecord.status).toBe('running')
    expect(mockVirtualSessionUpdate.mock.calls.some(([input]) => input.data.status === 'failed')).toBe(false)
  })

  it('下一步只重试 completeTask，并为路径中的下一任务建立新课堂', async () => {
    learningPath = buildPath(task('task-1', '任务一'), task('task-2', '任务二'))
    setLearningState(buildLearningState({
      status: 'task_completion_pending',
      taskId: 'task-1',
      taskTitle: '任务一',
      teachingSessionId: 'teaching-1',
      teachingRevision: 3,
      closureDecision: { canCompleteTask: true, reason: '已收束' },
      finalizedAt: '2026-07-19T00:00:00.000Z',
      error: 'transient',
      updatedAt: '2026-07-19T00:00:01.000Z'
    }))
    mockCompleteTask.mockResolvedValue({
      task: { id: 'task-1', status: 'completed', completedAt: '2026-07-19T00:00:02.000Z' }
    })

    const result = await coordinator.executeLearningStep('simulation-1')
    const learning = getLearningState()

    expect(result).toEqual(expect.objectContaining({
      success: true,
      taskCompleted: true,
      currentTaskStopped: false,
      isPathCompleted: false
    }))
    expect(mockCompleteTask).toHaveBeenCalledTimes(1)
    expect(mockExecuteSkill).not.toHaveBeenCalled()
    expect(mockProcessStudentMessage).not.toHaveBeenCalled()
    expect(mockEndSession).not.toHaveBeenCalled()
    expect(mockGetSessionDetail).not.toHaveBeenCalled()
    expect(learning.taskRuntime).toEqual(expect.objectContaining({
      status: 'active',
      taskId: 'task-2',
      taskTitle: '任务二',
      teachingSessionId: 'teaching-2'
    }))
    expect(learning.currentTaskId).toBe('task-2')
    expect(learning.currentTaskTitle).toBe('任务二')
    expect(sessionRecord.currentTaskId).toBe('task-2')
    expect(sessionRecord.status).toBe('running')
    expect(mockStartSession).toHaveBeenCalledWith({ userId: 'user-1', taskId: 'task-2' })
  })

  it('completeTask 的 alreadyCompleted 返回被视为恢复成功', async () => {
    setLearningState(buildLearningState({
      status: 'task_completion_pending',
      taskId: 'task-1',
      taskTitle: '任务一',
      teachingSessionId: 'teaching-1',
      teachingRevision: 3,
      closureDecision: { canCompleteTask: true },
      finalizedAt: '2026-07-19T00:00:00.000Z',
      error: 'previous timeout'
    }))
    mockCompleteTask.mockResolvedValue({
      task: { id: 'task-1', status: 'completed', completedAt: '2026-07-19T00:00:02.000Z' },
      alreadyCompleted: true
    })

    const result = await coordinator.executeLearningStep('simulation-1')
    const learning = getLearningState()

    expect(result).toEqual(expect.objectContaining({
      success: true,
      taskCompleted: true,
      isPathCompleted: true
    }))
    expect(learning.taskRuntime.status).toBe('completed')
    expect(learning.taskRuntime.completionResult.alreadyCompleted).toBe(true)
    expect(learning.currentMilestone).toBe(1)
    expect(learning.currentTaskId).toBeNull()
    expect(learning.currentTaskTitle).toBeNull()
    expect(sessionRecord.currentTaskId).toBeNull()
    expect(sessionRecord.status).toBe('completed')
    expect(mockExecuteSkill).not.toHaveBeenCalled()
    expect(mockProcessStudentMessage).not.toHaveBeenCalled()
    expect(mockEndSession).not.toHaveBeenCalled()
    expect(mockGetSessionDetail).not.toHaveBeenCalled()
  })

  it('legacy error runtime 会依据已完成且 task 匹配的 Teaching 会话恢复', async () => {
    learningPath = buildPath(task('task-1', '任务一'), task('task-2', '任务二'))
    setLearningState({
      ...buildLearningState({
        status: 'error',
        taskId: 'task-1',
        taskTitle: '任务一',
        teachingSessionId: 'teaching-1',
        closureDecision: { canCompleteTask: true, reason: 'legacy closure' },
        error: 'completeTask failed before checkpoint support'
      }),
      teachingSessionId: 'stale-top-level-teaching-session'
    })
    mockGetSessionDetail.mockResolvedValue({
      id: 'teaching-1',
      taskId: 'task-1',
      status: 'completed',
      endTime: new Date('2026-07-19T00:00:00.000Z'),
      revision: 4
    })
    let runtimeWhenCompleteTaskStarted: any
    mockCompleteTask.mockImplementation(async () => {
      runtimeWhenCompleteTaskStarted = getLearningState().taskRuntime
      return {
        task: { id: 'task-1', status: 'completed', completedAt: '2026-07-19T00:00:02.000Z' }
      }
    })

    const result = await coordinator.executeLearningStep('simulation-1')
    const learning = getLearningState()

    expect(result).toEqual(expect.objectContaining({
      success: true,
      taskCompleted: true,
      isPathCompleted: false
    }))
    expect(mockGetSessionDetail).toHaveBeenCalledWith('teaching-1', 'user-1')
    expect(runtimeWhenCompleteTaskStarted).toEqual(expect.objectContaining({
      status: 'task_completion_pending',
      taskId: 'task-1',
      teachingSessionId: 'teaching-1',
      teachingRevision: 4,
      finalizedAt: '2026-07-19T00:00:00.000Z',
      error: null
    }))
    expect(mockCompleteTask).toHaveBeenCalledTimes(1)
    expect(mockExecuteSkill).not.toHaveBeenCalled()
    expect(mockProcessStudentMessage).not.toHaveBeenCalled()
    expect(mockEndSession).not.toHaveBeenCalled()
    expect(learning.taskRuntime).toEqual(expect.objectContaining({
      status: 'active',
      taskId: 'task-2',
      teachingSessionId: 'teaching-2',
      error: null
    }))
    expect(learning.currentTaskId).toBe('task-2')
    expect(sessionRecord.currentTaskId).toBe('task-2')
    expect(mockStartSession).toHaveBeenCalledWith({ userId: 'user-1', taskId: 'task-2' })
  })

  it('教学上游重试耗尽后将 Learn 标为失败并保留当前 task 供重启', async () => {
    mockProcessStudentMessage.mockRejectedValue(new Error('API request canceled'))
    // 重试退避是真实 sleep（5 次尝试共 2+4+6+8=20s），用假时钟快进避免测试超时
    jest.useFakeTimers()
    try {
      const pending = coordinator.executeLearningStep('simulation-1')
      await jest.advanceTimersByTimeAsync(30_000)
      const result = await pending
      const learning = getLearningState()

      expect(result).toEqual(expect.objectContaining({
        success: false,
        error: 'API request canceled'
      }))
      expect(mockProcessStudentMessage).toHaveBeenCalledTimes(5)
      expect(sessionRecord.status).toBe('failed')
      expect(sessionRecord.currentStage).toBe('teaching')
      expect(learning.taskRuntime).toEqual(expect.objectContaining({
        status: 'error',
        taskId: 'task-1',
        error: 'API request canceled'
      }))
    } finally {
      jest.useRealTimers()
    }
  })

  it('同一 task 达到课时预算后显式失败，不再调用 LLM，也不误标完成', async () => {
    setLearningState(buildLearningState({
      status: 'active',
      taskId: 'task-1',
      taskTitle: '任务一',
      teachingSessionId: 'teaching-1',
      turns: 30
    }))
    // 课堂仍在进行：不触发“已完成课堂”的 legacy 恢复分支，让预算检查生效
    mockGetSessionDetail.mockResolvedValue({
      id: 'teaching-1',
      taskId: 'task-1',
      status: 'active',
      revision: 1
    })

    const result = await coordinator.executeLearningStep('simulation-1')
    const learning = getLearningState()

    expect(result).toEqual(expect.objectContaining({
      success: false,
      currentTaskStopped: true
    }))
    expect(result.error).toContain('turn_budget_exhausted')
    expect(mockExecuteSkill).not.toHaveBeenCalled()
    expect(mockProcessStudentMessage).not.toHaveBeenCalled()
    expect(mockCompleteTask).not.toHaveBeenCalled()
    expect(sessionRecord.status).toBe('failed')
    expect(sessionRecord.currentStage).toBe('teaching')
    expect(learning.taskRuntime).toEqual(expect.objectContaining({
      status: 'error',
      taskId: 'task-1'
    }))
  })
})
