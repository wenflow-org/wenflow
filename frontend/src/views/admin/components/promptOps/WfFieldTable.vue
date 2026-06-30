<!--
  WfFieldTable
  ============================================================
  渲染从 ## 输出规格 / ## 输入说明 的 ```json``` 示例自动抽取的字段表。
  - 字段「结构」（路径/类型/语义）真相源 = prompt 的 JSON schema（只读派生）。
  - 字段「治理」（耦合度/锁）真相源 = field_definitions 表，后端按 stage LEFT JOIN。
    表里有的字段显示耦合度 badge + 锁标志；没有的留空（未治理 / 容器字段）。
-->
<template>
  <div class="wf-table">
    <div class="wf-table__head">
      <span class="wf-table__kind">{{ kindLabel }}</span>
      <span class="wf-table__lock">结构来自 JSON schema · 治理来自 field_definitions（只读）</span>
    </div>
    <el-table :data="fields" size="small" border class="wf-table__el">
      <el-table-column prop="path" label="字段路径" min-width="200">
        <template #default="{ row }">
          <code class="wf-table__path">{{ row.path }}</code>
        </template>
      </el-table-column>
      <el-table-column label="类型" min-width="140">
        <template #default="{ row }">
          <span class="wf-table__type">{{ row.valueType || '—' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="耦合度" width="92">
        <template #default="{ row }">
          <span v-if="row.coupling" :class="['wf-badge', 'wf-badge--' + row.coupling]">
            {{ couplingLabel(row.coupling) }}
          </span>
          <span v-else class="wf-table__dim">—</span>
        </template>
      </el-table-column>
      <el-table-column label="治理" width="110">
        <template #default="{ row }">
          <span v-if="row.systemLocked" class="wf-gov wf-gov--sys">🔒 系统字段</span>
          <span v-else-if="row.governed" class="wf-gov wf-gov--soft">可编辑软字段</span>
          <span v-else class="wf-table__dim">未治理</span>
        </template>
      </el-table-column>
      <el-table-column prop="note" label="语义说明" min-width="200">
        <template #default="{ row }">
          <span class="wf-table__note">{{ row.note || '—' }}</span>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface WfField {
  path: string
  valueType: string | null
  enumValues?: string[]
  note: string
  coupling?: 'contract' | 'flow' | 'prose' | null
  promptRole?: string | null
  systemLocked?: boolean
  structureLocked?: boolean
  governed?: boolean
  governedFieldId?: string
}

interface Props {
  kind: 'wf-input' | 'wf-output'
  fields: WfField[]
}

const props = defineProps<Props>()

const kindLabel = computed(() => {
  const map: Record<string, string> = {
    'wf-input': '输入字段（来自 JSON schema）',
    'wf-output': '输出字段（来自 JSON schema）'
  }
  return map[props.kind] || props.kind
})

function couplingLabel(c: 'contract' | 'flow' | 'prose'): string {
  return { contract: '契约', flow: '流程', prose: '话术' }[c]
}
</script>

<style scoped>
.wf-table {
  margin-top: 10px;
  border: 1px dashed #cbd5e1;
  border-radius: 8px;
  padding: 8px 10px;
  background: #f8fafc;
}

.wf-table__head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}

.wf-table__kind {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11px;
  font-weight: 800;
  color: #1a2a44;
}

.wf-table__lock {
  font-size: 11px;
  color: #b45309;
  margin-left: auto;
}

.wf-table__el {
  width: 100%;
}

.wf-table__path {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11.5px;
  color: #6d28d9;
}

.wf-table__type {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11.5px;
  color: #475569;
}

.wf-table__note {
  font-size: 12px;
  color: #475569;
}

.wf-badge {
  display: inline-block;
  font-size: 10.5px;
  font-weight: 700;
  padding: 1px 7px;
  border-radius: 10px;
}

.wf-badge--prose {
  background: #f1f5f9;
  color: #64748b;
}

.wf-badge--contract {
  background: rgba(220, 38, 38, 0.1);
  color: #dc2626;
}

.wf-badge--flow {
  background: rgba(234, 88, 12, 0.1);
  color: #ea580c;
}

.wf-table__dim {
  font-size: 11px;
  color: #cbd5e1;
}

.wf-gov {
  font-size: 11px;
  font-weight: 700;
}

.wf-gov--sys {
  color: #dc2626;
}

.wf-gov--soft {
  color: #2563eb;
}
</style>
