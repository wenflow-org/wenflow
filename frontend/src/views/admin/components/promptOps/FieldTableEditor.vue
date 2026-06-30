<!--
  FieldTableEditor
  ============================================================
  可视化字段表编辑器 — input/output 字段的增删改名改类型改描述.

  数据流:
    GET  /admin/prompt-ops/:agentId/fields  → 字段表
    PUT  /admin/prompt-ops/:agentId/fields  → 写回源 + 自动编译 + 失效缓存

  设计原则:
    - 字段表只是 prompt 源里 ```json``` 块的 GUI 视图, 不引入第三方真相源
    - 保存即热更换: PUT 调用后下一次 LLM 调用立即拿新产物

  支持字段类型: string | number | boolean | enum | array | object
  支持嵌套路径: understanding.surface_goal / items[].name
-->
<template>
  <div class="field-editor" v-loading="loading">
    <!-- 顶部切换 input / output -->
    <div class="field-editor__tabs">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="field-tab"
        :class="{ 'field-tab--active': activeTab === t.key }"
        @click="activeTab = t.key"
      >
        <span class="field-tab__icon">{{ t.icon }}</span>
        <span class="field-tab__label">{{ t.label }}</span>
        <span class="field-tab__count">{{ currentFields[t.key].length }}</span>
      </button>
    </div>

    <div class="field-editor__bar">
      <span class="field-editor__hint">
        表里改完点「保存并编译」, 编译器会用字段表覆写源 .md 里的 ```json``` 块, 立即生效
      </span>
      <el-button
        type="primary"
        size="small"
        :loading="saving"
        :disabled="!dirty"
        @click="saveFields"
      >
        <el-icon><DocumentChecked /></el-icon>
        保存并编译 (热更换)
      </el-button>
      <el-button size="small" :disabled="!dirty" @click="discardChanges">
        <el-icon><Refresh /></el-icon>
        撤销改动
      </el-button>
    </div>

    <!-- 字段表 -->
    <div class="field-editor__table-wrap">
      <el-table
        :data="currentFields[activeTab]"
        size="small"
        border
        empty-text="点 + 添加字段"
        class="field-editor__table"
      >
        <el-table-column label="字段路径" min-width="240">
          <template #default="{ row, $index }">
            <el-input
              v-model="row.path"
              size="small"
              placeholder="例: understanding.surface_goal"
              @change="markDirty($index)"
            >
              <template #prefix>
                <code class="field-prefix">·</code>
              </template>
            </el-input>
          </template>
        </el-table-column>

        <el-table-column label="类型" width="130">
          <template #default="{ row }">
            <el-select v-model="row.valueType" size="small" @change="markDirty()">
              <el-option label="string" value="string" />
              <el-option label="number" value="number" />
              <el-option label="boolean" value="boolean" />
              <el-option label="enum" value="enum" />
              <el-option label="array" value="array" />
              <el-option label="object" value="object" />
            </el-select>
          </template>
        </el-table-column>

        <el-table-column label="枚举值 (enum 专用)" min-width="200">
          <template #default="{ row }">
            <el-input
              v-if="row.valueType === 'enum'"
              :model-value="(row.enumValues || []).join('|')"
              size="small"
              placeholder="a|b|c"
              @update:model-value="updateEnumValues(row, $event)"
            />
            <span v-else class="field-editor__dim">—</span>
          </template>
        </el-table-column>

        <el-table-column label="字段说明 (note)" min-width="260">
          <template #default="{ row }">
            <el-input
              v-model="row.note"
              size="small"
              placeholder="说明字段的语义, LLM 会看到这段"
              @change="markDirty()"
            />
          </template>
        </el-table-column>

        <el-table-column label="操作" width="80" fixed="right">
          <template #default="{ $index }">
            <el-button type="danger" link size="small" @click="removeField($index)">
              <el-icon><Delete /></el-icon>
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="field-editor__add">
        <el-button @click="addField" size="small">
          <el-icon><Plus /></el-icon>
          添加字段
        </el-button>
        <span v-if="dirty" class="field-editor__dirty-flag">
          有 {{ dirtyCount }} 项未保存
        </span>
      </div>
    </div>

    <!-- 实时 JSON 预览 -->
    <details class="field-editor__preview">
      <summary>预览生成的 <code>```json```</code> 块 (会写回源 .md)</summary>
      <pre class="field-editor__preview-text">{{ previewJson }}</pre>
    </details>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { DocumentChecked, Refresh, Delete, Plus } from '@element-plus/icons-vue'
import { adminPromptOpsApi } from '@/api/adminApi'

type FieldType = 'string' | 'number' | 'boolean' | 'enum' | 'array' | 'object'

interface EditableField {
  path: string
  valueType: FieldType
  enumValues?: string[] | null
  note: string
  required?: boolean
}

const props = defineProps<{
  agentId: string | null
}>()

const emit = defineEmits<{
  (e: 'saved'): void
}>()

const tabs = [
  { key: 'inputFields' as const, label: '输入字段 (input)', icon: 'input' },
  { key: 'outputFields' as const, label: '输出字段 (output)', icon: '📤' },
]

const activeTab = ref<'inputFields' | 'outputFields'>('outputFields')
const loading = ref(false)
const saving = ref(false)
const currentFields = ref<{ inputFields: EditableField[]; outputFields: EditableField[] }>({
  inputFields: [],
  outputFields: [],
})
const lastSavedFields = ref<{ inputFields: string; outputFields: string }>({
  inputFields: '[]',
  outputFields: '[]',
})

const dirty = computed(() => {
  const cur = JSON.stringify(currentFields.value.inputFields) + '|' + JSON.stringify(currentFields.value.outputFields)
  const last = lastSavedFields.value.inputFields + '|' + lastSavedFields.value.outputFields
  return cur !== last
})

const dirtyCount = computed(() => {
  if (!dirty.value) return 0
  // 简单计 — 总字段数差
  return Math.abs(
    currentFields.value.inputFields.length + currentFields.value.outputFields.length -
      (JSON.parse(lastSavedFields.value.inputFields).length + JSON.parse(lastSavedFields.value.outputFields).length)
  ) || 1
})

const previewJson = computed(() => {
  const fields = currentFields.value[activeTab.value]
  const obj = buildPreviewObject(fields)
  return JSON.stringify(obj, null, 2)
})

function buildPreviewObject(fields: EditableField[]): any {
  const root: any = {}
  for (const f of fields) {
    setPath(root, f.path, placeholderFor(f))
  }
  return root
}

function placeholderFor(f: EditableField): any {
  if (f.valueType === 'enum' && f.enumValues && f.enumValues.length > 0) {
    return f.enumValues.join('|')
  }
  if (f.valueType === 'boolean') return false
  if (f.valueType === 'number') return 0
  const noteStr = f.note ? ` — ${f.note}` : ''
  return `${f.valueType}${noteStr}`
}

function setPath(root: any, path: string, value: any): void {
  if (!path) return
  const segs = path.split('.')
  let cur = root
  for (let i = 0; i < segs.length; i++) {
    let seg = segs[i]
    const isArr = seg.endsWith('[]')
    if (isArr) seg = seg.slice(0, -2)
    const last = i === segs.length - 1
    if (last) {
      if (isArr) {
        if (!Array.isArray(cur[seg])) cur[seg] = []
        if (cur[seg].length === 0) cur[seg].push(value)
        else cur[seg][0] = value
      } else {
        cur[seg] = value
      }
    } else {
      if (isArr) {
        if (!Array.isArray(cur[seg])) cur[seg] = [{}]
        if (cur[seg].length === 0) cur[seg].push({})
        cur = cur[seg][0]
      } else {
        if (typeof cur[seg] !== 'object' || cur[seg] === null || Array.isArray(cur[seg])) {
          cur[seg] = {}
        }
        cur = cur[seg]
      }
    }
  }
}

const loadFields = async () => {
  if (!props.agentId) return
  loading.value = true
  try {
    const res: any = await adminPromptOpsApi.getPromptFields(props.agentId)
    const data = res.data?.data || res.data
    currentFields.value.inputFields = (data.inputFields || []).map(normalizeField)
    currentFields.value.outputFields = (data.outputFields || []).map(normalizeField)
    lastSavedFields.value.inputFields = JSON.stringify(currentFields.value.inputFields)
    lastSavedFields.value.outputFields = JSON.stringify(currentFields.value.outputFields)
  } catch (error: any) {
    const msg = error?.response?.data?.error || error?.message || '加载字段表失败'
    ElMessage.error(msg)
  } finally {
    loading.value = false
  }
}

function normalizeField(f: any): EditableField {
  return {
    path: f.path || '',
    valueType: f.valueType || 'string',
    enumValues: f.enumValues || null,
    note: f.note || '',
    required: !!f.required,
  }
}

const addField = () => {
  currentFields.value[activeTab.value].push({
    path: '',
    valueType: 'string',
    enumValues: null,
    note: '',
  })
}

const removeField = (index: number) => {
  currentFields.value[activeTab.value].splice(index, 1)
}

const updateEnumValues = (row: EditableField, text: string) => {
  row.enumValues = text
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)
}

// no-op, watch 处理 dirty 状态
const markDirty = (_idx?: number) => {}

const saveFields = async () => {
  if (!props.agentId) return
  // 校验: path 不能空
  const all = [...currentFields.value.inputFields, ...currentFields.value.outputFields]
  for (const f of all) {
    if (!f.path.trim()) {
      ElMessage.error('字段路径不能为空, 请填写或删除该行')
      return
    }
  }
  saving.value = true
  try {
    const res: any = await adminPromptOpsApi.updatePromptFields(props.agentId, {
      inputFields: currentFields.value.inputFields,
      outputFields: currentFields.value.outputFields,
      autoCompile: true,
    })
    const data = res.data?.data || res.data
    if (data?.compileStatus === 'fresh') {
      ElMessage.success(`字段表已保存 · 编译成功 · 已热更换`)
    } else if (data?.compileStatus === 'failed') {
      ElMessage.warning(`保存成功但编译失败: ${data?.error || '未知错误'}`)
    } else if (data?.changed === false) {
      ElMessage.info('字段表未变化, 源未更新')
    } else {
      ElMessage.success('字段表已保存')
    }
    lastSavedFields.value.inputFields = JSON.stringify(currentFields.value.inputFields)
    lastSavedFields.value.outputFields = JSON.stringify(currentFields.value.outputFields)
    emit('saved')
  } catch (error: any) {
    const msg = error?.response?.data?.error || error?.message || '保存失败'
    ElMessage.error(msg)
  } finally {
    saving.value = false
  }
}

const discardChanges = async () => {
  if (!dirty.value) return
  try {
    await ElMessageBox.confirm('丢弃当前未保存的修改, 重新从源加载?', '确认放弃', {
      confirmButtonText: '放弃',
      cancelButtonText: '取消',
      type: 'warning',
    })
    await loadFields()
    ElMessage.info('已恢复')
  } catch {
    // user cancelled
  }
}

watch(() => props.agentId, () => loadFields())
onMounted(loadFields)

defineExpose({ reload: loadFields })
</script>

<style scoped>
.field-editor {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.field-editor__tabs {
  display: flex;
  gap: 8px;
  padding: 4px;
  background: #f8fafc;
  border-radius: 8px;
  width: fit-content;
}

.field-tab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12.5px;
  font-weight: 600;
  color: #475569;
  transition: all 0.15s ease;
}

.field-tab:hover {
  color: #1e293b;
  background: var(--admin-bg-surface);
}

.field-tab--active {
  background: var(--admin-bg-surface);
  color: #4f46e5;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.field-tab__count {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 8px;
  background: #e2e8f0;
  color: #475569;
  font-weight: 700;
}

.field-tab--active .field-tab__count {
  background: #eef2ff;
  color: #4f46e5;
}

.field-editor__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  background: #f0f9ff;
  border: 1px solid #bae6fd;
  border-radius: 8px;
}

.field-editor__hint {
  font-size: 12px;
  color: #075985;
  flex: 1;
}

.field-editor__table-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field-editor__table :deep(.el-table__cell) {
  padding: 6px 8px;
}

.field-prefix {
  font-size: 12px;
}

.field-editor__dim {
  color: #cbd5e1;
  font-size: 11px;
}

.field-editor__add {
  display: flex;
  align-items: center;
  gap: 12px;
}

.field-editor__dirty-flag {
  font-size: 12px;
  color: #d97706;
  font-weight: 600;
}

.field-editor__preview {
  margin-top: 4px;
  border: 1px dashed #cbd5e1;
  border-radius: 8px;
  padding: 8px 12px;
  background: #f8fafc;
}

.field-editor__preview summary {
  font-size: 12px;
  color: #475569;
  cursor: pointer;
  user-select: none;
}

.field-editor__preview summary code {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11px;
  padding: 1px 6px;
  background: #e2e8f0;
  border-radius: 4px;
}

.field-editor__preview-text {
  margin: 8px 0 0;
  padding: 12px 14px;
  background: var(--admin-bg-surface);
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11.5px;
  line-height: 1.5;
  color: #1f2937;
  max-height: 320px;
  overflow-y: auto;
}
</style>