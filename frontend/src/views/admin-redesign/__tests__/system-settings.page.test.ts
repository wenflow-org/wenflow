/**
 * 系统设置页（2026-11-01 用户「这四个拆出来，和模型与接入作为一个页面，
 * 但是模型与接入要改名字了」）。
 *
 * 合并后的形状：一个宿主 + 五个并列页签（模型与接入 / 运维工具 / 数据导出 / 会话安全 / 访问与注册）。
 * 本文件守住四件容易在后续改动中走形的事：
 *  1) 五个页签都在位，且默认落在「模型与接入」；
 *  2) ?tab= 是宿主自己的键：只做成员校验、不认识的回落首页签且不改写地址栏；
 *  3) 「模型与接入」面板懒挂载 + v-show 常驻——它在切页签时**不能**被销毁，
 *     否则未保存的接入配置会静默丢掉（它的 onBeforeRouteLeave 拦不住同 route 的 ?tab= 变化）；
 *  4) 页头「刷新注册表」只在「模型与接入」页签出现（它刷的是那个面板的注册表）。
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
    loadLiveData: vi.fn(async () => {}),
    errMsg: (e: unknown) => String(e),
    shortId: (s: string) => s,
    // 模型与接入面板（嵌入态）读的这些
    liveApiConfig: ref(null),
    liveFetchModels: vi.fn(async () => []),
    liveSaveApiConfig: vi.fn(async () => {}),
    // 访问与注册面板（嵌入态）读的这些
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
  return { intent: {}, isLive: ref(false), dataSource: ref('mock') }
})
vi.mock('../useConfirm', () => ({ askConfirm: vi.fn(async () => true) }))
vi.mock('@/utils/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import SystemSettings from '../SystemSettings.vue'
import ApiConfig from '../ApiConfig.vue'
import ServerToolsPanel from '../ServerToolsPanel.vue'
import DataExportPanel from '../DataExportPanel.vue'
import SessionSecurity from '../SessionSecurity.vue'
import AccessControl from '../AccessControl.vue'

async function mountHost(route = '/admin/system-settings') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/admin/:page?', component: { template: '<div/>' } }],
  })
  await router.push(route)
  await router.isReady()
  const wrapper = mount(SystemSettings, {
    global: { plugins: [router], stubs: { MkLoading: true, MkEmptyState: true } },
  })
  await flushPromises()
  return { wrapper, router }
}

describe('系统设置宿主：五个页签', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('页签依次是 模型与接入 / 运维工具 / 数据导出 / 会话安全 / 访问与注册，且不挂计数角标', async () => {
    const { wrapper } = await mountHost()
    const tabs = wrapper.findAll('.tabs .tab').map((t) => t.text())
    expect(tabs).toEqual(['模型与接入', '运维工具', '数据导出', '会话安全', '访问与注册'])
    expect(wrapper.findAll('.tab__count')).toHaveLength(0)
    wrapper.unmount()
  })

  it('无 ?tab= 时默认落在模型与接入，并把 tab 补进地址栏（后退历史才有锚点）', async () => {
    const { wrapper, router } = await mountHost()
    await flushPromises()
    expect(router.currentRoute.value.query.tab).toBe('api')
    expect(wrapper.find('#ss-panel-api').exists()).toBe(true)
    wrapper.unmount()
  })

  it.each([
    ['tools', ServerToolsPanel, '#ss-panel-tools'],
    ['export', DataExportPanel, '#ss-panel-export'],
    ['security', SessionSecurity, '#ss-panel-security'],
    ['access', AccessControl, '#ss-panel-access'],
  ])('?tab=%s 渲染对应面板', async (key, comp, sel) => {
    const { wrapper } = await mountHost(`/admin/system-settings?tab=${key}`)
    expect(wrapper.findComponent(comp as never).exists()).toBe(true)
    expect(wrapper.find(sel).exists()).toBe(true)
    wrapper.unmount()
  })

  it('不认识的 ?tab= 回落首页签，但不改写地址栏（与运营中心同款：静默回落）', async () => {
    const { wrapper, router } = await mountHost('/admin/system-settings?tab=nonsense')
    await flushPromises()
    const sel = wrapper.findAll('.tab').map((t) => t.attributes('aria-selected'))
    // 第一个页签选中
    expect(sel[0]).toBe('true')
    expect(wrapper.find('#ss-panel-api').exists()).toBe(true)
    expect(router.currentRoute.value.query.tab).toBe('nonsense')
    wrapper.unmount()
  })

  it('页头「刷新注册表」只在模型与接入页签出现（它刷的是那个面板的注册表）', async () => {
    const at = async (tab: string) => {
      const { wrapper } = await mountHost(`/admin/system-settings?tab=${tab}`)
      const has = wrapper.findAll('.mk-pagehead__actions > button').some((b) => b.text().includes('刷新注册表'))
      wrapper.unmount()
      return has
    }
    expect(await at('api')).toBe(true)
    for (const t of ['tools', 'export', 'security', 'access']) {
      expect(await at(t), `tab=${t} 不该出现刷新注册表`).toBe(false)
    }
  })

  it('页头标题是「系统设置」（页名不再叫模型与接入）', async () => {
    const { wrapper } = await mountHost()
    expect(wrapper.find('.mk-pagehead__title').text()).toBe('系统设置')
    wrapper.unmount()
  })
})

describe('切页签不得丢掉未保存的接入配置', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('从模型与接入切到运维工具再切回来，面板没有被销毁（v-show 常驻）', async () => {
    /* 模型与接入有未保存改动的 onBeforeRouteLeave，但它只在离开该 route record 时触发；
       切页签只改 ?tab=，同一条 route，守卫根本不跑。所以靠「不销毁」保编辑态。
       若哪天有人把它改成 v-else-if，这条会红。 */
    const { wrapper, router } = await mountHost('/admin/system-settings?tab=api')
    const apiBefore = wrapper.findComponent(ApiConfig)
    expect(apiBefore.exists()).toBe(true)
    // 首屏就该挂载（懒挂载只在首屏不是 api 时才推迟）
    await router.push('/admin/system-settings?tab=tools')
    await flushPromises()
    // 仍是同一个组件实例：v-show 只是 display:none，DOM 节点还在
    expect(wrapper.findComponent(ApiConfig).exists()).toBe(true)
    expect(wrapper.find('#ss-panel-api').exists()).toBe(true)
    expect(wrapper.find('#ss-panel-api').isVisible()).toBe(false)

    await router.push('/admin/system-settings?tab=api')
    await flushPromises()
    expect(wrapper.findComponent(ApiConfig).exists()).toBe(true)
    // v-show 恢复：节点的 style.display 不应再是 none（isVisible 还会看祖先，
    // 这里直接锁 v-show 自己写的那一档）
    const apiEl = wrapper.find('#ss-panel-api').element as HTMLElement
    expect(apiEl.style.display).not.toBe('none')
    wrapper.unmount()
  })

  it('首屏不是模型与接入时不预挂载（懒挂载），一旦进过就常驻', async () => {
    const { wrapper, router } = await mountHost('/admin/system-settings?tab=export')
    expect(wrapper.findComponent(ApiConfig).exists()).toBe(false)

    await router.push('/admin/system-settings?tab=api')
    await flushPromises()
    expect(wrapper.findComponent(ApiConfig).exists()).toBe(true)

    await router.push('/admin/system-settings?tab=security')
    await flushPromises()
    expect(wrapper.findComponent(ApiConfig).exists(), '进过之后切走也常驻').toBe(true)
    wrapper.unmount()
  })
})

describe('嵌入态：面板不自带页头', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('模型与接入嵌入时不出自己的 MkPageHead（页头归宿主）', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/admin/:page?', component: { template: '<div/>' } }] })
    await router.push('/admin/system-settings?tab=api')
    await router.isReady()
    const w = mount(ApiConfig, { props: { embedded: true }, global: { plugins: [router], stubs: { MkLoading: true } } })
    await flushPromises()
    expect(w.find('.mk-pagehead').exists()).toBe(false)
    expect(w.classes()).toContain('ac-host--embedded')
    w.unmount()
  })

  it('独立挂载（不传 embedded）时页头仍在，且动作只有刷新注册表', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/admin/:page?', component: { template: '<div/>' } }] })
    await router.push('/admin/system-settings?tab=api')
    await router.isReady()
    const w = mount(ApiConfig, { global: { plugins: [router], stubs: { MkLoading: true } } })
    await flushPromises()
    expect(w.find('.mk-pagehead__title').text()).toBe('模型与接入')
    const actions = w.findAll('.mk-pagehead__actions > button').map((b) => b.text())
    expect(actions).toEqual(['刷新注册表'])
    expect(w.classes()).toContain('mk-page--fill')
    expect(w.classes()).not.toContain('ac-host--embedded')
    w.unmount()
  })
})
