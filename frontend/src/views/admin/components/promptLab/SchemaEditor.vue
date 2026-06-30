<template>
  <div class="schema-editor">
    <!-- Field tree -->
    <div class="field-tree">
      <div
        v-for="(field, idx) in fields"
        :key="field._key"
        class="field-node"
        :class="{
          'field-node--child': field._depth > 0,
          'field-node--parent': isParentType(field.type) && hasChildren(idx)
        }"
      >
        <div class="field-row">
          <!-- Expand toggle for parent types -->
          <el-icon
            v-if="isParentType(field.type) && hasChildren(idx)"
            class="field-expand"
            :class="{ 'field-expand--open': expandedFields.has(idx) }"
            @click.stop="toggleExpand(idx)"
          >
            <ArrowRight />
          </el-icon>
          <span v-else class="field-expand-spacer" />

          <!-- Icon -->
          <el-icon class="field-icon" v-if="isParentType(field.type)">
            <Folder />
          </el-icon>
          <el-icon class="field-icon field-icon--leaf" v-else>
            <Document />
          </el-icon>

          <span class="field-name">{{ field.name }}</span>
          <span class="field-type">{{ field.type }}</span>
          <span v-if="field._required" class="field-required">必填</span>
          <span v-if="isParentType(field.type) && hasChildren(idx)" class="field-child-count">
            {{ countChildren(idx) }} 子
          </span>
          <span class="field-desc" v-if="field.description">{{ field.description }}</span>

          <div class="field-actions">
            <el-button text size="small" @click.stop="editField(idx)"><el-icon><Edit /></el-icon></el-button>
            <el-button text type="danger" size="small" @click.stop="removeField(idx)"><el-icon><Delete /></el-icon></el-button>
            <el-button
              v-if="isParentType(field.type)"
              text
              size="small"
              @click.stop="addChildField(idx)"
              title="添加子字段"
            >
              <el-icon><CirclePlus /></el-icon>
            </el-button>
          </div>
        </div>

        <!-- Examples -->
        <div v-if="field.goodExample || field.badExample" class="field-examples">
          <span v-if="field.goodExample" class="field-example field-example--good">正例：{{ field.goodExample }}</span>
          <span v-if="field.badExample" class="field-example field-example--bad">反例：{{ field.badExample }}</span>
        </div>

        <!-- Nested children (for object/array types) -->
        <div v-if="isParentType(field.type) && hasChildren(idx) && expandedFields.has(idx)" class="field-children">
          <div
            v-for="ci in childIndices(idx)"
            :key="fields[ci]._key"
            class="field-node field-node--nested"
          >
            <div class="field-row">
              <span class="field-expand-spacer" />
              <el-icon class="field-icon field-icon--leaf"><Document /></el-icon>
              <span class="field-name">{{ fields[ci].name }}</span>
              <span class="field-type">{{ fields[ci].type }}</span>
              <span v-if="fields[ci]._required" class="field-required">必填</span>
              <span class="field-desc" v-if="fields[ci].description">{{ fields[ci].description }}</span>
              <div class="field-actions">
                <el-button text size="small" @click.stop="editField(ci)"><el-icon><Edit /></el-icon></el-button>
                <el-button text type="danger" size="small" @click.stop="removeField(ci)"><el-icon><Delete /></el-icon></el-button>
              </div>
            </div>
            <div v-if="fields[ci].goodExample || fields[ci].badExample" class="field-examples">
              <span v-if="fields[ci].goodExample" class="field-example field-example--good">正例：{{ fields[ci].goodExample }}</span>
              <span v-if="fields[ci].badExample" class="field-example field-example--bad">反例：{{ fields[ci].badExample }}</span>
            </div>
          </div>
        </div>
      </div>

      <div v-if="fields.length === 0" class="field-empty">
        暂无字段定义
      </div>
    </div>

    <el-button size="small" text type="primary" @click="addField(-1)" class="add-btn">
      + 添加顶层字段
    </el-button>

    <!-- Field edit dialog -->
    <el-dialog
      v-model="dialogVisible"
      :title="dialogMode === 'add' ? '添加字段' : '编辑字段'"
      width="460px"
      destroy-on-close
    >
      <el-form :model="editForm" label-position="top" size="default">
        <el-form-item label="字段名">
          <el-input v-model="editForm.name" placeholder="reply / surface_goal ..." />
        </el-form-item>

        <el-form-item label="类型">
          <el-select v-model="editForm.type" @change="onTypeChange">
            <el-option v-for="t in FIELD_TYPES" :key="t" :label="t" :value="t" />
          </el-select>
        </el-form-item>

        <el-form-item label="说明">
          <el-input v-model="editForm.description" type="textarea" :rows="2" placeholder="字段的功能说明" />
        </el-form-item>

        <el-form-item label="正例（可选）">
          <el-input v-model="editForm.goodExample" placeholder="好的范例" />
        </el-form-item>

        <el-form-item label="反例（可选）">
          <el-input v-model="editForm.badExample" placeholder="不好的范例" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveField">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Folder, Document, Edit, Delete, CirclePlus, ArrowRight } from '@element-plus/icons-vue'

const props = defineProps<{
  content: string
  modelValue: string
  sectionId: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const FIELD_TYPES = ['string', 'object', 'array', 'number', 'boolean', 'enum']

interface Field {
  _key: string
  name: string
  type: string
  description: string
  goodExample: string
  badExample: string
  _depth: number
  _required: boolean
}

const fields = ref<Field[]>([])
const expandedFields = ref(new Set<number>())
const dialogVisible = ref(false)
const dialogMode = ref<'add' | 'edit'>('add')
const editingIdx = ref(-1)

let _nextKey = 0
function nextKey() { return `f${_nextKey++}` }
function emptyField(): Field {
  return { _key: nextKey(), name: '', type: 'string', description: '', goodExample: '', badExample: '', _depth: 0, _required: false }
}

const editForm = ref<Field>(emptyField())

function isParentType(type: string) {
  return type === 'object' || type === 'array'
}

function hasChildren(idx: number): boolean {
  return childIndices(idx).length > 0
}

function countChildren(idx: number): number {
  return childIndices(idx).length
}

// 找到 idx 之后的所有 depth+1 的孩子
function childIndices(idx: number): number[] {
  const parentDepth = fields.value[idx]._depth
  const result: number[] = []
  for (let i = idx + 1; i < fields.value.length; i++) {
    if (fields.value[i]._depth <= parentDepth) break
    if (fields.value[i]._depth === parentDepth + 1) result.push(i)
  }
  return result
}

function toggleExpand(idx: number) {
  if (expandedFields.value.has(idx)) expandedFields.value.delete(idx)
  else expandedFields.value.add(idx)
}

function parse() {
  const text = props.modelValue || props.content
  const lines = text.split('\n')
  const result: Field[] = []
  let currentField: Partial<Field> | null = null
  let detailLines: string[] = []

  function flushField() {
    if (currentField && currentField.name) {
      let desc = currentField.description || ''
      let goodEx = ''
      let badEx = ''
      for (const line of detailLines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        if (trimmed.startsWith('正例：') || trimmed.startsWith('正例:')) {
          goodEx = trimmed.replace(/^正例[：:]\s*/, '')
        } else if (trimmed.startsWith('反例：') || trimmed.startsWith('反例:')) {
          badEx = trimmed.replace(/^反例[：:]\s*/, '')
        } else if (!trimmed.startsWith('#') && !trimmed.startsWith('**')) {
          if (!desc) desc = trimmed
        }
      }
      result.push({
        _key: currentField._key || nextKey(),
        name: currentField.name || '',
        type: currentField.type || 'string',
        description: desc,
        goodExample: goodEx,
        badExample: badEx,
        _depth: currentField._depth || 0,
        _required: !!currentField._required
      })
    }
    currentField = null
    detailLines = []
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const h3Match = trimmed.match(/^###\s+(.+)/)
    if (h3Match) {
      flushField()
      const raw = h3Match[1].trim()
      const { name, type } = parseFieldRaw(raw)
      currentField = { _key: nextKey(), name, type, description: '', _depth: 0, _required: false }
      continue
    }

    const boldMatch = trimmed.match(/^[-*]\s*\*\*(.+?)\*\*(?:\s*·?\s*(\w+))?(?:\s*[-—–]\s*(.+))?$/)
    if (boldMatch) {
      const name = boldMatch[1].trim()
      const type = boldMatch[2] || 'string'
      const rest = boldMatch[3] || ''
      if (FIELD_TYPES.includes(type) || type === 'string') {
        flushField()
        currentField = {
          _key: nextKey(),
          name,
          type: FIELD_TYPES.includes(type) ? type : 'string',
          description: rest,
          _depth: trimmed.startsWith('  -') || trimmed.startsWith('  *') ? 2 : 1,
          _required: rest.includes('必填')
        }
        continue
      }
    }

    // Inline bold: **name** · type — desc
    const inlineBold = trimmed.match(/^\*\*(.+?)\*\*(?:\s*·\s*(\w+))?(?:\s*[-—–]\s*(.+))?$/)
    if (inlineBold) {
      const name = inlineBold[1].trim()
      const type = inlineBold[2] || ''
      if (!type || FIELD_TYPES.includes(type)) {
        flushField()
        currentField = {
          _key: nextKey(),
          name,
          type: FIELD_TYPES.includes(type) ? type : 'string',
          description: inlineBold[3] || '',
          _depth: 1,
          _required: false
        }
        continue
      }
    }

    if (currentField) detailLines.push(line)
  }
  flushField()

  if (result.length > 0) {
    fields.value = result
    // auto-expand parent fields
    const newExpanded = new Set<number>()
    for (let i = 0; i < result.length; i++) {
      if (isParentType(result[i].type) && hasChildren(i)) {
        newExpanded.add(i)
      }
    }
    expandedFields.value = newExpanded
  }
  _nextKey = 0
}

function parseFieldRaw(raw: string): { name: string; type: string } {
  const parts = raw.split('·').map(p => p.trim())
  const name = parts[0] || ''
  let type = 'string'
  if (parts.length >= 2 && FIELD_TYPES.includes(parts[1])) type = parts[1]
  return { name, type }
}

function serialize(): string {
  if (fields.value.length === 0) return ''
  const parts: string[] = []
  for (const f of fields.value) {
    if (f._depth === 0) {
      parts.push(`### ${f.name} · ${f.type}`)
    } else {
      const indent = f._depth === 2 ? '  - ' : '- '
      parts.push(`${indent}**${f.name}** · ${f.type} — ${f.description || ''}`)
    }
    if (f.description && f._depth === 0) parts.push(f.description)
    if (f.goodExample) parts.push(`正例：${f.goodExample}`)
    if (f.badExample) parts.push(`反例：${f.badExample}`)
    parts.push('')
  }
  return parts.join('\n').trim()
}

function emitUpdate() {
  emit('update:modelValue', serialize())
}

function addField(parentIdx: number) {
  dialogMode.value = 'add'
  editingIdx.value = parentIdx
  editForm.value = {
    ...emptyField(),
    _depth: parentIdx >= 0 ? (fields.value[parentIdx]._depth + 1) : 0
  }
  dialogVisible.value = true
}

function addChildField(parentIdx: number) {
  addField(parentIdx)
}

function editField(idx: number) {
  dialogMode.value = 'edit'
  editingIdx.value = idx
  editForm.value = { ...fields.value[idx] }
  dialogVisible.value = true
}

function saveField() {
  if (!editForm.value.name.trim()) return
  if (dialogMode.value === 'add') {
    fields.value.push({ ...editForm.value, _key: nextKey() })
  } else {
    fields.value[editingIdx.value] = { ...editForm.value, _key: fields.value[editingIdx.value]._key || nextKey() }
  }
  dialogVisible.value = false
  emitUpdate()
}

function removeField(idx: number) {
  // 如果是父类型，一并删除子字段
  if (isParentType(fields.value[idx].type)) {
    const children = childIndices(idx)
    for (let i = children.length - 1; i >= 0; i--) {
      fields.value.splice(children[i], 1)
    }
  }
  fields.value.splice(idx, 1)
  emitUpdate()
}

function onTypeChange() {
  // no-op, just for reactivity
}

watch(() => props.modelValue, parse, { immediate: true })
watch(() => props.content, parse)
</script>

<style scoped>
.schema-editor { display: flex; flex-direction: column; gap: 8px; }

.field-tree { display: flex; flex-direction: column; gap: 3px; }

.field-empty {
  padding: 20px;
  text-align: center;
  color: var(--admin-text-muted, #9ca3af);
  font-size: 13px;
}

.field-node {
  border-radius: 6px;
  border: 1px solid transparent;
  background: var(--admin-bg-page);
}

.field-node:hover { border-color: var(--admin-border-color, #e5e7eb); }

.field-node--parent { background: var(--admin-bg-surface); }

.field-node--child { margin-left: 16px; }

.field-node--nested {
  margin-left: 20px;
  background: transparent;
}

.field-expand {
  font-size: 11px;
  color: var(--admin-text-muted, #9ca3af);
  cursor: pointer;
  flex-shrink: 0;
  transition: transform 0.15s;
}

.field-expand--open { transform: rotate(90deg); }

.field-expand-spacer { width: 12px; flex-shrink: 0; }

.field-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
}

.field-icon {
  font-size: 13px;
  color: var(--admin-color-brand, #3b82f6);
  flex-shrink: 0;
}

.field-icon--leaf { color: var(--admin-text-muted, #9ca3af); font-size: 12px; }

.field-name {
  font-size: 13px;
  font-weight: 700;
  color: var(--admin-color-brand, #3b82f6);
  font-family: 'JetBrains Mono', Consolas, monospace;
  flex-shrink: 0;
}

.field-type {
  font-size: 10px;
  color: var(--admin-text-muted, #9ca3af);
  background: var(--admin-bg-hover, #f3f4f6);
  padding: 0 5px;
  border-radius: 3px;
  font-family: 'JetBrains Mono', Consolas, monospace;
  flex-shrink: 0;
}

.field-required {
  font-size: 9px;
  font-weight: 700;
  color: #d97706;
  background: #fef3c7;
  padding: 0 4px;
  border-radius: 3px;
  flex-shrink: 0;
}

.field-child-count {
  font-size: 10px;
  color: var(--admin-text-muted, #9ca3af);
  flex-shrink: 0;
}

.field-desc {
  flex: 1;
  font-size: 12px;
  color: var(--admin-text-secondary, #6b7280);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.field-actions {
  display: flex;
  gap: 1px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s;
}

.field-row:hover .field-actions { opacity: 1; }

.field-examples {
  display: flex;
  gap: 8px;
  padding: 2px 8px 6px 32px;
  flex-wrap: wrap;
}

.field-example {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 3px;
  line-height: 1.6;
}

.field-example--good { color: #065f46; background: #d1fae5; }
.field-example--bad { color: #991b1b; background: #fee2e2; }

.field-children {
  padding: 2px 0 4px 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.add-btn { align-self: flex-start; }
</style>
