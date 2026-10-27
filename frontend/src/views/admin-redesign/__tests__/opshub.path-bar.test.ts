/**
 * 运营中心「运营待办」页签：数字单源 + 读数卡即入口（2026-10-26）。
 *
 * 历史：本文件原锁「学习路径构成条只在 ≥2 个非零状态时渲染」（审计 3.4）。
 * 2026-10-26 评审：路径 / 公告两张状态卡的数字与页级读数带同源（生成失败路径、草稿公告各出现两次），
 * 空态时又各占一张卡只说「暂无」，公告域加载失败还会与读数卡的「加载失败」自相矛盾——两卡撤除。
 * 现在守四件事：
 *  1) 页签内不再有状态卡/待办清单（同一事实只讲一次）；
 *  2) 四张读数卡在页级、卡本身可点（失败域除外）；
 *  3) 生效中公告行落到「生效中」筛选，跨页签的 ?status= 不带走；
 *  4) 页签角标只出数（未访问不出角标）。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'

const h = vi.hoisted(() => ({
  stats: { byStatus: { active: 1, completed: 0, failed: 0, archived: 0 } } as Record<string, unknown>,
  announcements: [] as Array<Record<string, unknown>>,
  liveFailures: {} as Record<string, string>,
}))

vi.mock('@/api/adminApi', () => ({
  adminFeedbackApi: { list: vi.fn(async () => ({ data: { data: { pagination: { total: 0 } } } })) },
  adminLearningContentApi: { getStats: vi.fn(async () => ({ data: { data: h.stats } })) },
  adminDevtoolsApi: { getOutboxDead: vi.fn(async () => ({ data: { data: { deadCount: 0 } } })) },
}))
vi.mock('../live', async () => {
  const { ref } = await import('vue')
  const liveAnnouncements = ref<Array<Record<string, unknown>>>([])
  const liveFailures = ref<Record<string, string>>({})
  return {
    timeAgo: () => 'x',
    liveAnnouncements,
    liveFailures,
    liveLoading: ref(false),
    liveRefreshSeq: ref(0),
    loadLiveData: vi.fn(async () => {}),
    errMsg: (e: unknown) => String(e),
    liveCreateAnnouncement: vi.fn(async () => {}),
    liveUpdateAnnouncement: vi.fn(async () => {}),
    livePublishAnnouncement: vi.fn(async () => {}),
    liveArchiveAnnouncement: vi.fn(async () => {}),
    liveDeleteAnnouncement: vi.fn(async () => {}),
    totalPagesOf: (total: number, pageSize: number) => Math.max(1, Math.ceil(total / Math.max(1, pageSize))),
    isPageCacheFresh: () => false,
    markPageFetched: vi.fn(),
  }
})
vi.mock('../store', async () => {
  const { ref } = await import('vue')
  return { intent: {}, dataSource: ref('live'), isLive: ref(true) }
})

import OpsHub from '../OpsHub.vue'
import { liveAnnouncements, liveFailures } from '../live'

beforeEach(() => {
  h.stats = { byStatus: { active: 1, completed: 0, failed: 0, archived: 0 } }
  liveAnnouncements.value = []
  liveFailures.value = {}
})

describe('运营中心：运营待办页签只留行动清单', () => {
  it('路径 / 公告状态卡已撤：页签内没有构成条，也没有「暂无学习路径 / 暂无公告」的重复空态', async () => {
    h.stats = { byStatus: { active: 1, completed: 0, failed: 0, archived: 0 } }
    const w = mount(OpsHub)
    await flushPromises()

    expect(w.find('.stageband').exists()).toBe(false)
    expect(w.text()).not.toContain('暂无学习路径')
    expect(w.text()).not.toContain('暂无公告')
    expect(w.findAll('.ow-state').length).toBe(0)

    w.unmount()
  })

  it('待办页签是行动队列：只列有计数的事项（带「去处理」出口），清零项压成一行', async () => {
    h.stats = { byStatus: { active: 1, completed: 1, failed: 2, archived: 0 } }
    const w = mount(OpsHub)
    await flushPromises()

    expect(w.find('.mk-card__title').text()).toBe('待办')
    // 只有「生成失败路径」有计数；反馈 / 事件 / 草稿都是 0，不再各占一行
    expect(w.findAll('.oh-task')).toHaveLength(1)
    expect(w.find('.oh-task').text()).toContain('生成失败路径')
    expect(w.find('.oh-task').text()).toContain('去处理 →')
    expect(w.find('.oh-queue__cleared').text()).toContain('已清零')
    expect(w.find('.oh-queue__cleared').text()).toContain('待处理反馈')
    expect(w.find('.oh-queue__cleared').text()).toContain('草稿公告')

    w.unmount()
  })

  it('四张读数卡是页级入口（clickable），失败域除外', async () => {
    h.stats = { byStatus: { active: 1, completed: 1, failed: 2, archived: 0 } }
    const w = mount(OpsHub)
    await flushPromises()

    const cards = w.findAll('.oh-metrics .mk-kpi')
    expect(cards).toHaveLength(4)
    for (const card of cards) expect(card.classes()).toContain('mk-kpi--clickable')
    expect(cards.map((c) => c.find('.mk-kpi__num').text())).toEqual(['0', '2', '0', '0'])

    w.unmount()
  })
})

describe('运营中心：页签切换的 URL 口径', () => {
  async function mountAt(path: string) {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/admin/:page?', component: { template: '<div />' } }],
    })
    await router.push(path)
    await router.isReady()
    const w = mount(OpsHub, { global: { plugins: [router] } })
    await flushPromises()
    return { w, router }
  }

  it('切页签不带走上一个页签的 ?status=', async () => {
    const { w, router } = await mountAt('/admin/ops-hub?tab=feedback&status=new')
    await flushPromises()
    const tab = w.findAll('.tabs .tab').find((t) => t.text().includes('公告'))!
    await tab.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query.tab).toBe('announce')
    expect(router.currentRoute.value.query.status).toBeUndefined()
    w.unmount()
  })
})

describe('运营中心：页签角标只出数（2026-10-21 用户「我刚进来就显示未加载，为什么会有这个状态」）', () => {
  it('未访问页签不出角标：页面自己的取数状态不挂到页签上', async () => {
    const w = mount(OpsHub);
    await flushPromises();

    const tabsText = w.findAll('[role="tab"]').map((t) => t.text()).join(' ');
    expect(tabsText).not.toContain('未加载');
    expect(tabsText).not.toContain('待访问');
    // 未拉取过的页签（反馈 / 成就 / 站内通知 / 会话安全）没有 .tab__count
    for (const label of ['反馈', '成就', '站内通知']) {
      const tabEl = w.findAll('.tabs .tab').find((t) => t.text().includes(label))!;
      expect(tabEl.find('.tab__count').exists()).toBe(false);
    }

    w.unmount();
  });
});
