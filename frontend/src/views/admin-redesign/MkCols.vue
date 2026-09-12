<template>
  <div ref="rootEl" class="mk-cols">
    <button type="button" class="mk-link" :class="{ 'mk-link--active': open }" @click="open = !open" :aria-expanded="open" title="设置显示的列">列</button>
    <div v-if="open" class="mk-cols__menu" @click.stop>
      <label v-for="c in colDefs" :key="c.key" class="mk-cols__item" :title="c.title">
        <input type="checkbox" :checked="!hidden.has(c.key)" @change="toggle(c.key)" />
        <span>{{ c.label }}</span>
      </label>
      <button v-if="hidden.size" type="button" class="mk-cols__reset" @click="hidden = new Set()">恢复全部列</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'

/**
 * 列显隐公共组件（P1-3）：卡片头「列」按钮 + 勾选菜单 + localStorage 持久化。
 * 用法：<MkCols :col-defs="[...]" storage-key="wf_xxx_hidden_cols" v-model:hidden="hiddenCols" />
 * 页面表头/行用 hidden.has('key') 控制 v-if。
 */
const props = defineProps<{
  colDefs: ReadonlyArray<{ key: string; label: string; title?: string }>
  storageKey: string
  /** 首次访问（本地尚无记录）时默认隐藏的列 key；已有记录则尊重用户配置 */
  defaultHidden?: ReadonlyArray<string>
}>()
const hidden = defineModel<Set<string>>('hidden', { default: () => new Set<string>() })
const open = ref(false)
const rootEl = ref<HTMLElement | null>(null)

/* 点击组件外部 / Esc 关闭菜单（此前只能再次点击「列」关闭，菜单可长时间悬浮遮挡表格） */
function onDocMousedown(e: MouseEvent) {
  if (!open.value) return
  const root = rootEl.value
  if (root && e.target instanceof Node && !root.contains(e.target)) open.value = false
}
function onDocKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && open.value) open.value = false
}

onMounted(() => {
  try {
    const raw = localStorage.getItem(props.storageKey)
    if (raw == null && props.defaultHidden?.length) {
      hidden.value = new Set(props.defaultHidden)
    } else {
      const saved = JSON.parse(raw || '[]') as unknown
      if (Array.isArray(saved)) hidden.value = new Set(saved.filter((x): x is string => typeof x === 'string'))
    }
  } catch { /* 隐私模式忽略 */ }
  document.addEventListener('mousedown', onDocMousedown, true)
  document.addEventListener('keydown', onDocKeydown)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocMousedown, true)
  document.removeEventListener('keydown', onDocKeydown)
})

watch(hidden, (s) => {
  try { localStorage.setItem(props.storageKey, JSON.stringify([...s])) } catch { /* ignore */ }
}, { deep: true })

function toggle(key: string) {
  const next = new Set(hidden.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  hidden.value = next
}
</script>

<style scoped>
.mk-cols { position: relative; display: inline-flex; }
.mk-cols__menu {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  z-index: var(--mk-z-menu);
  min-width: 150px;
  padding: 6px;
  display: grid;
  gap: 2px;
  background: var(--mk-surface, #fff);
  border: 1px solid var(--mk-line);
  border-radius: 10px;
  box-shadow: var(--mk-shadow-pop);
}
.mk-cols__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 7px;
  font-size: var(--mk-fs-12_5);
  color: var(--mk-muted);
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
}
.mk-cols__item:hover { background: #f0f5ff; }
html[data-theme='dark'] .mk-cols__item:hover { background: #1f2b40; }
.mk-cols__item input { accent-color: var(--mk-blue, #2c63d0); }
.mk-cols__reset {
  margin-top: 4px;
  border: 0;
  background: transparent;
  padding: 6px 8px;
  border-radius: 7px;
  border-top: 1px dashed var(--mk-line);
  font: inherit;
  font-size: var(--mk-fs-12);
  font-weight: 700;
  color: var(--mk-blue);
  cursor: pointer;
  text-align: left;
}
.mk-cols__reset:hover { background: #eff6ff; }
html[data-theme='dark'] .mk-cols__reset:hover { background: #1f2b40; }
</style>
