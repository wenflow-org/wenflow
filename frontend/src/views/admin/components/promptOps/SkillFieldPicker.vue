<!--
  SkillFieldPicker
  ============================================================
  可视化 agent.skill.字段 三级选择器.

  用法:
    <SkillFieldPicker
      v-model:visible="pickerVisible"
      :exclude-skill-id="currentSkillId"
      @pick="onPickField"
    />

  emit('pick', { skillId, fieldPath, kind, valueType, token })
    token = '{{skill:goal-conversation.understanding.surface_goal}}'

  数据源: GET /admin/prompt-ops/skill-catalog
-->
<template>
  <el-drawer
    :model-value="visible"
    @update:model-value="$emit('update:visible', $event)"
    title="选择 Agent · Skill · 字段"
    direction="rtl"
    size="640px"
    :destroy-on-close="false"
  >
    <div class="field-picker" v-loading="loading">
      <!-- 顶部搜索 -->
      <div class="field-picker__search">
        <el-input
          v-model="searchText"
          placeholder="搜索字段名 / 类型 / 说明..."
          clearable
          size="default"
        >
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-radio-group v-model="filterKind" size="small">
          <el-radio-button value="all">全部</el-radio-button>
          <el-radio-button value="output">输出 (上游产出)</el-radio-button>
          <el-radio-button value="input">输入 (本 skill 接受)</el-radio-button>
        </el-radio-group>
      </div>

      <div v-if="catalog" class="field-picker__stats">
        共 {{ catalog.totalAgents }} agent · {{ catalog.totalSkills }} skill · {{ catalog.totalFields }} 字段
      </div>

      <!-- Tree 列表 -->
      <div v-if="filteredAgents.length > 0" class="field-picker__tree">
        <div
          v-for="agent in filteredAgents"
          :key="agent.agentId"
          class="agent-block"
        >
          <header class="agent-block__head" @click="toggleAgent(agent.agentId)">
            <el-icon class="agent-block__toggle">
              <ArrowRight v-if="!expandedAgents.has(agent.agentId)" />
              <ArrowDown v-else />
            </el-icon>
            <span class="agent-block__name">{{ agent.agentName }}</span>
            <code class="agent-block__id">{{ agent.agentId }}</code>
            <span class="agent-block__meta">{{ agent.skills.length }} skill</span>
          </header>

          <div v-show="expandedAgents.has(agent.agentId)" class="agent-block__body">
            <div
              v-for="skill in agent.skills"
              :key="skill.skillId"
              class="skill-block"
              :class="{ 'skill-block--excluded': skill.skillId === excludeSkillId || skill.skillId === fullExcludeId }"
            >
              <header class="skill-block__head" @click="toggleSkill(skill.skillId)">
                <el-icon class="skill-block__toggle">
                  <ArrowRight v-if="!expandedSkills.has(skill.skillId)" />
                  <ArrowDown v-else />
                </el-icon>
                <span class="skill-block__name">{{ skill.skillName }}</span>
                <el-tag v-if="!skill.hasPrompt" size="small" type="info" effect="plain">无 prompt</el-tag>
                <el-tag v-if="skill.skillId === excludeSkillId || skill.skillId === fullExcludeId" size="small" type="warning" effect="plain">当前 skill</el-tag>
                <span class="skill-block__meta">
                  in {{ skill.inputFieldCount }} / out {{ skill.outputFieldCount }}
                </span>
              </header>

              <div v-show="expandedSkills.has(skill.skillId)" class="skill-block__body">
                <!-- 输出字段 (跨 skill 引用的主要来源) -->
                <div v-if="filterKind !== 'input' && skill.outputFields.length > 0" class="field-group">
                  <div class="field-group__label">
                    <span class="field-group__tag field-group__tag--output">输出</span>
                    <span class="field-group__hint">{{ filteredOutputCount(skill) }} 字段</span>
                  </div>
                  <div class="field-list">
                    <button
                      v-for="field in filterFields(skill.outputFields)"
                      :key="`out-${skill.skillId}-${field.path}`"
                      class="field-item"
                      type="button"
                      @click="pickField(skill.skillId, field, 'output')"
                    >
                      <code class="field-item__path">{{ field.path }}</code>
                      <span v-if="field.valueType" class="field-item__type">{{ field.valueType }}</span>
                      <span v-if="field.note" class="field-item__note">{{ field.note }}</span>
                    </button>
                  </div>
                </div>

                <!-- 输入字段 -->
                <div v-if="filterKind !== 'output' && skill.inputFields.length > 0" class="field-group">
                  <div class="field-group__label">
                    <span class="field-group__tag field-group__tag--input">输入</span>
                    <span class="field-group__hint">{{ filteredInputCount(skill) }} 字段</span>
                  </div>
                  <div class="field-list">
                    <button
                      v-for="field in filterFields(skill.inputFields)"
                      :key="`in-${skill.skillId}-${field.path}`"
                      class="field-item"
                      type="button"
                      @click="pickField(skill.skillId, field, 'input')"
                    >
                      <code class="field-item__path">{{ field.path }}</code>
                      <span v-if="field.valueType" class="field-item__type">{{ field.valueType }}</span>
                      <span v-if="field.note" class="field-item__note">{{ field.note }}</span>
                    </button>
                  </div>
                </div>

                <div
                  v-if="skill.inputFields.length === 0 && skill.outputFields.length === 0"
                  class="skill-block__empty"
                >
                  无可引用字段
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <el-empty v-else-if="!loading" description="无匹配字段" />

      <!-- 底部帮助 -->
      <div class="field-picker__help">
        <el-icon><InfoFilled /></el-icon>
        点击字段插入引用 token <code>{{ tokenExample }}</code>, 编译时自动渲染为字段说明.
      </div>
    </div>
  </el-drawer>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Search, ArrowRight, ArrowDown, InfoFilled } from '@element-plus/icons-vue'
import { adminPromptOpsApi } from '@/api/adminApi'

interface PickField {
  path: string
  valueType: string | null
  enumValues: string[] | null
  note: string
}

interface PickSkill {
  skillId: string
  skillName: string
  description?: string
  hasPrompt: boolean
  promptVersion: number | null
  inputFields: PickField[]
  outputFields: PickField[]
  inputFieldCount: number
  outputFieldCount: number
}

interface PickAgent {
  agentId: string
  agentName: string
  description?: string
  monitoringGroup?: string
  skills: PickSkill[]
}

interface SkillCatalog {
  agents: PickAgent[]
  totalAgents: number
  totalSkills: number
  totalFields: number
}

const props = defineProps<{
  visible: boolean
  excludeSkillId?: string | null
}>()

const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'pick', payload: {
    skillId: string
    fieldPath: string
    kind: 'input' | 'output'
    valueType: string | null
    note: string
    token: string
  }): void
}>()

const loading = ref(false)
const catalog = ref<SkillCatalog | null>(null)
const searchText = ref('')
const filterKind = ref<'all' | 'input' | 'output'>('output')
const expandedAgents = ref(new Set<string>())
const expandedSkills = ref(new Set<string>())

const tokenExample = '\u007b\u007bskill:xxx.field\u007d\u007d'

// 兼容 'goal-conversation' / 'skill:goal-conversation' 排除
const fullExcludeId = computed(() => {
  if (!props.excludeSkillId) return ''
  return props.excludeSkillId.startsWith('skill:')
    ? props.excludeSkillId.slice(6)
    : `skill:${props.excludeSkillId}`
})

const filteredAgents = computed(() => {
  if (!catalog.value) return []
  const q = searchText.value.trim().toLowerCase()
  return catalog.value.agents
    .map((agent) => {
      const skills = agent.skills
        .map((skill) => {
          const inputs = filterFields(skill.inputFields)
          const outputs = filterFields(skill.outputFields)
          if (q && inputs.length === 0 && outputs.length === 0) return null
          return skill
        })
        .filter((s): s is PickSkill => s !== null)
      return { ...agent, skills }
    })
    .filter((a) => a.skills.length > 0)
})

function filterFields(fields: PickField[]): PickField[] {
  const q = searchText.value.trim().toLowerCase()
  if (!q) return fields
  return fields.filter((f) => {
    return (
      f.path.toLowerCase().includes(q) ||
      (f.valueType || '').toLowerCase().includes(q) ||
      (f.note || '').toLowerCase().includes(q)
    )
  })
}

const filteredInputCount = (skill: PickSkill) => filterFields(skill.inputFields).length
const filteredOutputCount = (skill: PickSkill) => filterFields(skill.outputFields).length

const toggleAgent = (id: string) => {
  if (expandedAgents.value.has(id)) expandedAgents.value.delete(id)
  else expandedAgents.value.add(id)
}

const toggleSkill = (id: string) => {
  if (expandedSkills.value.has(id)) expandedSkills.value.delete(id)
  else expandedSkills.value.add(id)
}

const pickField = (skillId: string, field: PickField, kind: 'input' | 'output') => {
  // 去掉 skill: 前缀, 引用语法用短名 (跟 routing 表一致)
  const shortId = skillId.startsWith('skill:') ? skillId.slice(6) : skillId
  const token = `{{skill:${shortId}.${field.path}}}`
  emit('pick', {
    skillId: shortId,
    fieldPath: field.path,
    kind,
    valueType: field.valueType,
    note: field.note,
    token,
  })
  ElMessage.success(`已插入引用: ${shortId}.${field.path}`)
}

const loadCatalog = async () => {
  if (catalog.value) return // 已加载缓存
  loading.value = true
  try {
    const res: any = await adminPromptOpsApi.getSkillCatalog()
    catalog.value = res.data?.data || res.data
    // 默认全部展开 agent
    if (catalog.value) {
      catalog.value.agents.forEach((a) => expandedAgents.value.add(a.agentId))
    }
  } catch (error: any) {
    const msg = error?.response?.data?.error || error?.message || '加载 skill 目录失败'
    ElMessage.error(msg)
  } finally {
    loading.value = false
  }
}

watch(() => props.visible, (v) => {
  if (v) loadCatalog()
})
</script>

<style scoped>
.field-picker {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 0 4px;
}

.field-picker__search {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.field-picker__stats {
  font-size: 12px;
  color: #6b7280;
}

.field-picker__tree {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: calc(100vh - 280px);
  overflow-y: auto;
}

.agent-block {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: var(--admin-bg-surface);
}

.agent-block__head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  cursor: pointer;
  background: #f8fafc;
  border-radius: 10px 10px 0 0;
  user-select: none;
}

.agent-block__head:hover {
  background: #f1f5f9;
}

.agent-block__toggle {
  color: #94a3b8;
  font-size: 14px;
}

.agent-block__name {
  font-weight: 700;
  font-size: 13.5px;
  color: #1f2937;
}

.agent-block__id {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11px;
  color: #6366f1;
  padding: 2px 7px;
  background: #eef2ff;
  border-radius: 4px;
}

.agent-block__meta {
  margin-left: auto;
  font-size: 11.5px;
  color: #94a3b8;
}

.agent-block__body {
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.skill-block {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
}

.skill-block--excluded {
  opacity: 0.5;
  background: #fef3c7;
}

.skill-block__head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
}

.skill-block__head:hover {
  background: #f8fafc;
}

.skill-block__toggle {
  color: #94a3b8;
  font-size: 12px;
}

.skill-block__name {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 12.5px;
  color: #1f2937;
  font-weight: 600;
}

.skill-block__meta {
  margin-left: auto;
  font-size: 11px;
  color: #94a3b8;
}

.skill-block__body {
  padding: 4px 12px 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.skill-block__empty {
  padding: 12px;
  text-align: center;
  color: #94a3b8;
  font-size: 12px;
}

.field-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-group__label {
  display: flex;
  align-items: center;
  gap: 8px;
}

.field-group__tag {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 10px;
}

.field-group__tag--output {
  background: rgba(16, 185, 129, 0.1);
  color: #047857;
}

.field-group__tag--input {
  background: rgba(59, 130, 246, 0.1);
  color: #1d4ed8;
}

.field-group__hint {
  font-size: 11px;
  color: #94a3b8;
}

.field-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: var(--admin-bg-surface);
  cursor: pointer;
  text-align: left;
  transition: all 0.15s ease;
  font-family: inherit;
}

.field-item:hover {
  border-color: #4f46e5;
  background: #fafbff;
  box-shadow: 0 1px 4px rgba(79, 70, 229, 0.1);
}

.field-item__path {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11.5px;
  color: #6366f1;
  font-weight: 600;
}

.field-item__type {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 10.5px;
  color: #64748b;
  padding: 1px 6px;
  background: #f1f5f9;
  border-radius: 4px;
}

.field-item__note {
  font-size: 11.5px;
  color: #94a3b8;
  margin-left: auto;
  flex: 1;
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.field-picker__help {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  background: #f0f9ff;
  border: 1px solid #bae6fd;
  border-radius: 8px;
  font-size: 11.5px;
  color: #075985;
}

.field-picker__help code {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11px;
  padding: 1px 6px;
  background: #e0f2fe;
  border-radius: 4px;
  color: #0c4a6e;
}
</style>