/**
 * 虚拟学习者层级收口（2026-10-24「做完整修复」）：
 *  1. 画像页头补页面级「运行」——此前启动入口只在故事行，从学习详情反跳进来没有下一步；
 *  2. ⋯「记忆与复习」走 openSubPage（保留来源、可返回），落点与菜单同名（memory 页签），
 *     不再 router.push 到另一个组的一级页并丢掉上下文；
 *  3. 派生实例的卡入口打开 derivedFrom 原卡（见 card-learner-cross-link.test.ts）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'

const stub = vi.hoisted(() => ({
  stories: [] as Record<string, unknown>[],
  userId: 'u1' as string,
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
      profile: {
        id: 'p1',
        nickname: '孙浩',
        occupation: '高三理科生',
        storyPool: stub.stories,
      },
      userId: stub.userId,
      sessions: [],
    })),
    timeAgo: () => '1 天前',
    errMsg: (e: unknown) => String(e),
    refreshLiveVirtuals: vi.fn(),
  }
})
vi.mock('@/api/adminApi', () => ({
  adminVirtualLearnersApi: new Proxy({}, { get: () => vi.fn(async () => ({ data: {} })) }),
  adminLearnerModelsApi: { getDetail: vi.fn(async () => ({ data: { data: {} } })) },
}))

import VirtualProfile from '../VirtualProfile.vue'
import { subPage } from '../store'

const launchOpen = vi.fn()
/** 页签原语被 shallowMount 置空 → 给一个能真实切换的桩，才能进「记忆池」页签 */
const MkSubTabsStub = defineComponent({
  props: { tabs: { type: Array, default: () => [] }, modelValue: { type: String, default: '' } },
  emits: ['update:modelValue'],
  template: `<div class="tabs-stub">
    <button v-for="t in tabs" :key="t.key" type="button" @click="$emit('update:modelValue', t.key)">{{ t.label }}</button>
  </div>`,
})
async function mountProfile() {
  const w = shallowMount(VirtualProfile, {
    global: {
      stubs: {
        // launch 组件自身有接口与 Teleport，这里只验证宿主把「运行」接到了 open()
        VirtualLearnerLaunch: { template: '<div class="launch-stub" />', methods: { open: launchOpen } },
        MkSubTabs: MkSubTabsStub,
      },
    },
  })
  await flushPromises()
  await nextTick()
  await flushPromises()
  return w
}

function menuItem(w: ReturnType<typeof shallowMount>, text: string) {
  return w.findAll('.mk-menu__pop .mk-menu__item').find((b) => b.text().includes(text))
}

beforeEach(() => {
  launchOpen.mockClear()
  stub.userId = 'u1'
  stub.stories = [{ storyId: 's1', storyTitle: '永远做不完的理综', status: 'ready' }]
  subPage.value = { view: 'virtual', id: 'p1', label: '孙浩' }
})

describe('画像页 · 页面级运行', () => {
  it('页头有「运行」，点击把当前档案与故事数交给启动弹窗', async () => {
    const w = await mountProfile()
    const run = w.findAll('.mk-entity__actions button').find((b) => b.text() === '运行')
    expect(run, '页头缺运行主操作').toBeTruthy()
    expect(run!.attributes('disabled')).toBeUndefined()
    await run!.trigger('click')
    expect(launchOpen).toHaveBeenCalledWith({ id: 'p1', name: '孙浩', storyCount: 1 })
    w.unmount()
  })

  it('没有故事时「运行」禁用（先生成故事，不弹空选择器）', async () => {
    stub.stories = []
    const w = await mountProfile()
    const run = w.findAll('.mk-entity__actions button').find((b) => b.text() === '运行')
    expect(run!.attributes('disabled')).toBeDefined()
    w.unmount()
  })
})

describe('画像页 · 账号级记忆入口', () => {
  it('⋯ 记忆与复习：openSubPage 到学习详情 memory 页签，并保留来源（可返回画像）', async () => {
    const w = await mountProfile()
    await w.find('.vp-tabsrow__ops .mk-menu__btn').trigger('click')
    await nextTick()
    const item = menuItem(w, '记忆与复习')
    expect(item).toBeTruthy()
    await item!.trigger('click')
    expect(subPage.value).toEqual({
      view: 'learner',
      id: 'u1',
      includeTest: true,
      tab: 'memory',
      from: { view: 'virtual', id: 'p1', label: '画像' },
    })
    expect(w.emitted('click')).toBeUndefined()
    w.unmount()
  })

  it('记忆池卡头有账号级入口（同一落点）', async () => {
    const w = await mountProfile()
    // 切到记忆池页签
    const tab = w.findAll('button').find((b) => b.text().startsWith('记忆池'))
    await tab!.trigger('click')
    await nextTick()
    const link = w.find('.mk-card__head-right .mk-link')
    expect(link.exists()).toBe(true)
    expect(link.text()).toContain('账号级记忆与复习')
    w.unmount()
  })
})
