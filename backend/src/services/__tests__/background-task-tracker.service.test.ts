import {
  BackgroundTaskRejectedError,
  BackgroundTaskTracker
} from '../background-task-tracker.service'

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
