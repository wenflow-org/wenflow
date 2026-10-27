/**
 * MkPillSelect（卡头维度下拉）行为测试。
 *
 * 2026-10-27 用户「这个下拉，完全没有设计」后的收口：
 * - 展开的是自绘 listbox，不是浏览器原生 <select> 弹层；
 * - 触发器带 combobox 语义（aria-expanded / aria-controls / aria-activedescendant）；
 * - 键盘可用：↑↓ 移动、Enter 选中、Esc 关闭；
 * - 点外部关闭；选中行有勾、激活态仍由 active 驱动。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import MkPillSelect from '../MkPillSelect.vue'

const OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'failed', label: '失败（3）' },
  { value: 'active', label: '进行中（2）' }
]

function harness(initial = '', active = false) {
  const Harness = defineComponent({
    components: { MkPillSelect },
    setup() {
      const value = ref(initial)
      return { value, active, OPTIONS }
    },
    template: `<MkPillSelect v-model="value" label="状态" aria-label="按状态筛选"
                 :options="OPTIONS" :active="active" />`
  })
  return mount(Harness, { attachTo: document.body })
}

const trigger = (w: ReturnType<typeof harness>) => w.find('button.mk-pillselect')
const options = (w: ReturnType<typeof harness>) => w.findAll('.mk-listbox-opt')
const menu = (w: ReturnType<typeof harness>) => w.find('ul.mk-pillselect__menu')

describe('MkPillSelect · 自绘 listbox', () => {
  it('触发器显示当前值，关闭态弹层不可见但仍在 DOM', () => {
    const w = harness('active')
    expect(trigger(w).find('.mk-pillselect__txt').text()).toBe('进行中（2）')
    expect(trigger(w).attributes('data-value')).toBe('active')
    expect(trigger(w).attributes('aria-expanded')).toBe('false')
    expect(menu(w).isVisible()).toBe(false)
    expect(options(w)).toHaveLength(3)
    w.unmount()
  })

  it('点击展开 → 选中行有勾；点选项回写并关闭', async () => {
    const w = harness('')
    await trigger(w).trigger('click')
    expect(trigger(w).attributes('aria-expanded')).toBe('true')
    expect(menu(w).isVisible()).toBe(true)
    // 展开时焦点行落在当前值（「全部状态」）
    expect(options(w)[0].classes()).toContain('is-active')
    expect(options(w)[0].find('svg').exists()).toBe(true)
    expect(options(w)[1].find('svg').exists()).toBe(false)

    await options(w)[1].trigger('click')
    expect(trigger(w).attributes('data-value')).toBe('failed')
    expect(trigger(w).attributes('aria-expanded')).toBe('false')
    expect(options(w)[1].classes()).toContain('is-selected')
    w.unmount()
  })

  it('键盘：↓ 移动焦点行、Enter 选中、Esc 关闭且不改值', async () => {
    const w = harness('')
    await trigger(w).trigger('keydown', { key: 'ArrowDown' })
    expect(menu(w).isVisible()).toBe(true)
    await trigger(w).trigger('keydown', { key: 'ArrowDown' })
    expect(options(w)[1].classes()).toContain('is-active')
    await trigger(w).trigger('keydown', { key: 'Enter' })
    expect(trigger(w).attributes('data-value')).toBe('failed')

    await trigger(w).trigger('keydown', { key: 'ArrowDown' })
    await trigger(w).trigger('keydown', { key: 'Escape' })
    expect(trigger(w).attributes('aria-expanded')).toBe('false')
    expect(trigger(w).attributes('data-value')).toBe('failed')
    w.unmount()
  })

  it('点击组件外部关闭', async () => {
    const w = harness('')
    await trigger(w).trigger('click')
    expect(menu(w).isVisible()).toBe(true)
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await w.vm.$nextTick()
    expect(trigger(w).attributes('aria-expanded')).toBe('false')
    w.unmount()
  })

  it('active 决定胶囊激活态（与是否展开无关）', () => {
    const off = harness('failed', false)
    expect(trigger(off).classes()).not.toContain('mk-pill--active')
    off.unmount()
    const on = harness('failed', true)
    expect(trigger(on).classes()).toContain('mk-pill--active')
    on.unmount()
  })
})
