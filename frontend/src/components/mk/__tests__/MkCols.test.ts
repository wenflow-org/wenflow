/**
 * MkCols（列显隐）行为测试。
 *
 * 2026-10-27 用户先「那个列，干嘛的」、后「还是改成列」，最终契约：
 * - 可见文案是单字「列」；可访问名与 title 仍写全「列设置：显示或隐藏表格列」；
 * - 藏过列时入口带计数，菜单头给「显示列 n / m」；
 * - 「恢复默认」回到该页首访默认集（defaultHidden），不是一律全显
 *   —— 目标对话的「约束条件」、用户页的「选择框」本就默认收起。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import MkCols from '../MkCols.vue'

const DEFS = [
  { key: 'a', label: '列 A' },
  { key: 'b', label: '列 B' },
  { key: 'c', label: '列 C' }
]

function harness(defaultHidden?: string[], storageKey = 'wf_test_hidden_cols') {
  const Harness = defineComponent({
    components: { MkCols },
    setup() {
      const hidden = ref(new Set<string>())
      return { hidden, DEFS, defaultHidden, storageKey }
    },
    template: `<MkCols :col-defs="DEFS" :storage-key="storageKey" :default-hidden="defaultHidden" v-model:hidden="hidden" />`
  })
  return mount(Harness)
}

describe('MkCols 列显隐', () => {
  beforeEach(() => localStorage.clear())

  it('入口：可见文案「列」+ 可访问名/悬停说明 + 菜单头「显示列 n / m」', async () => {
    const w = harness()
    const trigger = w.find('.mk-cols__trigger')
    expect(trigger.text()).toContain('列')
    expect(trigger.text()).not.toContain('列设置')
    expect(trigger.attributes('aria-label')).toBe('列设置：显示或隐藏表格列')
    expect(trigger.attributes('title')).toContain('显示 / 隐藏表格列')
    expect(trigger.attributes('aria-expanded')).toBe('false')
    expect(trigger.attributes('aria-haspopup')).toBe('true')

    await trigger.trigger('click')
    expect(trigger.attributes('aria-expanded')).toBe('true')
    expect(w.find('.mk-cols__title').text()).toBe('显示列')
    expect(w.find('.mk-cols__hint').text()).toBe('3 / 3')
  })

  it('勾掉一列：计数徽章出现、菜单头同步、写 localStorage', async () => {
    const w = harness()
    await w.find('.mk-cols__trigger').trigger('click')
    await w.findAll('.mk-cols__item input')[1].setValue(false)
    await w.vm.$nextTick()

    expect([...w.vm.hidden]).toEqual(['b'])
    expect(w.find('.mk-cols__count').text()).toBe('1')
    expect(w.find('.mk-cols__hint').text()).toBe('2 / 3')
    expect(localStorage.getItem('wf_test_hidden_cols')).toBe('["b"]')
  })

  it('「恢复默认」回到 defaultHidden，而不是一律全显', async () => {
    const w = harness(['c'])
    await w.vm.$nextTick()
    expect([...w.vm.hidden]).toEqual(['c'])
    expect(w.find('.mk-cols__count').text()).toBe('1')

    await w.find('.mk-cols__trigger').trigger('click')
    await w.findAll('.mk-cols__item input')[0].setValue(false)
    await w.vm.$nextTick()
    expect([...w.vm.hidden].sort()).toEqual(['a', 'c'])
    expect(w.find('.mk-cols__reset').text()).toBe('恢复默认')

    await w.find('.mk-cols__reset').trigger('click')
    expect([...w.vm.hidden]).toEqual(['c'])
    expect(w.find('.mk-cols__reset').exists()).toBe(false)
  })

  it('已有本地记录时尊重用户配置（不被 defaultHidden 覆盖）', async () => {
    localStorage.setItem('wf_test_hidden_cols', '["a"]')
    const w = harness(['c'])
    await w.vm.$nextTick()
    expect([...w.vm.hidden]).toEqual(['a'])
  })
})
