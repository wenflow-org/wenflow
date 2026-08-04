import type { EventHandler, LearningEventType } from '../../gateway/event-bus'
import { AgentCollaborationService } from '../agent-collaboration.service'

class FakeEventBus {
  handlers = new Map<LearningEventType, EventHandler>()
  on = jest.fn((type: LearningEventType, handler: EventHandler) => this.handlers.set(type, handler))
  off = jest.fn((type: LearningEventType, handler: EventHandler) => {
    if (this.handlers.get(type) === handler) this.handlers.delete(type)
  })
}

describe('AgentCollaborationService lifecycle', () => {
  it('start 幂等，stop 取消订阅并等待 in-flight handler', async () => {
    const eventBus = new FakeEventBus()
    const service = new AgentCollaborationService({}, eventBus as any)
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    ;(service as any).handleProfileUpdated = jest.fn(() => pending)

    service.start()
    service.start()
    expect(eventBus.on).toHaveBeenCalledTimes(4)

    const handler = eventBus.handlers.get('profile:updated')!
    const handling = handler({
      type: 'profile:updated',
      source: 'test',
      userId: 'user-1',
      data: {}
    }) as Promise<void>
    const stopping = service.stop()
    let stopped = false
    void stopping.then(() => { stopped = true })
    await Promise.resolve()
    expect(stopped).toBe(false)
    expect(eventBus.off).toHaveBeenCalledTimes(4)

    release()
    await Promise.all([handling, stopping])
    expect(stopped).toBe(true)
    expect(eventBus.handlers.size).toBe(0)
  })
})
