/**
 * FSRS 通电（2026-10-07，P1-10 根因）：
 * - `recordSessionOutcome` 对有证据的看板项传 `fsrsGrade` → 经 `fsrsSchedule` 写原生四元组；
 * - 无证据项（pending / review / 无进度变化 / 非法状态）**不传 grade**，
 *   `recordExtraction` 的「无 grade 路径」逐字不变（preserveDueAt 语义）；
 * - 最小「模拟调度」：同一概念连续两节普通课（derived 源）后 fsrsStability 落库并随成绩演进。
 *
 * 证据门语义表见 `fsrs.ts` 的 `fsrsGradeFromOutcome` 注释。
 */
const mockFindUnique = jest.fn()
const mockUpsert = jest.fn()
let nowIso = '2026-10-07T02:00:00.000Z'

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: { memory_traces: { findUnique: mockFindUnique, upsert: mockUpsert }, learner_evidence: { createMany: jest.fn(async () => ({ count: 0 })) } },
}))
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))
jest.mock('../../virtual-lab/simulation-clock-context', () => ({
  simulatedNowOr: () => new Date(nowIso),
}))
jest.mock('../../learner/concept-registry.service', () => ({
  conceptRegistryService: { resolveConcept: jest.fn().mockResolvedValue(null) },
}))

import { memoryTraceService } from '../memory-trace.service'

/** 最小内存痕迹存储：把 upsert 的 create/update 语义落到一行，支撑连续两节模拟调度 */
function installStatefulStore(initial: any | null) {
  let row = initial
  mockFindUnique.mockImplementation(async () => row)
  mockUpsert.mockImplementation(async (args: any) => {
    if (!row) {
      row = { ...args.create, id: 'mt-test' }
    } else {
      const next: any = { ...row }
      for (const [key, value] of Object.entries(args.update)) {
        if (value && typeof value === 'object' && (value as any).increment !== undefined) {
          next[key] = (next[key] ?? 0) + (value as any).increment
        } else if (value !== undefined) {
          next[key] = value
        }
      }
      row = next
    }
    return row
  })
  return () => row
}

describe('recordSessionOutcome：有证据项写原生 FSRS 四元组（P1-10）', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    nowIso = '2026-10-07T02:00:00.000Z'
  })

  it('mastered + progress=100 → grade=Easy，create/update 均写 fsrsStability/Difficulty/Lapses/Reps', async () => {
    mockFindUnique.mockResolvedValue(null)
    mockUpsert.mockResolvedValue({})

    await memoryTraceService.recordSessionOutcome('u1', [
      { name: '闭包', status: 'mastered', progress: 100 },
    ], 'derived')

    const args = mockUpsert.mock.calls[0][0]
    for (const quad of ['fsrsStability', 'fsrsDifficulty', 'fsrsLapses', 'fsrsReps']) {
      expect(args.create[quad]).toEqual(expect.any(Number))
      expect(args.update[quad]).toEqual(expect.any(Number))
    }
    // Easy 档（满分掌握）稳定期应显著长于 Again：>1 天
    expect(args.create.fsrsStability).toBeGreaterThan(1)
    expect(args.update).toHaveProperty('dueAt')
  })

  it('learning + progress>0 → grade=Again，同样写原生四元组', async () => {
    mockFindUnique.mockResolvedValue(null)
    mockUpsert.mockResolvedValue({})

    await memoryTraceService.recordSessionOutcome('u1', [
      { name: '词法作用域', status: 'learning', progress: 40 },
    ], 'derived')

    const args = mockUpsert.mock.calls[0][0]
    expect(args.update.fsrsStability).toEqual(expect.any(Number))
    expect(args.update.fsrsReps).toBe(1)
    expect(args.update.fsrsLapses).toBe(0)
  })

  it('pending / review / 无进度（progress=0）/ 非法状态 → 不写任何 fsrs* 键（宁缺勿滥）', async () => {
    const cases: Array<{ status: any; progress: number }> = [
      { status: 'pending', progress: 0 },
      { status: 'pending', progress: 60 },   // 未开始的概念不该被记成复习失败
      { status: 'review', progress: 50 },    // 到期复习点由复习事件链单一写入
      { status: 'mastered', progress: 0 },   // 有状态无进度变化
      { status: 'learning', progress: 0 },
      { status: 'bogus' as any, progress: 80 },
    ]
    for (const item of cases) {
      jest.clearAllMocks()
      mockFindUnique.mockResolvedValue(null)
      mockUpsert.mockResolvedValue({})
      await memoryTraceService.recordSessionOutcome('u1', [{ name: `c-${item.status}-${item.progress}`, ...item }], 'derived')
      const args = mockUpsert.mock.calls[0][0]
      // create 分支的既有行为：无 grade 时四列显式写 null（逐字不变）；update 分支则完全不带键
      expect(args.create.fsrsStability).toBeNull()
      expect(args.create.fsrsDifficulty).toBeNull()
      expect(args.create.fsrsLapses).toBeNull()
      expect(args.create.fsrsReps).toBeNull()
      expect(args.update).not.toHaveProperty('fsrsStability')
      expect(args.update).not.toHaveProperty('fsrsDifficulty')
      expect(args.update).not.toHaveProperty('fsrsLapses')
      expect(args.update).not.toHaveProperty('fsrsReps')
      // 无 grade 路径：首次创建仍写 legacy dueAt；已有 FSRS 排程时不覆盖（见下一 describe）
      expect(args.create).toHaveProperty('dueAt')
    }
  })
})

describe('recordSessionOutcome：session:outcome 证据补齐（B2 第二步，收尾批 C6）', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFindUnique.mockResolvedValue(null)
    mockUpsert.mockResolvedValue({})
  })

  it('逐项落证据（去重同名、confidence 0.6、挂 sessionId/pathId、payload 带 grade）', async () => {
    const createMany = jest.fn(async () => ({ count: 2 }))
    const db = (jest.requireMock('../../../config/database') as any).default
    db.learner_evidence.createMany = createMany
    mockFindUnique.mockResolvedValue(null)
    mockUpsert.mockResolvedValue({})

    const count = await memoryTraceService.recordSessionOutcome(
      'u1',
      [
        { name: '闭包', status: 'mastered', progress: 100 },
        { name: '闭包', status: 'mastered', progress: 100 }, // 同名去重
        { name: '词法作用域', status: 'pending', progress: 0 },
      ],
      'derived', 'accurate', 'path-1', 'sess-9',
    )
    expect(count).toBe(3)
    expect(createMany).toHaveBeenCalledTimes(1)
    const firstCall = createMany.mock.calls[0] as unknown as [{ data: any[] }] | undefined
    const rows = firstCall![0].data
    expect(rows).toHaveLength(2) // 同名概念只留一行
    const closure = rows.find((r: any) => r.evidenceKey === 'session:outcome:闭包')
    expect(closure).toEqual(expect.objectContaining({
      evidenceType: 'session:outcome',
      userId: 'u1',
      pathId: 'path-1',
      sessionId: 'sess-9',
      confidence: 0.6,
    }))
    const payload = JSON.parse(closure.payload)
    expect(payload).toEqual(expect.objectContaining({ conceptKey: '闭包', status: 'mastered', fsrsGrade: 4 }))
    const pending = rows.find((r: any) => r.evidenceKey === 'session:outcome:词法作用域')
    expect(JSON.parse(pending.payload).fsrsGrade).toBeNull() // 无证据项 grade=null（宁缺勿滥镜像）
  })

  it('证据落库失败不阻断痕迹回写（返回 count 照常）', async () => {
    const db = (jest.requireMock('../../../config/database') as any).default
    db.learner_evidence.createMany = jest.fn(async () => { throw new Error('db busy') })
    mockFindUnique.mockResolvedValue(null)
    mockUpsert.mockResolvedValue({})

    const count = await memoryTraceService.recordSessionOutcome('u1', [{ name: '闭包', status: 'mastered', progress: 100 }], 'derived')
    expect(count).toBe(1)
    expect(mockUpsert).toHaveBeenCalledTimes(1)
  })
})

describe('recordSessionOutcome：无 grade 路径逐字不变（preserveDueAt，18 号报告 N5）', () => {
  beforeEach(() => jest.clearAllMocks())

  it('已有 FSRS 排程 + 无证据项 → update 不带 dueAt、不带 fsrs*（既有长间隔不被压回）', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'mt1', userId: 'u1', conceptKey: '概念', masteryScore: 0.5, stability: 'developing',
      lastSeenAt: new Date('2026-10-01T00:00:00.000Z'), extractionCount: 3,
      fsrsStability: 12.5, fsrsDifficulty: 5, fsrsLapses: 0, fsrsReps: 3,
    })
    mockUpsert.mockResolvedValue({})

    await memoryTraceService.recordSessionOutcome('u1', [{ name: '概念', status: 'review', progress: 50 }], 'derived')

    const args = mockUpsert.mock.calls[0][0]
    expect(args.update).not.toHaveProperty('dueAt')
    expect(args.update).not.toHaveProperty('fsrsStability')
    expect(args.update.masteryScore).toBe(0.5)
    expect(args.update.lastSeenAt).toBeInstanceOf(Date)
  })
})

describe('最小模拟调度：derived 源开始产 fsrsStability 的代码路径', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    nowIso = '2026-10-07T02:00:00.000Z'
  })

  it('同一概念连续两节普通课（mastered→mastered）后，痕迹从无 FSRS 变为有 FSRS 且稳定性递增', async () => {
    const read = installStatefulStore(null)

    // 第 1 节：引导下掌握（progress 60 → Good）
    await memoryTraceService.recordSessionOutcome('u1', [{ name: '定积分换元', status: 'mastered', progress: 60 }], 'derived')
    const afterFirst = read()
    expect(afterFirst.fsrsStability).toBeGreaterThan(0)
    expect(afterFirst.source).toBe('derived')
    const stability1 = afterFirst.fsrsStability

    // 第 2 节（3 天后）：再次判定掌握（progress 100 → Easy）
    nowIso = '2026-10-10T02:00:00.000Z'
    await memoryTraceService.recordSessionOutcome('u1', [{ name: '定积分换元', status: 'mastered', progress: 100 }], 'derived')
    const afterSecond = read()
    expect(afterSecond.fsrsStability).toBeGreaterThan(stability1)
    expect(afterSecond.fsrsReps).toBe(2)
    expect(afterSecond.source).toBe('derived')
  })

  it('无证据项在同一概念上不打断既有 FSRS 排程（间隔保留）', async () => {
    const read = installStatefulStore(null)

    await memoryTraceService.recordSessionOutcome('u1', [{ name: '向量', status: 'mastered', progress: 100 }], 'derived')
    const scheduled = read()
    expect(scheduled.fsrsStability).toBeGreaterThan(1)

    nowIso = '2026-10-20T02:00:00.000Z'
    await memoryTraceService.recordSessionOutcome('u1', [{ name: '向量', status: 'pending', progress: 0 }], 'derived')
    const afterPending = read()
    expect(afterPending.fsrsStability).toBe(scheduled.fsrsStability)
    expect(afterPending.dueAt).toEqual(scheduled.dueAt)
  })
})