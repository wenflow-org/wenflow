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
  return { timeAgo: () => 'x', liveAnnouncements: ref([]) }
})
vi.mock('../store', () => ({ intent: {} }))

import OpsHub from '../OpsHub.vue'

describe('运营中心：学习路径构成条（回归）', () => {
  it('仅一个非零状态：不渲染满格构成条，行式计数仍展示', async () => {
    h.stats = { byStatus: { active: 1, completed: 0, failed: 0, archived: 0 } }
    const w = mount(OpsHub)
    await flushPromises()

    expect(w.findAll('.ow-state__seg')).toHaveLength(0)
    expect(w.text()).toContain('学习中')
    expect(w.text()).toContain('暂无公告')

    w.unmount()
  })

  it('多个非零状态：渲染构成条', async () => {
    h.stats = { byStatus: { active: 1, completed: 1, failed: 0, archived: 0 } }
    const w = mount(OpsHub)
    await flushPromises()

    expect(w.findAll('.ow-state__seg').length).toBeGreaterThanOrEqual(1)

    w.unmount()
  })
})
