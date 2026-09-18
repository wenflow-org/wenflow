/**
 * 18 号报告 N5：普通课（无显式评级）不得把 FSRS 已排的 `dueAt` 压回 ~1 天。
 *
 * 旧实现每节课都写 `dueAt = now + intervalDays(~1d)`，把 FSRS 的长间隔系统性压回 1 天，
 * 复习队列由"被上过课"驱动而非稳定性驱动。修复：无 `fsrsGrade` 且该概念已有 FSRS 排程时，
 * update **不带 dueAt**；首次创建仍写 legacy dueAt（保证新概念有初始排程）。
 */
const mockFindUnique = jest.fn()
const mockUpsert = jest.fn()

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: { memory_traces: { findUnique: mockFindUnique, upsert: mockUpsert } },
}))
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))
jest.mock('../../virtual-lab/simulation-clock-context', () => ({
  simulatedNowOr: () => new Date('2026-09-18T10:00:00.000Z'),
}))

import { memoryTraceService } from '../memory-trace.service'

const fsrsRow = {
  id: 'mt1',
  userId: 'u1',
  conceptKey: '概念',
  masteryScore: 0.5,
  stability: 'developing',
  lastSeenAt: new Date('2026-09-10T00:00:00.000Z'),
  extractionCount: 3,
  fsrsStability: 12.5,
  fsrsDifficulty: 5,
  fsrsLapses: 0,
  fsrsReps: 3,
}

describe('recordExtraction：无评级时不覆盖 FSRS 排程的 dueAt（18 号报告 N5）', () => {
  beforeEach(() => jest.clearAllMocks())

  it('已有 FSRS 排程 + 无 fsrsGrade → update 不带 dueAt', async () => {
    mockFindUnique.mockResolvedValue(fsrsRow)
    mockUpsert.mockResolvedValue({})

    await memoryTraceService.recordExtraction({ userId: 'u1', conceptKey: '概念', masteryScore: 0.6, stability: 'developing' })

    const args = mockUpsert.mock.calls[0][0]
    expect(args.update).not.toHaveProperty('dueAt')
    expect(args.update.lastSeenAt).toBeInstanceOf(Date)
  })

  it('已有 FSRS 排程 + 显式 fsrsGrade → 按 FSRS 重排（带 dueAt）', async () => {
    mockFindUnique.mockResolvedValue(fsrsRow)
    mockUpsert.mockResolvedValue({})

    await memoryTraceService.recordExtraction({ userId: 'u1', conceptKey: '概念', masteryScore: 0.6, stability: 'developing', fsrsGrade: 3 })

    const args = mockUpsert.mock.calls[0][0]
    expect(args.update).toHaveProperty('dueAt')
    expect(args.update.fsrsStability).toEqual(expect.any(Number))
  })

  it('无历史（首次创建）→ create 写 legacy dueAt；无 FSRS 排程时 update 仍走 legacy（边界不变）', async () => {
    mockFindUnique.mockResolvedValue(null)
    mockUpsert.mockResolvedValue({})

    await memoryTraceService.recordExtraction({ userId: 'u1', conceptKey: '新概念', masteryScore: 0.3, stability: 'developing' })

    const args = mockUpsert.mock.calls[0][0]
    expect(args.create).toHaveProperty('dueAt')
    // 没有 fsrsStability 的概念没有"FSRS 长间隔"可保护，沿用 legacy 行为
    expect(args.update).toHaveProperty('dueAt')
  })
})
