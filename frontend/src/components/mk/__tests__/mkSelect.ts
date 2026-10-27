import type { DOMWrapper, VueWrapper } from '@vue/test-utils'

/**
 * MkSelect（自绘单选下拉）的测试助手。
 *
 * 2026-10-27 起原生 `<select>` 逐步退役：闭合态没有 option 元素，交互是
 * 「点触发器展开 → 点 listbox 里的选项」。测试统一走这里，避免每个文件各写一套查询。
 * 触发器上的 `aria-label` 是定位键（$attrs 落在 button 上）。
 */

export function mkSelectBox(w: VueWrapper<any>, ariaLabel: string) {
  const box = w.findAll('.mk-select').find((el) => {
    const btn = el.find('button')
    return btn.exists() && btn.attributes('aria-label') === ariaLabel
  })
  if (!box) throw new Error(`mk-select not found: ${ariaLabel}`)
  return box
}

/** 当前值（`data-value`；undefined / null 有各自的哨兵串） */
export function mkSelectValue(w: VueWrapper<any>, ariaLabel: string): string | undefined {
  return mkSelectBox(w, ariaLabel).find('button').attributes('data-value')
}

/** 全部选项文案（v-show 只改 display，选项始终在 DOM 里） */
export function mkSelectLabels(w: VueWrapper<any>, ariaLabel: string): string[] {
  return mkSelectBox(w, ariaLabel).findAll('.mk-listbox-opt').map((o) => o.text())
}

/** 展开并点选某档（按 `data-value` 精确匹配） */
export async function chooseMkSelect(
  w: VueWrapper<any>,
  ariaLabel: string,
  value: string
): Promise<DOMWrapper<Element>> {
  const box = mkSelectBox(w, ariaLabel)
  await box.find('button').trigger('click')
  const opt = box.findAll('.mk-listbox-opt').find((o) => o.attributes('data-value') === value)
  if (!opt) throw new Error(`option not found: ${ariaLabel} / ${value}`)
  await opt.trigger('click')
  return opt
}
