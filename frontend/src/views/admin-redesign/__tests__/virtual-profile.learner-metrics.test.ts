/**
 * 虚拟学习者画像「学习状态读数」卡的数据接线（2026-10-20 跑数时发现）。
 *
 * 画像详情接口不返回 LSS/KTL/LF/LSB（只有会话的模拟器 learnerState，字段完全不同），
 * 卡里此前恒为空态，即便课程已经跑完。现改为按绑定账号取学习者模型的
 * dynamicState.lessonMetrics（单次会话快照），取样时刻取 freshness.generatedAt。
 */
import { describe, expect, it } from 'vitest'
import Source from '../VirtualProfile.vue?raw'

describe('VirtualProfile · 学习状态读数接线', () => {
  it('读数取自绑定账号学习者模型的单次会话快照，而不是画像详情里的 sessions[].learnerState', () => {
    expect(Source).toContain('adminLearnerModelsApi.getDetail(boundUserId, { includeTest: true })')
    expect(Source).toContain('ds.lessonMetrics || ds.metrics')
    expect(Source).toContain('learnerMetricsAt.value')
  })

  it('取样时刻进口径标签（单次会话 · 取样 …）', () => {
    expect(Source).toContain("loadCaliber('session-snapshot', learnerMetricsAt.value)")
  })

  it('取不到读数时只留空态，不阻断画像主体加载', () => {
    expect(Source).toContain('读数取不到就保持空态')
  })
})
