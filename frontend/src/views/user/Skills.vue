<template>
  <CapabilityShell title="Skill">
    <div class="user-skills-page">
      <!-- 工具栏：筛选 + 统计 -->
      <div class="toolbar">
        <select v-model="filterEnabled" class="uc-field__input toolbar-select" @change="loadSkills">
          <option :value="undefined">全部状态</option>
          <option :value="true">启用中</option>
          <option :value="false">已禁用</option>
        </select>
        <div class="stats">
          <span>全部 <strong>{{ skills.length }}</strong></span>
          <span>启用 <strong>{{ enabledCount }}</strong></span>
          <span>关闭 <strong>{{ skills.length - enabledCount }}</strong></span>
        </div>
      </div>

      <div v-if="!loading && loadError" class="uc-card">
        <div class="uc-errorbar" role="alert">
          {{ loadError }}
          <button type="button" class="uc-errorbar__retry" @click="loadSkills">重新加载</button>
        </div>
      </div>

      <div v-else-if="loading && !skills.length" class="uc-card">
        <div class="uc-loading">
          <span class="uc-spinner"></span>
          加载 Skill 列表…
        </div>
      </div>

      <div v-else-if="!loading && skills.length === 0" class="uc-empty">
        <strong>暂无 Skill</strong>
        <span>平台上架 Skill 后会出现在这里</span>
      </div>

      <article v-else class="uc-card uc-card--flush">
        <div class="uc-table-wrap">
          <table class="uc-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>来源</th>
                <th>启用</th>
                <th>Endpoint</th>
                <th class="uc-table__right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="skill in skills" :key="skill.skillName">
                <td>{{ skill.skillName }}</td>
                <td><span class="uc-badge" :class="skill.sourceType === 'CUSTOM' ? 'uc-badge--info' : 'uc-badge--muted'">
                  {{ skill.sourceType === 'CUSTOM' ? '自定义' : '平台' }}
                </span></td>
                <td>
                  <label class="uc-switch">
                    <input
                      type="checkbox"
                      v-model="skill.enabled"
                      :disabled="togglingSkills.has(skill.skillName)"
                      @change="toggleSkill(skill)"
                    />
                    <span class="uc-switch__track"></span>
                  </label>
                </td>
                <td class="uc-table__muted">{{ skill.endpoint || '-' }}</td>
                <td class="uc-table__right">
                  <button type="button" class="uc-btn uc-btn--link" @click="viewSkill(skill)">详情</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>

      <!-- 详情弹窗 -->
      <div v-if="detailVisible && currentSkill" class="uc-dialog-mask" @click.self="detailVisible = false">
        <div class="uc-dialog" role="dialog" aria-modal="true" aria-label="Skill 详情">
          <div class="uc-dialog__head">
            <h3>{{ currentSkill.skillName }}</h3>
            <button type="button" class="uc-dialog__close" aria-label="关闭" @click="detailVisible = false">✕</button>
          </div>
          <div class="uc-dialog__body">
            <div class="detail-row">
              <span>来源</span>
              <strong>{{ currentSkill.sourceType === 'CUSTOM' ? '自定义' : '平台' }}</strong>
            </div>
            <div class="detail-row">
              <span>状态</span>
              <span class="uc-badge" :class="currentSkill.enabled ? 'uc-badge--ok' : 'uc-badge--muted'">
                {{ currentSkill.enabled ? '启用' : '关闭' }}
              </span>
            </div>
            <div class="detail-row">
              <span>Endpoint</span>
              <strong>{{ currentSkill.endpoint || '-' }}</strong>
            </div>
            <div class="detail-row detail-row--block">
              <span>参数</span>
              <pre class="skill-parameters">{{ formatParameters(currentSkill.parameters) }}</pre>
            </div>
          </div>
          <div class="uc-dialog__foot">
            <button type="button" class="uc-btn" @click="detailVisible = false">关闭</button>
          </div>
        </div>
      </div>
    </div>
  </CapabilityShell>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import CapabilityShell from '@/components/user/CapabilityShell.vue'
import { toast } from '../../utils/toast'
import { getUserSkill, getUserSkills, toggleUserSkill } from '@/api/userCustom'
import '@/components/user/uc.css'

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

<style scoped>
.user-skills-page {
  display: grid;
  gap: 16px;
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

.toolbar-select {
  width: 160px;
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

.skill-parameters {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  font-family: 'JetBrains Mono', 'Cascadia Code', Consolas, monospace;
  background: var(--canvas, #f3f6fb);
  border: 1px solid var(--line, #e3e9f4);
  border-radius: 10px;
  padding: 10px;
  max-height: 260px;
  overflow: auto;
}

.detail-row {
  display: grid;
  gap: 4px;
}

.detail-row > span {
  font-size: 12px;
  font-weight: 700;
  color: var(--faint, #67758f);
}

.detail-row strong {
  font-size: 14px;
  color: var(--ink, #172033);
}

.detail-row--block {
  display: grid;
  gap: 6px;
}
</style>
