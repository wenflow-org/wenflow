/**
 * MkModelPicker（2026-10-20 走查新增原语）。
 *
 * 钉的是「选择语义」而不是外观：
 * - 继承是一条显式选项（此前空输入框承担继承语义，运营看不出「不填 = 继承什么」）；
 * - 候选按供应商分组、带层级/能力标注；搜索能按供应商名命中；
 * - 注册表外的合法值（别名、聚合网关 id）允许直接按输入提交，但必须显式出现在候选里；
 * - exclude 用于备用链：主模型与已选备用不再出现在候选里。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import MkModelPicker, { type MkModelOption } from '../MkModelPicker.vue'

const OPTIONS: MkModelOption[] = [
  {
    value: 'deepseek-v4.1-flash',
    label: 'DeepSeek V4.1 Flash',
    tier: 'chat',
    providerName: '平台',
    thinking: true,
    reasoning: true,
    priceIn: 0.3,
    priceOut: 1.2
  },
  {
    value: 'agnes-3.0-flash',
    label: 'Agnes 3.0 Flash',
    tier: 'chat',
    providerName: '平台',
    priceIn: 0.03,
    priceOut: 0.15
  },
  {
    value: 'acme-vision',
    label: 'Acme Vision',
    tier: 'reasoning',
    providerName: 'Acme 网关',
    vision: true
  }
]

function mountPicker(props: Record<string, unknown> = {}) {
  return mount(MkModelPicker, {
    props: { modelValue: '', options: OPTIONS, ...props },
    attachTo: document.body,
    // 候选层 Teleport 到 body；测试里原地渲染，选择器才能从 wrapper 找到
    global: { stubs: { teleport: true } }
  })
}

async function openPicker(w: ReturnType<typeof mountPicker>) {
  await w.find('.mk-mp__control').trigger('click')
  await w.vm.$nextTick()
}

describe('MkModelPicker', () => {
  it('关闭态显示当前模型与显示名；未选且允许继承时显示继承文案', async () => {
    const w = mountPicker({ modelValue: 'deepseek-v4.1-flash' })
    expect(w.find('.mk-mp__value').text()).toBe('deepseek-v4.1-flash')
    // 关闭态只出模型 ID（窄列里长 ID 会被显示名挤成省略号）；显示名挂在 title
    expect(w.find('.mk-mp__control').attributes('title')).toBe('deepseek-v4.1-flash · DeepSeek V4.1 Flash')

    const empty = mountPicker({ allowInherit: true, inheritLabel: '继承 Agent / 平台默认' })
    expect(empty.find('.mk-mp__value').text()).toBe('继承 Agent / 平台默认')
    expect(empty.find('.mk-mp__value').classes()).toContain('mk-mp__value--empty')
    w.unmount()
    empty.unmount()
  })

  it('打开后按供应商分组，平台默认行置顶，选中它清空值', async () => {
    const w = mountPicker({ modelValue: 'agnes-3.0-flash', allowInherit: true })
    await openPicker(w)
    expect(w.findAll('.mk-mp__group').map((g) => g.text())).toEqual(['平台', 'Acme 网关'])
    const labels = w.findAll('.mk-mp__opt').map((o) => o.find('.mk-mp__id').text())
    expect(labels).toEqual(['用平台默认模型', 'deepseek-v4.1-flash', 'agnes-3.0-flash', 'acme-vision'])

    await w.findAll('.mk-mp__opt')[0].trigger('click')
    expect(w.emitted('update:modelValue')?.[0]).toEqual([''])
    expect(w.emitted('pick')?.[0]).toEqual([null])
    w.unmount()
  })

  it('搜索可按供应商名命中，未命中时提供「按输入的模型 ID 使用」', async () => {
    const w = mountPicker()
    await openPicker(w)
    const search = w.find('.mk-mp__search')
    await search.setValue('acme')
    expect(w.findAll('.mk-mp__opt').map((o) => o.find('.mk-mp__id').text())).toEqual(['acme-vision'])

    await search.setValue('my-gateway/model-x')
    const rows = w.findAll('.mk-mp__opt')
    expect(rows).toHaveLength(1)
    expect(rows[0].find('.mk-mp__id').text()).toBe('my-gateway/model-x')
    expect(rows[0].find('.mk-mp__opt-note').text()).toBe('注册表外的值')

    await rows[0].trigger('click')
    expect(w.emitted('pick')?.[0]?.[0]).toMatchObject({ value: 'my-gateway/model-x' })
    w.unmount()
  })

  it('关闭 allowCustom 后不再把输入当模型 ID', async () => {
    const w = mountPicker({ allowCustom: false })
    await openPicker(w)
    await w.find('.mk-mp__search').setValue('my-gateway/model-x')
    expect(w.findAll('.mk-mp__opt')).toHaveLength(0)
    expect(w.find('.mk-mp__empty').text()).toBe('没有匹配的模型')
    w.unmount()
  })

  it('exclude 隐藏主模型与已选备用；层级不同的候选带标注但仍可选', async () => {
    const w = mountPicker({
      tier: 'chat',
      exclude: ['agnes-3.0-flash'],
      modelValue: ''
    })
    await openPicker(w)
    const ids = w.findAll('.mk-mp__opt').map((o) => o.find('.mk-mp__id').text())
    expect(ids).not.toContain('agnes-3.0-flash')
    const mismatch = w.findAll('.mk-mp__opt').find((o) => o.classes().includes('is-mismatch'))
    expect(mismatch?.find('.mk-mp__id').text()).toBe('acme-vision')

    await mismatch!.trigger('click')
    expect(w.emitted('pick')?.[0]?.[0]).toMatchObject({ value: 'acme-vision', tier: 'reasoning' })
    w.unmount()
  })

  it('键盘：方向键移动、回车选中', async () => {
    const w = mountPicker()
    await openPicker(w)
    const search = w.find('.mk-mp__search')
    await search.trigger('keydown', { key: 'ArrowDown' })
    await search.trigger('keydown', { key: 'Enter' })
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['deepseek-v4.1-flash'])
    w.unmount()
  })

  it('清除按钮清空值并发出 pick(null)', async () => {
    const w = mountPicker({ modelValue: 'deepseek-v4.1-flash' })
    await w.find('.mk-mp__clear').trigger('click')
    expect(w.emitted('update:modelValue')?.[0]).toEqual([''])
    expect(w.emitted('pick')?.[0]).toEqual([null])
    w.unmount()
  })

  it('disabled 时不打开列表', async () => {
    const w = mountPicker({ disabled: true })
    await openPicker(w)
    expect(w.find('.mk-mp__pop').exists()).toBe(false)
    w.unmount()
  })
})
