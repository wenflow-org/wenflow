/**
 * MkCols（列显隐）行为测试。
 *
 * 2026-10-27 用户「还是改成列」→「不要计数，并且去掉前面的图标」，最终契约：
 * - 可见文案只有单字「列」，不带图标、不带隐藏计数；
 * - 可访问名与 title 仍写全「列设置：显示或隐藏表格列」；
 * - 藏过列的事实在菜单头用「显示列 n / m」表达；
 * - 「恢复默认」回到该页首访默认集（defaultHidden），不是一律全显
 *   —— 目标对话的「约束条件」、用户页的「选择框」本就默认收起。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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

  it('入口：可见文案只有「列」，无图标无计数；可访问名/悬停说明 + 菜单头「显示列 n / m」', async () => {
    const w = harness()
    const trigger = w.find('.mk-cols__trigger')
    expect(trigger.text()).toBe('列')
    expect(trigger.find('svg').exists()).toBe(false)
    expect(w.find('.mk-cols__count').exists()).toBe(false)
    expect(trigger.attributes('aria-label')).toBe('列设置：显示或隐藏表格列')
    expect(trigger.attributes('title')).toContain('显示 / 隐藏表格列')
    expect(trigger.attributes('aria-expanded')).toBe('false')
    expect(trigger.attributes('aria-haspopup')).toBe('true')

    await trigger.trigger('click')
    expect(trigger.attributes('aria-expanded')).toBe('true')
    expect(w.find('.mk-cols__title').text()).toBe('显示列')
    expect(w.find('.mk-cols__hint').text()).toBe('3 / 3')
  })

  it('勾掉一列：入口不出现计数，菜单头同步、写 localStorage', async () => {
    const w = harness()
    await w.find('.mk-cols__trigger').trigger('click')
    await w.findAll('.mk-cols__item input')[1].setValue(false)
    await w.vm.$nextTick()

    expect([...w.vm.hidden]).toEqual(['b'])
    expect(w.find('.mk-cols__count').exists()).toBe(false)
    expect(w.find('.mk-cols__trigger').text()).toBe('列')
    expect(w.find('.mk-cols__hint').text()).toBe('2 / 3')
    expect(localStorage.getItem('wf_test_hidden_cols')).toBe('["b"]')
  })

  it('「恢复默认」回到 defaultHidden，而不是一律全显', async () => {
    const w = harness(['c'])
    await w.vm.$nextTick()
    expect([...w.vm.hidden]).toEqual(['c'])
    expect(w.find('.mk-cols__count').exists()).toBe(false)

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

describe('菜单只放可做的事，不写机制自述', () => {
  /* 2026-11-10 用户指着列菜单底部「固定列 用户、操作 始终显示」：「没有意义，删除吧」。
     列本来就在屏幕上、菜单本来就在展开——解释控件自身规则属于说明书，不是文案。
     护栏：菜单里只剩勾选项与「恢复默认」，不再出现任何解释性段落。 */
  it('菜单只有勾选项 + 恢复默认，没有脚注 / 说明段', async () => {
    const w = harness([], 'wf_test_hidden_cols_r8')
    await w.find('.mk-cols__trigger').trigger('click')
    const menu = w.find('.mk-cols__menu')
    expect(menu.exists()).toBe(true)
    expect(menu.findAll('p').length).toBe(0)
    expect(menu.text()).not.toMatch(/始终(?:显示|可见)|不可隐藏|无法隐藏|固定列/)
    expect(menu.findAll('.mk-cols__item').length).toBe(DEFS.length)
    w.unmount()
  })

  it('组件不再接受 fixed-cols 这类「解释为什么」的入参', () => {
    const src = readFileSync(resolve(__dirname, '../MkCols.vue'), 'utf8')
    expect(src).not.toContain('fixedCols')
    expect(src).not.toContain('mk-cols__fixed')
  })
})
