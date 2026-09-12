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
  updateBelief,
  conceptBeliefService,
  beliefProjectionKey,
  DEFAULT_BKT_PARAMS,
} from '../concept-belief.service'

describe('concept-belief.service (BKT, 零训练)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    upsert.mockResolvedValue({})
  })

  it('观测为“对”时 pKnowL 上升；为“错”时下降', () => {
    const up = updateBelief(0.3, true)
    const down = updateBelief(0.3, false)
    expect(up).toBeGreaterThan(0.3)
    expect(down).toBeLessThan(0.3)
    expect(up).toBeLessThanOrEqual(1)
    expect(down).toBeGreaterThanOrEqual(0)
  })

  it('重复“对”逐步收敛到高位，且不超过 1', () => {
    let p = DEFAULT_BKT_PARAMS.pL0
    for (let i = 0; i < 20; i += 1) p = updateBelief(p, true)
    expect(p).toBeGreaterThan(0.9)
    expect(p).toBeLessThanOrEqual(1)
  })

  it('applyObservations 用 pL0 初始化新概念并落库', async () => {
    findUnique.mockResolvedValue(null)
    const payload = await conceptBeliefService.applyObservations('u1', 'lp1', [
      { conceptKey: 'c1', observed: true },
      { conceptKey: 'c2', observed: false },
    ])
    expect(payload?.beliefs.c1.pKnowL).toBeGreaterThan(DEFAULT_BKT_PARAMS.pL0)
    expect(payload?.beliefs.c2.pKnowL).toBeLessThanOrEqual(DEFAULT_BKT_PARAMS.pL0)
    expect(payload?.beliefs.c1.observations).toBe(1)
    const call = upsert.mock.calls.at(-1)![0]
    expect(call.where.projectionKey).toBe(beliefProjectionKey('u1', 'lp1'))
    expect(call.create.scope).toBe('beliefs')
  })

  it('读取已有信念后在其上继续更新', async () => {
    findUnique.mockResolvedValue({
      payload: JSON.stringify({ schemaVersion: 'learner-concept-beliefs-v1', pathId: 'lp1', params: DEFAULT_BKT_PARAMS, beliefs: { c1: { pKnowL: 0.8, observations: 3, lastObservedAt: '' } } }),
    })
    const payload = await conceptBeliefService.applyObservations('u1', 'lp1', [{ conceptKey: 'c1', observed: false }])
    expect(payload?.beliefs.c1.observations).toBe(4)
    expect(payload?.beliefs.c1.pKnowL).toBeLessThan(0.8)
  })
})
