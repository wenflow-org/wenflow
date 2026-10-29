import type { ComponentPublicInstance } from 'vue'
import type { VueWrapper } from '@vue/test-utils'

/**
 * MkSelect（自绘单选下拉）的测试助手。
 *
 * 2026-10-27 起原生 `<select>` 逐步退役：闭合态没有 option 元素，交互是
 * 「点触发器展开 → 点 listbox 里的选项」。
 *
 * 弹层用 fixed 定位（不被 modal / 滚动容器裁剪），但仍是组件子树；这里统一从触发器的
 * `aria-controls` 取菜单 id 再取节点，避免依赖 DOM 层级。触发器上的 `aria-label`
 * 是定位键（$attrs 落在 button 上）。
 */

export function mkSelectBox<T extends ComponentPublicInstance>(w: VueWrapper<T>, ariaLabel: string) {
  const box = w.findAll('.mk-select').find((el) => {
    const btn = el.find('button')
    return btn.exists() && btn.attributes('aria-label') === ariaLabel
  })
  if (!box) throw new Error(`mk-select not found: ${ariaLabel}`)
  return box
}

/** 菜单节点：优先组件子树（测试默认挂载），再按 aria-controls 到 document 上兜底 */
export function mkSelectMenu<T extends ComponentPublicInstance>(w: VueWrapper<T>, ariaLabel: string): HTMLElement {
  const box = mkSelectBox(w, ariaLabel)
  const inTree = box.find('ul.mk-listbox-pop')
  if (inTree.exists()) return inTree.element as HTMLElement
  const id = box.find('button').attributes('aria-controls')
  const menu = id ? document.getElementById(id) : null
  if (!menu) throw new Error(`mk-select menu not found: ${ariaLabel}`)
  return menu
}

/** 全部选项元素（v-show 只改 display，选项始终在 DOM 里） */
export function mkSelectOptions<T extends ComponentPublicInstance>(w: VueWrapper<T>, ariaLabel: string): HTMLElement[] {
  return Array.from(mkSelectMenu(w, ariaLabel).querySelectorAll('.mk-listbox-opt'))
}

export function mkSelectLabels<T extends ComponentPublicInstance>(w: VueWrapper<T>, ariaLabel: string): string[] {
  return mkSelectOptions(w, ariaLabel).map((o) => o.textContent?.trim() ?? '')
}

/** 当前值（`data-value`；undefined / null 有各自的哨兵串） */
export function mkSelectValue<T extends ComponentPublicInstance>(w: VueWrapper<T>, ariaLabel: string): string | undefined {
  return mkSelectBox(w, ariaLabel).find('button').attributes('data-value')
}

/** 展开并点选某档（按 `data-value` 精确匹配） */
export async function chooseMkSelect<T extends ComponentPublicInstance>(
  w: VueWrapper<T>,
  ariaLabel: string,
  value: string
): Promise<HTMLElement> {
  await mkSelectBox(w, ariaLabel).find('button').trigger('click')
  const opt = mkSelectOptions(w, ariaLabel).find((o) => o.getAttribute('data-value') === value)
  if (!opt) throw new Error(`option not found: ${ariaLabel} / ${value}`)
  opt.click()
  await w.vm.$nextTick()
  return opt
}
