/**
 * 回归：运营中心「学习路径」构成条（审计 3.4 / 运营中心）
 * 单一状态时旧实现渲染成整条满格绿，被误读为进度条；修复后仅 ≥2 个非零状态才画构成条。
 */
import { describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const h = vi.hoisted(() => ({
  stats: { byStatus: { active: 1, completed: 0, failed: 0, archived: 0 } } as Record<string, unknown>,
}))

vi.mock('@/api/adminApi', () => ({
  adminFeedbackApi: { list: vi.fn(async () => ({ data: { data: { pagination: { total: 0 } } } })) },
  adminLearningContentApi: { getStats: vi.fn(async () => ({ data: { data: h.stats } })) },
  adminDevtoolsApi: { getOutboxDead: vi.fn(async () => ({ data: { data: { deadCount: 0 } } })) },
}))
vi.mock('../live', async () => {
  const { ref } = await import('vue')
  return { timeAgo: () => 'x', liveAnnouncements: ref([]), liveFailures: ref({}) }
})
vi.mock('../store', () => ({ intent: {} }))

import OpsHub from '../OpsHub.vue'
import MkStageband from '@/components/mk/MkStageband.vue'

describe('运营中心：学习路径构成条（回归）', () => {
  it('仅一个非零状态：不渲染满格构成条，行式计数仍展示', async () => {
    h.stats = { byStatus: { active: 1, completed: 0, failed: 0, archived: 0 } }
    const w = mount(OpsHub)
    await flushPromises()

    // 断言改为组件计数（2026-10-04 收编 MkStageband 后类名不再是契约）
    expect(w.findAllComponents(MkStageband)).toHaveLength(0)
    expect(w.text()).toContain('学习中')
    expect(w.text()).toContain('暂无公告')

    w.unmount()
  })

  it('多个非零状态：渲染构成条', async () => {
    h.stats = { byStatus: { active: 1, completed: 1, failed: 0, archived: 0 } }
    const w = mount(OpsHub)
    await flushPromises()

    expect(w.findAllComponents(MkStageband).length).toBeGreaterThanOrEqual(1)
    // 段色走全站语义色 token：archived 槽位是 muted→--mk-faint
    // （收编前自搓类写死 #c3cbda / 暗色 #404244，本断言防硬编码回流）
    const segs = w.findAll('.stageband > span').map((s) => s.attributes('style') ?? '')
    expect(segs.join(' ')).toContain('var(--mk-green)') // active → ok
    expect(segs.join(' ')).toContain('var(--mk-blue)') // completed → info
    expect(segs.join(' ')).toContain('var(--mk-faint)') // archived → muted
    expect(segs.join(' ')).not.toMatch(/#[0-9a-f]{6}/i)

    w.unmount()
  })
})
