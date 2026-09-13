/**
 * generateWrapupForSession 特征化测试（2026-09）
 *
 * 固定当前行为：
 *  - 已存在 teaching.wrapup → 直接 success，不覆盖、不调用 wrapup skill；
 *  - 会话未 completed 且 taskRuntime 未结算 → 返回业务闸门错误，不生成；
 *  - 已结算但对话为空（缺 user/assistant 任一侧）→ 返回空对话错误；
 *  - 已结算 + 有对话 → 调 sessionWrapupAgent.generate 并写回 teaching.wrapup
 *    （summary / evaluation / summarySource / evaluationSource / generatedAt）；
 *  - generateWrapupForSession 自身不写 logs（阶段日志由调用方 finalizePathCompletion 负责）。
 */
const mockVirtualSessionFindUnique = jest.fn()
const mockVirtualSessionUpdate = jest.fn()
const mockTxFindUnique = jest.fn()
const mockTxUpdate = jest.fn()
const mockWrapupGenerate = jest.fn()

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
    }
  }
}))
jest.mock('../../services/learning/goal-conversation.service', () => ({ __esModule: true, default: {} }))
jest.mock('../../services/learning/learning.service', () => ({ __esModule: true, default: {} }))
jest.mock('../path.coordinator', () => ({ __esModule: true, default: {} }))
jest.mock('../../services/ai-teaching/AITeachingCoordinator', () => ({ __esModule: true, default: {} }))
jest.mock('../../services/agentConfig.service', () => ({ getSimulationAgentConfig: jest.fn() }))
jest.mock('../../skills', () => ({
  executeSkill: jest.fn(),
  virtualLearnerGoalDialogueSimulatorDefinition: {},
  virtualLearnerPathEvaluatorDefinition: {},
  virtualLearnerLearnTurnSimulatorDefinition: {}
}))
jest.mock('../../skills/virtual-learner-shared', () => ({
  normalizeFrictionBudget: (value: string) => value || 'normal'
}))
jest.mock('../../skills/session-wrapup', () => ({
  sessionWrapupAgent: { generate: mockWrapupGenerate }
}))
jest.mock('../../services/learning/goal-path-visible-summary', () => ({ buildGoalPathVisibleSummary: jest.fn() }))
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}))

import { SimulationOrchestrator } from '../simulation.coordinator'

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
  createdAt: string
  stageResults: string
  logs: string
  virtual_learner_profiles: ProfileRow
}

describe('SimulationOrchestrator.generateWrapupForSession', () => {
  let coordinator: SimulationOrchestrator
  let sessionRecord: SessionRecord

  const buildTeaching = (overrides: Record<string, unknown> = {}) => ({
    currentTaskTitle: '任务一',
    conversationHistory: [
      { role: 'user', content: '虚拟学习者的问题' },
      { role: 'assistant', content: '教师的回答' }
    ],
    taskRuntime: { status: 'completed' },
    ...overrides
  })

  const setTeaching = (teaching: Record<string, unknown>) => {
    sessionRecord.stageResults = JSON.stringify({
      teaching,
      story: { subject: '数学', title: '故事标题', storyId: 'story-1' }
    })
  }

  const getTeaching = () => JSON.parse(sessionRecord.stageResults).teaching

  beforeEach(() => {
    jest.clearAllMocks()
    coordinator = new SimulationOrchestrator()
    sessionRecord = {
      id: 'simulation-1',
      userId: 'user-1',
      status: 'completed',
      currentStage: 'teaching',
      createdAt: new Date('2026-07-19T00:00:00.000Z').toISOString(),
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
    }
    setTeaching(buildTeaching())

    const merge = (data) => {
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) sessionRecord[key] = value
      }
    }
    mockVirtualSessionFindUnique.mockImplementation(async () => sessionRecord)
    mockVirtualSessionUpdate.mockImplementation(async ({ data }) => { merge(data); return sessionRecord })
    mockTxFindUnique.mockImplementation(async () => ({ stageResults: sessionRecord.stageResults }))
    mockTxUpdate.mockImplementation(async ({ data }) => { merge(data); return sessionRecord })
    mockWrapupGenerate.mockResolvedValue({
      summary: '本次学习总结',
      evaluation: { overall: 'good' },
      summarySource: 'llm',
      evaluationSource: 'llm'
    })
  })

  it('已存在 wrapup：直接 success，不覆盖、不调用 skill', async () => {
    setTeaching(buildTeaching({ wrapup: { summary: '旧总结', evaluation: { overall: 'old' } } }))

    const result = await coordinator.generateWrapupForSession('simulation-1')

    expect(result).toEqual({ success: true })
    expect(mockWrapupGenerate).not.toHaveBeenCalled()
    expect(mockTxUpdate).not.toHaveBeenCalled()
    expect(getTeaching().wrapup).toEqual({ summary: '旧总结', evaluation: { overall: 'old' } })
  })

  it('任务未结算且会话未完成：返回业务闸门错误', async () => {
    sessionRecord.status = 'running'
    setTeaching(buildTeaching({ taskRuntime: { status: 'active' } }))

    const result = await coordinator.generateWrapupForSession('simulation-1')

    expect(result).toEqual({
      success: false,
      error: '课堂总结在课程完成后才会生成：当前任务尚未结算完成'
    })
    expect(mockWrapupGenerate).not.toHaveBeenCalled()
    expect(mockTxUpdate).not.toHaveBeenCalled()
  })

  it('对话为空：返回空对话错误', async () => {
    setTeaching(buildTeaching({ conversationHistory: [] }))

    const result = await coordinator.generateWrapupForSession('simulation-1')

    expect(result).toEqual({ success: false, error: '课堂对话为空，没有可总结的内容' })
    expect(mockWrapupGenerate).not.toHaveBeenCalled()
  })

  it('只有单侧消息也算空对话', async () => {
    setTeaching(buildTeaching({
      conversationHistory: [{ role: 'assistant', content: '只有教师的话' }]
    }))

    const result = await coordinator.generateWrapupForSession('simulation-1')

    expect(result).toEqual({ success: false, error: '课堂对话为空，没有可总结的内容' })
    expect(mockWrapupGenerate).not.toHaveBeenCalled()
  })

  it('已结算且有对话：生成并写回 teaching.wrapup', async () => {
    setTeaching(buildTeaching({
      conversationHistory: [
        { role: 'user', content: '问题', timestamp: '2026-07-19T00:01:00.000Z' },
        { role: 'assistant', content: '回答', createdAt: '2026-07-19T00:02:00.000Z' }
      ],
      learnerState: {
        knowledgePoints: [{ name: '概念A', status: 'mastered', progress: 100 }],
        lss: 7,
        ktl: 6,
        lf: 8,
        lsb: 7,
        recentTrend: 'up'
      }
    }))

    const result = await coordinator.generateWrapupForSession('simulation-1')

    expect(result).toEqual({ success: true })
    expect(mockWrapupGenerate).toHaveBeenCalledTimes(1)
    expect(mockWrapupGenerate).toHaveBeenCalledWith(expect.objectContaining({
      messages: [
        { role: 'user', content: '问题', timestamp: '2026-07-19T00:01:00.000Z' },
        { role: 'assistant', content: '回答', timestamp: '2026-07-19T00:02:00.000Z' }
      ],
      knowledgePoints: [{ name: '概念A', status: 'mastered', progress: 100 }],
      sessionInfo: expect.objectContaining({
        subject: '数学',
        topic: '故事标题',
        userMessageCount: 1,
        assistantMessageCount: 1,
        taskTitle: '任务一',
        durationMinutes: expect.any(Number)
      }),
      learningState: expect.objectContaining({ lss: 7, ktl: 6, lf: 8, lsb: 7, recentTrend: 'up' })
    }))

    const wrapup = getTeaching().wrapup
    expect(wrapup.summary).toBe('本次学习总结')
    expect(wrapup.evaluation).toEqual({ overall: 'good' })
    expect(wrapup.summarySource).toBe('llm')
    expect(wrapup.evaluationSource).toBe('llm')
    expect(typeof wrapup.generatedAt).toBe('string')

    // 方法自身不落日志：只发生一次 stageResults 写，且不含 logs 字段
    expect(mockTxUpdate).toHaveBeenCalledTimes(1)
    expect(mockTxUpdate.mock.calls[0][0].data).not.toHaveProperty('logs')
    expect(mockVirtualSessionUpdate).not.toHaveBeenCalled()
  })

  it('task_completion_pending 也算已结算（会话仍 running 也生成）', async () => {
    sessionRecord.status = 'running'
    setTeaching(buildTeaching({ taskRuntime: { status: 'task_completion_pending' } }))

    const result = await coordinator.generateWrapupForSession('simulation-1')

    expect(result).toEqual({ success: true })
    expect(mockWrapupGenerate).toHaveBeenCalledTimes(1)
    expect(getTeaching().wrapup.summary).toBe('本次学习总结')
  })

  it('skill 抛错：捕获并返回 error，不向外抛', async () => {
    mockWrapupGenerate.mockRejectedValue(new Error('wrapup provider down'))

    const result = await coordinator.generateWrapupForSession('simulation-1')

    expect(result).toEqual({ success: false, error: 'wrapup provider down' })
    expect(mockTxUpdate).not.toHaveBeenCalled()
  })
})
