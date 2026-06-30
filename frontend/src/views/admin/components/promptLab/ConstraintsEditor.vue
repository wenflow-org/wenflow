<template>
  <div class="constraints-editor">
    <div class="constraints-list">
      <div v-for="(item, idx) in items" :key="idx" class="constraint-row">
        <el-icon class="constraint-dot"><CircleCheck /></el-icon>
        <el-input
          v-model="item.text"
          size="small"
          class="constraint-input"
          @change="emitUpdate"
          placeholder="输入约束内容..."
        />
        <el-button text type="danger" size="small" @click="removeItem(idx)" class="constraint-del">
          <el-icon><Delete /></el-icon>
        </el-button>
      </div>
    </div>
    <el-button size="small" text type="primary" @click="addItem" class="add-btn">
      + 添加约束
    </el-button>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Delete, CircleCheck } from '@element-plus/icons-vue'

const props = defineProps<{
  content: string
  modelValue: string
  sectionId: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

interface ConstraintItem {
  text: string
}

const items = ref<ConstraintItem[]>([])

function parse() {
  const text = props.modelValue || props.content
  const lines = text.split('\n')
  const result: ConstraintItem[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    // 跳过 sub-header lines
    if (trimmed.startsWith('##') || trimmed.startsWith('#') || trimmed.startsWith('---')) continue
    // 去掉前面可能的编号或列表符号
    const cleaned = trimmed.replace(/^[-*]\s*/, '').replace(/^\d+\.\s*/, '')
    if (cleaned) {
      result.push({ text: cleaned })
    }
  }

  if (result.length > 0) items.value = result
}

function serialize(): string {
  return items.value.map(i => `- ${i.text}`).join('\n')
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
  emitUpdate()
}

watch(() => props.modelValue, parse, { immediate: true })
watch(() => props.content, parse)
</script>

<style scoped>
.constraints-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.constraints-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.constraint-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--admin-bg-page);
  border-radius: 6px;
  border: 1px solid transparent;
}

.constraint-row:hover {
  border-color: var(--admin-border-color, #e5e7eb);
}

.constraint-dot {
  color: var(--admin-color-brand, #3b82f6);
  font-size: 14px;
  flex-shrink: 0;
}

.constraint-input {
  flex: 1;
}

.constraint-input :deep(.el-input__inner) {
  font-size: 13px;
  line-height: 1.5;
}

.constraint-del {
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s;
}

.constraint-row:hover .constraint-del {
  opacity: 1;
}

.add-btn {
  align-self: flex-start;
}
</style>
