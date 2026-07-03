<template>
  <div class="admin-page cockpit-page">
    <AdminPageHeader
      title="虚拟会话控制台"
      :icon="Monitor"
      :highlights="cockpitHighlights"
    >
      <template #actions>
        <el-button @click="backToStory">
          <el-icon><ArrowLeft /></el-icon>
          {{ profileName || '返回故事' }}
        </el-button>
        <el-button @click="loadSession" :loading="loading">
          <el-icon><Refresh /></el-icon>
          刷新会话
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
        <el-tag :type="statusTagType" size="small" effect="dark">{{ statusText }}</el-tag>
      </div>
    </section>

    <section class="cockpit-overview">
      <div class="cockpit-overview__main">
        <div class="cockpit-overview__copy">
          <h2>{{ activeStageMeta.title }}</h2>
          <p>{{ activeStageMeta.desc }}</p>
        </div>
        <div class="cockpit-overview__facts">
          <article class="cockpit-glance-card">
            <span>当前阶段</span>
            <strong>{{ activeStageMeta.label }}</strong>
          </article>
          <article class="cockpit-glance-card">
            <span>当前任务</span>
            <strong>{{ currentTaskTitle || '未绑定 Task' }}</strong>
          </article>
          <article class="cockpit-glance-card">
            <span>路径状态</span>
            <strong>{{ pathStatusText }}</strong>
          </article>
          <article class="cockpit-glance-card">
            <span>日志条数</span>
            <strong>{{ logEntries.length }}</strong>
          </article>
        </div>
      </div>
      <div class="cockpit-overview__summary">
        <article class="cockpit-summary-card">
          <span class="cockpit-summary-card__label">当前绑定</span>
          <strong>{{ bindingSummaryLabel }}</strong>
          <p>{{ bindingSummaryDesc }}</p>
        </article>
        <article class="cockpit-summary-card">
          <span class="cockpit-summary-card__label">下一步建议</span>
          <strong>{{ nextActionTitle }}</strong>
          <p>{{ nextActionDesc }}</p>
        </article>
      </div>
    </section>

    <!-- ============ 3-column main ============ -->
    <div class="cockpit-main">
      <!-- Left: Stage nav -->
      <aside class="cockpit-nav">
        <div class="cockpit-nav__head">阶段</div>
        <button
          v-for="s in stageNavItems"
          :key="s.key"
          type="button"
          class="nav-btn"
          :class="{ active: activeNav === s.key, disabled: s.disabled }"
          :disabled="s.disabled"
          @click="selectStage(s.key)"
        >
          <span class="nav-btn__dot" :class="{ done: s.done, active: activeNav === s.key }"></span>
          <span class="nav-btn__label">{{ s.label }}</span>
          <span v-if="s.done" class="nav-btn__badge">✓</span>
        </button>
      </aside>

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
            <p>{{ goalConversation.length ? '' : 'Goal 对话尚未开始。点击"单步"启动。' }}</p>
          </div>

          <!-- Concern pool -->
          <details v-if="concernPool" class="stage-panel__detail">
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
            <p>{{ pathReady ? '无法解析路径里程碑' : 'Path 尚未生成。' }}</p>
          </div>

          <!-- Path review -->
          <details v-if="pathReview" class="stage-panel__detail">
            <summary>Path 接受评估</summary>
            <p>反应: {{ pathReview.reaction }}</p>
            <p v-if="pathReview.biggestConcern">最大顾虑: {{ pathReview.biggestConcern }}</p>
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

          <!-- Wrapup summary (if available) -->
          <div v-if="wrapupSummary" class="wrapup-card">
            <div class="wrapup-card__head">
              <el-icon><Finished /></el-icon>
              <span>学习评估结果</span>
            </div>
            <p>{{ typeof wrapupSummary === 'string' ? wrapupSummary : wrapupSummary?.overallAssessment || '' }}</p>
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
            <p>Learn 对话尚未开始。先在 Path 阶段选一个 task。</p>
          </div>

          <!-- Knowledge progress -->
          <details v-if="knowledgeProgress" class="stage-panel__detail">
            <summary>知识进展</summary>
            <pre class="json-block">{{ JSON.stringify(knowledgeProgress, null, 2) }}</pre>
          </details>
        </div>

        <!-- Wrapup -->
        <div v-if="activeNav === 'wrapup'" class="stage-panel">
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
            <p>{{ learningStarted ? '尚未生成总结。点击"立即生成总结"。' : '需先开始学习。' }}</p>
          </div>
        </div>
      </section>

      <!-- Right: Control + Log -->
      <aside class="cockpit-side">
        <SessionControlPanel
          :current-stage="currentStage"
          :status="status"
          :goal-ready="goalReady"
          :path-ready="pathReady"
          :learning-started="learningStarted"
          :config="cockpitConfig"
          :loading-step="loadingStep"
          :loading-auto="loadingAuto"
          :loading-bridge="loadingBridge"
          @step="handleStep"
          @auto="handleAuto"
          @stop="handleStop"
          @advance-path="handleAdvancePath"
          @start-learning="handleStartLearning"
          @reset-path="handleResetPath"
          @reset-learn="handleResetLearn"
          @delete-session="handleDeleteSession"
          @update:config="handleConfigChange"
        />
        <SessionLiveLog ref="logRef" :entries="logEntries" @poll="loadLogs" />
      </aside>
    </div>

    <section class="cockpit-detail">
      <div class="cockpit-detail__head">
        <div>
          <h3>会话诊断明细</h3>
          <p>绑定、事件和快照信息</p>
        </div>
        <el-tag size="small" type="info">{{ sessionId?.slice(0, 8) ?? '--' }}</el-tag>
      </div>
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

      <!-- Events -->
      <div v-if="activeDetailTab === 'events'" class="detail-pane">
        <div v-if="events.length" class="event-list">
          <div v-for="(ev, i) in events" :key="i" class="event-item">
            <span class="event-item__time">{{ formatEventTime(ev.createdAt) }}</span>
            <span class="event-item__type">{{ ev.type }}</span>
            <span class="event-item__msg">{{ ev.message }}</span>
          </div>
        </div>
        <div v-else class="empty-text">暂无事件记录</div>
      </div>

      <!-- Raw JSON -->
      <div v-if="activeDetailTab === 'json'" class="detail-pane">
        <pre class="json-block">{{ JSON.stringify(rawSession, null, 2) }}</pre>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, Refresh, Finished, Monitor } from '@element-plus/icons-vue'
import { adminApi } from '@/api/adminApi'
import AdminPageHeader from './components/AdminPageHeader.vue'
import SessionControlPanel from './components/virtual/SessionControlPanel.vue'
import SessionLiveLog, { type LogEntry } from './components/virtual/SessionLiveLog.vue'

const router = useRouter()
const route = useRoute()
const sessionId = route.params.sessionId as string

/* ===== Reactive state ===== */
const session = ref<any>(null)
const rawSession = ref<any>(null)
const loading = ref(false)
const logEntries = ref<LogEntry[]>([])
const profileName = ref('')

const loadingStep = ref(false)
const loadingAuto = ref(false)
const loadingBridge = ref(false)
const loadingWrapup = ref(false)

const activeNav = ref<'goal' | 'path' | 'learning' | 'wrapup'>('goal')
const activeDetailTab = ref<'bindings' | 'events' | 'json'>('bindings')

const logRef = ref<InstanceType<typeof SessionLiveLog> | null>(null)

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
  return !!bindings.value.learningPathId && ['active', 'ready', 'completed'].includes(pathStatus.value)
})

const pathStatus = ref<string>('idle')
const pathStatusText = computed(() => {
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
  if (!pathData.value?.milestones) return []
  return pathData.value.milestones
})

const pathReview = computed(() => session.value?.runtime?.stageStatus?.path?.review || stageResults.value?.path_review || null)

/* Learn */
const learningStarted = computed(() => !!bindings.value.currentTaskId || !!bindings.value.teachingSessionId)
const currentTaskId = computed(() => bindings.value.currentTaskId)
const currentTaskTitle = computed(() => {
  return stageResults.value?.learning?.currentTaskTitle || stageResults.value?.learning?.taskRuntime?.taskTitle || null
})
const currentMilestoneTitle = computed(() => {
  return stageResults.value?.learning?.currentMilestoneTitle || null
})

const learnConversation = computed<any[]>(() => {
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
    default: return 'info'
  }
})

const statusText = computed(() => {
  switch (status.value) {
    case 'created': return '已创建'
    case 'running': return '运行中'
    case 'completed': return '已完成'
    case 'failed': return '失败'
    default: return status.value
  }
})

const stageOrder = ['goal', 'path', 'learning', 'wrapup']
const stageIndex = computed(() => Math.max(stageOrder.indexOf(currentStage.value), 0))

const stageStripItems = computed(() => {
  return stageOrder.map((key, idx) => ({
    key,
    label: key === 'goal' ? 'Goal' : key === 'path' ? 'Path' : key === 'learning' ? 'Learn' : 'Wrapup',
    done: idx < stageIndex.value || status.value === 'completed',
    disabled: idx > stageIndex.value && status.value !== 'completed'
  }))
})

const cockpitHighlights = computed(() => [
  { label: `状态 ${statusText.value}`, tone: status.value === 'completed' ? 'success' as const : status.value === 'failed' ? 'danger' as const : 'info' as const },
  { label: `当前阶段 ${currentStage.value}`, tone: 'neutral' as const },
  { label: bindings.value.currentTaskId ? `Task ${bindings.value.currentTaskId}` : '尚未绑定 Task', tone: bindings.value.currentTaskId ? 'warning' as const : 'neutral' as const },
  { label: `Session ${sessionId}`, tone: 'neutral' as const }
])

const activeStageMeta = computed(() => {
  switch (activeNav.value) {
    case 'goal':
      return {
        key: 'goal',
        label: 'Goal',
        title: '目标对齐工作区',
        desc: goalConversation.value.length
          ? '对话进行中'
          : '待推进 Goal 对话'
      }
    case 'path':
      return {
        key: 'path',
        label: 'Path',
        title: '学习路径工作区',
        desc: pathReady.value
          ? '路径已就绪'
          : '待生成路径'
      }
    case 'learning':
      return {
        key: 'learning',
        label: 'Learn',
        title: '教学活动工作区',
        desc: learningStarted.value
          ? '教学轮次进行中'
          : '待推进 Learn 轮次'
      }
    default:
      return {
        key: 'wrapup',
        label: 'Wrapup',
        title: '学习总结工作区',
        desc: wrapupSummary.value
          ? '总结已生成'
          : '待生成总结'
      }
  }
})

const bindingSummaryLabel = computed(() => {
  if (bindings.value.currentTaskId) return '已绑定当前任务'
  if (bindings.value.learningPathId) return '已绑定路径'
  if (bindings.value.goalConversationId) return '已绑定 Goal 对话'
  return '待绑定'
})

const bindingSummaryDesc = computed(() => {
  if (bindings.value.currentTaskId) return `task: ${bindings.value.currentTaskId}`
  if (bindings.value.learningPathId) return `path: ${bindings.value.learningPathId}`
  if (bindings.value.goalConversationId) return `goalConversation: ${bindings.value.goalConversationId}`
  return '等待阶段产出绑定。'
})

const nextActionTitle = computed(() => {
  if (status.value === 'failed') return '先看事件和日志'
  if (activeNav.value === 'goal' && !goalReady.value) return '继续推进 Goal'
  if (activeNav.value === 'path' && !pathReady.value) return '生成或复核 Path'
  if (activeNav.value === 'learning' && learningStarted.value) return '继续推进当前 task'
  if (activeNav.value === 'wrapup' && !wrapupSummary.value) return '生成总结'
  return '检查当前阶段结果'
})

const nextActionDesc = computed(() => {
  if (status.value === 'failed') return '会话已失败，查看事件和日志。'
  if (activeNav.value === 'goal' && !goalReady.value) return '推进 Goal 对话，收敛后进入 Path。'
  if (activeNav.value === 'path' && !pathReady.value) return 'Goal 已收敛时可从右侧发起 Path 生成。'
  if (activeNav.value === 'learning' && learningStarted.value) return currentTaskTitle.value ? `当前任务是 ${currentTaskTitle.value}` : '推进当前学习轮次。'
  if (activeNav.value === 'wrapup' && !wrapupSummary.value) return '完成 Learn 后可在此触发总结。'
  return '阶段已有结果。'
})

const stageNavItems = computed(() => {
  return stageOrder.map((key, idx) => ({
    key,
    label: key === 'goal' ? '目标对齐' : key === 'path' ? '学习路径' : key === 'learning' ? '教学活动' : '学习总结',
    done: idx < stageIndex.value || status.value === 'completed',
    disabled: idx > stageIndex.value && status.value !== 'completed'
  }))
})

const events = computed(() => {
  const s = session.value
  if (!s) return []
  const logs = s.logs || s.runtime?.logs || []
  return Array.isArray(logs) ? logs : []
})

const detailTabs = [
  { key: 'bindings', label: '当前绑定' },
  { key: 'events', label: '事件' },
  { key: 'json', label: '原始数据' }
]

/* ===== Data loading ===== */
const loadSession = async () => {
  loading.value = true
  try {
    const res = await adminApi.getVirtualSession(sessionId)
    if (!res.data?.success) throw new Error(res.data?.error || '加载失败')
    const data = res.data.data
    session.value = data
    rawSession.value = data
    
    // profile name
    if (data.profile?.name) {
      profileName.value = data.profile.name
    }

    // 从 stageResults.simulationConfig 同步 frictionBudget 回 cockpitConfig
    const sessionFriction = data.stageResults?.simulationConfig?.frictionBudget
    if (sessionFriction && ['none','low','normal','high','stress_test'].includes(sessionFriction)) {
      cockpitConfig.value.frictionBudget = sessionFriction
    }

    // Load path status
    if (data.bindings?.learningPathId || data.currentStage === 'path' || data.currentStage === 'learning') {
      await loadPathStatus()
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
  }
}

let logsInFlight = false
const loadLogs = async () => {
  if (logsInFlight) return
  logsInFlight = true
  try {
    const res = await adminApi.getVirtualSessionLogs(sessionId)
    if (res.data?.success && Array.isArray(res.data.data)) {
      logEntries.value = res.data.data.map((l: any) => ({
        id: l.id || l._id,
        timestamp: l.createdAt || l.timestamp,
        phase: l.phase || l.level || 'info',
        message: l.message || l.content || '',
        details: l
      }))
    }
  } catch {
    // silent
  } finally {
    logsInFlight = false
  }
}

/* ===== Control actions ===== */
const withSession = async (runner: (sid: string) => Promise<void>) => {
  await runner(sessionId)
}

const handleStep = async () => {
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
  logRef.value?.startPolling()
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
  logRef.value?.startPolling()
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

onUnmounted(() => {
  logRef.value?.stopPolling()
})

// 标志: 用户主动切换 nav 后, watch 不再强制同步到 currentStage
const navManuallyOverridden = ref(false)

watch(currentStage, async (stage) => {
  if (stage === 'path' || stage === 'learning' || stage === 'wrapup') {
    await loadPathStatus()
  }
  // 仅在用户未手动切换时, 同步 nav 到当前阶段
  if (!navManuallyOverridden.value && stageOrder.includes(stage)) {
    activeNav.value = stage as any
  }
})

// status=completed 时自动跳到 wrapup (不抢用户已切走的状态)
watch(status, (newStatus) => {
  if (newStatus === 'completed' && !navManuallyOverridden.value) {
    activeNav.value = 'wrapup'
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

.cockpit-overview {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(280px, 0.9fr);
  gap: 14px;
  align-items: stretch;
  padding-bottom: 12px;
  border-bottom: var(--admin-border-subtle);
}

.cockpit-overview__main,
.cockpit-overview__summary {
  display: grid;
  gap: 12px;
}

.cockpit-overview__copy {
  display: grid;
  gap: 6px;
}

.cockpit-overview__kicker,
.cockpit-detail__kicker {
  display: inline-flex;
  width: fit-content;
  min-height: 24px;
  padding: 0 10px;
  align-items: center;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.08);
  color: var(--admin-text-brand);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.cockpit-overview__copy h2 {
  margin: 0;
  color: var(--admin-text-primary);
  font-size: 1.18rem;
  line-height: 1.2;
}

.cockpit-overview__copy p,
.cockpit-summary-card p,
.cockpit-detail__head p {
  margin: 0;
  color: var(--admin-text-muted);
  font-size: 12px;
  line-height: 1.6;
}

.cockpit-overview__facts {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.cockpit-glance-card,
.cockpit-summary-card {
  border: 1px solid #e1e8f2;
  border-radius: 8px;
  background: var(--admin-bg-surface-alt);
}

.cockpit-glance-card {
  padding: 12px;
  display: grid;
  gap: 5px;
}

.cockpit-glance-card span,
.cockpit-summary-card__label {
  color: #8a94a6;
  font-size: 11px;
  font-weight: 700;
}

.cockpit-glance-card strong,
.cockpit-summary-card strong {
  color: #1a2a44;
  font-size: 14px;
}

.cockpit-summary-card {
  padding: 14px;
  display: grid;
  gap: 6px;
}

/* 3-column main */
.cockpit-main {
  display: grid;
  grid-template-columns: 200px 1fr 340px;
  gap: 16px;
  align-items: start;
}

/* Left nav */
.cockpit-nav {
  display: grid;
  gap: 4px;
  padding: 6px 0 0;
  background: transparent;
  border: none;
  border-radius: 0;
  box-shadow: none;
}

.cockpit-nav__head {
  font-size: 11px;
  letter-spacing: 1px;
  color: #94a3b8;
  font-weight: 700;
  text-transform: uppercase;
  padding: 0 0 8px 4px;
  margin-bottom: 4px;
  border-bottom: var(--admin-border-subtle);
}

.nav-btn {
  display: grid;
  grid-template-columns: 14px 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 10px 10px;
  background: var(--admin-bg-surface-alt);
  border: 1px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  font: inherit;
  color: #5b6577;
  text-align: left;
  transition: all 0.18s;
}

.nav-btn:hover { background: #f0f5ff; }
.nav-btn.active {
  background: var(--admin-bg-surface);
  color: #1a2a44;
  font-weight: 700;
  border-color: rgba(52, 120, 246, 0.18);
}

.nav-btn.disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.nav-btn__dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: #e1e8f2;
}

.nav-btn__dot.done { background: #16a34a; }
.nav-btn.active .nav-btn__dot { background: #3478f6; }

.nav-btn__label { font-size: 13px; }

.nav-btn__badge {
  font-size: 11px;
  color: #16a34a;
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
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 14px;
  border-top: var(--admin-border-subtle);
}

.cockpit-detail__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.cockpit-detail__head h3 {
  margin: 4px 0 0;
  color: var(--admin-text-primary);
  font-size: 1rem;
}

.detail-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 4px;
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

.event-list {
  display: grid;
  gap: 4px;
}

.event-item {
  display: grid;
  grid-template-columns: 64px 90px 1fr;
  gap: 8px;
  padding: 4px 0;
  font-size: 12px;
  border-bottom: 1px solid #f0f2f5;
}

.event-item__time {
  color: #94a3b8;
}

.event-item__type {
  font-weight: 700;
  color: #5b6577;
}

.event-item__msg {
  color: #1a2a44;
}

.empty-text {
  color: #94a3b8;
  font-size: 13px;
  padding: 16px 0;
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
  .cockpit-overview {
    grid-template-columns: 1fr;
  }

  .cockpit-overview__facts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .cockpit-main {
    grid-template-columns: 1fr;
    grid-template-rows: auto;
  }
  .cockpit-nav {
    display: flex;
    flex-direction: row;
    overflow-x: auto;
    order: 1;
  }
  .cockpit-nav__head { display: none; }
  .cockpit-stage { order: 2; }
  .cockpit-side { order: 3; }
}

@media (max-width: 760px) {
  .cockpit-overview__facts {
    grid-template-columns: 1fr;
  }

  .cockpit-detail__head {
    flex-direction: column;
  }
}
</style>
