const mockLeaseUpdateMany = jest.fn()
const mockLeaseCreate = jest.fn()
const mockLeaseDeleteMany = jest.fn()
const mockVirtualSessionUpdate = jest.fn()

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    virtual_experiment_leases: {
      updateMany: mockLeaseUpdateMany,
      create: mockLeaseCreate,
      deleteMany: mockLeaseDeleteMany
    },
    virtual_sessions: {
      update: mockVirtualSessionUpdate
    }
  }
}))
jest.mock('../../services/learning/goal-conversation.service', () => ({ __esModule: true, default: {} }))
jest.mock('../../services/learning/learning.service', () => ({ __esModule: true, default: {} }))
jest.mock('../path.coordinator', () => ({ __esModule: true, default: {} }))
jest.mock('../../services/ai-teaching/AITeachingCoordinator', () => ({ __esModule: true, default: {} }))
jest.mock('../../services/agentConfig.service', () => ({ getSimulationAgentConfig: jest.fn() }))
jest.mock('../../skills', () => ({
  executeSkill: jest.fn(),
  virtualLearnerGoalDialogueSimulatorDefinition: {},
  virtualLearnerPathEvaluatorDefinition: {},
  virtualLearnerLearnTurnSimulatorDefinition: {}
}))
jest.mock('../../skills/virtual-learner-shared', () => ({
  normalizeFrictionBudget: (value: string) => value || 'normal'
}))
jest.mock('../../skills/session-wrapup', () => ({ sessionWrapupAgent: {} }))
jest.mock('../../services/learning/goal-path-visible-summary', () => ({
  buildGoalPathVisibleSummary: jest.fn()
}))
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}))

import {
  SimulationOrchestrator,
  VirtualSessionDatabaseBusyError,
  VirtualSessionLeaseBusyError,
  VirtualSessionLeaseLostError
} from '../simulation.coordinator'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

describe('SimulationOrchestrator assisted session lease', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockLeaseUpdateMany.mockImplementation(async ({ where }: any) => ({ count: where.ownerId ? 1 : 0 }))
    mockLeaseCreate.mockResolvedValue({})
    mockLeaseDeleteMany.mockResolvedValue({ count: 1 })
    mockVirtualSessionUpdate.mockResolvedValue({})
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('serializes same-session work within one process', async () => {
    const coordinator = new SimulationOrchestrator()
    const firstCanFinish = deferred()
    const firstStarted = deferred()
    const order: string[] = []

    const first = coordinator.runLeasedExclusive('session-1', async () => {
      order.push('first-start')
      firstStarted.resolve()
      await firstCanFinish.promise
      order.push('first-end')
      return 'first'
    })
    await firstStarted.promise

    const second = coordinator.runLeasedExclusive('session-1', async () => {
      order.push('second-start')
      return 'second'
    })
    await Promise.resolve()

    expect(order).toEqual(['first-start'])
    firstCanFinish.resolve()

    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second'])
    expect(order).toEqual(['first-start', 'first-end', 'second-start'])
    expect(mockLeaseCreate).toHaveBeenCalledTimes(2)
    expect(mockLeaseDeleteMany).toHaveBeenCalledTimes(2)
  })

  it('rejects a separate coordinator instance while the DB lease is held', async () => {
    const heldLeases = new Map<string, string>()
    mockLeaseCreate.mockImplementation(async ({ data }: any) => {
      if (heldLeases.has(data.sessionId)) throw Object.assign(new Error('unique constraint'), { code: 'P2002' })
      heldLeases.set(data.sessionId, data.ownerId)
      return data
    })
    mockLeaseDeleteMany.mockImplementation(async ({ where }: any) => {
      if (heldLeases.get(where.sessionId) === where.ownerId) {
        heldLeases.delete(where.sessionId)
        return { count: 1 }
      }
      return { count: 0 }
    })

    const firstCoordinator = new SimulationOrchestrator()
    const secondCoordinator = new SimulationOrchestrator()
    const firstCanFinish = deferred()
    const firstStarted = deferred()
    const first = firstCoordinator.runLeasedExclusive('session-1', async () => {
      firstStarted.resolve()
      await firstCanFinish.promise
      return 'first'
    })
    await firstStarted.promise

    await expect(secondCoordinator.runLeasedExclusive('session-1', async () => 'second'))
      .rejects.toEqual(expect.objectContaining({
        name: 'VirtualSessionLeaseBusyError',
        code: 'VIRTUAL_SESSION_BUSY',
        statusCode: 409,
        retryable: true
      }))

    firstCanFinish.resolve()
    await expect(first).resolves.toBe('first')
    await expect(secondCoordinator.runLeasedExclusive('session-1', async () => 'after-release'))
      .resolves.toBe('after-release')

    const ownerIds = mockLeaseCreate.mock.calls.map(([input]) => input.data.ownerId)
    expect(new Set(ownerIds).size).toBe(ownerIds.length)
  })

  it('releases the owner-scoped lease when work fails', async () => {
    const coordinator = new SimulationOrchestrator()
    const failure = new Error('work failed')

    await expect(coordinator.runLeasedExclusive('session-1', async () => {
      throw failure
    })).rejects.toBe(failure)

    const ownerId = mockLeaseCreate.mock.calls[0][0].data.ownerId
    expect(mockLeaseDeleteMany).toHaveBeenCalledWith({
      where: { sessionId: 'session-1', ownerId }
    })
  })

  it('takes over an expired lease for ten minutes without creating a new row', async () => {
    mockLeaseUpdateMany.mockResolvedValue({ count: 1 })
    const coordinator = new SimulationOrchestrator()
    const before = Date.now()

    await expect(coordinator.runLeasedExclusive('session-1', async () => 'ok')).resolves.toBe('ok')

    expect(mockLeaseCreate).not.toHaveBeenCalled()
    const update = mockLeaseUpdateMany.mock.calls[0][0]
    expect(update.where.sessionId).toBe('session-1')
    expect(update.where.expiresAt.lt).toBeInstanceOf(Date)
    expect(update.data.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 10 * 60 * 1000)
    expect(mockLeaseDeleteMany).toHaveBeenCalledWith({
      where: { sessionId: 'session-1', ownerId: update.data.ownerId }
    })
  })

  it('periodically renews the owner-scoped lease for another ten minutes', async () => {
    jest.useFakeTimers({ now: new Date('2026-07-19T00:00:00.000Z') })
    mockLeaseUpdateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })
    const coordinator = new SimulationOrchestrator()
    const workStarted = deferred()
    const workCanFinish = deferred()

    const running = coordinator.runLeasedExclusive('session-1', async () => {
      workStarted.resolve()
      await workCanFinish.promise
      return 'ok'
    })
    await workStarted.promise

    await jest.advanceTimersByTimeAsync(2 * 60 * 1000)

    expect(mockLeaseUpdateMany).toHaveBeenCalledTimes(2)
    const acquiredOwnerId = mockLeaseCreate.mock.calls[0][0].data.ownerId
    const renewal = mockLeaseUpdateMany.mock.calls[1][0]
    expect(renewal.where).toEqual({
      sessionId: 'session-1',
      ownerId: acquiredOwnerId,
      expiresAt: { gt: new Date('2026-07-19T00:02:00.000Z') }
    })
    expect(renewal.data.expiresAt).toEqual(new Date('2026-07-19T00:12:00.000Z'))

    workCanFinish.resolve()
    await expect(running).resolves.toBe('ok')
  })

  it('rejects on lease loss but retains the lease and local queue until protected work settles', async () => {
    jest.useFakeTimers({ now: new Date('2026-07-19T00:00:00.000Z') })
    mockLeaseUpdateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 })
    const coordinator = new SimulationOrchestrator()
    const workStarted = deferred()
    const workCanFinish = deferred()
    const order: string[] = []
    mockLeaseDeleteMany.mockImplementation(async () => {
      order.push('lease-released')
      return { count: 1 }
    })

    const first = coordinator.runLeasedExclusive('session-1', async () => {
      order.push('first-start')
      workStarted.resolve()
      await workCanFinish.promise
      order.push('first-settled')
      return 'work-success-after-lease-loss'
    })
    await workStarted.promise
    const rejection = expect(first).rejects.toEqual(expect.objectContaining({
      name: 'VirtualSessionLeaseLostError',
      code: 'VIRTUAL_SESSION_LEASE_LOST',
      statusCode: 409,
      retryable: true
    }))

    const second = coordinator.runLeasedExclusive('session-1', async () => {
      order.push('second-start')
      return 'second'
    })

    await jest.advanceTimersByTimeAsync(2 * 60 * 1000)

    await rejection
    expect(mockLeaseDeleteMany).not.toHaveBeenCalled()
    expect(mockLeaseCreate).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['first-start'])

    workCanFinish.resolve()
    await expect(second).resolves.toBe('second')

    expect(order).toEqual([
      'first-start',
      'first-settled',
      'lease-released',
      'second-start',
      'lease-released'
    ])
    expect(mockLeaseCreate).toHaveBeenCalledTimes(2)
  })

  it('fences a post-loss write without leaking context across concurrent sessions', async () => {
    jest.useFakeTimers({ now: new Date('2026-07-19T00:00:00.000Z') })
    mockLeaseUpdateMany.mockImplementation(async ({ where }: any) => {
      if (!where.ownerId) return { count: 0 }
      return { count: where.sessionId === 'session-lost' ? 0 : 1 }
    })
    const coordinator = new SimulationOrchestrator()
    const lostStarted = deferred()
    const healthyStarted = deferred()
    const releaseLost = deferred()
    const releaseHealthy = deferred()
    const lostBoundarySettled = deferred()
    let lostBoundaryError: unknown

    const lost = coordinator.runLeasedExclusive('session-lost', async () => {
      lostStarted.resolve()
      await releaseLost.promise
      await Promise.resolve()
      try {
        await (coordinator as any).updateSessionStatus('session-lost', 'running')
      } catch (error) {
        lostBoundaryError = error
        throw error
      } finally {
        lostBoundarySettled.resolve()
      }
    })
    const healthy = coordinator.runLeasedExclusive('session-healthy', async () => {
      healthyStarted.resolve()
      await releaseHealthy.promise
      await Promise.resolve()
      await (coordinator as any).updateSessionStatus('session-healthy', 'running')
      return 'healthy'
    })
    await Promise.all([lostStarted.promise, healthyStarted.promise])

    const lostRejection = expect(lost).rejects.toBeInstanceOf(VirtualSessionLeaseLostError)
    await jest.advanceTimersByTimeAsync(2 * 60 * 1000)
    await lostRejection

    releaseLost.resolve()
    releaseHealthy.resolve()
    await lostBoundarySettled.promise
    await expect(healthy).resolves.toBe('healthy')

    expect(lostBoundaryError).toBeInstanceOf(VirtualSessionLeaseLostError)
    expect(mockVirtualSessionUpdate).toHaveBeenCalledTimes(1)
    expect(mockVirtualSessionUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'session-healthy' }
    }))
  })

  it('requires an unexpired owner row when renewing and never resurrects an expired owner', async () => {
    const coordinator = new SimulationOrchestrator() as any
    mockLeaseUpdateMany.mockResolvedValueOnce({ count: 0 })

    await expect(coordinator.renewSessionLease(
      'session-expired',
      'old-owner',
      Date.now() + 60_000
    )).rejects.toBeInstanceOf(VirtualSessionLeaseLostError)

    expect(mockLeaseUpdateMany).toHaveBeenCalledWith({
      where: {
        sessionId: 'session-expired',
        ownerId: 'old-owner',
        expiresAt: { gt: expect.any(Date) }
      },
      data: { expiresAt: expect.any(Date) }
    })
  })

  it('maps only P2002 create conflicts to retryable busy and propagates unrelated create errors', async () => {
    const coordinator = new SimulationOrchestrator()
    mockLeaseCreate.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }))

    await expect(coordinator.runLeasedExclusive('session-p2002', async () => 'no'))
      .rejects.toBeInstanceOf(VirtualSessionLeaseBusyError)

    const unrelated = Object.assign(new Error('foreign key failed'), { code: 'P2003' })
    mockLeaseCreate.mockRejectedValueOnce(unrelated)
    await expect(coordinator.runLeasedExclusive('session-p2003', async () => 'no')).rejects.toBe(unrelated)
  })

  it('retries P1008 renewal before the known deadline and continues after ownership is confirmed', async () => {
    const coordinator = new SimulationOrchestrator() as any
    mockLeaseUpdateMany
      .mockRejectedValueOnce(Object.assign(new Error('timed out'), { code: 'P1008' }))
      .mockResolvedValueOnce({ count: 1 })

    await expect(coordinator.renewSessionLease(
      'session-retry',
      'owner-retry',
      Date.now() + 60_000
    )).resolves.toBeInstanceOf(Date)
    expect(mockLeaseUpdateMany).toHaveBeenCalledTimes(2)
  })

  it('returns stable DB_BUSY when renewal ownership cannot be confirmed within the bounded retries', async () => {
    const coordinator = new SimulationOrchestrator() as any
    mockLeaseUpdateMany.mockRejectedValue(Object.assign(new Error('database is locked'), { code: 'P1008' }))

    await expect(coordinator.renewSessionLease(
      'session-db-busy',
      'owner-db-busy',
      Date.now() + 60_000
    )).rejects.toEqual(expect.objectContaining({ code: 'DB_BUSY', statusCode: 503, retryable: true }))
  })

  it('checks the database at the next protected boundary and rejects an old owner after takeover', async () => {
    const lease = { ownerId: '', expiresAt: 0 }
    mockLeaseUpdateMany.mockImplementation(async ({ where, data }: any) => {
      const now = where.expiresAt?.gt?.getTime?.() || Date.now()
      if (!where.ownerId) return { count: 0 }
      if (lease.ownerId !== where.ownerId || lease.expiresAt <= now) return { count: 0 }
      lease.expiresAt = data.expiresAt.getTime()
      return { count: 1 }
    })
    mockLeaseCreate.mockImplementation(async ({ data }: any) => {
      lease.ownerId = data.ownerId
      lease.expiresAt = data.expiresAt.getTime()
      return data
    })
    mockLeaseDeleteMany.mockImplementation(async ({ where }: any) => {
      if (lease.ownerId !== where.ownerId) return { count: 0 }
      lease.ownerId = ''
      lease.expiresAt = 0
      return { count: 1 }
    })
    const coordinator = new SimulationOrchestrator()
    const workStarted = deferred()
    const continueWork = deferred()

    const running = coordinator.runLeasedExclusive('session-takeover', async () => {
      workStarted.resolve()
      await continueWork.promise
      await (coordinator as any).updateSessionStatus('session-takeover', 'running')
      return 'stale-success'
    })
    await workStarted.promise
    lease.ownerId = 'new-owner'
    lease.expiresAt = Date.now() + 60_000
    continueWork.resolve()

    await expect(running).rejects.toBeInstanceOf(VirtualSessionLeaseLostError)
    expect(mockVirtualSessionUpdate).not.toHaveBeenCalled()
  })

  it('does not let release DB errors cover work failures but exposes DB_BUSY after successful work', async () => {
    const coordinator = new SimulationOrchestrator()
    const workError = new Error('business failed')
    mockLeaseDeleteMany.mockRejectedValue(Object.assign(new Error('database is locked'), { code: 'P1008' }))

    await expect(coordinator.runLeasedExclusive('session-work-error', async () => {
      throw workError
    })).rejects.toBe(workError)

    await expect(coordinator.runLeasedExclusive('session-release-error', async () => 'ok'))
      .rejects.toBeInstanceOf(VirtualSessionDatabaseBusyError)
  })

  it('exposes a stable typed busy error', () => {
    expect(new VirtualSessionLeaseBusyError()).toEqual(expect.objectContaining({
      code: 'VIRTUAL_SESSION_BUSY',
      statusCode: 409,
      retryable: true
    }))
    expect(new VirtualSessionLeaseLostError()).toEqual(expect.objectContaining({
      code: 'VIRTUAL_SESSION_LEASE_LOST',
      statusCode: 409,
      retryable: true
    }))
    expect(new VirtualSessionDatabaseBusyError()).toEqual(expect.objectContaining({
      code: 'DB_BUSY',
      statusCode: 503,
      retryable: true
    }))
  })
})
