/**
 * #41（2026-10-20）：stateLevel 的 recover 判定必须经过 classifyLoad.imbalanced 门。
 *
 * 旧实现是裸 `metrics.lsb < 0 ? 'recover'`：PMC 冷启动（ktl 未成熟）时 lf 天然略高于 ktl，
 * 新学习者第一节课就会被判 recover，下游 LearningDecisionFeedService 固定产出
 * 「近 7 天疲劳度持续高于健康度」的伪疲劳断言。
 */
import { learnerStateSummaryService } from '../LearnerStateSummaryService'

function snapshotOf(metrics: { ktl: number; lf: number; lsb: number }) {
  return {
    dynamicState: {
      metrics,
      fatigueRisk: 'low' as const,
      recentTrend: 'stable' as const,
      recommendedPacing: 'moderate' as const
    },
    knowledgeMemory: {
      globalSignals: { fragileConcepts: [], strugglingConcepts: [] },
      currentPath: null
    }
  } as unknown as Parameters<typeof learnerStateSummaryService.build>[0]['learnerSnapshot']
}

describe('LearnerStateSummaryService（#41 冷启动门）', () => {
  it('冷启动 lsb<0 但基座未成熟：不判 recover', () => {
    // 实测 RVTEST-1016-1：ktl=0.1 / lf=0.326 / lsb=-0.226
    const out = learnerStateSummaryService.build({
      learnerSnapshot: snapshotOf({ ktl: 0.1, lf: 0.326, lsb: -0.226 })
    })
    expect(out.global.stateLevel).toBe('caution')
    expect(out.global.primaryAction).toBe('create-goal')
  })

  it('基座成熟且 form<0：仍判 recover', () => {
    const out = learnerStateSummaryService.build({
      learnerSnapshot: snapshotOf({ ktl: 5, lf: 7, lsb: -2 })
    })
    expect(out.global.stateLevel).toBe('recover')
    expect(out.global.primaryAction).toBe('learning-state')
  })

  it('健康/强势分带保持既有口径', () => {
    expect(learnerStateSummaryService.build({ learnerSnapshot: snapshotOf({ ktl: 5, lf: 4, lsb: 1 }) }).global.stateLevel).toBe('caution')
    expect(learnerStateSummaryService.build({ learnerSnapshot: snapshotOf({ ktl: 6, lf: 4, lsb: 2 }) }).global.stateLevel).toBe('balanced')
    expect(learnerStateSummaryService.build({ learnerSnapshot: snapshotOf({ ktl: 6, lf: 1, lsb: 5 }) }).global.stateLevel).toBe('strong')
  })
})
