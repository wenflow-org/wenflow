/**
 * #187 回归：learning-state 页的 copy 必须是**本视图**生成的。
 *
 * 病灶（修前）：本服务直接复用 dashboard 事件驱动快照的 copy，学习状态页于是拿到
 * dashboard 口径文案——headline 是「欢迎回来…」式问候、todayActions 里还有一条指回
 * 本页的「查看学习状态」自指深链（前端只能把它丢掉）。评审复核正是按这条判「没修好」。
 *
 * 本用例钉住新口径：调用 skill 时 view 必须是 'learning-state'（不是 dashboard）；
 * skill 抛错才回落**本视图**静态兜底；源码里不得再出现「读 dashboard 快照」的复用路径。
 */
import fs from 'node:fs'
import path from 'node:path'

jest.mock('../assemble-learning-state', () => ({ assembleLearningState: jest.fn() }))
jest.mock('../../../skills', () => ({ executeSkillWithResult: jest.fn() }))
jest.mock('../../../skills/adaptive-guidance-copy', () => ({
  adaptiveGuidanceCopyDefinition: { name: 'adaptive-guidance-copy' },
  buildFallback: jest.fn(),
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
import { executeSkillWithResult } from '../../../skills'
import { assembleLearningState } from '../assemble-learning-state'
import learningStateGuidanceService from '../LearningStateGuidanceService'

const LEARNING_STATE_COPY = {
  headline: '先看清当前状态，再决定下一步',
  subtitle: '结合最近趋势看节奏、负荷和掌握情况，再决定继续推进还是先调整。',
  todayActions: [
    { title: '查看当前路径', desc: '回到当前任务，确认状态影响的是哪一步。', action: '查看路径', to: 'path-detail' },
  ],
  pathHint: 'p',
  nextStep: 'n',
  paceHint: 'c',
  emptyStateCopy: '',
  warningCopy: '',
}

describe('LearningStateGuidanceService（#187 视图口径）', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(assembleLearningState as jest.Mock).mockResolvedValue({
      paths: [],
      sessions: [],
      primaryPath: { id: 'lp1', title: 'T' },
      learnerSnapshot: {},
      learningState: {},
      warnings: [],
      sessionWrapup: null,
    })
    ;(executeSkillWithResult as jest.Mock).mockResolvedValue({
      success: true,
      output: LEARNING_STATE_COPY,
      quality: 'model',
      cached: false,
      debug: { skillId: 'adaptive-guidance-copy', model: 'm', systemPromptVersion: 3, durationMs: 21 },
      duration: 21,
    })
    ;(buildFallback as jest.Mock).mockReturnValue({ headline: '先看清当前状态，再决定下一步', subtitle: 's' })
  })

  it('按本页视图生成：skill 入参 view=learning-state，copy 取自 skill 输出', async () => {
    const payload = await learningStateGuidanceService.refresh('u1')

    // 关键断言：view 不再是硬编码的 'dashboard'，也不再借用 dashboard 快照
    expect(executeSkillWithResult).toHaveBeenCalledTimes(1)
    const [definition, input] = (executeSkillWithResult as jest.Mock).mock.calls[0]
    expect((definition as any).name).toBe('adaptive-guidance-copy')
    expect(input.view).toBe('learning-state')
    expect(input.userId).toBe('u1')

    expect(payload?.view).toBe('learning-state')
    expect(payload?.copy).toEqual(LEARNING_STATE_COPY)
    expect(payload?.source).toBe('model')
    expect(payload?.debug?.systemPromptVersion).toBe(3)
    expect(payload?.review).toBeNull()
  })

  it('skill 抛错：回落本视图静态兜底（buildFallback 的 view=learning-state），source=fallback', async () => {
    (executeSkillWithResult as jest.Mock).mockRejectedValue(new Error('plugin disabled'))

    const payload = await learningStateGuidanceService.refresh('u2')

    expect(buildFallback).toHaveBeenCalledWith(expect.objectContaining({ view: 'learning-state' }))
    expect(payload?.copy).toEqual({ headline: '先看清当前状态，再决定下一步', subtitle: 's' })
    expect(payload?.source).toBe('fallback')
    expect(payload?.view).toBe('learning-state')
  })

  it('新学习者没有 learnerSnapshot：返回 null，不进入摘要/投影（避免 dynamicState 空引用）', async () => {
    (assembleLearningState as jest.Mock).mockResolvedValue({
      paths: [],
      sessions: [],
      primaryPath: null,
      learnerSnapshot: null,
      learningState: null,
      warnings: [],
      sessionWrapup: null,
    })

    await expect(learningStateGuidanceService.refresh('u-new')).resolves.toBeNull()
    expect(executeSkillWithResult).not.toHaveBeenCalled()
    expect(buildFallback).not.toHaveBeenCalled()
  })

  /**
   * 走查（2026-09-24）实测网关慢调用到过 113.9s > 前端 60s 超时：同步刷新会把已有建议整段
   * 吞掉、页面回落成"完成第一次学习后…"（对已有学习记录的学员是错误信息）。
   * 这里锁住口径：缓存过期时先给旧值，刷新转到后台。
   */
  it('缓存过期：先返回旧值并后台刷新（不被慢生成拖住）', async () => {
    // 只伪造 Date.now（不用 fake timers：后者会把被测链路上的真实定时器一起冻住）
    const nowSpy = jest.spyOn(Date, 'now')
    try {
      const first = await learningStateGuidanceService.get('u-swr')
      expect(first?.copy).toEqual(LEARNING_STATE_COPY)

      nowSpy.mockReturnValue(Date.now() + 16 * 60 * 1000)
      // 第二次生成挂住不返回：get 仍应立即给出旧值（不被慢生成拖住）
      let releaseSecond: () => void = () => {}
      ;(executeSkillWithResult as jest.Mock).mockImplementation(() => new Promise((resolve) => {
        releaseSecond = () => resolve({
          success: true,
          output: { ...LEARNING_STATE_COPY, headline: 'H2' },
          quality: 'model',
          cached: false,
          debug: {},
          duration: 5,
        })
      }))

      const second = await learningStateGuidanceService.get('u-swr')
      expect(second).toBe(first)

      // 放行后台那次 → 缓存被更新，下一次读拿到新值
      releaseSecond()
      await new Promise((r) => setTimeout(r, 0))
      const third = await learningStateGuidanceService.get('u-swr')
      expect(third?.copy).toEqual({ ...LEARNING_STATE_COPY, headline: 'H2' })
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('源码守卫：本服务不再引用 dashboard 快照（复用回退即 #187 复发的形状）', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../LearningStateGuidanceService.ts'), 'utf8')

    expect(source).not.toMatch(/dashboardGuidanceSnapshot/)
    // 生成入口必须把本视图的 view 传下去
    expect(source).toMatch(/view:\s*LEARNING_STATE_VIEW/)
  })
})
