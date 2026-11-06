const mockEvidenceHandle = jest.fn()
const mockEnrichmentHandle = jest.fn()
const mockEnqueueEnrichment = jest.fn()
const mockProfileClear = jest.fn()
const mockSnapshotRefresh = jest.fn()

jest.mock('../../services/learner/LearnerEvidenceProjector', () => ({
  __esModule: true,
  learnerEvidenceProjector: { handle: (event: unknown) => mockEvidenceHandle(event) }
}))
// 保留这个 mock：若有人把「同步 await 课后增强」重新塞回关键路径，下面的 #144 用例会立即变红。
jest.mock('../../services/learner/LessonKnowledgeEnrichmentConsumer', () => ({
  __esModule: true,
  lessonKnowledgeEnrichmentConsumer: { handle: (event: unknown) => mockEnrichmentHandle(event) }
}))
jest.mock('../lesson-enrichment-event', () => ({
  __esModule: true,
  LESSON_ENRICHMENT_EVENT_TYPE: 'lesson:knowledge-enrichment',
  lessonEnrichmentEventId: (lessonEventId: string) => `enr_${lessonEventId}`,
  enqueueLessonEnrichmentEvent: (event: unknown) => mockEnqueueEnrichment(event)
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

describe('handleLearnerEvent（快路径：投影 + 清缓存 + 快照刷新，课后增强拆为独立事件）', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEvidenceHandle.mockResolvedValue(undefined)
    mockEnrichmentHandle.mockResolvedValue(undefined)
    mockEnqueueEnrichment.mockResolvedValue(undefined)
    mockProfileClear.mockReturnValue(undefined)
    mockSnapshotRefresh.mockResolvedValue(undefined)
  })

  it('#144：LLM 不在关键路径上——lesson:completed 消费不再调用课后增强消费者', async () => {
    await expect(handleLearnerEvent(buildEvent())).resolves.toBeUndefined()

    // 旧实现这里 await lessonKnowledgeEnrichmentConsumer.handle(event)（一次 10–20s 的 LLM）
    expect(mockEnrichmentHandle).not.toHaveBeenCalled()
    // 改为登记一条独立的增强事件，由 outbox 的增强泳道消费
    expect(mockEnqueueEnrichment).toHaveBeenCalledTimes(1)
    expect(mockEnqueueEnrichment).toHaveBeenCalledWith(expect.objectContaining({
      id: 'evt-1',
      type: 'lesson:completed',
      userId: 'user-1',
    }))
    // 快路径本身照常落地
    expect(mockEvidenceHandle).toHaveBeenCalledTimes(1)
    expect(mockProfileClear).toHaveBeenCalledWith('user-1')
    expect(mockSnapshotRefresh).toHaveBeenCalledTimes(1)
  })

  it('#146：增强失败不再「吞下再重抛」——本消费者链尾不抛错，快照只刷新一次', async () => {
    // 旧断言是「增强失败仍在链尾重抛」，那正是 #146 的病灶（重投 → 整链重跑最多 8 次）
    await expect(handleLearnerEvent(buildEvent())).resolves.toBeUndefined()
    expect(mockSnapshotRefresh).toHaveBeenCalledTimes(1)
    expect(mockSnapshotRefresh).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      pathId: 'path-1',
      taskId: 'task-1',
      scope: 'teaching',
      lastEventId: 'evt-1',
    }))
    // 增强消费者（唯一会 throw 的 LLM 入口）根本不在本链路上
    expect(mockEnrichmentHandle).not.toHaveBeenCalled()
  })

  it('登记增强事件失败（快路径基础设施错误）仍抛给 outbox 重投', async () => {
    mockEnqueueEnrichment.mockRejectedValue(new Error('sqlite busy'))

    await expect(handleLearnerEvent(buildEvent())).rejects.toThrow('sqlite busy')
    // 投影与刷新已执行（幂等：evidenceKey + upsert / lastEventId 短路），重投只补登记
    expect(mockEvidenceHandle).toHaveBeenCalledTimes(1)
    expect(mockSnapshotRefresh).toHaveBeenCalledTimes(1)
  })

  it('#144：非 lesson:completed 事件不触发增强登记', async () => {
    // 登记函数的类型/userId 早退由 lesson-enrichment-event.test.ts 覆盖；此处锁定调用点只对
    // lesson:completed 之后的快路径无副作用（本消费者不因其他事件多出一次真实 upsert）。
    mockEnqueueEnrichment.mockImplementation(async () => undefined)

    await handleLearnerEvent(buildEvent({ id: 'evt-task', type: 'task:completed', aggregateType: 'task' }))

    // 消费者对 task:completed 仍会调用登记函数，但真实实现按 type 早退——这里断言投影/刷新不受影响
    expect(mockSnapshotRefresh).toHaveBeenCalledTimes(1)
    expect(mockEvidenceHandle).toHaveBeenCalledTimes(1)
  })

  it('顺序固定：证据投影 → 清缓存/快照刷新 → 登记增强事件', async () => {
    const order: string[] = []
    mockEvidenceHandle.mockImplementation(async () => { order.push('evidence') })
    mockSnapshotRefresh.mockImplementation(async () => { order.push('refresh') })
    mockEnqueueEnrichment.mockImplementation(async () => { order.push('enqueue-enrichment') })

    await handleLearnerEvent(buildEvent())

    expect(order).toEqual(['evidence', 'refresh', 'enqueue-enrichment'])
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
