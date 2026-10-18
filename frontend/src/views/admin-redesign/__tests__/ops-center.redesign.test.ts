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
  return { timeAgo: () => 'x', liveAnnouncements: ref([]), liveFailures: ref({}), errMsg: (e: unknown) => String(e), shortId: (s: string) => s }
})
vi.mock('../store', () => ({ intent: {} }))
vi.mock('../useConfirm', () => ({ askConfirm: vi.fn(async () => true) }))
vi.mock('@/utils/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import ServerToolsPanel from '../ServerToolsPanel.vue'
import DataExportPanel from '../DataExportPanel.vue'
import OpsHub from '../OpsHub.vue'

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

  it('两张卡：时间推进模拟 + 事件投递失败；零死信时重放钮禁用（不给假动作）', async () => {
    const w = await mountWithRouter(ServerToolsPanel)
    expect(w.text()).toContain('时间推进模拟')
    expect(w.text()).toContain('事件投递失败')
    const requeue = w.findAll('button').find((b) => b.text() === '重放全部失败事件')
    expect(requeue, '零死信也要有重放入口（禁用态）').toBeTruthy()
    expect(requeue!.attributes('disabled')).toBeDefined()
    w.unmount()
  })
})

describe('数据导出面板（原系统工具 Tab2）', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('范围 chips 多选 + 「开始导出」；无选中时主钮禁用', async () => {
    const w = await mountWithRouter(DataExportPanel)
    const chips = w.findAll('.mk-pill')
    expect(chips.length, '六个导出范围 chips').toBe(6)
    const go = w.findAll('button').find((b) => b.text() === '开始导出')
    expect(go?.attributes('disabled')).toBeDefined()
    await chips[0]!.trigger('click')
    await chips[1]!.trigger('click')
    expect(w.findAll('.mk-pill.mk-pill--active').map((c) => c.text())).toEqual(['用户', '教学会话'])
    expect(w.text()).toContain('已选 2 项')
    const go2 = w.findAll('button').find((b) => b.text() === '开始导出')
    expect(go2?.attributes('disabled')).toBeUndefined()
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

  it('页签含 运维工具 / 数据导出 / 会话安全；「会话安全」未访问显「未加载」', async () => {
    const w = await mountWithRouter(OpsHub)
    const tabs = w.findAll('.tabs .tab').map((t) => t.text())
    expect(tabs.some((t) => t.includes('运维工具'))).toBe(true)
    expect(tabs.some((t) => t.includes('数据导出'))).toBe(true)
    const sec = tabs.find((t) => t.includes('会话安全'))
    expect(sec).toBeTruthy()
    expect(sec).toContain('未加载')
    expect(sec).not.toContain('—')
    expect(w.find('.mk-status').exists(), '宿主无状态条（信息各归其位）').toBe(false)
    w.unmount()
  })

  it('数据导出页签是表单：不渲染页头刷新钮（无远端读数可刷新）', async () => {
    const w = await mountWithRouter(OpsHub, '/admin/ops-hub?tab=export')
    const headBtns = w.findAll('.mk-pagehead__actions button')
    expect(headBtns.length, '导出页签不渲染刷新钮').toBe(0)
    w.unmount()
  })
})
