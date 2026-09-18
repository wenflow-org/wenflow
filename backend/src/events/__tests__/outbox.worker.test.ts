const records: any[] = []
const mockPrisma: any = {
  domain_event_outbox: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    updateMany: jest.fn()
  }
}

jest.mock('../../config/database', () => ({ __esModule: true, default: mockPrisma }))
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}))

import { DurableOutboxWorker } from '../outbox.worker'

describe('DurableOutboxWorker same-user ordering', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    records.length = 0
    mockPrisma.domain_event_outbox.findMany.mockImplementation(async () => records
      .filter(record => record.status === 'pending' && record.availableAt <= new Date())
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime()
        || a.createdAt.getTime() - b.createdAt.getTime()
        || a.id.localeCompare(b.id)))
    mockPrisma.domain_event_outbox.findFirst.mockImplementation(async ({ where }: any) => records
      .filter(record => (Array.isArray(where.eventType?.in)
          ? where.eventType.in.includes(record.eventType)
          : record.eventType === where.eventType)
        && record.userId === where.userId
        && where.status.in.includes(record.status))
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime()
        || a.createdAt.getTime() - b.createdAt.getTime()
        || a.id.localeCompare(b.id))[0] || null)
    mockPrisma.domain_event_outbox.updateMany.mockImplementation(async ({ where, data }: any) => {
      const record = records.find(item => item.id === where.id)
      if (!record) return { count: 0 }
      if (where.lockOwner && record.lockOwner !== where.lockOwner) return { count: 0 }
      if (where.status === 'processing' && record.status !== 'processing') return { count: 0 }
      if (where.OR && record.status !== 'pending' && record.status !== 'processing') return { count: 0 }
      Object.assign(record, data)
      return { count: 1 }
    })
  })

  it('blocks a later task event after the oldest same-user event backs off while another user proceeds', async () => {
    const base = new Date(Date.now() - 10_000)
    records.push(
      buildRecord('old-user-1', 'user-1', base),
      buildRecord('new-user-1', 'user-1', new Date(base.getTime() + 1000)),
      buildRecord('user-2-event', 'user-2', new Date(base.getTime() + 2000))
    )
    const dispatched: string[] = []
    const registry = {
      dispatch: jest.fn(async (event: any) => {
        dispatched.push(event.id)
        if (event.id === 'old-user-1') throw new Error('temporary failure')
      })
    }

    const worker = new DurableOutboxWorker(registry as any)
    await worker.runOnce()

    expect(dispatched).toEqual(['old-user-1', 'user-2-event'])
    expect(records.find(record => record.id === 'old-user-1')).toEqual(expect.objectContaining({
      status: 'pending',
      attemptCount: 1,
      availableAt: expect.any(Date)
    }))
    expect(records.find(record => record.id === 'new-user-1')?.status).toBe('pending')
    expect(records.find(record => record.id === 'user-2-event')?.status).toBe('published')

    await worker.runOnce()

    expect(dispatched).toEqual(['old-user-1', 'user-2-event'])
    expect(records.find(record => record.id === 'new-user-1')?.status).toBe('pending')
  })

  it('lesson:completed 同样受同用户队头保护（旧实现只保护 task:completed，画像会乱序回退）', async () => {
    const base = new Date(Date.now() - 10_000)
    records.push(
      buildRecord('old-lesson-1', 'user-1', base, 'lesson:completed'),
      buildRecord('new-lesson-1', 'user-1', new Date(base.getTime() + 1000), 'lesson:completed'),
      buildRecord('lesson-user-2', 'user-2', new Date(base.getTime() + 2000), 'lesson:completed')
    )
    const dispatched: string[] = []
    const registry = {
      dispatch: jest.fn(async (event: any) => {
        dispatched.push(event.id)
        if (event.id === 'old-lesson-1') throw new Error('temporary failure')
      })
    }

    const worker = new DurableOutboxWorker(registry as any)
    await worker.runOnce()

    // 队首退避 → 同用户后一课被阻塞；另一用户不受影响
    expect(dispatched).toEqual(['old-lesson-1', 'lesson-user-2'])
    expect(records.find(record => record.id === 'new-lesson-1')?.status).toBe('pending')
    expect(records.find(record => record.id === 'lesson-user-2')?.status).toBe('published')
  })

  it('跨类型也按用户排头：更早的 lesson:completed 未决时，后到的 task:completed 被阻塞（18 号报告 N7）', async () => {
    const base = new Date(Date.now() - 10_000)
    records.push(
      buildRecord('old-lesson', 'user-1', base, 'lesson:completed'),
      buildRecord('new-task', 'user-1', new Date(base.getTime() + 1000), 'task:completed')
    )
    const dispatched: string[] = []
    const registry = {
      dispatch: jest.fn(async (event: any) => { dispatched.push(event.id) })
    }

    const worker = new DurableOutboxWorker(registry as any)
    await worker.runOnce()

    // 只消费更早的 lesson；更晚的 task 让位（旧实现按 eventType:userId 分键，会两个都消费）
    expect(dispatched).toEqual(['old-lesson'])
    expect(records.find(record => record.id === 'new-task')?.status).toBe('pending')

    await worker.runOnce()
    expect(dispatched).toEqual(['old-lesson', 'new-task'])
  })

  it('marks task events dead at max attempts so later same-user events are not blocked forever', async () => {
    const base = new Date(Date.now() - 10_000)
    records.push(
      buildRecord('old-user-1', 'user-1', base, 'task:completed', 7),
      buildRecord('new-user-1', 'user-1', new Date(base.getTime() + 1000))
    )
    const registry = {
      dispatch: jest.fn(async () => {
        throw new Error('still temporary')
      })
    }

    const worker = new DurableOutboxWorker(registry as any)
    await worker.runOnce()

    expect(registry.dispatch).toHaveBeenCalledTimes(1)
    expect(records.find(record => record.id === 'old-user-1')).toEqual(expect.objectContaining({
      status: 'dead',
      attemptCount: 8
    }))
    expect(records.find(record => record.id === 'new-user-1')?.status).toBe('pending')

    // 毒事件入死信后不再计入「最老未决」，同用户后续事件解除队头阻塞；
    // 死信可通过 POST /api/admin/devtools/outbox/requeue-dead 人工重放
    await worker.runOnce()

    expect(records.find(record => record.id === 'new-user-1')).toEqual(expect.objectContaining({
      status: 'pending',
      attemptCount: 1
    }))
  })

  it('still marks non-task events dead at the normal max attempts', async () => {
    const base = new Date(Date.now() - 10_000)
    records.push(buildRecord('path-event', 'user-1', base, 'path:completed', 7))
    const registry = { dispatch: jest.fn().mockRejectedValue(new Error('permanent')) }

    const worker = new DurableOutboxWorker(registry as any)
    await worker.runOnce()

    expect(records[0]).toEqual(expect.objectContaining({ status: 'dead', attemptCount: 8 }))
  })
})

function buildRecord(
  id: string,
  userId: string,
  occurredAt: Date,
  eventType = 'task:completed',
  attemptCount = 0
) {
  return {
    id,
    eventType,
    schemaVersion: 1,
    aggregateType: 'task',
    aggregateId: `${id}-task`,
    aggregateVersion: null,
    userId,
    source: 'test',
    payload: JSON.stringify({ taskId: `${id}-task` }),
    metadata: null,
    status: 'pending',
    attemptCount,
    availableAt: occurredAt,
    lockedAt: null,
    lockOwner: null,
    occurredAt,
    createdAt: occurredAt
  }
}
