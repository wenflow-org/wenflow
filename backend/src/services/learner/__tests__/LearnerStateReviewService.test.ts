const findUnique = jest.fn()
const upsert = jest.fn()
const learnerEvidenceFindMany = jest.fn()

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: { learner_projections: { findUnique, upsert }, learner_evidence: { findMany: learnerEvidenceFindMany } },
}))
jest.mock('../../background-task-tracker.service', () => ({ runBackgroundTask: jest.fn() }))
jest.mock('../assemble-learning-state', () => ({ assembleLearningState: jest.fn() }))
jest.mock('../LearnerStateSummaryService', () => ({
  learnerStateSummaryService: { build: jest.fn(() => ({ global: { stateLevel: 'balanced' } })) },
}))
jest.mock('../LearningDecisionFeedService', () => ({
  learningDecisionFeedService: { build: jest.fn(() => [{ id: 'concept-watch', kind: 'concept-watch' }]) },
}))
jest.mock('../../../skills', () => ({
  executeSkillWithResult: jest.fn(),
  auxSkillDefinitionMap: { 'learner-state-review': { name: 'learner-state-review' } },
}))
jest.mock('../../../utils/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

import { executeSkillWithResult } from '../../../skills'
import { assembleLearningState } from '../assemble-learning-state'
import { learnerStateReviewService, reviewProjectionKey } from '../LearnerStateReviewService'

describe('LearnerStateReviewService (Slice 2a)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(assembleLearningState as jest.Mock).mockResolvedValue({
      primaryPath: { id: 'lp1', title: 'T' },
      paths: [{ id: 'lp1' }],
      sessions: [],
      learnerSnapshot: {
        dynamicState: { metrics: { lss: 4, ktl: 5, lf: 3, lsb: 1 }, recentTrend: 'stable', fatigueRisk: 'low', recommendedPacing: 'moderate' },
        knowledgeMemory: {
          globalSignals: { masteredConcepts: ['a'], fragileConcepts: ['b'], strugglingConcepts: [] },
          currentPath: { learningPathId: 'lp1', pathTitle: 'T', progress: {}, currentPosition: {}, prerequisiteGaps: [] },
        },
      },
      learningState: {},
      warnings: [],
    })
    upsert.mockResolvedValue({})
    learnerEvidenceFindMany.mockResolvedValue([])
    ;(executeSkillWithResult as jest.Mock).mockResolvedValue({ success: true, output: { insights: [], conceptAssessments: [], falsifiableClaims: [], narrative: '' } })
  })

  it('refresh 生成评审载荷（含投影/摘要/洞察）并落库', async () => {
    const payload = await learnerStateReviewService.refresh('u1', 'lp1')

    expect(payload?.schemaVersion).toBe('learner-state-review-v1')
    expect(payload?.source).toBe('rules')
    expect(payload?.pathId).toBe('lp1')
    expect(payload?.insights).toEqual([{ id: 'concept-watch', kind: 'concept-watch' }])
    // 投影携带状态摘要与知识线索
    expect(payload?.projection.learnerDigest.metrics.ktl).toBe(5)
    expect(payload?.projection.knowledgeDigest.fragile).toEqual(['b'])

    const call = upsert.mock.calls.at(-1)![0]
    expect(call.where.projectionKey).toBe(reviewProjectionKey('u1', 'lp1'))
    expect(call.create.scope).toBe('review')
    const saved = JSON.parse(call.create.payload)
    expect(saved.insights).toHaveLength(1)
  })

  it('LLM 产出诊断时 source=model 并写 diagnosis', async () => {
    (executeSkillWithResult as jest.Mock).mockResolvedValue({
      success: true,
      output: { insights: [{ type: 'prerequisite_gap', claim: 'c', evidenceRefs: ['ev1'], confidence: 0.6, action: 'a' }], conceptAssessments: [{ conceptKey: 'c1', observed: 'mastered', masteryBand: 'high', rationale: '', evidenceRefs: [] }], falsifiableClaims: [], narrative: 'n' },
    })
    findUnique.mockResolvedValue(null)
    const payload = await learnerStateReviewService.refresh('u1', 'lp1')
    expect(payload?.source).toBe('model')
    expect(payload?.diagnosis?.insights).toHaveLength(1)
    expect(payload?.diagnosis?.narrative).toBe('n')
    // 3a：诊断观测驱动 BKT 信念
    expect(payload?.beliefs?.c1).toBeGreaterThan(0.3)
  })

  it('LLM 失败时回退 source=rules 且 diagnosis=null', async () => {
    (executeSkillWithResult as jest.Mock).mockRejectedValue(new Error('boom'))
    const payload = await learnerStateReviewService.refresh('u1', 'lp1')
    expect(payload?.source).toBe('rules')
    expect(payload?.diagnosis).toBeNull()
  })

  it('上一轮洞察回注 priorInsights（回归 §3.19 P0④：此前硬编码 []）', async () => {
    // 上一次评审的载荷（含 2 条洞察，按 confidence 降序应保留顺序）
    findUnique.mockResolvedValue({
      payload: JSON.stringify({
        diagnosis: {
          insights: [
            { type: 'prerequisite_gap', claim: 'old-claim-low', action: 'a1', confidence: 0.4 },
            { type: 'strategy_fit', claim: 'old-claim-high', action: 'a2', confidence: 0.9 },
          ],
        },
      }),
    })
    await learnerStateReviewService.refresh('u1', 'lp1')

    const input = (executeSkillWithResult as jest.Mock).mock.calls.at(-1)![1] as {
      priorInsights: Array<{ type: string; claim: string; action: string }>
    }
    expect(input.priorInsights.map((item) => item.claim)).toEqual(['old-claim-high', 'old-claim-low'])
    // 只出 type/claim/action（不外泄 confidence/evidenceRefs 等内部字段）
    expect(Object.keys(input.priorInsights[0]).sort()).toEqual(['action', 'claim', 'type'])
  })

  it('getLatest 解析已存储载荷', async () => {
    findUnique.mockResolvedValue({ payload: JSON.stringify({ schemaVersion: 'learner-state-review-v1', insights: [] }) })
    const latest = await learnerStateReviewService.getLatest('u1', 'lp1')
    expect(latest?.schemaVersion).toBe('learner-state-review-v1')
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { projectionKey: reviewProjectionKey('u1', 'lp1') },
    }))
  })

  it('无 active 路径时不产出', async () => {
    (assembleLearningState as jest.Mock).mockResolvedValue({ primaryPath: null })
    const payload = await learnerStateReviewService.refresh('u1')
    expect(payload).toBeNull()
    expect(upsert).not.toHaveBeenCalled()
  })

  describe('Q7 真值发现接线', () => {
    function mockDiagnosis() {
      (executeSkillWithResult as jest.Mock).mockResolvedValue({
        success: true,
        output: {
          insights: [],
          conceptAssessments: [{ conceptKey: 'c1', observed: 'mastered', masteryBand: 'high', rationale: '', evidenceRefs: [] }],
          falsifiableClaims: [],
          narrative: 'n',
        },
      })
    }

    it('代码裁决锚题与 LLM 冲突时以代码为准，并把来源拆解落进评审载荷', async () => {
      mockDiagnosis()
      findUnique.mockResolvedValue(null)
      learnerEvidenceFindMany.mockResolvedValue([
        { payload: JSON.stringify({ conceptKey: 'c1', passed: false }), confidence: 0.95 },
      ])
      const payload = await learnerStateReviewService.refresh('u1', 'lp1')

      expect(learnerEvidenceFindMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ userId: 'u1', pathId: 'lp1', evidenceType: 'anchor:result' }),
      }))
      const audit = payload?.truthDiscovery?.[0]
      expect(audit?.observed).toBe(false)
      expect(audit?.dominantSource).toBe('code_judged')
      expect(audit?.sourceStatus.code_judged).toBe('ok')
      // 落库载荷带留痕（可审计）
      const saved = JSON.parse(upsert.mock.calls.at(-1)![0].create.payload)
      expect(saved.truthDiscovery[0].dominantSource).toBe('code_judged')
      expect(saved.truthDiscovery[0].contributions).toHaveLength(2)
    })

    it('单一来源（仅 LLM）行为不变：判掌握，代码源标 missing', async () => {
      mockDiagnosis()
      findUnique.mockResolvedValue(null)
      learnerEvidenceFindMany.mockResolvedValue([])
      const payload = await learnerStateReviewService.refresh('u1', 'lp1')

      const audit = payload?.truthDiscovery?.[0]
      expect(audit?.value).toBe(1)
      expect(audit?.observed).toBe(true)
      expect(audit?.sourceStatus.code_judged).toBe('missing')
      expect(payload?.beliefs?.c1).toBeGreaterThan(0.3)
    })

    it('代码证据读取失败：结构化打标 read_failed，不静默降级', async () => {
      mockDiagnosis()
      findUnique.mockResolvedValue(null)
      learnerEvidenceFindMany.mockRejectedValue(new Error('db down'))
      const payload = await learnerStateReviewService.refresh('u1', 'lp1')

      const audit = payload?.truthDiscovery?.[0]
      expect(audit?.sourceStatus.code_judged).toBe('read_failed')
      // 读取失败不阻断 LLM 单源观测
      expect(audit?.observed).toBe(true)
    })
  })
})
