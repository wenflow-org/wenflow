<template>
  <!--
    归属说明（2026-08 admin 管理面审计 A6.4）：
    本组件原位于旧版 admin 目录，2026-09 三代目录清理已迁入 admin-redesign（审计 #6 整改）；
    被 admin-redesign 的 VirtualProfile.vue（画像页「账号自动学习」）唯一复用，非废弃残留。
    依赖：后端 virtual-quick-learn.ts 6 端点 + quick-learn.service.ts。
    2026-09 已从 Element Plus 组件重写为 mk-* 原语：admin-theme.css 的 `body.admin-route .el-*`
    覆写块与 `--el-*` 变量不再被本组件消费（EP 只剩下 ElLoading/ElMessage 这类服务）。
  -->
  <Teleport to="body">
    <div v-if="visible" class="mk-modal">
      <div class="mk-modal__panel mk-modal__panel--wide" role="dialog" aria-label="账号自动学习">
        <div class="mk-modal__head">
          <h3 class="mk-modal__title">账号自动学习</h3>
          <button type="button" class="mk-modal__close" aria-label="关闭" @click="close">✕</button>
        </div>
        <div class="mk-modal__body">
    <div class="quick-learn">
      <div class="mk-alert mk-alert--info" role="status">
        以该虚拟学习者绑定的平台账号完成真实 Learn 流程；路径、课堂、任务完成和学习状态都会写回这个账号。
      </div>

      <div class="ql-account-brief" aria-label="自动学习边界">
        <div class="ql-account-brief__item">
          <span>身份</span>
          <strong>虚拟学习者账号</strong>
        </div>
        <div class="ql-account-brief__item">
          <span>链路</span>
          <strong>真实 Teaching Session</strong>
        </div>
        <div class="ql-account-brief__item">
          <span>验收</span>
          <strong>前台投影视角</strong>
        </div>
      </div>

      <!-- 任务选择 -->
      <section v-if="!currentRun" class="ql-section">
        <div class="ql-section__head">
          <span class="ql-section__title">选择该账号要学习的任务</span>
          <button type="button" class="mk-link" :disabled="tasksLoading" @click="loadTasks">
            {{ tasksLoading ? '刷新中…' : '刷新' }}
          </button>
        </div>
        <p class="ql-section__hint">只列出这个虚拟账号名下的路径和任务；需要复用别人的路径时，先复制到该账号名下。</p>
        <!-- 原生 select：EP 的 filterable 无法一对一映射（原生下拉不支持搜索），列表按路径分组后规模可控 -->
        <select v-model="selectedTaskId" class="mk-field__select ql-task-select">
          <option value="" disabled>选择该虚拟账号名下的任务</option>
          <optgroup v-for="path in taskTree" :key="path.pathId" :label="path.title">
            <option
              v-for="option in flattenTasks(path)"
              :key="option.taskId"
              :value="option.taskId"
              :disabled="!option.learnable"
            >
              {{ option.label }}{{ option.learnable ? '' : '（不可学）' }}
            </option>
          </optgroup>
        </select>
        <div class="ql-run-config">
          <span class="ql-label">本节课最多</span>
          <input v-model.number="maxTurns" type="number" min="1" max="40" class="mk-field__input ql-num" />
          <span class="ql-label">故事</span>
          <select v-model="selectedStoryId" class="mk-field__select ql-story-select">
            <option value="">单课故事（可选）</option>
            <option v-for="s in storyOptions" :key="s.id" :value="s.id">{{ s.title }}</option>
          </select>
          <span class="ql-label">摩擦</span>
          <select v-model="frictionBudget" class="mk-field__select ql-friction-select">
            <option value="none">无（合作）</option>
            <option value="low">低</option>
            <option value="normal">正常</option>
            <option value="high">高</option>
            <option value="stress_test">压力测试</option>
          </select>
          <button
            type="button"
            class="mk-btn mk-btn--primary"
            :disabled="!selectedTaskId || starting"
            @click="startRun"
          >
            {{ starting ? '开始中…' : '让账号开始学习' }}
          </button>
        </div>
        <p class="ql-section__hint">故事可选：选中后单课会带有故事情境（非空时学习者有背景）；摩擦控制本课行为弧线（none=纯合作，normal=真实人物常态）。</p>

        <details class="ql-fixture">
          <summary class="mk-section__summary">没有可学任务？把已有路径复制到该虚拟账号</summary>
          <div class="ql-fixture__body">
            <input
              v-model="fixtureSourcePathId"
              class="mk-field__input"
              placeholder="源学习路径 ID（复制后成为该账号自己的路径）"
            />
            <button
              type="button"
              class="mk-btn mk-btn--sm"
              :disabled="!fixtureSourcePathId.trim() || cloning"
              @click="cloneFixture"
            >
              {{ cloning ? '复制中…' : '复制到该账号' }}
            </button>
          </div>
        </details>

        <!-- 历史运行 -->
        <div v-if="historyRuns.length" class="ql-history">
          <div class="ql-section__title">最近自动学习</div>
          <div v-for="run in historyRuns" :key="run.runId" class="ql-history-item" @click="loadRun(run.runId)">
            <span class="mk-badge" :class="statusBadgeTone(run.status)">{{ statusLabel(run.status) }}</span>
            <span class="ql-history-item__meta">{{ run.turns }} 轮 · {{ formatTime(run.createdAt) }}</span>
            <span class="ql-history-item__open">打开 →</span>
          </div>
        </div>
      </section>

      <!-- 运行状态与结果入口 -->
      <section v-else class="ql-section">
        <div class="ql-status" :class="`ql-status--${currentRun.status}`">
          <template v-if="running">
            <div class="ql-status__main">
              <MkLoading inline text="" />
              <div>
                <div class="ql-status__title">虚拟账号正在上这节课</div>
                <div class="ql-status__desc">真实 Teaching Session 正在生成课堂记录；完成后直接进入前台视角验收。</div>
              </div>
            </div>
            <button type="button" class="mk-btn mk-btn--danger-ghost mk-btn--sm" @click="abortRun">中止</button>
          </template>
          <template v-else>
            <div class="ql-status__main">
              <div>
                <div class="ql-status__title">
                  {{ resultTitle }}
                  <span class="mk-badge" :class="statusBadgeTone(currentRun.status)">{{ statusLabel(currentRun.status) }}</span>
                </div>
                <div class="ql-status__desc">{{ resultDesc }}</div>
                <div v-if="currentRun.error" class="ql-status__error">{{ currentRun.error }}</div>
                <div class="ql-status__tech">
                  <span :class="techClass(lifecycle?.sessionClosed)">课堂闭合</span>
                  <span :class="techClass(lifecycle?.wrapupGenerated)">评价已留存</span>
                  <span :class="techClass(lifecycle?.taskCompleted)">任务完成</span>
                  <span :class="techClass(lifecycle?.outboxConsumerDone)">学习者数据已处理</span>
                </div>
              </div>
            </div>
          </template>
        </div>

        <template v-if="!running">
          <div class="ql-entries">
            <div class="ql-section__title">平台账号验收入口</div>
            <p class="ql-entries__hint">下面打开的都是普通前台页面，只是通过投影 token 切到这个虚拟学习者账号。</p>
            <div class="ql-entries__actions">
              <button
                type="button"
                class="mk-btn mk-btn--primary"
                :disabled="openingFrontend"
                @click="openFrontend('path')"
              >
                学习路径
              </button>
              <button
                type="button"
                class="mk-btn"
                :disabled="!currentRun.teachingSessionId || openingFrontend"
                @click="openFrontend('evaluation')"
              >
                课程结果
              </button>
              <button type="button" class="mk-btn" :disabled="openingFrontend" @click="openFrontend('task')">
                本节课 Learn
              </button>
              <button type="button" class="mk-btn" :disabled="openingFrontend" @click="openFrontend('learning-state')">
                学习状态
              </button>
              <button
                v-if="report?.downstream?.nextTask"
                type="button"
                class="mk-btn"
                :disabled="openingFrontend"
                @click="openFrontend('next-task')"
              >
                下一任务
              </button>
              <button type="button" class="mk-btn mk-btn--ghost" :disabled="openingFrontend" @click="openFrontend('dashboard')">
                学习首页
              </button>
            </div>
          </div>

          <details v-if="report" class="ql-tech-detail">
            <summary class="mk-section__summary">传播报告（开发者）</summary>
            <div class="ql-delta__row">
              <span class="ql-label">指标变化</span>
              <span v-if="report.learnerDelta.metrics.changed.length === 0">无变化</span>
              <span v-for="field in report.learnerDelta.metrics.changed" :key="field" class="ql-chip">
                {{ field }}: {{ formatMetric(report.learnerDelta.metrics.before[field]) }} →
                {{ formatMetric(report.learnerDelta.metrics.after[field]) }}
              </span>
            </div>
            <div class="ql-delta__row">
              <span class="ql-label">新掌握</span>
              <span v-if="!report.learnerDelta.knowledge.newMastered.length">无</span>
              <span
                v-for="item in report.learnerDelta.knowledge.newMastered"
                :key="item"
                class="mk-badge mk-badge--ok ql-tag"
              >
                {{ item }}
              </span>
            </div>
            <div class="ql-delta__row">
              <span class="ql-label">新混淆</span>
              <span v-if="!report.learnerDelta.knowledge.newRecurringConfusions.length">无</span>
              <span
                v-for="item in report.learnerDelta.knowledge.newRecurringConfusions"
                :key="item"
                class="mk-badge mk-badge--warn ql-tag"
              >
                {{ item }}
              </span>
            </div>
            <div class="ql-delta__row">
              <span class="ql-label">路径调整</span>
              <span>{{ report.downstream.replan.signalChanged ? '信号已变化' : '信号无变化' }}</span>
              <span v-if="report.downstream.replan.after?.shouldSuggest" class="ql-chip ql-chip--warn">
                建议调整（{{ report.downstream.replan.after.priority }}）
              </span>
            </div>
            <div v-if="report.lifecycle.warnings?.length" class="ql-warnings">
              <div v-for="(warning, index) in report.lifecycle.warnings" :key="index">⚠ {{ warning }}</div>
            </div>
          </details>

          <div class="ql-actions">
            <button type="button" class="mk-link" @click="resetRun">再学一课</button>
            <button type="button" class="mk-link" @click="close">关闭</button>
          </div>
        </template>
      </section>
    </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { toast } from '@/utils/toast'
import { askConfirm } from './useConfirm'
import { adminApi } from '@/api/adminApi'
import { setProjectionToken } from '@/utils/projection'
import { useSafePolling } from '@/composables/useSafePolling'
import MkLoading from '@/components/mk/MkLoading.vue'
import { statusText } from './statusText'
import { useEscape } from './useEscape'

const props = defineProps<{
  visible: boolean
  profileId: string
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
}>()

type QuickLearnStatus = 'queued' | 'running' | 'completed' | 'failed' | 'aborted' | 'interrupted' | string

interface QuickLearnTask {
  taskId: string
  title: string
  status: string
  learnable: boolean
}

interface QuickLearnMilestone {
  stageNumber: number | string
  tasks: QuickLearnTask[]
}

interface QuickLearnPath {
  pathId: string
  title: string
  milestones: QuickLearnMilestone[]
}

interface QuickLearnLifecycle {
  sessionClosed?: boolean
  wrapupGenerated?: boolean
  taskCompleted?: boolean
  outboxConsumerDone?: boolean
  warnings?: string[]
}

interface QuickLearnReport {
  lifecycle: QuickLearnLifecycle
  learnerDelta: {
    metrics: {
      changed: string[]
      before: Record<string, number | null>
      after: Record<string, number | null>
    }
    knowledge: {
      newMastered: string[]
      newRecurringConfusions: string[]
    }
  }
  downstream: {
    nextTask: { taskId: string; title?: string } | null
    replan: {
      signalChanged: boolean
      after?: { shouldSuggest?: boolean; priority?: string | null } | null
    }
  }
}

interface QuickLearnRun {
  runId: string
  pathId: string
  taskId: string
  status: QuickLearnStatus
  turns: number
  teachingSessionId?: string | null
  error?: string | null
  createdAt?: string | null
  report?: QuickLearnReport | null
}

interface ApiErrorLike {
  response?: { data?: { error?: string }; status?: number }
  message?: string
}

const tasksLoading = ref(false)
const taskTree = ref<QuickLearnPath[]>([])
const selectedTaskId = ref('')
const maxTurns = ref(25)
const selectedStoryId = ref('')
const frictionBudget = ref('none')
const storyOptions = ref<Array<{ id: string; title: string }>>([])
const starting = ref(false)
const cloning = ref(false)
const openingFrontend = ref(false)
const fixtureSourcePathId = ref('')
const currentRun = ref<QuickLearnRun | null>(null)
const historyRuns = ref<QuickLearnRun[]>([])
const pollingRunId = ref<string | null>(null)
const { start: startPolling, stop: stopPolling } = useSafePolling(
  async () => {
    const id = pollingRunId.value
    if (!id) {
      stopPolling()
      return
    }
    await loadRun(id)
  },
  {
    interval: 2000,
    maxBackoff: 8000,
    circuitBreakerThreshold: 10,
    skipWhenHidden: false,
  }
)

const running = computed(() => currentRun.value && isActiveStatus(currentRun.value.status))
const report = computed(() => currentRun.value?.report || null)
const lifecycle = computed(() => report.value?.lifecycle || null)

const resultTitle = computed(() => {
  if (!currentRun.value) return ''
  if (currentRun.value.status === 'completed') return '这节课已写入该账号'
  if (currentRun.value.status === 'aborted') return '本次运行已中止'
  return '本次运行未达成完成条件'
})

const resultDesc = computed(() => {
  if (!currentRun.value) return ''
  if (currentRun.value.status === 'completed') {
    return '现在可以打开普通前台页面，看这个虚拟账号的路径、课堂结果和学习状态。'
  }
  if (currentRun.value.status === 'aborted') return '已停止继续驱动该账号学习，已产生的课堂记录仍保留在平台。'
  return '系统未确认这节课完成；可以先查看课堂结果和路径状态，再决定是否重跑。'
})

function flattenTasks(path: QuickLearnPath) {
  return path.milestones.flatMap((milestone) =>
    milestone.tasks.map((task) => ({
      taskId: task.taskId,
      label: `${milestone.stageNumber}. ${task.title}${task.status === 'completed' ? '（已完成）' : ''}`,
      learnable: task.learnable,
    }))
  )
}

function isActiveStatus(status: string) {
  return status === 'queued' || status === 'running'
}

function statusLabel(status: string) {
  // 状态词走全局字典（单源）：failed → 失败，不再页内另译「未完成」
  return statusText(String(status || ''))
}

/** 运行状态 → mk-badge 基调类（对齐原 EP type 的 success/danger/warning/info 语义） */
function statusBadgeTone(status: string) {
  if (status === 'completed') return 'mk-badge--ok'
  if (status === 'failed' || status === 'interrupted') return 'mk-badge--bad'
  if (status === 'aborted') return 'mk-badge--warn'
  return 'mk-badge--info'
}

function techClass(ok: boolean | undefined) {
  return ok ? 'ql-tech ql-tech--ok' : 'ql-tech ql-tech--fail'
}

function formatMetric(value: unknown) {
  return typeof value === 'number' ? value.toFixed(1) : '--'
}

function formatTime(value?: string | null) {
  if (!value) return '--'
  return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function apiErrorMessage(error: unknown, fallback: string) {
  const value = error as ApiErrorLike
  return value.response?.data?.error || value.message || fallback
}

async function openFrontend(entry: 'evaluation' | 'path' | 'task' | 'learning-state' | 'next-task' | 'dashboard') {
  if (!currentRun.value) return

  let target = '/dashboard?projection=1'
  if (entry === 'evaluation') {
    if (!currentRun.value.teachingSessionId) {
      toast.info('本次运行没有可打开的课程结果页')
      return
    }
    target = `/learn/${currentRun.value.taskId}/evaluation/${currentRun.value.teachingSessionId}?pathId=${currentRun.value.pathId}&projection=1`
  } else if (entry === 'path') {
    target = `/learning-path/${currentRun.value.pathId}?projection=1`
  } else if (entry === 'task') {
    target = `/learn/${currentRun.value.taskId}?pathId=${currentRun.value.pathId}&projection=1`
  } else if (entry === 'learning-state') {
    target = '/learning-state?projection=1'
  } else if (entry === 'next-task') {
    const nextTaskId = report.value?.downstream?.nextTask?.taskId
    if (!nextTaskId) {
      toast.info('当前没有下一任务')
      return
    }
    target = `/learn/${nextTaskId}?projection=1`
  }

  try {
    openingFrontend.value = true
    const { data } = await adminApi.createProjectionToken(props.profileId, { scope: 'full' })
    const token = data.data?.token
    if (!data.success || !token) throw new Error(data.error || '投影 token 缺失')
    setProjectionToken(token, {
      profileId: props.profileId,
      source: 'quick-learn',
      runId: currentRun.value.runId,
    })
    window.open(target, '_blank')
  } catch (error: unknown) {
    toast.error(apiErrorMessage(error, '打开真实前台失败'))
  } finally {
    openingFrontend.value = false
  }
}

async function loadTasks() {
  tasksLoading.value = true
  try {
    const { data } = await adminApi.getQuickLearnTasks(props.profileId)
    taskTree.value = data.data || []
  } catch (error: unknown) {
    toast.error(apiErrorMessage(error, '加载任务列表失败'))
  } finally {
    tasksLoading.value = false
  }
}

async function loadHistory() {
  try {
    const { data } = await adminApi.getQuickLearnRuns(props.profileId, { pageSize: 5 })
    historyRuns.value = data.data?.runs || []
  } catch {
    // 历史加载失败不阻塞主流程
  }
}

async function cloneFixture() {
  cloning.value = true
  try {
    const { data } = await adminApi.cloneQuickLearnFixture(props.profileId, {
      sourcePathId: fixtureSourcePathId.value.trim(),
    })
    const result = data.data as { milestoneCount: number; taskCount: number }
    toast.success(`路径已复制到该账号：${result.milestoneCount} 个阶段 / ${result.taskCount} 个任务`)
    fixtureSourcePathId.value = ''
    await loadTasks()
  } catch (error: unknown) {
    toast.error(apiErrorMessage(error, '克隆路径失败'))
  } finally {
    cloning.value = false
  }
}

async function startRun() {
  starting.value = true
  try {
    const { data } = await adminApi.startQuickLearnRun(props.profileId, {
      taskId: selectedTaskId.value,
      maxTurns: maxTurns.value,
      ...(selectedStoryId.value ? { storyId: selectedStoryId.value } : {}),
      frictionBudget: frictionBudget.value || 'none',
    })
    const runId = String(data.data?.runId || '')
    if (!runId) throw new Error('自动学习 runId 缺失')
    await loadRun(runId)
    startPollingForRun(runId)
  } catch (error: unknown) {
    toast.error(apiErrorMessage(error, '启动账号自动学习失败'))
  } finally {
    starting.value = false
  }
}

/** 加载该虚拟学习者的故事池（单课故事选择） */
async function loadStories() {
  try {
    const { data } = await adminApi.getVirtualLearnerStories(props.profileId)
    const stories = data.data?.stories || data.data?.storyPool || []
    storyOptions.value = (Array.isArray(stories) ? stories : [])
      .filter((s: any) => s && (s.storyId || s.id || s.index !== undefined))
      .map((s: any) => ({
        id: s.storyId || s.id || `idx-${s.index}`,
        title: s.title || s.storyTitle || '未命名故事',
      }))
  } catch {
    storyOptions.value = []
  }
}

async function loadRun(runId: string) {
  try {
    const { data } = await adminApi.getQuickLearnRun(runId)
    const run = data.data as QuickLearnRun
    currentRun.value = run
    if (isActiveStatus(run.status)) {
      // 仍在运行，继续轮询（pollingRunId 已在 startPollingForRun 中设置）
    } else {
      stopPolling()
      pollingRunId.value = null
    }
  } catch (error: unknown) {
    const status = (error as ApiErrorLike)?.response?.status
    if (status != null && status >= 400 && status !== 408 && status !== 429) {
      stopPolling()
      pollingRunId.value = null
      toast.error(apiErrorMessage(error, '获取运行状态失败，已停止轮询'))
    }
  }
}

async function abortRun() {
  if (!currentRun.value) return
  const ok = await askConfirm({
    title: '中止自动学习',
    message: '将中止当前自动学习运行，已推进的学习记录保留。确认中止？',
    confirmText: '中止',
    danger: true,
  })
  if (!ok) return
  try {
    await adminApi.abortQuickLearnRun(currentRun.value.runId)
    toast.info('已请求中止')
  } catch (error: unknown) {
    toast.error(apiErrorMessage(error, '中止失败'))
  }
}

function resetRun() {
  currentRun.value = null
  selectedTaskId.value = ''
  void loadTasks()
  void loadHistory()
}

function startPollingForRun(runId: string) {
  pollingRunId.value = runId
  startPolling()
}

function handleClosed() {
  stopPolling()
  pollingRunId.value = null
}

/** 关闭弹窗：父层用 v-model:visible 控制；这里同步收尾（等价原 EP @closed 的语义） */
function close() {
  emit('update:visible', false)
  handleClosed()
}

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      void loadTasks()
      void loadHistory()
      void loadStories()
    } else {
      stopPolling()
      pollingRunId.value = null
    }
  }
)

// Esc 关闭（原 EP el-dialog 自带；换成 mk-modal 后需显式登记）。遮罩点击不关闭，
// 与原 :close-on-click-modal="false" 一致。
useEscape(() => props.visible, close)
</script>

<style scoped>
.ql-account-brief {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 16px;
}

.ql-account-brief__item {
  border: 1px solid var(--mk-line);
  border-radius: 8px;
  padding: 9px 10px;
  background: var(--mk-bg);
  display: grid;
  gap: 3px;
}

.ql-account-brief__item span {
  font-size: 11px;
  color: var(--mk-faint);
}

.ql-account-brief__item strong {
  font-size: var(--mk-fs-12);
  color: var(--mk-ink);
}

.ql-section {
  margin-bottom: 8px;
}

.ql-section__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.ql-section__title {
  font-weight: 600;
  font-size: var(--mk-fs-13);
  color: var(--mk-ink);
  margin-bottom: 8px;
}

.ql-section__hint,
.ql-entries__hint {
  margin: -2px 0 10px;
  font-size: var(--mk-fs-12);
  line-height: 1.6;
  color: var(--mk-faint);
}

.ql-task-select {
  width: 100%;
  margin-bottom: 10px;
}

.ql-story-select,
.ql-friction-select {
  width: 150px;
}

.ql-run-config {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ql-label {
  font-size: var(--mk-fs-12);
  color: var(--mk-faint);
  min-width: 56px;
}

.ql-fixture {
  margin-top: 10px;
}

.ql-fixture__body {
  display: flex;
  gap: 8px;
}

.ql-history {
  margin-top: 16px;
}

.ql-history-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: var(--mk-fs-13);
}

.ql-history-item:hover {
  background: var(--mk-surface-3);
}

.ql-history-item__meta {
  color: var(--mk-faint);
  font-size: var(--mk-fs-12);
  flex: 1;
}

.ql-history-item__open {
  color: var(--mk-blue);
  font-size: var(--mk-fs-12);
}

.ql-status {
  border: 1px solid var(--mk-line);
  border-radius: 8px;
  padding: 14px;
  margin-bottom: 14px;
}

.ql-status--running {
  border-color: var(--mk-blue-bg-strong);
  background: var(--mk-blue-bg);
}

.ql-status--completed {
  border-color: var(--mk-green-bg);
  background: var(--mk-green-bg);
}

.ql-status__main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}



@keyframes ql-spin {
  to {
    transform: rotate(360deg);
  }
}

.ql-status__title {
  font-weight: 600;
  font-size: var(--mk-fs-14);
  display: flex;
  align-items: center;
  gap: 8px;
}

.ql-status__desc {
  font-size: var(--mk-fs-12);
  color: var(--mk-faint);
  margin-top: 4px;
}

.ql-status__error {
  font-size: var(--mk-fs-12);
  color: var(--mk-red);
  margin-top: 6px;
}

.ql-status__tech {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  margin-top: 8px;
}

.ql-tech {
  font-size: var(--mk-fs-12);
}

.ql-tech--ok {
  color: var(--mk-green);
}

.ql-tech--ok::before {
  content: '✓ ';
}

.ql-tech--fail {
  color: var(--mk-red);
}

.ql-tech--fail::before {
  content: '✗ ';
}

.ql-entries {
  margin-bottom: 12px;
}

.ql-entries__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.ql-tech-detail {
  margin-bottom: 4px;
}

.ql-delta__row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 4px 0;
  font-size: var(--mk-fs-13);
}

.ql-chip {
  background: var(--mk-surface-3);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: var(--mk-fs-12);
}

.ql-chip--warn {
  color: var(--mk-amber);
}

.ql-tag {
  margin-right: 2px;
}

.ql-warnings {
  margin-top: 8px;
  font-size: var(--mk-fs-12);
  color: var(--mk-amber);
}

.ql-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

@media (max-width: 640px) {
  .ql-account-brief {
    grid-template-columns: 1fr;
  }

  .ql-run-config,
  .ql-fixture__body,
  .ql-status__main {
    align-items: stretch;
    flex-direction: column;
  }

  .ql-entries__actions > .el-button {
    flex: 1 1 46%;
    margin-left: 0;
  }
}
</style>
