jest.mock('../assemble-learning-state', () => ({ assembleLearningState: jest.fn() }))
jest.mock('../../../skills/adaptive-guidance-copy', () => ({
  adaptiveGuidanceCopyDefinition: { name: 'adaptive-guidance-copy' },
  buildFallback: jest.fn(),
}))
jest.mock('../DashboardGuidanceSnapshotService', () => ({
  dashboardGuidanceSnapshotService: { get: jest.fn(async () => null) },
}))
jest.mock('../LearnerStateReviewService', () => ({
  learnerStateReviewService: { getLatest: jest.fn(async () => null) },
}))
jest.mock('../LearnerStateSummaryService', () => ({
  learnerStateSummaryService: { build: jest.fn(() => ({ state: 'ok' })) },
}))
jest.mock('../LearningDecisionFeedService', () => ({
  learningDecisionFeedService: { build: jest.fn(() => []) },
}))
jest.mock('../../../utils/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

import { buildFallback } from '../../../skills/adaptive-guidance-copy'
import { dashboardGuidanceSnapshotService } from '../DashboardGuidanceSnapshotService'
import { assembleLearningState } from '../assemble-learning-state'
import learningStateGuidanceService from '../LearningStateGuidanceService'

/**
 * 2026-09-27 行动建议统一口径：learning-state 不再独立跑 skill（此前与 dashboard
 * 同 skill 两份生成，两页建议重叠且措辞不一），copy 一律复用 dashboard 事件驱动快照；
 * 快照缺失时回落 learning-state 静态文案（buildFallback，不新增 LLM 调用）。
 */
describe('LearningStateGuidanceService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(assembleLearningState as jest.Mock).mockResolvedValue({
      paths: [],
      sessions: [],
      primaryPath: { id: 'lp1' },
      learnerSnapshot: {},
      learningState: {},
      warnings: [],
      sessionWrapup: null,
    })
    ;(dashboardGuidanceSnapshotService.get as jest.Mock).mockResolvedValue(null)
    ;(buildFallback as jest.Mock).mockReturnValue({ headline: '先看清当前状态，再决定下一步', subtitle: 's' })
  })

  it('快照有 copy：原样透传，source 透传快照来源', async () => {
    ;(dashboardGuidanceSnapshotService.get as jest.Mock).mockResolvedValue({
      copy: { headline: 'H', subtitle: 's' },
      source: 'model',
    })
    const payload = await learningStateGuidanceService.refresh('u1')

    expect(dashboardGuidanceSnapshotService.get).toHaveBeenCalledWith('u1')
    expect(payload?.copy).toEqual({ headline: 'H', subtitle: 's' })
    expect(payload?.source).toBe('model')
    expect(payload?.review).toBeNull()
  })

  it('快照缺失：回落 learning-state 静态文案（buildFallback，source=fallback）', async () => {
    const payload = await learningStateGuidanceService.refresh('u2')

    expect(buildFallback).toHaveBeenCalledWith(expect.objectContaining({ view: 'learning-state' }))
    expect(payload?.copy).toEqual({ headline: '先看清当前状态，再决定下一步', subtitle: 's' })
    expect(payload?.source).toBe('fallback')
  })

  /**
   * 走查（2026-09-24）实测网关慢调用到过 113.9s > 前端 60s 超时：同步刷新会把已有建议整段
   * 吞掉、页面回落成"完成第一次学习后…"（对已有学习记录的学员是错误信息）。
   * 这里锁住新口径：缓存过期时先给旧值，刷新转到后台。
   */
  it('缓存过期：先返回旧值并后台刷新（不被慢生成拖住）', async () => {
    // 只伪造 Date.now（不用 fake timers：后者会把被测链路上的真实定时器一起冻住）
    const nowSpy = jest.spyOn(Date, 'now')
    try {
      const first = await learningStateGuidanceService.get('u-swr')
      expect(first?.copy).toEqual({ headline: '先看清当前状态，再决定下一步', subtitle: 's' })

      nowSpy.mockReturnValue(Date.now() + 16 * 60 * 1000)
      // 第二次生成挂住不返回：get 仍应立即给出旧值（不被慢生成拖住）
      let releaseSecond: () => void = () => {}
      ;(dashboardGuidanceSnapshotService.get as jest.Mock).mockImplementation(() => new Promise((resolve) => {
        releaseSecond = () => resolve({ copy: { headline: 'H2', subtitle: 's2' }, source: 'model' })
      }))

      const second = await learningStateGuidanceService.get('u-swr')
      expect(second).toBe(first)

      // 放行后台那次 → 缓存被更新，下一次读拿到新值
      releaseSecond()
      await new Promise((r) => setTimeout(r, 0))
      const third = await learningStateGuidanceService.get('u-swr')
      expect(third?.copy).toEqual({ headline: 'H2', subtitle: 's2' })
    } finally {
      nowSpy.mockRestore()
    }
  })
})
