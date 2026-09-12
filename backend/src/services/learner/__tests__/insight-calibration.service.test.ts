const findUnique = jest.fn()
const upsert = jest.fn()

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: { learner_projections: { findUnique, upsert } },
}))
jest.mock('../../../utils/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

import {
  insightCalibrationService,
  computeReliability,
  insightRecordsKey,
  type InsightRecord,
} from '../insight-calibration.service'

function record(partial: Partial<InsightRecord>): InsightRecord {
  return {
    id: 'r1', claim: 'c', insightType: 'prerequisite_gap', conceptKeys: ['c1'],
    predictedAt: '2026-09-10T00:00:00.000Z', outcome: 'pending', checkedAt: null,
    ...partial,
  }
}

describe('insight-calibration.service (Slice 3b)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    upsert.mockResolvedValue({})
  })

  it('computeReliability：n<5 不给命中率，n≥5 给', () => {
    const four = [record({ outcome: 'hit' }), record({ outcome: 'hit' }), record({ outcome: 'miss' }), record({ outcome: 'hit' })]
    expect(computeReliability(four).hitRate).toBeNull()
    const five = [...four, record({ outcome: 'miss' })]
    const r = computeReliability(five)
    expect(r.n).toBe(5)
    expect(r.hitRate).toBeCloseTo(3 / 5)
  })

  it('recordInsights 按 claim 去重并落库', async () => {
    findUnique.mockResolvedValue(null)
    await insightCalibrationService.recordInsights('u1', 'lp1', [
      { claim: 'A', insightType: 'fatigue', conceptKeys: ['c1'], predictedAt: '2026-09-12T00:00:00.000Z' },
      { claim: 'A', insightType: 'fatigue', conceptKeys: ['c1'], predictedAt: '2026-09-12T00:00:00.000Z' },
      { claim: 'B', insightType: 'granularity', conceptKeys: [], predictedAt: '2026-09-12T00:00:00.000Z' },
    ])
    const call = upsert.mock.calls.at(-1)![0]
    expect(call.where.projectionKey).toBe(insightRecordsKey('u1', 'lp1'))
    expect(call.create.scope).toBe('insight-records')
    const saved = JSON.parse(call.create.payload)
    expect(saved.records).toHaveLength(2)
    expect(saved.records.every((r: any) => r.outcome === 'pending')).toBe(true)
  })

  it('机会到达且概念仍不稳 → hit；概念已稳 → miss；无概念 → unknown；机会未到 → pending', async () => {
    findUnique.mockResolvedValue({
      payload: JSON.stringify({
        schemaVersion: 'learner-insight-records-v1', pathId: 'lp1',
        records: [
          record({ id: 'a', claim: 'still', conceptKeys: ['c1'], predictedAt: '2026-09-10T00:00:00.000Z' }),
          record({ id: 'b', claim: 'stable', conceptKeys: ['c2'], predictedAt: '2026-09-10T00:00:00.000Z' }),
          record({ id: 'c', claim: 'noconcept', conceptKeys: [], predictedAt: '2026-09-10T00:00:00.000Z' }),
          record({ id: 'd', claim: 'future', conceptKeys: ['c1'], predictedAt: '2026-09-14T00:00:00.000Z' }),
        ],
      }),
    })
    const records = await insightCalibrationService.resolvePending('u1', 'lp1', {
      opportunityAt: '2026-09-12T00:00:00.000Z',
      struggling: ['C1'],
      fragile: [],
    })
    const byId = Object.fromEntries(records.map((r) => [r.id, r.outcome]))
    expect(byId.a).toBe('hit')
    expect(byId.b).toBe('miss')
    expect(byId.c).toBe('unknown')
    expect(byId.d).toBe('pending')
  })

  it('无机会事件时不结算', async () => {
    findUnique.mockResolvedValue({
      payload: JSON.stringify({
        schemaVersion: 'learner-insight-records-v1', pathId: 'lp1',
        records: [record({ id: 'a', conceptKeys: ['c1'], predictedAt: '2026-09-10T00:00:00.000Z' })],
      }),
    })
    const records = await insightCalibrationService.resolvePending('u1', 'lp1', {
      opportunityAt: null, struggling: ['c1'], fragile: [],
    })
    expect(records[0].outcome).toBe('pending')
    expect(upsert).not.toHaveBeenCalled()
  })
})
