/**
 * R2 状态语义回归：管理台页头的「绿点」必须可信。
 *
 * 背景（ADMIN_PAGE_TEMPLATES.md §2 R2 状态语义色表）：ok 只表示「一切正常且无需行动」；
 * 失败必须落到 bad 并给出重试入口。以下两类假信号曾真实存在：
 *
 *  1) OpsHub 三个待办域用 .catch(() => count = 0)，后端故障时页面伪装成「全部已清零」——
 *     驾驶舱最不可接受的一种假信号，因为它恰好把「取不到」显示成「没事」。
 *  2) OpsCenter 用 `.is-bad` 作为告警类名，但该类全站零定义（页面 scoped 里也没有）→
 *     死信告警永远不标红（无效类名静默失效）。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const h = vi.hoisted(() => ({
  feedbackList: vi.fn(),
  contentStats: vi.fn(),
  outboxDead: vi.fn(),
}))

vi.mock('@/api/adminApi', () => ({
  adminFeedbackApi: { list: h.feedbackList },
  adminLearningContentApi: { getStats: h.contentStats },
  adminDevtoolsApi: { getOutboxDead: h.outboxDead },
  adminAxios: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))
vi.mock('../store', async () => {
  const { reactive } = await import('vue')
  return { intent: reactive({ scene: '', statusFilter: '', quickAction: '' }) }
})
vi.mock('../live', async () => {
  const { ref } = await import('vue')
  return {
    liveAnnouncements: ref([]),
    timeAgo: () => 'x',
    errMsg: (e: unknown) => (e instanceof Error ? e.message : String(e)),
    shortId: (s: string) => s,
  }
})
vi.mock('../opsShared', async () => {
  const { ref } = await import('vue')
  return {
    announcementCounts: ref({ rows: 0, published: 0, draft: 0, archived: 0 }),
    segmentPct: () => [],
  }
})
vi.mock('../useConfirm', () => ({ askConfirm: vi.fn(async () => true) }))
vi.mock('@/utils/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import OpsHub from '../OpsHub.vue'
import OpsCenter from '../OpsCenter.vue'

describe('R2：OpsHub 失败不得伪装成「已清零」', () => {
  beforeEach(() => {
    h.feedbackList.mockReset()
    h.contentStats.mockReset()
    h.outboxDead.mockReset()
  })

  it('三个待办域全部失败 → 页头降为 bad + 显式错误条 + 计数显示「—」与「加载失败」', async () => {
    h.feedbackList.mockRejectedValue(new Error('后端不可用'))
    h.contentStats.mockRejectedValue(new Error('后端不可用'))
    h.outboxDead.mockRejectedValue(new Error('后端不可用'))

    const w = mount(OpsHub)
    await flushPromises()

    // 页头基调降级（而非绿灯「一切正常」）
    expect(w.find('.mk-status').classes()).toContain('mk-status--bad')
    // 显式错误条（可重试的信号，而非静默）
    expect(w.find('.mk-alert').exists()).toBe(true)
    expect(w.text()).toContain('待办数据加载失败')
    // 三个失败域各自标记为失败态，且该行不得显示「已清零」
    // （第 4 行「草稿公告」取自 live 层，未失败 → 仍显示「已清零」是正确的）
    const failedRows = w.findAll('.ow-todo--failed')
    expect(failedRows).toHaveLength(3)
    for (const row of failedRows) {
      expect(row.text()).toContain('加载失败')
      expect(row.text()).not.toContain('已清零')
    }
    // 重试入口
    expect(w.find('.mk-status__action').text()).toContain('重试')

    w.unmount()
  })

  it('三个待办域成功且全为 0 → 页头 ok，显示「已清零」', async () => {
    h.feedbackList.mockResolvedValue({ data: { data: {}, pagination: { total: 0 } } })
    h.contentStats.mockResolvedValue({ data: { data: { byStatus: { failed: 0 } } } })
    h.outboxDead.mockResolvedValue({ data: { data: { deadCount: 0 } } })

    const w = mount(OpsHub)
    await flushPromises()

    expect(w.find('.mk-status').classes()).toContain('mk-status--ok')
    expect(w.find('.mk-alert').exists()).toBe(false)
    expect(w.text()).toContain('已清零')

    w.unmount()
  })
})

describe('R2：OpsCenter 死信告警使用已定义的状态条语义类', () => {
  beforeEach(() => {
    h.outboxDead.mockReset()
  })

  it('死信 > 0 → 计数使用 .mk-status__meta--bad（而非零定义的 .is-bad）', async () => {
    h.outboxDead.mockResolvedValue({ data: { data: { deadCount: 3, items: [] } } })

    const w = mount(OpsCenter)
    await flushPromises()

    expect(w.find('.mk-status__meta--bad').exists()).toBe(true)
    // 无效类名不得再出现（它曾让告警静默失效）
    expect(w.find('.is-bad').exists()).toBe(false)

    w.unmount()
  })
})
