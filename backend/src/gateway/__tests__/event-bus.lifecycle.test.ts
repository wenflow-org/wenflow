import { EventBus, LearningEvent } from '../event-bus'

function event(type: LearningEvent['type'] = 'learning:started'): LearningEvent {
  return { type, source: 'test', data: {} }
}

describe('EventBus lifecycle', () => {
  it('异步 handler 失败被边界捕获，不形成 emit rejection', async () => {
    const bus = new EventBus({} as any, { persistEvents: false })
    bus.on('learning:started', async () => {
      throw new Error('handler failed')
    })

    await expect(bus.emit(event())).resolves.toBeUndefined()
    await bus.close()
  })

  it('close 等待正在执行和级联产生的 handler', async () => {
    const bus = new EventBus({} as any, { persistEvents: false })
    let releaseFirst!: () => void
    let releaseSecond!: () => void
    const firstPending = new Promise<void>(resolve => { releaseFirst = resolve })
    const secondPending = new Promise<void>(resolve => { releaseSecond = resolve })
    const second = jest.fn(() => secondPending)
    bus.on('learning:completed', second)
    bus.on('learning:started', async () => {
      await firstPending
      await bus.emit(event('learning:completed'))
    })

    await bus.emit(event())
    const closing = bus.close()
    let closed = false
    void closing.then(() => { closed = true })
    await Promise.resolve()
    expect(closed).toBe(false)

    releaseFirst()
    await Promise.resolve()
    await Promise.resolve()
    expect(second).toHaveBeenCalledTimes(1)
    expect(closed).toBe(false)

    releaseSecond()
    await closing
    expect(closed).toBe(true)
  })

  it('off 使用原始 handler 引用取消包装订阅，once 只执行一次', async () => {
    const bus = new EventBus({} as any, { persistEvents: false })
    const regular = jest.fn()
    const once = jest.fn()
    bus.on('learning:started', regular)
    bus.once('learning:started', once)
    bus.off('learning:started', regular)

    await bus.emit(event())
    await bus.emit(event())
    await bus.close()
    expect(regular).not.toHaveBeenCalled()
    expect(once).toHaveBeenCalledTimes(1)
  })

  it('关闭后拒绝新事件和新订阅', async () => {
    const bus = new EventBus({} as any, { persistEvents: false })
    await bus.close()
    await expect(bus.emit(event())).rejects.toThrow('EventBus 已关闭')
    expect(() => bus.on('learning:started', jest.fn())).toThrow('EventBus 正在关闭')
  })
})
