import type { Server } from 'http'
import {
  ApplicationLifecycle,
  resolveShutdownDeadlineMs
} from '../application-lifecycle.service'

function server(options: { close?: (callback: (error?: Error) => void) => void } = {}) {
  return {
    close: jest.fn(options.close || (callback => callback())),
    closeIdleConnections: jest.fn(),
    closeAllConnections: jest.fn()
  } as unknown as Server
}

describe('ApplicationLifecycle', () => {
  it('正常按入口、后台、Outbox、Gateway、数据库顺序关闭', async () => {
    const order: string[] = []
    const httpServer = server({ close: callback => { order.push('http'); callback() } })
    const lifecycle = new ApplicationLifecycle()
    lifecycle.markReady()

    const report = await lifecycle.shutdown('SIGTERM', {
      httpServer,
      stopSchedulers: () => { order.push('schedulers') },
      teaching: { stop: async () => { order.push('teaching') } },
      backgroundTaskTracker: { drain: async () => { order.push('tracker') } },
      collaboration: { stop: async () => { order.push('collaboration') } },
      backgroundTasks: [Promise.resolve().then(() => order.push('background'))],
      outbox: { stop: async () => { order.push('outbox') } },
      gateway: { close: async () => { order.push('gateway') } },
      databases: [{ $disconnect: async () => { order.push('database') } }]
    }, 1000)

    expect(report).toEqual({ reason: 'SIGTERM', timedOut: false, errors: [] })
    expect(order[0]).toBe('schedulers')
    expect(order.indexOf('http')).toBeLessThan(order.indexOf('outbox'))
    expect(order.indexOf('outbox')).toBeLessThan(order.indexOf('gateway'))
    expect(order.indexOf('gateway')).toBeLessThan(order.indexOf('database'))
    expect(lifecycle.getState()).toBe('stopped')
  })

  it('shutdown 幂等且调用后立即进入 draining', async () => {
    const lifecycle = new ApplicationLifecycle()
    const resources = {
      httpServer: server(),
      stopSchedulers: jest.fn(),
      databases: []
    }
    const first = lifecycle.shutdown('SIGTERM', resources)
    const second = lifecycle.shutdown('SIGINT', resources)

    expect(lifecycle.isDraining()).toBe(true)
    expect(second).toBe(first)
    await first
    expect(resources.stopSchedulers).toHaveBeenCalledTimes(1)
  })

  it('HTTP drain 超时时强制断开连接且不继续断开数据库', async () => {
    const httpServer = server({ close: () => undefined })
    const disconnect = jest.fn()
    const lifecycle = new ApplicationLifecycle()
    const report = await lifecycle.shutdown('SIGTERM', {
      httpServer,
      stopSchedulers: jest.fn(),
      databases: [{ $disconnect: disconnect }]
    }, 10)

    expect(report.timedOut).toBe(true)
    expect(httpServer.closeAllConnections).toHaveBeenCalledTimes(1)
    expect(disconnect).not.toHaveBeenCalled()
  })

  it('HTTP 仍在 drain 时已经关闭后台任务接收', async () => {
    let closeHttp!: () => void
    const httpServer = server({ close: callback => { closeHttp = callback } })
    const trackerDrain = jest.fn().mockResolvedValue(undefined)
    const lifecycle = new ApplicationLifecycle()
    const shuttingDown = lifecycle.shutdown('SIGTERM', {
      httpServer,
      stopSchedulers: jest.fn(),
      backgroundTaskTracker: { drain: trackerDrain },
      databases: []
    }, 1000)

    await Promise.resolve()
    expect(trackerDrain).toHaveBeenCalledTimes(1)
    closeHttp()
    await shuttingDown
  })

  it('收集清理错误并继续执行后续阶段', async () => {
    const disconnect = jest.fn().mockResolvedValue(undefined)
    const lifecycle = new ApplicationLifecycle()
    const report = await lifecycle.shutdown('SIGTERM', {
      httpServer: server(),
      stopSchedulers: () => { throw new Error('scheduler failed') },
      gateway: { close: async () => { throw new Error('gateway failed') } },
      databases: [{ $disconnect: disconnect }]
    }, 1000)

    expect(report.errors).toEqual(expect.arrayContaining([
      { stage: 'schedulers', message: 'scheduler failed' },
      { stage: 'gateway', message: 'gateway failed' }
    ]))
    expect(disconnect).toHaveBeenCalledTimes(1)
  })

  it('校验 shutdown deadline 配置', () => {
    expect(resolveShutdownDeadlineMs(undefined)).toBe(25000)
    expect(resolveShutdownDeadlineMs('30000')).toBe(30000)
    expect(() => resolveShutdownDeadlineMs('999')).toThrow('SHUTDOWN_DEADLINE_MS')
    expect(() => resolveShutdownDeadlineMs('invalid')).toThrow('SHUTDOWN_DEADLINE_MS')
  })
})
