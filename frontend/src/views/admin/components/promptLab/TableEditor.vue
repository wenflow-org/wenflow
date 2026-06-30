<template>
  <div class="table-editor">
    <el-table :data="rows" border size="small" class="editable-table">
      <!-- field -->
      <el-table-column prop="field" label="field" min-width="120">
        <template #default="{ row }">
          <el-input v-model="row.field" size="small" class="field-input" @change="emitUpdate" />
        </template>
      </el-table-column>

      <!-- type (下拉) -->
      <el-table-column prop="type" label="type" width="110">
        <template #default="{ row }">
          <el-select v-model="row.type" size="small" @change="emitUpdate">
            <el-option v-for="t in TYPE_OPTIONS" :key="t" :label="t" :value="t" />
          </el-select>
        </template>
      </el-table-column>

      <!-- required (开关) -->
      <el-table-column prop="required" label="required" width="90" align="center">
        <template #default="{ row }">
          <el-switch
            v-model="row._required"
            size="small"
            active-text="Y"
            inactive-text="N"
            @change="onRequiredChange(row)"
          />
        </template>
      </el-table-column>

      <!-- description -->
      <el-table-column prop="description" label="description" min-width="180">
        <template #default="{ row }">
          <el-input v-model="row.description" size="small" @change="emitUpdate" />
        </template>
      </el-table-column>

      <!-- 操作 -->
      <el-table-column label="" width="50" fixed="right">
        <template #default="{ $index }">
          <el-button text type="danger" size="small" @click="removeRow($index)" :disabled="rows.length <= 1">
            <el-icon><Delete /></el-icon>
          </el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-button size="small" text type="primary" @click="addRow" class="add-btn">
      + 添加变量
    </el-button>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Delete } from '@element-plus/icons-vue'

const props = defineProps<{
  content: string
  modelValue: string
  sectionId: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const TYPE_OPTIONS = ['string', 'object', 'array', 'number', 'boolean']

interface Row {
  field: string
  type: string
  _required: boolean
  description: string
}

const rows = ref<Row[]>([])

function parse() {
  const text = props.modelValue || props.content
  const lines = text.split('\n')
  let inHeader = false
  let headerParsed = false
  const result: Row[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('|---')) {
      inHeader = false
      continue
    }
    if (trimmed.startsWith('|') && !inHeader && !headerParsed) {
      inHeader = true
      headerParsed = true
      continue
    }
    if (trimmed.startsWith('|') && inHeader) {
      inHeader = false
      continue
    }
    if (trimmed.startsWith('|')) {
      const vals = trimmed.split('|').filter(c => c.trim()).map(c => c.trim())
      if (vals.length >= 2) {
        const field = vals[0] || ''
        const type = vals[1] || 'string'
        const reqVal = vals[2] || 'no'
        const desc = vals.slice(3).join(' ') || ''
        result.push({
          field,
          type: TYPE_OPTIONS.includes(type) ? type : 'string',
          _required: reqVal === 'yes' || reqVal === '✅' || reqVal === 'Y',
          description: desc
        })
      }
    }
  }

  if (result.length > 0) rows.value = result
}

function serialize(): string {
  if (rows.value.length === 0) return ''
  const parts: string[] = []
  parts.push('| field | type | required | description |')
  parts.push('|-------|------|----------|-------------|')
  for (const row of rows.value) {
    parts.push(`| ${row.field} | ${row.type} | ${row._required ? 'yes' : 'no'} | ${row.description} |`)
  }
  return parts.join('\n')
}

function emitUpdate() {
  emit('update:modelValue', serialize())
}

function onRequiredChange(row: Row) {
  row._required = !!row._required
  emitUpdate()
}

function addRow() {
  rows.value.push({ field: '', type: 'string', _required: false, description: '' })
  emitUpdate()
}

function removeRow(index: number) {
  rows.value.splice(index, 1)
  emitUpdate()
}

watch(() => props.modelValue, parse, { immediate: true })
watch(() => props.content, parse)
</script>

<style scoped>
.table-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.editable-table :deep(.el-input__inner) {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 12px;
  padding: 2px 8px;
  height: 28px;
}

.editable-table :deep(.el-select) {
  width: 100%;
}

.editable-table :deep(.el-select .el-input__inner) {
  text-align: left;
}

.field-input :deep(.el-input__inner) {
  font-weight: 600;
  color: var(--admin-color-brand, #3b82f6);
}

.add-btn {
  align-self: flex-start;
}
</style>
