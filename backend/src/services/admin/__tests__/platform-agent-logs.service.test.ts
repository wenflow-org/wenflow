/**
 * platform-agent-logs.service 单测：stats 八件套。
 * - byAgentErrors（2026-10-28 数据审计 P1）：总览待办/侧栏角标改用全量 by-agent 失败聚合，
 *   替代「200 行采样数冒充近 7 天失败」；锁定 error 与 timeout 拆分互不污染、只数 error、Top5 排序。
 * - latencyPercentiles（2026-10-29 审计 M-3）：全窗延迟分位 P50/P99 替代前端当前页样本；
 *   锁定口径（仅成功行、canary 剔除、非负 durationMs）、算法（round((n-1)*q) 下标，与前端
 *   ExecLogs.vue percentileMsOf 同式）与空数据 → null。
 */

export {}

const groupBy = jest.fn()
const failedFindMany = jest.fn()
const durationFindMany = jest.fn()

/** 分位查询与失败行查询按 select 形状分派（durationMs 窄列 = 分位查询） */
const isDurationQuery = (args: unknown): boolean => {
  const select = (args as { select?: Record<string, unknown> } | undefined)?.select
  return !!select && 'durationMs' in select
}

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    agent_call_logs: {
      groupBy,
      findMany: (args: unknown) => (isDurationQuery(args) ? durationFindMany(args) : failedFindMany(args)),
    },
  },
}))

jest.mock('../../../utils/logger', () => ({ logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() } }))

import { fetchAgentLogStats } from '../platform-agent-logs.service'

const successGroup = (sourceEntry: string, success: boolean, count: number) => ({
  sourceEntry,
  success,
  _count: { _all: count },
})

const failedRow = (agentId: string, kind: 'error' | 'timeout') => ({
  agentId,
  errorCode: kind === 'timeout' ? 'ETIMEDOUT' : 'SKILL_EXECUTION_FAILED',
  errorCategory: null,
  error: kind === 'timeout' ? 'Provider request timeout' : 'internal failure',
})

describe('fetchAgentLogStats：byAgentErrors（全量 by-agent 失败聚合）', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    durationFindMany.mockResolvedValue([])
  })

  it('error/timeout 拆分 + byAgentErrors 只数 error、Top5 降序；canary 剔除主口径', async () => {
    groupBy.mockResolvedValue([
      successGroup('platform', true, 90),
      successGroup('platform', false, 6),
      successGroup('system-canary', true, 4),
    ])
    failedFindMany.mockResolvedValue([
      failedRow('goal-conversation', 'error'),
      failedRow('goal-conversation', 'timeout'),
      failedRow('api-gateway', 'error'),
      failedRow('api-gateway', 'error'),
      failedRow('teaching-turn', 'timeout'),
    ])

    const tuple = await fetchAgentLogStats({
      where: { AND: [{ sourceEntry: { not: 'system-canary' } }] },
      canaryWhere: { AND: [{ sourceEntry: 'system-canary' }] },
      statsWhere: { AND: [] },
      canarySourceEntry: 'system-canary',
    })

    const [total, successCount, timeoutCount, errorCount, bySourceRows, canaryCount, byAgentErrors] = tuple
    // 默认视图：canary 行进 statsWhere 扫描但被 JS 剔除出主口径、单独计数
    expect(total).toBe(96)
    expect(successCount).toBe(90)
    expect(canaryCount).toBe(4)
    expect(bySourceRows).toEqual([{ sourceEntry: 'platform', _count: { _all: 96 } }])
    // 失败行拆分：goal-conversation 1 error + api-gateway 2 error = 3；2 条 timeout 不进 error
    expect(timeoutCount).toBe(2)
    expect(errorCount).toBe(3)
    // byAgentErrors 只数 error：goal-conversation 1（timeout 不计）、api-gateway 2 → 按次数降序
    expect(byAgentErrors).toEqual([
      { agentId: 'api-gateway', count: 2 },
      { agentId: 'goal-conversation', count: 1 },
    ])
  })

  it('失败行超过 5 个 agent 时截断 Top5；无失败行返回空数组（角标/待办不亮）', async () => {
    groupBy.mockResolvedValue([successGroup('platform', true, 10)])
    failedFindMany.mockResolvedValue(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((agentId) => {
        // a 最多（7 次），其余递减，f/g 应被截掉
        const count = 7 - 'abcdefg'.indexOf(agentId)
        return Array.from({ length: count }, () => failedRow(agentId, 'error')).map((row, i) => ({ ...row, id: `${agentId}-${i}` }))
      }).flat()
    )

    const tuple = await fetchAgentLogStats({ where: {} })
    const byAgentErrors = tuple[6]
    expect(byAgentErrors).toHaveLength(5)
    expect(byAgentErrors[0]).toEqual({ agentId: 'a', count: 7 })
    expect(byAgentErrors.map((e: { agentId: string }) => e.agentId)).toEqual(['a', 'b', 'c', 'd', 'e'])

    failedFindMany.mockResolvedValue([])
    const empty = await fetchAgentLogStats({ where: {} })
    expect(empty[3]).toBe(0)
    expect(empty[6]).toEqual([])
  })
})

describe('fetchAgentLogStats：latencyPercentiles（全窗延迟分位，M-3）', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    failedFindMany.mockResolvedValue([])
  })

  it('P50/P99 走全窗成功样本（round((n-1)*q) 下标）；查询只取成功行窄列且默认视图剔除 canary', async () => {
    groupBy.mockResolvedValue([successGroup('platform', true, 15)])
    // 15 个成功样本 1000..15000：p50 = sorted[round(14*0.5)=7] = 8000；p99 = sorted[round(14*0.99)=14] = 15000
    const durations = Array.from({ length: 15 }, (_, i) => ({ durationMs: (i + 1) * 1000 }))
    durationFindMany.mockResolvedValue(durations)

    const tuple = await fetchAgentLogStats({
      where: { AND: [{ sourceEntry: { not: 'system-canary' } }], calledAt: { gte: new Date('2026-10-29T00:00:00Z') } },
      canaryWhere: { AND: [{ sourceEntry: 'system-canary' }], calledAt: { gte: new Date('2026-10-29T00:00:00Z') } },
      statsWhere: { calledAt: { gte: new Date('2026-10-29T00:00:00Z') } },
      canarySourceEntry: 'system-canary',
    })

    expect(tuple[7]).toEqual({ p50: 8000, p99: 15000 })
    // 分位查询口径：与 total/success 同 where + 仅成功行 + durationMs 非空 + canary 排除
    expect(durationFindMany).toHaveBeenCalledTimes(1)
    const latencyArgs = durationFindMany.mock.calls[0][0]
    expect(latencyArgs.select).toEqual({ durationMs: true })
    expect(latencyArgs.where.success).toBe(true)
    expect(latencyArgs.where.durationMs).toEqual({ not: null })
    expect(latencyArgs.where.calledAt).toEqual({ gte: new Date('2026-10-29T00:00:00Z') })
    expect(latencyArgs.where.AND).toEqual([{ sourceEntry: { not: 'system-canary' } }, { sourceEntry: { not: 'system-canary' } }])
  })

  it('乱序/负值 durationMs 过滤后取分位；单样本 p50=p99（与前端样本算法同式）', async () => {
    groupBy.mockResolvedValue([successGroup('platform', true, 4)])
    durationFindMany.mockResolvedValue([
      { durationMs: 9000 },
      { durationMs: -1 }, // 非法（<0）不进样本
      { durationMs: 1000 },
      { durationMs: null },
      { durationMs: 5000 },
    ])

    const tuple = await fetchAgentLogStats({ where: {} })
    // 有效样本升序 [1000, 5000, 9000]：p50 = sorted[1] = 5000；p99 = sorted[round(2*0.99)=2] = 9000
    expect(tuple[7]).toEqual({ p50: 5000, p99: 9000 })

    durationFindMany.mockResolvedValue([{ durationMs: 4200 }])
    const single = await fetchAgentLogStats({ where: {} })
    expect(single[7]).toEqual({ p50: 4200, p99: 4200 })
  })

  it('窗口内无成功样本 → p50/p99 为 null（前端回退当前页样本计算）', async () => {
    groupBy.mockResolvedValue([successGroup('platform', false, 3)])
    durationFindMany.mockResolvedValue([])

    const tuple = await fetchAgentLogStats({ where: {} })
    expect(tuple[7]).toEqual({ p50: null, p99: null })
  })
})
