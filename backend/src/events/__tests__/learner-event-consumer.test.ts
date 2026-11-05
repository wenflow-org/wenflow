const mockEvidenceHandle = jest.fn()
const mockEnrichmentHandle = jest.fn()
const mockProfileClear = jest.fn()
const mockSnapshotRefresh = jest.fn()

jest.mock('../../services/learner/LearnerEvidenceProjector', () => ({
  __esModule: true,
  learnerEvidenceProjector: { handle: (event: unknown) => mockEvidenceHandle(event) }
}))
jest.mock('../../services/learner/LessonKnowledgeEnrichmentConsumer', () => ({
  __esModule: true,
  lessonKnowledgeEnrichmentConsumer: { handle: (event: unknown) => mockEnrichmentHandle(event) }
}))
jest.mock('../../services/learner/LearnerProfileService', () => ({
  __esModule: true,
  learnerProfileService: { clear: (userId: string) => mockProfileClear(userId) }
}))
jest.mock('../../services/learner/LearnerSnapshotRefreshService', () => ({
  __esModule: true,
  learnerSnapshotRefreshService: { refresh: (input: unknown) => mockSnapshotRefresh(input) }
}))
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}))

import { handleLearnerEvent } from '../learner-event-consumer'

const buildEvent = (overrides: Record<string, unknown> = {}) => ({
  id: 'evt-1',
  type: 'lesson:completed',
  schemaVersion: 1,
  aggregateType: 'lesson',
  aggregateId: 'lesson-1',
  userId: 'user-1',
  source: 'test',
  data: { pathId: 'path-1', taskId: 'task-1' },
  occurredAt: new Date('2026-09-01T00:00:00Z'),
  ...overrides
}) as any

describe('handleLearnerEvent（课后增强失败不得阻断画像快照刷新，审计 §6.1）', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEvidenceHandle.mockResolvedValue(undefined)
    mockEnrichmentHandle.mockResolvedValue(undefined)
    mockProfileClear.mockReturnValue(undefined)
    mockSnapshotRefresh.mockResolvedValue(undefined)
  })

  it('增强失败：清缓存与快照刷新照常执行，且错误在链尾重抛给 outbox 退避重投', async () => {
    mockEnrichmentHandle.mockRejectedValue(new Error('llm timeout'))

    await expect(handleLearnerEvent(buildEvent())).rejects.toThrow('llm timeout')

    // 关键回归：增强 throw 之后，清缓存与快照刷新仍必须发生
    expect(mockProfileClear).toHaveBeenCalledWith('user-1')
    expect(mockSnapshotRefresh).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      pathId: 'path-1',
      taskId: 'task-1',
      scope: 'teaching',
      lastEventId: 'evt-1',
    }))
  })

  it('增强成功：链路完整且不抛错', async () => {
    await expect(handleLearnerEvent(buildEvent())).resolves.toBeUndefined()
    expect(mockEvidenceHandle).toHaveBeenCalledTimes(1)
    expect(mockEnrichmentHandle).toHaveBeenCalledTimes(1)
    expect(mockProfileClear).toHaveBeenCalledWith('user-1')
    expect(mockSnapshotRefresh).toHaveBeenCalledTimes(1)
  })

  it('顺序固定：证据投影 → 课后增强 → 清缓存/快照刷新', async () => {
    const order: string[] = []
    mockEvidenceHandle.mockImplementation(async () => { order.push('evidence') })
    mockEnrichmentHandle.mockImplementation(async () => { order.push('enrichment') })
    mockSnapshotRefresh.mockImplementation(async () => { order.push('refresh') })

    await handleLearnerEvent(buildEvent())

    expect(order).toEqual(['evidence', 'enrichment', 'refresh'])
  })

  it('无 userId：跳过清缓存与快照，且不因缺少 userId 报错', async () => {
    await expect(handleLearnerEvent(buildEvent({ userId: null }))).resolves.toBeUndefined()
    expect(mockProfileClear).not.toHaveBeenCalled()
    expect(mockSnapshotRefresh).not.toHaveBeenCalled()
  })

  it('#147：教学收尾的 task:completed（带 sessionId）不再重复刷新快照，但证据投影照做', async () => {
    await handleLearnerEvent(buildEvent({
      id: 'evt-task',
      type: 'task:completed',
      aggregateType: 'task',
      aggregateId: 'task-1',
      data: { pathId: 'path-1', taskId: 'task-1', sessionId: 'session-1' },
    }))

    // 同一收尾的 lesson:completed 已刷新过同一 projectionKey，这里不再重算
    expect(mockSnapshotRefresh).not.toHaveBeenCalled()
    expect(mockEvidenceHandle).toHaveBeenCalledTimes(1)
  })

  it('#147：纯路径 task:completed（无 sessionId）仍刷新快照', async () => {
    await handleLearnerEvent(buildEvent({
      id: 'evt-task',
      type: 'task:completed',
      aggregateType: 'task',
      aggregateId: 'task-1',
      data: { pathId: 'path-1', taskId: 'task-1' },
    }))

    expect(mockSnapshotRefresh).toHaveBeenCalledTimes(1)
    expect(mockSnapshotRefresh).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'teaching',
      lastEventId: 'evt-task',
    }))
  })

  it('#147 验收：一次收尾的两个事件（无论消费顺序）合计只刷新一次快照', async () => {
    const lessonEvent = () => buildEvent({
      id: 'evt-lesson',
      type: 'lesson:completed',
      aggregateType: 'lesson',
      data: { pathId: 'path-1', taskId: 'task-1', sessionId: 'session-1' },
    })
    const taskEvent = () => buildEvent({
      id: 'evt-task',
      type: 'task:completed',
      aggregateType: 'task',
      aggregateId: 'task-1',
      data: { pathId: 'path-1', taskId: 'task-1', sessionId: 'session-1' },
    })

    // 正序（真人 finalize：endSession 先入队 lesson:completed）
    await handleLearnerEvent(lessonEvent())
    await handleLearnerEvent(taskEvent())
    expect(mockSnapshotRefresh).toHaveBeenCalledTimes(1)

    // 逆序（VL/simulation：completeTask 先入队 task:completed）——结论与顺序无关
    mockSnapshotRefresh.mockClear()
    await handleLearnerEvent(taskEvent())
    await handleLearnerEvent(lessonEvent())
    expect(mockSnapshotRefresh).toHaveBeenCalledTimes(1)
  })

  it('#148：goal:understanding:updated 只作废画像缓存，不再触发 global 全量快照重算', async () => {
    await handleLearnerEvent(buildEvent({
      id: 'evt-goal',
      type: 'goal:understanding:updated',
      aggregateType: 'goal',
      aggregateId: 'gc-1',
      data: { conversationId: 'gc-1', stage: 'clarify', confidence: 0.4 },
    }))

    // 证据投影与画像缓存作废照常（profile-aggregator 读的正是本事件写入的 goal 证据）
    expect(mockEvidenceHandle).toHaveBeenCalledTimes(1)
    expect(mockProfileClear).toHaveBeenCalledWith('user-1')
    // 载荷无 pathId → 旧实现恒落到 scope:'global'，每轮重建用户级全量快照
    expect(mockSnapshotRefresh).not.toHaveBeenCalled()
  })
})
