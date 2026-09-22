<template>
  <span class="sv-bar">
    <template v-if="!naming">
      <button
        v-for="v in views"
        :key="v.id"
        type="button"
        class="sv-pill"
        :class="{ 'sv-pill--active': v.name === activeName }"
        :title="viewTitle(v)"
        @click="$emit('apply', v)"
      >
        <span class="sv-pill__name">{{ v.name }}</span>
        <span class="sv-pill__del" title="删除此视图" @click.stop="$emit('remove', v.id)">×</span>
      </button>
      <button v-if="canSave" type="button" class="mk-link" @click="startNaming">保存视图</button>
    </template>
    <input
      v-else
      ref="nameInput"
      v-model="draftName"
      class="sv-name"
      :placeholder="suggestName || '视图名称'"
      maxlength="24"
      title="回车保存 · Esc 取消"
      @keydown.enter.prevent="confirmSave"
      @keydown.esc.prevent="cancelSave"
      @blur="cancelSave"
    />
  </span>
</template>

<script setup lang="ts">
/* 保存视图条：saved view pills（点击应用 / × 删除）+ 行内命名输入。
   快照与恢复逻辑在宿主页面（useSavedViews 只管存取），本组件纯展示/交互。 */
import { nextTick, ref } from 'vue'
import type { SavedView } from './useSavedViews'

const props = defineProps<{
  views: SavedView[]
  /** 当前筛选恰好命中的视图名（高亮；空串 = 默认视图不高亮） */
  activeName: string
  /** 是否允许保存（= 页面处于筛选态；默认态没有可保存的内容） */
  canSave: boolean
  /** 命名输入的预填/占位建议（= 页面的筛选摘要文本） */
  suggestName?: string
  /** pill 悬停说明（展示快照内容） */
  titleOf?: (v: SavedView) => string
}>()

const emit = defineEmits<{
  (e: 'apply', view: SavedView): void
  (e: 'remove', id: string): void
  (e: 'save', name: string): void
}>()

const naming = ref(false)
const draftName = ref('')
const nameInput = ref<HTMLInputElement | null>(null)

async function startNaming() {
  draftName.value = props.suggestName || ''
  naming.value = true
  await nextTick()
  nameInput.value?.focus()
  nameInput.value?.select()
}
function confirmSave() {
  const name = draftName.value.trim() || props.suggestName?.trim() || ''
  naming.value = false
  draftName.value = ''
  if (name) emit('save', name)
}
function cancelSave() {
  naming.value = false
  draftName.value = ''
}
function viewTitle(v: SavedView): string {
  return props.titleOf ? props.titleOf(v) : v.name
}
</script>

<style scoped>
.sv-bar { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.sv-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 200px;
}
.sv-pill__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sv-pill__del {
  cursor: pointer;
  color: var(--mk-faint);
  font-weight: 700;
  line-height: 1;
  padding: 0 2px;
  border-radius: 4px;
}
.sv-pill__del:hover { color: var(--mk-red); background: var(--mk-red-bg); }
.sv-name { width: 190px; }
</style>
