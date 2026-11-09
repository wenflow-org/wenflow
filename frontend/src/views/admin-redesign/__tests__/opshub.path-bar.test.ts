/**
 * 运营中心宿主：页签结构 + 四张读数卡的快捷切换（2026-11-09）。
 *
 * 历史：本文件原锁「学习路径构成条只在 ≥2 个非零状态时渲染」（审计 3.4）。
 * 2026-10-26 评审：路径 / 公告两张状态卡的数字与页级读数带同源——两卡撤除。
 * 2026-11-09 用户「运营待办是空壳，直接砍掉」：原第一个页签只剩一个跳到隔壁「反馈」的按钮，
 * 而顶部四张读数卡已经把待办数讲完——删掉 todo 页签，反馈成为默认落点，四张卡升级为
 * 快捷切换入口（本页有页签的切页签 + 预筛，跨场景的直接深链）。
 * 现在守五件事：
 *  1) 页签只有 反馈 / 成就 / 公告 / 站内通知，默认落在「反馈」；
 *  2) 页签体内不再有行动队列（同一事实只讲一次，入口在读数卡）；
 *  3) 四张读数卡都可点（失败域除外），点击落到对应页签/页面并带预筛；
 *  4) 裸进入 URL 补上 ?tab=feedback&status=new（可刷新/可分享的待处理视图）；
 *  5) 老深链 ?tab=todo 回落到反馈（路由级改投另见 admin-routes.test.ts）。
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
  adminFeedbackApi: {
    list: vi.fn(async () => ({ data: { data: [], pagination: { total: 0 } } })),
    /* 默认页签改成「反馈」后 Feedback 挂载会拉 30 天趋势。 */
    getTrend: vi.fn(async () => ({ data: { data: [] } })),
  },
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
    // 侧栏角标回写（2026-11-01：OpsHub 拉完三域后同步给 live 共享读数）
    setLiveOpsPendingCounts: () => {},
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
import Feedback from '../Feedback.vue'
import { liveAnnouncements, liveFailures } from '../live'

beforeEach(() => {
  h.stats = { byStatus: { active: 1, completed: 0, failed: 0, archived: 0 } }
  liveAnnouncements.value = []
  liveFailures.value = {}
})

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

describe('运营中心：空壳「运营待办」页签下线', () => {
  it('页签只剩 反馈/成就/公告/站内通知，默认落「反馈」并直接渲染反馈面板', async () => {
    const w = mount(OpsHub)
    await flushPromises()

    expect(w.findAll('.tabs .tab').map((t) => t.text())).toEqual(['反馈', '成就', '公告', '站内通知'])
    expect(w.find(`[role="tab"][aria-selected="true"]`).text()).toBe('反馈')
    expect(w.findComponent(Feedback).exists(), '默认页签直接是反馈表').toBe(true)
    // 行动队列（原待办页签）与它的空态/清零行都不存在
    expect(w.find('.oh-queue').exists()).toBe(false)
    expect(w.findAll('.oh-task').length).toBe(0)
    expect(w.find('.oh-queue__empty').exists()).toBe(false)

    w.unmount()
  })

  it('裸进入把待处理预筛写进 URL；老深链 ?tab=todo 回落「反馈」', async () => {
    const bare = await mountAt('/admin/ops-hub')
    expect(bare.router.currentRoute.value.query.tab).toBe('feedback')
    expect(bare.router.currentRoute.value.query.status).toBe('new')
    expect(bare.w.find(`[role="tab"][aria-selected="true"]`).text()).toBe('反馈')
    bare.w.unmount()

    const legacy = await mountAt('/admin/ops-hub?tab=todo')
    expect(legacy.w.find(`[role="tab"][aria-selected="true"]`).text()).toBe('反馈')
    legacy.w.unmount()
  })
})

describe('运营中心：四张读数卡是快捷切换入口', () => {
  it('四卡可点（失败域除外），点击切到对应页签并带预筛', async () => {
    h.stats = { byStatus: { active: 1, completed: 1, failed: 2, archived: 0 } }
    const { w, router } = await mountAt('/admin/ops-hub?tab=announce')

    const cards = w.findAll('.oh-metrics .mk-kpi')
    expect(cards).toHaveLength(4)
    for (const card of cards) expect(card.classes()).toContain('mk-kpi--clickable')
    expect(cards.map((c) => c.find('.mk-kpi__num').text())).toEqual(['0', '2', '0', '0'])

    // 未处理反馈 → 反馈页签 + 待处理预筛
    await cards[0].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.tab).toBe('feedback')
    expect(router.currentRoute.value.query.status).toBe('new')

    // 草稿公告 → 公告页签 + 草稿预筛
    await w.findAll('.oh-metrics .mk-kpi')[3].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.tab).toBe('announce')
    expect(router.currentRoute.value.query.status).toBe('draft')
    /* 预筛必须真的落进公告列表的筛选器（2026-11-09）：KPI 卡与页签同一次导航写 URL，
       Announcements 随页签挂载时读到的是旧 route，只在 setup 读一次会停在「全部状态」。 */
    expect(w.find('[aria-label="按状态筛选"]').text()).toContain('草稿')

    w.unmount()
  })

  it('处理面板已迁走的两个域仍是一步直达（跨场景深链）', async () => {
    h.stats = { byStatus: { active: 1, completed: 1, failed: 2, archived: 0 } }
    const { w, router } = await mountAt('/admin/ops-hub?tab=feedback')

    // 生成失败路径 → 学习路径页（预筛 failed）
    await w.findAll('.oh-metrics .mk-kpi')[1].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/admin/learning-paths')
    expect(router.currentRoute.value.query.status).toBe('failed')

    // 事件投递失败 → 系统设置 · 运维工具页签
    await w.findAll('.oh-metrics .mk-kpi')[2].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/admin/system-settings')
    expect(router.currentRoute.value.query.tab).toBe('tools')

    w.unmount()
  })

  it('失败域读数显「—」且不可点（读数不可信，不带人去目标页）', async () => {
    const api = await import('@/api/adminApi')
    const spy = vi.spyOn(api.adminLearningContentApi, 'getStats').mockRejectedValue(new Error('后端不可用'))
    const { w } = await mountAt('/admin/ops-hub?tab=feedback')

    const failedCards = w.findAll('.mk-kpi').filter((c) => c.find('.mk-kpi__num').text() === '—')
    expect(failedCards).toHaveLength(1)
    for (const card of failedCards) expect(card.classes()).not.toContain('mk-kpi--clickable')

    spy.mockRestore()
    w.unmount()
  })
})

describe('运营中心：页签切换的 URL 口径', () => {
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

describe('运营中心：页签不挂数字（2026-10-27 用户「tab 里面的数字不要了」）', () => {
  it('所有页签都不渲染计数角标；数字只在页级 KPI 卡里', async () => {
    const w = mount(OpsHub)
    await flushPromises()

    const tabsText = w.findAll('[role="tab"]').map((t) => t.text()).join(' ')
    expect(tabsText).not.toContain('未加载')
    expect(tabsText).not.toContain('待访问')
    expect(w.findAll('.tab__count')).toHaveLength(0)
    // 四个读数仍由页级 KPI 卡承载
    expect(w.findAll('.oh-metrics .mk-kpi')).toHaveLength(4)

    w.unmount()
  })
})
