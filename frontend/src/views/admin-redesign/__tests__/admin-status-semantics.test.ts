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
 *
 * 2026-10-04 状态条退役：OpsHub 页头 .mk-status 整块下线（失败信号由页签体内 mk-alert +
 * 指标卡「加载失败」foot 承载；结论句并入「运营待办」卡头 meta），本文件对 .mk-status--bad/--ok
 * 的断言按原意图（失败不得伪装成已清零）改写为结构断言，并补状态条退役护栏。
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
    liveFailures: ref({}),
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
import OpsCenter from '../OpsCenter.vue'

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
    // 显式错误条（页签体内 mk-alert，可重试的信号，而非静默）
    expect(w.find('.mk-alert').exists()).toBe(true)
    expect(w.text()).toContain('待办数据加载失败')
    // 指标卡不得显假 0：三个失败域显「—」+「加载失败，计数不可信」foot。
    // 2026-10-06 审核 #174：页内 .oh-metric 瓦片收编共享 MkKpi（tone=bad 着色数字，
    // hintTone=bad 着色脚注），选择器随之迁移，断言语义不变。
    const naValues = w.findAll('.mk-kpi__num').filter((v) => v.text() === '—')
    expect(naValues).toHaveLength(3)
    expect(w.findAll('.mk-kpi__hint--bad')).toHaveLength(3)
    // 全页唯一显 0 的是「草稿公告」（取 live 层，未失败 → 0 是真实值，如实显示）
    const zeroValues = w.findAll('.mk-kpi__num').filter((v) => v.text() === '0')
    expect(zeroValues).toHaveLength(1)
    // 三个失败域行动行标失败态，且该行不得显示「已清零」
    // （第 4 行「草稿公告」取自 live 层，未失败 → 仍显示「已清零」是正确的）
    // 2026-10-01 对齐原型：待办清单由行动行改为 metricCard 条 + ranklist 行，
    // 失败类名随之由 .ow-todo--failed 改为 .ow-rankrow--failed（语义断言不变）
    const failedRows = w.findAll('.ow-rankrow--failed')
    expect(failedRows).toHaveLength(3)
    for (const row of failedRows) {
      expect(row.text()).toContain('加载失败')
      expect(row.text()).not.toContain('已清零')
    }
    // 重试入口（页头动作区，newui/admin pagehead 形态）
    expect(w.find('.mk-pagehead__actions button').text()).toContain('重试')

    w.unmount()
  })

  it('三个待办域成功且全为 0 → 结论句「运营待办全部已清零」入「运营待办」卡头 meta（2026-10-04 状态条退役迁入）', async () => {
    // D16：mock 换 live 信封（后端体为 { success, data: [...], pagination: {...} }，pagination 与 data 平级），
    // 旧 mock 的 { data: {}, pagination } 形状与真实不符，会让「解析错位」在任何测试里不可见。
    h.feedbackList.mockResolvedValue({ data: { success: true, data: [], pagination: { total: 0 } } })
    h.contentStats.mockResolvedValue({ data: { data: { byStatus: { failed: 0 } } } })
    h.outboxDead.mockResolvedValue({ data: { data: { deadCount: 0 } } })

    const w = mount(OpsHub)
    await flushPromises()

    // 护栏：页头状态条已退役，结论句不回条上
    expect(w.find('.mk-status').exists(), '本页状态条已退役').toBe(false)
    expect(w.find('.mk-alert').exists()).toBe(false)
    // 结论句（原状态条 strong）并入「运营待办」卡头 meta
    const todoHead = w.find('.mk-card__head')
    expect(todoHead.find('.mk-card__title').text()).toBe('运营待办')
    expect(todoHead.find('.mk-card__meta').text()).toContain('运营待办全部已清零')
    // 指标卡如实显示 0（真实 0 可以显；四卡：待处理反馈/生成失败路径/Outbox 死信/草稿公告）
    // 2026-10-06 审核 #174：瓦片迁 MkKpi，.oh-metric__value → .mk-kpi__num
    const values = w.findAll('.mk-kpi__num').map((v) => v.text())
    expect(values).toEqual(['0', '0', '0', '0'])
    // 行动行仍给「已清零」收尾
    expect(w.text()).toContain('已清零')

    w.unmount()
  })

  /* D7/D16 护栏：live 信封下待处理反馈计数必须从 pagination.total 解析且行动行可点。
     旧实现 `data?.data?.pagination` 恒 undefined，把真实 10 条显示成「已清零」且不可下钻。 */
  it('待处理反馈 live 信封（data 数组 + pagination 平级）→ 计数=10、结论句点名、行动行可点并挂跳转', async () => {
    h.feedbackList.mockResolvedValue({ data: { success: true, data: [{ id: 'f1', status: 'new' }], pagination: { total: 10 } } })
    h.contentStats.mockResolvedValue({ data: { data: { byStatus: { failed: 0 } } } })
    h.outboxDead.mockResolvedValue({ data: { data: { deadCount: 0 } } })

    const w = mount(OpsHub)
    await flushPromises()

    // 指标卡如实显示 10（不再解析错位成 0）。2026-10-06 审核 #174：瓦片迁 MkKpi。
    const values = w.findAll('.mk-kpi__num').map((v) => v.text())
    expect(values).toContain('10')
    // 结论句改总括句（审核 #173：逐项数字只留指标卡一处，卡头不再复述数字）
    const todoHead = w.find('.mk-card__head')
    expect(todoHead.find('.mk-card__meta').text()).toContain('1 项待处理')
    // 行动行可点（非 disabled + act 类）——D7 修复前反馈计数恒 0 → 该行 actionable=false 被禁点
    const feedbackRow = w.findAll('.ow-rankrow').find((r) => r.text().includes('待处理反馈'))!
    expect(feedbackRow.attributes('disabled')).toBeUndefined()
    expect(feedbackRow.classes()).toContain('ow-rankrow--act')
    expect(feedbackRow.find('.ow-rankrow__go').text()).toContain('去处理')

    w.unmount()
  })

  /* EG10 护栏：宿主页签角标未访问时不得显假 0（0 会被读成「确认无数据」）。 */
  it('未访问的页签角标显「待访问」而非 0（反馈/成就/站内通知）', async () => {
    h.feedbackList.mockResolvedValue({ data: { success: true, data: [], pagination: { total: 0 } } })
    h.contentStats.mockResolvedValue({ data: { data: { byStatus: { failed: 0 } } } })
    h.outboxDead.mockResolvedValue({ data: { data: { deadCount: 0 } } })

    const w = mount(OpsHub)
    await flushPromises()

    const tabCountText = (label: string) =>
      w.findAll('.tabs .tab').find((t) => t.text().includes(label))!.find('.tab__count').text()
    expect(tabCountText('反馈')).toBe('待访问')
    expect(tabCountText('成就')).toBe('待访问')
    expect(tabCountText('站内通知')).toBe('待访问')

    w.unmount()
  })
})

describe('R2：OpsCenter 死信告警随死信卡呈现（状态条已按原型退役）', () => {
  beforeEach(() => {
    h.outboxDead.mockReset()
  })

  it('死信 > 0 → 卡头 warn 徽标计数（而非零定义的 .is-bad；状态条类不再出现）', async () => {
    h.outboxDead.mockResolvedValue({ data: { data: { deadCount: 3, items: [] } } })

    const w = mount(OpsCenter)
    await flushPromises()

    const warn = w.find('.mk-card__head .mk-badge--warn')
    expect(warn.exists(), '死信积压要显式 warn 徽标（迁入死信卡头）').toBe(true)
    expect(warn.text()).toContain('3')
    expect(w.find('.mk-status').exists(), '本页状态条已退役').toBe(false)
    // 无效类名不得再出现（它曾让告警静默失效）
    expect(w.find('.is-bad').exists()).toBe(false)

    w.unmount()
  })
})
