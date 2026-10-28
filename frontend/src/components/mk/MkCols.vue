<template>
  <div v-if="colDefs.length" ref="rootEl" class="mk-cols">
    <button
      type="button"
      class="mk-link mk-cols__trigger"
      :class="{ 'mk-link--active': open }"
      :aria-expanded="open"
      aria-haspopup="true"
      aria-label="列设置：显示或隐藏表格列"
      title="列设置：显示 / 隐藏表格列"
      @click="open = !open"
    >
      <span>列</span>
    </button>
    <div v-if="open" class="mk-cols__menu" role="group" aria-label="显示列" @click.stop>
      <div class="mk-cols__head">
        <span class="mk-cols__title">显示列</span>
        <span class="mk-cols__hint">{{ colDefs.length - hidden.size }} / {{ colDefs.length }}</span>
      </div>
      <label v-for="c in colDefs" :key="c.key" class="mk-cols__item" :title="c.title">
        <input type="checkbox" :checked="!hidden.has(c.key)" @change="toggle(c.key)" />
        <span>{{ c.label }}</span>
      </label>
      <!-- 「恢复默认」= 回到该页首访的默认集（不是一律全显）：
           像目标对话的「约束条件」、用户页的「选择框」本就默认收起，
           旧按钮写「恢复全部列」会把它们翻出来，与页面意图相反。 -->
      <button v-if="!isDefault" type="button" class="mk-cols__reset" @click="resetToDefault">恢复默认</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'

/**
 * 列显隐公共组件（P1-3）：卡片头「列」入口 + 勾选菜单 + localStorage 持久化。
 * 可见文案只有「列」——不带图标、不带隐藏计数（2026-10-27 用户「不要计数，并且去掉前面的图标」）。
 * 可访问名与 title 仍写全「列设置：显示或隐藏表格列」，鼠标悬停 / 读屏能自解释。
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

const defaultSet = computed(() => new Set(props.defaultHidden ?? []))
/** 当前是否仍是「该页首访的默认集」——决定要不要出「恢复默认」 */
const isDefault = computed(() => {
  if (hidden.value.size !== defaultSet.value.size) return false
  for (const key of defaultSet.value) if (!hidden.value.has(key)) return false
  return true
})

/* 点击组件外部 / Esc 关闭菜单（此前只能再次点击入口关闭，菜单可长时间悬浮遮挡表格） */
function onDocMousedown(e: MouseEvent) {
  if (!open.value) return
  const root = rootEl.value
  if (root && e.target instanceof Node && !root.contains(e.target)) open.value = false
}
function onDocKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !open.value) return
  /* 拦下冒泡（2026-10-06 审核，与 useRowMenu.ts 既定做法同款）：列菜单若出现在
     抽屉/弹窗内，一次 Esc 会被 window 上的 useEscape LIFO 栈再关掉底层一层。
     当前调用方都在卡头（不在覆盖层内），但契约应与行内菜单一致。 */
  e.stopPropagation()
  open.value = false
}

onMounted(() => {
  try {
    const raw = localStorage.getItem(props.storageKey)
    if (raw == null) {
      /* 首访：只有在给了 defaultHidden 时才覆盖 v-model 初值。
         若既无本地记录、也无 defaultHidden，不能拿空集覆盖页面传入的 v-model 初值
         （否则首访默认隐藏列永不生效，且 watch 会立刻把这枚空集写回 localStorage，
          把用户配置也一并钉死）。 */
      if (props.defaultHidden?.length) hidden.value = new Set(props.defaultHidden)
    } else {
      const saved = JSON.parse(raw) as unknown
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

function resetToDefault() {
  hidden.value = new Set(props.defaultHidden ?? [])
}
</script>

<style scoped>
.mk-cols { position: relative; display: inline-flex; }
/* 触发器与工具条里的搜索框/筛选同一行盒：文字链本身只有 20px 高，
   在 32px 的控件行里会贴着中线「浮」着（2026-10-27 表头复核） */
.mk-cols__trigger { display: inline-flex; align-items: center; gap: 5px; min-height: 32px; }
.mk-cols__menu {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  z-index: var(--mk-z-menu);
  min-width: 168px;
  max-height: min(70vh, 420px);
  overflow-y: auto;
  padding: 6px;
  display: grid;
  gap: 2px;
  background: var(--mk-surface);
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-xl);
  box-shadow: var(--mk-shadow-pop);
}
.mk-cols__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 2px;
  padding: 4px 8px 6px;
  border-bottom: 1px solid var(--mk-line);
}
.mk-cols__title { font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-ink); }
.mk-cols__hint { font-size: var(--mk-fs-micro); color: var(--mk-faint); font-variant-numeric: tabular-nums; }
.mk-cols__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--mk-radius-sm);
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
}
.mk-cols__item:hover { background: var(--mk-graph-flow-bg); } /* #f0f5ff/暗#252627 的成对令牌，字面量+暗色覆写退役 */
.mk-cols__item input { accent-color: var(--mk-blue); }
.mk-cols__reset {
  margin-top: 4px;
  border: 0;
  background: transparent;
  padding: 6px 8px;
  border-radius: var(--mk-radius-sm);
  border-top: 1px dashed var(--mk-line);
  font: inherit;
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  color: var(--mk-blue);
  cursor: pointer;
  text-align: left;
}
.mk-cols__reset:hover { background: var(--mk-graph-hover-bg); } /* #eff6ff/暗#252627 的成对令牌，字面量+暗色覆写退役 */
</style>
