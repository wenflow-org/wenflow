/**
 * 共用件单测：MkRowList / MkRow（行式列表原语，2026-09-28 统一各页自造行后新增）。
 * 锁定契约：行结构（lead 徽章 → 标题/副行 → 右列时间）、可点行的 button 语义与 emit、
 * 空态/加载态只由 MkRowList 一家渲染。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import MkRowList from '@/components/mk/MkRowList.vue'
import MkRow from '@/components/mk/MkRow.vue'

describe('MkRowList', () => {
  it('empty 且非 loading：渲染空态文本与 hint', () => {
    const w = mount(MkRowList, {
      props: { empty: true, emptyText: '暂无教学会话', emptyHint: '上课后出现' },
      slots: { default: '<div class="mk-row" />' },
    })
    expect(w.text()).toContain('暂无教学会话')
    expect(w.text()).toContain('上课后出现')
    expect(w.find('.mk-rows__empty').exists()).toBe(true)
  })

  it('loading 优先于 empty：渲染加载态而非空态', () => {
    const w = mount(MkRowList, { props: { empty: true, loading: true, emptyText: '暂无' } })
    expect(w.find('.mk-rows__empty').exists()).toBe(false)
    expect(w.find('.mk-rows__loading').exists()).toBe(true)
  })
})

describe('MkRow', () => {
  it('props 渲染结构：lead 徽章 → 标题/副行 → 时间', () => {
    const w = mount(MkRow, {
      props: { title: '拆开 C 与 Am', sub: '乐理 · 6 条消息', time: '9 小时前' },
      slots: { lead: '<span class="mk-badge">已完成</span>' },
    })
    expect(w.text()).toContain('已完成')
    expect(w.find('.mk-row__title').text()).toBe('拆开 C 与 Am')
    expect(w.find('.mk-row__sub').text()).toBe('乐理 · 6 条消息')
    expect(w.find('.mk-row__trail').text()).toBe('9 小时前')
    expect(w.element.tagName).toBe('DIV')
  })

  it('clickable：渲染 button，点击emit click', async () => {
    const w = mount(MkRow, { props: { title: '某会话', clickable: true } })
    expect(w.element.tagName).toBe('BUTTON')
    await w.trigger('click')
    expect(w.emitted('click')).toHaveLength(1)
  })

  it('非 clickable：无 button 语义、无 click 发射', async () => {
    const w = mount(MkRow, { props: { title: '静态行' } })
    await w.trigger('click')
    expect(w.emitted('click')).toBeUndefined()
  })

  it('trail slot 覆盖 time props（自定义右列，如进度条）', () => {
    const w = mount(MkRow, {
      props: { title: '用户', time: '忽略' },
      slots: { trail: '<i class="mr__due-bar"></i>' },
    })
    expect(w.find('.mk-row__trail .mr__due-bar').exists()).toBe(true)
    expect(w.text()).not.toContain('忽略')
  })
})
