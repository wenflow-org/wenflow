/**
 * 页面缩放换算工具（2026-11-25 全站缩放走查）。
 *
 * jsdom 不实现 CSS zoom 的布局，所以这里锁两件事：
 * ① 祖先读不到 zoom 时，用「视觉宽 ÷ 布局宽」兜底（宿主缩放/浏览器缩放也能折算）；
 * ② 可见视口高度优先 visualViewport（移动端键盘/双指缩放只改它）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveVisualScale, resolveZoomScale, visualViewportHeight } from '../zoom'

function stubRect(el: HTMLElement, width: number, height = 30) {
  el.getBoundingClientRect = () => ({
    left: 0, top: 0, right: width, bottom: height, width, height, x: 0, y: 0,
    toJSON: () => ({})
  }) as DOMRect
}

describe('resolveVisualScale', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('没有缩放时返回 1', () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    Object.defineProperty(el, 'offsetWidth', { value: 100, configurable: true })
    stubRect(el, 100)
    expect(resolveVisualScale(el)).toBe(1)
  })

  it('视觉宽是布局宽的 1.3 倍时按比例折算（宿主/浏览器缩放的兜底）', () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    Object.defineProperty(el, 'offsetWidth', { value: 100, configurable: true })
    stubRect(el, 130, 39)
    expect(resolveVisualScale(el)).toBeCloseTo(1.3, 5)
  })

  it('元素为空时安全返回 1', () => {
    expect(resolveVisualScale(null)).toBe(1)
    expect(resolveZoomScale(undefined)).toBe(1)
  })
})

describe('visualViewportHeight', () => {
  it('优先 visualViewport.height，缺失时回落 innerHeight', () => {
    const vv = { height: 512 }
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true })
    expect(visualViewportHeight()).toBe(512)
    Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true })
    expect(visualViewportHeight()).toBe(window.innerHeight)
  })
})
