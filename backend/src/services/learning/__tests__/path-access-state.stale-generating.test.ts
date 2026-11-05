/**
 * #238：路径 status 永久卡在 generating（core 被 stageDesign 抢占后的复位缺口）。
 *
 * 判例（第四轮真实测评）：POST /paths/:id/regenerate 被受理后 1.5s 内再 POST /paths/:id/replan，
 * 认领 stageDesign run 时把仍在 generating 的 core run 置 cancelled/SUPERSEDED，而被抢占的
 * core 之后必然撞 GENERATION_RUN_FENCED 不再写回 active → 行永久卡在 generating。
 * 症状：无法开课（409 PATH_NOT_STARTABLE）、generation-status 说 ready 而路径说 generating、
 * PATCH /retry 500。
 *
 * 这里锁住三条复位口径：准入判定与 lifecycle 同源、失败收尾只复位 generating、reaper 可命中。
 */
import { getPathLearningAccessState } from '../queries/path-views.queries'

const READY_TEMPLATE = JSON.stringify({
  _generation: { core: 'succeeded', stageDesign: 'succeeded' }
})

const succeededStageRun = {
  id: 'pgr-stage',
  phase: 'stageDesign',
  status: 'succeeded',
  retryAllowed: false
} as any

describe('#238 卡住的 generating 路径的准入判定', () => {
  it('stageDesign run 已成功且任务已落库 → 陈旧 generating 不再挡开课', () => {
    const state = getPathLearningAccessState('generating', READY_TEMPLATE, succeededStageRun, true, 12)
    expect(state.canStartLearning).toBe(true)
    expect(state.learningBlockedReason).toBeNull()
  })

  it('stageDesign run 已成功但一个任务都没有 → 仍拦下（残迹不等于可用）', () => {
    const state = getPathLearningAccessState('generating', READY_TEMPLATE, succeededStageRun, true, 0)
    expect(state.canStartLearning).toBe(false)
    expect(state.learningBlockedReason).toContain('仍在生成中')
  })

  it('stageDesign run 仍在处理中 → 正常拦下（未误伤在途生成）', () => {
    const processingRun = { ...succeededStageRun, status: 'processing' } as any
    const state = getPathLearningAccessState(
      'generating',
      JSON.stringify({ _generation: { core: 'succeeded', stageDesign: 'processing' } }),
      processingRun,
      true,
      12
    )
    expect(state.canStartLearning).toBe(false)
    expect(state.learningBlockedReason).toContain('仍在生成中')
  })

  it('archived 优先级最高：即使 stageDesign 已成功也不可学', () => {
    const state = getPathLearningAccessState('archived', READY_TEMPLATE, succeededStageRun, true, 12)
    expect(state.canStartLearning).toBe(false)
    expect(state.learningBlockedReason).toContain('已下线')
  })

  it('failed 仍是 failed（复位口径只针对 generating）', () => {
    const state = getPathLearningAccessState('failed', READY_TEMPLATE, succeededStageRun, true, 12)
    expect(state.canStartLearning).toBe(false)
    expect(state.learningBlockedReason).toContain('生成失败')
  })
})
