<template>
  <Teleport to="body">
    <div v-if="open" ref="maskRef" class="pal">
      <div ref="panelRef" class="pal__panel" role="dialog" aria-label="命令面板">
        <div class="pal__input-row">
          <span class="pal__icon">⌕</span>
          <input
            ref="inputEl"
            v-model="query"
            class="pal__input"
            role="combobox"
            aria-expanded="true"
            aria-controls="pal-listbox"
            :aria-activedescendant="flat[active] ? `pal-opt-${flat[active].key}` : undefined"
            placeholder="搜索页面或操作…（↑↓ 选择，Enter 执行）"
            @keydown.down.prevent="move(1)"
            @keydown.up.prevent="move(-1)"
            @keydown.enter.prevent="run(active)"
          />
          <span class="pal__esc">ESC</span>
        </div>

        <div id="pal-listbox" class="pal__list" role="listbox">
          <template v-for="group in grouped" :key="group.title">
            <div class="pal__group">{{ group.title }}</div>
            <button
              v-for="item in group.items"
              :key="item.key"
              :id="`pal-opt-${item.key}`"
              type="button"
              role="option"
              class="pal__item"
              :class="{ 'pal__item--active': flat[active] === item }"
              :aria-selected="flat[active] === item"
              @mouseenter="active = flat.indexOf(item)"
              @click="run(flat.indexOf(item))"
            >
              <span class="pal__item-icon">{{ item.icon }}</span>
              <span class="pal__item-label">{{ item.label }}</span>
              <span v-if="item.hint" class="pal__item-hint">{{ item.hint }}</span>
            </button>
          </template>
          <p v-if="!flat.length" class="pal__empty">没有匹配的页面或操作</p>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { MOCK_SCENES } from './manifest'
import { dataSource, openTrace, queueQuickAction } from './store'
import { loadLiveData, backToDemo } from './live'
import { useOverlay, useMaskClose } from './useOverlay'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'navigate', id: string): void
}>()

interface Item {
  key: string
  icon: string
  label: string
  hint?: string
  group: string
  run: () => void
}

const query = ref('')
const active = ref(0)
const inputEl = ref<HTMLInputElement | null>(null)

const items = computed<Item[]>(() => {
  const list: Item[] = MOCK_SCENES.map((s) => ({
    key: `scene:${s.id}`,
    icon: '▸',
    label: s.label,
    hint: s.group,
    group: '页面',
    run: () => emit('navigate', s.id)
  }))
  list.push(
    {
      key: 'action:live',
      icon: '●',
      label: dataSource.value === 'live' ? '刷新真实数据' : '切换到真实数据',
      hint: '数据源',
      group: '操作',
      run: () => void loadLiveData(true)
    },
    {
      key: 'action:demo',
      icon: '○',
      label: '切换到演示数据',
      hint: '数据源',
      group: '操作',
      run: () => backToDemo()
    },
    {
      key: 'action:create-user',
      icon: '＋',
      label: '新建用户',
      hint: '用户',
      group: '操作',
      run: () => queueQuickAction('users', 'create-user')
    },
    {
      key: 'action:create-announcement',
      icon: '＋',
      label: '新建公告',
      hint: '公告',
      group: '操作',
      run: () => queueQuickAction('announcements', 'create-announcement')
    },
    {
      key: 'action:create-virtual',
      icon: '＋',
      label: '新建虚拟学习者样本',
      hint: '虚拟学习者',
      group: '操作',
      run: () => queueQuickAction('virtual-learners', 'create-virtual')
    }
  )
  // Trace ID 直接跳转
  const q = query.value.trim()
  if (/^(tr:|gw[-_]|log:)/i.test(q)) {
    list.unshift({
      key: `trace:${q}`,
      icon: '⌁',
      label: `在 Trace 瀑布打开 ${q.slice(0, 24)}`,
      hint: '排查',
      group: '直达',
      run: () => openTrace(q)
    })
  }
  return list
})

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q || /^(tr:|gw[-_]|log:)/i.test(q)) return items.value
  return items.value.filter((i) => `${i.label} ${i.hint || ''}`.toLowerCase().includes(q))
})

const grouped = computed(() => {
  const out: { title: string; items: Item[] }[] = []
  for (const item of filtered.value) {
    let g = out.find((x) => x.title === item.group)
    if (!g) {
      g = { title: item.group, items: [] }
      out.push(g)
    }
    g.items.push(item)
  }
  return out
})

const flat = computed(() => filtered.value)

/* 覆盖层统一行为：滚动锁定 + 焦点（输入框自动聚焦）+ 遮罩安全关闭 */
const panelRef = ref<HTMLElement | null>(null)
const maskRef = ref<HTMLElement | null>(null)
useOverlay(computed(() => props.open), panelRef)
useMaskClose(maskRef, close)

watch(
  () => props.open,
  async (v) => {
    if (v) {
      query.value = ''
      active.value = 0
      await nextTick()
      inputEl.value?.focus()
    }
  }
)
watch(flat, () => (active.value = 0))

function move(d: number) {
  if (!flat.value.length) return
  active.value = (active.value + d + flat.value.length) % flat.value.length
}

function run(idx: number) {
  const item = flat.value[idx]
  if (!item) return
  item.run()
  close()
}

function close() {
  emit('close')
}
</script>

<style scoped>
.pal {
  position: fixed;
  inset: 0;
  z-index: var(--mk-z-modal);
  background: rgba(15, 23, 42, 0.4);
  display: flex;
  justify-content: center;
  padding-top: 12vh;
}
.pal__panel {
  width: min(520px, 92vw);
  max-height: 60vh;
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 24px 64px rgba(15, 23, 42, 0.28);
  display: grid;
  grid-template-rows: auto 1fr;
  overflow: hidden;
  animation: pal-in 0.16s ease;
}


@keyframes pal-in { from { transform: translateY(-8px); opacity: 0; } }

.pal__input-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 13px 16px;
  border-bottom: 1px solid var(--mk-line);
}
.pal__icon { color: var(--mk-faint); font-size: 15px; }
.pal__input {
  flex: 1;
  border: 0;
  outline: none;
  font: inherit;
  font-size: 14px;
  color: #1a2a44;
  background: transparent;
}
.pal__input:focus {
  border-color: var(--mk-blue);
  box-shadow: 0 0 0 3px rgba(44, 99, 208, 0.25);
}
.pal__esc {
  font-size: 10px;
  font-weight: 700;
  color: var(--mk-faint);
  border: 1px solid var(--mk-line);
  border-radius: 5px;
  padding: 2px 6px;
}

.pal__list { overflow-y: auto; padding: 6px; }
.pal__group {
  padding: 8px 10px 4px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--mk-faint);
}
.pal__item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  font: inherit;
  font-size: 13px;
  color: #1a2a44;
  cursor: pointer;
  text-align: left;
}
.pal__item--active { background: #eef5ff; }
.pal__item-icon { color: #3478f6; font-size: 12px; width: 16px; text-align: center; }
.pal__item-label { flex: 1; }
.pal__item-hint { font-size: 11px; color: var(--mk-faint); }
.pal__empty { padding: 20px; text-align: center; color: var(--mk-faint); font-size: 13px; margin: 0; }


/* 4K：命令面板加宽 + 字号跟随壳层放大 */
@media (min-width: 2000px) {
  .pal__panel { width: min(640px, 92vw); }
  .pal__input-row { padding: 16px 20px; }
  .pal__input { font-size: 16.5px; }
  .pal__item { font-size: 15px; padding: 11px 14px; }
  .pal__item-hint { font-size: 13px; }
  .pal__group { font-size: 12.5px; }
  .pal__esc { font-size: 12px; }
}
@media (min-width: 2800px) {
  .pal__panel { width: min(760px, 92vw); }
  .pal__input-row { padding: 20px 26px; }
  .pal__input { font-size: 20px; }
  .pal__item { font-size: 17.5px; padding: 13px 17px; }
  .pal__item-hint { font-size: 15.5px; }
  .pal__group { font-size: 15px; }
  .pal__esc { font-size: 14px; }
}
@media (min-width: 3600px) {
  /* 4K（命令面板 Teleport 到 body，无 zoom）：面板再加宽、字号继续放大 */
  .pal__panel { width: min(900px, 92vw); }
  .pal__input-row { padding: 24px 30px; }
  .pal__input { font-size: 23.5px; }
  .pal__item { font-size: 20.5px; padding: 15px 20px; }
  .pal__item-hint { font-size: 18px; }
  .pal__group { font-size: 17.5px; }
  .pal__esc { font-size: 16.5px; }
}
</style>
