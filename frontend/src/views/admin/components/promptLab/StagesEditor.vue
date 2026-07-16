<template>
  <div class="stages-editor">
    <!-- Flow diagram -->
    <div class="stages-flow">
      <template v-for="(stage, idx) in stages" :key="stage.name">
        <div class="stage-node" :class="{ 'stage-node--first': idx === 0, 'stage-node--last': idx === stages.length - 1 }">
          <span class="stage-node-name">{{ stage.name }}</span>
          <span class="stage-node-desc">{{ stage.desc }}</span>
        </div>
        <div v-if="idx < stages.length - 1" class="stage-arrow">→</div>
      </template>
    </div>

    <!-- Hard conditions -->
    <div class="stages-group">
      <div class="stages-group-title">硬条件（进入 proposing 必须）</div>
      <div v-for="(c, idx) in hardConditions" :key="'h'+idx" class="condition-row">
        <span class="condition-text">{{ c }}</span>
        <div class="condition-actions">
          <el-button class="admin-icon-button" text size="small" aria-label="编辑硬条件" @click="editCondition('hard', idx)"><el-icon><Edit /></el-icon></el-button>
          <el-button class="admin-icon-button" text type="danger" size="small" aria-label="删除硬条件" @click="removeCondition('hard', idx)"><el-icon><Delete /></el-icon></el-button>
        </div>
      </div>
      <el-button size="small" text type="primary" @click="addCondition('hard')" class="add-cond-btn">
        + 添加硬条件
      </el-button>
    </div>

    <!-- Soft conditions -->
    <div class="stages-group">
      <div class="stages-group-title">软信息（不阻止收敛）</div>
      <div v-for="(c, idx) in softConditions" :key="'s'+idx" class="condition-row">
        <span class="condition-text">{{ c }}</span>
        <div class="condition-actions">
          <el-button class="admin-icon-button" text size="small" aria-label="编辑软信息" @click="editCondition('soft', idx)"><el-icon><Edit /></el-icon></el-button>
          <el-button class="admin-icon-button" text type="danger" size="small" aria-label="删除软信息" @click="removeCondition('soft', idx)"><el-icon><Delete /></el-icon></el-button>
        </div>
      </div>
      <el-button size="small" text type="primary" @click="addCondition('soft')" class="add-cond-btn">
        + 添加软信息
      </el-button>
    </div>

    <!-- Condition edit dialog -->
    <el-dialog v-model="condDialogVisible" title="编辑条件" width="420px" destroy-on-close>
      <el-input v-model="condEditText" type="textarea" :rows="3" placeholder="条件内容..." />
      <template #footer>
        <el-button @click="condDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveCondition">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Edit, Delete } from '@element-plus/icons-vue'

const props = defineProps<{
  content: string
  modelValue: string
  sectionId: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

interface StageInfo {
  name: string
  desc: string
}

const stages = ref<StageInfo[]>([])
const hardConditions = ref<string[]>([])
const softConditions = ref<string[]>([])

const condDialogVisible = ref(false)
const condEditText = ref('')
let condEditType: 'hard' | 'soft' = 'hard'
let condEditIdx = -1

function parse() {
  const text = props.modelValue || props.content
  const lines = text.split('\n')

  const foundStages: StageInfo[] = []
  const foundHard: string[] = []
  const foundSoft: string[] = []
  let inHard = false
  let inSoft = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // Arrow flow: understanding → proposing → ready
    const arrowMatch = trimmed.match(/(\w+)\s*→\s*(\w+)/)
    if (arrowMatch) {
      const parts = trimmed.split('→').map(p => p.trim())
      for (const p of parts) {
        if (p && !foundStages.find(s => s.name === p)) {
          foundStages.push({ name: p, desc: '' })
        }
      }
      continue
    }

    // Stage description: - **name**：desc
    const descMatch = trimmed.match(/^[-*]\s*\*{0,2}(\w+)\*{0,2}\s*[：:]\s*(.+)/)
    if (descMatch) {
      const name = descMatch[1]
      const desc = descMatch[2]
      const existing = foundStages.find(s => s.name === name)
      if (existing) {
        existing.desc = desc
      } else if (name === 'understanding' || name === 'proposing' || name === 'ready') {
        foundStages.push({ name, desc })
      }
      continue
    }

    // Section markers
    if (trimmed.includes('硬条件') || trimmed.includes('硬必需') || trimmed.includes('必须齐全')) {
      inHard = true; inSoft = false; continue
    }
    if (trimmed.includes('软信息') || trimmed.includes('不阻止收敛')) {
      inHard = false; inSoft = true; continue
    }

    // List items (conditions)
    const listMatch = trimmed.match(/^[-*]\s+(.+)/)
    if (listMatch) {
      const text = listMatch[1]
      if (inHard) foundHard.push(text)
      else if (inSoft) foundSoft.push(text)
    }
  }

  if (foundStages.length > 0) stages.value = foundStages
  if (foundHard.length > 0) hardConditions.value = foundHard
  if (foundSoft.length > 0) softConditions.value = foundSoft
}

function serialize(): string {
  const parts: string[] = []

  // Stage flow
  parts.push(`阶段：${stages.value.map(s => s.name).join(' → ')}`)
  parts.push('')
  for (const s of stages.value) {
    parts.push(`- **${s.name}**：${s.desc}`)
  }

  // Hard conditions
  if (hardConditions.value.length > 0) {
    parts.push('')
    parts.push('进入 proposing 的硬条件（4 项必须齐全）：')
    for (const c of hardConditions.value) {
      parts.push(`- ${c}`)
    }
  }

  // Soft conditions
  if (softConditions.value.length > 0) {
    parts.push('')
    parts.push('以下为软信息，不阻止收敛：')
    for (const c of softConditions.value) {
      parts.push(`- ${c}`)
    }
  }

  return parts.join('\n')
}

function emitUpdate() {
  emit('update:modelValue', serialize())
}

function addCondition(type: 'hard' | 'soft') {
  condEditType = type
  condEditIdx = -1
  condEditText.value = ''
  condDialogVisible.value = true
}

function editCondition(type: 'hard' | 'soft', idx: number) {
  condEditType = type
  condEditIdx = idx
  const list = type === 'hard' ? hardConditions.value : softConditions.value
  condEditText.value = list[idx] || ''
  condDialogVisible.value = true
}

function saveCondition() {
  const text = condEditText.value.trim()
  if (!text) return
  const list = condEditType === 'hard' ? hardConditions.value : softConditions.value
  if (condEditIdx >= 0) {
    list[condEditIdx] = text
  } else {
    list.push(text)
  }
  condDialogVisible.value = false
  emitUpdate()
}

function removeCondition(type: 'hard' | 'soft', idx: number) {
  const list = type === 'hard' ? hardConditions.value : softConditions.value
  list.splice(idx, 1)
  emitUpdate()
}

watch(() => props.modelValue, parse, { immediate: true })
watch(() => props.content, parse)
</script>

<style scoped>
.stages-editor { display: flex; flex-direction: column; gap: 16px; }

.stages-flow {
  display: flex;
  align-items: center;
  gap: 0;
  padding: 12px 0;
  overflow-x: auto;
}

.stage-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px 16px;
  border-radius: 8px;
  background: var(--admin-bg-hover, #f9fafb);
  border: 2px solid var(--admin-border-color, #e5e7eb);
  min-width: 100px;
}

.stage-node--first {
  border-color: var(--admin-color-brand, #3b82f6);
  background: var(--admin-color-brand-bg, #eff6ff);
}

.stage-node--last {
  border-color: var(--admin-color-success, #10b981);
  background: #d1fae5;
}

.stage-node-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--admin-text-primary, #111827);
  font-family: 'JetBrains Mono', Consolas, monospace;
}

.stage-node-desc {
  font-size: 11px;
  color: var(--admin-text-muted, #9ca3af);
  text-align: center;
}

.stage-arrow {
  font-size: 20px;
  color: var(--admin-text-muted, #9ca3af);
  margin: 0 8px;
  font-weight: 700;
}

.stages-group {
  padding: 12px;
  background: var(--admin-bg-page);
  border-radius: 6px;
}

.stages-group-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--admin-text-muted, #9ca3af);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 8px;
}

.condition-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  margin-bottom: 4px;
  border-radius: 4px;
  background: #fef3c7;
  border-left: 3px solid #d97706;
}

.condition-text {
  flex: 1;
  font-size: 13px;
  color: #92400e;
  line-height: 1.5;
}

.condition-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s;
}

.condition-row:hover .condition-actions {
  opacity: 1;
}

.condition-row:focus-within .condition-actions {
  opacity: 1;
}

.add-cond-btn {
  align-self: flex-start;
  margin-top: 4px;
}

@media (max-width: 768px), (pointer: coarse) {
  .condition-actions {
    opacity: 1;
  }
}
</style>
