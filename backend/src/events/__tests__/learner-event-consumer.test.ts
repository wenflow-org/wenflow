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
})
