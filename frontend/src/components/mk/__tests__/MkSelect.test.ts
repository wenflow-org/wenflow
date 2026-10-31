/**
 * MkSelect（原生 <select> 的自绘替代）行为测试。
 *
 * 2026-10-27 用户「这个下拉，完全没有设计」后的第二批：
 * - 展开的是 listbox，不是系统弹层；
 * - v-model 保留原值类型（string / number / boolean 三态）；
 * - 选中同时发 update:modelValue 与 change，原生 @change 调用方可只换标签；
 * - 键盘（↑↓ / Enter / Esc）、禁用、空选项占位。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import MkSelect from '../MkSelect.vue'

const STRING_OPTIONS = [
  { value: '', label: '全部角色' },
  { value: 'learner', label: '学习者' },
  { value: 'teacher', label: '教师' }
]

function harness(initial: unknown, options: unknown = STRING_OPTIONS, extra = '') {
  const Harness = defineComponent({
    components: { MkSelect },
    setup() {
      const value = ref(initial)
      return { value, options }
    },
    template: `<MkSelect v-model="value" :options="options" aria-label="测试下拉" ${extra} />`
  })
  return mount(Harness, { attachTo: document.body })
}

const trigger = (w: ReturnType<typeof harness>) => w.find('button[aria-label="测试下拉"]')
const options = (w: ReturnType<typeof harness>) => w.findAll('.mk-listbox-opt')
const menu = (w: ReturnType<typeof harness>) => w.find('ul.mk-select__menu')

describe('MkSelect · 自绘 listbox', () => {
  it('闭合态显示当前值，弹层不可见但选项在 DOM', () => {
    const w = harness('teacher')
    expect(trigger(w).text()).toBe('教师')
    expect(trigger(w).attributes('data-value')).toBe('teacher')
    expect(trigger(w).attributes('aria-expanded')).toBe('false')
    expect(menu(w).isVisible()).toBe(false)
    expect(options(w)).toHaveLength(3)
    w.unmount()
  })

  it('展开 → 选中行有勾；点选项回写并同时发 change', async () => {
    const w = harness('')
    await trigger(w).trigger('click')
    expect(menu(w).isVisible()).toBe(true)
    expect(options(w)[0].find('svg').exists()).toBe(true)
    await options(w)[1].trigger('click')
    expect(trigger(w).attributes('data-value')).toBe('learner')
    expect(trigger(w).attributes('aria-expanded')).toBe('false')
    expect((w.vm as unknown as { value: string }).value).toBe('learner')
    // 子组件同时发 update:modelValue 与 change
    const child = w.findComponent(MkSelect) as unknown as {
      emitted: (name: string) => unknown[][] | undefined
    }
    expect(child.emitted('update:modelValue')?.at(-1)).toEqual(['learner'])
    expect(child.emitted('change')?.at(-1)).toEqual(['learner'])
    w.unmount()
  })

  it('键盘：↓ 展开并移动、Enter 选中、Esc 关闭', async () => {
    const w = harness('')
    await trigger(w).trigger('keydown', { key: 'ArrowDown' })
    expect(menu(w).isVisible()).toBe(true)
    await trigger(w).trigger('keydown', { key: 'ArrowDown' })
    expect(options(w)[1].classes()).toContain('is-active')
    await trigger(w).trigger('keydown', { key: 'Enter' })
    expect(trigger(w).attributes('data-value')).toBe('learner')
    await trigger(w).trigger('keydown', { key: 'ArrowDown' })
    await trigger(w).trigger('keydown', { key: 'Escape' })
    expect(trigger(w).attributes('aria-expanded')).toBe('false')
    expect(trigger(w).attributes('data-value')).toBe('learner')
    w.unmount()
  })

  it('number 值不被字符串化（分页每页条数）', async () => {
    const w = harness(30, [
      { value: 15, label: '15 条/页' },
      { value: 30, label: '30 条/页' },
      { value: 50, label: '50 条/页' }
    ])
    expect(trigger(w).attributes('data-value')).toBe('30')
    await trigger(w).trigger('click')
    await options(w)[2].trigger('click')
    expect((w.vm as unknown as { value: number }).value).toBe(50)
    w.unmount()
  })

  it('boolean 三态：undefined 档可被精确选中，不与空串混为一谈', async () => {
    const w = harness(undefined, [
      { value: undefined, label: '全部' },
      { value: true, label: '成功' },
      { value: false, label: '失败' }
    ])
    expect(trigger(w).text()).toBe('全部')
    await trigger(w).trigger('click')
    await options(w)[2].trigger('click')
    expect((w.vm as unknown as { value: unknown }).value).toBe(false)
    expect(trigger(w).text()).toBe('失败')
    w.unmount()
  })

  it('禁用时按钮不可点；无选项时弹层给占位行', async () => {
    const disabled = harness('', STRING_OPTIONS, 'disabled')
    expect(trigger(disabled).attributes('disabled')).toBeDefined()
    disabled.unmount()

    const empty = harness('', [])
    await trigger(empty).trigger('click')
    expect(empty.find('.mk-select__empty').text()).toBe('请选择')
    empty.unmount()
  })
})
