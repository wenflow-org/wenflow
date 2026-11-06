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
import { runWithContext, getRequestContext } from '../../gateway/api-gateway/context'
import type { DurableEventType } from '../contracts'

/** 课后增强泳道（#144）：与生产装配一致——只拾取增强事件、并发执行 */
const ENRICHMENT_EVENT_TYPES: ReadonlySet<DurableEventType> = new Set(['lesson:knowledge-enrichment'])

describe('DurableOutboxWorker 同用户有序 + 泳道分离', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    records.length = 0
    mockPrisma.domain_event_outbox.findMany.mockImplementation(async ({ where }: any = {}) => {
      const typeFilter = where?.eventType
      return records
        .filter(record => record.status === 'pending'
          && record.availableAt <= new Date()
          && (!record.scheduledAt || record.scheduledAt <= new Date()))
        .filter(record => {
          if (!typeFilter) return true
          if (Array.isArray(typeFilter.in)) return typeFilter.in.includes(record.eventType)
          if (Array.isArray(typeFilter.notIn)) return !typeFilter.notIn.includes(record.eventType)
          return true
        })
        .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime()
          || a.createdAt.getTime() - b.createdAt.getTime()
          || a.id.localeCompare(b.id))
    })
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

  it('#106② schedule gate: scheduledAt 未到点不拾取、到点拾取、NULL 立即可拾取', async () => {
    const base = new Date(Date.now() - 10_000)
    const future = new Date(Date.now() + 60 * 60 * 1000)
    records.push(
      buildRecord('plain-now', 'user-a', base, 'task:completed', 0, null),
      buildRecord('sched-due', 'user-b', new Date(base.getTime() + 1000), 'task:completed', 0, base),
      buildRecord('sched-future', 'user-c', new Date(base.getTime() + 2000), 'task:completed', 0, future)
    )
    const dispatched: string[] = []
    const registry = { dispatch: jest.fn(async (event: any) => { dispatched.push(event.id) }) }

    const worker = new DurableOutboxWorker(registry as any)
    await worker.runOnce()

    expect(dispatched).toEqual(['plain-now', 'sched-due'])
    expect(records.find(record => record.id === 'sched-future')?.status).toBe('pending')

    // 排期到点（把 scheduledAt 拨到过去）后即可拾取
    const scheduled = records.find(record => record.id === 'sched-future')
    scheduled.scheduledAt = new Date(Date.now() - 1000)
    await worker.runOnce()

    expect(dispatched).toEqual(['plain-now', 'sched-due', 'sched-future'])
    expect(scheduled.status).toBe('published')
  })

  /* 2026-11-01 实测回归：入队唤醒的防抖定时器会继承入队请求的 ALS 上下文，其中带着
     那次 HTTP 请求的 abortSignal（绑在 res close 上）。结课响应一关，消费链里的技能
     调用就在 executor 入口被判 CALLER_ABORTED——两节课各出现一次
     「持久事件消费者失败（Skill execution aborted by caller）」，课后知识增强晚一轮落地。
     后台消费不得继承请求的取消信号。 */
  it('消费不吃入队请求的 abortSignal（摘掉取消信号，保留用户身份）', async () => {
    const base = new Date(Date.now() - 10_000)
    records.push(buildRecord('lesson-1', 'user-1', base, 'lesson:completed'))
    const controller = new AbortController()
    let seenAborted: boolean | undefined
    let seenUserId: string | undefined
    const registry = {
      dispatch: jest.fn(async () => {
        const ctx = getRequestContext()
        seenAborted = ctx.abortSignal?.aborted
        seenUserId = ctx.userId
      })
    }

    const worker = new DurableOutboxWorker(registry as any)
    // 模拟「请求处理中入队 → 响应已关闭」：请求上下文已中止，唤醒才轮到 worker
    controller.abort()
    await runWithContext(
      { userId: 'user-request', sourceEntry: 'user', abortSignal: controller.signal },
      () => worker.runOnce()
    )

    expect(seenAborted).toBeUndefined()
    expect(seenUserId).toBe('user-request')
    expect(records[0].status).toBe('published')
  })

  /* #145：课后增强失败原先让整条 lesson:completed 退避重投（≈182s），同用户所有后续学习者线事件
     都卡在这条队头之后。拆成独立事件后，增强有自己的泳道，不进 ORDERED_EVENT_TYPES。 */
  it('#145：增强事件连续失败不阻塞同用户后续有序事件', async () => {
    const base = new Date(Date.now() - 10_000)
    records.push(
      buildRecord('enr-lesson-1', 'user-1', base, 'lesson:knowledge-enrichment'),
      buildRecord('task-after', 'user-1', new Date(base.getTime() + 1000), 'task:completed')
    )
    const registry = {
      dispatch: jest.fn(async (event: any) => {
        if (event.type === 'lesson:knowledge-enrichment') throw new Error('llm timeout')
      })
    }
    const main = new DurableOutboxWorker(registry as any, { excludeEventTypes: ENRICHMENT_EVENT_TYPES })
    const enrichment = new DurableOutboxWorker(registry as any, {
      includeEventTypes: ENRICHMENT_EVENT_TYPES,
      concurrency: 3,
      ownsWakeListener: false
    })

    // 增强连续失败 3 次（退避重试期）
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const row = records.find(record => record.id === 'enr-lesson-1')!
      row.availableAt = new Date(Date.now() - 1)
      await enrichment.runOnce()
      expect(row.attemptCount).toBe(attempt)
      expect(row.status).toBe('pending')
    }
    expect(records.find(record => record.id === 'enr-lesson-1')?.status).toBe('pending')

    // 同用户的后续有序事件仍在下一次主泳道 tick 被消费——延迟不随增强重试次数增长
    await main.runOnce()
    expect(records.find(record => record.id === 'task-after')?.status).toBe('published')
    // 主泳道从不拾取增强行（否则它会再次进入退避并把 attemptCount 推到 4）
    expect(records.find(record => record.id === 'enr-lesson-1')?.attemptCount).toBe(3)
  })

  /* #146：旧实现里增强失败 → 链尾重抛 → 整条 lesson:completed 从头重跑最多 8 次。
     拆分后源事件一次 published，增强按自己的尝试计数单独重试。 */
  it('#146：增强失败不再让 lesson:completed 整链重跑（源事件只消费一次）', async () => {
    const base = new Date(Date.now() - 10_000)
    records.push(
      buildRecord('lesson-src', 'user-1', base, 'lesson:completed'),
      buildRecord('enr_lesson-src', 'user-1', new Date(base.getTime() + 1), 'lesson:knowledge-enrichment')
    )
    let lessonDispatches = 0
    const registry = {
      dispatch: jest.fn(async (event: any) => {
        if (event.type === 'lesson:completed') {
          lessonDispatches += 1
          return
        }
        throw new Error('llm timeout')
      })
    }
    const main = new DurableOutboxWorker(registry as any, { excludeEventTypes: ENRICHMENT_EVENT_TYPES })
    const enrichment = new DurableOutboxWorker(registry as any, {
      includeEventTypes: ENRICHMENT_EVENT_TYPES,
      concurrency: 1,
      ownsWakeListener: false
    })

    await main.runOnce()
    expect(lessonDispatches).toBe(1)
    expect(records.find(record => record.id === 'lesson-src')).toEqual(expect.objectContaining({
      status: 'published',
      attemptCount: 0
    }))

    // 增强重试 3 轮，源事件不再被重投 → 投影/清缓存/快照刷新不会跟着重跑
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const row = records.find(record => record.id === 'enr_lesson-src')!
      row.availableAt = new Date(Date.now() - 1)
      await enrichment.runOnce()
      expect(row.attemptCount).toBe(attempt)
    }
    await main.runOnce()

    expect(lessonDispatches).toBe(1)
    expect(records.find(record => record.id === 'enr_lesson-src')?.status).toBe('pending')
  })

  /* #144：增强泳道 3 路并发——第 4 个用户的增强不必等前 3 个 LLM 跑完（串行是原来的队头阻塞）。 */
  it('#144：增强泳道跨用户并发，一个慢增强不堵住其他用户的增强', async () => {
    const base = new Date(Date.now() - 10_000)
    for (let index = 0; index < 4; index += 1) {
      records.push(buildRecord(
        `enr-lesson-${index}`,
        `user-${index}`,
        new Date(base.getTime() + index),
        'lesson:knowledge-enrichment'
      ))
    }
    const started: string[] = []
    const gates: Array<() => void> = []
    const registry = {
      dispatch: jest.fn((event: any) => new Promise<void>((resolve) => {
        started.push(event.id)
        gates.push(() => resolve())
      }))
    }
    const enrichment = new DurableOutboxWorker(registry as any, {
      includeEventTypes: ENRICHMENT_EVENT_TYPES,
      concurrency: 3,
      ownsWakeListener: false
    })

    const run = enrichment.runOnce()
    await new Promise(resolve => setImmediate(resolve))

    // 3 个不同用户同时在跑 LLM（旧实现：必须等第 1 个 10–20s 跑完才轮到第 2 个）
    expect(started).toEqual(['enr-lesson-0', 'enr-lesson-1', 'enr-lesson-2'])

    gates.forEach(release => release())
    await new Promise(resolve => setImmediate(resolve))
    expect(started).toHaveLength(4)

    gates.slice(3).forEach(release => release())
    await run

    expect(records.every(record => record.status === 'published')).toBe(true)
  })

  it('#145：并发泳道不允许承载有序事件（构造期拒绝，避免绕过同用户队首保护）', () => {
    expect(() => new DurableOutboxWorker({ dispatch: jest.fn() } as any, {
      includeEventTypes: new Set<DurableEventType>(['lesson:knowledge-enrichment', 'lesson:completed']),
      concurrency: 3
    })).toThrow(/并发泳道不得承载有序事件类型/)
  })
})

function buildRecord(
  id: string,
  userId: string,
  occurredAt: Date,
  eventType = 'task:completed',
  attemptCount = 0,
  scheduledAt: Date | null = null
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
    scheduledAt,
    lockedAt: null,
    lockOwner: null,
    occurredAt,
    createdAt: occurredAt
  }
}
