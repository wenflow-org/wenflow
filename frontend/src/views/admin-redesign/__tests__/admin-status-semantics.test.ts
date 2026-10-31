/**
 * R2 状态语义回归：管理台页头的「绿点」必须可信。
 *
 * 背景（ADMIN_VISUAL_LAYER_SPEC.md §0.5「状态语义色」）：ok 只表示「一切正常且无需行动」；
 * 失败必须落到 bad 并给出重试入口。以下两类假信号曾真实存在：
 *
 *  1) OpsHub 三个待办域用 .catch(() => count = 0)，后端故障时页面伪装成「全部已清零」——
 *     驾驶舱最不可接受的一种假信号，因为它恰好把「取不到」显示成「没事」。
 *  2) 运维工具面板（原 OpsCenter Tab1，2026-10-16 并入运营中心）用 `.is-bad` 作为告警类名，
 *     但该类全站零定义（页面 scoped 里也没有）→ 死信告警永远不标红（无效类名静默失效）。
 *
 * 2026-10-04 状态条退役：OpsHub 页头 .mk-status 整块下线（失败信号由 mk-alert +
 * 指标卡「加载失败」foot 承载；结论句并入「待办清单」卡头 meta），本文件对 .mk-status--bad/--ok
 * 的断言按原意图（失败不得伪装成已清零）改写为结构断言，并补状态条退役护栏。
 * 2026-10-18 用户拍板四张读数卡升到页签栏之上（页级概览 + 页签内工作台）：mk-alert 与读数卡
 * 随之上移到页级，页签内清单只留行动，本文件相应断言按新落位改写。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'

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
    liveFailures: ref({}),
    liveRefreshSeq: ref(0),
    loadLiveData: vi.fn(async () => {}),
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
    // OpsHub 路径四态标签已改走 opsShared 单源映射（原页内私写文案）
    PATH_STATUS_TEXT: { active: '学习中', completed: '已完成', failed: '生成失败', archived: '已下线' },
  }
})
vi.mock('../useConfirm', () => ({ askConfirm: vi.fn(async () => true) }))
vi.mock('@/utils/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import OpsHub from '../OpsHub.vue'
import ServerToolsPanel from '../ServerToolsPanel.vue'

describe('R2：OpsHub 失败不得伪装成「已清零」', () => {
  beforeEach(() => {
    h.feedbackList.mockReset()
    h.contentStats.mockReset()
    h.outboxDead.mockReset()
  })

  it('三个待办域全部失败 → 页签体显式错误条 + 指标卡显「—」与「加载失败」（不伪装成已清零；2026-10-04 状态条退役）', async () => {
    h.feedbackList.mockRejectedValue(new Error('后端不可用'))
    h.contentStats.mockRejectedValue(new Error('后端不可用'))
    h.outboxDead.mockRejectedValue(new Error('后端不可用'))

    const w = mount(OpsHub)
    await flushPromises()

    // 护栏（判例 buckets-band.test.ts）：页头状态条已退役，失败不再由整页红基调承载
    expect(w.find('.mk-status').exists(), '本页状态条已退役').toBe(false)
    // 显式错误条（mk-alert，可重试的信号，而非静默）——随页级读数带走，在页签栏之上
    expect(w.find('.mk-alert').exists()).toBe(true)
    expect(w.text()).toContain('待办数据加载失败')
    // 读数不得显假 0：三个失败域显「—」+「加载失败」脚注，只有「草稿公告」（取 live 层、未失败）显真 0。
    // 2026-10-18 用户拍板：四张读数卡升到页签栏之上（页级概览 + 页签内工作台）。
    const naValues = w.findAll('.mk-kpi__num').filter((v) => v.text() === '—')
    expect(naValues).toHaveLength(3)
    expect(w.findAll('.mk-kpi__hint--bad')).toHaveLength(3)
    const zeroValues = w.findAll('.mk-kpi__num').filter((v) => v.text() === '0')
    expect(zeroValues).toHaveLength(1)
    // 2026-10-27：页签内是行动队列——失败行保留但不可操作，清零项压成底部署名
    expect(w.findAll('.oh-task')).toHaveLength(3)
    expect(w.findAll('.oh-task--failed')).toHaveLength(3)
    for (const row of w.findAll('.oh-task--failed')) {
      expect(row.text()).toContain('加载失败')
      expect(row.find('button').exists()).toBe(false)
    }
    expect(w.find('.oh-queue__cleared').text()).toContain('草稿公告')
    const failedCards = w.findAll('.mk-kpi').filter((c) => c.find('.mk-kpi__num').text() === '—')
    for (const card of failedCards) {
      expect(card.classes()).not.toContain('mk-kpi--clickable')
    }
    // 重试入口在失败条上（2026-10-23 页头第二颗刷新钮撤除：顶栏已有刷新，失败态就地重试）
    expect(w.find('.mk-alert--row .mk-alert__btn').text()).toContain('重试')

    w.unmount()
  })

  it('三个待办域成功且全为 0 → 读数带四卡显 0，页签内收成一行「没有待处理项」', async () => {
    // D16：mock 换 live 信封（后端体为 { success, data: [...], pagination: {...} }，pagination 与 data 平级），
    // 旧 mock 的 { data: {}, pagination } 形状与真实不符，会让「解析错位」在任何测试里不可见。
    h.feedbackList.mockResolvedValue({ data: { success: true, data: [], pagination: { total: 0 } } })
    h.contentStats.mockResolvedValue({ data: { data: { byStatus: { failed: 0 } } } })
    h.outboxDead.mockResolvedValue({ data: { data: { deadCount: 0 } } })

    const w = mount(OpsHub)
    await flushPromises()

    // 护栏：页头状态条已退役
    expect(w.find('.mk-status').exists(), '本页状态条已退役').toBe(false)
    expect(w.find('.mk-alert').exists()).toBe(false)
    // 读数如实显示 0（真实 0 可以显；四卡：待处理反馈/生成失败路径/事件投递失败/草稿公告）
    const values = w.findAll('.mk-kpi__num').map((v) => v.text())
    expect(values).toEqual(['0', '0', '0', '0'])
    // 2026-10-27：全部清零时不再渲染 4 个空行，改一行空态；清零名单不再需要
    expect(w.findAll('.mk-card')).toHaveLength(1)
    expect(w.findAll('.oh-task')).toHaveLength(0)
    expect(w.find('.oh-queue__empty').exists()).toBe(true)
    expect(w.find('.oh-queue__empty').text()).toContain('没有待处理项')
    expect(w.find('.oh-queue__cleared').exists()).toBe(false)
    /* 2026-10-29 冗余副文审计：全清零时卡头不再复述结论、空态不再点名四类待办——
       同一事实只由页级四个 0 与「没有待处理项」承担（此前一屏说了四遍）。 */
    expect(w.find('.mk-card__meta').exists()).toBe(false)
    expect(w.find('.oh-queue__empty').text()).not.toContain('都已处理完')

    w.unmount()
  })

  /* 2026-10-18 用户拍板「读数卡升到页签栏之上、任何页签都能看见」：
     这一块是跨页签的待办读数（反馈/路径/事件/公告各属别的页签），从此不再只长在「运营待办」页签里。
     用「数据导出」页签验证最狠：它是纯表单页、本页签零读数，读数带仍要照常在页签栏之上。
     页签切换走 URL（?tab=），故用带 router 的挂载。 */
  it('页级读数带在零读数的「数据导出」页签同样可见（跨页签待办不再被某个页签独占）', async () => {
    h.feedbackList.mockResolvedValue({ data: { success: true, data: [], pagination: { total: 3 } } })
    h.contentStats.mockResolvedValue({ data: { data: { byStatus: { failed: 2 } } } })
    h.outboxDead.mockResolvedValue({ data: { data: { deadCount: 1 } } })

    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/admin/:page?', component: { template: '<div />' } }] })
    await router.push('/admin/ops-hub?tab=export')
    await router.isReady()
    const w = mount(OpsHub, { global: { plugins: [router] } })
    await flushPromises()

    const readings = w.findAll('.oh-metrics .mk-kpi__label').map((x) => x.text().trim())
    expect(readings).toEqual(['待处理反馈', '生成失败路径', '事件投递失败', '草稿公告'])
    expect(w.findAll('.oh-metrics .mk-kpi__num').map((x) => x.text())).toEqual(['3', '2', '1', '0'])
    // 位置：读数带在页签面板之外、页签栏之前（页级，不是某个页签体内的内容）
    expect(w.find('.oh-metrics').element.closest('[role="tabpanel"]')).toBeNull()
    expect((w.find('.tabs').element.compareDocumentPosition(w.find('.oh-metrics').element) & Node.DOCUMENT_POSITION_PRECEDING) !== 0).toBe(true)
    // 口径开关随读数带走（不再留在某个页签的卡头里）；刷新不再在页头另出一颗（走顶栏）
    // 口径开关已退役（2026-10-21）：页头动作区不再有 真实/测试 控件
    expect(w.find('.mk-pagehead__actions').text()).not.toContain('真实')
    expect(w.findAll('.mk-pagehead__actions > button').some((b) => b.text().includes('刷新'))).toBe(false)
    w.unmount()
  })

  /* D7/D16 护栏：live 信封下待处理反馈计数必须从 pagination.total 解析且读数卡可点下钻。
     旧实现 `data?.data?.pagination` 恒 undefined，把真实 10 条显示成「已清零」且不可下钻。 */
  it('待处理反馈 live 信封（data 数组 + pagination 平级）→ 计数=10、读数卡可点', async () => {
    h.feedbackList.mockResolvedValue({ data: { success: true, data: [{ id: 'f1', status: 'new' }], pagination: { total: 10 } } })
    h.contentStats.mockResolvedValue({ data: { data: { byStatus: { failed: 0 } } } })
    h.outboxDead.mockResolvedValue({ data: { data: { deadCount: 0 } } })

    const w = mount(OpsHub)
    await flushPromises()

    // 读数如实显示 10（不再解析错位成 0）。
    const values = w.findAll('.mk-kpi__num').map((v) => v.text())
    expect(values).toContain('10')
    // 值色分档：待处理反馈的严重度是 warn（琥珀），不是 bad（红）——颜色只承载紧急度。
    const feedbackCard = w.findAll('.mk-kpi').find((c) => c.find('.mk-kpi__label').text() === '待处理反馈')!
    expect(feedbackCard.classes()).toContain('mk-kpi--warn')
    expect(feedbackCard.find('.mk-kpi__num').text()).toBe('10')
    // 2026-10-26：读数卡自身就是入口（页签内的第二份清单已删）
    expect(feedbackCard.classes()).toContain('mk-kpi--clickable')

    w.unmount()
  })

  /* 2026-10-27 用户「tab 里面的数字不要了」：页签计数角标整体退役，
     计数只在页级 KPI 卡里出现（单一出处）。 */
  it('页签不渲染计数角标（数字统一在 KPI 卡）', async () => {
    h.feedbackList.mockResolvedValue({ data: { success: true, data: [], pagination: { total: 0 } } })
    h.contentStats.mockResolvedValue({ data: { data: { byStatus: { failed: 0 } } } })
    h.outboxDead.mockResolvedValue({ data: { data: { deadCount: 0 } } })

    const w = mount(OpsHub)
    await flushPromises()

    expect(w.findAll('.tab__count')).toHaveLength(0)
    const tabsText = w.findAll('.tabs .tab').map((t) => t.text()).join(' ')
    expect(tabsText).not.toContain('未加载')

    w.unmount()
  })
})

describe('R2：运维工具死信告警随死信卡呈现（状态条已按原型退役）', () => {
  beforeEach(() => {
    h.outboxDead.mockReset()
  })

  it('死信 > 0 → 卡头 warn 徽标计数（而非零定义的 .is-bad；状态条类不再出现）', async () => {
    h.outboxDead.mockResolvedValue({ data: { data: { deadCount: 3, items: [] } } })

    const w = mount(ServerToolsPanel)
    await flushPromises()

    const warn = w.find('.mk-card__head .mk-badge--warn')
    expect(warn.exists(), '死信积压要显式 warn 徽标（迁入死信卡头）').toBe(true)
    expect(warn.text()).toContain('3')
    expect(w.find('.mk-status').exists(), '本面板无状态条').toBe(false)
    // 计数 > 0 但窗口无行：不得落成「全部已送达」健康态
    expect(w.find('.stp-ok').exists()).toBe(false)
    expect(w.text()).toContain('当前窗口没有返回失败记录')
    // 无效类名不得再出现（它曾让告警静默失效）
    expect(w.find('.is-bad').exists()).toBe(false)

    w.unmount()
  })
})
