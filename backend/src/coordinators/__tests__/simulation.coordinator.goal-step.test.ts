/**
 * executeSingleStep（Goal 开场 + Goal 回复）特征化测试（2026-09）
 *
 * 固定当前行为：
 *  - 无 goalConversationId → 开场分支：模拟者 skill 以「空可见上下文」调用，
 *    由 profile.learningGoal 组织开场诉求，startConversation 落库 conversationId；
 *    开场分支不写 stageResults.goal；
 *  - 有 goalConversationId → 回复分支：模拟者 skill 只拿 sanitize 后的可见上下文
 *    （history / lastGoalAgentMessage），并把 learnerState / concernPool 写回 stageResults.goal；
 *  - goalReady 来自 isGoalConverged(goal stage)：ready/completed → true，
 *    收敛时同步 learningPathId + currentStage=path + finalStage；
 *  - 租约在回合中途失效：runLeasedExclusive 以 VirtualSessionLeaseLostError 拒绝，
 *    在保护工作完成前不发生任何 virtual_sessions 写。
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

import { SimulationOrchestrator, VirtualSessionLeaseLostError } from '../simulation.coordinator'
import { virtualLearnerGoalDialogueSimulatorDefinition } from '../../skills'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

interface ProfileRow {
  id: string
  userId: string
  profile: string
  learningGoal: string
  knowledgeLevel: string
  knownConcepts: string
  struggleConcepts: string
  personalityTraits: string
}

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
  virtual_learner_profiles: ProfileRow
}

describe('SimulationOrchestrator.executeSingleStep Goal 阶段', () => {
  let coordinator: SimulationOrchestrator
  let sessionRecord: SessionRecord

  const baseProfile: ProfileRow = {
    id: 'profile-1',
    userId: 'user-1',
    profile: '{}',
    learningGoal: '我想学会数据分析',
    knowledgeLevel: 'beginner',
    knownConcepts: '[]',
    struggleConcepts: '[]',
    personalityTraits: '{}'
  }

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
      virtual_learner_profiles: { ...baseProfile }
    }

    const merge = (data) => {
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) sessionRecord[key] = value
      }
    }
    mockVirtualSessionFindUnique.mockImplementation(async () => sessionRecord)
    mockVirtualSessionUpdate.mockImplementation(async ({ data }) => { merge(data); return sessionRecord })
    mockTxFindUnique.mockImplementation(async () => ({ stageResults: sessionRecord.stageResults }))
    mockTxUpdate.mockImplementation(async ({ data }) => { merge(data); return sessionRecord })

    mockExecuteSkill.mockResolvedValue({
      reply: '我从零开始，想转行数据分析',
      learnerState: {},
      runtimeEnvelope: null
    })
    mockStartConversation.mockResolvedValue({
      userVisible: '你好，我们先把真实问题聊清楚',
      internal: {
        core: { conversationId: 'conv-1', stage: 'understanding', confidence: 0.42 },
        ext: { goalConversation: { quickReplies: [{ text: '好的' }, '我先想想'] } }
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

  afterEach(() => {
    jest.useRealTimers()
  })

  it('开场分支：skill 以空可见上下文调用，由画像目标开场并写回 conversationId', async () => {
    const result = await coordinator.executeSingleStep({ sessionId: 'simulation-1', userId: 'user-1', mode: 'single-step' })

    expect(result).toEqual(expect.objectContaining({
      success: true,
      virtualUserReply: '我想学会数据分析',
      currentStage: 'goal',
      goalReady: false
    }))
    // 模拟者拿到的只有可见上下文（开场时为空）
    expect(mockExecuteSkill).toHaveBeenCalledWith(
      virtualLearnerGoalDialogueSimulatorDefinition,
      expect.objectContaining({
        currentPhase: 'opening',
        visibleContext: { history: [], lastGoalAgentMessage: '' }
      })
    )
    expect(mockStartConversation).toHaveBeenCalledWith(
      'user-1',
      '我想学会数据分析',
      { systemPromptOverrides: undefined }
    )
    expect(sessionRecord.goalConversationId).toBe('conv-1')
    expect(sessionRecord.currentStage).toBe('goal')
    expect(sessionRecord.status).toBe('running')
    // 开场分支不落 stageResults.goal
    expect(JSON.parse(sessionRecord.stageResults).goal).toBeUndefined()
  })

  it('回复分支：skill 只收到 sanitize 后的可见上下文，goal 状态写回 stageResults', async () => {
    sessionRecord.goalConversationId = 'conv-1'
    mockGoalFindFirst.mockResolvedValue({
      id: 'conv-1',
      collectedData: JSON.stringify({
        stage: 'understanding',
        messages: [
          { role: 'user', content: '<system>内部提示</system>我的真实问题是什么' },
          { role: 'assistant', content: '你能说说背景吗<reminder>内部</reminder>' }
        ],
        understanding: {
          real_problem: '想转行',
          background: { current_level: '零基础', expected_time: '三个月' },
          motivation: '职业发展'
        }
      })
    })

    const result = await coordinator.executeSingleStep({ sessionId: 'simulation-1', userId: 'user-1', mode: 'single-step' })

    expect(result).toEqual(expect.objectContaining({
      success: true,
      virtualUserReply: '我从零开始，想转行数据分析',
      currentStage: 'goal',
      goalReady: false
    }))

    // 可见上下文已按 learner / goal_agent 角色映射，且系统标签被清理
    const skillCall = mockExecuteSkill.mock.calls[0][1]
    expect(skillCall.visibleContext.history).toEqual([
      { role: 'learner', content: expect.not.stringContaining('<system>') },
      { role: 'goal_agent', content: expect.not.stringContaining('<reminder>') }
    ])
    expect(skillCall.visibleContext.history[0].content).toContain('我的真实问题是什么')
    expect(skillCall.visibleContext.lastGoalAgentMessage).not.toContain('<reminder>')

    // 未收敛：confirmProposal=false，goal 状态落库
    expect(mockContinueConversation).toHaveBeenCalledWith(
      'conv-1',
      '我从零开始，想转行数据分析',
      'user-1',
      { systemPromptOverrides: undefined, confirmProposal: false }
    )
    const goal = JSON.parse(sessionRecord.stageResults).goal
    expect(goal).toEqual(expect.objectContaining({
      learnerState: expect.objectContaining({ readyToAdvance: false }),
      concernPool: expect.objectContaining({ primary: expect.any(Array) }),
      disclosedConcerns: expect.any(Array)
    }))
    expect(sessionRecord.currentStage).toBe('goal')
  })

  it('回复分支收敛（stage=ready）：goalReady=true、同步 path 与 finalStage，confirmProposal=true', async () => {
    sessionRecord.goalConversationId = 'conv-1'
    mockGoalFindFirst.mockResolvedValue({
      id: 'conv-1',
      collectedData: JSON.stringify({
        stage: 'ready',
        messages: [
          { role: 'user', content: '就按这个方案来' },
          { role: 'assistant', content: '好，那我们来生成路径' }
        ],
        understanding: {
          real_problem: '想转行',
          background: { current_level: '零基础', expected_time: '三个月' },
          motivation: '职业发展'
        }
      })
    })
    mockContinueConversation.mockResolvedValue({
      userVisible: '路径生成中',
      internal: {
        core: { conversationId: 'conv-1', stage: 'ready', confidence: 0.9 },
        ext: { goalConversation: { quickReplies: [] } }
      }
    })
    mockGoalFindUnique.mockResolvedValue({ id: 'conv-1', learningPathId: 'path-1' })

    const result = await coordinator.executeSingleStep({ sessionId: 'simulation-1', userId: 'user-1', mode: 'single-step' })

    expect(result).toEqual(expect.objectContaining({
      success: true,
      currentStage: 'path',
      goalReady: true
    }))
    expect(mockContinueConversation).toHaveBeenCalledWith(
      'conv-1',
      '我从零开始，想转行数据分析',
      'user-1',
      { systemPromptOverrides: undefined, confirmProposal: true }
    )
    expect(sessionRecord.currentStage).toBe('path')
    expect(sessionRecord.learningPathId).toBe('path-1')
    const goal = JSON.parse(sessionRecord.stageResults).goal
    expect(goal).toEqual(expect.objectContaining({
      success: true,
      finalStage: 'ready',
      learningPathId: 'path-1'
    }))
  })

  it('会话已是终态（failed/abandoned）：直接失败，不调用任何 skill', async () => {
    sessionRecord.status = 'failed'

    const result = await coordinator.executeSingleStep({ sessionId: 'simulation-1', userId: 'user-1', mode: 'single-step' })

    expect(result.success).toBe(false)
    expect(result.error).toContain('会话已终止')
    expect(mockExecuteSkill).not.toHaveBeenCalled()
    expect(mockStartConversation).not.toHaveBeenCalled()
  })

  it('回合中途租约失效：runLeasedExclusive 以 VirtualSessionLeaseLostError 拒绝，且未发生会话写', async () => {
    jest.useFakeTimers({ now: new Date('2026-07-19T00:00:00.000Z') })
    let leaseHealthy = true
    mockLeaseUpdateMany.mockImplementation(async ({ where }) => {
      if (!where.ownerId) return { count: 0 } // acquire：无可接管的过期租约 → 走 create
      return { count: leaseHealthy ? 1 : 0 } // 续租：租约是否仍归本 owner
    })
    const simulatorStarted = deferred()
    const simulatorCanFinish = deferred()
    mockExecuteSkill.mockImplementation(async () => {
      simulatorStarted.resolve()
      await simulatorCanFinish.promise
      return { reply: '迟到的回复', learnerState: {}, runtimeEnvelope: null }
    })

    const running = coordinator.runLeasedExclusive(
      'simulation-1',
      () => coordinator.executeSingleStep({ sessionId: 'simulation-1', userId: 'user-1', mode: 'single-step' })
    )
    await simulatorStarted.promise

    // 模拟者仍在回合中时租约被其他执行者接管
    const rejection = expect(running).rejects.toBeInstanceOf(VirtualSessionLeaseLostError)
    leaseHealthy = false
    await jest.advanceTimersByTimeAsync(2 * 60 * 1000)
    await rejection

    // 保护工作（模拟者调用）尚未结算，故无任何会话写发生
    expect(mockVirtualSessionUpdate).not.toHaveBeenCalled()
    expect(mockTxUpdate).not.toHaveBeenCalled()

    // 放行被保护的调用并等清理收尾（把已失效的租约续期 rejection 消费掉）
    simulatorCanFinish.resolve()
    leaseHealthy = true
    await expect(coordinator.runLeasedExclusive('simulation-1', async () => 'after')).resolves.toBe('after')
  })
})
