<template>
  <div class="admin-page cockpit-page">
    <AdminPageHeader
      title="虚拟会话控制台"
      :icon="Monitor"
    >
      <template #actions>
        <el-button @click="backToStory">
          <el-icon><ArrowLeft /></el-icon>
          {{ profileName || '返回' }}
        </el-button>
        <el-button @click="loadSession" :loading="loading">
          <el-icon><Refresh /></el-icon>
          刷新
        </el-button>
      </template>
    </AdminPageHeader>

    <section class="cockpit-topbar">
      <div class="cockpit-topbar__stage-strip">
        <div
          v-for="s in stageStripItems"
          :key="s.key"
          class="stage-chip"
          :class="{ active: s.key === activeNav, done: s.done, disabled: s.disabled }"
          @click="!s.disabled && selectStage(s.key)"
        >
          <span class="stage-chip__dot">{{ s.label[0] }}</span>
          <span class="stage-chip__label">{{ s.label }}</span>
          <span v-if="s.done" class="stage-chip__check">✓</span>
        </div>
      </div>
      <div class="cockpit-topbar__tags">
        <el-tag v-if="isBlackboxMode" type="info" size="small" effect="plain">Blackbox API</el-tag>
        <el-tag :type="statusTagType" size="small" effect="dark">{{ statusText }}</el-tag>
      </div>
    </section>

    <section v-if="isBlackboxMode" class="blackbox-observation">
      <div class="blackbox-observation__result">
        <span>公开输出</span>
        <strong>{{ latestBlackboxObservation?.visibleTask?.title || latestBlackboxObservation?.visiblePath?.title || '—' }}</strong>
        <p v-if="latestBlackboxObservation?.lastActionResult?.visibleMessage">{{ latestBlackboxObservation.lastActionResult.visibleMessage }}</p>
      </div>
      <div class="blackbox-observation__ids">
        <code>EXP {{ experimentMeta?.experimentId?.slice(0, 10) || '—' }}</code>
        <code>RUN {{ experimentMeta?.runId?.slice(0, 10) || '—' }}</code>
        <code>TRACE {{ refereeTraceCount }}</code>
        <code v-if="refereeReportCount">REPORT {{ refereeReportCount }}</code>
      </div>
    </section>

    <!-- ============ Main workspace ============ -->
    <div class="cockpit-main">
      <!-- Center: Stage content -->
      <section class="cockpit-stage">
        <!-- Goal -->
        <div v-if="activeNav === 'goal'" class="stage-panel">
          <div class="stage-panel__head">
            <h3>目标对齐 · Goal</h3>
            <el-tag v-if="goalStageLabel" size="small" type="warning">{{ goalStageLabel }}</el-tag>
          </div>

          <!-- Goal conversation rounds -->
          <div v-if="goalConversation.length" class="conversation-list">
            <article
              v-for="(round, idx) in goalConversation"
              :key="idx"
              class="conv-round"
              :class="round.role === 'assistant' ? 'conv-round--teacher' : 'conv-round--learner'"
            >
              <div class="conv-round__head">
                <span class="conv-round__role">{{ round.role === 'assistant' ? '老师' : '学习者' }}</span>
                <span class="conv-round__idx">#{{ idx + 1 }}</span>
              </div>
              <p class="conv-round__msg">{{ round.content }}</p>
              <div v-if="round.signals" class="conv-round__signals">
                <span v-for="(v, k) in round.signals" :key="k" class="signal-chip">{{ k }}: {{ v }}</span>
              </div>
            </article>
          </div>
          <div v-else class="stage-panel__empty">
            <p>尚无 Goal 轮次</p>
          </div>

          <!-- Concern pool -->
          <details v-if="!isBlackboxMode && concernPool" class="stage-panel__detail">
            <summary>关注点池 ({{ disclosedCount }}/{{ totalConcerns }})</summary>
            <div class="concern-grid">
              <span v-for="(c, i) in concernPool" :key="i" class="concern-chip" :class="{ disclosed: c.disclosed }">{{ c.label }}</span>
            </div>
          </details>
        </div>

        <!-- Path -->
        <div v-if="activeNav === 'path'" class="stage-panel">
          <div class="stage-panel__head">
            <h3>学习路径 · Path</h3>
            <el-tag v-if="pathStatusText !== '未生成'" size="small" :type="pathReady ? 'success' : 'warning'">{{ pathStatusText }}</el-tag>
          </div>

          <!-- Path milestones -->
          <div v-if="milestones.length" class="milestone-list">
            <div v-for="(ms, mi) in milestones" :key="mi" class="milestone-card">
              <div class="milestone-card__head">
                <span class="milestone-card__num">{{ mi + 1 }}</span>
                <strong>{{ ms.title }}</strong>
                <el-tag v-if="ms.status === 'active'" size="small" type="primary">进行中</el-tag>
              </div>
              <div class="task-chips">
                <span
                  v-for="(task, ti) in (ms.subtasks || [])"
                  :key="ti"
                  class="task-chip"
                  :class="{ active: task.id === currentTaskId, done: task.status === 'completed' }"
                >
                  {{ task.title }}
                </span>
              </div>
              <p v-if="ms.description" class="milestone-card__desc">{{ ms.description }}</p>
            </div>
          </div>
          <div v-else class="stage-panel__empty">
            <p>{{ pathReady ? '暂无里程碑' : 'Path 生成中' }}</p>
          </div>

          <!-- Path review -->
          <details v-if="!isBlackboxMode && pathReview" class="stage-panel__detail">
            <summary>Path 接受评估</summary>
            <p>结论: {{ pathReview.decision === 'accept' ? '接受' : pathReview.decision === 'modify' ? '需要修改' : pathReview.decision === 'reject' ? '拒绝' : '待评审' }}</p>
            <p>状态: {{ getPathReviewStatusLabel(pathReview.status) }}</p>
            <p>反应: {{ pathReview.reaction }}</p>
            <p v-if="pathReview.biggestConcern">最大顾虑: {{ pathReview.biggestConcern }}</p>
            <ul v-if="pathReview.visibleRequestedChanges?.length" class="path-review-changes">
              <li v-for="change in pathReview.visibleRequestedChanges" :key="change">{{ change }}</li>
            </ul>
          </details>
        </div>

        <!-- Learn -->
        <div v-if="activeNav === 'learning'" class="stage-panel">
          <div class="stage-panel__head">
            <h3>教学活动 · Learn</h3>
            <div class="stage-panel__task-meta">
              <span v-if="currentTaskTitle" class="task-badge">当前: {{ currentTaskTitle }}</span>
              <span v-if="currentMilestoneTitle" class="ms-badge">阶段: {{ currentMilestoneTitle }}</span>
            </div>
          </div>

          <!-- Learn conversation -->
          <div v-if="learnConversation.length" class="conversation-list">
            <article
              v-for="(round, idx) in learnConversation"
              :key="idx"
              class="conv-round"
              :class="round.role === 'assistant' ? 'conv-round--teacher' : 'conv-round--learner'"
            >
              <div class="conv-round__head">
                <span class="conv-round__role">{{ round.role === 'assistant' ? '老师' : '学习者' }}</span>
                <span class="conv-round__idx">#{{ idx + 1 }}</span>
              </div>
              <p class="conv-round__msg">{{ round.content }}</p>
              <div v-if="round.closureDecision" class="conv-round__closure">
                <span v-if="round.closureDecision.teacherReady">T✓</span>
                <span v-if="round.closureDecision.learnerReady">L✓</span>
              </div>
            </article>
          </div>
          <div v-else class="stage-panel__empty">
            <p>尚无 Learn 轮次</p>
          </div>

          <!-- Knowledge progress -->
          <details v-if="!isBlackboxMode && knowledgeProgress" class="stage-panel__detail">
            <summary>知识进展</summary>
            <pre class="json-block">{{ JSON.stringify(knowledgeProgress, null, 2) }}</pre>
          </details>
        </div>

        <!-- Wrapup -->
        <div v-if="!isBlackboxMode && activeNav === 'wrapup'" class="stage-panel">
          <div class="stage-panel__head">
            <h3>学习总结 · Wrapup</h3>
            <el-button
              v-if="!wrapupSummary"
              size="small"
              type="primary"
              :loading="loadingWrapup"
              :disabled="!learningStarted && status !== 'completed'"
              @click="handleGenerateWrapup"
            >
              立即生成总结
            </el-button>
            <el-button
              v-else
              size="small"
              :loading="loadingWrapup"
              @click="handleGenerateWrapup"
            >
              重新生成
            </el-button>
          </div>
          <div v-if="wrapupSummary" class="wrapup-full">
            <div class="wrapup-section" v-for="(val, key) in wrapupDetailSections" :key="key">
              <span class="wrapup-section__label">{{ key }}</span>
              <p>{{ val }}</p>
            </div>
            <div v-if="wrapupEvaluation" class="wrapup-evaluation">
              <span class="wrapup-section__label">评估指标</span>
              <div class="metric-grid">
                <div class="metric-cell">
                  <span>LSS</span>
                  <strong>{{ wrapupEvaluation.sessionLss?.toFixed(1) }}</strong>
                </div>
                <div class="metric-cell">
                  <span>KTL</span>
                  <strong>{{ wrapupEvaluation.sessionKtl?.toFixed(1) }}</strong>
                </div>
                <div class="metric-cell">
                  <span>LF</span>
                  <strong>{{ wrapupEvaluation.sessionLf?.toFixed(1) }}</strong>
                </div>
                <div class="metric-cell">
                  <span>置信度</span>
                  <strong>{{ Math.round((wrapupEvaluation.confidence || 0) * 100) }}%</strong>
                </div>
              </div>
              <p class="wrapup-evaluation__reasoning">{{ wrapupEvaluation.reasoning }}</p>
            </div>
          </div>
          <div v-else class="stage-panel__empty">
            <p>尚无总结</p>
          </div>
        </div>

        <!-- Referee -->
        <div v-if="isBlackboxMode && activeNav === 'referee'" class="stage-panel">
          <div class="stage-panel__head">
            <h3>裁判报告 · Referee</h3>
            <el-button v-if="isTerminal && !latestRefereeReport" type="primary" :loading="loadingReferee" @click="handleGenerateReferee">
              生成报告
            </el-button>
          </div>
          <div v-if="latestRefereeReport" class="referee-report">
            <div class="referee-report__hero">
              <div>
                <span>Verdict</span>
                <strong>{{ refereeVerdictLabel }}</strong>
                <p>{{ formatEventTime(latestRefereeReport.evaluatedAt) }}</p>
              </div>
              <div class="referee-score">
                <strong>{{ latestRefereeReport.report?.scores?.overall ?? '—' }}</strong>
                <span>overall</span>
              </div>
            </div>
            <div class="referee-score-grid">
              <div v-for="metric in refereeScoreItems" :key="metric.label">
                <span>{{ metric.label }}</span>
                <strong>{{ metric.value ?? '—' }}</strong>
              </div>
            </div>
            <div v-if="latestRefereeReport.report?.findings?.length" class="referee-report__section">
              <h4>发现</h4>
              <article v-for="item in latestRefereeReport.report.findings" :key="item.code" class="referee-finding">
                <el-tag size="small" :type="findingTagType(item.severity)">{{ item.severity }}</el-tag>
                <div><strong>{{ item.title }}</strong><p>{{ item.detail }}</p></div>
              </article>
            </div>
            <div v-if="latestRefereeReport.report?.recommendations?.length" class="referee-report__section">
              <h4>建议</h4>
              <article v-for="item in latestRefereeReport.report.recommendations" :key="`${item.priority}-${item.action}`" class="referee-recommendation">
                <strong>{{ item.priority }}</strong><p>{{ item.action }}</p>
              </article>
            </div>
          </div>
          <div v-else class="stage-panel__empty">
            <p>{{ isTerminal ? '尚无裁判报告' : '实验进行中' }}</p>
          </div>
        </div>
      </section>

      <!-- Right: Control + Log -->
      <aside class="cockpit-side">
        <SessionControlPanel
          v-if="!isBlackboxMode || !isTerminal"
          :current-stage="currentStage"
          :status="status"
          :goal-ready="goalReady"
          :path-ready="pathReady"
          :path-review="pathReview"
          :learning-started="learningStarted"
          :config="cockpitConfig"
          :loading-step="loadingStep"
          :loading-auto="loadingAuto"
          :loading-bridge="loadingBridge"
          :blackbox-mode="isBlackboxMode"
          @step="handleStep"
          @auto="handleAuto"
          @stop="handleStop"
          @advance-path="handleAdvancePath"
          @review-path="handleReviewPath"
          @start-learning="handleStartLearning"
          @reset-path="handleResetPath"
          @reset-learn="handleResetLearn"
          @delete-session="handleDeleteSession"
          @update:config="handleConfigChange"
        />
        <SessionLiveLog :entries="logEntries" :polling-disabled="logsPollingDisabled || isTerminal" @poll="loadLogs" />
      </aside>
    </div>

    <details class="cockpit-detail">
      <summary>
        <span>调试数据</span>
        <code>{{ sessionId?.slice(0, 8) ?? '—' }}</code>
      </summary>
      <div class="detail-tabs">
        <button
          v-for="t in detailTabs"
          :key="t.key"
          type="button"
          class="detail-tab"
          :class="{ active: activeDetailTab === t.key }"
          @click="activeDetailTab = t.key"
        >{{ t.label }}</button>
      </div>

      <!-- Bindings -->
      <div v-if="activeDetailTab === 'bindings'" class="detail-pane">
        <div class="binding-grid">
          <div v-for="(val, key) in bindings" :key="key" class="binding-row">
            <span class="binding-row__key">{{ key }}</span>
            <code class="binding-row__val">{{ val || '(空)' }}</code>
          </div>
        </div>
      </div>

      <!-- Raw JSON -->
      <div v-if="activeDetailTab === 'json'" class="detail-pane">
        <pre class="json-block">{{ JSON.stringify(session, null, 2) }}</pre>
      </div>
    </details>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, Refresh, Monitor } from '@element-plus/icons-vue'
import { adminApi } from '@/api/adminApi'
import AdminPageHeader from './components/AdminPageHeader.vue'
import SessionControlPanel from './components/virtual/SessionControlPanel.vue'
import SessionLiveLog, { type LogEntry } from './components/virtual/SessionLiveLog.vue'

const router = useRouter()
const route = useRoute()
const sessionId = route.params.sessionId as string

/* ===== Reactive state ===== */
const session = ref<any>(null)
const loading = ref(false)
const logEntries = ref<LogEntry[]>([])
const profileName = ref('')

const loadingStep = ref(false)
const loadingAuto = ref(false)
const loadingBridge = ref(false)
const loadingWrapup = ref(false)
const loadingReferee = ref(false)
const blackboxSnapshot = ref<any>(null)
const logsPollingDisabled = ref(false)

const activeNav = ref<'goal' | 'path' | 'learning' | 'wrapup' | 'referee'>('goal')
const activeDetailTab = ref<'bindings' | 'json'>('bindings')

const cockpitConfig = ref({
  maxRounds: 20,
  maxMilestones: 10,
  autoAdvanceToPath: false,
  autoAdvanceToLearning: false,
  continueOnTaskComplete: true,
  frictionBudget: 'normal' as 'none' | 'low' | 'normal' | 'high' | 'stress_test'
})

/* ===== Computed session properties ===== */
const currentStage = computed(() => session.value?.currentStage || 'goal')
const status = computed(() => session.value?.status || 'created')
const bindings = computed(() => {
  const s = session.value
  if (!s) return {}
  const b = s.bindings || s.runtime?.bindings || {}
  return {
    goalConversationId: b.goalConversationId || s.goalConversationId,
    learningPathId: b.learningPathId || s.learningPathId,
    currentTaskId: b.currentTaskId || s.currentTaskId,
    teachingSessionId: b.teachingSessionId || s.stageResults?.learning?.teachingSessionId
  }
})

const stageResults = computed(() => session.value?.stageResults || {})
const isBlackboxMode = computed(() => stageResults.value?.experiment?.mode === 'blackbox-api')
const experimentMeta = computed(() => blackboxSnapshot.value?.experiment || stageResults.value?.experiment || null)
const latestBlackboxObservation = computed(() => blackboxSnapshot.value?.observation || stageResults.value?.blackbox?.publicTrace?.slice(-1)[0]?.observation || null)
const latestBlackboxPathObservation = computed(() => {
  const trace = stageResults.value?.blackbox?.publicTrace
  if (!Array.isArray(trace)) return latestBlackboxObservation.value?.stage === 'path' ? latestBlackboxObservation.value : null
  return [...trace].reverse().find((entry: any) => entry?.observation?.stage === 'path' && entry?.observation?.visiblePath)?.observation || null
})
const latestRefereeReport = computed(() => {
  if (blackboxSnapshot.value?.latestRefereeReport) return blackboxSnapshot.value.latestRefereeReport
  const reports = stageResults.value?.blackbox?.refereeReports
  if (!Array.isArray(reports)) return null
  const latestId = stageResults.value?.blackbox?.latestRefereeReportId
  return reports.find((item: any) => item.id === latestId) || reports[reports.length - 1] || null
})
const refereeTraceCount = computed(() => blackboxSnapshot.value?.refereeTraceCount || stageResults.value?.blackbox?.refereeTrace?.length || 0)
const refereeReportCount = computed(() => blackboxSnapshot.value?.refereeReportCount || stageResults.value?.blackbox?.refereeReports?.length || 0)
const isTerminal = computed(() => ['completed', 'failed', 'abandoned'].includes(status.value))
const blackboxMessagesFor = (stage: 'goal' | 'learning') => {
  const trace = stageResults.value?.blackbox?.publicTrace
  if (!Array.isArray(trace)) return []
  return trace
    .filter((entry: any) => entry?.observation?.stage === stage)
    .flatMap((entry: any) => entry?.observation?.visibleMessages || [])
}

/* Goal */
const goalReady = computed(() => {
  if (!session.value) return false
  const g = stageResults.value?.goal
  const stage = g?.finalStage || g?.stage
  if (['ready', 'completed'].includes(stage)) return true
  return !!bindings.value.goalConversationId && !!bindings.value.learningPathId
})

const goalStageLabel = computed(() => {
  const g = stageResults.value?.goal
  return g?.finalStage || g?.stage || null
})

const goalConversation = computed<any[]>(() => {
  if (isBlackboxMode.value) {
    return blackboxMessagesFor('goal').map((m: any) => ({
      role: m.role === 'learner' ? 'learner' : 'assistant',
      content: m.content || '',
      signals: null
    }))
  }
  const conv = session.value?.conversations?.goal?.messages
  if (Array.isArray(conv) && conv.length) return conv
  const raw = stageResults.value?.goal?.conversationHistory
  return Array.isArray(raw) ? raw.map((m: any) => ({
    role: m.role === 'user' ? 'learner' : m.role === 'assistant' ? 'assistant' : m.role,
    content: m.content || m.text || '',
    signals: null
  })) : []
})

const concernPool = computed<any[] | null>(() => {
  const pool = stageResults.value?.goal?.concernPool
  if (pool && typeof pool === 'object') {
    return Object.entries(pool).map(([k, v]) => ({
      label: k,
      disclosed: (v as any)?.disclosed || false
    }))
  }
  return null
})

const totalConcerns = computed(() => concernPool.value?.length ?? 0)
const disclosedCount = computed(() => concernPool.value?.filter(c => c.disclosed).length ?? 0)

/* Path */
const pathReady = computed(() => {
  if (!bindings.value.learningPathId) return false
  if (!isBlackboxMode.value) return ['active', 'ready', 'completed'].includes(pathStatus.value)
  return latestBlackboxPathObservation.value?.availableActions?.includes('start_learning') === true || learningStarted.value
})

const pathStatus = ref<string>('idle')
const pathStatusText = computed(() => {
  if (isBlackboxMode.value) {
    if (latestBlackboxObservation.value?.stage === 'error') return '失败'
    if (latestBlackboxObservation.value?.stage === 'completed') return '已完成'
    if (pathReady.value) return '已就绪'
    return bindings.value.learningPathId ? '生成中' : '未生成'
  }
  switch (pathStatus.value) {
    case 'generating': return '生成中'
    case 'active': case 'ready': return '已就绪'
    case 'completed': return '已完成'
    case 'failed': return '失败'
    case 'not_found': return '未找到'
    default: return '未生成'
  }
})

const pathData = ref<any>(null)
const milestones = computed(() => {
  if (isBlackboxMode.value) return latestBlackboxPathObservation.value?.visiblePath?.milestones || []
  return pathData.value?.path?.milestones || pathData.value?.milestones || []
})

const pathReview = computed(() => session.value?.runtime?.stageStatus?.path?.review || stageResults.value?.path_review || null)

function getPathReviewStatusLabel(status?: string) {
  const labels: Record<string, string> = {
    pending: '待处理',
    accepted: '已接受并进入 Learn',
    replanning: '重规划中',
    replanned: '已重规划，等待复评',
    failed: '评审或重规划失败'
  }
  return labels[status || ''] || '待评审'
}

/* Learn */
const learningStarted = computed(() => {
  if (!isBlackboxMode.value) return !!bindings.value.currentTaskId || !!bindings.value.teachingSessionId
  const trace = stageResults.value?.blackbox?.publicTrace
  return !!bindings.value.teachingSessionId
    || currentStage.value === 'learning'
    || (Array.isArray(trace) && trace.some((entry: any) => entry?.observation?.stage === 'learning'))
})
const currentTaskId = computed(() => bindings.value.currentTaskId)
const currentTaskTitle = computed(() => {
  return latestBlackboxObservation.value?.visibleTask?.title || stageResults.value?.learning?.currentTaskTitle || stageResults.value?.learning?.taskRuntime?.taskTitle || null
})
const currentMilestoneTitle = computed(() => {
  return stageResults.value?.learning?.currentMilestoneTitle || null
})

const learnConversation = computed<any[]>(() => {
  if (isBlackboxMode.value) {
    return blackboxMessagesFor('learning').map((m: any) => ({
      role: m.role === 'learner' ? 'learner' : 'assistant',
      content: m.content || '',
      closureDecision: null
    }))
  }
  const conv = session.value?.conversations?.learning?.messages
  if (Array.isArray(conv) && conv.length) return conv
  const raw = stageResults.value?.learning?.conversationHistory
  return Array.isArray(raw) ? raw.map((m: any) => ({
    role: m.role === 'user' ? 'learner' : m.role,
    content: m.content || m.text || '',
    closureDecision: m.closureDecision || null
  })) : []
})

const wrapupSummary = computed(() => {
  return stageResults.value?.learning?.wrapup?.summary ||
    stageResults.value?.learning?.wrapup ||
    session.value?.runtime?.stageStatus?.learning?.wrapup ||
    null
})

const wrapupEvaluation = computed(() => {
  return stageResults.value?.learning?.wrapup?.evaluation || null
})

const knowledgeProgress = computed(() => stageResults.value?.learning?.learnerState)

const wrapupDetailSections = computed(() => {
  const w = wrapupSummary.value
  if (!w || typeof w === 'string') return { 总结: typeof w === 'string' ? w : '' }
  const sections: Record<string, string> = {}
  if (w.topicSummary) sections['主题回顾'] = w.topicSummary
  if (w.knowledgeSummary) sections['知识点回顾'] = w.knowledgeSummary
  if (w.practiceAdvice) sections['后续建议'] = w.practiceAdvice
  if (w.learningEvaluation) sections['学习评估'] = w.learningEvaluation
  if (w.overallAssessment) sections['整体评估'] = w.overallAssessment
  return sections
})

/* ===== Derived ===== */
const statusTagType = computed(() => {
  switch (status.value) {
    case 'running': return 'primary'
    case 'completed': return 'success'
    case 'failed': return 'danger'
    case 'abandoned': return 'warning'
    default: return 'info'
  }
})

const statusText = computed(() => {
  switch (status.value) {
    case 'created': return '已创建'
    case 'running': return '运行中'
    case 'completed': return '已完成'
    case 'failed': return '失败'
    case 'abandoned': return '已放弃'
    default: return status.value
  }
})

const stageOrder = computed(() => isBlackboxMode.value
  ? ['goal', 'path', 'learning', 'referee'] as const
  : ['goal', 'path', 'learning', 'wrapup'] as const
)
const blackboxReachedStages = computed(() => {
  const trace = stageResults.value?.blackbox?.publicTrace
  const stages = new Set<string>()
  if (Array.isArray(trace)) {
    for (const entry of trace) stages.add(entry?.observation?.stage)
  }
  return stages
})
const blackboxCompletedStages = computed(() => {
  const control = blackboxSnapshot.value?.control || stageResults.value?.blackbox?.control || {}
  return new Set<string>([
    ...(control.goalCompleted === true || blackboxReachedStages.value.has('path') || blackboxReachedStages.value.has('learning') || blackboxReachedStages.value.has('completed') ? ['goal'] : []),
    ...(blackboxReachedStages.value.has('learning') || blackboxReachedStages.value.has('completed') ? ['path'] : []),
    ...(control.runCompleted === true ? ['learning'] : []),
    ...(latestRefereeReport.value ? ['referee'] : [])
  ])
})
const liveNav = computed(() => {
  if (isBlackboxMode.value && isTerminal.value) return 'referee'
  return stageOrder.value.includes(currentStage.value as any) ? currentStage.value : 'goal'
})
const stageIndex = computed(() => Math.max(stageOrder.value.indexOf(liveNav.value as any), 0))

const stageStripItems = computed(() => {
  return stageOrder.value.map((key, idx) => ({
    key,
    label: key === 'goal' ? 'Goal' : key === 'path' ? 'Path' : key === 'learning' ? 'Learn' : key === 'referee' ? 'Referee' : 'Wrapup',
    done: isBlackboxMode.value ? blackboxCompletedStages.value.has(key) : idx < stageIndex.value || status.value === 'completed',
    disabled: idx > stageIndex.value
  }))
})

const detailTabs = computed(() => [
  { key: 'bindings', label: '当前绑定' },
  ...(!isBlackboxMode.value || isTerminal.value ? [{ key: 'json', label: '原始数据' }] : [])
])

const refereeVerdictLabel = computed(() => {
  const verdict = latestRefereeReport.value?.report?.verdict
  return verdict === 'pass' ? '通过'
    : verdict === 'pass_with_concerns' ? '有条件通过'
      : verdict === 'fail' ? '失败' : '证据不足'
})

const refereeScoreItems = computed(() => {
  const scores = latestRefereeReport.value?.report?.scores || {}
  return [
    { label: 'Goal 体验', value: scores.goalExperience },
    { label: 'Path 体验', value: scores.pathExperience },
    { label: 'Teaching 体验', value: scores.teachingExperience },
    { label: '控制一致性', value: scores.controlConsistency },
    { label: '边界完整性', value: scores.boundaryIntegrity },
    { label: '证据充分性', value: scores.evidenceSufficiency }
  ]
})

const findingTagType = (severity?: string) => severity === 'critical' ? 'danger'
  : severity === 'major' ? 'warning' : severity === 'minor' ? 'info' : 'success'

/* ===== Data loading ===== */
const loadSession = async () => {
  loading.value = true
  try {
    const res = await adminApi.getVirtualSession(sessionId)
    if (!res.data?.success) throw new Error(res.data?.error || '加载失败')
    const data = res.data.data
    session.value = data
    
    // profile name
    if (data.profile?.name) {
      profileName.value = data.profile.name
    }

    // 从 stageResults.simulationConfig 同步 frictionBudget 回 cockpitConfig
    const sessionFriction = data.stageResults?.simulationConfig?.frictionBudget
    if (sessionFriction && ['none','low','normal','high','stress_test'].includes(sessionFriction)) {
      cockpitConfig.value.frictionBudget = sessionFriction
    }

    if (data.stageResults?.experiment?.mode !== 'blackbox-api' && (data.bindings?.learningPathId || data.currentStage === 'path' || data.currentStage === 'learning')) {
      await loadPathStatus()
    }
    if (data.stageResults?.experiment?.mode === 'blackbox-api') {
      await loadBlackboxSnapshot()
      if (!isTerminal.value && activeDetailTab.value === 'json') activeDetailTab.value = 'bindings'
    } else {
      blackboxSnapshot.value = null
    }
  } catch (error: any) {
    ElMessage.error(error.message || '加载会话失败')
  } finally {
    loading.value = false
  }
}

const loadPathStatus = async () => {
  try {
    const res = await adminApi.getVirtualSessionPathStatus(sessionId)
    if (res.data?.success) {
      pathStatus.value = res.data.data?.status || 'idle'
      pathData.value = res.data.data
    }
  } catch {
    pathStatus.value = 'idle'
    pathData.value = null
  }
}

let logsInFlight = false
const loadLogs = async () => {
  if (logsInFlight) return
  logsInFlight = true
  try {
    const res = await adminApi.getVirtualSessionLogs(sessionId)
    const logs = res.data?.data?.logs
    if (res.data?.success && Array.isArray(logs)) {
      logsPollingDisabled.value = false
      logEntries.value = logs.map((l: any) => ({
        id: l.id || l._id,
        timestamp: l.createdAt || l.timestamp,
        phase: l.phase || l.level || 'info',
        message: l.message || l.content || ''
      }))
    }
  } catch (error: any) {
    if ([401, 403].includes(error?.response?.status)) {
      logsPollingDisabled.value = true
    }
  } finally {
    logsInFlight = false
  }
}

/* ===== Control actions ===== */
const withSession = async (runner: (sid: string) => Promise<void>) => {
  await runner(sessionId)
}

const handleStep = async () => {
  navManuallyOverridden.value = false
  if (isBlackboxMode.value) {
    loadingStep.value = true
    try {
      const res = await adminApi.blackboxVirtualSessionStep(sessionId)
      if (!res.data?.success) throw new Error(res.data?.error || '黑盒单步失败')
      if (res.data?.data?.waitingForObservation) {
        ElMessage.info('Path 或阶段任务仍在生成，本轮只刷新结果')
      } else if (res.data?.data?.result?.observation?.stage === 'learning') {
        ElMessage.success('Path 已就绪，已进入 Learn')
      }
      await loadSession()
    } catch (error: any) {
      ElMessage.error(error.response?.data?.error || error.message || '黑盒单步失败')
    } finally {
      loadingStep.value = false
    }
    return
  }
  if (currentStage.value === 'goal') {
    loadingStep.value = true
    try {
      await withSession(async (sid) => {
        const res = await adminApi.virtualSessionStep(sid)
        if (!res.data?.success) throw new Error(res.data?.error || '单步失败')
      })
      await loadSession()
    } catch (error: any) {
      ElMessage.error(error.message || 'Goal 单步失败')
    } finally {
      loadingStep.value = false
    }
  } else if (currentStage.value === 'learning') {
    loadingStep.value = true
    try {
      await withSession(async (sid) => {
        const res = await adminApi.virtualSessionLearningStep(sid)
        if (!res.data?.success) throw new Error(res.data?.error || '单步失败')
      })
      await loadSession()
    } catch (error: any) {
      ElMessage.error(error.message || 'Learn 单步失败')
    } finally {
      loadingStep.value = false
    }
  }
}

const handleGenerateReferee = async () => {
  navManuallyOverridden.value = false
  loadingReferee.value = true
  try {
    const res = await adminApi.generateBlackboxRefereeReport(sessionId)
    if (!res.data?.success) throw new Error(res.data?.error || '裁判报告生成失败')
    ElMessage.success(res.data?.data?.reused ? '已复用当前轨迹的裁判报告' : '裁判报告已生成')
    await loadBlackboxSnapshot()
    activeNav.value = 'referee'
  } catch (error: any) {
    ElMessage.error(error.response?.data?.error || error.message || '裁判报告生成失败')
  } finally {
    loadingReferee.value = false
  }
}

const handleAuto = async () => {
  if (currentStage.value === 'goal') {
    loadingAuto.value = true
    try {
      // 如果勾了"自动进 Path + 自动进 Learn",用一键全流程
      if (cockpitConfig.value.autoAdvanceToPath && cockpitConfig.value.autoAdvanceToLearning) {
        await withSession(async (sid) => {
          const res = await adminApi.virtualSessionRunFull(sid, {
            maxRounds: cockpitConfig.value.maxRounds,
            maxMilestones: cockpitConfig.value.maxMilestones,
            continueOnTaskComplete: cockpitConfig.value.continueOnTaskComplete,
            autoAdvanceToPath: true,
            autoAdvanceToLearning: true
          })
          if (!res.data?.success) throw new Error(res.data?.error || '一键全流程失败')
        })
      } else {
        await withSession(async (sid) => {
          const res = await adminApi.virtualSessionAuto(sid, { maxRounds: cockpitConfig.value.maxRounds })
          if (!res.data?.success) throw new Error(res.data?.error || '自动失败')
        })
        // auto-advance to path
        await loadSession()
        if (cockpitConfig.value.autoAdvanceToPath && goalReady.value && !bindings.value.learningPathId) {
          await handleAdvancePath()
        }
      }
      await loadSession()
    } catch (error: any) {
      ElMessage.error(error.message || 'Goal 自动失败')
    } finally {
      loadingAuto.value = false
    }
  } else if (currentStage.value === 'learning') {
    loadingAuto.value = true
    try {
      await withSession(async (sid) => {
        const res = await adminApi.virtualSessionAutoLearning(sid, { maxMilestones: cockpitConfig.value.maxMilestones })
        if (!res.data?.success) throw new Error(res.data?.error || '自动学习失败')
      })
      await loadSession()
    } catch (error: any) {
      ElMessage.error(error.message || 'Learn 自动失败')
    } finally {
      loadingAuto.value = false
    }
  }
}

const handleAdvancePath = async () => {
  loadingBridge.value = true
  try {
    await withSession(async (sid) => {
      const res = await adminApi.virtualSessionAdvancePath(sid)
      if (!res.data?.success) throw new Error(res.data?.error || '生成 Path 失败')
    })
    await loadSession()
    await loadPathStatus()

    // auto-advance to learning
    if (cockpitConfig.value.autoAdvanceToLearning && pathReady.value) {
      await handleStartLearning()
    }
  } catch (error: any) {
    ElMessage.error(error.message || '生成 Path 失败')
  } finally {
    loadingBridge.value = false
  }
}

const loadBlackboxSnapshot = async () => {
  try {
    const res = await adminApi.getBlackboxVirtualSnapshot(sessionId)
    if (res.data?.success) blackboxSnapshot.value = res.data.data
  } catch {
    blackboxSnapshot.value = null
  }
}

const handleReviewPath = async () => {
  loadingBridge.value = true
  try {
    const res = await adminApi.reviewVirtualSessionPath(sessionId)
    if (!res.data?.success) throw new Error(res.data?.error || 'Path 评审失败')
    const result = res.data.data
    ElMessage.success(result?.decision === 'accept' ? 'Path 已接受，已进入 Learn' : 'Path 已根据评审反馈重规划，等待再次评审')
    await loadSession()
    await loadPathStatus()
    await loadLogs()
  } catch (error: any) {
    ElMessage.error(error.message || 'Path 评审失败')
  } finally {
    loadingBridge.value = false
  }
}

const handleStartLearning = async () => {
  loadingBridge.value = true
  try {
    await withSession(async (sid) => {
      const res = await adminApi.startVirtualLearning(sid)
      if (!res.data?.success) throw new Error(res.data?.error || '启动 Learn 失败')
    })
    activeNav.value = 'learning'
    await loadSession()
  } catch (error: any) {
    ElMessage.error(error.message || '启动 Learn 失败')
  } finally {
    loadingBridge.value = false
  }
}

const handleStop = async () => {
  try {
    await ElMessageBox.confirm('确认停止当前学习? 当前轮跑完后将停止.', '停止学习', {
      type: 'warning',
      confirmButtonText: '停止',
      cancelButtonText: '继续'
    })
    await withSession(async (sid) => {
      const res = await adminApi.stopVirtualLearning(sid)
      if (!res.data?.success) throw new Error(res.data?.error || '停止失败')
    })
    ElMessage.success('学习已停止')
    await loadSession()
  } catch (error: any) {
    if (error !== 'cancel') ElMessage.error(error.message || '停止失败')
  }
}

const handleResetPath = async () => {
  try {
    await ElMessageBox.confirm('确认重建 Path? 当前 Path 与 Learn 进度将清空.', '重建 Path', {
      type: 'warning',
      confirmButtonText: '重建',
      cancelButtonText: '取消'
    })
    await withSession(async (sid) => {
      const res = await adminApi.restartVirtualSessionPath(sid)
      if (!res.data?.success) throw new Error(res.data?.error || '重建 Path 失败')
    })
    ElMessage.success('Path 已重建')
    await loadSession()
    await loadPathStatus()
  } catch (error: any) {
    if (error !== 'cancel') ElMessage.error(error.message || '重建 Path 失败')
  }
}

const handleResetLearn = async () => {
  try {
    await ElMessageBox.confirm('确认重启 Learn? 当前 task 的学习进度将清空.', '重启 Learn', {
      type: 'warning',
      confirmButtonText: '重启',
      cancelButtonText: '取消'
    })
    await withSession(async (sid) => {
      const res = await adminApi.restartVirtualLearning(sid)
      if (!res.data?.success) throw new Error(res.data?.error || '重启 Learn 失败')
    })
    ElMessage.success('Learn 已重启')
    await loadSession()
  } catch (error: any) {
    if (error !== 'cancel') ElMessage.error(error.message || '重启 Learn 失败')
  }
}

const handleGenerateWrapup = async () => {
  loadingWrapup.value = true
  try {
    await withSession(async (sid) => {
      const res = await adminApi.virtualSessionWrapup(sid)
      if (!res.data?.success) throw new Error(res.data?.error || '生成总结失败')
    })
    ElMessage.success('总结已生成')
    await loadSession()
  } catch (error: any) {
    ElMessage.error(error.message || '生成总结失败')
  } finally {
    loadingWrapup.value = false
  }
}

const handleDeleteSession = async () => {
  try {
    await ElMessageBox.confirm('确认删除此会话？此操作不可撤销。', '删除会话', { type: 'warning' })
    await withSession(async (sid) => {
      const res = await adminApi.deleteVirtualSession(sid)
      if (!res.data?.success) throw new Error(res.data?.error || '删除失败')
    })
    ElMessage.success('会话已删除')
    backToStory()
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || '删除失败')
    }
  }
}

const handleConfigChange = async (config: any) => {
  const prevFriction = cockpitConfig.value.frictionBudget
  cockpitConfig.value = { ...cockpitConfig.value, ...config }
  // 仅 frictionBudget 变化时持久化到后端 session
  if (config.frictionBudget && config.frictionBudget !== prevFriction) {
    try {
      await adminApi.updateSessionSimulationConfig(sessionId, {
        frictionBudget: config.frictionBudget
      })
    } catch (err: any) {
      ElMessage.warning(`对抗预算保存失败: ${err.message || err}`)
    }
  }
}

/* ===== Navigation ===== */
const selectStage = (key: string) => {
  activeNav.value = key as any
  navManuallyOverridden.value = true
}

const backToStory = () => {
  const profileId = session.value?.profile?.id || session.value?.profileId || session.value?.virtualLearnerId
  const storyId = session.value?.storyContext?.storyId || session.value?.runtime?.story?.storyId

  if (profileId && storyId) {
    router.push(`/admin/virtual-learners/${profileId}/stories/${storyId}`)
    return
  }

  if (profileId) {
    router.push(`/admin/virtual-learners/${profileId}`)
    return
  }

  router.push('/admin/virtual-learners')
}

const formatEventTime = (time?: string) => {
  if (!time) return '--'
  const d = new Date(time)
  return d.toLocaleTimeString('zh-CN', { hour12: false })
}

/* ===== Lifecycle ===== */
onMounted(async () => {
  await loadSession()
  await loadLogs()
})

// 标志: 用户主动切换 nav 后, watch 不再强制同步到 currentStage
const navManuallyOverridden = ref(false)

watch(currentStage, async (stage) => {
  if (!isBlackboxMode.value && (stage === 'path' || stage === 'learning' || stage === 'wrapup')) {
    await loadPathStatus()
  }
  if (!navManuallyOverridden.value && stageOrder.value.includes(stage as any)) {
    activeNav.value = stage as any
  }
})

watch(status, (newStatus) => {
  if (['completed', 'failed', 'abandoned'].includes(newStatus)) {
    activeNav.value = isBlackboxMode.value ? 'referee' : 'wrapup'
    navManuallyOverridden.value = false
  }
})
</script>

<style scoped>
/* ===== Layout ===== */
.cockpit-page {
  display: grid;
  gap: 12px;
  background: #f6f8fc;
  min-height: 100%;
}

/* Topbar */
.cockpit-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 10px;
  border-bottom: var(--admin-border-subtle);
}

.cockpit-topbar__stage-strip {
  display: flex;
  align-items: center;
  gap: 4px;
}

.stage-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px 4px 8px;
  border-radius: 999px;
  background: #f0f2f5;
  color: #5b6577;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  border: 1px solid transparent;
}

.stage-chip.active {
  background: #e8f0ff;
  color: #3478f6;
  border-color: #3478f6;
}

.stage-chip.done {
  background: #ecfdf5;
  color: #16a34a;
  border-color: #a7f3d0;
}

.stage-chip.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.stage-chip:not(.disabled):hover { opacity: 0.8; }

.stage-chip__dot {
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: #e1e8f2;
  color: #94a3b8;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 800;
}

.stage-chip.active .stage-chip__dot { background: #3478f6; color: white; }
.stage-chip.done .stage-chip__dot { background: #16a34a; color: white; }

.stage-chip__check { font-size: 11px; }

.cockpit-topbar__tags {
  display: flex;
  align-items: center;
  gap: 8px;
}

.blackbox-observation {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  padding: 10px 12px;
  border: 1px solid #cddced;
  border-radius: 8px;
  background: #f7faff;
}

.blackbox-observation__result {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.blackbox-observation__result span {
  color: #697386;
  font-size: 10px;
  font-weight: 700;
}

.blackbox-observation__result strong {
  overflow: hidden;
  color: #1a2a44;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.blackbox-observation__result p {
  overflow: hidden;
  margin: 0;
  color: #667085;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.blackbox-observation__ids {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.blackbox-observation__ids code,
.blackbox-action-list code {
  padding: 3px 7px;
  border: 1px solid #d6e3f1;
  border-radius: 5px;
  background: #ffffff;
  color: #36516f;
  font-size: 10px;
}

.blackbox-action-list {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
}

.cockpit-main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 16px;
  align-items: start;
}

/* Center stage panel */
.cockpit-stage {
  display: grid;
  gap: 12px;
  min-height: 400px;
}

.stage-panel {
  padding: 16px 18px;
  border: var(--admin-border-subtle);
  border-radius: var(--admin-radius-md);
  background: var(--admin-bg-surface);
}

.stage-panel__head {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 14px;
  padding-bottom: 12px;
  border-bottom: var(--admin-border-subtle);
}

.stage-panel__head h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 800;
  color: var(--admin-text-primary);
}

.stage-panel__task-meta {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.task-badge, .ms-badge {
  font-size: 11px;
  padding: 2px 10px;
  border-radius: 999px;
  background: #f0f5ff;
  color: #3478f6;
  border: 1px solid #c9dcfc;
  font-weight: 600;
}

.ms-badge {
  background: #f0fdf4;
  color: #16a34a;
  border-color: #bfe5cb;
}

.stage-panel__empty {
  padding: 32px 0;
  text-align: center;
  color: var(--admin-text-muted);
  font-size: 13px;
}

/* Conversation */
.conversation-list {
  display: grid;
  gap: 8px;
  max-height: 520px;
  overflow-y: auto;
}

.conv-round {
  display: grid;
  gap: 6px;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.55;
  box-shadow: none;
}

.conv-round--teacher {
  background: #f0f5ff;
  border: 1px solid #dbeafe;
}

.conv-round--learner {
  background: #faf5ff;
  border: 1px solid #e9d5ff;
  margin-left: 20px;
}

.conv-round__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.conv-round__role {
  font-weight: 700;
  font-size: 11px;
  color: #5b6577;
}

.conv-round__idx {
  font-size: 10px;
  color: #94a3b8;
}

.conv-round__msg {
  margin: 0;
  color: #1a2a44;
}

.conv-round__signals {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.signal-chip {
  font-size: 10px;
  background: var(--admin-bg-surface);
  border: 1px solid #e1e8f2;
  border-radius: 4px;
  padding: 1px 6px;
  color: #5b6577;
}

.conv-round__closure {
  display: flex;
  gap: 6px;
}

.conv-round__closure span {
  font-size: 11px;
  font-weight: 800;
  padding: 1px 8px;
  border-radius: 4px;
  background: #f0fdf4;
  color: #16a34a;
}

/* Concern pool */
.stage-panel__detail {
  margin-top: 12px;
  padding: 10px 12px;
  background: var(--admin-bg-surface-alt);
  border: var(--admin-border-subtle);
  border-radius: 8px;
}

.stage-panel__detail summary {
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
  color: #5b6577;
  list-style: none;
}

.stage-panel__detail summary::-webkit-details-marker { display: none; }

.concern-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.concern-chip {
  font-size: 11px;
  padding: 2px 10px;
  border-radius: 999px;
  background: #f0f2f5;
  color: #94a3b8;
  border: 1px solid #e1e8f2;
}

.concern-chip.disclosed {
  background: #e8f0ff;
  color: #3478f6;
  border-color: #c9dcfc;
}

/* Path milestones */
.milestone-list {
  display: grid;
  gap: 12px;
}

.milestone-card {
  padding: 12px 14px;
  border: 1px solid #e1e8f2;
  border-radius: 8px;
  background: var(--admin-bg-surface-alt);
}

.milestone-card__head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.milestone-card__num {
  width: 24px;
  height: 24px;
  border-radius: 999px;
  background: #eef2f7;
  color: #5b6577;
  font-weight: 800;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.milestone-card__head strong {
  font-size: 14px;
  color: #1a2a44;
}

.milestone-card__desc {
  font-size: 12px;
  color: #5b6577;
  margin: 8px 0 0;
}

.task-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.task-chip {
  font-size: 11px;
  padding: 2px 10px;
  border-radius: 999px;
  background: #f0f2f5;
  color: #5b6577;
  border: 1px solid #e1e8f2;
}

.task-chip.active {
  background: #e8f0ff;
  color: #3478f6;
  border-color: #3478f6;
}

.task-chip.done {
  background: #ecfdf5;
  color: #16a34a;
  border-color: #bfe5cb;
}

/* Wrapup */
.wrapup-card {
  padding: 12px 14px;
  background: #f0fdf4;
  border: 1px solid #bfe5cb;
  border-radius: 8px;
  margin-bottom: 12px;
  box-shadow: none;
}

.wrapup-card__head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  font-size: 13px;
  color: #16a34a;
  margin-bottom: 6px;
}

.wrapup-card p {
  margin: 0;
  font-size: 13px;
  color: #1a2a44;
  line-height: 1.55;
}

.wrapup-full {
  display: grid;
  gap: 14px;
}

.wrapup-evaluation {
  display: grid;
  gap: 8px;
  padding: 12px 14px;
  background: #f0f5ff;
  border: 1px solid #c9dcfc;
  border-radius: 8px;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.metric-cell {
  display: grid;
  gap: 2px;
  padding: 8px;
  background: var(--admin-bg-surface);
  border-radius: 8px;
  text-align: center;
}

.metric-cell span {
  font-size: 10px;
  color: #94a3b8;
  font-weight: 700;
  text-transform: uppercase;
}

.metric-cell strong {
  font-size: 16px;
  color: #1a2a44;
  font-weight: 800;
}

.wrapup-evaluation__reasoning {
  margin: 0;
  font-size: 12px;
  color: #5b6577;
  line-height: 1.5;
}

.wrapup-section {
  display: grid;
  gap: 4px;
}

.wrapup-section__label {
  font-weight: 700;
  font-size: 13px;
  color: #1a2a44;
}

.wrapup-section p {
  margin: 0;
  font-size: 13px;
  color: #5b6577;
  line-height: 1.55;
}

/* Right side */
.cockpit-side {
  display: grid;
  gap: 12px;
  align-content: start;
  padding-top: 4px;
  border-top: var(--admin-border-subtle);
}

/* Bottom detail */
.cockpit-detail {
  padding-top: 10px;
  border-top: var(--admin-border-subtle);
}

.cockpit-detail > summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  cursor: pointer;
  color: #5b6577;
  font-size: 12px;
  font-weight: 700;
  list-style: none;
}

.cockpit-detail > summary::-webkit-details-marker {
  display: none;
}

.cockpit-detail > summary code {
  color: #8a94a6;
  font-size: 10px;
}

.detail-tabs {
  display: flex;
  gap: 4px;
  margin: 12px 0 4px;
  border-bottom: 1px solid #e1e8f2;
}

.detail-tab {
  padding: 6px 16px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  color: #94a3b8;
  transition: all 0.18s;
}

.detail-tab.active {
  color: #3478f6;
  border-bottom-color: #3478f6;
}

.binding-grid {
  display: grid;
  gap: 8px;
}

.binding-row {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid #f0f2f5;
}

.binding-row__key {
  font-size: 12px;
  font-weight: 700;
  color: #5b6577;
  min-width: 140px;
}

.binding-row__val {
  font-size: 12px;
  color: #1a2a44;
  word-break: break-all;
}

.empty-text {
  color: #94a3b8;
  font-size: 13px;
  padding: 16px 0;
}

.referee-report {
  display: grid;
  gap: 18px;
}

.referee-report__hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 16px;
  border: 1px solid #dbe5f0;
  border-radius: 10px;
  background: #f8fafc;
}

.referee-report__hero span,
.referee-report__hero p {
  color: #7a8597;
  font-size: 11px;
}

.referee-report__hero p,
.referee-finding p,
.referee-recommendation p {
  margin: 4px 0 0;
  line-height: 1.55;
}

.referee-report__hero > div:first-child > strong {
  display: block;
  margin-top: 4px;
  color: #1a2a44;
  font-size: 17px;
}

.referee-score {
  display: grid;
  justify-items: center;
  min-width: 88px;
  padding-left: 18px;
  border-left: 1px solid #dbe5f0;
}

.referee-score strong {
  color: #1f5dbb;
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 32px;
}

.referee-score-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 1px;
  overflow: hidden;
  border: 1px solid #e1e8f2;
  border-radius: 8px;
  background: #e1e8f2;
}

.referee-score-grid > div {
  display: grid;
  gap: 5px;
  padding: 12px;
  background: #ffffff;
}

.referee-score-grid span {
  color: #8a94a6;
  font-size: 10px;
}

.referee-score-grid strong {
  color: #1a2a44;
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 17px;
}

.referee-report__section {
  display: grid;
  gap: 9px;
}

.referee-report__section h4 {
  margin: 0;
  color: #344054;
  font-size: 13px;
}

.referee-finding,
.referee-recommendation {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid #edf1f5;
}

.referee-finding strong,
.referee-recommendation strong {
  color: #344054;
  font-size: 12px;
}

.referee-finding p,
.referee-recommendation p {
  color: #667085;
  font-size: 12px;
}

.json-block {
  font-size: 11px;
  font-family: 'Cascadia Code', 'JetBrains Mono', Consolas, monospace;
  background: #fafbfc;
  padding: 12px;
  border-radius: 8px;
  max-height: 400px;
  overflow: auto;
  color: #1a2a44;
  white-space: pre-wrap;
  word-break: break-all;
}

/* ===== Responsive ===== */
@media (max-width: 1200px) {
  .cockpit-main {
    grid-template-columns: 1fr;
    grid-template-rows: auto;
  }

  .referee-score-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .cockpit-topbar,
  .referee-report__hero {
    align-items: stretch;
    flex-direction: column;
  }

  .blackbox-observation {
    grid-template-columns: 1fr;
  }

  .cockpit-topbar__stage-strip,
  .detail-tabs {
    overflow-x: auto;
  }

  .blackbox-observation__ids {
    justify-content: flex-start;
  }

  .referee-score {
    justify-items: start;
    padding: 12px 0 0;
    border-top: 1px solid #dbe5f0;
    border-left: 0;
  }

  .referee-score-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
