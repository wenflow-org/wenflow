const mockAgentFindMany = jest.fn()
const mockAgentDeleteMany = jest.fn()
const mockLlmFindMany = jest.fn()
const mockLlmDeleteMany = jest.fn()
const mockPromptFindMany = jest.fn()
const mockPromptDeleteMany = jest.fn()
const mockQueryRawUnsafe = jest.fn()
const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
const mockRunBackgroundTask = jest.fn()

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    agent_call_logs: { findMany: mockAgentFindMany, deleteMany: mockAgentDeleteMany },
    llm_execution_attempts: { findMany: mockLlmFindMany, deleteMany: mockLlmDeleteMany },
    prompt_call_logs: { findMany: mockPromptFindMany, deleteMany: mockPromptDeleteMany },
    $queryRawUnsafe: mockQueryRawUnsafe
  }
}))

jest.mock('../../utils/logger', () => ({
  logger: mockLogger
}))

jest.mock('../background-task-tracker.service', () => ({
  runBackgroundTask: mockRunBackgroundTask
}))

import {
  DEFAULT_LOG_RETENTION_DAYS,
  DEFAULT_LOG_RETENTION_INTERVAL_HOURS,
  LOG_RETENTION_BATCH_SIZE,
  LOG_RETENTION_CUTOFF_BUFFER_MS,
  LogRetentionService,
  isLogRetentionDryRun,
  resolveLogRetentionDays,
  resolveLogRetentionIntervalMs
} from '../log-retention.service'

const MILLIS_PER_DAY = 24 * 60 * 60 * 1000
const FIXED_NOW = new Date('2026-08-11T12:00:00.000Z')

function batchOfIds(prefix: string, count: number): Array<{ id: string }> {
  return Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${index}` }))
}

function expectedCutoff(now: Date, retentionDays: number): Date {
  return new Date(now.getTime() - retentionDays * MILLIS_PER_DAY - LOG_RETENTION_CUTOFF_BUFFER_MS)
}

describe('log-retention 配置解析', () => {
  it('默认值：90 天、6 小时、非 dry-run', () => {
    expect(resolveLogRetentionDays(undefined)).toBe(90)
    expect(resolveLogRetentionDays('')).toBe(90)
    expect(resolveLogRetentionIntervalMs(undefined)).toBe(DEFAULT_LOG_RETENTION_INTERVAL_HOURS * 60 * 60 * 1000)
    expect(isLogRetentionDryRun(undefined)).toBe(false)
    expect(isLogRetentionDryRun('0')).toBe(false)
    expect(isLogRetentionDryRun('1')).toBe(true)
  })

  it('无效配置回退默认值', () => {
    expect(resolveLogRetentionDays('0')).toBe(DEFAULT_LOG_RETENTION_DAYS)
    expect(resolveLogRetentionDays('abc')).toBe(DEFAULT_LOG_RETENTION_DAYS)
    expect(resolveLogRetentionDays('90.5')).toBe(DEFAULT_LOG_RETENTION_DAYS)
    expect(resolveLogRetentionIntervalMs('0')).toBe(DEFAULT_LOG_RETENTION_INTERVAL_HOURS * 60 * 60 * 1000)
    expect(resolveLogRetentionIntervalMs('x')).toBe(DEFAULT_LOG_RETENTION_INTERVAL_HOURS * 60 * 60 * 1000)
  })

  it('合法配置生效', () => {
    expect(resolveLogRetentionDays('30')).toBe(30)
    expect(resolveLogRetentionIntervalMs('12')).toBe(12 * 60 * 60 * 1000)
  })
})

describe('LogRetentionService', () => {
  let previousDatabaseUrl: string | undefined

  beforeEach(() => {
    jest.clearAllMocks()
    previousDatabaseUrl = process.env.DATABASE_URL
    process.env.DATABASE_URL = 'file:./test.db'
    mockAgentFindMany.mockResolvedValue([])
    mockLlmFindMany.mockResolvedValue([])
    mockPromptFindMany.mockResolvedValue([])
    mockQueryRawUnsafe.mockResolvedValue([])
  })

  afterEach(() => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousDatabaseUrl
    jest.useRealTimers()
  })

  it('cutoff = now - 90 天 - 1 小时缓冲，三表使用各自时间列', async () => {
    jest.useFakeTimers()
    jest.setSystemTime(FIXED_NOW)
    const service = new LogRetentionService({ retentionDays: 90 })

    const result = await service.run()

    expect(result).not.toBeNull()
    const cutoff = expectedCutoff(FIXED_NOW, 90)
    expect(result!.cutoff).toEqual(cutoff)
    expect(mockAgentFindMany).toHaveBeenCalledTimes(1)
    expect(mockAgentFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { calledAt: { lt: cutoff } },
      orderBy: { calledAt: 'asc' },
      take: LOG_RETENTION_BATCH_SIZE,
      select: { id: true }
    }))
    expect(mockLlmFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { startedAt: { lt: cutoff } }
    }))
    expect(mockPromptFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { createdAt: { lt: cutoff } }
    }))
  })

  it('空表立即退出：每表只查询一次，不调用 deleteMany', async () => {
    const service = new LogRetentionService({ retentionDays: 90 })

    const result = await service.run()

    expect(result!.totalDeletedRows).toBe(0)
    expect(result!.tables.map(item => item.table)).toEqual([
      'agent_call_logs',
      'llm_execution_attempts',
      'prompt_call_logs'
    ])
    expect(mockAgentFindMany).toHaveBeenCalledTimes(1)
    expect(mockLlmFindMany).toHaveBeenCalledTimes(1)
    expect(mockPromptFindMany).toHaveBeenCalledTimes(1)
    expect(mockAgentDeleteMany).not.toHaveBeenCalled()
    expect(mockLlmDeleteMany).not.toHaveBeenCalled()
    expect(mockPromptDeleteMany).not.toHaveBeenCalled()
  })

  it('分页循环删除：多批 5000 直到空批，按批独立删除', async () => {
    const service = new LogRetentionService({ retentionDays: 90 })
    mockAgentFindMany
      .mockResolvedValueOnce(batchOfIds('a', LOG_RETENTION_BATCH_SIZE))
      .mockResolvedValueOnce(batchOfIds('b', LOG_RETENTION_BATCH_SIZE))
      .mockResolvedValue([])
    mockAgentDeleteMany.mockResolvedValue({ count: LOG_RETENTION_BATCH_SIZE })

    const result = await service.run()

    expect(mockAgentFindMany).toHaveBeenCalledTimes(3)
    expect(mockAgentDeleteMany).toHaveBeenCalledTimes(2)
    const firstCall = mockAgentDeleteMany.mock.calls[0][0]
    const secondCall = mockAgentDeleteMany.mock.calls[1][0]
    expect(firstCall.where.id.in).toHaveLength(LOG_RETENTION_BATCH_SIZE)
    expect(secondCall.where.id.in).toHaveLength(LOG_RETENTION_BATCH_SIZE)
    expect(firstCall.where.id.in[0]).toBe('a-0')
    expect(secondCall.where.id.in[0]).toBe('b-0')
    expect(result!.tables[0]).toEqual(expect.objectContaining({ table: 'agent_call_logs', deletedRows: 10000 }))
    expect(result!.totalDeletedRows).toBe(10000)
  })

  it('deleteMany 实际删除数少于批量时按 count 累计，空批后退出', async () => {
    const service = new LogRetentionService({ retentionDays: 90 })
    mockAgentFindMany
      .mockResolvedValueOnce(batchOfIds('a', LOG_RETENTION_BATCH_SIZE))
      .mockResolvedValue([])
    mockAgentDeleteMany.mockResolvedValue({ count: 3999 })

    const result = await service.run()

    expect(mockAgentDeleteMany).toHaveBeenCalledTimes(1)
    expect(result!.tables[0].deletedRows).toBe(3999)
    expect(result!.totalDeletedRows).toBe(3999)
  })

  it('dry-run：只统计不删除，日志注明 dryRun', async () => {
    const service = new LogRetentionService({ retentionDays: 90, dryRun: true })
    mockAgentFindMany
      .mockResolvedValueOnce(batchOfIds('a', LOG_RETENTION_BATCH_SIZE))
      .mockResolvedValue([])

    const result = await service.run()

    expect(mockAgentDeleteMany).not.toHaveBeenCalled()
    expect(mockLlmDeleteMany).not.toHaveBeenCalled()
    expect(mockPromptDeleteMany).not.toHaveBeenCalled()
    expect(result!.totalDeletedRows).toBe(LOG_RETENTION_BATCH_SIZE)
    expect(result!.dryRun).toBe(true)
    expect(mockLogger.info).toHaveBeenCalledWith(
      '[log-retention] 清理完成',
      expect.objectContaining({ table: 'agent_call_logs', deletedRows: LOG_RETENTION_BATCH_SIZE, dryRun: true })
    )
  })

  it('防重入：在途轮次进行中再次 run 直接跳过', async () => {
    const service = new LogRetentionService({ retentionDays: 90 })
    let release!: () => void
    mockAgentFindMany.mockImplementation(() => new Promise(resolve => {
      release = () => resolve([])
    }))

    const first = service.run()
    const second = service.run()

    expect(service.isRunning()).toBe(true)
    await expect(second).resolves.toBeNull()
    expect(mockLogger.warn).toHaveBeenCalledWith('[log-retention] 上一轮清理仍在进行，跳过本轮')
    release()
    await first
    expect(service.isRunning()).toBe(false)
  })

  it('幂等：同一 cutoff 下重复轮次不会重复删除（findMany 空批退出）', async () => {
    jest.useFakeTimers()
    jest.setSystemTime(FIXED_NOW)
    const service = new LogRetentionService({ retentionDays: 90 })
    mockAgentFindMany
      .mockResolvedValueOnce(batchOfIds('a', 10))
      .mockResolvedValue([])
    mockAgentDeleteMany.mockResolvedValue({ count: 10 })

    const first = await service.run()
    const second = await service.run()

    expect(first!.totalDeletedRows).toBe(10)
    expect(second!.totalDeletedRows).toBe(0)
    expect(mockAgentDeleteMany).toHaveBeenCalledTimes(1)
  })

  it('lifecycle draining 时跳过清理', async () => {
    const service = new LogRetentionService({
      retentionDays: 90,
      lifecycle: { isDraining: () => true }
    })

    const result = await service.run()

    expect(result!.skipped).toBe(true)
    expect(result!.totalDeletedRows).toBe(0)
    expect(mockAgentFindMany).not.toHaveBeenCalled()
    expect(mockLlmFindMany).not.toHaveBeenCalled()
    expect(mockPromptFindMany).not.toHaveBeenCalled()
  })

  it('清理失败记录 error 日志且返回 null', async () => {
    const service = new LogRetentionService({ retentionDays: 90 })
    mockAgentFindMany.mockRejectedValue(new Error('database locked'))

    const result = await service.run()

    expect(result).toBeNull()
    expect(mockLogger.error).toHaveBeenCalledWith(
      '[log-retention] 清理失败',
      expect.objectContaining({ error: 'database locked' })
    )
    expect(service.isRunning()).toBe(false)
  })

  it('SQLite 下收尾执行 WAL checkpoint，非 SQLite 跳过', async () => {
    const service = new LogRetentionService({ retentionDays: 90 })
    await service.run()
    expect(mockQueryRawUnsafe).toHaveBeenCalledWith('PRAGMA wal_checkpoint(TRUNCATE)')

    jest.clearAllMocks()
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/wenflow'
    const postgresService = new LogRetentionService({ retentionDays: 90 })
    await postgresService.run()
    expect(mockQueryRawUnsafe).not.toHaveBeenCalled()
  })

  it('start 启动定时器：立即执行一轮 + 每 intervalMs 一轮，stop 清除定时器', async () => {
    jest.useFakeTimers()
    jest.setSystemTime(FIXED_NOW)
    mockRunBackgroundTask.mockImplementation((_name, task) => {
      void task()
    })
    const service = new LogRetentionService({ retentionDays: 90, intervalMs: 6 * 60 * 60 * 1000 })

    service.start({ isDraining: () => false })
    expect(mockRunBackgroundTask).toHaveBeenCalledTimes(1)
    expect(mockRunBackgroundTask.mock.calls[0][0]).toBe('logs.retention.run')
    expect(mockAgentFindMany).toHaveBeenCalledTimes(1)

    await jest.advanceTimersByTimeAsync(6 * 60 * 60 * 1000)
    expect(mockRunBackgroundTask).toHaveBeenCalledTimes(2)

    await service.stop()
    await jest.advanceTimersByTimeAsync(12 * 60 * 60 * 1000)
    expect(mockRunBackgroundTask).toHaveBeenCalledTimes(2)
  })

  it('stop 等待在途清理完成后才返回', async () => {
    const service = new LogRetentionService({ retentionDays: 90 })
    let release!: () => void
    mockAgentFindMany.mockImplementation(() => new Promise(resolve => {
      release = () => resolve([])
    }))

    const running = service.run()
    let stopped = false
    const stopping = service.stop().then(() => { stopped = true })

    await Promise.resolve()
    expect(stopped).toBe(false)
    release()
    await Promise.all([running, stopping])
    expect(stopped).toBe(true)
  })
})
