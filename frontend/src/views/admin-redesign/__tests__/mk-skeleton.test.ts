/**
 * MkSkeleton 骨架版式契约。
 *
 * 背景：此前 5 个页面各写一套骨架布局类（.ud-skel__* / .tc-skel-* / .sk-rec__skeleton /
 * .cp-path-skel / .cp-log-skel），形状同类却各写各的。收敛为「视觉 = shared.css 的
 * .mk-skeleton，形状 = MkSkeleton 的变体」后，本文件把版式契约钉住。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import MkSkeleton from '../MkSkeleton.vue'

describe('MkSkeleton', () => {
  it('block（默认）：单块，w/h/radius 落到内联样式，circle 加圆类', () => {
    const w = mount(MkSkeleton, { props: { w: '60%', h: 26, radius: 8 } })
    const el = w.find('.mk-skeleton')
    expect(el.exists()).toBe(true)
    expect(el.attributes('style')).toContain('width: 60%')
    expect(el.attributes('style')).toContain('height: 26px')
    expect(el.attributes('style')).toContain('border-radius: 8px')

    const c = mount(MkSkeleton, { props: { circle: true, h: 48, w: 48 } })
    expect(c.find('.mk-skeleton').classes()).toContain('mk-skeleton--circle')
  })

  it('block：h 缺省为 12px（骨架条默认高度）', () => {
    const w = mount(MkSkeleton)
    expect(w.find('.mk-skeleton').attributes('style')).toContain('height: 12px')
  })

  it('rows：渲染 count 条等高横条，gap 由 .mk-skeleton-rows 提供', () => {
    const w = mount(MkSkeleton, { props: { variant: 'rows', count: 8, h: 26 } })
    expect(w.find('.mk-skeleton-rows').exists()).toBe(true)
    const bars = w.findAll('.mk-skeleton')
    expect(bars).toHaveLength(8)
    for (const b of bars) expect(b.attributes('style')).toContain('height: 26px')
  })

  it('rows + jitter：首条偏宽、末条偏窄（像真实文本）', () => {
    const w = mount(MkSkeleton, { props: { variant: 'rows', count: 5, h: 14, jitter: true } })
    const bars = w.findAll('.mk-skeleton')
    expect(bars[0].attributes('style')).toContain('width: 58%')
    expect(bars[4].attributes('style')).toContain('width: 24%')
  })

  it('cards：固定列数走 --mk-skel-cols，自动填列走 --mk-skel-card-min', () => {
    const fixed = mount(MkSkeleton, { props: { variant: 'cards', count: 4, h: 64, cols: 4 } })
    expect(fixed.find('.mk-skeleton-cards').classes()).toContain('mk-skeleton-cards--fixed')
    expect(fixed.find('.mk-skeleton-cards').attributes('style')).toContain('--mk-skel-cols: 4')
    expect(fixed.findAll('.mk-skeleton')).toHaveLength(4)

    const auto = mount(MkSkeleton, { props: { variant: 'cards', count: 3, h: 64, min: 150 } })
    expect(auto.find('.mk-skeleton-cards').classes()).not.toContain('mk-skeleton-cards--fixed')
    expect(auto.find('.mk-skeleton-cards').attributes('style')).toContain('--mk-skel-card-min: 150px')
  })

  it('identity：头像块 + 两行文字', () => {
    const w = mount(MkSkeleton, { props: { variant: 'identity', avatar: 48 } })
    expect(w.find('.mk-skeleton-identity').exists()).toBe(true)
    // 头像 1 + 两行 2 = 3
    expect(w.findAll('.mk-skeleton')).toHaveLength(3)
    expect(w.find('.mk-skeleton-identity__lines').exists()).toBe(true)
  })

  it('bars：N 根竖条，容器高度 = h', () => {
    const w = mount(MkSkeleton, { props: { variant: 'bars', count: 7, h: 150 } })
    const box = w.find('.mk-skeleton-bars')
    expect(box.exists()).toBe(true)
    expect(box.attributes('style')).toContain('height: 150px')
    expect(w.findAll('.mk-skeleton-bars > .mk-skeleton')).toHaveLength(7)
  })

  it('全部版式的根节点都带 aria-hidden（纯装饰，不该进读屏）', () => {
    const roots = {
      block: '.mk-skeleton',
      rows: '.mk-skeleton-rows',
      cards: '.mk-skeleton-cards',
      identity: '.mk-skeleton-identity',
      bars: '.mk-skeleton-bars'
    } as const
    for (const [variant, sel] of Object.entries(roots)) {
      const w = mount(MkSkeleton, { props: { variant: variant as keyof typeof roots } })
      expect(w.find(sel).attributes('aria-hidden'), variant).toBe('true')
    }
  })
})
