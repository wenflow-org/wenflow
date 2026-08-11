<template>
  <CapabilityShell title="Skill">
    <div class="user-skills-page">
      <div class="toolbar">
        <el-select
          v-model="filterEnabled"
          placeholder="全部状态"
          clearable
          style="width: 140px"
          @change="loadSkills"
        >
          <el-option label="启用中" :value="true" />
          <el-option label="已禁用" :value="false" />
        </el-select>
        <div class="stats">
          <span>全部 <strong>{{ skills.length }}</strong></span>
          <span>启用 <strong>{{ enabledCount }}</strong></span>
          <span>关闭 <strong>{{ skills.length - enabledCount }}</strong></span>
        </div>
      </div>

      <el-result v-if="!loading && loadError" icon="error" title="加载失败" :sub-title="loadError">
        <template #extra>
          <el-button type="primary" @click="loadSkills">重新加载</el-button>
        </template>
      </el-result>

      <el-empty v-else-if="!loading && skills.length === 0" description="暂无 Skill" />

      <div v-else class="skills-table-panel">
        <el-table :data="skills" v-loading="loading" style="width: 100%" row-key="skillName">
          <el-table-column prop="skillName" label="名称" min-width="160" show-overflow-tooltip />
          <el-table-column prop="sourceType" label="来源" width="90">
            <template #default="{ row }">
              {{ row.sourceType === 'CUSTOM' ? '自定义' : '平台' }}
            </template>
          </el-table-column>
          <el-table-column prop="enabled" label="启用" width="90">
            <template #default="{ row }">
              <el-switch
                v-model="row.enabled"
                :loading="togglingSkills.has(row.skillName)"
                :disabled="togglingSkills.has(row.skillName)"
                @change="toggleSkill(row)"
              />
            </template>
          </el-table-column>
          <el-table-column prop="endpoint" label="Endpoint" min-width="160" show-overflow-tooltip>
            <template #default="{ row }">
              {{ row.endpoint || '-' }}
            </template>
          </el-table-column>
          <el-table-column label="操作" width="80" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="viewSkill(row)">详情</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <el-dialog v-model="detailVisible" title="详情" width="min(560px, calc(100vw - 32px))">
        <el-descriptions v-if="currentSkill" :column="1" border>
          <el-descriptions-item label="名称">{{ currentSkill.skillName }}</el-descriptions-item>
          <el-descriptions-item label="来源">{{ currentSkill.sourceType === 'CUSTOM' ? '自定义' : '平台' }}</el-descriptions-item>
          <el-descriptions-item label="状态">{{ currentSkill.enabled ? '启用' : '关闭' }}</el-descriptions-item>
          <el-descriptions-item label="Endpoint">{{ currentSkill.endpoint || '-' }}</el-descriptions-item>
          <el-descriptions-item label="参数">
            <pre class="skill-parameters">{{ formatParameters(currentSkill.parameters) }}</pre>
          </el-descriptions-item>
        </el-descriptions>
        <template #footer>
          <el-button @click="detailVisible = false">关闭</el-button>
        </template>
      </el-dialog>
    </div>
  </CapabilityShell>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import CapabilityShell from '@/components/user/CapabilityShell.vue'
import { toast } from '../../utils/toast'
import { getUserSkill, getUserSkills, toggleUserSkill } from '@/api/userCustom'

interface UserSkillItem {
  skillName: string
  sourceType?: string
  endpoint?: string | null
  enabled: boolean
  updatedAt?: string
  parameters?: unknown
}

const loading = ref(false)
const detailVisible = ref(false)
const loadError = ref('')
const skills = ref<UserSkillItem[]>([])
const currentSkill = ref<UserSkillItem | null>(null)
const filterEnabled = ref<boolean | undefined>(undefined)
const togglingSkills = ref(new Set<string>())

const enabledCount = computed(() => skills.value.filter((item) => item.enabled).length)

onMounted(async () => {
  await loadSkills()
})

async function loadSkills() {
  loading.value = true
  loadError.value = ''
  try {
    const params: { enabled?: boolean } = {}
    if (typeof filterEnabled.value === 'boolean') {
      params.enabled = filterEnabled.value
    }
    const res = await getUserSkills(params)
    skills.value = res.data || []
  } catch {
    skills.value = []
    loadError.value = '加载失败'
    toast.error('加载失败')
  } finally {
    loading.value = false
  }
}

async function viewSkill(skill: UserSkillItem) {
  try {
    const res = await getUserSkill(skill.skillName)
    currentSkill.value = res.data
    detailVisible.value = true
  } catch {
    toast.error('加载详情失败')
  }
}

async function toggleSkill(skill: UserSkillItem) {
  if (togglingSkills.value.has(skill.skillName)) return
  togglingSkills.value.add(skill.skillName)
  try {
    await toggleUserSkill(skill.skillName, skill.enabled)
    toast.success(skill.enabled ? '已启用' : '已禁用')
  } catch {
    skill.enabled = !skill.enabled
    toast.error('操作失败')
  } finally {
    togglingSkills.value.delete(skill.skillName)
  }
}

function formatParameters(parameters: unknown) {
  if (!parameters) return '-'
  if (typeof parameters !== 'string') return JSON.stringify(parameters, null, 2)
  try {
    return JSON.stringify(JSON.parse(parameters), null, 2)
  } catch {
    return parameters
  }
}
</script>

<style scoped lang="scss">
.user-skills-page {
  display: grid;
  gap: 14px;
  min-width: 0;
  width: 100%;
  max-width: 100%;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.stats {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  font-size: 13px;
  color: var(--muted, #5b6577);

  strong {
    color: var(--ink, #172033);
    font-weight: 800;
    margin-left: 4px;
  }
}

.skills-table-panel {
  min-width: 0;
  width: 100%;
  padding: 16px;
  border-radius: 16px;
  border: 1px solid var(--line, #e3e9f4);
  background: var(--surface, #fff);
  box-shadow: 0 1px 2px rgba(23, 32, 51, 0.04), 0 10px 28px rgba(23, 32, 51, 0.05);
  overflow: hidden;
}

.skill-parameters {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
}
</style>
