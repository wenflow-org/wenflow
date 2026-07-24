<template>
  <el-dialog
    :model-value="visible"
    title="账号自动学习"
    width="680px"
    :close-on-click-modal="false"
    @update:model-value="emit('update:visible', $event)"
    @closed="handleClosed"
  >
    <div class="quick-learn">
      <el-alert type="info" :closable="false" class="quick-learn__notice">
        以该虚拟学习者绑定的平台账号完成真实 Learn 流程；路径、课堂、任务完成和学习状态都会写回这个账号。
      </el-alert>

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
          <el-button text size="small" :loading="tasksLoading" @click="loadTasks">刷新</el-button>
        </div>
        <p class="ql-section__hint">只列出这个虚拟账号名下的路径和任务；需要复用别人的路径时，先复制到该账号名下。</p>
        <el-select v-model="selectedTaskId" placeholder="选择该虚拟账号名下的任务" filterable class="ql-task-select">
          <el-option-group v-for="path in taskTree" :key="path.pathId" :label="path.title">
            <el-option
              v-for="option in flattenTasks(path)"
              :key="option.taskId"
              :value="option.taskId"
              :label="option.label"
              :disabled="!option.learnable"
            />
          </el-option-group>
        </el-select>
        <div class="ql-run-config">
          <span class="ql-label">本节课最多</span>
          <el-input-number v-model="maxTurns" :min="1" :max="40" size="small" />
          <el-button type="primary" :disabled="!selectedTaskId" :loading="starting" @click="startRun">
            让账号开始学习
          </el-button>
        </div>

        <el-collapse class="ql-fixture">
          <el-collapse-item title="没有可学任务？把已有路径复制到该虚拟账号" name="fixture">
            <div class="ql-fixture__body">
              <el-input
                v-model="fixtureSourcePathId"
                placeholder="源学习路径 ID（复制后成为该账号自己的路径）"
                size="small"
                clearable
              />
              <el-button size="small" :loading="cloning" :disabled="!fixtureSourcePathId.trim()" @click="cloneFixture">
                复制到该账号
              </el-button>
            </div>
          </el-collapse-item>
        </el-collapse>

        <!-- 历史运行 -->
        <div v-if="historyRuns.length" class="ql-history">
          <div class="ql-section__title">最近自动学习</div>
          <div v-for="run in historyRuns" :key="run.runId" class="ql-history-item" @click="loadRun(run.runId)">
            <el-tag :type="statusTagType(run.status)" size="small">{{ statusLabel(run.status) }}</el-tag>
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
              <span class="ql-status__spinner" />
              <div>
                <div class="ql-status__title">虚拟账号正在上这节课</div>
                <div class="ql-status__desc">真实 Teaching Session 正在生成课堂记录；完成后直接进入前台视角验收。</div>
              </div>
            </div>
            <el-button size="small" type="danger" plain @click="abortRun">中止</el-button>
          </template>
          <template v-else>
            <div class="ql-status__main">
              <div>
                <div class="ql-status__title">
                  {{ resultTitle }}
                  <el-tag :type="statusTagType(currentRun.status)" size="small">{{ statusLabel(currentRun.status) }}</el-tag>
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
              <el-button type="primary" :loading="openingFrontend" @click="openFrontend('path')">学习路径</el-button>
              <el-button
                :disabled="!currentRun.teachingSessionId"
                :loading="openingFrontend"
                @click="openFrontend('evaluation')"
              >
                课程结果
              </el-button>
              <el-button :loading="openingFrontend" @click="openFrontend('task')">本节课 Learn</el-button>
              <el-button :loading="openingFrontend" @click="openFrontend('learning-state')">学习状态</el-button>
              <el-button
                v-if="report?.downstream?.nextTask"
                :loading="openingFrontend"
                @click="openFrontend('next-task')"
              >
                下一任务
              </el-button>
              <el-button plain :loading="openingFrontend" @click="openFrontend('dashboard')">学习首页</el-button>
            </div>
          </div>

          <el-collapse v-if="report" class="ql-tech-detail">
            <el-collapse-item title="传播报告（开发者）" name="tech">
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
                <el-tag
                  v-for="item in report.learnerDelta.knowledge.newMastered"
                  :key="item"
                  size="small"
                  type="success"
                  effect="plain"
                  class="ql-tag"
                >
                  {{ item }}
                </el-tag>
              </div>
              <div class="ql-delta__row">
                <span class="ql-label">新混淆</span>
                <span v-if="!report.learnerDelta.knowledge.newRecurringConfusions.length">无</span>
                <el-tag
                  v-for="item in report.learnerDelta.knowledge.newRecurringConfusions"
                  :key="item"
                  size="small"
                  type="warning"
                  effect="plain"
                  class="ql-tag"
                >
                  {{ item }}
                </el-tag>
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
            </el-collapse-item>
          </el-collapse>

          <div class="ql-actions">
            <el-button text @click="resetRun">再学一课</el-button>
            <el-button text @click="emit('update:visible', false)">关闭</el-button>
          </div>
        </template>
      </section>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { adminApi } from '@/api/adminApi'
import { setProjectionToken } from '@/utils/projection'

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
  response?: { data?: { error?: string } }
  message?: string
}

const tasksLoading = ref(false)
const taskTree = ref<QuickLearnPath[]>([])
const selectedTaskId = ref('')
const maxTurns = ref(25)
const starting = ref(false)
const cloning = ref(false)
const openingFrontend = ref(false)
const fixtureSourcePathId = ref('')
const currentRun = ref<QuickLearnRun | null>(null)
const historyRuns = ref<QuickLearnRun[]>([])
let pollTimer: ReturnType<typeof setInterval> | null = null

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
  const labels: Record<string, string> = {
    queued: '排队中',
    running: '运行中',
    completed: '已完成',
    failed: '未完成',
    aborted: '已中止',
    interrupted: '已中断',
  }
  return labels[status] || status
}

function statusTagType(status: string) {
  if (status === 'completed') return 'success'
  if (status === 'failed' || status === 'interrupted') return 'danger'
  if (status === 'aborted') return 'warning'
  return 'info'
}

function techClass(ok: boolean | undefined) {
  return ok ? 'ql-tech ql-tech--ok' : 'ql-tech ql-tech--fail'
}

function formatMetric(value: unknown) {
  return typeof value === 'number' ? value.toFixed(1) : '--'
}

function formatTime(value: string | null) {
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
      ElMessage.info('本次运行没有可打开的课程结果页')
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
      ElMessage.info('当前没有下一任务')
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
    ElMessage.error(apiErrorMessage(error, '打开真实前台失败'))
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
    ElMessage.error(apiErrorMessage(error, '加载任务列表失败'))
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
    ElMessage.success(`路径已复制到该账号：${result.milestoneCount} 个阶段 / ${result.taskCount} 个任务`)
    fixtureSourcePathId.value = ''
    await loadTasks()
  } catch (error: unknown) {
    ElMessage.error(apiErrorMessage(error, '克隆路径失败'))
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
    })
    const runId = String(data.data?.runId || '')
    if (!runId) throw new Error('自动学习 runId 缺失')
    await loadRun(runId)
    startPolling(runId)
  } catch (error: unknown) {
    ElMessage.error(apiErrorMessage(error, '启动账号自动学习失败'))
  } finally {
    starting.value = false
  }
}

async function loadRun(runId: string) {
  try {
    const { data } = await adminApi.getQuickLearnRun(runId)
    const run = data.data as QuickLearnRun
    currentRun.value = run
    if (isActiveStatus(run.status)) {
      startPolling(runId)
    } else {
      stopPolling()
    }
  } catch {
    // 轮询中的瞬时错误静默处理
  }
}

async function abortRun() {
  if (!currentRun.value) return
  try {
    await adminApi.abortQuickLearnRun(currentRun.value.runId)
    ElMessage.info('已请求中止')
  } catch (error: unknown) {
    ElMessage.error(apiErrorMessage(error, '中止失败'))
  }
}

function resetRun() {
  currentRun.value = null
  selectedTaskId.value = ''
  void loadTasks()
  void loadHistory()
}

function startPolling(runId: string) {
  stopPolling()
  pollTimer = setInterval(() => void loadRun(runId), 2000)
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function handleClosed() {
  stopPolling()
}

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      void loadTasks()
      void loadHistory()
    } else {
      stopPolling()
    }
  }
)
</script>

<style scoped>
.quick-learn__notice {
  margin-bottom: 12px;
}

.ql-account-brief {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 16px;
}

.ql-account-brief__item {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 9px 10px;
  background: var(--el-fill-color-extra-light);
  display: grid;
  gap: 3px;
}

.ql-account-brief__item span {
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

.ql-account-brief__item strong {
  font-size: 12px;
  color: var(--el-text-color-primary);
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
  font-size: 13px;
  color: var(--el-text-color-primary);
  margin-bottom: 8px;
}

.ql-section__hint,
.ql-entries__hint {
  margin: -2px 0 10px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

.ql-task-select {
  width: 100%;
  margin-bottom: 10px;
}

.ql-run-config {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ql-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
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
  font-size: 13px;
}

.ql-history-item:hover {
  background: var(--el-fill-color-light);
}

.ql-history-item__meta {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  flex: 1;
}

.ql-history-item__open {
  color: var(--el-color-primary);
  font-size: 12px;
}

.ql-status {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 14px;
  margin-bottom: 14px;
}

.ql-status--running {
  border-color: var(--el-color-primary-light-7);
  background: var(--el-color-primary-light-9);
}

.ql-status--completed {
  border-color: var(--el-color-success-light-7);
  background: var(--el-color-success-light-9);
}

.ql-status__main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.ql-status__spinner {
  width: 18px;
  height: 18px;
  border: 2px solid var(--el-color-primary-light-5);
  border-top-color: var(--el-color-primary);
  border-radius: 50%;
  animation: ql-spin 0.9s linear infinite;
  flex-shrink: 0;
}

@keyframes ql-spin {
  to {
    transform: rotate(360deg);
  }
}

.ql-status__title {
  font-weight: 600;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.ql-status__desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
}

.ql-status__error {
  font-size: 12px;
  color: var(--el-color-danger);
  margin-top: 6px;
}

.ql-status__tech {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  margin-top: 8px;
}

.ql-tech {
  font-size: 12px;
}

.ql-tech--ok {
  color: var(--el-color-success);
}

.ql-tech--ok::before {
  content: '✓ ';
}

.ql-tech--fail {
  color: var(--el-color-danger);
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
  font-size: 13px;
}

.ql-chip {
  background: var(--el-fill-color-light);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 12px;
}

.ql-chip--warn {
  color: var(--el-color-warning);
}

.ql-tag {
  margin-right: 2px;
}

.ql-warnings {
  margin-top: 8px;
  font-size: 12px;
  color: var(--el-color-warning);
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
