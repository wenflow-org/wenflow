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
const mockLogRowsFindMany = jest.fn()
const mockLogCreateMany = jest.fn()
const mockLogDeleteMany = jest.fn()

const mockDatabase: any = {
  virtual_sessions: { findMany: mockFindMany, update: mockUpdate },
  virtual_experiment_leases: { findFirst: mockFindFirst },
  admin_audit_logs: { create: mockAuditCreate },
  // 日志子表：默认侧表已有行（跳过播种），裁剪扫描返回空
  virtual_session_logs: {
    findMany: mockLogRowsFindMany,
    createMany: mockLogCreateMany,
    deleteMany: mockLogDeleteMany
  }
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
    mockLogRowsFindMany.mockImplementation(async (args: { select?: { bytes?: boolean } }) =>
      args?.select && 'bytes' in args.select ? [] : [{ id: 1 }])
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
    // 回收轨迹改走日志子表（appendSessionLogs），会话行不再写 logs 列
    expect(updateCall[0].data.logs).toBeUndefined()
    expect(mockLogCreateMany).toHaveBeenCalledTimes(1)
    const logRows = mockLogCreateMany.mock.calls[0][0].data
    expect(logRows[0].sessionId).toBe('vs-stale')
    expect(JSON.parse(logRows[0].payload).phase).toBe('error')
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

  it('以连续 error 收尾（≥3 条）的僵死会话收敛为 abandoned（报告 #12：不再长期滞留 running）', async () => {
    const errorTailLogs = JSON.stringify([
      { timestamp: '2026-07-30T09:50:00.000Z', phase: 'error', details: { error: 'PROVIDER_RETRY_BUDGET_EXHAUSTED' } },
      { timestamp: '2026-07-30T09:52:00.000Z', phase: 'error', details: { error: 'PROVIDER_RETRY_BUDGET_EXHAUSTED' } },
      { timestamp: '2026-07-30T09:55:00.000Z', phase: 'error', details: { error: 'API request canceled' } }
    ])
    mockFindMany.mockResolvedValue([staleSession({ id: 'vs-error-tail', logs: errorTailLogs })])
    mockFindFirst.mockResolvedValue(null)
    const service = new VirtualSessionReclaimService({ database: mockDatabase, thresholdMs: 24 * 60 * 60 * 1000 })

    const result = await service.runReclaimOnce({ now: NOW })

    expect(result.reclaimed).toBe(1)
    const updateCall = mockUpdate.mock.calls[0]
    expect(updateCall[0].data).toEqual(expect.objectContaining({ status: 'abandoned' }))
    const stageResults = JSON.parse(updateCall[0].data.stageResults)
    expect(stageResults.staleReclaim).toEqual(expect.objectContaining({
      reason: 'stale-session-timeout',
      previousStatus: 'running'
    }))
    // 回收即终态：此后推进入口由 terminal-guard 拒绝（error 尾不再继续增长）
    expect(mockLogCreateMany).toHaveBeenCalledTimes(1)
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

  // ---- 2026-10-02 三分类语义：申报暂停（hold）与确证孤儿（进程代际 floor）----

  it('显式 hold 的会话跳过回收（外部驱动的「故意停留」申报）', async () => {
    mockFindMany.mockResolvedValue([
      staleSession({ id: 'vs-held', stageResults: JSON.stringify({ hold: { by: 'batch-sprint', reason: 'path-only' } }) })
    ])
    mockFindFirst.mockResolvedValue(null)
    const service = new VirtualSessionReclaimService({ database: mockDatabase, thresholdMs: 24 * 60 * 60 * 1000 })

    const result = await service.runReclaimOnce({ now: NOW })

    expect(result).toMatchObject({ scanned: 1, reclaimed: 0, skippedHeld: 1 })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('带 until 的 hold 到期后不再豁免（自动失效，防遗忘的永久 hold）', async () => {
    const expired = new Date(NOW.getTime() - 60 * 1000).toISOString()
    mockFindMany.mockResolvedValue([
      staleSession({ id: 'vs-held-expired', stageResults: JSON.stringify({ hold: { by: 'x', until: expired } }) })
    ])
    mockFindFirst.mockResolvedValue(null)
    mockUpdate.mockResolvedValue({})
    mockAuditCreate.mockResolvedValue({})
    const service = new VirtualSessionReclaimService({ database: mockDatabase, thresholdMs: 24 * 60 * 60 * 1000 })

    const result = await service.runReclaimOnce({ now: NOW })

    expect(result).toMatchObject({ scanned: 1, reclaimed: 1, skippedHeld: 0 })
    expect(mockUpdate).toHaveBeenCalledTimes(1)
  })

  it('快档确证孤儿：写入早于所有存活代际的最早启动时间才回收', async () => {
    // NOW=2026-08-15T10:00；floor=09:00（所有存活进程最早 09:00 启动）
    const floor = new Date('2026-08-15T09:00:00.000Z')
    mockFindMany.mockResolvedValue([
      // 写于 08:30（floor 之前）→ 上一代孤儿 → 回收
      staleSession({ id: 'vs-pre-floor', updatedAt: new Date('2026-08-15T08:30:00.000Z') }),
      // 写于 09:30（floor 之后）→ 存活代际可能是作者 → 保护
      staleSession({ id: 'vs-post-floor', updatedAt: new Date('2026-08-15T09:30:00.000Z') })
    ])
    mockFindFirst.mockResolvedValue(null)
    mockUpdate.mockResolvedValue({})
    mockAuditCreate.mockResolvedValue({})
    const service = new VirtualSessionReclaimService({
      database: mockDatabase,
      thresholdMs: 24 * 60 * 60 * 1000,
      fastThresholdMs: 30 * 60 * 1000,
      resolveActiveBootFloor: async () => floor
    })

    const result = await service.runFastReclaimOnce({ now: NOW })

    expect(result).toMatchObject({ scanned: 2, reclaimed: 1, skippedLiveGeneration: 1 })
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    expect(mockUpdate.mock.calls[0][0].where).toEqual({ id: 'vs-pre-floor' })
  })

  it('快档无存活代际登记（floor=null）时本轮全跳过：宁可漏收不可误收', async () => {
    mockFindMany.mockResolvedValue([staleSession()])
    const service = new VirtualSessionReclaimService({
      database: mockDatabase,
      thresholdMs: 24 * 60 * 60 * 1000,
      fastThresholdMs: 30 * 60 * 1000,
      resolveActiveBootFloor: async () => null
    })

    const result = await service.runFastReclaimOnce({ now: NOW })

    expect(result).toMatchObject({ scanned: 0, reclaimed: 0 })
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockFindMany).not.toHaveBeenCalled()
  })
})
