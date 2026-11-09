/**
 * 公告页签的 ?status= 深链（2026-11-09）。
 *
 * 病根：运营中心 KPI「草稿公告」是**切到公告页签的同一次导航**里把 ?status=draft 写进去的；
 * Announcements 此时才挂载，setup 里读到的仍是旧 route（status 未落地），只在 setup 读一次
 * 会停在「全部状态」——地址栏与列表筛选各说各话。改为 watch(route.query.status) 后，
 * 首挂载与后续 in-place 改 query 都必须对齐；非本页枚举（反馈的 new）必须清空，不把列表
 * 筛成「没有匹配的公告」。
 */
import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { nextTick } from 'vue'

vi.mock('../live', async () => {
  const { ref } = await import('vue')
  return {
    liveAnnouncements: ref([{ id: 'a1', title: '草稿公告', body: '正文', severity: 'info', status: 'draft', publishedAt: null, expiresAt: null, createdAt: '2026-11-01T00:00:00Z' }]),
    liveLoading: ref(false),
    liveFailures: ref({}),
    liveCreateAnnouncement: vi.fn(async () => {}),
    liveUpdateAnnouncement: vi.fn(async () => {}),
    livePublishAnnouncement: vi.fn(async () => {}),
    liveArchiveAnnouncement: vi.fn(async () => {}),
    liveDeleteAnnouncement: vi.fn(async () => {}),
    timeAgo: () => 'x',
    errMsg: (e: unknown) => String(e),
    totalPagesOf: (total: number, pageSize: number) => Math.max(1, Math.ceil(total / Math.max(1, pageSize))),
  }
})
vi.mock('../store', async () => {
  const { ref } = await import('vue')
  return { dataSource: ref('live'), isLive: ref(true), intent: { quickAction: '' } }
})
vi.mock('@/api/adminApi', () => ({ adminAnnouncementsApi: new Proxy({}, { get: () => vi.fn(async () => ({ data: { data: {} } })) }) }))

import Announcements from '../Announcements.vue'

const EmptyRoute = { template: '<div />' }

async function mountAt(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/admin/ops-hub', component: EmptyRoute }],
  })
  await router.push(path)
  await router.isReady()
  const w = mount(Announcements, { props: { embedded: true }, global: { plugins: [router] } })
  await flushPromises()
  await nextTick()
  await flushPromises()
  return { w, router }
}

const statusFilterText = (w: ReturnType<typeof mount>) => w.find('[aria-label="按状态筛选"]').text().replace(/\s+/g, ' ')

describe('Announcements ?status= 深链', () => {
  it('首挂载即按 URL 预筛（?status=draft → 草稿）', async () => {
    const { w } = await mountAt('/admin/ops-hub?tab=announce&status=draft')
    expect(statusFilterText(w)).toContain('草稿')
    w.unmount()
  })

  it('in-place 改 query 跟得上（draft → archived）；非本页枚举回落到全部状态', async () => {
    const { w, router } = await mountAt('/admin/ops-hub?tab=announce&status=draft')
    await router.push('/admin/ops-hub?tab=announce&status=archived')
    await flushPromises()
    expect(statusFilterText(w)).toContain('已下线')

    // 反馈页签留下的 new 不是公告枚举：不得把列表筛成空表
    await router.push('/admin/ops-hub?tab=announce&status=new')
    await flushPromises()
    expect(statusFilterText(w)).toContain('全部')
    w.unmount()
  })
})
