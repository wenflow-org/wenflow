<template>
  <div class="mk-tabbar" @click="onBarClick">
    <button
      type="button"
      class="mk-tabbar__scrollbtn"
      :disabled="!canLeft"
      aria-label="向左滚动标签"
      title="向左滚动"
      @click="scrollByDir(-1)"
    >‹</button>

    <div ref="scrollRef" class="mk-tabbar__scroll" role="tablist" aria-label="已打开页面" @scroll="updateArrows">
      <div
        v-for="t in tabs"
        :key="t.id"
        class="mk-tabbar__item"
        :class="{ 'mk-tabbar__item--active': t.id === current, 'mk-tabbar__item--pinned': t.pinned }"
        role="tab"
        :aria-selected="t.id === current"
        @contextmenu.prevent="openCtx($event, t)"
      >
        <button type="button" class="mk-tabbar__label" :title="t.title || t.label" @click="$emit('select', t.id)">
          <span v-if="t.pinned" class="mk-tabbar__pin" aria-hidden="true">📌</span>{{ t.label }}
        </button>
        <button
          type="button"
          class="mk-tabbar__close"
          :aria-label="`关闭 ${t.label}`"
          :disabled="tabs.length <= 1 || t.pinned"
          :title="t.pinned ? '固定标签不可关闭（右键可取消固定）' : '关闭'"
          @click="$emit('close', t.id)"
        >✕</button>
      </div>
    </div>

    <button
      type="button"
      class="mk-tabbar__scrollbtn"
      :disabled="!canRight"
      aria-label="向右滚动标签"
      title="向右滚动"
      @click="scrollByDir(1)"
    >›</button>

    <!-- 溢出收纳：全部标签下拉（标签多到一屏放不下时的可达入口） -->
    <div v-if="tabs.length > 1" class="mk-tabbar__more">
      <button
        type="button"
        class="mk-tabbar__more-btn"
        :aria-expanded="overflowOpen"
        aria-haspopup="menu"
        title="全部标签页（点击切换 · ✕ 关闭 · 右键更多）"
        @click.stop="toggleOverflow"
      >全部标签 <span class="mk-tabbar__more-caret" aria-hidden="true">▾</span></button>
      <div v-if="overflowOpen" class="mk-tabbar__overflow" role="menu" @click.stop>
        <button
          v-for="t in tabs"
          :key="t.id"
          type="button"
          class="mk-tabbar__overflow-item"
          :class="{ 'is-active': t.id === current }"
          role="menuitem"
          @click="selectFromOverflow(t.id)"
        >
          <span v-if="t.pinned" class="mk-tabbar__pin" aria-hidden="true">📌</span>
          <span class="mk-tabbar__overflow-label">{{ t.label }}</span>
          <span v-if="t.id === current" class="mk-tabbar__overflow-now">当前</span>
        </button>
      </div>
    </div>

    <!-- 右键菜单 -->
    <div v-if="ctx && ctxTab" class="mk-tabbar__ctx" :style="{ left: ctx.x + 'px', top: ctx.y + 'px' }" @click.stop>
      <button type="button" class="mk-tabbar__ctx-item" @click="act('close')">关闭</button>
      <button type="button" class="mk-tabbar__ctx-item" :disabled="ctxTab.pinned" @click="act('togglePin')">{{ ctxTab.pinned ? '取消固定' : '固定' }}</button>
      <div class="mk-tabbar__ctx-sep"></div>
      <button type="button" class="mk-tabbar__ctx-item" @click="act('closeOthers')">关闭其他</button>
      <button type="button" class="mk-tabbar__ctx-item" @click="act('closeRight')">关闭右侧</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
export interface AdminTab {
  id: string
  label: string
  title?: string
  /** 固定标签：不可关闭（右键菜单可取消固定） */
  pinned?: boolean
}
const props = defineProps<{
  tabs: AdminTab[]
  current: string
}>()
const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'close', id: string): void
  (e: 'closeOthers', id: string): void
  (e: 'closeRight', id: string): void
  (e: 'togglePin', id: string): void
}>()

/* 横向溢出收纳：左右滚动按钮 + 全部标签下拉 */
const scrollRef = ref<HTMLElement | null>(null)
const canLeft = ref(false)
const canRight = ref(false)
const overflowOpen = ref(false)

function updateArrows() {
  const el = scrollRef.value
  if (!el) return
  canLeft.value = el.scrollLeft > 1
  canRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
}
function scrollByDir(dir: -1 | 1) {
  const el = scrollRef.value
  if (!el) return
  el.scrollBy({ left: dir * Math.max(160, el.clientWidth * 0.7), behavior: 'smooth' })
  window.setTimeout(updateArrows, 220)
}
function scrollActiveIntoView() {
  const el = scrollRef.value
  if (!el) return
  const active = el.querySelector<HTMLElement>('.mk-tabbar__item--active')
  active?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
}
function toggleOverflow() {
  overflowOpen.value = !overflowOpen.value
}
function selectFromOverflow(id: string) {
  overflowOpen.value = false
  emit('select', id)
}
function onBarClick() {
  ctx.value = null
  overflowOpen.value = false
}
let resizeObserver: ResizeObserver | null = null

/* 右键菜单状态 */
const ctx = ref<{ x: number; y: number } | null>(null)
const ctxTab = ref<AdminTab | null>(null)
function openCtx(e: MouseEvent, t: AdminTab) {
  ctxTab.value = t
  ctx.value = { x: Math.min(e.clientX, window.innerWidth - 160), y: e.clientY }
}
function act(kind: 'close' | 'closeOthers' | 'closeRight' | 'togglePin') {
  const t = ctxTab.value
  if (!t) return
  ctx.value = null
  if (kind === 'close') emit('close', t.id)
  else if (kind === 'togglePin') emit('togglePin', t.id)
  else if (kind === 'closeOthers') emit('closeOthers', t.id)
  else emit('closeRight', t.id)
}
/* 点击空白/滚动/Esc 关闭菜单：
   scroll 事件不冒泡，用 window 捕获阶段监听任意滚动容器；mousedown 命中菜单外即关闭。 */
function onDocMousedown(e: MouseEvent) {
  const el = e.target as HTMLElement | null
  if (ctx.value) {
    if (el && el.closest && el.closest('.mk-tabbar__ctx')) { /* keep */ }
    else ctx.value = null
  }
  if (overflowOpen.value && !(el && el.closest && el.closest('.mk-tabbar__more'))) {
    overflowOpen.value = false
  }
}
function onDocKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    ctx.value = null
    overflowOpen.value = false
  }
}
function onDocScroll() {
  if (ctx.value) ctx.value = null
}
onMounted(() => {
  document.addEventListener('mousedown', onDocMousedown)
  document.addEventListener('keydown', onDocKeydown)
  window.addEventListener('scroll', onDocScroll, true)
  window.addEventListener('resize', updateArrows)
  if (typeof ResizeObserver !== 'undefined' && scrollRef.value) {
    resizeObserver = new ResizeObserver(updateArrows)
    resizeObserver.observe(scrollRef.value)
  }
  void nextTick(() => { updateArrows(); scrollActiveIntoView() })
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocMousedown)
  document.removeEventListener('keydown', onDocKeydown)
  window.removeEventListener('scroll', onDocScroll, true)
  window.removeEventListener('resize', updateArrows)
  resizeObserver?.disconnect()
})
watch(() => props.tabs.length, () => { void nextTick(updateArrows) })
watch(() => props.current, () => { void nextTick(() => { updateArrows(); scrollActiveIntoView() }) })
</script>

<style scoped>
.mk-tabbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px 0;
  border-bottom: 1px solid var(--mk-line);
  background: var(--mk-surface, #fff);
  flex-shrink: 0;
  position: relative;
}
.mk-tabbar__scroll {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1 1 auto;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.mk-tabbar__scroll::-webkit-scrollbar { display: none; }
.mk-tabbar__scrollbtn {
  flex: 0 0 auto;
  width: 22px;
  height: 26px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--mk-muted);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
}
.mk-tabbar__scrollbtn:hover:not(:disabled) { background: #eef2f8; color: var(--mk-ink); }
.mk-tabbar__scrollbtn:disabled { opacity: 0.3; cursor: default; }
.mk-tabbar__more { position: relative; flex: 0 0 auto; }
.mk-tabbar__more-btn {
  border: 0;
  background: transparent;
  padding: 4px 8px;
  border-radius: 7px;
  font: inherit;
  font-size: var(--mk-fs-12);
  font-weight: 600;
  color: var(--mk-muted);
  white-space: nowrap;
  cursor: pointer;
}
.mk-tabbar__more-btn:hover { background: #eef2f8; color: var(--mk-ink); }
.mk-tabbar__more-caret { font-size: 10px; }
.mk-tabbar__overflow {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  z-index: var(--mk-z-menu, 60);
  min-width: 208px;
  max-height: 60vh;
  overflow-y: auto;
  padding: 4px;
  display: grid;
  gap: 2px;
  background: var(--mk-surface, #fff);
  border: 1px solid var(--mk-line);
  border-radius: 10px;
  box-shadow: var(--mk-shadow-pop);
}
.mk-tabbar__overflow-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  border: 0;
  background: transparent;
  padding: 7px 10px;
  border-radius: 7px;
  font: inherit;
  font-size: var(--mk-fs-12_5);
  font-weight: 600;
  color: var(--mk-muted);
  text-align: left;
  cursor: pointer;
}
.mk-tabbar__overflow-item:hover { background: #f0f5ff; color: var(--mk-ink); }
.mk-tabbar__overflow-item.is-active { color: var(--mk-blue); background: #eef5ff; }
.mk-tabbar__overflow-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mk-tabbar__overflow-now { font-size: var(--mk-fs-11); color: var(--mk-blue); flex: 0 0 auto; }

.mk-tabbar__item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px 4px 12px;
  border: 1px solid var(--mk-line);
  border-bottom: none;
  border-radius: 8px 8px 0 0;
  background: #f6f8fb;
  color: var(--mk-muted);
  font-size: var(--mk-fs-12);
  white-space: nowrap;
  max-width: 180px;
  cursor: pointer;
  user-select: none;
  transition: background 0.12s ease, color 0.12s ease;
  flex: 0 0 auto;
}
.mk-tabbar__item:hover { background: #eef2f8; color: var(--mk-ink); }
.mk-tabbar__item--active {
  background: var(--mk-surface, #fff);
  color: var(--mk-blue);
  font-weight: 700;
  box-shadow: 0 -2px 0 0 var(--mk-blue);
}
.mk-tabbar__item--pinned .mk-tabbar__label { color: var(--mk-ink); }
.mk-tabbar__item--active.mk-tabbar__item--pinned .mk-tabbar__label { color: var(--mk-blue); }
.mk-tabbar__pin { font-size: var(--mk-fs-11); margin-right: 2px; opacity: 0.85; }
.mk-tabbar__label {
  border: 0;
  background: transparent;
  padding: 0;
  font: inherit;
  color: inherit;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mk-tabbar__close {
  border: 0;
  background: transparent;
  width: 18px;
  height: 18px;
  border-radius: 5px;
  font-size: var(--mk-fs-11);
  line-height: 1;
  color: var(--mk-faint);
  cursor: pointer;
  flex-shrink: 0;
}
.mk-tabbar__close:hover:not(:disabled) { background: #e2e8f2; color: var(--mk-ink); }
.mk-tabbar__close:disabled { cursor: default; opacity: 0.4; }

/* 右键菜单 */
.mk-tabbar__ctx {
  position: fixed;
  z-index: var(--mk-z-menu, 60);
  min-width: 130px;
  padding: 4px;
  display: grid;
  gap: 2px;
  background: var(--mk-surface, #fff);
  border: 1px solid var(--mk-line);
  border-radius: 10px;
  box-shadow: var(--mk-shadow-pop);
}
.mk-tabbar__ctx-item {
  border: 0;
  background: transparent;
  padding: 7px 10px;
  border-radius: 7px;
  font: inherit;
  font-size: var(--mk-fs-12_5);
  font-weight: 600;
  color: var(--mk-muted);
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
}
.mk-tabbar__ctx-item:hover:not(:disabled) { background: #f0f5ff; color: var(--mk-ink); }
.mk-tabbar__ctx-item:disabled { opacity: 0.45; cursor: default; }
.mk-tabbar__ctx-sep { height: 1px; margin: 3px 4px; background: var(--mk-line); }

/* 暗色模式（D1 联动） */
html[data-theme='dark'] .mk-tabbar { background: #131b2a; border-bottom-color: #232f45; }
html[data-theme='dark'] .mk-tabbar__item { background: #1b2537; border-color: #232f45; color: #9fb0c8; }
html[data-theme='dark'] .mk-tabbar__item:hover { background: #22304a; color: #e6edf7; }
html[data-theme='dark'] .mk-tabbar__item--active { background: #17202f; color: #7aa2ff; }
html[data-theme='dark'] .mk-tabbar__close { color: var(--mk-muted); }
html[data-theme='dark'] .mk-tabbar__close:hover:not(:disabled) { background: #2c3a55; color: #e6edf7; }
html[data-theme='dark'] .mk-tabbar__scrollbtn:hover:not(:disabled) { background: #22304a; color: #e6edf7; }
html[data-theme='dark'] .mk-tabbar__more-btn:hover { background: #22304a; color: #e6edf7; }
html[data-theme='dark'] .mk-tabbar__overflow { background: #17202f; border-color: #232f45; }
html[data-theme='dark'] .mk-tabbar__overflow-item:hover { background: #1f2b40; color: #e6edf7; }
html[data-theme='dark'] .mk-tabbar__overflow-item.is-active { background: #1f2b40; color: #7aa2ff; }
html[data-theme='dark'] .mk-tabbar__ctx { background: #17202f; border-color: #232f45; }
html[data-theme='dark'] .mk-tabbar__ctx-item:hover:not(:disabled) { background: #1f2b40; color: #e6edf7; }
html[data-theme='dark'] .mk-tabbar__ctx-sep { background: #232f45; }

/* 1440px 中间档 */
@media (min-width: 1440px) {
  .mk-tabbar { padding: 7px 16px 0; }
  .mk-tabbar__item { font-size: 12.5px; max-width: 200px; }
}

/* 1920px 档（最低标准 1080p 全屏） */
@media (min-width: 1920px) {
  .mk-tabbar { padding: 8px 18px 0; }
  .mk-tabbar__item { font-size: 13px; max-width: 210px; }
}

/* 4K 三档（对齐全站 mk 体系） */
@media (min-width: 2000px) {
  .mk-tabbar { padding: 8px 20px 0; gap: 6px; }
  .mk-tabbar__item { font-size: 13.5px; padding: 5px 8px 5px 14px; max-width: 220px; }
  .mk-tabbar__close { width: 20px; height: 20px; font-size: 11px; }
  .mk-tabbar__more-btn { font-size: 12.5px; }
}
@media (min-width: 2800px) {
  .mk-tabbar { padding: 10px 26px 0; }
  .mk-tabbar__item { font-size: 16px; max-width: 260px; }
  .mk-tabbar__more-btn { font-size: 15px; }
}
</style>
