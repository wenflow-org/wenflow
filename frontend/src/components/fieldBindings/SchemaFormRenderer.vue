<script setup lang="ts">
/**
 * SchemaFormRenderer (V3 §10 P1.8)
 * ============================================================
 * 按 FieldDefinition 协议自动渲染输入/展示组件。
 *
 * 渲染规则：
 *   - render: hidden                → 默认完全不渲染（除非 debug=true）
 *   - promptRole: hidden-inference  → 默认不渲染
 *   - promptRole: derived-presentation → 只读卡片
 *   - promptRole: control-signal    → 只读 chip
 *   - valueType: string             → <el-input>
 *   - valueType: string[]           → 标签输入器
 *   - valueType: enum               → <el-radio-group>
 *   - valueType: number             → <el-input-number>
 *   - valueType: boolean            → <el-switch>
 *   - valueType: object             → <el-input type=textarea>（JSON）
 *
 * 数据流：v-model on values（dot-path 字典） 或 nested object
 */
import { computed } from 'vue'
import type { FieldDefinition, FieldRouting, PromptRole } from '@/constants/fieldBindings/goal'

interface Props {
  /** 字段定义清单 */
  fields: FieldDefinition[]
  /** 路由表（决定 render: visible/hidden） */
  routings?: FieldRouting[]
  /** 当前 Agent 视角，用于查 routing */
  agentId?: string
  /** 字段值字典：fieldId → value（dot-path 风格） */
  values: Record<string, any>
  /** 是否处于 debug 模式（hidden 字段也展示） */
  debug?: boolean
  /** 是否只读 */
  readonly?: boolean
  /** 隐藏哪些 promptRole（默认 hidden-inference + control-signal 不渲染） */
  hideRoles?: PromptRole[]
}

const props = withDefaults(defineProps<Props>(), {
  routings: () => [],
  agentId: 'goal-conversation',
  debug: false,
  readonly: false,
  hideRoles: () => ['hidden-inference', 'control-signal'] as PromptRole[]
})

const emit = defineEmits<{
  (e: 'update:values', next: Record<string, any>): void
  (e: 'fieldChange', fieldId: string, next: any): void
}>()

const ROLE_LABELS: Record<string, string> = {
  'hard-required': '必填',
  'soft-info': '软信息',
  'hidden-inference': '隐藏',
  'public-reply': '回复',
  'proposal-output': '方案',
  'derived-presentation': '展示',
  'control-signal': '控制'
}

const ROLE_ORDER: PromptRole[] = [
  'hard-required',
  'public-reply',
  'soft-info',
  'proposal-output',
  'derived-presentation',
  'hidden-inference',
  'control-signal'
]

// 路由表索引
const routingIndex = computed(() => {
  const m = new Map<string, FieldRouting>()
  for (const r of props.routings) {
    if (r.agentId !== props.agentId) continue
    m.set(r.fieldId, r)
  }
  return m
})

const isFieldRendered = (f: FieldDefinition): boolean => {
  if (props.hideRoles?.includes(f.promptRole)) {
    return props.debug
  }
  const r = routingIndex.value.get(f.fieldId)
  if (r?.render === 'hidden') {
    return props.debug
  }
  return true
}

const orderedFields = computed(() => {
  return [...props.fields]
    .filter(isFieldRendered)
    .sort((a, b) => {
      const ai = ROLE_ORDER.indexOf(a.promptRole)
      const bi = ROLE_ORDER.indexOf(b.promptRole)
      if (ai !== bi) return ai - bi
      return a.fieldId.localeCompare(b.fieldId)
    })
})

const setValue = (fieldId: string, next: any) => {
  const updated = { ...props.values, [fieldId]: next }
  emit('update:values', updated)
  emit('fieldChange', fieldId, next)
}

const getValue = (f: FieldDefinition): any => {
  return props.values[f.fieldId]
}

const isReadOnlyField = (f: FieldDefinition): boolean => {
  if (props.readonly) return true
  if (f.systemLocked) return true
  // derived-presentation / control-signal 是系统派生，前端只读
  if (f.promptRole === 'derived-presentation' || f.promptRole === 'control-signal') return true
  return false
}

const formatStringArrayDisplay = (v: any): string => {
  if (Array.isArray(v)) return v.join('、')
  return String(v ?? '')
}

const handleStringArrayInput = (fieldId: string, raw: string) => {
  const arr = raw
    .split(/[,，、\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
  setValue(fieldId, arr)
}

const formatObjectDisplay = (v: any): string => {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

const handleObjectInput = (fieldId: string, raw: string) => {
  if (!raw.trim()) {
    setValue(fieldId, undefined)
    return
  }
  try {
    setValue(fieldId, JSON.parse(raw))
  } catch {
    // 暂时存为字符串，等 LLM 推断
    setValue(fieldId, raw)
  }
}
</script>

<template>
  <div class="schema-form-renderer">
    <div
      v-for="field in orderedFields"
      :key="field.fieldId"
      class="sfr-field"
      :class="[
        `sfr-role-${field.promptRole}`,
        { 'sfr-readonly': isReadOnlyField(field) }
      ]"
    >
      <div class="sfr-field__header">
        <span class="sfr-role-tag" :class="`sfr-tag-${field.promptRole}`">
          {{ ROLE_LABELS[field.promptRole] }}
        </span>
        <span class="sfr-fieldId">{{ field.fieldId }}</span>
        <span v-if="field.systemLocked" class="sfr-lock" title="system-locked">🔒</span>
      </div>
      <p v-if="field.description" class="sfr-desc">{{ field.description }}</p>

      <!-- 控制信号：只读 chip -->
      <template v-if="field.promptRole === 'control-signal'">
        <div class="sfr-chip">
          {{ getValue(field) ?? '—' }}
        </div>
      </template>

      <!-- 派生展示：只读卡片 -->
      <template v-else-if="field.promptRole === 'derived-presentation'">
        <div class="sfr-readonly-card">
          {{ formatStringArrayDisplay(getValue(field)) || '—' }}
        </div>
      </template>

      <!-- enum -->
      <template v-else-if="field.valueType === 'enum'">
        <el-radio-group
          :model-value="getValue(field)"
          :disabled="isReadOnlyField(field)"
          @update:model-value="(v: any) => setValue(field.fieldId, v)"
        >
          <el-radio-button
            v-for="opt in field.enumValues || []"
            :key="opt"
            :value="opt"
          >{{ opt }}</el-radio-button>
        </el-radio-group>
      </template>

      <!-- string[] -->
      <template v-else-if="field.valueType === 'string[]'">
        <el-input
          :model-value="formatStringArrayDisplay(getValue(field))"
          :disabled="isReadOnlyField(field)"
          type="textarea"
          :rows="2"
          placeholder="多项用逗号 / 顿号 / 换行分隔"
          @update:model-value="(v: any) => handleStringArrayInput(field.fieldId, v as string)"
        />
      </template>

      <!-- number -->
      <template v-else-if="field.valueType === 'number'">
        <el-input-number
          :model-value="getValue(field)"
          :disabled="isReadOnlyField(field)"
          @update:model-value="(v: any) => setValue(field.fieldId, v)"
        />
      </template>

      <!-- boolean -->
      <template v-else-if="field.valueType === 'boolean'">
        <el-switch
          :model-value="!!getValue(field)"
          :disabled="isReadOnlyField(field)"
          @update:model-value="(v: any) => setValue(field.fieldId, v)"
        />
      </template>

      <!-- object -->
      <template v-else-if="field.valueType === 'object'">
        <el-input
          :model-value="formatObjectDisplay(getValue(field))"
          :disabled="isReadOnlyField(field)"
          type="textarea"
          :rows="3"
          placeholder="JSON 对象（{...}），或自然语言（系统稍后规整）"
          @update:model-value="(v: any) => handleObjectInput(field.fieldId, v as string)"
        />
      </template>

      <!-- string (default) -->
      <template v-else>
        <el-input
          :model-value="getValue(field) ?? ''"
          :disabled="isReadOnlyField(field)"
          :placeholder="field.description || ''"
          @update:model-value="(v: any) => setValue(field.fieldId, v)"
        />
      </template>
    </div>

    <el-empty v-if="!orderedFields.length" description="无可渲染字段" />
  </div>
</template>

<style scoped>
.schema-form-renderer {
  display: grid;
  gap: 14px;
}

.sfr-field {
  padding: 14px 16px;
  border-radius: 14px;
  border: 1px solid var(--border-default, #e2e8f0);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(248, 250, 255, 0.92));
}

.sfr-field.sfr-role-hard-required {
  border-color: color-mix(in srgb, #f97316 22%, var(--border-default, #e2e8f0));
}

.sfr-field.sfr-role-soft-info {
  border-color: color-mix(in srgb, #60a5fa 18%, var(--border-default, #e2e8f0));
}

.sfr-field.sfr-role-hidden-inference {
  background: linear-gradient(180deg, rgba(237, 233, 254, 0.38), rgba(248, 250, 255, 0.92));
}

.sfr-field.sfr-readonly {
  opacity: 0.85;
}

.sfr-field__header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}

.sfr-role-tag {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 700;
  border-radius: 999px;
  background: #f1f5f9;
  color: #475569;
}

.sfr-tag-hard-required {
  background: #fee2e2;
  color: #b91c1c;
}
.sfr-tag-soft-info {
  background: #dbeafe;
  color: #1e40af;
}
.sfr-tag-hidden-inference {
  background: #ede9fe;
  color: #6d28d9;
}
.sfr-tag-public-reply {
  background: #dcfce7;
  color: #15803d;
}
.sfr-tag-proposal-output {
  background: #fef3c7;
  color: #b45309;
}
.sfr-tag-derived-presentation {
  background: #e0f2fe;
  color: #0369a1;
}
.sfr-tag-control-signal {
  background: #f1f5f9;
  color: #334155;
}

.sfr-fieldId {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 12px;
  color: var(--text-primary, #22344d);
  font-weight: 600;
}

.sfr-lock {
  font-size: 13px;
}

.sfr-desc {
  margin: 0 0 10px;
  color: var(--text-secondary, #64748b);
  font-size: 12.5px;
  line-height: 1.6;
}

.sfr-chip {
  display: inline-flex;
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  background: #f1f5f9;
  color: #334155;
  font-family: 'JetBrains Mono', Consolas, monospace;
}

.sfr-readonly-card {
  padding: 10px 12px;
  border-radius: 10px;
  background: #f8fafc;
  color: var(--text-secondary, #475569);
  font-size: 13px;
  line-height: 1.7;
  border: 1px dashed #cbd5e1;
}
</style>
