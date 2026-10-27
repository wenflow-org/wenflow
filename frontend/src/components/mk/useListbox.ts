import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

let seq = 0

/** MkSelect 的可选值域：原生 select 能承载的标量（含三态筛选里的 undefined） */
export type SelectValue = string | number | boolean | null | undefined

/**
 * 自绘单选 listbox 的共享行为（MkPillSelect / MkSelect 共用）。
 *
 * 抽出来的原因：两个原语的触发器形态不同（胶囊 / 表单框），但「展开、键盘、点外部关闭、
 * 选中后归还焦点」是同一份契约。复制两份的话，下一次调键盘行为必然只改到一处。
 * 视觉不进这里：弹层外壳由 `.mk-listbox-pop` 承担，组件只负责结构。
 *
 * 契约：
 * - ↑↓ 循环移动、Home/End 到首尾、Enter/Space 选中、Esc 关闭、Tab 关闭；
 * - 点组件外部（document mousedown capture）关闭；
 * - Esc 必须 stopPropagation——若下拉出现在抽屉/弹窗内，不能顺带关掉底层一层
 *   （与 MkCols / useRowMenu 的既定做法一致）；
 * - 关闭后焦点回到触发器，键盘用户不会丢位置。
 */
export function useListbox<O>(
  options: () => readonly O[],
  isSelected: (o: O) => boolean,
  onPick: (o: O) => void
) {
  const menuId = `mk-listbox-${++seq}-${Math.random().toString(36).slice(2, 7)}`
  const optionId = (i: number) => `${menuId}-opt-${i}`

  const open = ref(false)
  const activeIndex = ref(-1)
  const rootEl = ref<HTMLElement | null>(null)
  const triggerEl = ref<HTMLElement | null>(null)
  const menuEl = ref<HTMLElement | null>(null)
  /** 触发器靠近视口底部时向上弹（分页器在页脚，向下展开会掉出视口） */
  const openUp = ref(false)
  /** fixed 定位坐标：弹层不受 modal/drawer/表格滚动容器的 overflow 裁剪 */
  const popStyle = ref<Record<string, string>>({})

  function scrollActiveIntoView() {
    const item = menuEl.value?.children[activeIndex.value] as HTMLElement | undefined
    item?.scrollIntoView({ block: 'nearest' })
  }

  /** 估算弹层高度：选项行 ≈29px + 内衬；实际展开后再用 scrollHeight 校正 */
  function estimateMenuHeight(): number {
    return Math.min(options().length * 29 + 12, 320)
  }
  function placeMenu() {
    const el = triggerEl.value
    if (!el) return
    const rect = el.getBoundingClientRect()
    const below = window.innerHeight - rect.bottom
    const measured = menuEl.value?.scrollHeight || estimateMenuHeight()
    const up = below < measured + 8 && rect.top > below
    openUp.value = up
    /* 在弹窗/抽屉里时抬到覆盖层之上（--mk-z-modal + 10）；普通页面用卡片菜单层。
       与 MkModelPicker 同一套 fixed 定位思路：祖先 overflow 不会裁掉浮层。 */
    const inOverlay = !!el.closest('.mk-modal, .mk-drawer')
    popStyle.value = {
      left: `${Math.round(rect.left)}px`,
      top: up ? 'auto' : `${Math.round(rect.bottom + 4)}px`,
      bottom: up ? `${Math.round(window.innerHeight - rect.top + 4)}px` : 'auto',
      minWidth: `${Math.round(rect.width)}px`,
      zIndex: inOverlay ? 'calc(var(--mk-z-modal) + 10)' : 'var(--mk-z-menu)'
    }
  }

  function openMenu() {
    if (open.value) return
    placeMenu()
    open.value = true
    const i = options().findIndex(isSelected)
    activeIndex.value = i >= 0 ? i : 0
    void nextTick(() => {
      /* 选项渲染后拿到真实高度再校正一次（长列表比估算高） */
      placeMenu()
      scrollActiveIntoView()
    })
  }
  function closeMenu() {
    open.value = false
  }
  function toggleMenu() {
    if (open.value) closeMenu()
    else openMenu()
  }

  function choose(o: O) {
    onPick(o)
    closeMenu()
    triggerEl.value?.focus()
  }
  function chooseAt(i: number) {
    const o = options()[i]
    if (o !== undefined) choose(o)
  }

  function move(delta: number) {
    const n = options().length
    if (!n) return
    activeIndex.value = (activeIndex.value + delta + n) % n
    void nextTick(scrollActiveIntoView)
  }

  function onTriggerKeydown(e: KeyboardEvent) {
    if (!open.value) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault()
        openMenu()
      }
      return
    }
    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        /* 拦下冒泡：覆盖层（抽屉/弹窗）在 window 上有 useEscape LIFO 栈，
           一次 Esc 只应关掉这层下拉，不应连带关掉底层。 */
        e.stopPropagation()
        closeMenu()
        break
      case 'ArrowDown':
        e.preventDefault()
        move(1)
        break
      case 'ArrowUp':
        e.preventDefault()
        move(-1)
        break
      case 'Home':
        e.preventDefault()
        activeIndex.value = 0
        void nextTick(scrollActiveIntoView)
        break
      case 'End':
        e.preventDefault()
        activeIndex.value = options().length - 1
        void nextTick(scrollActiveIntoView)
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        if (activeIndex.value >= 0) chooseAt(activeIndex.value)
        break
      case 'Tab':
        closeMenu()
        break
    }
  }

  function onDocMousedown(e: MouseEvent) {
    if (!open.value) return
    const target = e.target
    if (!(target instanceof Node)) return
    /* 弹层可能是独立定位层：根与菜单都要判「内部」 */
    const inside = rootEl.value?.contains(target) || menuEl.value?.contains(target)
    if (!inside) closeMenu()
  }

  /* fixed 定位后滚动/缩放会让弹层脱离触发器：跟随重算，而不是让它悬在旧位置。
     菜单自身滚动（长列表）不算页面滚动。 */
  let raf = 0
  function onDocScroll(e: Event) {
    if (!open.value) return
    const target = e.target
    if (target instanceof Node && menuEl.value?.contains(target)) return
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      if (open.value) placeMenu()
    })
  }
  function onWindowResize() {
    if (open.value) placeMenu()
  }

  onMounted(() => {
    document.addEventListener('mousedown', onDocMousedown, true)
    document.addEventListener('scroll', onDocScroll, true)
    window.addEventListener('resize', onWindowResize)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('mousedown', onDocMousedown, true)
    document.removeEventListener('scroll', onDocScroll, true)
    window.removeEventListener('resize', onWindowResize)
    if (raf) cancelAnimationFrame(raf)
  })

  return {
    open,
    openUp,
    popStyle,
    activeIndex,
    rootEl,
    triggerEl,
    menuEl,
    menuId,
    optionId,
    openMenu,
    closeMenu,
    toggleMenu,
    choose,
    onTriggerKeydown
  }
}
