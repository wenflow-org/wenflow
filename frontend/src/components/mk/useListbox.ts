import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { resolveZoomScale, visualViewportHeight } from '@/utils/zoom'

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

  /** 估算弹层高度：选项行 ≈32px（实测：内衬 12 + 行高 20）+ 内衬；
      上限与 `.mk-listbox-pop` 的 max-height 同步，否则「向上弹」的判据会为
      一个按 CSS 收窄后的真实高度算错方向 */
  function estimateMenuHeight(): number {
    return Math.min(options().length * 32 + 8, 440)
  }
  /**
   * 累计算祖先的缩放系数（CSS `zoom` + transform scale）；实现收敛在 utils/zoom。
   */
  const resolveScale = resolveZoomScale

  function placeMenu() {
    const el = triggerEl.value
    if (!el) return
    const rect = el.getBoundingClientRect()
    /* 触发器被隐藏（display:none / 容器折叠）时 rect 全 0：此时写坐标会把弹层
       拖到视口左上角，保持原位等它重新出现。 */
    if (!rect.width && !rect.height) return
    /* 坐标系换算（2026-11-06 走查，2026-11-25 改为精确取缩放）：v2 页在 ≥1600
       视口给 .v2-page 加 zoom（1.08~1.3，admin 壳的 .ac 在 4K 也有同机制）。
       getBoundingClientRect 返回的是**缩放后的视觉坐标**，而弹层虽是 fixed，
       其数值写在缩放子树里——直接用视觉坐标会向右下漂移。
       视觉坐标 ÷ 累计缩放 = 弹层局部坐标系的数值。 */
    const walked = resolveScale(el)
    const ratio = rect.width / (el.offsetWidth || rect.width) || 1
    /* 走 computedStyle 拿到的缩放是精确值；若它没识别出来（例如宿主环境用别的
       机制缩放），再退回「视觉宽 ÷ 布局宽」的估算，保证弹层至少朝正确方向修正。 */
    const scale = walked !== 1 || Math.abs(ratio - 1) < 0.02 ? walked : ratio
    /* 向上/向下展开用**可见视口**高度：iOS 键盘与双指缩放只改 visualViewport，
       window.innerHeight 不变，按它算会把弹层展进键盘区。 */
    const viewportH = visualViewportHeight()
    const below = viewportH / scale - rect.bottom / scale
    const measured = (menuEl.value?.scrollHeight || estimateMenuHeight()) / scale
    const up = below < measured + 8 && rect.top / scale > below
    openUp.value = up
    /* 在弹窗/抽屉里时抬到覆盖层之上（--mk-z-modal + 10）；普通页面用卡片菜单层。
       与 MkModelPicker 同一套 fixed 定位思路：祖先 overflow 不会裁掉浮层。 */
    const inOverlay = !!el.closest('.mk-modal, .mk-drawer')
    popStyle.value = {
      left: `${Math.round(rect.left / scale)}px`,
      top: up ? 'auto' : `${Math.round(rect.bottom / scale + 4)}px`,
      bottom: up ? `${Math.round(below + 4)}px` : 'auto',
      minWidth: `${Math.round(rect.width / scale)}px`,
      /* 弹层已 Teleport 到 body（脱离缩放子树），用自身 zoom 还原页面视觉比例：
         left 先按 scale 换算，再由 zoom 放大回触发框的视觉坐标。 */
      zoom: String(scale),
      zIndex: inOverlay ? 'calc(var(--mk-z-modal) + 10)' : 'var(--mk-z-menu)'
    }
  }

  /* 位置跟随（2026-11-25 反馈「排序菜单位移」）：弹层只在 open / scroll / resize
     时重算，但页面上还有一批「不发事件的重排」——数据加载后工具栏换行、抽屉/侧栏
     挤占宽度、路由过渡里的 transform 建立新的 fixed 包含块、从后台标签页回来时
     zoom 断点已变。触发框一旦移动，fixed 弹层就留在旧坐标上（实测可漂出半屏）。
     开销可控：只在展开态每帧读一次触发框，位置没变就不写样式。 */
  let followHandle = 0
  let lastTriggerKey = ''
  function followTrigger() {
    if (!open.value) {
      followHandle = 0
      return
    }
    const el = triggerEl.value
    if (el) {
      const r = el.getBoundingClientRect()
      const key = `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`
      if (key !== lastTriggerKey) {
        lastTriggerKey = key
        placeMenu()
      }
    }
    followHandle = requestAnimationFrame(followTrigger)
  }
  function startFollow() {
    if (followHandle) return
    lastTriggerKey = ''
    followHandle = requestAnimationFrame(followTrigger)
  }
  function stopFollow() {
    if (followHandle) cancelAnimationFrame(followHandle)
    followHandle = 0
  }

  function openMenu() {
    if (open.value) return
    placeMenu()
    open.value = true
    startFollow()
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
    stopFollow()
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
    /* 移动端双指缩放只改 visualViewport，不触发 window.resize——弹层会留在
       放大前的坐标上。桌面无 visualViewport 时跳过。 */
    window.visualViewport?.addEventListener('resize', onWindowResize)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('mousedown', onDocMousedown, true)
    document.removeEventListener('scroll', onDocScroll, true)
    window.removeEventListener('resize', onWindowResize)
    window.visualViewport?.removeEventListener('resize', onWindowResize)
    if (raf) cancelAnimationFrame(raf)
    stopFollow()
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
