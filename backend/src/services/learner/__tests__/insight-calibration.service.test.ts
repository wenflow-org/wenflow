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
  evaluateClaimExpectation,
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

  // 2026-11-21 可证伪断言核销台账（此前 checkOn/expect 全仓零消费）
  describe('falsifiable_claim 结算（expect 方向感知）', () => {
    it('evaluateClaimExpectation：正向期望要概念已稳才命中，默认（风险预告）要仍不稳才命中', () => {
      // 正向：「已能独立完成」→ 概念已稳（仍不稳=false）才算命中
      expect(evaluateClaimExpectation('已能独立完成', false)).toBe(true)
      expect(evaluateClaimExpectation('已能独立完成', true)).toBe(false)
      expect(evaluateClaimExpectation('不再卡壳', false)).toBe(true)
      // 默认/风险预告：「仍不稳」「下次还卡」→ 概念仍不稳才算命中
      expect(evaluateClaimExpectation('仍不稳', true)).toBe(true)
      expect(evaluateClaimExpectation('仍不稳', false)).toBe(false)
      expect(evaluateClaimExpectation(undefined, true)).toBe(true)
    })

    it('recordInsights 落 checkOn/expect，结算按 expect 方向判定', async () => {
      findUnique.mockResolvedValue(null)
      await insightCalibrationService.recordInsights('u1', 'lp1', [
        {
          claim: '下次课 X 应已能独立完成',
          insightType: 'falsifiable_claim',
          conceptKeys: ['x1'],
          predictedAt: '2026-09-10T00:00:00.000Z',
          checkOn: 'next_lesson',
          expect: '已能独立完成',
        },
      ])
      const saved = JSON.parse(upsert.mock.calls.at(-1)![0].create.payload)
      expect(saved.records[0].checkOn).toBe('next_lesson')
      expect(saved.records[0].expect).toBe('已能独立完成')

      // 机会到达、概念已稳 → 正向期望命中
      findUnique.mockResolvedValue({ payload: upsert.mock.calls.at(-1)![0].create.payload })
      const records = await insightCalibrationService.resolvePending('u1', 'lp1', {
        opportunityAt: '2026-09-12T00:00:00.000Z',
        struggling: [],
        fragile: [],
      })
      expect(records[0].outcome).toBe('hit')
    })

    it('getReliability 支持 onlyInsightTypes（claims 命中率单独成列）', async () => {
      findUnique.mockResolvedValue({
        payload: JSON.stringify({
          schemaVersion: 'learner-insight-records-v1', pathId: 'lp1',
          records: [
            record({ id: 'a', insightType: 'falsifiable_claim', outcome: 'hit' }),
            record({ id: 'b', insightType: 'falsifiable_claim', outcome: 'miss' }),
            record({ id: 'c', insightType: 'fatigue', outcome: 'hit' }),
            record({ id: 'd', insightType: 'fatigue', outcome: 'hit' }),
            record({ id: 'e', insightType: 'fatigue', outcome: 'hit' }),
            record({ id: 'f', insightType: 'fatigue', outcome: 'hit' }),
            record({ id: 'g', insightType: 'fatigue', outcome: 'miss' }),
          ],
        }),
      })
      const claims = await insightCalibrationService.getReliability('u1', 'lp1', { onlyInsightTypes: ['falsifiable_claim'] })
      expect(claims.n).toBe(2)
      expect(claims.hitRate).toBeNull() // n=2 < 5
      const insights = await insightCalibrationService.getReliability('u1', 'lp1', { onlyInsightTypes: ['fatigue'] })
      expect(insights.n).toBe(5)
      expect(insights.hitRate).toBeCloseTo(4 / 5)
    })
  })
})
