import { nextTick } from 'vue'

/**
 * role="tablist" / role="tab" 的键盘契约（WAI-ARIA tabs）：
 * 左右方向键在同一行内循环移动、Home/End 跳到首尾；选中项由 activate 回调落到页面状态。
 * 切换后焦点跟随新页签（ARIA 惯例）。配套要求：每个页签自身是 roving tabindex
 * （选中项 0、其余 -1），这样一整行只占一个 Tab 位，方向键才是在行内移动。
 * 事件绑在 tablist 容器上，按行内 [role="tab"] 的 DOM 顺序定位。
 */
export function onTabRowKeydown(e: KeyboardEvent, activate: (index: number) => void): void {
  const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End']
  if (!keys.includes(e.key)) return
  const row = e.currentTarget as HTMLElement | null
  if (!row) return
  const btns = Array.from(row.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
  const cur = btns.findIndex((b) => b === document.activeElement)
  if (cur < 0 || !btns.length) return
  e.preventDefault()
  const n = btns.length
  const next = e.key === 'ArrowRight' ? (cur + 1) % n
    : e.key === 'ArrowLeft' ? (cur - 1 + n) % n
      : e.key === 'Home' ? 0 : n - 1
  activate(next)
  // 等 tabindex 随状态更新后再聚焦，避免焦点落在仍是 -1 的旧项上
  void nextTick(() => btns[next]?.focus())
}
