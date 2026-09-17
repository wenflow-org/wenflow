import {
  VirtualSessionReclaimService,
  resolveStaleSessionThresholdMs,
  resolveFastStaleThresholdMs,
  resolveReclaimIntervalMs,
  DEFAULT_STALE_SESSION_HOURS,
  DEFAULT_FAST_STALE_MINUTES
} from '../session-reclaim.service'
import { logger } from '../../utils/logger'

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}))

const mockFindMany = jest.fn()
const mockFindFirst = jest.fn()
const mockUpdate = jest.fn()
const mockAuditCreate = jest.fn()

const mockDatabase: any = {
  virtual_sessions: { findMany: mockFindMany, update: mockUpdate },
  virtual_experiment_leases: { findFirst: mockFindFirst },
  admin_audit_logs: { create: mockAuditCreate }
}

function staleSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'vs-stale',
    status: 'running',
    currentStage: 'teaching',
    updatedAt: new Date('2026-07-30T10:00:00.000Z'),
    stageResults: JSON.stringify({ blackbox: { publicTrace: [] } }),
    logs: '[]',
    ...overrides
  }
}

const NOW = new Date('2026-08-15T10:00:00.000Z')

describe('VirtualSessionReclaimService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('running 超 24h 且无活跃租约的会话标记 failed 并写审计（不删除数据）', async () => {
    mockFindMany.mockResolvedValue([staleSession()])
    mockFindFirst.mockResolvedValue(null)
    mockUpdate.mockResolvedValue({})
    mockAuditCreate.mockResolvedValue({})
    const service = new VirtualSessionReclaimService({ database: mockDatabase, thresholdMs: 24 * 60 * 60 * 1000 })

    const result = await service.runReclaimOnce({ now: NOW })

    expect(result).toMatchObject({ dryRun: false, scanned: 1, reclaimed: 1, skippedActiveLease: 0 })
    expect(result.sessions[0].staleMs).toBeGreaterThan(0)
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    const updateCall = mockUpdate.mock.calls[0]
    expect(updateCall[0].where).toEqual({ id: 'vs-stale' })
    expect(updateCall[0].data).toEqual(expect.objectContaining({
      status: 'abandoned',
      completedAt: NOW,
      currentStage: 'teaching'
    }))
    const stageResults = JSON.parse(updateCall[0].data.stageResults)
    expect(stageResults.staleReclaim).toEqual(expect.objectContaining({
      reason: 'stale-session-timeout',
      previousStatus: 'running',
      staleMs: expect.any(Number)
    }))
    expect(JSON.parse(updateCall[0].data.logs)).toHaveLength(1)
    expect(mockAuditCreate).toHaveBeenCalledTimes(1)
    const auditCall = mockAuditCreate.mock.calls[0][0].data
    expect(auditCall).toEqual(expect.objectContaining({
      action: 'virtual-session-stale-reclaim',
      targetType: 'virtual-session',
      targetId: 'vs-stale',
      success: true,
      statusCode: 200
    }))
    expect(JSON.parse(auditCall.beforeJson).status).toBe('running')
    expect(JSON.parse(auditCall.afterJson).status).toBe('abandoned')
    expect(logger.warn).toHaveBeenCalled()
  })

  it('created 超阈值会话同样回收', async () => {
    mockFindMany.mockResolvedValue([staleSession({ id: 'vs-created', status: 'created', currentStage: 'goal' })])
    mockFindFirst.mockResolvedValue(null)
    const service = new VirtualSessionReclaimService({ database: mockDatabase, thresholdMs: 24 * 60 * 60 * 1000 })

    const result = await service.runReclaimOnce({ now: NOW })

    expect(result.reclaimed).toBe(1)
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'vs-created' },
        data: expect.objectContaining({ status: 'abandoned' })
      })
    )
  })

  it('有活跃租约的会话跳过（不误回收正在执行的会话）', async () => {
    mockFindMany.mockResolvedValue([staleSession()])
    mockFindFirst.mockResolvedValue({ id: 'lease-1' })
    const service = new VirtualSessionReclaimService({ database: mockDatabase, thresholdMs: 24 * 60 * 60 * 1000 })

    const result = await service.runReclaimOnce({ now: NOW })

    expect(result).toMatchObject({ scanned: 1, reclaimed: 0, skippedActiveLease: 1 })
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockAuditCreate).not.toHaveBeenCalled()
  })

  it('未超阈值的会话不回收：查询按 updatedAt < now-24h 过滤，服务只处理返回行', async () => {
    mockFindMany.mockResolvedValue([])
    const service = new VirtualSessionReclaimService({ database: mockDatabase, thresholdMs: 24 * 60 * 60 * 1000 })

    const result = await service.runReclaimOnce({ now: NOW })

    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: { in: ['running', 'created'] },
        updatedAt: { lt: expect.any(Date) }
      })
    }))
    expect(result).toMatchObject({ scanned: 0, reclaimed: 0 })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('dryRun 只报告不落地（干跑确认清单）', async () => {
    mockFindMany.mockResolvedValue([staleSession()])
    mockFindFirst.mockResolvedValue(null)
    const service = new VirtualSessionReclaimService({ database: mockDatabase, thresholdMs: 24 * 60 * 60 * 1000 })

    const result = await service.runReclaimOnce({ dryRun: true, now: NOW })

    expect(result).toMatchObject({ dryRun: true, scanned: 1, reclaimed: 1, sessions: [{ id: 'vs-stale' }] })
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockAuditCreate).not.toHaveBeenCalled()
  })

  it('阈值解析：默认 24h，env 非法回退默认', () => {
    expect(resolveStaleSessionThresholdMs(undefined)).toBe(DEFAULT_STALE_SESSION_HOURS * 60 * 60 * 1000)
    expect(resolveStaleSessionThresholdMs('48')).toBe(48 * 60 * 60 * 1000)
    expect(resolveStaleSessionThresholdMs('abc')).toBe(DEFAULT_STALE_SESSION_HOURS * 60 * 60 * 1000)
    expect(resolveReclaimIntervalMs('30')).toBe(30 * 60 * 1000)
    expect(resolveReclaimIntervalMs('0')).toBe(15 * 60 * 1000)
  })

  it('短周期收敛：阈值取 fastThresholdMs、reason=stale-session-short（审计可区分）', async () => {
    mockFindMany.mockResolvedValue([staleSession()])
    mockFindFirst.mockResolvedValue(null)
    mockUpdate.mockResolvedValue({})
    mockAuditCreate.mockResolvedValue({})
    const fastMs = 30 * 60 * 1000
    const service = new VirtualSessionReclaimService({
      database: mockDatabase,
      thresholdMs: 24 * 60 * 60 * 1000,
      fastThresholdMs: fastMs
    })

    const result = await service.runFastReclaimOnce({ now: NOW })

    expect(result.thresholdMs).toBe(fastMs)
    // 查询窗口按短阈值（NOW - 30min），而不是 24h
    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ updatedAt: { lt: new Date(NOW.getTime() - fastMs) } })
    }))
    const stageResults = JSON.parse(mockUpdate.mock.calls[0][0].data.stageResults)
    expect(stageResults.staleReclaim).toEqual(expect.objectContaining({
      reason: 'stale-session-short',
      thresholdMs: fastMs
    }))
    const auditCall = mockAuditCreate.mock.calls[0][0].data
    expect(JSON.parse(auditCall.afterJson)).toEqual(expect.objectContaining({
      reason: 'stale-session-short',
      thresholdMs: fastMs
    }))
  })

  it('在途自动化（autopilot running）的会话跳过：短周期收敛不得误杀正在跑的会话', async () => {
    mockFindMany.mockResolvedValue([
      staleSession({ stageResults: JSON.stringify({ autopilot: { status: 'running' } }) })
    ])
    mockFindFirst.mockResolvedValue(null)
    const service = new VirtualSessionReclaimService({
      database: mockDatabase,
      thresholdMs: 24 * 60 * 60 * 1000,
      fastThresholdMs: 30 * 60 * 1000
    })

    const result = await service.runFastReclaimOnce({ now: NOW })

    expect(result).toMatchObject({ scanned: 1, reclaimed: 0, skippedActiveAutopilot: 1 })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('fast 阈值解析：默认 30 分钟、env 可覆盖、非法回退默认', () => {
    expect(resolveFastStaleThresholdMs(undefined)).toBe(DEFAULT_FAST_STALE_MINUTES * 60 * 1000)
    expect(resolveFastStaleThresholdMs('10')).toBe(10 * 60 * 1000)
    expect(resolveFastStaleThresholdMs('abc')).toBe(DEFAULT_FAST_STALE_MINUTES * 60 * 1000)
  })

  it('回收中途进入 draining 时停止后续处理', async () => {
    mockFindMany.mockResolvedValue([staleSession({ id: 'vs-1' }), staleSession({ id: 'vs-2' })])
    mockFindFirst.mockResolvedValue(null)
    let drained = false
    const service = new VirtualSessionReclaimService({
      database: mockDatabase,
      thresholdMs: 24 * 60 * 60 * 1000,
      lifecycle: { isDraining: () => drained }
    })

    const result = await service.runReclaimOnce({ now: NOW })
    expect(result.reclaimed).toBe(2)

    mockUpdate.mockClear()
    drained = true
    const result2 = await service.runReclaimOnce({ now: NOW })
    expect(result2.reclaimed).toBe(0)
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})
