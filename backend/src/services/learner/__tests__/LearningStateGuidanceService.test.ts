jest.mock('../../../skills', () => ({ executeSkillWithResult: jest.fn() }))
jest.mock('../../../skills/adaptive-guidance-copy', () => ({
  adaptiveGuidanceCopyDefinition: { name: 'adaptive-guidance-copy' },
}))
jest.mock('../assemble-learning-state', () => ({ assembleLearningState: jest.fn() }))
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

import { executeSkillWithResult } from '../../../skills'
import { assembleLearningState } from '../assemble-learning-state'
import learningStateGuidanceService from '../LearningStateGuidanceService'

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
    ;(executeSkillWithResult as jest.Mock).mockResolvedValue({
      success: true,
      output: { headline: 'H', subtitle: 's' },
      quality: 'fallback',
      debug: { durationMs: 3 },
      duration: 3,
    })
  })

  it('把 skill 输出写入 copy，并按 quality 映射 source（回归防护）', async () => {
    const payload = await learningStateGuidanceService.refresh('u1')

    expect(executeSkillWithResult).toHaveBeenCalledTimes(1)
    expect(payload?.copy).toEqual({ headline: 'H', subtitle: 's' })
    expect(payload?.source).toBe('fallback')
    expect(payload?.review).toBeNull()
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
      expect(first?.copy).toEqual({ headline: 'H', subtitle: 's' })
      expect(executeSkillWithResult).toHaveBeenCalledTimes(1)

      nowSpy.mockReturnValue(Date.now() + 16 * 60 * 1000)
      // 第二次生成挂住不返回：get 仍应立即给出旧值（不被慢生成拖住）
      let releaseSecond: () => void = () => {}
      ;(executeSkillWithResult as jest.Mock).mockImplementation(() => new Promise((resolve) => {
        releaseSecond = () => resolve({
          success: true,
          output: { headline: 'H2', subtitle: 's2' },
          quality: 'model',
          debug: { durationMs: 1 },
          duration: 1,
        })
      }))

      const second = await learningStateGuidanceService.get('u-swr')
      expect(second).toBe(first)
      expect(executeSkillWithResult).toHaveBeenCalledTimes(2) // 后台确实发起了刷新

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
