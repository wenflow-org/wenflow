<template>
  <div class="admin-page skill-directory-page">
    <AdminPageHeader
      title="Skill 目录"
      :icon="Grid"
      :highlights="registryHighlights"
    >
      <template #actions>
        <el-button @click="seedCorePrompts">初始化核心 Prompt</el-button>
        <el-button type="primary" @click="loadRegistry" :loading="loading">
          <el-icon><Refresh /></el-icon>
          刷新
        </el-button>
      </template>
    </AdminPageHeader>

    <section class="admin-filter-panel skill-filter-panel">
      <div class="admin-section-head skill-filter-panel__head">
        <div class="admin-section-head__copy">
          <h3 class="admin-section-head__title">Skill 筛选</h3>
        </div>
        <div class="skill-filter-panel__summary">
          <span>{{ filteredSkills.length }} / {{ skills.length }} 个 Skill</span>
        </div>
      </div>

      <div class="admin-list-toolbar">
        <div class="admin-list-toolbar__group">
          <el-input v-model="keyword" placeholder="搜索 Skill ID / 名称" clearable class="search" />
          <el-select v-model="health" placeholder="健康状态" clearable class="select">
            <el-option label="健康" value="healthy" />
            <el-option label="预警" value="warning" />
            <el-option label="异常" value="error" />
            <el-option label="空闲" value="idle" />
          </el-select>
          <el-checkbox v-model="onlyAttention">仅看需关注</el-checkbox>
        </div>
        <div class="admin-list-toolbar__group">
          <p class="skill-toolbar-note">{{ keyword || health || onlyAttention ? '已启用筛选' : '默认范围' }}</p>
        </div>
      </div>
    </section>

    <section class="admin-list-card skill-browser">
      <el-table :data="filteredSkills" v-loading="loading" stripe style="width: 100%">
        <el-table-column label="Skill" min-width="300">
          <template #default="{ row }">
            <div class="skill-cell">
              <div class="skill-cell__title-row">
                <strong class="skill-cell__name">{{ row.name }}</strong>
                <el-tag size="small" type="success">Skill</el-tag>
              </div>
              <span class="skill-cell__id">{{ row.skillId }}</span>
              <span class="skill-cell__meta">{{ row.category }} · v{{ row.version }}</span>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="状态" min-width="190">
          <template #default="{ row }">
            <div class="status-cell">
              <div class="status-cell__row">
                <span class="status-cell__label">健康</span>
                <el-tag :type="getHealthTagType(row.status)" size="small">{{ getHealthLabel(row.status) }}</el-tag>
              </div>
              <div class="status-cell__row">
                <span class="status-cell__label">配置</span>
                <el-tag size="small" effect="plain" :type="row.configEnabled ? 'success' : 'info'">
                  {{ row.configEnabled ? '独立配置' : '继承默认' }}
                </el-tag>
              </div>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="调用" min-width="190">
          <template #default="{ row }">
            <div class="metrics-cell">
              <div class="metrics-cell__row">
                <span>{{ row.callCount }} 调用</span>
                <span :class="rateClass(row.successRate)">{{ row.successRate }}%</span>
              </div>
              <div class="metrics-cell__row metrics-cell__row--sub">
                <span>{{ formatDuration(row.avgDuration) }} 平均</span>
                <span>{{ formatTime(row.lastActivity) }}</span>
              </div>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="Prompt" min-width="180">
          <template #default="{ row }">
            <div class="prompt-cell">
              <template v-if="getPromptSummary(row.skillId)?.loading">
                <span class="prompt-cell__muted">加载中...</span>
              </template>
              <template v-else-if="getPromptSummary(row.skillId)?.versionLabel">
                <strong class="prompt-cell__version">{{ getPromptSummary(row.skillId)?.versionLabel }}</strong>
                <el-tag
                  size="small"
                  effect="plain"
                  :type="getPromptStatusTagType(getPromptSummary(row.skillId)?.status)"
                >
                  {{ getPromptSummary(row.skillId)?.statusLabel }}
                </el-tag>
              </template>
              <span v-else class="prompt-cell__muted">未配置</span>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="108" fixed="right" align="center">
          <template #default="{ row }">
            <el-button class="table-link-btn" @click="openNode(row.skillId)">快速查看</el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <SkillNodeWorkbench
      v-model:visible="skillWorkbenchVisible"
      :skill-id="currentSkillNodeId"
      @changed="loadRegistry"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Grid, Refresh } from '@element-plus/icons-vue'
import { adminAgentPromptsApi, adminAxios, adminSkillsApi } from '@/api/adminApi'
import AdminPageHeader from './components/AdminPageHeader.vue'
import SkillNodeWorkbench from './components/SkillNodeWorkbench.vue'
import { toast } from '../../utils/toast'
import { EXTRA_COMPONENT_VISIBLE_SKILLS } from './capabilityCatalog'

type SkillHealth = 'healthy' | 'warning' | 'error' | 'idle'

interface SkillConfigSummaryRow {
  skillId: string
  displayName?: string
  status?: 'working' | 'placeholder' | 'simplified' | 'mock'
  lastCalledAt?: string | null
  tier: string
  model?: string
  enabled: boolean
}

interface AdminSkillRuntimeInfo {
  name: string
  version: string
  category?: string
  description?: string
  stats?: {
    callCount?: number
    successRate?: number
    avgLatency?: number
  }
  lastCalledAt?: string | null
}

interface SkillDirectoryRow {
  skillId: string
  name: string
  category: string
  version: string
  status: SkillHealth
  callCount: number
  successRate: number
  avgDuration: number
  lastActivity: string | null
  configEnabled: boolean
}

interface PromptSummaryState {
  loading: boolean
  versionLabel: string
  status: string
  statusLabel: string
}

const skillNameMap: Record<string, string> = {
  'text-structure-analyzer': '文本结构分析器',
  retrieval: '内容检索器',
  'web-extractor': '网页内容提取器',
  'image-analyzer': '图片分析器',
  'memory-search': '学习记忆搜索器',
  'smart-search': '智能搜索器',
  'label-generator': '动态标签生成器',
  'adaptive-guidance-copy': '动态引导文案生成器',
  'goal-profile-inference': '目标阶段画像推断器',
  'learning-pattern-distiller': '学习模式蒸馏器',
  'session-knowledge-distiller': '课堂知识蒸馏器',
  'dialogue-concept-extractor': '对话概念抽取器',
  'path-scene-framing': '路径场景构图',
  'stage-designer': '阶段任务设计器',
  'peer-reinforcement': '同伴强化',
  'virtual-learner-persona-designer': '虚拟学习者身份设计器',
  'virtual-learner-scenario-designer': '虚拟学习者故事设计器',
  'virtual-learner-goal-dialogue-simulator': '虚拟学习者 Goal 对话模拟器',
  'virtual-learner-path-evaluator': '虚拟学习者路径评估器',
  'virtual-learner-learn-turn-simulator': '虚拟学习者 Learn 回合模拟器'
}

const route = useRoute()
const router = useRouter()

const loading = ref(false)
const skills = ref<SkillDirectoryRow[]>([])
const summary = ref<{ total: number; active24h: number; neverCalled: number; unhealthy: number } | null>(null)
const keyword = ref('')
const health = ref('')
const onlyAttention = ref(false)
const skillWorkbenchVisible = ref(false)
const currentSkillNodeId = ref('')
const promptSummaries = ref<Record<string, PromptSummaryState>>({})

const isExtraCapabilitySkill = (skillId: string) => EXTRA_COMPONENT_VISIBLE_SKILLS.has(skillId.replace(/^skill:/, ''))

const registryHighlights = computed(() => [
  { label: `${skills.value.length} 个 Skill`, tone: 'info' as const },
  { label: summary.value ? `24h 活跃 ${summary.value.active24h}` : '等待加载活跃统计', tone: 'success' as const },
  { label: summary.value ? `未调用 ${summary.value.neverCalled}` : '等待加载未调用统计', tone: 'warning' as const },
  {
    label: summary.value ? `需关注 ${summary.value.unhealthy}` : '等待加载健康统计',
    tone: summary.value && summary.value.unhealthy > 0 ? 'danger' as const : 'neutral' as const
  }
])

const filteredSkills = computed(() => {
  return skills.value.filter((skill) => {
    const byKeyword = !keyword.value || `${skill.skillId} ${skill.name}`.toLowerCase().includes(keyword.value.toLowerCase())
    const byHealth = !health.value || skill.status === health.value
    const byAttention = !onlyAttention.value || isAttentionSkill(skill)
    return byKeyword && byHealth && byAttention
  })
})

const statusToHealth = (status?: SkillConfigSummaryRow['status']): SkillHealth => {
  if (status === 'working') return 'healthy'
  if (status === 'simplified') return 'warning'
  if (status === 'placeholder' || status === 'mock') return 'error'
  return 'idle'
}

const deriveHealth = (runtimeInfo?: AdminSkillRuntimeInfo, config?: SkillConfigSummaryRow): SkillHealth => {
  if (config?.status) return statusToHealth(config.status)

  const callCount = Number(runtimeInfo?.stats?.callCount || 0)
  const successRate = Number(runtimeInfo?.stats?.successRate || 1)

  if (!callCount) return 'idle'
  if (successRate >= 0.95) return 'healthy'
  if (successRate >= 0.8) return 'warning'
  return 'error'
}

const buildSkillDirectoryRow = (skillId: string, runtimeInfo?: AdminSkillRuntimeInfo, config?: SkillConfigSummaryRow): SkillDirectoryRow => {
  const callCount = Number(runtimeInfo?.stats?.callCount || 0)
  const successRate = Number.isFinite(Number(runtimeInfo?.stats?.successRate))
    ? Number((Number(runtimeInfo?.stats?.successRate || 0) * 100).toFixed(1))
    : deriveHealth(runtimeInfo, config) === 'error'
      ? 0
      : 100
  const avgDuration = Number(runtimeInfo?.stats?.avgLatency || 0)

  return {
    skillId,
    name: skillNameMap[skillId] || config?.displayName || skillId,
    category: runtimeInfo?.category || config?.tier || 'skill',
    version: runtimeInfo?.version || '1.0.0',
    status: deriveHealth(runtimeInfo, config),
    callCount,
    successRate,
    avgDuration,
    lastActivity: runtimeInfo?.lastCalledAt || config?.lastCalledAt || null,
    configEnabled: !!config?.enabled
  }
}

const isAttentionSkill = (skill: SkillDirectoryRow) => {
  return skill.status === 'warning' || skill.status === 'error' || skill.callCount === 0
}

const buildSummary = (items: SkillDirectoryRow[]) => {
  const now = Date.now()
  const active24h = items.filter((item) => item.lastActivity && (now - new Date(item.lastActivity).getTime()) <= 24 * 3600000).length
  const neverCalled = items.filter((item) => !item.callCount).length
  const unhealthy = items.filter((item) => item.status === 'warning' || item.status === 'error').length

  return {
    total: items.length,
    active24h,
    neverCalled,
    unhealthy
  }
}

const normalizePromptRecord = (value: any) => {
  if (!value || typeof value !== 'object') return null
  return {
    id: value.id || value.promptId || '',
    version: value.version,
    versionLabel: value.versionLabel,
    status: value.status
  }
}

const formatPromptVersion = (prompt: { id?: string; version?: number | string; versionLabel?: string } | null | undefined) => {
  if (!prompt) return '-'
  if (prompt.id === '__code_fallback__') return 'built-in'
  if (prompt.versionLabel) return prompt.versionLabel
  if (prompt.version !== undefined && prompt.version !== null && prompt.version !== '') return `v${prompt.version}`
  return '-'
}

const getPromptStatusLabel = (status?: string | null) => {
  if (!status) return '未知'
  const normalized = status.toUpperCase()
  if (normalized === 'ACTIVE') return '已生效'
  if (normalized === 'BUILT_IN' || normalized === 'FALLBACK') return '代码内置'
  if (normalized === 'ARCHIVED') return '已归档'
  if (normalized === 'DRAFT') return '草稿'
  if (normalized === 'PUBLISHED') return '已发布'
  if (normalized === 'STAGING') return '预发布'
  if (normalized === 'GENERATED') return '默认草案'
  if (normalized === 'PROMPT_MISSING') return '缺少 Prompt'
  return '未知'
}

const getPromptStatusTagType = (status?: string | null) => {
  if (!status) return 'info'
  const normalized = status.toUpperCase()
  if (normalized === 'ACTIVE' || normalized === 'PUBLISHED') return 'success'
  if (normalized === 'STAGING' || normalized === 'GENERATED') return 'warning'
  if (normalized === 'PROMPT_MISSING') return 'danger'
  return 'info'
}

const setPromptSummary = (skillId: string, summaryState: PromptSummaryState) => {
  promptSummaries.value = {
    ...promptSummaries.value,
    [skillId]: summaryState
  }
}

const getPromptSummary = (skillId: string) => promptSummaries.value[skillId]

const loadPromptSummaries = async (directorySkills: SkillDirectoryRow[]) => {
  await Promise.allSettled(
    directorySkills.map(async (skill) => {
      const promptLookupId = `skill:${skill.skillId}`
      setPromptSummary(skill.skillId, {
        loading: true,
        versionLabel: '',
        status: '',
        statusLabel: ''
      })

      try {
        const versionsResponse: any = await adminAgentPromptsApi.getPromptVersions({ agentId: promptLookupId })
        const promptList = versionsResponse.data?.data?.list || versionsResponse.data?.data || []
        const prompts = Array.isArray(promptList)
          ? promptList.map(normalizePromptRecord).filter(Boolean)
          : []
        const activePrompt = prompts.find((item: any) => (item.status || '').toUpperCase() === 'ACTIVE') || prompts[0] || null

        if (activePrompt) {
          setPromptSummary(skill.skillId, {
            loading: false,
            versionLabel: formatPromptVersion(activePrompt),
            status: activePrompt.status || '',
            statusLabel: getPromptStatusLabel(activePrompt.status)
          })
          return
        }

        const effectiveSkillResponse: any = await adminSkillsApi.getEffectiveSkillPrompt(skill.skillId)
        const effectiveSource = effectiveSkillResponse.data?.data?.data?.source || effectiveSkillResponse.data?.data?.source || ''

        if (effectiveSource === 'generated-default') {
          setPromptSummary(skill.skillId, {
            loading: false,
            versionLabel: 'generated',
            status: 'GENERATED',
            statusLabel: '默认草案'
          })
          return
        }

        if (effectiveSource === 'code-fallback') {
          setPromptSummary(skill.skillId, {
            loading: false,
            versionLabel: 'built-in',
            status: 'FALLBACK',
            statusLabel: '代码内置'
          })
          return
        }

        setPromptSummary(skill.skillId, {
          loading: false,
          versionLabel: '',
          status: 'PROMPT_MISSING',
          statusLabel: '缺少 Prompt'
        })
      } catch {
        setPromptSummary(skill.skillId, {
          loading: false,
          versionLabel: '',
          status: '',
          statusLabel: ''
        })
      }
    })
  )
}

const loadRegistry = async () => {
  loading.value = true
  try {
    const [skillConfigResponse, runtimeSkillResponse]: any = await Promise.all([
      adminSkillsApi.getSkillModelConfigs(),
      adminAxios.get('/admin/skills')
    ])

    const runtimeSkillList = Array.isArray(runtimeSkillResponse.data?.data) ? runtimeSkillResponse.data.data : []
    const runtimeSkillMap = new Map<string, AdminSkillRuntimeInfo>(
      runtimeSkillList.map((item: AdminSkillRuntimeInfo) => [item.name, item])
    )
    const configRows = Array.isArray(skillConfigResponse.data?.data) ? skillConfigResponse.data.data as SkillConfigSummaryRow[] : []
    const configMap = new Map(configRows.map((item) => [item.skillId, item]))
    const allSkillIds = Array.from(new Set([
      ...runtimeSkillMap.keys(),
      ...configRows.map((item) => item.skillId)
    ]))
      .filter((skillId) => !isExtraCapabilitySkill(skillId))
      .sort((a, b) => a.localeCompare(b))

    skills.value = allSkillIds.map((skillId) => buildSkillDirectoryRow(skillId, runtimeSkillMap.get(skillId), configMap.get(skillId)))
    summary.value = buildSummary(skills.value)
    void loadPromptSummaries(skills.value)
  } catch (error) {
    console.error('加载 Skill 目录失败:', error)
    toast.error('加载 Skill 目录失败')
  } finally {
    loading.value = false
  }
}

const seedCorePrompts = async () => {
  try {
    const response: any = await adminAgentPromptsApi.seedCorePrompts()
    const created = response.data?.data?.result?.created || []
    const skipped = response.data?.data?.result?.skipped || []
    const parts = []
    if (created.length) parts.push(`已创建 ${created.join('、')}`)
    if (skipped.length) parts.push(`已跳过 ${skipped.join('、')}`)
    toast.success(parts.join('；') || '核心 Prompt 已初始化')
    await loadRegistry()
  } catch (error) {
    console.error('初始化核心 Prompt 失败:', error)
    toast.error('初始化核心 Prompt 失败')
  }
}

const openNode = async (skillId: string) => {
  currentSkillNodeId.value = skillId.replace(/^skill:/, '')
  skillWorkbenchVisible.value = true
}

const openRequestedSkillFromQuery = async () => {
  const rawQueryId = typeof route.query.skillId === 'string'
    ? route.query.skillId.trim()
    : typeof route.query.agentId === 'string'
      ? route.query.agentId.trim()
      : ''
  if (!rawQueryId || !skills.value.length) return

  const normalizedSkillId = rawQueryId.replace(/^skill:/, '')
  if (isExtraCapabilitySkill(normalizedSkillId)) {
    const nextQuery = { ...route.query, skillId: normalizedSkillId }
    delete nextQuery.agentId
    await router.replace({ path: '/admin/skill-model-configs', query: nextQuery })
    return
  }

  const matchedSkill = skills.value.find((item) => item.skillId === normalizedSkillId || item.skillId === rawQueryId)
  if (!matchedSkill) return

  if (currentSkillNodeId.value === matchedSkill.skillId && skillWorkbenchVisible.value) return

  await openNode(matchedSkill.skillId)

  const nextQuery = { ...route.query }
  delete nextQuery.agentId
  delete nextQuery.skillId
  router.replace({ path: route.path, query: nextQuery })
}

const getHealthTagType = (status: SkillHealth) => {
  if (status === 'healthy') return 'success'
  if (status === 'warning') return 'warning'
  if (status === 'error') return 'danger'
  return 'info'
}

const getHealthLabel = (status: SkillHealth) => {
  if (status === 'healthy') return '健康'
  if (status === 'warning') return '预警'
  if (status === 'error') return '异常'
  return '空闲'
}

const formatTime = (time: string | null) => {
  if (!time) return '从未'
  return new Date(time).toLocaleString('zh-CN')
}

const formatDuration = (ms: number | null | undefined) => {
  if (ms === null || ms === undefined) return '-'
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${ms}ms`
}

const rateClass = (rate: number) => {
  if (rate >= 95) return 'rate-good'
  if (rate >= 80) return 'rate-mid'
  return 'rate-bad'
}

onMounted(async () => {
  await loadRegistry()
  await openRequestedSkillFromQuery()
})

watch(
  () => [route.query.agentId, route.query.skillId, skills.value.length] as const,
  async () => {
    await openRequestedSkillFromQuery()
  }
)
</script>

<style scoped>
.skill-directory-page {
  position: relative;
}

.registry-summary-meta {
  margin-top: 8px;
  font-size: 12px;
  color: var(--admin-text-secondary);
}

.skill-filter-panel__summary {
  color: var(--admin-text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.skill-toolbar-note {
  margin: 0;
  font-size: 12px;
  color: var(--admin-text-muted);
}

.search {
  width: 260px;
}

.select {
  width: 150px;
}

.table-link-btn {
  min-height: 30px;
  padding: 0 12px;
  border-radius: 14px;
  font-weight: 700;
  color: var(--color-primary-dark, #1f57cc);
  border: 1px solid rgba(52, 120, 246, 0.16);
  background: rgba(244, 249, 255, 0.96);
}

.table-link-btn:hover {
  transform: translateY(-1px);
}

.admin-list-card {
  width: 100%;
  background: var(--admin-bg-surface);
  border: var(--admin-border-subtle);
  border-radius: var(--admin-radius-md);
  padding: 0;
  position: relative;
  z-index: 1;
  box-shadow: none;
  overflow: hidden;
}

.admin-list-card :deep(.el-table) {
  --el-table-border-color: rgba(52, 120, 246, 0.06);
  background: transparent;
}

.admin-list-card :deep(.el-table th.el-table__cell) {
  background: rgba(52, 120, 246, 0.03);
  font-weight: 700;
  font-size: 0.8125rem;
  color: #7085a6;
}

.admin-list-card :deep(.el-table--striped .el-table__body tr.el-table__row--striped td.el-table__cell) {
  background: rgba(52, 120, 246, 0.015);
}

.admin-list-card :deep(.el-table .el-table__row:hover > td.el-table__cell) {
  background: rgba(52, 120, 246, 0.03);
}

.skill-cell {
  display: grid;
  gap: 4px;
}

.skill-cell__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.skill-cell__name {
  color: #22344d;
}

.skill-cell__id {
  color: #6b7280;
  font-size: 12px;
}

.skill-cell__meta {
  color: #7085a6;
  font-size: 12px;
}

.status-cell {
  display: grid;
  gap: 6px;
}

.status-cell__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.status-cell__label {
  color: #7085a6;
  font-size: 12px;
}

.metrics-cell {
  display: grid;
  gap: 4px;
}

.metrics-cell__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.metrics-cell__row--sub {
  color: #7085a6;
  font-size: 12px;
}

.rate-good {
  color: var(--admin-color-success);
}

.rate-mid {
  color: var(--admin-color-warning);
}

.rate-bad {
  color: var(--admin-color-error);
}

.prompt-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.prompt-cell__version {
  color: #22344d;
  font-weight: 700;
}

.prompt-cell__muted {
  color: #9ca3af;
  font-size: 12px;
}

@media (max-width: 960px) {
  .search,
  .select {
    width: 100%;
  }

  .admin-list-toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .admin-list-toolbar__group {
    justify-content: space-between;
  }
}
</style>
