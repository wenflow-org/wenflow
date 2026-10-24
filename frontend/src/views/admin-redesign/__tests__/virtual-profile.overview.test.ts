/**
 * 虚拟学习者概览的针对性调整（2026-10-24 用户「概览也要针对性的优化调整一下」）：
 *  1. 零运行画像：五环不再全绿（此前 toneOf 全部落 done），只有入口环 active、其余虚线待办，
 *     卡头标「尚未运行」；
 *  2. 零运行画像：四读数全 0 不冒充「取样过」，按无读数渲染空态；
 *  3. 概览新增「最近运行」卡（故事 / 终态 / 任务 / 回合 / 时长），运行次数不再在画像 kv 里复读。
 * 数据来源：详情接口 sessions + 绑定账号学习者模型 dynamicState.lessonMetrics。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { nextTick } from 'vue'

const stub = vi.hoisted(() => ({
  sessions: [] as Record<string, unknown>[],
  metrics: null as Record<string, number> | null,
}))

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/utils/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))
vi.mock('../live', async () => {
  const { ref } = await import('vue')
  return {
    liveVirtuals: ref([]),
    liveGetVirtualDetail: vi.fn(async () => ({
      profile: { id: 'p1', nickname: '零运行画像', occupation: '备考生' },
      userId: 'u1',
      sessions: stub.sessions,
    })),
    timeAgo: () => '1 天前',
    errMsg: (e: unknown) => String(e),
  }
})
vi.mock('@/api/adminApi', () => ({
  adminVirtualLearnersApi: new Proxy({}, { get: () => vi.fn(async () => ({ data: {} })) }),
  adminLearnerModelsApi: {
    getDetail: vi.fn(async () => ({
      data: {
        data: {
          dynamicState: { lessonMetrics: stub.metrics },
          freshness: { generatedAt: '2026-10-24T01:00:00Z' },
        },
      },
    })),
  },
}))

import VirtualProfile from '../VirtualProfile.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import { subPage } from '../store'

async function mountOverview() {
  const w = shallowMount(VirtualProfile)
  await flushPromises()
  await nextTick()
  await flushPromises()
  await nextTick()
  return w
}

beforeEach(() => {
  subPage.value = { view: 'virtual', id: 'p1', label: '零运行画像' }
  stub.sessions = []
  stub.metrics = null
})

describe('VirtualProfile 概览 · 零运行画像', () => {
  it('四读数全 0 → 空态，不挂 0.0 的条', async () => {
    stub.metrics = { lss: 0, ktl: 0, lf: 0, lsb: 0 }
    const w = await mountOverview()
    expect(w.findAll('.lsm__row')).toHaveLength(0)
    const lesson = w.findAllComponents(MkEmptyState).find((c) => c.props('title') === '暂无学习状态读数')
    expect(lesson, '全 0 读数应渲染空态').toBeTruthy()
    expect(lesson!.props('description')).toContain('还没有运行过课程')
    w.unmount()
  })

  it('五环只有入口环 active，其余虚线待办，卡头标「尚未运行」', async () => {
    const w = await mountOverview()
    expect(w.findAll('.loop__step--active')).toHaveLength(1)
    expect(w.findAll('.loop__step--idle')).toHaveLength(4)
    expect(w.findAll('.loop__step--done')).toHaveLength(0)
    expect(w.text()).toContain('尚未运行')
    const empties = w.findAllComponents(MkEmptyState).map((c) => c.props('title'))
    expect(empties).toContain('暂无运行记录')
    w.unmount()
  })

  it('画像设定不再复读运行次数（次数在状态条，「最近运行」卡回答上次跑到哪）', async () => {
    const w = await mountOverview()
    expect(w.find('.vp-kv').text()).not.toContain('运行信息')
    expect(w.find('.vp-lastrun').exists()).toBe(false)
    w.unmount()
  })
})

describe('VirtualProfile 概览 · 有运行的画像', () => {
  beforeEach(() => {
    stub.sessions = [{
      id: 's1',
      status: 'completed',
      createdAt: '2026-10-23T00:00:00Z',
      updatedAt: '2026-10-23T02:00:00Z',
      completedTasks: 3,
      totalTasks: 10,
      roundCount: 7,
      currentStage: 'learn',
      storyContext: { storyId: 'st1', title: '永远做不完的理综' },
    }]
    stub.metrics = { lss: 2.2, ktl: 0.6, lf: 3.3, lsb: -2.7 }
  })

  it('最近运行卡给出故事 / 任务 / 回合 / 时长', async () => {
    const w = await mountOverview()
    expect(w.find('.vp-lastrun__story').text()).toBe('永远做不完的理综')
    const meta = w.find('.vp-lastrun__meta').text()
    expect(meta).toContain('任务 3/10')
    expect(meta).toContain('7 回合')
    expect(meta).toContain('2 小时')
    w.unmount()
  })

  it('有运行：有真实读数，闭环按当前阶段高亮而不是「尚未运行」', async () => {
    const w = await mountOverview()
    expect(w.findAll('.lsm__row')).toHaveLength(4)
    expect(w.findAll('.loop__step--idle')).toHaveLength(0)
    expect(w.findAll('.loop__step--active')).toHaveLength(1)
    expect(w.text()).not.toContain('尚未运行')
    w.unmount()
  })
})
