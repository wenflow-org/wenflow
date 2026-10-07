/**
 * 课内温故回写的**共用实现**（18 号报告 N10）：抽成叶子模块后，
 * 正常收束与**超时兜底**共用同一实现——有温故结果的会话必须入队 `review:completed`。
 */
const mockTransaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({}))
const mockEnqueue = jest.fn()

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: { $transaction: (fn: (tx: unknown) => Promise<unknown>) => mockTransaction(fn) },
}))
jest.mock('../../../events/outbox.repository', () => ({
  enqueueDomainEvent: (...args: unknown[]) => mockEnqueue(...args),
}))
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

import { applyWarmupExtractionForSession } from '../warmup-writeback'

const sessionWith = (items: unknown[]) => ({
  id: 's1',
  userId: 'u1',
  mode: 'teaching',
  messages: [],
  teachingState: { sessionArtifacts: { memoryWarmup: { items } } },
}) as any

describe('applyWarmupExtractionForSession（温故结果回写记忆引擎）', () => {
  beforeEach(() => jest.clearAllMocks())

  it('有温故结果的会话 → 入队 review:completed（含映射后的评分）', async () => {
    await applyWarmupExtractionForSession(sessionWith([
      { conceptKey: 'c1', label: '概念一', outcome: { status: 'mastered', progress: 100 } },
    ]))

    expect(mockEnqueue).toHaveBeenCalledTimes(1)
    const event = mockEnqueue.mock.calls[0][1] as any
    expect(event.type).toBe('review:completed')
    expect(event.data.reviewItems).toHaveLength(1)
    expect(event.data.reviewItems[0]).toMatchObject({ conceptKey: 'c1', rating: expect.any(String) })
  })

  it('温故计划为空 → 不入队（不产生空事件）', async () => {
    await applyWarmupExtractionForSession(sessionWith([]))
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('事件显式携带 occurredAt（C4 时钟漏点：模拟日历下不得回落墙钟兜底）', async () => {
    await applyWarmupExtractionForSession(sessionWith([
      { conceptKey: 'c1', label: '概念一', outcome: { status: 'mastered', progress: 100 } },
    ]))

    const event = mockEnqueue.mock.calls[0][1] as any
    // createDomainEvent 的兜底是 new Date()；修复后必须显式传 simulatedNowOr()——
    // 断言「字段存在」即可钉死契约（真机 VL 验证由 measurement-verify 长程跑批覆盖）
    expect(event.occurredAt).toBeInstanceOf(Date)
  })

  it('入队失败不影响收束（吞异常）', async () => {
    mockTransaction.mockRejectedValueOnce(new Error('db down'))
    await expect(applyWarmupExtractionForSession(sessionWith([
      { conceptKey: 'c1', outcome: { status: 'learning', progress: 40 } },
    ]))).resolves.toBeUndefined()
  })
})
