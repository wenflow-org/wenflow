/**
 * 共享原语新增档（2026-10-26 导航与共享原语收口）：
 * - Pagination：total=0 常驻空计数并禁用导航；hideWhenSinglePage 单页自隐
 * - SkeletonTable：flat 不渲染卡片外壳；rows 省略按宿主高度算
 * - SavedViewsBar：不再带交互说明书 title
 * - OvBars：列级 select 事件（键盘可达）与稀疏形态
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import Pagination from '../Pagination.vue'
import SkeletonTable from '../SkeletonTable.vue'
import SavedViewsBar from '../SavedViewsBar.vue'
import OvBars from '../OvBars.vue'

describe('Pagination · 0 行与单页', () => {
  const btn = (w: ReturnType<typeof mount>, text: string) => w.findAll('button').find((b) => b.text() === text)!

  it('total=0：仍渲染「共 0 条 · 第 1 / 1 页」，页码与前后翻全部禁用', () => {
    const w = mount(Pagination, { props: { page: 1, total: 0, pageSize: 15 } })
    expect(w.text()).toContain('共 0 条 · 第 1 / 1 页')
    expect(btn(w, '上一页').attributes('disabled')).toBeDefined()
    expect(btn(w, '下一页').attributes('disabled')).toBeDefined()
    expect(w.find('.mk-pagination__num').attributes('disabled')).toBeDefined()
    w.unmount()
  })

  it('hideWhenSinglePage=true 且只有一页：整条不渲染', () => {
    const w = mount(Pagination, { props: { page: 1, total: 4, pageSize: 15, hideWhenSinglePage: true } })
    expect(w.find('.mk-pagination').exists()).toBe(false)
    w.unmount()
  })

  it('hideWhenSinglePage 默认 false：单页仍常驻（0 行页面需要常驻计数）', () => {
    const w = mount(Pagination, { props: { page: 1, total: 4, pageSize: 15 } })
    expect(w.find('.mk-pagination').exists()).toBe(true)
    expect(w.text()).toContain('共 4 条')
    w.unmount()
  })

  it('hideWhenSinglePage=true 但有多页：照常渲染', () => {
    const w = mount(Pagination, { props: { page: 1, total: 40, pageSize: 15, hideWhenSinglePage: true } })
    expect(w.find('.mk-pagination').exists()).toBe(true)
    expect(w.text()).toContain('第 1 / 3 页')
    w.unmount()
  })
})

describe('SkeletonTable · flat 与按高度定行数', () => {
  it('默认形态保留卡片外壳（现有 20 处调用不变）', () => {
    const w = mount(SkeletonTable, { props: { rows: 3, cols: 4 } })
    expect(w.find('.mk-card.skl-card').exists()).toBe(true)
    expect(w.findAll('.skl')).toHaveLength(3)
    w.unmount()
  })

  it('flat 不渲染卡片外壳（嵌进 .mk-card--fill 不形成卡中卡）', () => {
    const w = mount(SkeletonTable, { props: { rows: 2, cols: 3, flat: true } })
    expect(w.find('.mk-card').exists()).toBe(false)
    expect(w.find('.skl-list').exists()).toBe(true)
    expect(w.findAll('.skl')).toHaveLength(2)
    w.unmount()
  })

  it('rows 省略时按宿主高度算行数（无布局高度时回落默认行数）', async () => {
    const w = mount(SkeletonTable, { props: { cols: 3, flat: true } })
    await nextTick()
    // jsdom 无布局高度：回落默认 5 行，且不抛错
    expect(w.findAll('.skl')).toHaveLength(5)
    w.unmount()
  })
})

describe('SavedViewsBar · 不再带交互说明书 title', () => {
  it('命名输入与删除钮都不带 title（控件自己会说话）', async () => {
    const w = mount(SavedViewsBar, {
      props: {
        views: [{ id: 'v1', name: '仅失败', query: { status: 'err' }, createdAt: 1 }],
        activeName: '',
        canSave: true
      }
    })
    expect(w.find('.sv-pill__del').attributes('title')).toBeUndefined()
    await w.find('.mk-link').trigger('click')
    await nextTick()
    expect(w.find('.sv-name').attributes('title')).toBeUndefined()
    w.unmount()
  })
})

describe('OvBars · 列级下钻与稀疏形态', () => {
  const cols = [
    { key: 'd1', label: '10/20', num: '12', bars: [{ pct: '60%', tone: 'blue' as const }] },
    { key: 'd2', label: '10/21', num: '0', bars: [{ pct: '0%', tone: 'blue' as const }] }
  ]

  it('selectable：每列是按钮，点击发出 select(列 key)', async () => {
    const w = mount(OvBars, { props: { cols, selectable: true } })
    const colsEl = w.findAll('button.ovbars__col')
    expect(colsEl).toHaveLength(2)
    await colsEl[1]!.trigger('click')
    expect(w.emitted('select')?.[0]).toEqual(['d2'])
    w.unmount()
  })

  it('默认不可点：列仍是 div，不发 select', async () => {
    const w = mount(OvBars, { props: { cols } })
    expect(w.findAll('button.ovbars__col')).toHaveLength(0)
    expect(w.emitted('select')).toBeUndefined()
    w.unmount()
  })

  it('稀疏形态：只有一天有值时改一行读数，不画满列空柱', () => {
    const sparseCols = [
      { key: 'd1', label: '10/20', num: '0', bars: [{ pct: '0%', tone: 'blue' as const }] },
      { key: 'd2', label: '10/21', num: '7', bars: [{ pct: '100%', tone: 'blue' as const }] },
      { key: 'd3', label: '10/22', num: '0', bars: [{ pct: '0%', tone: 'blue' as const }] }
    ]
    const w = mount(OvBars, { props: { cols: sparseCols, sparse: true, sparseNote: '近 7 天仅此日有数据' } })
    expect(w.find('.ovbars--sparse').exists()).toBe(true)
    expect(w.find('.ovbars__col').exists()).toBe(false)
    expect(w.find('.ovbars__sparse-num').text()).toBe('7')
    expect(w.find('.ovbars__sparse-label').text()).toBe('10/21')
    expect(w.text()).toContain('近 7 天仅此日有数据')
    w.unmount()
  })

  it('稀疏开关关闭或有多天有值：仍画满列柱图', () => {
    const sparseCols = [
      { key: 'd1', label: '10/20', num: '0', bars: [{ pct: '0%', tone: 'blue' as const }] },
      { key: 'd2', label: '10/21', num: '7', bars: [{ pct: '100%', tone: 'blue' as const }] }
    ]
    const off = mount(OvBars, { props: { cols: sparseCols } })
    expect(off.find('.ovbars--sparse').exists()).toBe(false)
    off.unmount()

    const twoDays = mount(OvBars, {
      props: {
        cols: [
          { key: 'd1', label: '10/20', num: '3', bars: [{ pct: '40%', tone: 'blue' as const }] },
          { key: 'd2', label: '10/21', num: '7', bars: [{ pct: '100%', tone: 'blue' as const }] }
        ],
        sparse: true
      }
    })
    expect(twoDays.find('.ovbars--sparse').exists()).toBe(false)
    expect(twoDays.findAll('.ovbars__col')).toHaveLength(2)
    twoDays.unmount()
  })
})
