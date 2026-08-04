<template>
  <Teleport to="body">
    <div v-if="visible" class="command-palette" @mousedown.self="close">
      <div class="command-palette__panel" role="dialog" aria-modal="true" aria-label="快速跳转">
        <div class="command-palette__input-row">
          <el-icon class="command-palette__search-icon"><Search /></el-icon>
          <input
            ref="inputRef"
            v-model="query"
            class="command-palette__input"
            type="text"
            placeholder="搜索页面或功能…"
            aria-label="搜索页面或功能"
            role="combobox"
            aria-expanded="true"
            :aria-activedescendant="activeId"
            @keydown.down.prevent="move(1)"
            @keydown.up.prevent="move(-1)"
            @keydown.enter.prevent="confirm"
            @keydown.esc.prevent="close"
          />
          <kbd class="command-palette__kbd">Esc</kbd>
        </div>

        <div ref="listRef" class="command-palette__list" role="listbox">
          <template v-if="filteredGroups.length">
            <div v-for="group in filteredGroups" :key="group.title" class="command-palette__group">
              <div class="command-palette__group-title">{{ group.title }}</div>
              <div
                v-for="item in group.items"
                :id="`cmd-item-${item.flatIndex}`"
                :key="item.to"
                class="command-palette__item"
                :class="{ 'is-active': item.flatIndex === activeIndex }"
                role="option"
                :aria-selected="item.flatIndex === activeIndex"
                @mouseenter="activeIndex = item.flatIndex"
                @click="select(item)"
              >
                <el-icon class="command-palette__item-icon"><component :is="item.icon" /></el-icon>
                <span class="command-palette__item-label">{{ item.label }}</span>
                <span class="command-palette__item-path">{{ item.to }}</span>
              </div>
            </div>
          </template>
          <div v-else class="command-palette__empty">没有匹配「{{ query }}」的页面</div>
        </div>

        <div class="command-palette__footer">
          <span><kbd>↑↓</kbd> 选择</span>
          <span><kbd>Enter</kbd> 跳转</span>
          <span><kbd>Esc</kbd> 关闭</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch, type Component } from 'vue'
import { Search } from '@element-plus/icons-vue'

interface PaletteNavItem {
  to: string
  label: string
  icon: Component
  external?: boolean
}

interface PaletteNavGroup {
  title: string
  items: PaletteNavItem[]
}

const props = defineProps<{
  visible: boolean
  navGroups: PaletteNavGroup[]
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'select', item: PaletteNavItem): void
}>()

const query = ref('')
const activeIndex = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)
const listRef = ref<HTMLElement | null>(null)

// 别名表：用英文/惯用词也能搜到中文页面
const KEYWORDS: Record<string, string> = {
  '/admin/dashboard': 'overview 总览 概览 shouye',
  '/admin/users': 'user yonghu 用户',
  '/admin/learner-center': 'learner xuexi 学习者 学情',
  '/admin/virtual-learners': 'virtual xuni 虚拟 模拟',
  '/admin/skills': 'skill jineng 技能 目录',
  '/admin/agents/topology': 'agent topology tuopu 拓扑',
  '/admin/orchestrator-definitions': 'orchestrator bianpai 编排 流程',
  '/admin/execution-logs': 'log zhixing 执行 日志 trace',
  '/admin/path-generation-events': 'event shijian 事件 流程 path',
  '/admin/prompt-call-logs': 'prompt tishi 提示词 调用',
  '/admin/api-config': 'api config peizhi 配置 连接 安全 密钥',
  '/admin/skill-model-configs': 'model moxing 模型 外挂 组件',
  '/admin/prompt-lab': 'prompt lab dryrun 调试 实验'
}

interface FlatItem extends PaletteNavItem {
  flatIndex: number
  groupTitle: string
}

const filteredGroups = computed(() => {
  const q = query.value.trim().toLowerCase()
  let flatIndex = 0
  const groups: Array<{ title: string; items: FlatItem[] }> = []
  for (const group of props.navGroups) {
    const items = group.items
      .filter((item) => {
        if (!q) return true
        const haystack = `${item.label} ${item.to} ${KEYWORDS[item.to] || ''}`.toLowerCase()
        return haystack.includes(q)
      })
      .map((item) => ({ ...item, flatIndex: flatIndex++, groupTitle: group.title }))
    if (items.length) groups.push({ title: group.title, items })
  }
  return groups
})

const flatItems = computed(() => filteredGroups.value.flatMap((g) => g.items))

const activeId = computed(() => `cmd-item-${activeIndex.value}`)

watch(
  () => props.visible,
  async (v) => {
    if (v) {
      query.value = ''
      activeIndex.value = 0
      await nextTick()
      inputRef.value?.focus()
    }
  }
)

watch(query, () => {
  activeIndex.value = 0
})

const move = (delta: number) => {
  const count = flatItems.value.length
  if (!count) return
  activeIndex.value = (activeIndex.value + delta + count) % count
  nextTick(() => {
    listRef.value?.querySelector(`#cmd-item-${activeIndex.value}`)?.scrollIntoView({ block: 'nearest' })
  })
}

const select = (item: FlatItem) => {
  emit('select', item)
  close()
}

const confirm = () => {
  const item = flatItems.value[activeIndex.value]
  if (item) select(item)
}

const close = () => {
  emit('update:visible', false)
}
</script>

<style scoped>
.command-palette {
  position: fixed;
  inset: 0;
  z-index: 3000;
  background: rgba(15, 23, 42, 0.38);
  backdrop-filter: blur(2px);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 15vh 16px 16px;
}

.command-palette__panel {
  width: 560px;
  max-width: 100%;
  max-height: 60vh;
  display: flex;
  flex-direction: column;
  background: var(--admin-bg-surface, #fff);
  border: var(--admin-border, 1px solid #e1e8f2);
  border-radius: var(--admin-radius-lg, 16px);
  box-shadow: 0 24px 64px rgba(15, 23, 42, 0.22);
  overflow: hidden;
}

.command-palette__input-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: var(--admin-border-subtle, 1px solid rgba(209, 218, 235, 0.7));
}

.command-palette__search-icon {
  color: var(--admin-text-muted, #64748b);
  font-size: 16px;
  flex-shrink: 0;
}

.command-palette__input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 15px;
  color: var(--admin-text-primary, #1a2a44);
}

.command-palette__input::placeholder {
  color: var(--admin-text-muted, #64748b);
}

.command-palette__kbd,
.command-palette__footer kbd {
  padding: 2px 6px;
  border-radius: var(--admin-radius-xs, 4px);
  border: 1px solid var(--admin-border-color, #e1e8f2);
  background: var(--admin-bg-surface-alt, #fafbfc);
  color: var(--admin-text-muted, #64748b);
  font-size: 11px;
  font-family: inherit;
}

.command-palette__list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.command-palette__group-title {
  padding: 8px 10px 4px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--admin-text-muted, #64748b);
}

.command-palette__item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border-radius: var(--admin-radius-sm, 8px);
  cursor: pointer;
  color: var(--admin-text-secondary, #5b6577);
}

.command-palette__item.is-active {
  background: var(--admin-bg-selected, #eef5ff);
  color: var(--admin-text-primary, #1a2a44);
}

.command-palette__item-icon {
  font-size: 15px;
  color: var(--admin-text-muted, #64748b);
  flex-shrink: 0;
}

.command-palette__item.is-active .command-palette__item-icon {
  color: var(--admin-text-brand, #3478f6);
}

.command-palette__item-label {
  font-size: 14px;
  font-weight: 600;
}

.command-palette__item-path {
  margin-left: auto;
  font-size: 11px;
  color: var(--admin-text-muted, #64748b);
  font-family: var(--admin-font-mono, monospace);
}

.command-palette__empty {
  padding: 32px 16px;
  text-align: center;
  color: var(--admin-text-muted, #64748b);
  font-size: 13px;
}

.command-palette__footer {
  display: flex;
  gap: 16px;
  padding: 10px 16px;
  border-top: var(--admin-border-subtle, 1px solid rgba(209, 218, 235, 0.7));
  color: var(--admin-text-muted, #64748b);
  font-size: 11px;
}

.command-palette__footer span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
</style>
