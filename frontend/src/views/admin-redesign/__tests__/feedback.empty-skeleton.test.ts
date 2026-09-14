/**
 * 回归：反馈中心空数据时保留页面骨架（审计 3.1）
 * 旧实现把整张列表卡（含筛选条）放在 `v-else` 里，零数据时筛选条随表格一起消失。
 * 修复后卡片/筛选条恒定渲染，空态落在卡片内。
 */
import { describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const h = vi.hoisted(() => ({
  list: vi.fn(async () => ({ data: { data: [], pagination: { total: 0 } } })),
  trend: vi.fn(async () => ({ data: { data: [] } })),
}))

vi.mock('@/api/adminApi', () => ({
  adminFeedbackApi: {
    list: h.list,
    getTrend: h.trend,
    getDetail: vi.fn(),
    update: vi.fn(),
  },
}))
vi.mock('../store', async () => {
  const { ref } = await import('vue')
  return { isLive: ref(true) }
})
vi.mock('../live', () => ({
  errMsg: (e: unknown) => String(e),
  timeAgo: () => 'x',
  isPageCacheFresh: () => false,
  markPageFetched: vi.fn(),
}))
vi.mock('../useEscape', () => ({ useEscape: vi.fn() }))
vi.mock('../useOverlay', () => ({ useOverlay: vi.fn(), useMaskClose: vi.fn() }))
vi.mock('@/utils/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import Feedback from '../Feedback.vue'

describe('反馈中心：空数据保留骨架（回归）', () => {
  it('零数据时筛选条（卡片头）仍渲染，空态在卡片内', async () => {
    const w = mount(Feedback)
    await flushPromises()

    expect(w.find('.mk-card__head').exists()).toBe(true)
    expect(w.find('.mk-card__head .mk-filter').exists()).toBe(true)
    expect(w.find('.mk-empty').exists()).toBe(true)
    expect(w.text()).toContain('暂无反馈')

    w.unmount()
  })
})
