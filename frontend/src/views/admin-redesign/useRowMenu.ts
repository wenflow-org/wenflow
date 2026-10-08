import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

const MENU_WIDTH = 176
const MENU_GAP = 4
const VIEWPORT_MARGIN = 8

/**
 * 行内 ⋯ 菜单：危险/低频操作收进菜单，避免与高频操作同权平铺。
 * - 点击 ⋯ 按钮切换（stopPropagation）
 * - 点击页面其他位置自动关闭（document click）
 * - Esc 关闭；ArrowDown/ArrowUp 循环导航 + Home/End + Enter 触发
 * - 打开时焦点移入菜单内第一个可聚焦项
 * - window scroll/resize 时关闭（避免错位残留）
 * - fixed 定位裁切修复：菜单 pop 处于 .mk-table-scroll（overflow-x:auto）内会被裁切，
 *   打开时按触发按钮 getBoundingClientRect 计算 fixed 坐标，超出视口右/下边界自动回移
 *
 * 页面绑定方式（举例，触发按钮为 .mk-menu__btn、弹层为 .mk-menu__pop）：
 *   触发按钮：:aria-expanded="menuOpen"
 *   弹层     ：:style="popStyle"（fixed 定位；菜单未打开时为空对象，保持默认 CSS）
 */

/** 弹层 fixed 坐标：纯函数，便于确定性单测（DOM 时序不参与） */
export function popPositionOf(input: {
  /** 触发钮 rect（物理像素：4K 档 .ac 带 zoom，需按 zoom 换算回逻辑像素） */
  trigger: { left: number; top: number; right: number; bottom: number }
  /** 弹层自然宽高（切换 fixed 前测得；宽度另有 CSS min-width 兜底） */
  popWidth: number
  popHeight: number
  /** .ac 的 zoom（默认 1） */
  zoom: number
  viewportWidth: number
  viewportHeight: number
}): Record<string, string> {
  const { trigger, popWidth, popHeight, zoom, viewportWidth, viewportHeight } = input
  const physicalW = popWidth * zoom
  // 右缘对齐触发钮右缘（.mk-menu__pop 的 right:0 就是这个意思）；越出视口右缘回移，越出左缘贴边
  let left = trigger.right / zoom - popWidth
  if (left * zoom + physicalW > viewportWidth - VIEWPORT_MARGIN) {
    left = (viewportWidth - physicalW - VIEWPORT_MARGIN) / zoom
  }
  if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN
  let top = trigger.bottom / zoom + MENU_GAP
  if (top * zoom + popHeight * zoom > viewportHeight - VIEWPORT_MARGIN) {
    top = trigger.top / zoom - popHeight - MENU_GAP
  }
  if (top < VIEWPORT_MARGIN) top = VIEWPORT_MARGIN
  /* right:'auto' 是必需的：CSS 的 .mk-menu__pop { right: 0 } 会与内联 left 同时生效，
     fixed + width:auto 下拉成两锚点间的横条——实测账号页签 ⋯ 在 x=1037 时菜单宽 871px
     （应为 148px）；只有触发钮贴视口右缘（表格最右列 x≈1845）时宽度恰好等于 148px，
     所以这个缺陷长期被掩盖。 */
  return {
    position: 'fixed',
    left: left + 'px',
    right: 'auto',
    top: top + 'px',
    zIndex: 'var(--mk-z-popover, 120)'
  }
}

export function useRowMenu() {
  const openMenu = ref('')
  /** 是否有菜单处于打开状态，供触发按钮绑定 aria-expanded */
  const menuOpen = ref(false)
  /** 弹层 fixed 定位样式 { position: 'fixed', left, top, zIndex }，未打开时为空对象。
      zIndex 走全站 token --mk-z-popover（2026-10-06 审核 #205）：此前内联 120 只存在于
      TS 里，原语 --mk-z-menu(60) 在行内菜单上恒被覆盖。 */
  const popStyle = ref<Record<string, number | string>>({})

  let popEl: HTMLElement | null = null
  let triggerEl: HTMLElement | null = null
  let lastClickTarget: EventTarget | null = null
  let popKeydown: ((e: KeyboardEvent) => void) | null = null
  /** 菜单打开时刻：忽略打开后短时间内的 scroll（focus/渲染引发的滚动不应关菜单） */
  let openedAt = 0

  /** 收集弹层内可聚焦项（跳过 disabled / 隐藏） */
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
      // preventScroll：focus 引发的自动滚动会触发 document scroll 监听 → closeMenu 把菜单立即关掉
      items[0].focus({ preventScroll: true })
      return
    }
    if (!popEl.hasAttribute('tabindex')) popEl.tabIndex = -1
    popEl.focus({ preventScroll: true })
  }

  /** 弹层内方向键/Home/End/Enter 导航（listener 绑定在弹层容器 keydown 上） */
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
        // 行菜单盖在抽屉/弹窗之上：Esc 只关菜单。必须拦下冒泡，
        // 否则 window 层 useEscape 的 LIFO 栈会在同一次按键把底层抽屉一并关掉
        e.stopPropagation()
        closeMenu(true)
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

  /** 按触发按钮 rect 计算 fixed 坐标，超出视口右/下边界时回移（算法在 popPositionOf，纯函数） */
  function positionPop() {
    if (!openMenu.value || !popEl || !triggerEl) return
    const ac = document.querySelector('.ac')
    const zoom = ac ? parseFloat((getComputedStyle(ac) as any).zoom || '') || 1 : 1
    popStyle.value = popPositionOf({
      trigger: triggerEl.getBoundingClientRect(),
      // 自然宽高必须在切 fixed 之前读：切完之后宽度会受 left/right 约束影响
      popWidth: popEl.offsetWidth || MENU_WIDTH,
      popHeight: popEl.offsetHeight || 132,
      zoom,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    })
  }

  function toggleMenu(id: string) {
    if (openMenu.value === id) {
      closeMenu()
      return
    }
    openMenu.value = id
    menuOpen.value = true
    openedAt = Date.now()
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

  function closeMenu(restoreFocus = false) {
    if (!openMenu.value) return
    const trigger = triggerEl
    openMenu.value = ''
    menuOpen.value = false
    popStyle.value = {}
    if (popEl && popKeydown) popEl.removeEventListener('keydown', popKeydown)
    popEl = null
    popKeydown = null
    triggerEl = null
    /* 焦点归位（2026-10-06 审核 §主题 2）：菜单条目激活或 Esc 关闭后，
       焦点必须还给 ⋯ 触发钮——否则掉到 body，键盘用户在长表格里每操作一次就丢位置。
       必须在 triggerEl 置空之前取引用；只在「菜单内操作 / 键盘关闭」时回焦，
       点击页面其它位置关闭时不抢焦点（用户已把注意力移走）。 */
    if (restoreFocus && trigger && document.contains(trigger)) {
      trigger.focus({ preventScroll: true })
    }
  }

  function onDocClickCapture(e: MouseEvent) {
    lastClickTarget = e.target
  }
  function onDocClick(e: MouseEvent) {
    if (!openMenu.value) return
    const t = e.target as Node | null
    const insideMenu = !!(popEl && t && popEl.contains(t))
    const onTrigger = !!(triggerEl && t && triggerEl.contains(t))
    closeMenu(insideMenu || onTrigger)
  }
  function onDocKeydown(e: KeyboardEvent) {
    // 焦点不在菜单内时 Esc 走到这里（document 冒泡先于 window 监听）：
    // 关菜单后 stopPropagation，阻断 useEscape 的 LIFO 栈在同一次 Esc 里继续关底层抽屉
    if (e.key === 'Escape' && openMenu.value) {
      e.stopPropagation()
      closeMenu(true)
    }
  }
  function onDocScroll() {
    if (!openMenu.value) return
    // 菜单打开后 200ms 内的滚动（焦点自动滚动/渲染抖动）不关闭菜单
    if (Date.now() - openedAt < 200) return
    closeMenu()
  }
  /* resize 与 scroll 同档：只是收菜单，不回焦（视口变化/滚动不代表用户在菜单里做了操作） */
  function onDocResize() {
    closeMenu()
  }

  onMounted(() => {
    document.addEventListener('click', onDocClick)
    document.addEventListener('click', onDocClickCapture, true)
    document.addEventListener('keydown', onDocKeydown)
    document.addEventListener('scroll', onDocScroll, true)
    window.addEventListener('resize', onDocResize)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('click', onDocClick)
    document.removeEventListener('click', onDocClickCapture, true)
    document.removeEventListener('keydown', onDocKeydown)
    document.removeEventListener('scroll', onDocScroll, true)
    window.removeEventListener('resize', onDocResize)
  })

  return { openMenu, toggleMenu, closeMenu, menuOpen, popStyle }
}
