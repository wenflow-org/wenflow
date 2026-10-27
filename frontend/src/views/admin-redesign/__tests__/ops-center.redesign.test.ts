/**
 * 「系统工具」并入运营中心 · 迁移护栏（2026-10-16 用户拍板该场景解散并入运营中心）。
 *
 * 原系统工具页（OpsCenter.vue）三个页签（运维工具 / 数据导出 / 会话安全）整体迁入
 * 运营中心宿主（OpsHub）的同名页签；本文件守住三件容易在后续改动中走形的事：
 *  1) 数据导出 = 范围 chips 多选 + 右对齐「开始导出」；无选中时主钮禁用；
 *     后端导出接口不支持时间范围 / JSONL 格式，对应控件不得渲染（不暗示不存在的功能）。
 *  2) 运维工具 = 时间推进模拟 + 事件投递失败（死信）两张卡；零死信时重放钮禁用（不给假动作）。
 *  3) 运营中心宿主里这三个页签在位；「会话安全」未访问角标显「未加载」（不显 0/—）。
 *
 * 原型 renderOpsCenter（newui index.html 1848-1886）骨架保持不变，只是宿主换了。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'

const apiObject = vi.hoisted(() => {
  const ok = <T,>(data: T) => ({ data: { data } })
  return {
    adminDevtoolsApi: {
      advanceTime: vi.fn(async () => ok({})),
      getOutboxDead: vi.fn(async () => ok({ deadCount: 0, items: [] })),
      requeueOutboxDead: vi.fn(async () => ok({ requeued: 0 })),
    },
    adminAxios: { get: vi.fn(async () => ({ headers: {}, data: new Blob(['x']) })) },
    adminFeedbackApi: { list: vi.fn(async () => ({ data: { data: { pagination: { total: 0 } } } })) },
    adminLearningContentApi: { getStats: vi.fn(async () => ok({ byStatus: {} })) },
  }
})

vi.mock('@/api/adminApi', async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>()
  return {
    ...orig,
    adminDevtoolsApi: apiObject.adminDevtoolsApi,
    adminAxios: apiObject.adminAxios,
    adminFeedbackApi: apiObject.adminFeedbackApi,
    adminLearningContentApi: apiObject.adminLearningContentApi,
  }
})
vi.mock('../live', async () => {
  const { ref } = await import('vue')
  return { timeAgo: () => 'x', liveAnnouncements: ref([]), liveFailures: ref({}), liveRefreshSeq: ref(0), loadLiveData: vi.fn(async () => {}), errMsg: (e: unknown) => String(e), shortId: (s: string) => s }
})
vi.mock('../store', () => ({ intent: {} }))
vi.mock('../useConfirm', () => ({ askConfirm: vi.fn(async () => true) }))
vi.mock('@/utils/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import ServerToolsPanel from '../ServerToolsPanel.vue'
import DataExportPanel from '../DataExportPanel.vue'
import OpsHub from '../OpsHub.vue'
import { liveRefreshSeq } from '../live'

async function mountWithRouter(component: unknown, route = '/admin/ops-hub') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/admin/:page?', component: { template: '<div/>' } }],
  })
  router.push(route)
  await router.isReady()
  const wrapper = mount(component as never, {
    global: {
      plugins: [router],
      stubs: {
        MkLoading: true,
        MkEmptyState: true,
        SessionSecurity: true,
        Feedback: true,
        OpsAchievements: true,
        Announcements: true,
        Notifications: true,
      },
    },
  })
  await flushPromises()
  return wrapper
}

describe('运维工具面板（原系统工具 Tab1）', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('两张卡：事件投递失败 + 时间推进模拟；死信卡在前（「去处理」落到首屏就是重放入口），零死信时重放钮禁用', async () => {
    const w = await mountWithRouter(ServerToolsPanel)
    const titles = w.findAll('.mk-card__title').map((t) => t.text())
    expect(titles.slice(0, 2)).toEqual(['事件投递失败', '时间推进模拟'])
    const requeue = w.findAll('button').find((b) => b.text() === '重放全部失败事件')
    expect(requeue, '零死信也要有重放入口（禁用态）').toBeTruthy()
    expect(requeue!.attributes('disabled')).toBeDefined()
    w.unmount()
  })
})

describe('数据导出面板（原系统工具 Tab2）', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('六张数据表按组平铺为选择卡 + 「开始导出」；无选中时主钮禁用', async () => {
    const w = await mountWithRouter(DataExportPanel)
    const boxes = w.findAll('.exp-item input[type="checkbox"]')
    expect(boxes.length, '六个导出数据表').toBe(6)
    expect(w.findAll('.exp-group')).toHaveLength(3)
    const go = w.findAll('button').find((b) => b.text() === '开始导出')
    expect(go?.attributes('disabled')).toBeDefined()
    await boxes[0]!.setValue(true)
    await boxes[1]!.setValue(true)
    expect(w.findAll('.exp-item--on').map((c) => c.find('.exp-item__title').text())).toEqual(['用户', '教学会话'])
    expect(w.text()).toContain('已选 2 项')
    const go2 = w.findAll('button').find((b) => b.text() === '开始导出')
    expect(go2?.attributes('disabled')).toBeUndefined()
    // 行数上限只服务日志组：选业务表时不出现，选日志后出现
    expect(w.find('.exp-limit').exists()).toBe(false)
    const logBox = w.findAll('.exp-item input[type="checkbox"]')[4]!
    await logBox.setValue(true)
    expect(w.find('.exp-limit').exists()).toBe(true)
    w.unmount()
  })

  it('后端不支持的导出控件（时间范围输入 / JSONL 格式单选）不渲染', async () => {
    const w = await mountWithRouter(DataExportPanel)
    expect(w.text()).not.toContain('JSONL')
    expect(w.findAll('input[type="datetime-local"], input[placeholder*="时间"]').length).toBe(0)
    w.unmount()
  })
})

describe('运营中心宿主：系统工具三页签在位', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('页签含 运维工具 / 数据导出 / 会话安全；页签不带计数角标（数字归 KPI 卡）', async () => {
    const w = await mountWithRouter(OpsHub)
    const tabs = w.findAll('.tabs .tab').map((t) => t.text())
    expect(tabs.some((t) => t.includes('运维工具'))).toBe(true)
    expect(tabs.some((t) => t.includes('数据导出'))).toBe(true)
    const sec = tabs.find((t) => t.includes('会话安全'))
    expect(sec).toBeTruthy()
    // 2026-10-27 用户「tab 里面的数字不要了」：页签只写标签，不挂角标
    expect(w.findAll('.tab__count')).toHaveLength(0)
    expect(sec).not.toContain('未加载')
    expect(sec).not.toContain('—')
    expect(w.find('.mk-status').exists(), '宿主无状态条（信息各归其位）').toBe(false)
    w.unmount()
  })

  it('页头不再有独立刷新钮；顶栏广播仍刷新页级读数带（导出页签一并生效）', async () => {
    // 2026-10-18 用户拍板：四张待办读数卡升到页签栏之上，8 个页签都可见（含 export 表单页）。
    // 2026-10-23 用户「已经有刷新，为什么还有独立刷新」：这枚页头钮撤除，
    // 刷新入口收敛到顶栏 —— 广播（liveRefreshSeq）必须同样能重拉读数带，否则等于丢掉重试出口。
    const w = await mountWithRouter(OpsHub, '/admin/ops-hub?tab=export')
    const headBtns = w.findAll('.mk-pagehead__actions > button')
    expect(headBtns.some((b) => b.text().includes('刷新')), '页头不再有第二颗刷新钮').toBe(false)
    // 读数带在导出页签也渲染：四张卡，且位于页签栏之前（页级、非页签体内）
    expect(w.findAll('.oh-metrics .mk-kpi')).toHaveLength(4)
    expect((w.find('.tabs').element.compareDocumentPosition(w.find('.oh-metrics').element) & Node.DOCUMENT_POSITION_PRECEDING) !== 0).toBe(true)

    const before = apiObject.adminLearningContentApi.getStats.mock.calls.length
    liveRefreshSeq.value += 1
    await flushPromises()
    expect(apiObject.adminLearningContentApi.getStats.mock.calls.length).toBeGreaterThan(before)
    w.unmount()
  })
})
