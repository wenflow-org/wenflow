import {
  AITeachingOrchestrator,
  aiTeachingOrchestrator
} from '../AITeachingCoordinator'

describe('AITeachingOrchestrator lifecycle', () => {
  beforeEach(() => jest.useFakeTimers())

  afterEach(async () => {
    jest.useRealTimers()
    await aiTeachingOrchestrator.stop()
  })

  it('stop 清理 idle timer 并等待正在执行的扫描', async () => {
    const orchestrator = new AITeachingOrchestrator()
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const scan = jest.fn(() => pending)
    ;(orchestrator as any).checkIdleSessions = scan

    jest.advanceTimersByTime(60_000)
    await Promise.resolve()
    expect(scan).toHaveBeenCalledTimes(1)

    const stopping = orchestrator.stop()
    let stopped = false
    void stopping.then(() => { stopped = true })
    await Promise.resolve()
    expect(stopped).toBe(false)

    release()
    await stopping
    jest.advanceTimersByTime(120_000)
    await Promise.resolve()
    expect(scan).toHaveBeenCalledTimes(1)
  })
})
