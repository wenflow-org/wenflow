/**
 * 冻结考卷双臂协议（#85）臂标签透传测试。
 *
 * 契约：
 *  - `simulationConfig.experimentArm='A'` → 教学回合显式传 failedConceptFollowupGuard=false
 *    （复现 #84 护栏前口径）；
 *  - 缺省 / 'B' → 不传（引擎默认开启护栏，正常路径零变化）；
 *  - 臂标签只在会话级 simulationConfig，不改任何全局开关。
 */
const mockVirtualSessionFindUnique = jest.fn()
const mockVirtualSessionUpdate = jest.fn()
const mockLearningPathFindUnique = jest.fn()
const mockCompleteTask = jest.fn()
const mockExecuteSkill = jest.fn()
const mockProcessStudentMessage = jest.fn()
const mockSubmitCheckpoint = jest.fn()
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
    submitCheckpoint: mockSubmitCheckpoint,
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

describe('#85 双臂：experimentArm 透传到教学回合', () => {
  let sessionRecord: Record<string, unknown> & { stageResults: string }
  let coordinator: SimulationOrchestrator

  const baseLearningState = {
    success: true,
    teachingSessionId: 'teaching-1',
    teachingRevision: 1,
    currentMilestone: 0,
    currentMilestoneTitle: '里程碑一',
    currentTaskIdx: 0,
    currentTaskId: 'task-1',
    currentTaskTitle: '任务一',
    totalMilestones: 1,
    conversationHistory: []
  }

  const setArm = (arm: 'A' | 'B' | null) => {
    sessionRecord.stageResults = JSON.stringify({
      teaching: baseLearningState,
      ...(arm ? { simulationConfig: { experimentArm: arm } } : {})
    })
  }

  beforeEach(() => {
    jest.clearAllMocks()
    coordinator = new SimulationOrchestrator()
    sessionRecord = {
      id: 'simulation-1',
      userId: 'user-1',
      status: 'running',
      currentStage: 'teaching',
      learningPathId: 'path-1',
      currentTaskId: 'task-1',
      stageResults: JSON.stringify({ teaching: baseLearningState }),
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
    mockLearningPathFindUnique.mockResolvedValue({
      id: 'path-1',
      milestones: [{
        id: 'milestone-1',
        stageNumber: 1,
        title: '里程碑一',
        subtasks: [{ id: 'task-1', title: '任务一', status: 'active', estimatedMinutes: 20, order: 1 }]
      }]
    })
    mockGetSessionDetail.mockResolvedValue(undefined)
    mockEndSession.mockResolvedValue({ revision: 3 })
    mockExecuteSkill.mockResolvedValue({
      reply: '我再试试。',
      learnerState: {},
      learnerFeedback: { selfReportedTaskDone: false, wantsMoreHelp: true, stopAsking: false, remainingBlockers: [] }
    })
    mockProcessStudentMessage.mockResolvedValue({
      revision: 2,
      aiResponse: '好，我们继续。',
      isCompletion: false,
      autoEnded: false,
      analysis: {},
      knowledgePoints: [],
      strategies: []
    })
  })

  it('A 臂 → 显式传 failedConceptFollowupGuard=false（复现护栏前口径）', async () => {
    setArm('A')
    await coordinator.executeLearningStep('simulation-1')

    expect(mockProcessStudentMessage).toHaveBeenCalledTimes(1)
    const options = mockProcessStudentMessage.mock.calls[0][2] as Record<string, unknown>
    expect(options.failedConceptFollowupGuard).toBe(false)
  })

  it('B 臂 → 不传该开关（引擎默认开启护栏）', async () => {
    setArm('B')
    await coordinator.executeLearningStep('simulation-1')

    const options = mockProcessStudentMessage.mock.calls[0][2] as Record<string, unknown>
    expect(options.failedConceptFollowupGuard).toBeUndefined()
  })

  it('A 臂也覆盖检查点提交回合（submitCheckpoint 收到同一开关）', async () => {
    setArm('A')
    mockGetSessionDetail.mockResolvedValue({
      id: 'teaching-1',
      pendingCheckpoint: {
        id: 'cp-1',
        type: 'single_choice',
        question: '下列哪个是函数？',
        options: [{ id: 'A', text: 'y=x' }, { id: 'B', text: 'x+1' }],
      },
    })
    mockExecuteSkill.mockResolvedValue({
      reply: '我选 A。',
      learnerState: {},
      learnerFeedback: { selfReportedTaskDone: false, wantsMoreHelp: false, stopAsking: false, remainingBlockers: [] },
      checkpointAnswer: { selectedOptionIds: ['A'] },
    })
    mockSubmitCheckpoint.mockResolvedValue({
      revision: 2,
      passed: true,
      checkpointResolution: { passed: true },
      aiResponse: '对，选 A。',
      isCompletion: false,
      autoEnded: false,
      analysis: {},
      knowledgePoints: [],
      strategies: [],
    })

    await coordinator.executeLearningStep('simulation-1')

    expect(mockSubmitCheckpoint).toHaveBeenCalledTimes(1)
    expect(mockSubmitCheckpoint.mock.calls[0][4]).toEqual({ failedConceptFollowupGuard: false })
  })

  it('无臂标签 → 默认口径（不传开关）', async () => {
    await coordinator.executeLearningStep('simulation-1')

    const options = mockProcessStudentMessage.mock.calls[0][2] as Record<string, unknown>
    expect(options.failedConceptFollowupGuard).toBeUndefined()
  })
})
