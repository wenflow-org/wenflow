<template>
  <div class="skill-prompt-preview-page">
    <div class="bg-layer" aria-hidden="true">
      <div class="bg-orb bg-orb--1"></div>
      <div class="bg-orb bg-orb--2"></div>
    </div>

    <div class="page-hero">
      <span class="pill">平台调试</span>
      <h2 class="page-hero__title">
        <el-icon class="title-icon"><MagicStick /></el-icon>
        Skill Prompt 预览
      </h2>
      <p class="page-hero__subtitle">
        统一查看平台 Skill 的当前生效 Prompt、运行配置和单次输出预览，便于日常调试与回归确认。
      </p>
    </div>

    <div class="panel-grid">
      <el-card class="panel-card" shadow="hover" v-loading="pageLoading">
        <template #header>
          <div class="panel-card__header">
            <span>Skill 选择</span>
            <el-button text :icon="Refresh" @click="loadSkills">刷新列表</el-button>
          </div>
        </template>

        <el-form label-position="top" class="config-form">
          <el-form-item label="选择 Skill">
            <el-select
              v-model="selectedSkillId"
              class="field"
              filterable
              clearable
              placeholder="选择要调试的 Skill"
              :loading="pageLoading"
            >
              <el-option
                v-for="item in skills"
                :key="item.skillId"
                :label="item.optionLabel"
                :value="item.skillId"
              />
            </el-select>
          </el-form-item>
        </el-form>

        <template v-if="currentSkill">
          <div class="skill-headline">
            <div>
              <h3>{{ currentSkill.displayName }}</h3>
              <p class="skill-id">{{ currentSkill.skillId }}</p>
            </div>
            <div class="tag-row">
              <el-tag size="small" effect="plain">{{ formatCategory(currentSkill.category) }}</el-tag>
              <el-tag v-if="currentSkill.runtimeConfig?.status" size="small" :type="getStatusTagType(currentSkill.runtimeConfig.status)">
                {{ getStatusLabel(currentSkill.runtimeConfig.status) }}
              </el-tag>
              <el-tag size="small" :type="currentSkill.runtimeConfig?.enabled ? 'success' : 'info'">
                {{ currentSkill.runtimeConfig?.enabled ? '独立配置' : '继承/默认' }}
              </el-tag>
            </div>
          </div>

          <p class="skill-description">{{ currentSkill.description || '当前 Skill 未填写额外说明。' }}</p>

          <div v-if="currentSkill.capabilities.length" class="capability-block">
            <div class="block-label">能力标签</div>
            <div class="tag-row">
              <el-tag v-for="item in currentSkill.capabilities" :key="item" size="small" effect="plain">
                {{ item }}
              </el-tag>
            </div>
          </div>

          <div class="runtime-chip-group">
            <div class="runtime-chip">
              <span class="runtime-chip__label">runtime model</span>
              <strong>{{ currentSkill.runtimeConfig?.model || '继承 Agent / 平台默认' }}</strong>
            </div>
            <div class="runtime-chip">
              <span class="runtime-chip__label">thinking</span>
              <strong>{{ formatThinkingMode(currentSkill.runtimeConfig?.thinkingMode) }}</strong>
            </div>
            <div class="runtime-chip">
              <span class="runtime-chip__label">effort</span>
              <strong>{{ formatReasoningEffort(currentSkill.runtimeConfig?.reasoningEffort) }}</strong>
            </div>
            <div class="runtime-chip">
              <span class="runtime-chip__label">timeout</span>
              <strong>{{ formatTimeout(currentSkill.runtimeConfig?.requestTimeoutMs) }}</strong>
            </div>
          </div>
        </template>

        <el-empty v-else description="当前没有可调试的 Skill。" />
      </el-card>

      <el-card class="panel-card" shadow="hover" v-loading="promptLoading">
        <template #header>
          <div class="panel-card__header">
            <span>当前 Prompt</span>
            <div class="header-actions">
              <el-button text :icon="Refresh" @click="refreshCurrentSkill">刷新</el-button>
              <el-button text :icon="DocumentCopy" :disabled="!promptPreviewText" @click="copyText(promptPreviewText, 'Prompt 已复制')">
                复制 Prompt
              </el-button>
            </div>
          </div>
        </template>

        <template v-if="currentSkill">
          <div class="summary-list">
            <div class="summary-row">
              <span class="summary-row__label">来源</span>
              <el-tag size="small" :type="promptSourceTagType(effectivePromptSource)">
                {{ promptSourceLabel(effectivePromptSource) }}
              </el-tag>
            </div>
            <div class="summary-row">
              <span class="summary-row__label">状态</span>
              <el-tag size="small" :type="getPromptStatusTagType(effectivePrompt?.status)">
                {{ getPromptStatusLabel(effectivePrompt?.status) }}
              </el-tag>
            </div>
            <div class="summary-row">
              <span class="summary-row__label">版本</span>
              <strong>{{ formatPromptVersion(effectivePrompt) }}</strong>
            </div>
            <div class="summary-row">
              <span class="summary-row__label">模型</span>
              <strong>{{ effectivePrompt?.model || '-' }}</strong>
            </div>
            <div class="summary-row">
              <span class="summary-row__label">Prompt 参数</span>
              <strong>T={{ formatOptionalNumber(effectivePrompt?.temperature) }} | Max={{ formatOptionalNumber(effectivePrompt?.maxTokens) }}</strong>
            </div>
            <div class="summary-row">
              <span class="summary-row__label">最近更新时间</span>
              <strong>{{ formatDateTime(effectivePrompt?.publishedAt || effectivePrompt?.updatedAt || effectivePrompt?.createdAt) }}</strong>
            </div>
          </div>

          <el-alert
            v-if="promptDriftWarning"
            class="drift-alert"
            type="warning"
            :closable="false"
            show-icon
            title="DB ACTIVE 与代码默认 Prompt 不一致"
            description="当前运行已切到数据库 ACTIVE Prompt，若这是一次临时试验，记得确认是否需要同步代码内置版本。"
          />

          <el-alert
            v-if="promptError"
            class="drift-alert"
            type="error"
            :closable="false"
            show-icon
            :title="promptError"
          />
        </template>

        <el-empty v-else description="先选择一个 Skill 查看当前 Prompt。" />
      </el-card>
    </div>

    <div v-if="currentSkill" class="summary-grid">
      <el-card class="summary-card summary-card--blue" shadow="hover">
        <div class="label">调用次数</div>
        <div class="value">{{ currentSkill.stats.callCount }}</div>
      </el-card>
      <el-card class="summary-card summary-card--green" shadow="hover">
        <div class="label">成功率</div>
        <div class="value">{{ formatSuccessRate(currentSkill.stats.successRate, currentSkill.stats.callCount) }}</div>
      </el-card>
      <el-card class="summary-card summary-card--orange" shadow="hover">
        <div class="label">平均耗时</div>
        <div class="value">{{ currentSkill.stats.avgLatency }} ms</div>
      </el-card>
      <el-card class="summary-card summary-card--purple" shadow="hover">
        <div class="label">最近调用</div>
        <div class="value value--compact">{{ formatLastCalled(currentSkill.lastCalledAt || currentSkill.stats.lastCalledAt) }}</div>
      </el-card>
    </div>

    <div class="workspace-grid">
      <el-card class="panel-card prompt-card" shadow="hover" v-loading="promptLoading">
        <template #header>
          <div class="panel-card__header">
            <span>System Prompt</span>
            <div class="header-actions">
              <el-button text @click="promptExpanded = !promptExpanded" :disabled="!promptPreviewText">
                {{ promptExpanded ? '收起全文' : '展开全文' }}
              </el-button>
            </div>
          </div>
        </template>

        <template v-if="currentSkill">
          <div class="prompt-meta">
            <el-tag size="small" effect="plain">{{ currentSkill.displayName }}</el-tag>
            <el-tag size="small" effect="plain">{{ currentSkill.skillId }}</el-tag>
            <el-tag v-if="effectivePrompt?.name" size="small" effect="plain">{{ effectivePrompt.name }}</el-tag>
          </div>
          <pre class="code-block code-block--prompt">{{ visiblePromptText }}</pre>
        </template>

        <el-empty v-else description="当前没有可展示的 Prompt 内容。" />
      </el-card>

      <el-card class="panel-card preview-card" shadow="hover">
        <template #header>
          <div class="panel-card__header">
            <span>输出预览</span>
            <div class="header-actions">
              <el-button type="primary" :icon="VideoPlay" :loading="previewLoading" :disabled="!selectedSkillId" @click="runPreview">
                运行预览
              </el-button>
              <el-button :disabled="!sampleInputText.trim()" @click="formatInputJson">格式化 JSON</el-button>
              <el-button :disabled="!sampleInputText.trim()" :icon="DocumentCopy" @click="copyText(sampleInputText, '输入 JSON 已复制')">
                复制输入
              </el-button>
            </div>
          </div>
        </template>

        <div class="editor-block">
          <div class="editor-block__header">
            <strong>Sample Input</strong>
            <span>接口会将这里的 JSON 直接作为 Skill 输入体发送。</span>
          </div>
          <el-input
            v-model="sampleInputText"
            type="textarea"
            :rows="14"
            resize="vertical"
            class="json-editor"
            placeholder="{}"
          />
        </div>

        <div class="preview-result">
          <div class="preview-result__header">
            <div>
              <strong>Sample Output</strong>
              <div class="result-hint">查看本次输出是否符合你预期的 Prompt 行为。</div>
            </div>
            <div class="header-actions">
              <el-button text @click="clearPreviewResult" :disabled="!previewResult && !previewError">清空</el-button>
              <el-button
                text
                :icon="DocumentCopy"
                :disabled="!previewOutputText"
                @click="copyText(previewOutputText, '输出结果已复制')"
              >
                复制输出
              </el-button>
            </div>
          </div>

          <div v-if="previewResult" class="result-meta">
            <el-tag size="small" :type="previewResult.success ? 'success' : 'danger'">
              {{ previewResult.success ? '执行成功' : '执行失败' }}
            </el-tag>
            <el-tag size="small" effect="plain">耗时 {{ previewResult.duration }} ms</el-tag>
            <el-tag size="small" effect="plain">{{ previewResult.cached ? '命中缓存' : '实时执行' }}</el-tag>
            <el-tag v-if="previewRunAt" size="small" effect="plain">{{ formatDateTime(previewRunAt) }}</el-tag>
          </div>

          <el-alert
            v-if="previewError"
            class="preview-alert"
            type="error"
            :closable="false"
            show-icon
            :title="previewError"
          />

          <pre v-if="previewOutputText" class="code-block">{{ previewOutputText }}</pre>
          <el-empty v-else description="点击“运行预览”查看当前 Skill 输出。" />
        </div>
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { DocumentCopy, MagicStick, Refresh, VideoPlay } from '@element-plus/icons-vue'
import { adminSkillsApi } from '@/api/adminApi'
import { toast } from '@/utils/toast'

interface SkillRuntimeStats {
  callCount: number
  successRate: number
  avgLatency: number
  lastCalledAt: string | null
}

interface SkillRuntimeConfig {
  skillId: string
  displayName?: string
  status?: 'working' | 'placeholder' | 'simplified' | 'mock'
  lastCalledAt?: string | null
  tier: string
  model?: string
  thinkingMode?: string
  reasoningEffort?: string
  temperature?: number
  maxTokens?: number
  requestTimeoutMs?: number | null
  enabled: boolean
}

interface SkillOption {
  skillId: string
  displayName: string
  optionLabel: string
  description: string
  category: string
  capabilities: string[]
  version: string
  lastCalledAt: string | null
  registeredAt: string | null
  stats: SkillRuntimeStats
  runtimeConfig: SkillRuntimeConfig | null
}

interface SkillPromptRecord {
  id: string | null
  agentId: string
  version: number | null
  name: string
  description?: string
  systemPrompt: string
  model?: string | null
  temperature?: number | null
  maxTokens?: number | null
  status?: string | null
  publishedAt?: string | null
  updatedAt?: string | null
  createdAt?: string | null
}

interface SkillPreviewResult {
  output: any
  success: boolean
  duration: number
  cached?: boolean
}

const route = useRoute()
const router = useRouter()

const pageLoading = ref(false)
const promptLoading = ref(false)
const previewLoading = ref(false)

const skills = ref<SkillOption[]>([])
const selectedSkillId = ref('')
const effectivePrompt = ref<SkillPromptRecord | null>(null)
const effectivePromptSource = ref<'db-active' | 'code-fallback' | 'generated-default' | ''>('')
const promptDriftWarning = ref(false)
const promptExpanded = ref(false)
const promptError = ref('')

const sampleInputText = ref('{}')
const previewResult = ref<SkillPreviewResult | null>(null)
const previewError = ref('')
const previewRunAt = ref('')

const emptyStats = (): SkillRuntimeStats => ({
  callCount: 0,
  successRate: 1,
  avgLatency: 0,
  lastCalledAt: null
})

const currentSkill = computed(() => skills.value.find((item) => item.skillId === selectedSkillId.value) || null)
const promptPreviewText = computed(() => effectivePrompt.value?.systemPrompt?.trim() || '')
const visiblePromptText = computed(() => {
  const text = promptPreviewText.value
  if (!text) return '暂无 Prompt 内容'
  if (promptExpanded.value) return text
  const lines = text.split('\n')
  return lines.length <= 20 ? text : `${lines.slice(0, 20).join('\n')}\n\n...`
})
const previewOutputText = computed(() => {
  if (!previewResult.value) return ''
  const output = previewResult.value.output
  if (typeof output === 'string') return output
  try {
    return JSON.stringify(output, null, 2)
  } catch {
    return String(output)
  }
})

const categoryLabelMap: Record<string, string> = {
  parsing: '解析类',
  generation: '生成类',
  analysis: '分析类',
  retrieval: '检索类',
  computation: '计算类'
}

const formatCategory = (category?: string) => categoryLabelMap[category || ''] || category || '未分类'
const formatThinkingMode = (value?: string) => value === 'enabled' ? '开启' : value === 'disabled' ? '关闭' : '继承/默认'
const formatReasoningEffort = (value?: string) => value === 'high' ? 'high' : value === 'max' ? 'max' : '继承/默认'
const formatTimeout = (value?: number | null) => !value || Number.isNaN(Number(value)) ? '继承' : `${Math.round(Number(value) / 1000)}s`
const formatOptionalNumber = (value?: number | null) => value === null || value === undefined || Number.isNaN(Number(value)) ? '--' : String(value)

const getStatusLabel = (status?: SkillRuntimeConfig['status']) => (
  status === 'working'
    ? '正常'
    : status === 'placeholder'
      ? '占位'
      : status === 'simplified'
        ? '简化'
        : status === 'mock'
          ? '模拟'
          : '未知'
)

const getStatusTagType = (status?: SkillRuntimeConfig['status']) => (
  status === 'working'
    ? 'success'
    : status === 'placeholder'
      ? 'danger'
      : status === 'simplified'
        ? 'warning'
        : 'info'
)

const promptSourceLabel = (source: 'db-active' | 'code-fallback' | 'generated-default' | '') => (
  source === 'db-active'
    ? 'DB Active'
    : source === 'code-fallback'
      ? 'Code Fallback'
      : source === 'generated-default'
        ? 'Generated Default'
        : 'Unknown'
)

const promptSourceTagType = (source: 'db-active' | 'code-fallback' | 'generated-default' | '') => (
  source === 'db-active'
    ? 'success'
    : source === 'generated-default'
      ? 'warning'
      : 'info'
)

const getPromptStatusLabel = (status?: string | null) => {
  if (!status) return '未知'
  const normalized = status.toUpperCase()
  return {
    ACTIVE: '已生效',
    FALLBACK: '代码内置',
    GENERATED: '生成草案',
    ARCHIVED: '已归档',
    DRAFT: '草稿',
    PUBLISHED: '已发布',
    STAGING: '预发布'
  }[normalized] || '未知'
}

const getPromptStatusTagType = (status?: string | null) => {
  if (!status) return 'info'
  const normalized = status.toUpperCase()
  if (['ACTIVE', 'PUBLISHED'].includes(normalized)) return 'success'
  if (normalized === 'STAGING') return 'warning'
  if (['FALLBACK', 'GENERATED'].includes(normalized)) return 'info'
  return 'info'
}

const formatPromptVersion = (prompt: SkillPromptRecord | null) => (
  prompt?.version === null || prompt?.version === undefined ? '-' : `v${prompt.version}`
)

const formatDateTime = (value?: string | null) => {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('zh-CN')
}

const formatLastCalled = (value?: string | null) => {
  if (!value) return '未调用'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  const diff = Date.now() - date.getTime()
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < hour) return `${Math.max(1, Math.round(diff / minute))} 分钟前`
  if (diff < day) return `${Math.round(diff / hour)} 小时前`
  if (diff < 7 * day) return `${Math.round(diff / day)} 天前`
  return formatDateTime(value)
}

const formatSuccessRate = (rate: number, callCount: number) => {
  if (!callCount) return '暂无'
  return `${(Number(rate || 0) * 100).toFixed(1)}%`
}

const copyText = async (text: string, successMessage: string) => {
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    toast.success(successMessage)
  } catch {
    toast.error('复制失败，请检查浏览器权限')
  }
}

const clearPreviewResult = () => {
  previewResult.value = null
  previewError.value = ''
  previewRunAt.value = ''
}

const formatInputJson = () => {
  try {
    sampleInputText.value = JSON.stringify(JSON.parse(sampleInputText.value), null, 2)
    toast.success('输入 JSON 已格式化')
  } catch (error: any) {
    toast.error(error?.message || '输入 JSON 不合法')
  }
}

const syncSkillQuery = (skillId: string) => {
  const current = typeof route.query.skill === 'string' ? route.query.skill : ''
  if (current === skillId) return
  const nextQuery = { ...route.query } as Record<string, any>
  if (skillId) {
    nextQuery.skill = skillId
  } else {
    delete nextQuery.skill
  }
  void router.replace({ query: nextQuery })
}

const loadCurrentPrompt = async (skillId: string) => {
  promptLoading.value = true
  promptError.value = ''
  const requestSkillId = skillId
  try {
    const response: any = await adminSkillsApi.getEffectiveSkillPrompt(skillId)
    if (selectedSkillId.value !== requestSkillId) return
    effectivePrompt.value = response.data?.data?.prompt || null
    effectivePromptSource.value = response.data?.data?.source || ''
    promptDriftWarning.value = !!response.data?.data?.promptDrift
  } catch (error: any) {
    if (selectedSkillId.value !== requestSkillId) return
    effectivePrompt.value = null
    effectivePromptSource.value = ''
    promptDriftWarning.value = false
    promptError.value = error?.response?.data?.error || error?.message || '加载 Skill Prompt 失败'
    toast.error(promptError.value)
  } finally {
    if (selectedSkillId.value === requestSkillId) {
      promptLoading.value = false
    }
  }
}

const loadSkills = async () => {
  pageLoading.value = true
  try {
    const [skillsResponse, configsResponse] = await Promise.allSettled([
      adminSkillsApi.getSkills(),
      adminSkillsApi.getSkillModelConfigs()
    ])

    if (skillsResponse.status !== 'fulfilled') {
      throw skillsResponse.reason
    }

    const rawSkills = Array.isArray(skillsResponse.value.data?.data) ? skillsResponse.value.data.data : []
    const rawConfigs = configsResponse.status === 'fulfilled' && Array.isArray(configsResponse.value.data?.data)
      ? configsResponse.value.data.data
      : []

    const configMap = new Map(rawConfigs.map((item: any) => [item.skillId, item]))

    skills.value = rawSkills
      .map((item: any) => {
        const runtimeConfig = configMap.get(item.name) || null
        const displayName = runtimeConfig?.displayName || item.name

        return {
          skillId: item.name,
          displayName,
          optionLabel: displayName === item.name ? item.name : `${displayName} · ${item.name}`,
          description: item.description || '',
          category: item.category || '',
          capabilities: Array.isArray(item.capabilities) ? item.capabilities : [],
          version: item.version || '',
          lastCalledAt: item.lastCalledAt || runtimeConfig?.lastCalledAt || null,
          registeredAt: item.registeredAt || null,
          stats: item.stats || emptyStats(),
          runtimeConfig
        } satisfies SkillOption
      })
      .sort((a, b) => a.optionLabel.localeCompare(b.optionLabel, 'zh-CN'))

    const requestedSkillId = typeof route.query.skill === 'string' ? route.query.skill : ''
    const currentStillExists = skills.value.some((item) => item.skillId === selectedSkillId.value)
    const requestedExists = skills.value.some((item) => item.skillId === requestedSkillId)

    if (currentStillExists) {
      return
    }

    selectedSkillId.value = requestedExists
      ? requestedSkillId
      : skills.value[0]?.skillId || ''

    if (!skills.value.length) {
      effectivePrompt.value = null
      effectivePromptSource.value = ''
      promptDriftWarning.value = false
      clearPreviewResult()
    }
  } catch (error) {
    console.error('加载 Skill 列表失败:', error)
    toast.error('加载 Skill 列表失败')
  } finally {
    pageLoading.value = false
  }
}

const refreshCurrentSkill = async () => {
  if (!selectedSkillId.value) return
  await loadCurrentPrompt(selectedSkillId.value)
}

const runPreview = async () => {
  if (!selectedSkillId.value) {
    toast.error('请先选择一个 Skill')
    return
  }

  let parsedInput: any
  try {
    parsedInput = JSON.parse(sampleInputText.value)
  } catch (error: any) {
    toast.error(error?.message || '输入 JSON 不合法')
    return
  }

  previewLoading.value = true
  previewError.value = ''
  try {
    const response: any = await adminSkillsApi.testSkill(selectedSkillId.value, parsedInput)
    previewResult.value = response.data?.data || null
    previewRunAt.value = new Date().toISOString()
    toast.success('Skill 预览完成')
  } catch (error: any) {
    previewResult.value = null
    previewError.value = error?.response?.data?.error || error?.message || 'Skill 预览失败'
    toast.error(previewError.value)
  } finally {
    previewLoading.value = false
  }
}

watch(selectedSkillId, (skillId) => {
  promptExpanded.value = false
  clearPreviewResult()

  if (!skillId) {
    effectivePrompt.value = null
    effectivePromptSource.value = ''
    promptDriftWarning.value = false
    promptError.value = ''
    syncSkillQuery('')
    return
  }

  syncSkillQuery(skillId)
  void loadCurrentPrompt(skillId)
})

onMounted(() => {
  void loadSkills()
})
</script>

<style scoped>
.skill-prompt-preview-page {
  position: relative;
  min-height: 100%;
}

.bg-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}

.bg-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(110px);
  opacity: 0.16;
}

.bg-orb--1 {
  width: 460px;
  height: 460px;
  top: -180px;
  right: -120px;
  background: radial-gradient(circle, rgba(52, 120, 246, 0.3), transparent 70%);
  animation: orb-d 26s ease-in-out infinite;
}

.bg-orb--2 {
  width: 380px;
  height: 380px;
  left: -100px;
  top: 240px;
  background: radial-gradient(circle, rgba(141, 107, 255, 0.22), transparent 70%);
  animation: orb-d 30s ease-in-out infinite reverse;
}

@keyframes orb-d {
  0%,
  100% {
    transform: translate(0, 0) scale(1);
  }

  33% {
    transform: translate(30px, -20px) scale(1.05);
  }

  66% {
    transform: translate(-20px, 30px) scale(0.95);
  }
}

.page-hero,
.panel-grid,
.summary-grid,
.workspace-grid {
  position: relative;
  z-index: 1;
}

.page-hero {
  margin-bottom: 1.5rem;
  padding: 24px 28px;
  border-radius: 20px;
  border: 1px solid rgba(52, 120, 246, 0.08);
  background: radial-gradient(circle at top right, rgba(52, 120, 246, 0.06), transparent 38%), linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(244, 247, 252, 0.92));
  backdrop-filter: blur(16px);
}

.pill {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  min-height: 26px;
  padding: 0 12px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-primary) 10%, white);
  color: var(--color-primary-dark, #1f57cc);
  font-size: 12px;
  font-weight: 700;
}

.page-hero__title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0 0;
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.03em;
}

.page-hero__subtitle {
  margin: 8px 0 0;
  color: var(--text-secondary);
  font-size: 0.9375rem;
  line-height: 1.7;
  max-width: 780px;
}

.title-icon {
  color: var(--color-primary);
}

.panel-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.08fr) minmax(320px, 0.92fr);
  gap: 20px;
  margin-bottom: 20px;
}

.workspace-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(340px, 0.95fr);
  gap: 20px;
}

.panel-card {
  border-radius: 24px;
}

.panel-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-weight: 700;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.config-form :deep(.el-select),
.field,
.json-editor :deep(.el-textarea__inner) {
  width: 100%;
}

.skill-headline {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-top: 8px;
}

.skill-headline h3 {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 800;
  color: var(--text-primary);
}

.skill-id {
  margin: 6px 0 0;
  color: var(--text-muted);
  font-size: 12px;
}

.skill-description {
  margin: 14px 0 0;
  color: var(--text-secondary);
  line-height: 1.7;
}

.capability-block {
  margin-top: 16px;
}

.block-label {
  margin-bottom: 8px;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.runtime-chip-group {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 18px;
}

.runtime-chip {
  display: grid;
  gap: 6px;
  padding: 14px 16px;
  border-radius: 16px;
  border: 1px solid var(--border-default);
  background: color-mix(in srgb, var(--bg-surface) 92%, white);
}

.runtime-chip__label {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.runtime-chip strong {
  color: var(--text-primary);
  font-size: 14px;
  line-height: 1.5;
}

.summary-list {
  display: grid;
  gap: 12px;
}

.summary-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid var(--border-default);
  background: color-mix(in srgb, var(--bg-surface) 92%, white);
}

.summary-row__label {
  color: var(--text-secondary);
  font-size: 13px;
}

.summary-row strong {
  color: var(--text-primary);
  font-size: 13px;
  text-align: right;
  word-break: break-word;
}

.drift-alert {
  margin-top: 16px;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 20px;
}

.summary-card .label {
  color: var(--text-secondary);
  font-size: 13px;
}

.summary-card .value {
  margin-top: 8px;
  font-size: 28px;
  font-weight: 800;
  color: var(--text-primary);
}

.summary-card .value--compact {
  font-size: 20px;
}

.summary-card--blue {
  border-color: color-mix(in srgb, #60a5fa 18%, var(--border-default));
}

.summary-card--green {
  border-color: color-mix(in srgb, #34d399 18%, var(--border-default));
}

.summary-card--orange {
  border-color: color-mix(in srgb, #f59e0b 18%, var(--border-default));
}

.summary-card--purple {
  border-color: color-mix(in srgb, #8b5cf6 18%, var(--border-default));
}

.prompt-card,
.preview-card {
  min-height: 560px;
}

.prompt-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.code-block {
  margin: 0;
  padding: 16px;
  border-radius: 18px;
  background: #0f172a;
  color: #dbeafe;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  line-height: 1.7;
  min-height: 220px;
}

.code-block--prompt {
  min-height: 520px;
}

.editor-block {
  display: grid;
  gap: 10px;
}

.editor-block__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--text-secondary);
  font-size: 12px;
  flex-wrap: wrap;
}

.json-editor :deep(.el-textarea__inner) {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 13px;
  line-height: 1.6;
  border-radius: 18px;
  background: rgba(52, 120, 246, 0.03);
}

.preview-result {
  display: grid;
  gap: 12px;
  margin-top: 18px;
}

.preview-result__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.preview-result__header strong {
  color: var(--text-primary);
}

.result-hint {
  margin-top: 4px;
  color: var(--text-secondary);
  font-size: 12px;
}

.result-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.preview-alert {
  margin-bottom: 2px;
}

.tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

@media (max-width: 1200px) {
  .panel-grid,
  .workspace-grid,
  .summary-grid {
    grid-template-columns: 1fr;
  }

  .code-block--prompt {
    min-height: 320px;
  }
}

@media (max-width: 720px) {
  .page-hero {
    padding: 20px;
  }

  .skill-headline,
  .preview-result__header,
  .panel-card__header,
  .editor-block__header {
    flex-direction: column;
    align-items: flex-start;
  }

  .runtime-chip-group {
    grid-template-columns: 1fr;
  }

  .summary-row {
    flex-direction: column;
    align-items: flex-start;
  }

  .summary-row strong {
    text-align: left;
  }
}
</style>
