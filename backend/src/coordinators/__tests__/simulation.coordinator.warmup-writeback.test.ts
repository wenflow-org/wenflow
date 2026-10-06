/**
 * F2 断链修复（R2 判定#7 VL 轨，doc/local/ROUND2-REVIEW-2026-10-06.md §8-④）：
 *
 * VL 完课收束 = `completeCheckpointedSimulationTask`（completeTask + endSession，
 * simulation.execution.ts:69-96）——它**直接调** AITeachingCoordinator.endSession，
 * 不经过 SessionFinalizationService.finalize；而 applyWarmupExtractionForSession
 * （课内温故 → review:completed 入队）只挂在 finalize 的 end_only / complete_task
 * 分支（SessionFinalizationService.ts:140,245）。⇒ VL 课内温故结果永不入队，
 * ReviewCompletedConsumer 不写 learner_evidence / FSRS 重排（R2 实测 6 VL×3 模拟日
 * review:completed 事件 0 入队、43 痕迹 fsrsStability 非空=0）。
 *
 * 本套用例钉死修复契约：VL 式收束（endSession+completeTask）且该授课会话的
 * memoryWarmup 计划有 settled 项 → review:completed 必须入队（与 finalize / 超时兜底
 * 共用 warmup-writeback 同一实现），且回写失败不阻断任务完成。
 */
const mockCompleteTask = jest.fn()
const mockEndSession = jest.fn()
const mockGetTeachingSession = jest.fn()
const mockEnqueue = jest.fn()
const mockPersistAssistedLearnerMemory = jest.fn()
const mockVirtualSessionFindUnique = jest.fn()
const mockVirtualSessionUpdate = jest.fn()

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    virtual_sessions: {
      findUnique: mockVirtualSessionFindUnique,
      update: mockVirtualSessionUpdate
    }
  }
}))
jest.mock('../../services/learning/learning.service', () => ({
  __esModule: true,
  default: { completeTask: mockCompleteTask }
}))
jest.mock('../../services/learning/goal-conversation.service', () => ({
  __esModule: true,
  default: {}
}))
jest.mock('../../services/agentConfig.service', () => ({
  getSimulationAgentConfig: jest.fn()
}))
jest.mock('../../services/ai-teaching/AITeachingCoordinator', () => ({
  __esModule: true,
  default: { endSession: mockEndSession }
}))
jest.mock('../../services/ai-teaching/TeachingSessionRepository', () => ({
  __esModule: true,
  TeachingSessionConflictError: class extends Error {},
  FinalizationOperationError: class extends Error {},
  isTeachingSessionConflictError: () => false,
  teachingSessionRepository: { getById: mockGetTeachingSession }
}))
// 捕获事件对象（真实实现见 outbox.repository：写 domain_event_outbox）
jest.mock('../../events/outbox.repository', () => ({
  __esModule: true,
  enqueueDomainEvent: (...args: unknown[]) => mockEnqueue(...args)
}))
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}))
jest.mock('../simulation.memory', () => ({
  __esModule: true,
  persistAssistedLearnerMemory: mockPersistAssistedLearnerMemory,
  persistKnowledgeState: jest.fn()
}))

import { completeCheckpointedSimulationTask } from '../simulation.execution'

type FinalizeArgs = Parameters<typeof completeCheckpointedSimulationTask>

interface CapturedDomainEvent {
  type: string
  aggregateType: string
  aggregateId: string
  userId: string
  source: string
  data: { reviewItems: Array<Record<string, unknown>> }
}

const milestones = [{
  id: 'milestone-1',
  stageNumber: 1,
  title: '里程碑一',
  subtasks: [{ id: 'task-1', title: '任务一', status: 'active', estimatedMinutes: 20, order: 1 }]
}] as unknown as FinalizeArgs[4]

/** VL 授课会话：温故计划 2 项——1 项课内作答推进（mastered@100）、1 项问了没答出（askedAt 后有学员发言） */
const teachingSessionRecord = (): Record<string, unknown> => ({
  id: 'teaching-1',
  userId: 'user-1',
  taskId: 'task-1',
  mode: 'teaching',
  status: 'completed',
  messages: [
    { role: 'assistant', content: '我们先温故一下「一元一次方程」。', timestamp: '2026-10-06T01:00:00.000Z' },
    { role: 'user', content: 'x=3 对吗？那分式方程那题我不会。', timestamp: '2026-10-06T01:00:30.000Z' }
  ],
  teachingState: {
    sessionArtifacts: {
      memoryWarmup: {
        usedLoad: 2,
        items: [
          { conceptKey: '一元一次方程', label: '一元一次方程', outcome: { status: 'mastered', progress: 100 } },
          { conceptKey: '分式方程', label: '分式方程', askedAt: '2026-10-06T01:00:00.000Z' }
        ]
      }
    }
  }
})

const buildCtx = (): Record<string, unknown> => ({
  assertCurrentSessionLeaseOwned: jest.fn(),
  updateStageResults: jest.fn(),
  addSessionLogs: jest.fn(),
  transitionToNextLearningTask: jest.fn(),
  persistLearningFailure: jest.fn()
})

const buildVirtualSession = (): Record<string, unknown> => ({
  id: 'simulation-1',
  userId: 'user-1',
  status: 'running',
  currentStage: 'teaching',
  learningPathId: 'path-1',
  currentTaskId: 'task-1',
  stageResults: JSON.stringify({
    teaching: {
      teachingSessionId: 'teaching-1',
      teachingRevision: 3,
      currentTaskId: 'task-1',
      taskRuntime: {
        status: 'task_completion_pending',
        taskId: 'task-1',
        teachingSessionId: 'teaching-1',
        teachingRevision: 3
      }
    }
  }),
  virtual_learner_profiles: { id: 'profile-1', userId: 'user-1' }
})

const learningState = (): Record<string, unknown> =>
  JSON.parse(String(buildVirtualSession().stageResults)).teaching as Record<string, unknown>

const runClosure = async (
  ctx: Record<string, unknown>,
  virtualSession: Record<string, unknown>,
  taskRuntime: Record<string, unknown>
) => completeCheckpointedSimulationTask(
  ctx as unknown as FinalizeArgs[0],
  'simulation-1',
  virtualSession as unknown as FinalizeArgs[2],
  learningState(),
  milestones,
  taskRuntime,
  []
)

describe('VL 完课收束回写课内温故（F2 断链修复）', () => {
  let ctx: Record<string, unknown>
  let virtualSession: Record<string, unknown>

  beforeEach(() => {
    jest.clearAllMocks()
    ctx = buildCtx()
    virtualSession = buildVirtualSession()
    mockVirtualSessionFindUnique.mockResolvedValue(virtualSession)
    mockVirtualSessionUpdate.mockImplementation(async (input: unknown) => {
      const data = (input as { data: Record<string, unknown> }).data
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) virtualSession[key] = value
      }
      return virtualSession
    })
    mockCompleteTask.mockResolvedValue({
      task: { id: 'task-1', status: 'completed', completedAt: '2026-10-06T01:05:00.000Z' }
    })
    mockEndSession.mockResolvedValue({ revision: 4 })
    mockGetTeachingSession.mockResolvedValue(teachingSessionRecord())
    mockPersistAssistedLearnerMemory.mockResolvedValue(undefined)
  })

  it('VL 式收束（completeTask+endSession）且温故计划有 settled 项 → review:completed 入队', async () => {
    const result = await runClosure(ctx, virtualSession, {
      taskId: 'task-1', teachingSessionId: 'teaching-1', teachingRevision: 3
    })

    // 收束本体成立（这是 VL 的收束形状：completeTask + endSession，不走 finalize）
    expect(result.success).toBe(true)
    expect(result.taskCompleted).toBe(true)
    expect(mockCompleteTask).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'task-1', userId: 'user-1' }))
    expect(mockEndSession).toHaveBeenCalledWith('teaching-1', 'task-completed', 3)

    // 断链修复点：收束后按授课会话记录回写温故结果
    expect(mockGetTeachingSession).toHaveBeenCalledWith('teaching-1')
    expect(mockEnqueue).toHaveBeenCalledTimes(1)
    const event = mockEnqueue.mock.calls[0][1] as CapturedDomainEvent
    expect(event.type).toBe('review:completed')
    expect(event.aggregateType).toBe('review')
    expect(event.aggregateId).toBe('teaching-1')
    expect(event.userId).toBe('user-1')
    expect(event.source).toBe('session-finalization')
    // mastered@100 → easy；问过但没答出（askedAt 后有学员发言）→ again
    expect(event.data.reviewItems).toEqual([
      expect.objectContaining({ conceptKey: '一元一次方程', status: 'mastered', progress: 100, rating: 'easy' }),
      expect.objectContaining({ conceptKey: '分式方程', status: 'not-recalled', rating: 'again' })
    ])
  })

  it('授课会话没有温故计划（或全空）→ 不产生空事件', async () => {
    mockGetTeachingSession.mockResolvedValue({
      ...teachingSessionRecord(),
      teachingState: { sessionArtifacts: { memoryWarmup: { items: [] } } }
    })

    const result = await runClosure(ctx, virtualSession, {
      taskId: 'task-1', teachingSessionId: 'teaching-1', teachingRevision: 3
    })

    expect(result.success).toBe(true)
    expect(mockEndSession).toHaveBeenCalledTimes(1)
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('温故回写失败（取会话记录抛错）不阻断任务完成', async () => {
    mockGetTeachingSession.mockRejectedValue(new Error('db down'))

    const result = await runClosure(ctx, virtualSession, {
      taskId: 'task-1', teachingSessionId: 'teaching-1', teachingRevision: 3
    })

    expect(result.success).toBe(true)
    expect(result.taskCompleted).toBe(true)
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('无授课会话（teachingSessionId 缺失）→ 不取记录、不入队', async () => {
    const result = await runClosure(ctx, virtualSession, { taskId: 'task-1' })

    expect(result.success).toBe(true)
    expect(mockGetTeachingSession).not.toHaveBeenCalled()
    expect(mockEnqueue).not.toHaveBeenCalled()
  })
})
