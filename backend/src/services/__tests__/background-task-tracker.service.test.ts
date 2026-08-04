import {
  BackgroundTaskRejectedError,
  BackgroundTaskTracker,
  runBackgroundTask
} from '../background-task-tracker.service'
import { requestContextStorage } from '../../gateway/api-gateway/context'

describe('BackgroundTaskTracker', () => {
  it('drain 等待现有任务并拒绝启动新任务', async () => {
    const tracker = new BackgroundTaskTracker()
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const existing = tracker.track('existing', () => pending)
    const draining = tracker.drain()
    let drained = false
    void draining.then(() => { drained = true })
    await Promise.resolve()
    expect(drained).toBe(false)

    const rejectedFactory = jest.fn(async () => undefined)
    await expect(tracker.track('rejected', rejectedFactory)).rejects
      .toBeInstanceOf(BackgroundTaskRejectedError)
    expect(rejectedFactory).not.toHaveBeenCalled()

    release()
    await Promise.all([existing, draining])
    expect(drained).toBe(true)
  })

  it('业务 rejection 返回调用方但不阻塞 drain', async () => {
    const tracker = new BackgroundTaskTracker()
    const operation = tracker.track('failed', async () => {
      throw new Error('task failed')
    })
    await expect(operation).rejects.toThrow('task failed')
    await expect(tracker.drain()).resolves.toBeUndefined()
  })
})

describe('runBackgroundTask', () => {
  it('脱离请求级 abortSignal，保留 traceId 等溯源字段', async () => {
    const controller = new AbortController()
    let seen: { abortSignal?: AbortSignal; traceId?: string; userId?: string } = {}
    let markDone!: () => void
    const finished = new Promise<void>(resolve => { markDone = resolve })

    requestContextStorage.run(
      { abortSignal: controller.signal, traceId: 'trace-detach-1', userId: 'u-1' },
      () => {
        runBackgroundTask('test.detach-abort', async () => {
          const ctx = requestContextStorage.getStore() || {}
          seen = { abortSignal: ctx.abortSignal, traceId: ctx.traceId, userId: ctx.userId }
          markDone()
        })
      }
    )

    // 模拟 HTTP 连接关闭触发的 abort：后台任务不应感知
    controller.abort()
    await finished

    expect(seen.traceId).toBe('trace-detach-1')
    expect(seen.userId).toBe('u-1')
    expect(seen.abortSignal).toBeUndefined()
  })
})
