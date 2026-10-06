const transaction = jest.fn()
const inboxFindUnique = jest.fn()
const getActiveForConcepts = jest.fn()
const recordDegradation = jest.fn()

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    domain_event_inbox: { findUnique: inboxFindUnique },
    $transaction: transaction,
  },
}))

jest.mock('../misconception-ledger.service', () => ({
  __esModule: true,
  getActiveForConcepts: (...args: unknown[]) => getActiveForConcepts(...args),
}))

jest.mock('../../../skills/degradation-telemetry', () => ({
  __esModule: true,
  recordDegradation: (...args: unknown[]) => recordDegradation(...args),
  degradationCause: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}))

import { mapReviewStatusToRating, ReviewCompletedConsumer } from '../ReviewCompletedConsumer'
import { createDomainEvent } from '../../../events/contracts'

describe('mapReviewStatusToRating（复习结果 → FSRS 语义评分映射）', () => {
  it('mastered 满进度 → easy + 0.9', () => {
    expect(mapReviewStatusToRating('mastered', 100)).toEqual({ rating: 'easy', masteryScore: 0.9 })
  })

  it('mastered 未满进度 → good + 0.85', () => {
    expect(mapReviewStatusToRating('mastered', 60)).toEqual({ rating: 'good', masteryScore: 0.85 })
  })

  it('learning（推进但未掌握）→ hard + 0.5', () => {
    expect(mapReviewStatusToRating('learning', 40)).toEqual({ rating: 'hard', masteryScore: 0.5 })
  })

  it('其他状态（未推进，如 review/pending）→ again + 0.5', () => {
    expect(mapReviewStatusToRating('review', 50)).toEqual({ rating: 'again', masteryScore: 0.5 })
    expect(mapReviewStatusToRating('pending', 0)).toEqual({ rating: 'again', masteryScore: 0.5 })
  })
})

/**
 * 稳定键幂等（FIX §5-7）：endSession 失败/二次收束会对同一会话重复入队 review:completed，
 * 两条事件 eventId/occurredAt 不同 → 事件级幂等（consumerId+eventId）拦不住。
 * 消费端按「会话 + 概念」稳定键去重：重复事件对同一概念只应用一次。
 */
describe('ReviewCompletedConsumer 稳定键去重', () => {
  interface Tx {
    domain_event_inbox: { findUnique: jest.Mock; create: jest.Mock }
    teaching_sessions: { findUnique: jest.Mock }
    learner_evidence: { findFirst: jest.Mock; create: jest.Mock }
    memory_traces: { findUnique: jest.Mock; upsert: jest.Mock }
  }

  let tx: Tx

  // 跨调用持久化的最小状态：模拟真实 DB（第一条事件写入后，第二条事件能查到）
  let evidenceStore: Array<{ id: string; userId: string; sessionId: string | null; evidenceKey: string }>
  let inboxStore: Set<string>

  interface InboxWhere { consumerId_eventId: { eventId: string } }
  interface InboxCreateData { eventId: string }
  interface EvidenceWhere { userId: string; sessionId: string | null; evidenceKey: string }
  interface EvidenceCreateData { id: string; userId: string; sessionId: string | null; evidenceKey: string }

  const buildTx = (): Tx => ({
    domain_event_inbox: {
      findUnique: jest.fn(async ({ where }: { where: InboxWhere }) =>
        inboxStore.has(where.consumerId_eventId.eventId) ? { id: 'receipt' } : null),
      create: jest.fn(async ({ data }: { data: InboxCreateData }) => {
        inboxStore.add(data.eventId)
        return {}
      }),
    },
    teaching_sessions: { findUnique: jest.fn().mockResolvedValue({ learningPathId: 'path-1' }) },
    learner_evidence: {
      findFirst: jest.fn(async ({ where }: { where: EvidenceWhere }) =>
        evidenceStore.find((row) => row.userId === where.userId
          && row.sessionId === where.sessionId
          && row.evidenceKey === where.evidenceKey) ?? null),
      create: jest.fn(async ({ data }: { data: EvidenceCreateData }) => {
        evidenceStore.push({
          id: data.id, userId: data.userId, sessionId: data.sessionId, evidenceKey: data.evidenceKey,
        })
        return {}
      }),
    },
    memory_traces: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
  })

  const event = (id: string, occurredAtMs: number) => createDomainEvent({
    id,
    type: 'review:completed',
    aggregateType: 'review',
    aggregateId: 'ts-1',
    userId: 'user-1',
    source: 'session-finalization',
    occurredAt: new Date(occurredAtMs),
    data: {
      sessionId: 'ts-1',
      mode: 'tutor',
      reviewItems: [{ conceptKey: '光合作用', label: '光合作用', status: 'learning', progress: 40, masteryScore: 0.5, rating: 'hard' }],
    },
  })

  beforeEach(() => {
    jest.clearAllMocks()
    evidenceStore = []
    inboxStore = new Set()
    tx = buildTx()
    transaction.mockImplementation(async (callback: (client: Tx) => Promise<unknown>) => callback(tx))
    getActiveForConcepts.mockResolvedValue([])
  })

  it('首次事件写入证据与 FSRS 痕迹', async () => {
    await new ReviewCompletedConsumer().handle(event('evt-1', 1_700_000_000_000))

    expect(tx.learner_evidence.create).toHaveBeenCalledTimes(1)
    expect(tx.memory_traces.upsert).toHaveBeenCalledTimes(1)
    expect(tx.learner_evidence.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ evidenceKey: 'review:result:光合作用', sessionId: 'ts-1' }) })
    )
    expect(tx.domain_event_inbox.create).toHaveBeenCalledTimes(1)
  })

  it('同会话同概念的第二个事件（不同 eventId，模拟 end_only 后再 complete_task 二次收束）只应用一次', async () => {
    const consumer = new ReviewCompletedConsumer()
    await consumer.handle(event('evt-1', 1_700_000_000_000))
    expect(tx.learner_evidence.create).toHaveBeenCalledTimes(1)
    expect(tx.memory_traces.upsert).toHaveBeenCalledTimes(1)

    // 第二条事件：不同 eventId / occurredAt，但同会话同概念——必须被稳定键拦下
    await consumer.handle(event('evt-2', 1_700_000_060_000))

    expect(tx.learner_evidence.create).toHaveBeenCalledTimes(1)
    expect(tx.memory_traces.upsert).toHaveBeenCalledTimes(1)
    expect(tx.learner_evidence.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', sessionId: 'ts-1', evidenceKey: 'review:result:光合作用' } })
    )
    // 两条事件各自登记收据（事件级幂等仍独立成立）
    expect(tx.domain_event_inbox.create).toHaveBeenCalledTimes(2)
  })

  /**
   * 语义收紧钉死（复核意见第 3 条）：稳定键 = (sessionId, conceptKey)，**不含逐次作答 id**。
   * 因此同一会话内对同一概念的第二次**真实独立作答**会被判重复而只记一次。
   * 这是幂等的预期代价（当前 payload 无逐次作答标识）；本用例把这个行为固定下来，
   * 一旦未来 payload 引入逐次稳定 id，本用例必须同步改判据。
   */
  it('同一会话内对同一概念的两次独立作答（同 sessionId+conceptKey）只记一次（语义收紧钉死）', async () => {
    const consumer = new ReviewCompletedConsumer()
    // 两次独立作答：不同 eventId、不同 occurredAt、不同结果（learning → mastered）
    await consumer.handle(event('answer-1', 1_700_000_000_000))
    await consumer.handle(createDomainEvent({
      id: 'answer-2',
      type: 'review:completed',
      aggregateType: 'review',
      aggregateId: 'ts-1',
      userId: 'user-1',
      source: 'session-finalization',
      occurredAt: new Date(1_700_000_300_000),
      data: {
        sessionId: 'ts-1',
        mode: 'tutor',
        reviewItems: [{ conceptKey: '光合作用', label: '光合作用', status: 'mastered', progress: 100, masteryScore: 0.9, rating: 'easy' }],
      },
    }))

    // 第二次作答被稳定键拦下：只有第一条（learning/hard）落库
    expect(tx.learner_evidence.create).toHaveBeenCalledTimes(1)
    expect(tx.learner_evidence.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ evidenceKey: 'review:result:光合作用' }) })
    )
    expect(tx.memory_traces.upsert).toHaveBeenCalledTimes(1)
  })

  it('不同会话的同名概念各自应用（稳定键按会话分键，不误吞跨会话复习）', async () => {
    const consumer = new ReviewCompletedConsumer()
    await consumer.handle(event('evt-s1', 1_700_000_000_000))
    await consumer.handle(createDomainEvent({
      id: 'evt-s2',
      type: 'review:completed',
      aggregateType: 'review',
      aggregateId: 'ts-2',
      userId: 'user-1',
      source: 'session-finalization',
      occurredAt: new Date(1_700_000_060_000),
      data: {
        sessionId: 'ts-2',
        mode: 'tutor',
        reviewItems: [{ conceptKey: '光合作用', label: '光合作用', status: 'mastered', progress: 100, masteryScore: 0.9, rating: 'easy' }],
      },
    }))

    // 会话不同 → 稳定键不同 → 两次都应用
    expect(tx.learner_evidence.create).toHaveBeenCalledTimes(2)
    expect(tx.memory_traces.upsert).toHaveBeenCalledTimes(2)
  })

  it('已应用过（learner_evidence 已有同会话同概念行）的事件直接跳过，不重复写证据/FSRS', async () => {
    // 预置一条已应用证据（等价于另一进程/更早事件已处理该点）
    evidenceStore.push({ id: 'lev_existing', userId: 'user-1', sessionId: 'ts-1', evidenceKey: 'review:result:光合作用' })

    await new ReviewCompletedConsumer().handle(event('evt-2', 1_700_000_060_000))

    expect(tx.learner_evidence.create).not.toHaveBeenCalled()
    expect(tx.memory_traces.upsert).not.toHaveBeenCalled()
    // 事件本身仍登记收据（幂等收尾）
    expect(tx.domain_event_inbox.create).toHaveBeenCalledTimes(1)
  })

  it('同一事件内重复的同名概念只处理一次', async () => {
    const dup = createDomainEvent({
      id: 'evt-3',
      type: 'review:completed',
      aggregateType: 'review',
      aggregateId: 'ts-1',
      userId: 'user-1',
      source: 'session-finalization',
      data: {
        sessionId: 'ts-1',
        mode: 'tutor',
        reviewItems: [
          { conceptKey: '光合作用', label: '光合作用', status: 'learning', progress: 40, masteryScore: 0.5, rating: 'hard' },
          { conceptKey: '光合作用', label: '光合作用', status: 'mastered', progress: 100, masteryScore: 0.9, rating: 'easy' },
        ],
      },
    })

    await new ReviewCompletedConsumer().handle(dup)

    expect(tx.learner_evidence.create).toHaveBeenCalledTimes(1)
    expect(tx.memory_traces.upsert).toHaveBeenCalledTimes(1)
  })

  it('不同概念各自应用（稳定键按概念分键）', async () => {
    const multi = createDomainEvent({
      id: 'evt-4',
      type: 'review:completed',
      aggregateType: 'review',
      aggregateId: 'ts-1',
      userId: 'user-1',
      source: 'session-finalization',
      data: {
        sessionId: 'ts-1',
        mode: 'tutor',
        reviewItems: [
          { conceptKey: '光合作用', label: '光合作用', status: 'learning', progress: 40, masteryScore: 0.5, rating: 'hard' },
          { conceptKey: '呼吸作用', label: '呼吸作用', status: 'mastered', progress: 100, masteryScore: 0.9, rating: 'easy' },
        ],
      },
    })

    await new ReviewCompletedConsumer().handle(multi)

    expect(tx.learner_evidence.create).toHaveBeenCalledTimes(2)
    expect(tx.memory_traces.upsert).toHaveBeenCalledTimes(2)
  })

  it('事件级幂等（收据已存在）时不进入稳定键分支', async () => {
    tx.domain_event_inbox.findUnique.mockResolvedValue({ id: 'inbox_existing' })

    await new ReviewCompletedConsumer().handle(event('evt-5', 1_700_000_120_000))

    expect(tx.learner_evidence.findFirst).not.toHaveBeenCalled()
    expect(tx.learner_evidence.create).not.toHaveBeenCalled()
    expect(tx.memory_traces.upsert).not.toHaveBeenCalled()
  })
})