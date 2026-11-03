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
 *  4) 页头保持干净——「刷新注册表」已收进那张卡的右上图标钮（2026-11-03 用户
 *     「最右上角那个多余的按钮…保持顶部干净」），任何页签、任何挂载形态都不再出现在页头。
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

  it('页头保持干净：任何页签都不再有页面级动作（刷新注册表进了卡片右上）', async () => {
    const at = async (tab: string) => {
      const { wrapper } = await mountHost(`/admin/system-settings?tab=${tab}`)
      const has = wrapper.findAll('.mk-pagehead__actions > button').some((b) => b.text().includes('刷新注册表'))
      wrapper.unmount()
      return has
    }
    for (const t of ['api', 'tools', 'export', 'security', 'access']) {
      expect(await at(t), `tab=${t} 不该出现页面级刷新注册表`).toBe(false)
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

  it('进过「模型与接入」之后，其余四个页签照常渲染（2026-11-02 空白页回归）', async () => {
    /* 回归：其余四页签一度写成 `v-if="apiMounted" v-show=…` 那条链上的 v-else-if。
       apiMounted 一旦为真就再不变假，v-else-if 只在链头为假时求值——于是「先看过模型与接入」
       之后再点任何页签都是空白，且不报错。下面的 it.each 用「每个页签各挂一次新宿主」跑，
       apiMounted 每次都是 false，正好绕开这条路径，所以必须在这里串起来测。 */
    const { wrapper, router } = await mountHost('/admin/system-settings?tab=api')
    expect(wrapper.findComponent(ApiConfig).exists()).toBe(true)
    const cases = [
      ['tools', ServerToolsPanel, '#ss-panel-tools'],
      ['export', DataExportPanel, '#ss-panel-export'],
      ['security', SessionSecurity, '#ss-panel-security'],
      ['access', AccessControl, '#ss-panel-access'],
    ] as const
    for (const [key, comp, sel] of cases) {
      await router.push(`/admin/system-settings?tab=${key}`)
      await flushPromises()
      expect(wrapper.find(sel).exists(), `tab=${key} 接在 v-else-if 链上会整条空白`).toBe(true)
      expect(wrapper.findComponent(comp as never).exists()).toBe(true)
    }
    wrapper.unmount()
  })

  it('挂载时若 route 还停在上一个页面，不得把 ?tab= 写到那个页面（2026-11-02 修）', async () => {
    /* 本组件由 scene 驱动挂载，早于 AdminConsole 的「scene → URL」push 落定；挂载时那次
       「补 ?tab=」用不带 path 的 replace，会把 tab 写到当时的 route 上并顶掉在途 push。
       这里模拟那个时刻：router 停在 /admin/people，宿主被挂起。 */
    const { wrapper, router } = await mountHost('/admin/people')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/admin/people')
    expect(router.currentRoute.value.query.tab).toBeUndefined()
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

  it('独立挂载（不传 embedded）时页头仍在，且页头没有动作（刷新注册表在卡片右上）', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/admin/:page?', component: { template: '<div/>' } }] })
    await router.push('/admin/system-settings?tab=api')
    await router.isReady()
    const w = mount(ApiConfig, { global: { plugins: [router], stubs: { MkLoading: true } } })
    await flushPromises()
    expect(w.find('.mk-pagehead__title').text()).toBe('模型与接入')
    expect(w.findAll('.mk-pagehead__actions > button')).toHaveLength(0)
    // 重读本机注册表仍可达——它现在是那张卡右上的图标钮
    expect(w.find('.mpp > .mk-card__head .mpp-regreload').exists()).toBe(true)
    expect(w.classes()).toContain('mk-page--fill')
    expect(w.classes()).not.toContain('ac-host--embedded')
    w.unmount()
  })
})
