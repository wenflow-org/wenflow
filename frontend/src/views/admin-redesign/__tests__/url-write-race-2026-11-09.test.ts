/**
 * 地址栏写回竞态 · 回归（2026-11-09 运营视角逐页走查）。
 *
 * 实况：点侧栏「审计日志」页面切过去了、地址栏却还停在 /admin/overview（从执行日志进则是
 * /admin/execution-logs），刷新/复制链接/浏览器后退全落错页；「运营中心」同类竞态偶现
 * （总览 → 运营中心、用户账号 → 运营中心中招，执行日志 → 运营中心侥幸正常）。
 *
 * 根因：场景切换由 AdminConsole 的 `watch(scene)` **异步 push** `/admin/<id>`，而页面组件在
 * push 落地之前就挂载了——此刻 route 仍在上一页，页面挂载期那记**不带 path** 的
 * `router.replace({ query })` 以「当前 route」解析，把在途 push 顶掉。
 *
 * 本文件锁两条契约：
 *  1) 挂载期不得在「上一页路径」上写回（路径没落到本场景就什么都不写）；
 *  2) 所有写回显式带 path，不再依赖「当前 route」是谁。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

const h = vi.hoisted(() => ({
  stats: { byStatus: { active: 0, completed: 0, failed: 0, archived: 0 } } as Record<string, unknown>,
  getLogs: vi.fn(),
  getStats: vi.fn(),
}))

const { apiObject } = vi.hoisted(() => ({
  apiObject: (): Record<string, unknown> =>
    new Proxy({} as Record<string, unknown>, {
      get: (_t, prop) => {
        if (typeof prop !== 'string' || prop === 'then') return undefined
        return vi.fn(async () => ({ data: {} }))
      },
    }),
}))

vi.mock('@/api/adminApi', () => ({
  adminAuditApi: { getAuditLogs: h.getLogs, getAuditStats: h.getStats },
  adminFeedbackApi: {
    list: vi.fn(async () => ({ data: { data: [], pagination: { total: 0 } } })),
    getTrend: vi.fn(async () => ({ data: { data: [] } })),
  },
  adminLearningContentApi: { getStats: vi.fn(async () => ({ data: { data: h.stats } })) },
  adminDevtoolsApi: { getOutboxDead: vi.fn(async () => ({ data: { data: { deadCount: 0 } } })) },
  adminAgentsApi: apiObject(),
  adminDashboardApi: apiObject(),
  adminSkillsApi: apiObject(),
  adminUsersApi: apiObject(),
  adminLearnerModelsApi: apiObject(),
  adminVirtualLearnersApi: apiObject(),
  adminApiConfigApi: apiObject(),
  adminPromptOpsApi: apiObject(),
  adminAgentTopologyApi: apiObject(),
  adminPlatformSettingsApi: apiObject(),
  adminAnnouncementsApi: apiObject(),
  adminGoalConversationsApi: apiObject(),
  adminRuntimeDefinitionsApi: apiObject(),
}))
vi.mock('../live', async () => {
  const { ref } = await import('vue')
  return {
    timeAgo: () => 'x',
    liveAnnouncements: ref<Array<Record<string, unknown>>>([]),
    liveFailures: ref<Record<string, string>>({}),
    liveLoading: ref(false),
    liveRefreshSeq: ref(0),
    setLiveOpsPendingCounts: () => {},
    loadLiveData: vi.fn(async () => {}),
    errMsg: (e: unknown) => String(e),
    liveCreateAnnouncement: vi.fn(async () => {}),
    liveUpdateAnnouncement: vi.fn(async () => {}),
    livePublishAnnouncement: vi.fn(async () => {}),
    liveArchiveAnnouncement: vi.fn(async () => {}),
    liveDeleteAnnouncement: vi.fn(async () => {}),
    totalPagesOf: (total: number, pageSize: number) =>
      Math.max(1, Math.ceil(total / Math.max(1, pageSize))),
    isPageCacheFresh: () => false,
    markPageFetched: vi.fn(),
  }
})
vi.mock('../store', async () => {
  const { ref } = await import('vue')
  return { intent: {}, dataSource: ref('live'), isLive: ref(true) }
})

import AuditLogs from '../AuditLogs.vue'
import OpsHub from '../OpsHub.vue'
import { chooseFilter } from './filter-controls'

const here = dirname(fileURLToPath(import.meta.url))
const AUDIT_SRC = readFileSync(resolve(here, '../AuditLogs.vue'), 'utf8')
const OPSHUB_SRC = readFileSync(resolve(here, '../OpsHub.vue'), 'utf8')

/** 与 app 同形的场景路由：`/admin/:page?` 由 AdminConsole 按 page 解析场景 id */
function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/admin/:page?', component: { template: '<div />' } }],
  })
}

async function mountAt(path: string, comp: unknown) {
  const router = makeRouter()
  await router.push(path)
  await router.isReady()
  const w = mount(comp as never, { global: { plugins: [router] } })
  await flushPromises()
  return { w, router }
}

beforeEach(() => {
  h.getLogs.mockReset()
  h.getStats.mockReset()
  h.getLogs.mockResolvedValue({
    data: { data: { logs: [], attempts: [], pagination: { total: 0, page: 1, limit: 30 } } },
  })
  h.getStats.mockResolvedValue({ data: { data: { stats: { total: 0, failed: 0 }, failureByAction: [] } } })
})

describe('审计日志 · 挂载期不写上一页路径', () => {
  it('mount 时 route 仍在别的场景 → 一次导航都不发（旧实现会写回上一页并顶掉在途 push）', async () => {
    const router = makeRouter()
    await router.push('/admin/overview')
    await router.isReady()
    const replace = vi.spyOn(router, 'replace')
    const push = vi.spyOn(router, 'push')

    const w = mount(AuditLogs, { global: { plugins: [router] } })
    await flushPromises()

    expect(router.currentRoute.value.path, '不得把上一页改写成本场景').toBe('/admin/overview')
    expect(replace).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
    expect(Object.keys(router.currentRoute.value.query)).toEqual([])
    w.unmount()
  })

  it('路径落到本场景后，改筛选写回本场景路径（显式带 path，不依赖当前 route）', async () => {
    const { w, router } = await mountAt('/admin/audit-logs', AuditLogs)

    await chooseFilter(w, '状态', '仅失败')
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/admin/audit-logs')
    expect(router.currentRoute.value.query.failed).toBe('1')
    w.unmount()
  })

  it('源码契约：两条写回都带 path，且挂载路径不匹配时直接返回', () => {
    expect(AUDIT_SRC).toMatch(/const AUDIT_SCENE_PATH = '\/admin\/audit-logs'/)
    expect(AUDIT_SRC).toMatch(/if \(route\.path !== AUDIT_SCENE_PATH\) return/)
    // 不带 path 的 replace 会把「当前 route」当成目标——两条写回都必须显式给 path
    expect(AUDIT_SRC).toContain('void router.replace({ path: AUDIT_SCENE_PATH, query: q })')
    expect(AUDIT_SRC).toContain('void router.replace({ path: AUDIT_SCENE_PATH, query: next })')
    expect(AUDIT_SRC).not.toMatch(/router\.replace\(\{ query:/)
  })
})

describe('运营中心 · 默认预筛等路径就位后再写', () => {
  it('mount 时 route 仍在 /admin/overview → 不在总览上写 ?tab=feedback（走查实测的错写）', async () => {
    const router = makeRouter()
    await router.push('/admin/overview')
    await router.isReady()

    const w = mount(OpsHub, { global: { plugins: [router] } })
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/admin/overview')
    expect(router.currentRoute.value.query).toEqual({})
    w.unmount()
  })

  it('路径落到本场景后才补默认预筛（裸进入仍是可刷新/可分享的待处理视图）', async () => {
    const { w, router } = await mountAt('/admin/ops-hub', OpsHub)

    expect(router.currentRoute.value.path).toBe('/admin/ops-hub')
    expect(router.currentRoute.value.query).toEqual({ tab: 'feedback', status: 'new' })
    w.unmount()
  })

  it('已有预筛的深链不被默认值覆盖（角标进入 ?range=week&status=err）', async () => {
    const { w, router } = await mountAt('/admin/ops-hub?range=week&status=err', OpsHub)

    expect(router.currentRoute.value.query).toEqual({ range: 'week', status: 'err' })
    w.unmount()
  })

  it('源码契约：默认预筛挂在 route.path watch 上，onMounted 不再写 URL', () => {
    expect(OPSHUB_SRC).toMatch(/const OPS_HUB_PATH = '\/admin\/ops-hub'/)
    expect(OPSHUB_SRC).toMatch(/watch\(\s*\(\) => route\?\.path,/)
    expect(OPSHUB_SRC).toContain('void router.replace({ path: OPS_HUB_PATH, query: { ...route.query, tab: \'feedback\', status: \'new\' } })')
    // onMounted 只拉数据，不再碰地址栏
    const onMounted = OPSHUB_SRC.slice(OPSHUB_SRC.indexOf('onMounted(() => {'))
    expect(onMounted.slice(0, 200)).not.toContain('router.replace')
  })
})
