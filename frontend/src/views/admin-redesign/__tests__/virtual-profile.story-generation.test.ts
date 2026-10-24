/**
 * 画像 · 故事池（2026-10-24 用户「生成故事做的太简单，故事池设计得太乱」）：
 *  - 生成故事改为弹窗：样本 / 方向 / 数量，数量 N 时依次调用 N 次并带同一方向；
 *  - 列表状态中文化（completed/pending 不再裸透英文）；
 *  - 单选的 radio 圈撤除（只留批量 checkbox + 行底色）；
 *  - 场景诊断从行内折叠区迁进弹窗。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'

const h = vi.hoisted(() => ({
  stories: [] as Record<string, unknown>[],
  draft: vi.fn(async () => ({ data: {} })),
}))

const { apiObject } = vi.hoisted(() => ({
  apiObject: (custom: Record<string, unknown>): Record<string, unknown> =>
    new Proxy(custom, {
      get: (target, prop) => {
        if (typeof prop !== 'string' || prop === 'then') return undefined
        if (prop in target) return (target as Record<string, unknown>)[prop]
        return vi.fn(async () => ({ data: {} }))
      }
    })
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
      profile: { id: 'p1', nickname: '孙浩', storyPool: h.stories },
      userId: 'u1',
      sessions: [],
    })),
    timeAgo: () => '1 天前',
    errMsg: (e: unknown) => String(e),
    refreshLiveVirtuals: vi.fn(),
  }
})
vi.mock('@/api/adminApi', () => ({
  adminVirtualLearnersApi: apiObject({ draftVirtualLearnerStories: h.draft }),
  adminLearnerModelsApi: apiObject({}),
}))

import VirtualProfile from '../VirtualProfile.vue'
import { subPage } from '../store'
import { toast } from '@/utils/toast'

const MkSubTabsStub = defineComponent({
  props: { tabs: { type: Array, default: () => [] }, modelValue: { type: String, default: '' } },
  emits: ['update:modelValue'],
  template: `<div><button v-for="t in tabs" :key="t.key" type="button" class="tab-stub" @click="$emit('update:modelValue', t.key)">{{ t.label }}</button></div>`,
})

async function mountStories() {
  /* mount（非 shallow）：生成/诊断弹窗用 Teleport 挂到 body，shallowMount 会把内容整个桩掉。
     其余子组件按 shallow 的粒度手动桩掉，避免把图表/运行态组件一起拉起来。 */
  const w = mount(VirtualProfile, {
    attachTo: document.body,
    global: {
      stubs: {
        teleport: true,
        MkSubTabs: MkSubTabsStub,
        VirtualLearnerLaunch: { template: '<div />' },
        MkDetailHero: true,
        MkLoading: true,
        MkEmptyState: true,
        MkSkeleton: true,
        MkKpi: true,
        RunStateBadge: true,
        RunStageBar: true,
        MemoryCurve: true,
      },
    },
  })
  await flushPromises()
  await nextTick()
  await flushPromises()
  const storiesTab = w.findAll('.tab-stub').find((b) => b.text().includes('故事池'))
  if (!storiesTab) throw new Error('故事池 tab 未渲染')
  await storiesTab.trigger('click')
  await nextTick()
  return w
}

function buttonByText(w: ReturnType<typeof mount>, text: string) {
  const b = w.findAll('button').find((x) => x.text().trim() === text)
  if (!b) throw new Error(`button not found: ${text}`)
  return b
}

beforeEach(() => {
  h.draft.mockClear()
  ;(toast.success as unknown as ReturnType<typeof vi.fn>).mockClear()
  h.stories = [
    {
      storyId: 's1',
      storyTitle: '永远做不完的理综',
      storyOutline: '二模理综又没做完。',
      status: 'completed',
      misdiagnosis: '以为是熟练度不够，其实是用时策略问题。',
    },
    { storyId: 's2', storyTitle: '化学实验题的陷阱', status: 'pending' },
  ]
  subPage.value = { view: 'virtual', id: 'p1', label: '孙浩' }
})

describe('生成故事弹窗', () => {
  it('默认「通用 / 1 个」，可切传统学生、填方向、选 2 个后依次生成', async () => {
    const w = await mountStories()
    await buttonByText(w, '生成故事').trigger('click')
    await nextTick()

    const dialog = w.find('[role="dialog"][aria-label="生成故事"]')
    expect(dialog.exists()).toBe(true)
    await dialog.findAll('[role="radio"]').find((b) => b.text().includes('传统学生'))!.trigger('click')
    await dialog.find('input.mk-field__input').setValue('  化学实验误差分析  ')
    await dialog.findAll('[role="radio"]').find((b) => b.text().includes('2 个'))!.trigger('click')
    await buttonByText(w, '开始生成').trigger('click')
    await flushPromises()

    expect(h.draft).toHaveBeenCalledTimes(2)
    expect(h.draft).toHaveBeenNthCalledWith(1, 'p1', { sampleType: 'student', direction: '化学实验误差分析' })
    expect(toast.success).toHaveBeenCalledWith('已生成 2 个故事')
    expect(w.find('[role="dialog"][aria-label="生成故事"]').exists()).toBe(false)
    w.unmount()
  })

  it('通用 + 不填方向 → 不传空字段', async () => {
    const w = await mountStories()
    await buttonByText(w, '生成故事').trigger('click')
    await nextTick()
    await buttonByText(w, '开始生成').trigger('click')
    await flushPromises()
    expect(h.draft).toHaveBeenCalledWith('p1', undefined)
    w.unmount()
  })
})

describe('故事池列表', () => {
  it('状态中文化：completed → 已完成、pending → 待运行', async () => {
    const w = await mountStories()
    const badges = w.findAll('.vp-story__meta .mk-badge').map((b) => b.text())
    expect(badges).toContain('已完成')
    expect(badges).toContain('待运行')
    expect(badges.join(' ')).not.toContain('completed')
    expect(badges.join(' ')).not.toContain('pending')
    w.unmount()
  })

  it('不再渲染单选圆圈，也没有行内「高级诊断」折叠区', async () => {
    const w = await mountStories()
    expect(w.findAll('.vp-story__radio')).toHaveLength(0)
    expect(w.find('.vp-story__diag').exists()).toBe(false)
    expect(w.text()).not.toContain('高级诊断')
    w.unmount()
  })

  it('场景诊断在 ⋯ 菜单里打开弹窗，含易误诊与原始结构', async () => {
    const w = await mountStories()
    await w.findAll('.vp-story .mk-menu__btn')[0].trigger('click')
    await nextTick()
    const item = w.findAll('.mk-menu__pop .mk-menu__item').find((b) => b.text() === '场景诊断')!
    await item.trigger('click')
    await nextTick()
    const dialog = w.find('[role="dialog"][aria-label="场景诊断"]')
    expect(dialog.exists()).toBe(true)
    expect(dialog.text()).toContain('易误诊')
    expect(dialog.text()).toContain('用时策略问题')
    w.unmount()
  })
})
