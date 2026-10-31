/**
 * 「系统工具」并入运营中心 · 迁移护栏（2026-10-16 用户拍板该场景解散并入运营中心）。
 *
 * 原系统工具页（OpsCenter.vue）三个页签（运维工具 / 数据导出 / 会话安全）整体迁入
 * 运营中心宿主（OpsHub）的同名页签；本文件守住三件容易在后续改动中走形的事：
 *  1) 数据导出 = 范围 chips 多选 + 右对齐「开始导出」；无选中时主钮禁用；
 *     后端导出接口不支持时间范围 / JSONL 格式，对应控件不得渲染（不暗示不存在的功能）。
 *  2) 运维工具 = 只剩事件投递失败（死信重发）；批量吞吐已迁「模型与接入」、内容抽检退役、时间推进退役。
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
  return {
    timeAgo: () => 'x',
    liveAnnouncements: ref([]),
    liveFailures: ref({}),
    liveRefreshSeq: ref(0),
    // 侧栏角标回写（2026-11-01：OpsHub 拉完三域后同步给 live 共享读数）
    setLiveOpsPendingCounts: () => {},
    loadLiveData: vi.fn(async () => {}),
    errMsg: (e: unknown) => String(e),
    shortId: (s: string) => s,
    // 访问与注册（2026-10-27 并入宿主）：深链测试会挂载该面板
    liveApiConfig: ref(null),
    registrationEnabled: ref(null),
    registerIpQuotaEnabled: ref(null),
    registerIpDailyQuota: ref(null),
    liveSaveNetworkPolicy: vi.fn(async () => {}),
    updateRegistrationSetting: vi.fn(async () => {}),
    updateRegisterIpQuotaSetting: vi.fn(async () => {}),
  }
})
vi.mock('../store', async () => {
  const { ref } = await import('vue')
  return { intent: {}, isLive: ref(false) }
})
vi.mock('../useConfirm', () => ({ askConfirm: vi.fn(async () => true) }))
vi.mock('@/utils/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import ServerToolsPanel from '../ServerToolsPanel.vue'
import DataExportPanel from '../DataExportPanel.vue'
import OpsHub from '../OpsHub.vue'
import AccessControl from '../AccessControl.vue'
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

  it('只剩事件投递失败一张卡；批量吞吐已迁走、内容抽检已退役，零死信显示健康态而不给假动作', async () => {
    const w = await mountWithRouter(ServerToolsPanel)
    const titles = w.findAll('.mk-card__title').map((t) => t.text())
    expect(titles).toEqual(['事件投递失败'])
    expect(w.text()).not.toContain('时间推进')
    expect(w.text()).not.toContain('批量吞吐')
    expect(w.text()).not.toContain('内容抽检')
    // 卡片保留一句白话说明（这些记录从哪来、点按钮会发生什么）
    expect(w.findAll('.stp-intro')).toHaveLength(1)
    // 2026-10-27 重做：0 死信不再渲染禁用重发钮，改健康态摘要 + 刷新出口
    const requeue = w.findAll('button').find((b) => b.text() === '重新发送全部')
    expect(requeue, '零死信不渲染假动作').toBeFalsy()
    expect(w.find('.stp-ok').exists()).toBe(true)
    expect(w.find('.stp-ok').text()).toContain('没有投递失败的事件')
    expect(w.find('.mk-card__head .mk-badge--ok').text()).toContain('全部已送达')
    w.unmount()
  })

  it('有积压：卡头才出现重发主操作，正文给副作用提醒与清单', async () => {
    apiObject.adminDevtoolsApi.getOutboxDead.mockResolvedValueOnce({
      data: {
        data: {
          deadCount: 1,
          items: [
            {
              id: 'dead-1',
              eventType: 'teaching.session.completed',
              userId: 'user-1',
              aggregateId: 'sess-1',
              attemptCount: 3,
              lastError: 'upstream timeout',
              occurredAt: new Date().toISOString()
            }
          ]
        }
      }
    } as never)
    const w = await mountWithRouter(ServerToolsPanel)
    expect(w.find('.mk-card__head .mk-badge--warn').text()).toContain('1 条待重发')
    expect(w.findAll('button').some((b) => b.text() === '重新发送全部')).toBe(true)
    expect(w.find('.stp-warn').text()).toContain('重复副作用')
    expect(w.find('.stp-dead-table').text()).toContain('teaching.session.completed')
    expect(w.find('.stp-ok').exists()).toBe(false)
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

  it('页签含 运维工具 / 数据导出 / 会话安全 / 访问与注册；页签不带计数角标（数字归 KPI 卡）', async () => {
    const w = await mountWithRouter(OpsHub)
    const tabs = w.findAll('.tabs .tab').map((t) => t.text())
    expect(tabs.some((t) => t.includes('运维工具'))).toBe(true)
    expect(tabs.some((t) => t.includes('数据导出'))).toBe(true)
    expect(tabs.some((t) => t.includes('访问与注册'))).toBe(true)
    const sec = tabs.find((t) => t.includes('会话安全'))
    expect(sec).toBeTruthy()
    // 2026-10-27 用户「tab 里面的数字不要了」：页签只写标签，不挂角标
    expect(w.findAll('.tab__count')).toHaveLength(0)
    expect(sec).not.toContain('未加载')
    expect(sec).not.toContain('—')
    expect(w.find('.mk-status').exists(), '宿主无状态条（信息各归其位）').toBe(false)
    w.unmount()
  })

  it('访问与注册深链：?tab=access 挂载嵌入式面板（无页头），懒挂载不阻塞其它页签', async () => {
    const w = await mountWithRouter(OpsHub, '/admin/ops-hub?tab=access')
    await flushPromises()
    expect(w.findComponent(AccessControl).exists()).toBe(true)
    expect(w.findComponent(AccessControl).props('embedded')).toBe(true)
    expect(w.find('.mk-pagehead__title').text()).toBe('运营中心')
    expect(w.find('#oh-panel-access').exists()).toBe(true)
    w.unmount()

    // 首屏不是访问页签时不挂载（v-if 懒挂载），切走后才常驻（v-show 保留未保存编辑）
    const w2 = await mountWithRouter(OpsHub, '/admin/ops-hub?tab=todo')
    expect(w2.findComponent(AccessControl).exists()).toBe(false)
    w2.unmount()
  })

  it('页头不再有独立刷新钮；系统页签隐藏页级读数带，顶栏广播仍可刷新', async () => {
    // 2026-10-30 外部评审：数据导出与运维/会话/访问同属系统页签，0 值读数带不再占首屏。
    const w = await mountWithRouter(OpsHub, '/admin/ops-hub?tab=export')
    const headBtns = w.findAll('.mk-pagehead__actions > button')
    expect(headBtns.some((b) => b.text().includes('刷新')), '页头不再有第二颗刷新钮').toBe(false)
    expect(w.find('.oh-metrics').exists()).toBe(false)

    const before = apiObject.adminLearningContentApi.getStats.mock.calls.length
    liveRefreshSeq.value += 1
    await flushPromises()
    expect(apiObject.adminLearningContentApi.getStats.mock.calls.length).toBeGreaterThan(before)
    w.unmount()
  })
})
