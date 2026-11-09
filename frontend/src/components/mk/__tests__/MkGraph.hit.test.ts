/**
 * 图谱「点本体优先」命中判据（2026-11-09 用户走查）。
 *
 * 病根（浏览器实测复现）：标签铺着与画布同色的底衬，且画在节点**之上**（zrender 显示列表里
 * 标签排在符号之后），`labelLayout.hideOverlap` 又只比较「标签↔标签」，看不到节点符号——
 * 于是密集图里 A 的两行标签常常盖住 B 那颗点。zrender 命中从显示列表尾部（最上面）往下找，
 * 先撞上标签 → ECharts 按标签的宿主报事件，B 的那颗点在自己位置上反而点不动：
 * 实测点击 (361,192)（节点「查看表对象结构」的画布坐标）选中的是标签宿主
 * 「表头行位置与列名口径的对应锁定」。
 *
 * 修法：先在捕获阶段判「这一下是不是点在某个点的**本体**上」——半径 = 该点自己的
 * symbolSize/2 + 2px，命中就自己接管。判据抽成纯函数放模块作用域，本文件锁它的边界。
 */
import { describe, expect, it } from 'vitest'
import { MIN_SYMBOL_HALF, nearestSymbolHit } from '../MkGraph.vue'

/** 一颗粒子：半径 12（symbolSize 24），中心 (100,100) */
const dot = (id: string, x: number, y: number, half = 12) => ({ id, x, y, half })

describe('nearestSymbolHit：点本体优先', () => {
  it('点在本体上 → 返回该点', () => {
    expect(nearestSymbolHit(100, 100, [dot('a', 100, 100)])).toBe('a')
    expect(nearestSymbolHit(110, 100, [dot('a', 100, 100)])).toBe('a')
  })

  it('半径贴着自己的符号：本体外 1px 就不算（不能从标签手里抢点击）', () => {
    // 半尺寸 12 + 容差 2 = 14 → 15px 之外不再是本体
    expect(nearestSymbolHit(114, 100, [dot('a', 100, 100)])).toBe('a')
    expect(nearestSymbolHit(115, 100, [dot('a', 100, 100)])).toBe(null)
  })

  it('小点也保底给到 MIN_SYMBOL_HALF 的半径（12px 的豆不至于点不中）', () => {
    const tiny = dot('a', 100, 100, 3)
    expect(nearestSymbolHit(100 + MIN_SYMBOL_HALF, 100, [tiny])).toBe('a')
    expect(nearestSymbolHit(100 + MIN_SYMBOL_HALF + 4, 100, [tiny])).toBe(null)
  })

  it('两个点重叠时取更近的那颗，不随遍历顺序跳变', () => {
    const a = dot('a', 100, 100)
    const b = dot('b', 110, 100)
    expect(nearestSymbolHit(104, 100, [a, b])).toBe('a')
    expect(nearestSymbolHit(104, 100, [b, a])).toBe('a')
    expect(nearestSymbolHit(106, 100, [a, b])).toBe('b')
    expect(nearestSymbolHit(106, 100, [b, a])).toBe('b')
  })

  it('点在 A 的标签位置上（离 A 本体 24px）→ 不判本体，标签点击仍归 ECharts', () => {
    // 标签挂在节点下方（position: bottom, distance 5）：从本体中心往下 24px 是常见的标签位置
    expect(nearestSymbolHit(100, 124, [dot('a', 100, 100)])).toBe(null)
  })

  it('点在空白处 → null（空白热区仍走 NODE_HIT_RADIUS 那一档）', () => {
    expect(nearestSymbolHit(400, 400, [dot('a', 100, 100), dot('b', 110, 100)])).toBe(null)
    expect(nearestSymbolHit(100, 100, [])).toBe(null)
  })
})
