import { nextTick, onBeforeUnmount, watch, type Ref } from 'vue'

/**
 * 覆盖层（抽屉/弹窗/面板）统一行为：
 * - 打开时：记录触发元素、锁定背景滚动、aria-modal、聚焦面板（或面板内首个可聚焦元素）
 * - 打开期间：Tab/Shift+Tab 焦点陷阱，焦点不会逃逸到面板外
 * - 关闭时：移除打开时设置的 aria-modal、恢复背景滚动、焦点回落到触发元素
 * 解决全站覆盖层无焦点管理、背景可滚动、读屏无隔离的问题。
 */

/** 收集面板内可参与 Tab 循环的可聚焦元素 */
function getTabbable(el: HTMLElement): HTMLElement[] {
  const list: HTMLElement[] = []
  el.querySelectorAll<HTMLElement>(
    'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
  ).forEach((node) => {
    if ((node as HTMLButtonElement | HTMLInputElement).disabled) return
    if (node.getAttribute('aria-hidden') === 'true') return
    const style = getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden') return
    list.push(node)
  })
  if (el.tabIndex >= 0 && !list.includes(el)) list.unshift(el)
  return list
}

function onPanelKeydown(el: HTMLElement) {
  return (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return
    const tabbables = getTabbable(el)
    if (!tabbables.length) {
      e.preventDefault()
      return
    }
    const active = document.activeElement
    const inside = active instanceof Node && el.contains(active)
    if (e.shiftKey) {
      if (!inside || active === tabbables[0]) {
        e.preventDefault()
        tabbables[tabbables.length - 1].focus()
      }
    } else if (!inside || active === tabbables[tabbables.length - 1]) {
      e.preventDefault()
      tabbables[0].focus()
    }
  }
}

export function useOverlay(open: Ref<boolean>, panel: Ref<HTMLElement | null>, lockScroll = true) {
  let prevOverflow = ''
  let prevFocus: HTMLElement | null = null
  let modalBefore: string | null = null
  let keydownHandler: ((e: KeyboardEvent) => void) | null = null

  watch(open, async (isOpen) => {
    const el = panel.value
    if (isOpen) {
      prevFocus = document.activeElement as HTMLElement | null
      if (lockScroll) {
        prevOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
      }
      await nextTick()
      if (el) {
        // 仅当面板原本没有 aria-modal 时才由本 hook 设置，关闭时移除，避免误删模板静态属性
        modalBefore = el.getAttribute('aria-modal')
        if (modalBefore == null) el.setAttribute('aria-modal', 'true')
        if (!el.contains(document.activeElement)) {
          const focusable = el.querySelector<HTMLElement>(
            'input, textarea, select, button, [tabindex]:not([tabindex="-1"])'
          )
          const target = focusable || el
          target?.focus()
        }
        keydownHandler = onPanelKeydown(el)
        el.addEventListener('keydown', keydownHandler)
      }
    } else {
      if (el) {
        if (keydownHandler) {
          el.removeEventListener('keydown', keydownHandler)
          keydownHandler = null
        }
        if (modalBefore == null && el.getAttribute('aria-modal') === 'true') {
          el.removeAttribute('aria-modal')
        }
      }
      modalBefore = null
      if (lockScroll) document.body.style.overflow = prevOverflow
      if (prevFocus && document.contains(prevFocus)) prevFocus.focus()
      prevFocus = null
    }
  })

  onBeforeUnmount(() => {
    const el = panel.value
    if (el && keydownHandler) el.removeEventListener('keydown', keydownHandler)
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
