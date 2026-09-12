const findUnique = jest.fn()
const upsert = jest.fn()

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: { learner_projections: { findUnique, upsert } },
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
      output: { insights: [{ type: 'prerequisite_gap', claim: 'c', evidenceRefs: ['ev1'], confidence: 0.6, action: 'a' }], conceptAssessments: [], falsifiableClaims: [], narrative: 'n' },
    })
    const payload = await learnerStateReviewService.refresh('u1', 'lp1')
    expect(payload?.source).toBe('model')
    expect(payload?.diagnosis?.insights).toHaveLength(1)
    expect(payload?.diagnosis?.narrative).toBe('n')
  })

  it('LLM 失败时回退 source=rules 且 diagnosis=null', async () => {
    (executeSkillWithResult as jest.Mock).mockRejectedValue(new Error('boom'))
    const payload = await learnerStateReviewService.refresh('u1', 'lp1')
    expect(payload?.source).toBe('rules')
    expect(payload?.diagnosis).toBeNull()
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
})
