const mockPrisma = {
  users: { findUnique: jest.fn(), updateMany: jest.fn() },
  learning_metrics: { findFirst: jest.fn(), findMany: jest.fn() },
  teaching_sessions: { findMany: jest.fn() },
  learning_pmc_checkpoints: { findFirst: jest.fn(), upsert: jest.fn() },
}

jest.mock('../../../config/database', () => ({ __esModule: true, default: mockPrisma }))
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

import { LearningStateService } from '../learning-state.service'
import { replayDailyPmc } from '../learning-load-pmc.service'
import {
  loadLatestCheckpoint,
  maybeWriteCheckpoint,
  PMC_CHECKPOINT_INTERVAL_DAYS,
  PMC_CHECKPOINT_METRIC_VERSION,
  PMC_CHECKPOINT_GLOBAL_SCOPE,
} from '../learning-pmc-checkpoint'
import { PMC_KTL_LAMBDA, PMC_LF_LAMBDA } from '../learning-load.pmc'
import { addDaysToDayKey, endOfDay, parseDayKeyStart } from '../../time/day-boundary'

/**
 * 架构优化批 2b：PMC 滚动 checkpoint。
 *
 * 核心不变量：**种子续放 ≡ 全量重放**（读侧只省行数，不改变任何输出）；
 * checkpoint 本身是 best-effort 缓存（读失败回退全量、写失败不影响读取）。
 */

const DAY0 = '2026-08-01'
const mkRow = (dayKey: string, lss: number) => ({
  calculatedAt: new Date(`${dayKey}T10:00:00+08:00`),
  lss,
  ktl: lss,
  lf: lss,
  sourceKey: `x:${dayKey}`,
  taskId: null,
})
/** 40 天连续学习史（每天一节，LSS 3..7 波动），第 25 天（index 24）作 checkpoint 日 */
const days = Array.from({ length: 40 }, (_, i) => addDaysToDayKey(DAY0, i))
const rows = days.map((d, i) => mkRow(d, 3 + (i % 5)))
const seedDay = days[24]
const until = new Date(`${days[39]}T23:00:00+08:00`)

describe('replayDailyPmc 种子续放 ≡ 全量重放（2b 核心不变量）', () => {
  const full = replayDailyPmc(rows, { until })
  const seedReplay = replayDailyPmc(rows.slice(0, 25), {
    until: endOfDay(parseDayKeyStart(seedDay)),
  })
  const seed = {
    dayKey: seedDay,
    ktl: seedReplay.latest!.ktl,
    lf: seedReplay.latest!.lf,
    latestLessonLss: seedReplay.latestLessonLss,
    latestLessonAt: seedReplay.latestLessonAt,
  }
  const partial = replayDailyPmc(rows.slice(25), { until, seed })

  it('latest 收盘态逐字段一致（KTL/LF/LSB）', () => {
    expect(partial.latest!.ktl).toBeCloseTo(full.latest!.ktl, 9)
    expect(partial.latest!.lf).toBeCloseTo(full.latest!.lf, 9)
    expect(partial.latest!.lsb).toBeCloseTo(full.latest!.lsb, 9)
  })

  it('逐日序列尾部一致（daily 与 pmc 点位对齐）', () => {
    expect(partial.daily.length).toBe(full.daily.length - 25)
    expect(partial.pmc.length).toBe(full.pmc.length - 25)
    for (let i = 0; i < partial.pmc.length; i += 1) {
      const want = full.pmc[full.pmc.length - partial.pmc.length + i]
      expect(partial.pmc[i].ktl).toBeCloseTo(want.ktl, 9)
      expect(partial.pmc[i].lf).toBeCloseTo(want.lf, 9)
      expect(partial.pmc[i].dayLoad).toBeCloseTo(want.dayLoad, 9)
    }
    for (let i = 0; i < partial.daily.length; i += 1) {
      const want = full.daily[full.daily.length - partial.daily.length + i]
      expect(partial.daily[i]).toEqual(want)
    }
  })

  it('latestLesson 回退到种子携带值（checkpoint 日之后无新课时）', () => {
    const idleAfterSeed = replayDailyPmc([], {
      until: new Date(`${addDaysToDayKey(seedDay, 3)}T20:00:00+08:00`),
      seed,
    })
    expect(idleAfterSeed.latestLessonLss).toBe(seed.latestLessonLss)
    expect(idleAfterSeed.latestLessonAt).toBe(seed.latestLessonAt)
  })

  it('种子日及之前的行被防御性剔除（不双计）', () => {
    const stale = replayDailyPmc([mkRow(seedDay, 9), mkRow(addDaysToDayKey(seedDay, -2), 9)], {
      until: new Date(`${seedDay}T20:00:00+08:00`),
      seed,
    })
    // 那两行若被计入会把值抬起来；剔除后 = 纯种子收盘态
    expect(stale.latest!.ktl).toBeCloseTo(seed.ktl, 9)
    expect(stale.latest!.lf).toBeCloseTo(seed.lf, 9)
    expect(stale.daily).toEqual([])
  })

  it('种子 + 无后续行：空闲日按半衰期回落（until 延伸才衰减）', () => {
    const idle5 = replayDailyPmc([], {
      until: new Date(`${addDaysToDayKey(seedDay, 5)}T20:00:00+08:00`),
      seed,
    })
    expect(idle5.daily.length).toBe(5)
    expect(idle5.latest!.ktl).toBeCloseTo(seed.ktl * Math.pow(PMC_KTL_LAMBDA, 5), 9)
    expect(idle5.latest!.lf).toBeCloseTo(seed.lf * Math.pow(PMC_LF_LAMBDA, 5), 9)
    // until 不超过种子日：原样返回收盘态
    const sameDay = replayDailyPmc([], {
      until: new Date(`${seedDay}T20:00:00+08:00`),
      seed,
    })
    expect(sameDay.latest!.ktl).toBeCloseTo(seed.ktl, 9)
    expect(sameDay.daily).toEqual([])
  })
})

describe('loadLatestCheckpoint（best-effort 读取）', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('无 checkpoint → null', async () => {
    mockPrisma.learning_pmc_checkpoints.findFirst.mockResolvedValue(null)
    await expect(loadLatestCheckpoint('u1', until)).resolves.toBeNull()
  })

  it('有效行 → 种子 + 行查询下界（日末 +1ms）', async () => {
    const latestLessonAt = new Date(`${seedDay}T10:00:00+08:00`)
    mockPrisma.learning_pmc_checkpoints.findFirst.mockResolvedValue({
      userId: 'u1',
      scope: PMC_CHECKPOINT_GLOBAL_SCOPE,
      dayKey: seedDay,
      ktl: 4.2,
      lf: 2.1,
      latestLessonLss: 3.5,
      latestLessonAt,
      metricVersion: PMC_CHECKPOINT_METRIC_VERSION,
    })
    const loaded = await loadLatestCheckpoint('u1', until)
    expect(loaded!.dayKey).toBe(seedDay)
    expect(loaded!.rowsSince.getTime()).toBe(endOfDay(parseDayKeyStart(seedDay)).getTime() + 1)
    expect(loaded!.seed).toMatchObject({ dayKey: seedDay, ktl: 4.2, lf: 2.1, latestLessonLss: 3.5 })
    expect(loaded!.seed.latestLessonAt).toEqual(latestLessonAt)
    // 查询口径：同 scope、version 门禁、只取 asOf 当日及之前
    const call = mockPrisma.learning_pmc_checkpoints.findFirst.mock.calls[0][0]
    expect(call.where).toMatchObject({
      userId: 'u1',
      scope: PMC_CHECKPOINT_GLOBAL_SCOPE,
      metricVersion: PMC_CHECKPOINT_METRIC_VERSION,
    })
    expect(call.where.dayKey).toEqual({ lte: '2026-09-09' })
    expect(call.orderBy).toEqual({ dayKey: 'desc' })
  })

  it('读失败 → null 不抛（回退全量重放）', async () => {
    mockPrisma.learning_pmc_checkpoints.findFirst.mockRejectedValue(new Error('boom'))
    await expect(loadLatestCheckpoint('u1', until)).resolves.toBeNull()
  })
})

describe('maybeWriteCheckpoint（间隔门禁 + best-effort 写）', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPrisma.learning_pmc_checkpoints.upsert.mockResolvedValue({})
  })

  it('历史跨度满间隔 → 以最后一天收盘态 upsert', async () => {
    const series = replayDailyPmc(rows, { until })
    await maybeWriteCheckpoint('u1', series, null)
    expect(mockPrisma.learning_pmc_checkpoints.upsert).toHaveBeenCalledTimes(1)
    const call = mockPrisma.learning_pmc_checkpoints.upsert.mock.calls[0][0]
    expect(call.where).toEqual({
      userId_scope_dayKey: { userId: 'u1', scope: PMC_CHECKPOINT_GLOBAL_SCOPE, dayKey: days[39] },
    })
    expect(call.create).toMatchObject({
      userId: 'u1',
      dayKey: days[39],
      ktl: series.pmc[series.pmc.length - 1].ktl,
      lf: series.pmc[series.pmc.length - 1].lf,
      metricVersion: PMC_CHECKPOINT_METRIC_VERSION,
    })
  })

  it('距上一 checkpoint 不足间隔 → 不写', async () => {
    const series = replayDailyPmc(rows, { until })
    await maybeWriteCheckpoint('u1', series, addDaysToDayKey(days[39], -(PMC_CHECKPOINT_INTERVAL_DAYS - 1)))
    expect(mockPrisma.learning_pmc_checkpoints.upsert).not.toHaveBeenCalled()
  })

  it('空序列（纯种子无新课）→ 不写', async () => {
    const empty = replayDailyPmc([], { seed: { dayKey: seedDay, ktl: 4, lf: 2 } })
    await maybeWriteCheckpoint('u1', empty, null)
    expect(mockPrisma.learning_pmc_checkpoints.upsert).not.toHaveBeenCalled()
  })

  it('写失败 → 不抛（不影响读路径）', async () => {
    const series = replayDailyPmc(rows, { until })
    mockPrisma.learning_pmc_checkpoints.upsert.mockRejectedValue(new Error('boom'))
    await expect(maybeWriteCheckpoint('u1', series, null)).resolves.toBeUndefined()
  })
})

describe('derivePmcState 接入 checkpoint（全局非预取路径）', () => {
  const service = new LearningStateService()

  beforeEach(() => {
    jest.clearAllMocks()
    mockPrisma.learning_pmc_checkpoints.findFirst.mockResolvedValue(null)
    mockPrisma.learning_pmc_checkpoints.upsert.mockResolvedValue({})
    mockPrisma.learning_metrics.findMany.mockResolvedValue([])
  })

  it('有 checkpoint：行查询带 gte 下界（只拉 checkpoint 日之后的行）', async () => {
    // 种子必须用 days[30] 的真实收盘态（手工值会合法地让续放偏离全量重放）
    const seedClose = replayDailyPmc(rows.slice(0, 31), {
      until: endOfDay(parseDayKeyStart(days[30])),
    })
    mockPrisma.learning_pmc_checkpoints.findFirst.mockResolvedValue({
      userId: 'u1',
      scope: PMC_CHECKPOINT_GLOBAL_SCOPE,
      dayKey: days[30],
      ktl: seedClose.latest!.ktl,
      lf: seedClose.latest!.lf,
      latestLessonLss: seedClose.latestLessonLss,
      latestLessonAt: seedClose.latestLessonAt,
      metricVersion: PMC_CHECKPOINT_METRIC_VERSION,
    })
    mockPrisma.learning_metrics.findMany.mockResolvedValue(rows.slice(31))

    const metrics = await (service as any).derivePmcState('u1', {
      asOf: new Date(`${days[39]}T23:00:00+08:00`),
    })

    expect(metrics).not.toBeNull()
    const call = mockPrisma.learning_metrics.findMany.mock.calls[0][0]
    expect(call.where.calculatedAt.gte.getTime())
      .toBe(endOfDay(parseDayKeyStart(days[30])).getTime() + 1)
    // 种子续放与全量重放的收盘态一致
    const full = replayDailyPmc(rows, { until: new Date(`${days[39]}T23:00:00+08:00`) })
    expect(metrics.ktl).toBeCloseTo(Math.round(full.latest!.ktl * 1000) / 1000, 6)
    expect(metrics.lf).toBeCloseTo(Math.round(full.latest!.lf * 1000) / 1000, 6)
  })

  it('全局读满间隔 → 读路径滚动写回 checkpoint', async () => {
    mockPrisma.learning_metrics.findMany.mockResolvedValue(rows)

    await (service as any).derivePmcState('u1', { asOf: new Date(`${days[39]}T23:00:00+08:00`) })

    expect(mockPrisma.learning_pmc_checkpoints.upsert).toHaveBeenCalledTimes(1)
    const call = mockPrisma.learning_pmc_checkpoints.upsert.mock.calls[0][0]
    expect(call.create.dayKey).toBe(days[39])
  })

  it('路径维度读（pathId）不走 checkpoint：不读种子、不写回', async () => {
    mockPrisma.learning_metrics.findMany.mockResolvedValue(rows)

    await (service as any).derivePmcState('u1', {
      pathId: 'p1',
      asOf: new Date(`${days[39]}T23:00:00+08:00`),
    })

    expect(mockPrisma.learning_pmc_checkpoints.findFirst).not.toHaveBeenCalled()
    expect(mockPrisma.learning_pmc_checkpoints.upsert).not.toHaveBeenCalled()
  })

  it('预取行路径不走 checkpoint（调用方已持全量行）', async () => {
    const preloaded = rows.map((r) => ({ ...r, pathId: null }))

    const metrics = await (service as any).derivePmcState(
      'u1',
      { asOf: new Date(`${days[39]}T23:00:00+08:00`) },
      preloaded,
    )

    expect(mockPrisma.learning_pmc_checkpoints.findFirst).not.toHaveBeenCalled()
    expect(mockPrisma.learning_pmc_checkpoints.upsert).not.toHaveBeenCalled()
    expect(mockPrisma.learning_metrics.findMany).not.toHaveBeenCalled()
    expect(metrics).not.toBeNull()
  })

  it('仅有 checkpoint、无后续行 → 空闲回落而非「无状态」', async () => {
    mockPrisma.learning_pmc_checkpoints.findFirst.mockResolvedValue({
      userId: 'u1',
      scope: PMC_CHECKPOINT_GLOBAL_SCOPE,
      dayKey: days[30],
      ktl: 5,
      lf: 2.5,
      latestLessonLss: 4,
      latestLessonAt: new Date(`${days[30]}T10:00:00+08:00`),
      metricVersion: PMC_CHECKPOINT_METRIC_VERSION,
    })
    mockPrisma.learning_metrics.findMany.mockResolvedValue([])

    const metrics = await (service as any).derivePmcState('u1', {
      asOf: new Date(`${days[34]}T23:00:00+08:00`),
    })

    expect(metrics).not.toBeNull()
    expect(metrics.ktl).toBeCloseTo(5 * Math.pow(PMC_KTL_LAMBDA, 4), 3)
  })
})
