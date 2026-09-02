<template>
  <div class="mk-tabbar" role="tablist" aria-label="已打开页面" @click="ctx = null">
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
    <span v-if="tabs.length > 1" class="mk-tabbar__hint">点击切换 · ✕ 关闭 · 右键更多</span>

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
import { ref } from 'vue'
export interface AdminTab {
  id: string
  label: string
  title?: string
  /** 固定标签：不可关闭（右键菜单可取消固定） */
  pinned?: boolean
}
defineProps<{
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
/* 点击空白/滚动关闭菜单 */
</script>

<style scoped>
.mk-tabbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 16px 0;
  overflow-x: auto;
  scrollbar-width: none;
  border-bottom: 1px solid var(--mk-line);
  background: var(--mk-surface, #fff);
  flex-shrink: 0;
  position: relative;
}
.mk-tabbar::-webkit-scrollbar { display: none; }
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
.mk-tabbar__hint { margin-left: auto; font-size: var(--mk-fs-11); color: var(--mk-faint); white-space: nowrap; padding-right: 4px; }

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
html[data-theme='dark'] .mk-tabbar__close:hover:not(:disabled) { background: #2c3a55; color: #e6edf7; }
html[data-theme='dark'] .mk-tabbar__ctx { background: #17202f; border-color: #232f45; }
html[data-theme='dark'] .mk-tabbar__ctx-item:hover:not(:disabled) { background: #1f2b40; color: #e6edf7; }
html[data-theme='dark'] .mk-tabbar__ctx-sep { background: #232f45; }

/* 1440px 中间档 */
@media (min-width: 1440px) {
  .mk-tabbar { padding: 7px 20px 0; }
  .mk-tabbar__item { font-size: 12.5px; max-width: 200px; }
  .mk-tabbar__hint { font-size: 11.5px; }
}

/* 1920px 档（最低标准 1080p 全屏） */
@media (min-width: 1920px) {
  .mk-tabbar { padding: 8px 21px 0; }
  .mk-tabbar__item { font-size: 13px; max-width: 210px; }
  .mk-tabbar__hint { font-size: 12px; }
}

/* 4K 三档（对齐全站 mk 体系） */
@media (min-width: 2000px) {
  .mk-tabbar { padding: 8px 22px 0; gap: 6px; }
  .mk-tabbar__item { font-size: 13.5px; padding: 5px 8px 5px 14px; max-width: 220px; }
  .mk-tabbar__close { width: 20px; height: 20px; font-size: 11px; }
  .mk-tabbar__hint { font-size: 12.5px; }
}
@media (min-width: 2800px) {
  .mk-tabbar { padding: 10px 28px 0; }
  .mk-tabbar__item { font-size: 16px; max-width: 260px; }
  .mk-tabbar__hint { font-size: 15px; }
}
</style>
