/**
 * 175-4 阶段闸：executeSingleStep 只允许驱动 goal 阶段。
 *
 * 病灶（R 系列驾驶舱实跑）：驾驶舱 /step、/auto 只做模式检查
 * （routes/admin/virtual-learners.assisted-runtime.ts:42-96 +
 *  assisted-shared.ts:67-72），不查 currentStage；executeSingleStep 只拦
 * failed/abandoned。于是已进入 path/teaching 的会话再被调用时，Goal 回合会被
 * 强行叠加到后继阶段（goalReady 还会把 currentStage 写回 path），形成阶段倒退。
 *
 * 闸门放在 executeSingleStep 入口：非 goal 阶段直接返回失败并说明当前阶段，
 * 不调任何 LLM、不写 stageResults、不改 currentStage。
 */
const mockVirtualSessionFindUnique = jest.fn()
const mockVirtualSessionUpdate = jest.fn()
const mockTxFindUnique = jest.fn()
const mockTxUpdate = jest.fn()
const mockGoalFindFirst = jest.fn()
const mockGoalFindUnique = jest.fn()
const mockLeaseUpdateMany = jest.fn()
const mockLeaseCreate = jest.fn()
const mockLeaseDeleteMany = jest.fn()
const mockExecuteSkill = jest.fn()
const mockStartConversation = jest.fn()
const mockContinueConversation = jest.fn()

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
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
      virtual_sessions: {
        findUnique: mockTxFindUnique,
        update: mockTxUpdate
      }
    }),
    virtual_sessions: {
      findUnique: mockVirtualSessionFindUnique,
      update: mockVirtualSessionUpdate
    },
    goal_conversations: {
      findFirst: mockGoalFindFirst,
      findUnique: mockGoalFindUnique
    },
    virtual_experiment_leases: {
      updateMany: mockLeaseUpdateMany,
      create: mockLeaseCreate,
      deleteMany: mockLeaseDeleteMany
    }
  }
}))
jest.mock('../../services/learning/goal-conversation.service', () => ({
  __esModule: true,
  default: {
    startConversation: mockStartConversation,
    continueConversation: mockContinueConversation
  }
}))
jest.mock('../../services/learning/learning.service', () => ({ __esModule: true, default: {} }))
jest.mock('../path.coordinator', () => ({ __esModule: true, default: {} }))
jest.mock('../../services/ai-teaching/AITeachingCoordinator', () => ({ __esModule: true, default: {} }))
jest.mock('../../services/agentConfig.service', () => ({ getSimulationAgentConfig: jest.fn() }))
jest.mock('../../skills', () => ({
  executeSkill: mockExecuteSkill,
  virtualLearnerGoalDialogueSimulatorDefinition: { id: 'goal-simulator' },
  virtualLearnerPathEvaluatorDefinition: {},
  virtualLearnerLearnTurnSimulatorDefinition: {}
}))
jest.mock('../../skills/virtual-learner-shared', () => ({
  normalizeFrictionBudget: (value: string) => value || 'normal'
}))
jest.mock('../../skills/session-wrapup', () => ({ sessionWrapupAgent: { generate: jest.fn() } }))
jest.mock('../../services/learning/goal-path-visible-summary', () => ({ buildGoalPathVisibleSummary: jest.fn() }))
jest.mock('../../virtual-lab/learner-memory', () => ({
  buildLearnerMemorySnapshot: jest.fn(async () => null),
  recordCompletedArtifact: jest.fn(),
  writeProfileConceptsAfterLesson: jest.fn()
}))
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}))

import { SimulationOrchestrator } from '../simulation.coordinator'

interface SessionRecord {
  [key: string]: unknown
  id: string
  userId: string
  status: string
  currentStage: string
  goalConversationId: string | null
  learningPathId: string | null
  stageResults: string
  logs: string
  virtual_learner_profiles: Record<string, unknown>
}

describe('executeSingleStep 阶段闸（175-4：非 goal 阶段不得推进）', () => {
  let coordinator: SimulationOrchestrator
  let sessionRecord: SessionRecord

  beforeEach(() => {
    jest.clearAllMocks()
    coordinator = new SimulationOrchestrator()
    sessionRecord = {
      id: 'simulation-1',
      userId: 'user-1',
      status: 'running',
      currentStage: 'goal',
      goalConversationId: null,
      learningPathId: null,
      stageResults: JSON.stringify({}),
      logs: '[]',
      virtual_learner_profiles: {
        id: 'profile-1',
        userId: 'user-1',
        profile: '{}',
        learningGoal: '我想学会数据分析',
        knowledgeLevel: 'beginner',
        knownConcepts: '[]',
        struggleConcepts: '[]',
        personalityTraits: '{}'
      }
    }

    const merge = (data: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) sessionRecord[key] = value
      }
    }
    mockVirtualSessionFindUnique.mockImplementation(async () => sessionRecord)
    mockVirtualSessionUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      merge(data)
      return sessionRecord
    })
    mockTxFindUnique.mockImplementation(async () => ({ stageResults: sessionRecord.stageResults }))
    mockTxUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      merge(data)
      return sessionRecord
    })

    mockExecuteSkill.mockResolvedValue({
      reply: '我从零开始，想转行数据分析',
      learnerState: {},
      runtimeEnvelope: null
    })
    mockStartConversation.mockResolvedValue({
      userVisible: '你好，我们先把真实问题聊清楚',
      internal: {
        core: { conversationId: 'conv-1', stage: 'understanding', confidence: 0.42 },
        ext: { goalConversation: { quickReplies: [] } }
      }
    })
    mockContinueConversation.mockResolvedValue({
      userVisible: '能具体说说你的背景吗',
      internal: {
        core: { conversationId: 'conv-1', stage: 'understanding', confidence: 0.5 },
        ext: { goalConversation: { quickReplies: [] } }
      }
    })
    mockLeaseUpdateMany.mockResolvedValue({ count: 0 })
    mockLeaseCreate.mockResolvedValue({})
    mockLeaseDeleteMany.mockResolvedValue({ count: 1 })
  })

  it.each(['path', 'path-review', 'path-accepted', 'teaching', 'completed'])(
    'currentStage=%s：入口直接失败并说明阶段，零 LLM / 零 stageResults 写入 / 不改阶段',
    async (stage) => {
      sessionRecord.currentStage = stage
      sessionRecord.goalConversationId = 'conv-1'
      sessionRecord.stageResults = JSON.stringify({ teaching: { marker: 'kept' } })

      const result = await coordinator.executeSingleStep({
        sessionId: 'simulation-1',
        userId: 'user-1',
        mode: 'single-step'
      })

      expect(result.success).toBe(false)
      expect(result.goalReady).toBe(false)
      expect(String(result.error)).toContain(stage)
      expect(String(result.error)).toContain('仅 goal 阶段')

      // 零推进副作用：不调模拟者、不进 Goal 服务、不写 stageResults
      expect(mockExecuteSkill).not.toHaveBeenCalled()
      expect(mockStartConversation).not.toHaveBeenCalled()
      expect(mockContinueConversation).not.toHaveBeenCalled()
      expect(sessionRecord.stageResults).toBe(JSON.stringify({ teaching: { marker: 'kept' } }))
      expect(sessionRecord.currentStage).toBe(stage)
    }
  )

  it('currentStage=goal（对照）：闸门不误伤，Goal 回合照常推进', async () => {
    sessionRecord.currentStage = 'goal'
    sessionRecord.goalConversationId = 'conv-1'
    mockGoalFindFirst.mockResolvedValue({
      id: 'conv-1',
      collectedData: JSON.stringify({ stage: 'understanding', messages: [], understanding: {} })
    })

    const result = await coordinator.executeSingleStep({
      sessionId: 'simulation-1',
      userId: 'user-1',
      mode: 'single-step'
    })

    expect(result.success).toBe(true)
    expect(mockContinueConversation).toHaveBeenCalledTimes(1)
    expect(sessionRecord.currentStage).toBe('goal')
  })
})
