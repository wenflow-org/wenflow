const upsert = jest.fn()
const notifyOutboxActivity = jest.fn()

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: { domain_event_outbox: { upsert } }
}))
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}))
jest.mock('../outbox-wake', () => ({
  __esModule: true,
  notifyOutboxActivity: () => notifyOutboxActivity()
}))

import {
  LESSON_ENRICHMENT_EVENT_TYPE,
  enqueueLessonEnrichmentEvent,
  lessonEnrichmentEventId,
} from '../lesson-enrichment-event'
import { createDomainEvent } from '../contracts'

const buildLessonEvent = (overrides: Record<string, unknown> = {}) => createDomainEvent({
  id: 'evt_lesson_completed_session-1',
  type: 'lesson:completed',
  aggregateType: 'lesson',
  aggregateId: 'session-1',
  userId: 'user-1',
  source: 'ai-teaching',
  data: { pathId: 'path-1', taskId: 'task-1' },
  occurredAt: new Date('2026-09-01T00:00:00Z'),
  ...overrides,
} as any)

describe('enqueueLessonEnrichmentEvent（课后增强拆为独立事件）', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    upsert.mockResolvedValue({})
  })

  it('#144：为 lesson:completed 登记独立增强事件（确定性 id + 只引用源事件，不复制 payload）', async () => {
    const lessonEvent = buildLessonEvent()

    await enqueueLessonEnrichmentEvent(lessonEvent)

    expect(upsert).toHaveBeenCalledTimes(1)
    const arg = upsert.mock.calls[0][0]
    expect(arg.where).toEqual({ id: `enr_${lessonEvent.id}` })
    expect(arg.create).toEqual(expect.objectContaining({
      id: `enr_${lessonEvent.id}`,
      eventType: LESSON_ENRICHMENT_EVENT_TYPE,
      aggregateType: 'lesson',
      aggregateId: 'session-1',
      userId: 'user-1',
      source: 'ai-teaching',
      status: 'pending',
      scheduledAt: null,
      occurredAt: lessonEvent.occurredAt,
    }))
    // 大 payload（wrapup / 对话上下文）不进增强行，只带源事件 id
    expect(JSON.parse(arg.create.payload)).toEqual({ lessonEventId: lessonEvent.id })
    expect(notifyOutboxActivity).toHaveBeenCalledTimes(1)
  })

  it('同一源事件重复登记是幂等 upsert（id 派生 + 空更新，不重置已终结的增强行）', async () => {
    const lessonEvent = buildLessonEvent()

    await enqueueLessonEnrichmentEvent(lessonEvent)
    await enqueueLessonEnrichmentEvent(lessonEvent)

    expect(upsert).toHaveBeenCalledTimes(2)
    expect(upsert.mock.calls[0][0].where).toEqual(upsert.mock.calls[1][0].where)
    expect(upsert.mock.calls[0][0].update).toEqual({})
  })

  it('非 lesson:completed / 无 userId：不登记（与其它学习者消费者一样早退）', async () => {
    await enqueueLessonEnrichmentEvent(buildLessonEvent({ type: 'task:completed' }))
    await enqueueLessonEnrichmentEvent(buildLessonEvent({ userId: null }))

    expect(upsert).not.toHaveBeenCalled()
    expect(notifyOutboxActivity).not.toHaveBeenCalled()
  })

  it('事件 id 由源事件派生（同一节课只有一个增强事件）', () => {
    expect(lessonEnrichmentEventId('evt_lesson_completed_x')).toBe('enr_evt_lesson_completed_x')
  })
})
