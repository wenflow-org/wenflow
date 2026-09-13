/**
 * retryLearnUpstream 特征化测试（2026-09）
 *
 * 固定当前行为：
 *  - 可重试错误按 maxRetriesPerStep 退避重试，成功后把「尝试次数」累计进 runtimeStats.aiCalls；
 *  - 预算来源为 profile.simulationBudget（costCeiling / maxRetriesPerStep）；
 *  - 累计 AI 调用达到 costCeiling → 抛 RETRY_BUDGET_EXHAUSTED，且不再调用上游；
 *  - 请求级取消（abortSignal.aborted）→ 立刻抛 REQUEST_ABORTED，零上游调用；
 *  - 不可重试错误 → 只调用一次，原样抛出；
 *  - 重试耗尽 → 抛出最后一次错误，并把已发生的尝试次数计入 aiCalls。
 */
const mockVirtualSessionFindUnique = jest.fn()
const mockVirtualSessionUpdate = jest.fn()
const mockTxFindUnique = jest.fn()
const mockTxUpdate = jest.fn()

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
jest.mock('../../skills/session-wrapup', () => ({ sessionWrapupAgent: { generate: jest.fn() } }))
jest.mock('../../services/learning/goal-path-visible-summary', () => ({ buildGoalPathVisibleSummary: jest.fn() }))
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}))

import { SimulationOrchestrator } from '../simulation.coordinator'
import { runWithContext } from '../../gateway/api-gateway/context'

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
  stageResults: string
  logs: string
  virtual_learner_profiles: ProfileRow
}

type RetryLearnUpstream = <T>(sessionId: string, operation: string, execute: () => Promise<T>) => Promise<T>

describe('SimulationOrchestrator.retryLearnUpstream 预算与重试', () => {
  let coordinator: SimulationOrchestrator
  let sessionRecord: SessionRecord

  const setBudget = (budget: Record<string, unknown>) => {
    sessionRecord.virtual_learner_profiles.profile = JSON.stringify({ simulationBudget: budget })
  }

  const getAiCalls = () =>
    Number(JSON.parse(sessionRecord.stageResults).runtimeStats?.aiCalls) || 0

  beforeEach(() => {
    jest.clearAllMocks()
    coordinator = new SimulationOrchestrator()
    sessionRecord = {
      id: 'simulation-1',
      userId: 'user-1',
      status: 'running',
      currentStage: 'goal',
      stageResults: JSON.stringify({}),
      logs: '[]',
      virtual_learner_profiles: {
        id: 'profile-1',
        userId: 'user-1',
        profile: JSON.stringify({ simulationBudget: { maxRetriesPerStep: 3 } }),
        learningGoal: '完成任务',
        knowledgeLevel: 'beginner',
        knownConcepts: '[]',
        struggleConcepts: '[]',
        personalityTraits: '{}'
      }
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
  })

  const retry = () => coordinator as unknown as { retryLearnUpstream: RetryLearnUpstream }

  it('可重试错误退避后成功：按尝试次数累计 aiCalls', async () => {
    setBudget({ maxRetriesPerStep: 3, costCeiling: 10 })
    const execute = jest.fn()
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockRejectedValueOnce(new Error('api request canceled'))
      .mockResolvedValue('上游成功')

    jest.useFakeTimers()
    try {
      const pending = retry().retryLearnUpstream('simulation-1', 'op', execute)
      await jest.advanceTimersByTimeAsync(10_000)
      await expect(pending).resolves.toBe('上游成功')
    } finally {
      jest.useRealTimers()
    }

    expect(execute).toHaveBeenCalledTimes(3)
    // 成功那一次把 attempt=3 全部计入
    expect(getAiCalls()).toBe(3)
  })

  it('累计 AI 调用达到 costCeiling：抛 RETRY_BUDGET_EXHAUSTED 且不再调用上游', async () => {
    setBudget({ maxRetriesPerStep: 3, costCeiling: 5 })
    sessionRecord.stageResults = JSON.stringify({ runtimeStats: { aiCalls: 5 } })
    const execute = jest.fn().mockResolvedValue('never')

    await expect(retry().retryLearnUpstream('simulation-1', 'op', execute)).rejects
      .toEqual(expect.objectContaining({ code: 'RETRY_BUDGET_EXHAUSTED' }))

    expect(execute).not.toHaveBeenCalled()
    expect(getAiCalls()).toBe(5)
  })

  it('成功一次后再调用：第二次因累计值触顶而终止', async () => {
    setBudget({ maxRetriesPerStep: 3, costCeiling: 1 })
    const execute = jest.fn().mockResolvedValue('ok')

    await expect(retry().retryLearnUpstream('simulation-1', 'op', execute)).resolves.toBe('ok')
    expect(getAiCalls()).toBe(1)

    await expect(retry().retryLearnUpstream('simulation-1', 'op', execute)).rejects
      .toEqual(expect.objectContaining({ code: 'RETRY_BUDGET_EXHAUSTED' }))
    expect(execute).toHaveBeenCalledTimes(1)
    expect(getAiCalls()).toBe(1)
  })

  it('请求级取消：立刻抛 REQUEST_ABORTED，零上游调用', async () => {
    const execute = jest.fn().mockResolvedValue('never')
    const controller = new AbortController()
    controller.abort()

    await expect(runWithContext(
      { abortSignal: controller.signal },
      () => retry().retryLearnUpstream('simulation-1', 'op', execute)
    )).rejects.toEqual(expect.objectContaining({ code: 'REQUEST_ABORTED' }))

    expect(execute).not.toHaveBeenCalled()
  })

  it('不可重试错误：只调用一次并原样抛出', async () => {
    setBudget({ maxRetriesPerStep: 5 })
    const failure = new Error('业务校验失败：没有可重试的语义')
    const execute = jest.fn().mockRejectedValue(failure)

    await expect(retry().retryLearnUpstream('simulation-1', 'op', execute)).rejects.toBe(failure)

    expect(execute).toHaveBeenCalledTimes(1)
    // 未配置 costCeiling 时不写 aiCalls
    expect(mockTxUpdate).not.toHaveBeenCalled()
    expect(getAiCalls()).toBe(0)
  })

  it('重试耗尽：抛出最后一次错误，并把尝试次数计入 aiCalls', async () => {
    setBudget({ maxRetriesPerStep: 2, costCeiling: 5 })
    const execute = jest.fn().mockRejectedValue(new Error('api request canceled'))

    jest.useFakeTimers()
    try {
      const pending = retry().retryLearnUpstream('simulation-1', 'op', execute)
      const rejection = expect(pending).rejects.toEqual(expect.objectContaining({ message: 'api request canceled' }))
      await jest.advanceTimersByTimeAsync(10_000)
      await rejection
    } finally {
      jest.useRealTimers()
    }

    expect(execute).toHaveBeenCalledTimes(2)
    expect(getAiCalls()).toBe(2)
  })
})
