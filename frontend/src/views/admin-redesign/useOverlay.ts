import { nextTick, onBeforeUnmount, watch, type Ref } from 'vue'

/**
 * 覆盖层（抽屉/弹窗/面板）统一行为：
 * - 打开时：记录触发元素、锁定背景滚动、aria-modal、聚焦面板（或面板内首个可聚焦元素）
 * - 关闭时：恢复背景滚动、焦点回落到触发元素
 * 解决全站覆盖层无焦点管理、背景可滚动、读屏无隔离的问题。
 */
export function useOverlay(open: Ref<boolean>, panel: Ref<HTMLElement | null>, lockScroll = true) {
  let prevOverflow = ''
  let prevFocus: HTMLElement | null = null

  watch(open, async (isOpen) => {
    if (isOpen) {
      prevFocus = document.activeElement as HTMLElement | null
      if (lockScroll) {
        prevOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
      }
      await nextTick()
      const el = panel.value
      if (el) el.setAttribute('aria-modal', 'true')
      if (el && el.contains(document.activeElement)) return
      const focusable = el?.querySelector<HTMLElement>(
        'input, textarea, select, button, [tabindex]:not([tabindex="-1"])'
      )
      const target = focusable || el
      target?.focus()
    } else {
      if (lockScroll) document.body.style.overflow = prevOverflow
      if (prevFocus && document.contains(prevFocus)) prevFocus.focus()
      prevFocus = null
    }
  })

  onBeforeUnmount(() => {
    document.body.style.overflow = prevOverflow
  })
}

/**
 * 遮罩点击关闭判定：仅当鼠标在遮罩上按下且松开才关闭。
 * 替代 @mousedown.self（按下即关），避免在抽屉/面板内选中文本拖到遮罩松手误关。
 */
export function useMaskClose(mask: Ref<HTMLElement | null>, close: () => void) {
  let downOnMask = false

  function onDown(e: MouseEvent) {
    downOnMask = e.target === e.currentTarget
  }
  function onUp(e: MouseEvent) {
    if (downOnMask && e.target === e.currentTarget) close()
  }

  watch(mask, (el) => {
    if (el) {
      el.addEventListener('mousedown', onDown)
      el.addEventListener('mouseup', onUp)
    }
  })

  onBeforeUnmount(() => {
    const el = mask.value
    if (el) {
      el.removeEventListener('mousedown', onDown)
      el.removeEventListener('mouseup', onUp)
    }
  })
}
