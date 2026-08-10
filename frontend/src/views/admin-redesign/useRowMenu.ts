import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

const MENU_WIDTH = 176
const MENU_GAP = 4
const VIEWPORT_MARGIN = 8

/**
 * 行内 �?菜单：危�?低频操作收进菜单，避免与高频操作同权平铺�? * - 点击 �?按钮切换（stopPropagation�? * - 点击页面其他位置自动关闭（document click�? * - Esc 关闭；ArrowDown/ArrowUp 循环导航 + Home/End + Enter 触发
 * - 打开时焦点移入菜单内第一个可聚焦�? * - window scroll/resize 时关闭（避免错位残留�? * - fixed 定位裁切修复：菜�?pop 处于 .mk-table-scroll（overflow-x:auto）内会被裁切�? *   打开时按触发按钮 getBoundingClientRect 计算 fixed 坐标，超出视口右/下边界自动回�? *
 * 页面绑定方式（举例，触发按钮�?.mk-menu__btn、弹层为 .mk-menu__pop）：
 *   触发按钮�?aria-expanded="menuOpen"
 *   弹层     �?style="popStyle"（fixed 定位；菜单未打开时为空对象，保持默认 CSS�? */
export function useRowMenu() {
  const openMenu = ref('')
  /** 是否有菜单处于打开状态，供触发按钮绑�?aria-expanded */
  const menuOpen = ref(false)
  /** 弹层 fixed 定位样式 { position: 'fixed', left, top, zIndex: 120 }，未打开时为空对�?*/
  const popStyle = ref<Record<string, number | string>>({})

  let popEl: HTMLElement | null = null
  let triggerEl: HTMLElement | null = null
  let lastClickTarget: EventTarget | null = null
  let popKeydown: ((e: KeyboardEvent) => void) | null = null

  /** 收集弹层内可聚焦项（跳过 disabled / 隐藏�?*/
  function getItems(el: HTMLElement): HTMLElement[] {
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
    return list
  }

  function focusFirstItem() {
    if (!popEl) return
    const items = getItems(popEl)
    if (items.length) {
      items[0].focus()
      return
    }
    if (!popEl.hasAttribute('tabindex')) popEl.tabIndex = -1
    popEl.focus()
  }

  /** 弹层内方向键/Home/End/Enter 导航（listener 绑定在弹层容�?keydown 上） */
  function onPopKeydown(e: KeyboardEvent) {
    if (!popEl) return
    const items = getItems(popEl)
    if (!items.length) return
    const active = document.activeElement as HTMLElement | null
    const idx = active ? items.indexOf(active) : -1
    let next: HTMLElement | null = null
    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        closeMenu()
        break
      case 'ArrowDown':
        e.preventDefault()
        next = items[(idx + 1) % items.length]
        break
      case 'ArrowUp':
        e.preventDefault()
        next = items[(idx - 1 + items.length) % items.length]
        break
      case 'Home':
        e.preventDefault()
        next = items[0]
        break
      case 'End':
        e.preventDefault()
        next = items[items.length - 1]
        break
      case 'Enter':
        if (idx === -1) {
          e.preventDefault()
          items[0].click()
        }
        break
    }
    if (next) next.focus()
  }

  /** 按触发按�?rect 计算 fixed 坐标，超出视口右/下边界时回移 */
  function positionPop() {
    if (!openMenu.value || !popEl || !triggerEl) return
    const triggerRect = triggerEl.getBoundingClientRect()
    const height = popEl.offsetHeight || 132
    let left = triggerRect.left
    let top = triggerRect.bottom + MENU_GAP
    if (top + height > window.innerHeight - VIEWPORT_MARGIN) {
      top = triggerRect.top - height - MENU_GAP
    }
    if (left + MENU_WIDTH > window.innerWidth - VIEWPORT_MARGIN) {
      left = window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN
    }
    if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN
    if (top < VIEWPORT_MARGIN) top = VIEWPORT_MARGIN
    popStyle.value = { position: 'fixed', left: left + "px", top: top + "px", zIndex: 120 }
  }

  function toggleMenu(id: string) {
    if (openMenu.value === id) {
      closeMenu()
      return
    }
    openMenu.value = id
    menuOpen.value = true
    triggerEl =
      lastClickTarget instanceof Element
        ? (lastClickTarget.closest<HTMLElement>('.mk-menu__btn') ?? (lastClickTarget as HTMLElement))
        : null
    nextTick(() => {
      popEl = document.querySelector<HTMLElement>('.mk-menu__pop')
      if (!popEl) return
      positionPop()
      popKeydown = onPopKeydown
      popEl.addEventListener('keydown', popKeydown)
      focusFirstItem()
    })
  }

  function closeMenu() {
    if (!openMenu.value) return
    openMenu.value = ''
    menuOpen.value = false
    popStyle.value = {}
    if (popEl && popKeydown) popEl.removeEventListener('keydown', popKeydown)
    popEl = null
    popKeydown = null
    triggerEl = null
  }

  function onDocClickCapture(e: MouseEvent) {
    lastClickTarget = e.target
  }
  function onDocKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && openMenu.value) closeMenu()
  }

  onMounted(() => {
    document.addEventListener('click', closeMenu)
    document.addEventListener('click', onDocClickCapture, true)
    document.addEventListener('keydown', onDocKeydown)
    document.addEventListener('scroll', closeMenu, true)
    window.addEventListener('resize', closeMenu)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('click', closeMenu)
    document.removeEventListener('click', onDocClickCapture, true)
    document.removeEventListener('keydown', onDocKeydown)
    document.removeEventListener('scroll', closeMenu, true)
    window.removeEventListener('resize', closeMenu)
  })

  return { openMenu, toggleMenu, closeMenu, menuOpen, popStyle }
}
