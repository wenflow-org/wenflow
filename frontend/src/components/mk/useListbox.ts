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

  function scrollActiveIntoView() {
    const item = menuEl.value?.children[activeIndex.value] as HTMLElement | undefined
    item?.scrollIntoView({ block: 'nearest' })
  }

  function openMenu() {
    if (open.value) return
    open.value = true
    const i = options().findIndex(isSelected)
    activeIndex.value = i >= 0 ? i : 0
    void nextTick(scrollActiveIntoView)
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
    const root = rootEl.value
    if (root && e.target instanceof Node && !root.contains(e.target)) closeMenu()
  }
  onMounted(() => document.addEventListener('mousedown', onDocMousedown, true))
  onBeforeUnmount(() => document.removeEventListener('mousedown', onDocMousedown, true))

  return {
    open,
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
