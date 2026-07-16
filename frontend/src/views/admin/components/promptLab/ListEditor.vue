<template>
  <div class="list-editor">
    <div class="list-editor__items">
      <div v-for="(item, idx) in items" :key="idx" class="list-editor__row">
        <el-icon class="list-editor__icon"><CircleCheck /></el-icon>
        <el-input
          v-model="item.text"
          size="small"
          class="list-editor__input"
          @change="emitUpdate"
          :placeholder="placeholder"
        />
        <el-button class="admin-icon-button" text type="danger" size="small" aria-label="删除条目" @click="removeItem(idx)">
          <el-icon><Delete /></el-icon>
        </el-button>
      </div>
    </div>
    <el-button size="small" text type="primary" @click="addItem">+ 添加条目</el-button>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Delete, CircleCheck } from '@element-plus/icons-vue'

const props = defineProps<{
  content: string
  modelValue: string
  placeholder?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

interface ListItem {
  text: string
}

const items = ref<ListItem[]>([])

function parse() {
  const text = props.modelValue || props.content
  const lines = text.split('\n')
  const result: ListItem[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('##') || trimmed.startsWith('#') || trimmed.startsWith('---')) continue
    const cleaned = trimmed
      .replace(/^[-*]\s*/, '')
      .replace(/^\d+\.\s*/, '')
      .replace(/^QC-\d{2}:\s*/, '')
    if (cleaned) result.push({ text: cleaned })
  }

  items.value = result.length > 0 ? result : [{ text: '' }]
}

function serialize() {
  return items.value
    .map(item => item.text.trim())
    .filter(Boolean)
    .map(item => `- ${item}`)
    .join('\n')
}

function emitUpdate() {
  emit('update:modelValue', serialize())
}

function addItem() {
  items.value.push({ text: '' })
  emitUpdate()
}

function removeItem(index: number) {
  items.value.splice(index, 1)
  if (items.value.length === 0) items.value.push({ text: '' })
  emitUpdate()
}

watch(() => props.modelValue, parse, { immediate: true })
watch(() => props.content, parse)
</script>

<style scoped>
.list-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.list-editor__items {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.list-editor__row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--admin-bg-page);
  border-radius: 6px;
  border: 1px solid transparent;
}

.list-editor__row:hover {
  border-color: var(--admin-border-color, #e5e7eb);
}

.list-editor__icon {
  color: var(--admin-color-brand, #3b82f6);
  font-size: 14px;
  flex-shrink: 0;
}

.list-editor__input {
  flex: 1;
}
</style>
