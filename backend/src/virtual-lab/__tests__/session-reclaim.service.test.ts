import {
  VirtualSessionReclaimService,
  resolveStaleSessionThresholdMs,
  resolveReclaimIntervalMs,
  DEFAULT_STALE_SESSION_HOURS
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
      status: 'failed',
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
    expect(JSON.parse(auditCall.afterJson).status).toBe('failed')
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
        data: expect.objectContaining({ status: 'failed' })
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
