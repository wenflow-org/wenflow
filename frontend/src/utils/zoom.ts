/**
 * 页面缩放（CSS `zoom` / transform scale / 浏览器缩放）的共用换算。
 *
 * 背景：`.v2-page` 与管理台 `.ac` 在宽屏有 `zoom: 1.08–1.3`，`getBoundingClientRect()` 与
 * 鼠标事件的视觉坐标是放大后的 CSS px，而元素自身的 `offsetWidth` / `scrollTop` / canvas
 * 逻辑尺寸是未放大的布局 px。两套坐标直接相加/比较就会按缩放比例漂移。
 *
 * 这里统一给「视觉 px ÷ 布局 px」的累计系数，调用方按需换算，不再各自读 zoom 配置。
 */

/** 累计算祖先的缩放系数（CSS zoom + transform scale）。 */
export function resolveZoomScale(el: HTMLElement | null | undefined): number {
  if (!el) return 1
  let scale = 1
  let node: HTMLElement | null = el
  while (node && node !== document.documentElement) {
    const cs = getComputedStyle(node)
    const zoom = Number.parseFloat(cs.getPropertyValue('zoom'))
    if (Number.isFinite(zoom) && zoom > 0 && zoom !== 1) scale *= zoom
    if (cs.transform && cs.transform !== 'none' && typeof DOMMatrixReadOnly !== 'undefined') {
      const matrix = new DOMMatrixReadOnly(cs.transform)
      const sx = Math.hypot(matrix.a, matrix.b)
      if (sx > 0 && Math.abs(sx - 1) > 1e-6) scale *= sx
    }
    node = node.parentElement
  }
  return scale
}

/**
 * 元素所在缩放上下文里「1 个逻辑 px 对应多少视觉 px」。
 * 用视觉宽 / 逻辑宽做交叉校验，覆盖 resolveZoomScale 识别不到的宿主缩放。
 */
export function resolveVisualScale(el: HTMLElement | null | undefined): number {
  if (!el) return 1
  const rect = el.getBoundingClientRect()
  const logical = el.offsetWidth
  if (!rect.width || !logical) return resolveZoomScale(el)
  const ratio = rect.width / logical
  const walked = resolveZoomScale(el)
  if (walked !== 1 || Math.abs(ratio - 1) < 0.02) return walked
  return ratio
}

/** 当前可见视口高度（移动端键盘/双指缩放优先 visualViewport）。 */
export function visualViewportHeight(): number {
  if (typeof window === 'undefined') return 0
  return window.visualViewport?.height ?? window.innerHeight
}
