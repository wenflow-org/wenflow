/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #137 回归：调用方中止（caller_abort）不得把会话打成终态 failed——第三条漏网路径。
 *
 * 病灶（2026-10-25 夜批实证 w01/w05）：harness 在 advance-day 中途断开 → 网关记 caller_abort →
 * `retryLearnUpstream` 立刻抛 `request_aborted：请求已取消，停止 Learn 上游调用`（code=REQUEST_ABORTED）。
 * 内层教学回合 catch（simulation.learn-phase.ts:1836）与最外层学习步骤 catch（:2083）都接了
 * `isAbortLikeLearnError`，但「**本课已结算、开下一课的课堂时被打断**」走的是
 * `completeCheckpointedSimulationTask` 自己的 catch（simulation.execution.ts:326）→ 直落
 * `persistLearningFailure` → status=failed，整节课不可续；W05 快照里唯一一条 phase:error
 * 正是这句 abort 文案。
 *
 * 本文件用**真代码**复现：把 abortSignal 置为已取消后调用真实的
 * `completeCheckpointedSimulationTask`，`transitionToNextLearningTask` →
 * `retryLearnUpstream`（simulation.coordinator.ts:568-572）自己抛出 REQUEST_ABORTED。
 */
const mockVirtualSessionFindUnique = jest.fn()
const mockVirtualSessionUpdate = jest.fn()
const mockTxFindUnique = jest.fn()
const mockTxUpdate = jest.fn()
const mockCompleteTask = jest.fn()
const mockEndSession = jest.fn()
const mockStartSession = jest.fn()

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    $transaction: async (callback: (tx: any) => Promise<any>) => callback({
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
jest.mock('../../services/learning/learning.service', () => ({
  __esModule: true,
  default: { completeTask: mockCompleteTask }
}))
jest.mock('../path.coordinator', () => ({ __esModule: true, default: {} }))
jest.mock('../../services/ai-teaching/AITeachingCoordinator', () => ({
  __esModule: true,
  default: {
    startSession: mockStartSession,
    processStudentMessage: jest.fn(),
    endSession: mockEndSession,
    getSessionDetail: jest.fn()
  }
}))
jest.mock('../../services/ai-teaching/TeachingSessionRepository', () => ({
  __esModule: true,
  teachingSessionRepository: {
    getById: jest.fn(async () => null),
    recordDirectTaskCompletion: jest.fn(async () => 'completed')
  }
}))
jest.mock('../../services/ai-teaching/warmup-writeback', () => ({
  applyWarmupExtractionForSession: jest.fn(async () => undefined)
}))
// 本用例只覆盖「开下一课被打断」的收尾语义；画像/成果物回写另有测试，这里隔离掉数据库噪声。
jest.mock('../simulation.memory', () => ({
  __esModule: true,
  ...jest.requireActual('../simulation.memory'),
  persistAssistedLearnerMemory: jest.fn(async () => undefined)
}))
jest.mock('../../services/agentConfig.service', () => ({ getSimulationAgentConfig: jest.fn() }))
jest.mock('../../skills', () => ({
  executeSkill: jest.fn(),
  virtualLearnerGoalDialogueSimulatorDefinition: {},
  virtualLearnerPathEvaluatorDefinition: {},
  virtualLearnerLearnTurnSimulatorDefinition: {},
  virtualLearnerMemoryCuratorDefinition: {}
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
import { runWithContext } from '../../gateway/api-gateway/context'

describe('#137 caller_abort 非终局（开下一课被打断）', () => {
  let coordinator: SimulationOrchestrator
  let sessionRecord: any
  let learningPath: any

  const task = (id: string, title: string) => ({ id, title, status: 'active', estimatedMinutes: 20, order: 1 })

  const buildLearningState = () => ({
    teachingSessionId: 'teaching-1',
    teachingRevision: 3,
    currentMilestone: 0,
    currentMilestoneTitle: '里程碑一',
    currentTaskIdx: 0,
    currentTaskId: 'task-1',
    currentTaskTitle: '任务一',
    totalMilestones: 1,
    conversationHistory: [],
    taskRuntime: {
      status: 'active',
      taskId: 'task-1',
      taskTitle: '任务一',
      teachingSessionId: 'teaching-1',
      teachingRevision: 3,
      turns: 1
    }
  })

  const getStageResults = () => JSON.parse(sessionRecord.stageResults)
  const getLearningState = () => getStageResults().teaching
  const getRuntimeStats = () => getStageResults().runtimeStats

  /** 用真代码取「请求级取消」那个错误对象（不手抄文案，避免与实现漂移）。 */
  const captureRealAbortError = async (): Promise<unknown> => {
    const controller = new AbortController()
    controller.abort()
    return runWithContext({ abortSignal: controller.signal }, () =>
      coordinator.retryLearnUpstream('simulation-1', 'start-next-learning-task', async () => 'never')
    ).catch((error: unknown) => error)
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
        subtasks: [task('task-1', '任务一'), task('task-2', '任务二')]
      }]
    }
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

    const merge = (data: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) sessionRecord[key] = value
      }
    }
    mockVirtualSessionFindUnique.mockImplementation(async () => sessionRecord)
    mockVirtualSessionUpdate.mockImplementation(async ({ data }: any) => { merge(data); return sessionRecord })
    mockTxFindUnique.mockImplementation(async () => ({ stageResults: sessionRecord.stageResults }))
    mockTxUpdate.mockImplementation(async ({ data }: any) => { merge(data); return sessionRecord })
    mockCompleteTask.mockResolvedValue({ id: 'record-1' })
    mockEndSession.mockResolvedValue({ status: 'completed', revision: 4 })
  })

  it('本课结算后开下一课撞 caller_abort → 保持 running + completed 运行时，可续开下一课', async () => {
    const logs: any[] = []
    const learningState = buildLearningState()
    const controller = new AbortController()
    controller.abort() // 客户端在 advance-day 中途断开

    const result = await runWithContext({ abortSignal: controller.signal }, () =>
      coordinator.completeCheckpointedSimulationTask(
        'simulation-1',
        sessionRecord,
        learningState as any,
        learningPath.milestones as any,
        learningState.taskRuntime as any,
        logs
      )
    )

    expect(result?.success).toBe(false)
    expect(String(result?.error)).toContain('request_aborted')

    // 修复前：persistLearningFailure → status=failed + taskRuntime.status='next_task_start_failed'（不可续）
    expect(sessionRecord.status).toBe('running')
    const learning = getLearningState()
    expect(learning.taskRuntime.status).toBe('completed')
    // executeLearningStep 的续课恢复分支（simulation.learn-phase.ts:614-646）要求：
    // taskRuntime 停在「已完成的那一课」而 currentTaskId 已指向下一课。
    expect(learning.taskRuntime.taskId).toBe('task-1')
    expect(sessionRecord.currentTaskId).toBe('task-2')

    // 可续跑暂停标记（harness 按 retryable:true 识别为 paused）
    expect(getRuntimeStats().lastError).toEqual(expect.objectContaining({
      code: 'LEARN_REQUEST_ABORTED_PAUSED',
      retryable: true,
      stage: 'teaching'
    }))

    // 中断证据（非 phase:error，action 可区分「开下一课被打断」）
    const interrupted = logs.find((entry) => entry.phase === 'teaching-interrupted')
    expect(interrupted?.details?.output).toEqual(expect.objectContaining({
      action: 'start-next-learning-task-interrupted',
      completedTaskId: 'task-1',
      nextTaskId: 'task-2',
      retryable: true
    }))
    expect(logs.find((entry) => entry.phase === 'error')).toBeUndefined()
    // 结算本身没有回滚：本课已持久化为 completed
    expect(mockCompleteTask).toHaveBeenCalledTimes(1)
  })

  it('最后防线：persistLearningFailure 对 abort-like 错误改写为暂停标记，不写终态', async () => {
    const abortError = await captureRealAbortError()
    expect(abortError).toEqual(expect.objectContaining({ code: 'REQUEST_ABORTED' }))
    const addSessionLogSpy = jest.spyOn(coordinator, 'addSessionLog').mockResolvedValue(undefined as any)

    await coordinator.persistLearningFailure('simulation-1', abortError, [])

    // 修复前：status=failed、taskRuntime.status='error'（整节课不可续）
    expect(sessionRecord.status).toBe('running')
    expect(getLearningState().taskRuntime.status).not.toBe('error')
    expect(getRuntimeStats().lastError).toEqual(expect.objectContaining({
      code: 'LEARN_REQUEST_ABORTED_PAUSED',
      retryable: true
    }))
    expect(addSessionLogSpy).not.toHaveBeenCalledWith(
      'simulation-1',
      expect.objectContaining({ phase: 'error', details: expect.objectContaining({ output: expect.objectContaining({ action: 'learn-upstream-retries-exhausted' }) }) })
    )
  })
})
