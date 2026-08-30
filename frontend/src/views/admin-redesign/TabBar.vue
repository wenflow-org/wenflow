<template>
  <div class="mk-tabbar" role="tablist" aria-label="已打开页面">
    <div v-for="t in tabs" :key="t.id" class="mk-tabbar__item" :class="{ 'mk-tabbar__item--active': t.id === current }" role="tab" :aria-selected="t.id === current">
      <button type="button" class="mk-tabbar__label" :title="t.title || t.label" @click="$emit('select', t.id)">
        {{ t.label }}
      </button>
      <button
        type="button"
        class="mk-tabbar__close"
        :aria-label="`关闭 ${t.label}`"
        :disabled="tabs.length <= 1"
        @click="$emit('close', t.id)"
      >✕</button>
    </div>
    <span v-if="tabs.length > 1" class="mk-tabbar__hint">点击标签切换 · ✕ 关闭</span>
  </div>
</template>

<script setup lang="ts">
export interface AdminTab {
  id: string
  label: string
  title?: string
}
defineProps<{
  tabs: AdminTab[]
  current: string
}>()
defineEmits<{
  (e: 'select', id: string): void
  (e: 'close', id: string): void
}>()
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
  font-size: 12px;
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
  font-size: 10px;
  line-height: 1;
  color: var(--mk-faint);
  cursor: pointer;
  flex-shrink: 0;
}
.mk-tabbar__close:hover:not(:disabled) { background: #e2e8f2; color: var(--mk-ink); }
.mk-tabbar__close:disabled { cursor: default; opacity: 0.4; }
.mk-tabbar__hint { margin-left: auto; font-size: 11px; color: var(--mk-faint); white-space: nowrap; padding-right: 4px; }

/* 暗色模式（D1 联动） */
html[data-theme='dark'] .mk-tabbar { background: #131b2a; border-bottom-color: #232f45; }
html[data-theme='dark'] .mk-tabbar__item { background: #1b2537; border-color: #232f45; color: #9fb0c8; }
html[data-theme='dark'] .mk-tabbar__item:hover { background: #22304a; color: #e6edf7; }
html[data-theme='dark'] .mk-tabbar__item--active { background: #17202f; color: #7aa2ff; }
html[data-theme='dark'] .mk-tabbar__close:hover:not(:disabled) { background: #2c3a55; color: #e6edf7; }

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
