<template>
  <el-drawer
    v-model="localVisible"
    :title="`Skill 概况 · ${skillDisplayName}`"
    size="min(calc(100vw - 24px), 760px)"
    destroy-on-close
    class="skill-quickview-drawer"
  >
    <div class="skill-quickview" v-loading="loading">
      <template v-if="meta">
        <header class="quickview-head">
          <div class="quickview-head__copy">
            <p v-if="meta.skill.description">{{ meta.skill.description }}</p>
          </div>
          <div class="quickview-head__meta">
            <el-tag size="small" :type="healthTagType">{{ healthLabel }}</el-tag>
            <el-tag size="small" effect="plain">{{ meta.parentAgent?.name || '无上层 Agent' }}</el-tag>
            <el-tag size="small" effect="plain">{{ callSummary }}</el-tag>
          </div>
        </header>

        <section class="quickview-section">
          <div class="quickview-summary-strip">
            <div class="quickview-summary-cell">
              <span class="quickview-summary-cell__label">当前版本</span>
              <strong>{{ activePromptVersion }}</strong>
              <p>{{ activePromptStatusLabel }}</p>
            </div>
            <div class="quickview-summary-cell">
              <span class="quickview-summary-cell__label">Prompt 草稿</span>
              <strong>{{ draftCountLabel }}</strong>
              <p>{{ versionSummaryLabel }}</p>
            </div>
            <div class="quickview-summary-cell">
              <span class="quickview-summary-cell__label">运行策略</span>
              <strong>{{ runtimeModeLabel }}</strong>
              <p>{{ runtimeSourceLabel }}</p>
            </div>
          </div>
        </section>

        <section class="quickview-section">
          <div class="quickview-section__head">
            <h3>最终执行值</h3>
          </div>

          <dl class="quickview-spec-list">
            <div class="quickview-spec-row">
              <dt>模型</dt>
              <dd>{{ meta.modelConfig?.model || '平台默认' }}</dd>
            </div>
            <div class="quickview-spec-row">
              <dt>thinking</dt>
              <dd>{{ formatThinkingMode(meta.modelConfig?.thinkingMode) }}</dd>
            </div>
            <div class="quickview-spec-row">
              <dt>reasoning</dt>
              <dd>{{ formatReasoningEffort(meta.modelConfig?.reasoningEffort) }}</dd>
            </div>
            <div class="quickview-spec-row">
              <dt>温度</dt>
              <dd>{{ formatNumber(meta.modelConfig?.temperature) }}</dd>
            </div>
            <div class="quickview-spec-row">
              <dt>Max Tokens</dt>
              <dd>{{ formatMaxTokens(meta.modelConfig?.maxTokens) }}</dd>
            </div>
            <div class="quickview-spec-row">
              <dt>超时</dt>
              <dd>{{ formatTimeout(meta.modelConfig?.timeoutMs) }}</dd>
            </div>
          </dl>
        </section>

        <section v-if="activePrompt?.name || activePrompt?.model || activePrompt?.temperature != null || activePrompt?.maxTokens != null" class="quickview-section">
          <div class="quickview-section__head">
            <h3>版本参数</h3>
          </div>

          <div class="quickview-version-list">
            <div v-if="activePrompt.name" class="quickview-version-row quickview-version-row--muted">
              <span class="quickview-version-row__label">名称</span>
              <strong>{{ activePrompt.name }}</strong>
            </div>
            <div v-if="activePrompt.model || activePrompt.temperature != null || activePrompt.maxTokens != null" class="quickview-version-row quickview-version-row--muted">
              <span class="quickview-version-row__label">版本附带参数</span>
              <strong>{{ versionParamsLabel }}</strong>
            </div>
          </div>
        </section>

        <section class="quickview-section quickview-section--actions">
          <div class="quickview-section__head">
            <h3>下一步</h3>
          </div>

          <div class="quickview-actions">
            <el-button type="primary" @click="openSkillEditor">进入 Prompt 检视</el-button>
            <el-button @click="openSkillEditor('runtime')">进入运行策略</el-button>
            <el-button @click="openPromptLogs">查看 Prompt 日志</el-button>
            <el-button @click="openExecutionLogs">查看执行日志</el-button>
          </div>
        </section>
      </template>

      <el-empty v-else-if="!loading" description="未找到 Skill 概况" :image-size="64" />
    </div>
  </el-drawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { adminSkillWorkbenchApi } from '@/api/adminApi'
import { toast } from '@/utils/toast'

type WorkbenchMeta = {
  skill: {
    id: string
    name: string
    description?: string
  }
  parentAgent?: {
    id: string
    name: string
  } | null
  modelConfig?: {
    enabled?: boolean
    tier?: string
    model?: string | null
    thinkingMode?: 'default' | 'enabled' | 'disabled'
    reasoningEffort?: 'default' | 'high' | 'max'
    temperature?: number | null
    maxTokens?: number | null
    timeoutMs?: number | null
    source?: string
    inheritedFromAgent?: boolean
    hasSkillOverride?: boolean
  } | null
  promptVersions?: Array<{
    id: string
    version: number | null
    name?: string | null
    status?: string | null
    temperature?: number | null
    maxTokens?: number | null
    model?: string | null
    isActive?: boolean
  }>
  activePromptId?: string | null
  stats?: {
    totalCalls?: number
    successRate?: number | null
    avgDuration?: number
    lastCalledAt?: string | null
  }
}

const props = defineProps<{ visible: boolean; skillId: string }>()
const emit = defineEmits<{ 'update:visible': [value: boolean] }>()

const router = useRouter()
const localVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit('update:visible', value)
})

const loading = ref(false)
const meta = ref<WorkbenchMeta | null>(null)

const skillDisplayName = computed(() => meta.value?.skill?.name || props.skillId)
const promptVersions = computed(() => meta.value?.promptVersions || [])
const activePrompt = computed(() => promptVersions.value.find((item) => item.isActive) || null)
const draftCount = computed(() => promptVersions.value.filter((item) => (item.status || '').toUpperCase() === 'DRAFT').length)

const healthLabel = computed(() => {
  const rate = Number(meta.value?.stats?.successRate ?? 100)
  const calls = Number(meta.value?.stats?.totalCalls ?? 0)
  if (!calls) return '未调用'
  if (rate >= 95) return '健康'
  if (rate >= 80) return '需关注'
  return '异常'
})

const healthTagType = computed(() => {
  if (healthLabel.value === '健康') return 'success'
  if (healthLabel.value === '需关注') return 'warning'
  if (healthLabel.value === '异常') return 'danger'
  return 'info'
})

const callSummary = computed(() => {
  const total = Number(meta.value?.stats?.totalCalls ?? 0)
  const rate = meta.value?.stats?.successRate
  if (!total) return '尚无调用'
  return `${total} 次调用 · ${rate ?? '--'}% 成功率`
})

const activePromptVersion = computed(() => {
  if (!activePrompt.value) return '未配置'
  return activePrompt.value.version != null ? `v${activePrompt.value.version}` : '代码内置'
})

const activePromptStatusLabel = computed(() => {
  const status = (activePrompt.value?.status || '').toUpperCase()
  if (status === 'ACTIVE') return '已生效'
  if (status === 'FALLBACK' || status === 'BUILT_IN') return '代码内置'
  if (status === 'DRAFT') return '草稿'
  if (status === 'ARCHIVED') return '已归档'
  return activePrompt.value ? '已记录' : '未配置'
})

const draftCountLabel = computed(() => (draftCount.value ? `${draftCount.value} 个草稿` : '无草稿'))
const versionSummaryLabel = computed(() => (promptVersions.value.length ? `${promptVersions.value.length} 个版本` : '未建立版本'))

const runtimeModeLabel = computed(() => (meta.value?.modelConfig?.enabled ? '独立覆盖' : '继承执行'))

const runtimeSourceLabel = computed(() => {
  const config = meta.value?.modelConfig
  if (!config) return '平台默认'
  if (config.hasSkillOverride) return '当前值来自 Skill 覆盖'
  if (config.inheritedFromAgent) return '当前值继承自上层 Agent / 平台'
  return '当前值来自平台默认'
})

const versionParamsLabel = computed(() => {
  if (!activePrompt.value) return '--'
  const parts = []
  if (activePrompt.value.model) parts.push(activePrompt.value.model)
  if (activePrompt.value.temperature != null) parts.push(`T=${activePrompt.value.temperature}`)
  if (activePrompt.value.maxTokens != null) parts.push(`Max=${activePrompt.value.maxTokens}`)
  return parts.join(' | ') || '--'
})

const formatThinkingMode = (value?: string | null) => {
  if (value === 'enabled') return '开启'
  if (value === 'disabled') return '关闭'
  return '继承/默认'
}

const formatReasoningEffort = (value?: string | null) => {
  if (value === 'high') return 'high'
  if (value === 'max') return 'max'
  return '继承/默认'
}

const formatTimeout = (value?: number | null) => {
  if (!value) return '继承'
  return `${Math.round(Number(value) / 1000)}s`
}

const formatMaxTokens = (value?: number | null) => {
  if (value == null) return '--'
  return String(value)
}

const formatNumber = (value?: number | null) => {
  if (value == null) return '--'
  return `${value}`
}

const loadMeta = async () => {
  if (!props.visible || !props.skillId) return
  // 切换 skillId 重载前先清空，避免短暂展示上一个 Skill 的旧数据
  meta.value = null
  loading.value = true
  try {
    const response = await adminSkillWorkbenchApi.getMeta(props.skillId)
    meta.value = response.data?.data || null
  } catch (error: any) {
    meta.value = null
    toast.error(error?.response?.data?.error?.message || '加载 Skill 概况失败')
  } finally {
    loading.value = false
  }
}

const openSkillEditor = (tab?: 'runtime') => {
  localVisible.value = false
  const cleanId = props.skillId.replace(/^skill:/, '')
  router.push({ path: `/admin/skills/${cleanId}`, query: tab ? { tab } : undefined })
}

const openPromptLogs = () => {
  localVisible.value = false
  router.push({ path: '/admin/prompt-call-logs', query: { agentId: `skill:${props.skillId.replace(/^skill:/, '')}` } })
}

const openExecutionLogs = () => {
  localVisible.value = false
  router.push({ path: '/admin/execution-logs', query: { agentName: `skill:${props.skillId.replace(/^skill:/, '')}` } })
}

watch(() => props.visible, (visible) => {
  if (visible) void loadMeta()
})

watch(() => props.skillId, (value) => {
  if (value && props.visible) void loadMeta()
})
</script>

<style scoped>
:deep(.skill-quickview-drawer .el-drawer__header) {
  margin-bottom: 0;
  padding: 22px 24px 16px;
  border-bottom: 1px solid rgba(223, 231, 243, 0.92);
}

:deep(.skill-quickview-drawer .el-drawer__title) {
  color: #22344d;
  font-size: var(--admin-text-title-sm);
  font-weight: 700;
}

:deep(.skill-quickview-drawer .el-drawer__body) {
  padding: 0 24px 24px;
  background: linear-gradient(180deg, #fbfcff 0%, #ffffff 100%);
}

:deep(.skill-quickview) {
  display: grid;
  gap: 0;
  min-height: 260px;
}

:deep(.quickview-head) {
  display: grid;
  gap: 14px;
  padding: 22px 0 18px;
  border-bottom: 1px solid rgba(223, 231, 243, 0.92);
}

:deep(.quickview-eyebrow),
:deep(.quickview-summary-cell__label),
:deep(.quickview-spec-row dt),
:deep(.quickview-version-row__label) {
  font-size: 12px;
  color: #7b8ba3;
  font-weight: 700;
}

:deep(.quickview-head h2),
:deep(.quickview-summary-cell strong),
:deep(.quickview-spec-row dd),
:deep(.quickview-version-row strong) {
  color: #22344d;
}

:deep(.quickview-head h2) {
  margin: 0;
  font-size: 1.5rem;
  line-height: 1.2;
}

:deep(.quickview-head p),
:deep(.quickview-summary-cell p),
:deep(.quickview-section__head span) {
  margin: 0;
  color: var(--admin-text-muted);
  line-height: 1.6;
  font-size: 0.875rem;
}

:deep(.quickview-head__copy) {
  display: grid;
  gap: 6px;
}

:deep(.quickview-head__meta) {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

:deep(.quickview-section) {
  display: grid;
  gap: 14px;
  padding: 18px 0;
  border-bottom: 1px solid rgba(223, 231, 243, 0.92);
}

:deep(.quickview-section--actions) {
  border-bottom: none;
  padding-bottom: 0;
}

:deep(.quickview-section__head) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

:deep(.quickview-section__head h3) {
  margin: 0;
  color: #22344d;
  font-size: 1rem;
}

:deep(.quickview-summary-strip) {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0;
  border: 1px solid rgba(223, 231, 243, 0.92);
  border-radius: 18px;
  overflow: hidden;
  background: rgba(248, 250, 255, 0.88);
}

:deep(.quickview-summary-cell) {
  display: grid;
  gap: 6px;
  padding: 16px 18px;
}

:deep(.quickview-summary-cell + .quickview-summary-cell) {
  border-left: 1px solid rgba(223, 231, 243, 0.92);
}

:deep(.quickview-summary-cell strong),
:deep(.quickview-version-row strong) {
  font-size: var(--admin-text-title-sm);
  line-height: 1.35;
  word-break: break-word;
}

:deep(.quickview-spec-list) {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0;
  margin: 0;
  border-top: 1px solid rgba(223, 231, 243, 0.92);
}

:deep(.quickview-spec-row) {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  margin: 0;
  padding: 14px 6px;
  border-bottom: 1px solid rgba(223, 231, 243, 0.92);
}

:deep(.quickview-spec-row dt),
:deep(.quickview-spec-row dd) {
  margin: 0;
}

:deep(.quickview-spec-row dd) {
  text-align: right;
  font-size: var(--admin-text-title-sm);
  font-weight: 600;
}

:deep(.quickview-version-list) {
  display: grid;
  gap: 0;
  border-top: 1px solid rgba(223, 231, 243, 0.92);
}

:deep(.quickview-version-row) {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  padding: 14px 6px;
  border-bottom: 1px solid rgba(223, 231, 243, 0.92);
}

:deep(.quickview-actions) {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

@media (max-width: 960px) {
  :deep(.quickview-summary-strip),
  :deep(.quickview-spec-list) {
    grid-template-columns: 1fr;
  }

  :deep(.quickview-summary-cell + .quickview-summary-cell) {
    border-left: none;
    border-top: 1px solid rgba(223, 231, 243, 0.92);
  }

  :deep(.quickview-version-row) {
    grid-template-columns: 1fr;
  }

  :deep(.quickview-spec-row) {
    padding-left: 0;
    padding-right: 0;
  }

  :deep(.skill-quickview-drawer .el-drawer__body) {
    padding: 0 16px 20px;
  }

  :deep(.quickview-actions) {
    display: grid;
    grid-template-columns: 1fr;
  }

  :deep(.quickview-actions .el-button) {
    width: 100%;
    margin-left: 0;
  }
}
</style>
