<template>
  <div class="session-page">
    <header class="topbar">
      <div class="topbar-left">
        <el-button text @click="router.push('/admin/virtual-learners')">
          <el-icon><ArrowLeft /></el-icon>
          返回
        </el-button>
        <div class="topbar-avatar">{{ profile?.userName?.charAt(0) || '?' }}</div>
        <div class="title-wrap">
          <div class="title-row">
            <h1>{{ profile?.userName || '会话详情' }}</h1>
            <el-tag size="small" :type="getStatusType(session?.status)">{{ getStatusLabel(session?.status) }}</el-tag>
            <el-tag size="small" type="info">{{ getStageLabel(session?.currentStage) }}</el-tag>
          </div>
          <p class="topbar-goal">{{ profile?.learningGoal || '--' }}</p>
          <div class="topbar-meta">
            <span>{{ profile?.simulationMode === 'ai' ? 'AI 模式' : '手动模式' }}</span>
          </div>
        </div>
      </div>
      <div class="topbar-right">
        <el-button size="small" @click="loginAsVirtual">登录账号</el-button>
        <el-button size="small" @click="exportChat">导出</el-button>
        <el-button text :loading="refreshing" @click="refreshSessionState">
          <el-icon><Refresh /></el-icon>
        </el-button>
      </div>
    </header>

    <section class="stage-strip-wrapper">
      <div class="stage-strip">
        <span class="stage-pill" :class="getStagePillClass('goal')">Goal</span>
        <span class="stage-line" :class="{ done: goalReady }"></span>
        <span class="stage-pill" :class="getStagePillClass('path')">Path</span>
        <span class="stage-line" :class="{ done: pathReady }"></span>
        <span class="stage-pill" :class="getStagePillClass('learning')">Learn</span>
      </div>
    </section>

    <section class="metrics-row">
      <article v-for="item in topMetrics" :key="item.label" class="metric-card">
        <span class="metric-card__label">{{ item.label }}</span>
        <strong class="metric-card__value">{{ item.value }}</strong>
      </article>
    </section>

    <div v-if="pathBannerText" class="status-banner" :class="pathBannerTone">
      <el-icon v-if="pathBannerTone === 'warn'" class="is-loading"><Loading /></el-icon>
      <el-icon v-else-if="pathBannerTone === 'danger'"><Warning /></el-icon>
      <el-icon v-else><Check /></el-icon>
      <span>{{ pathBannerText }}</span>
      <el-button v-if="pathBannerTone === 'danger'" size="small" type="danger" :loading="advanceLoading" @click="retryPathGeneration">重试</el-button>
    </div>

    <main class="layout">
      <section class="main">
        <div class="tabbar">
          <button v-for="item in tabs" :key="item.key" class="tab" :class="{ active: activeTab === item.key }" @click="activeTab = item.key">{{ item.label }}</button>
        </div>

         <section v-if="activeTab === 'overview'" class="panel main-panel">
          <div class="section-head">
            <div class="section-head__title">Session Inspector</div>
            <div class="section-head__meta">{{ keyEvents.length }} 事件 / {{ logs.length }} 日志</div>
          </div>
          <div class="overview-grid">
            <article v-for="item in overviewCards" :key="item.label" class="overview-card">
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
              <em>{{ item.meta }}</em>
            </article>
          </div>

          <div class="inspector-grid">
            <section class="inspector-card">
              <div class="section-head">
                <div class="section-head__title">当前绑定</div>
                <div class="section-head__meta">主链路对象</div>
              </div>
              <div class="kv-list">
                <div class="kv-item"><span>goalConversationId</span><strong>{{ session?.bindings?.goalConversationId || session?.goalConversationId || '--' }}</strong></div>
                <div class="kv-item"><span>learningPathId</span><strong>{{ session?.bindings?.learningPathId || session?.learningPathId || '--' }}</strong></div>
                <div class="kv-item"><span>currentTask</span><strong>{{ session?.runtime?.stageStatus?.learning?.currentTaskTitle || learningProgress.currentTask || '--' }}</strong></div>
                <div class="kv-item"><span>story</span><strong>{{ session?.storyContext?.title || session?.storyContext?.triggerEvent || '--' }}</strong></div>
                <div class="kv-item"><span>pressurePoints</span><strong>{{ storyPressurePointsText }}</strong></div>
                <div class="kv-item"><span>behaviorHooks</span><strong>{{ storyBehaviorHooksText }}</strong></div>
              </div>
            </section>

            <section class="inspector-card">
              <div class="section-head">
                <div class="section-head__title">视图入口</div>
                <div class="section-head__meta">调试 / 正式</div>
              </div>
              <div class="entry-actions">
                <el-button size="small" type="primary" :disabled="!session?.bindings?.goalConversationId && !session?.goalConversationId" @click="openGoalDebugView">调试 Goal</el-button>
                <el-button size="small" type="primary" :disabled="!session?.bindings?.learningPathId && !session?.learningPathId" @click="openPathDebugView">调试 Path</el-button>
                <el-button size="small" type="primary" :disabled="!currentLesson?.id" @click="openLearnDebugView">调试 Learn</el-button>
                <el-button size="small" plain :disabled="!session?.bindings?.goalConversationId && !session?.goalConversationId" @click="openGoalFormalView">正式 Goal</el-button>
                <el-button size="small" plain :disabled="!session?.bindings?.learningPathId && !session?.learningPathId" @click="openPathFormalView">正式 Path</el-button>
                <el-button size="small" plain :disabled="!currentLesson?.id" @click="openLearnFormalView">正式 Learn</el-button>
              </div>
            </section>

            <section class="inspector-card inspector-card--full">
              <div class="section-head">
                <div class="section-head__title">诊断摘要</div>
                <div class="section-head__meta">{{ diagnosisSummary.title }}</div>
              </div>
              <div class="mini-row">
                <span v-for="action in diagnosisSummary.actions" :key="action">{{ action }}</span>
              </div>
              <pre class="inspector-pre">{{ JSON.stringify(session?.stageResults || {}, null, 2) }}</pre>
            </section>

            <section class="inspector-card inspector-card--full">
              <div class="section-head">
                <div class="section-head__title">Path 接受评估</div>
                <div class="section-head__meta">{{ pathReviewDecisionLabel }}</div>
              </div>
              <div v-if="pathReviewState" class="kv-list kv-list--stack">
                <div class="kv-item"><span>decision</span><strong>{{ pathReviewDecisionLabel }}</strong></div>
                <div class="kv-item"><span>confidence</span><strong>{{ pathReviewConfidenceLabel }}</strong></div>
                <div class="kv-item"><span>biggestConcern</span><strong>{{ pathReviewConcernLabel }}</strong></div>
                <div class="kv-item"><span>reaction</span><strong>{{ pathReviewReactionText }}</strong></div>
                <div class="kv-item"><span>modifyRequest</span><strong>{{ pathReviewModifyLabel }}</strong></div>
              </div>
              <div v-else class="empty-box">当前还没有 Path 接受评估记录。</div>
            </section>
          </div>
        </section>

        <section v-else-if="activeTab === 'links'" class="panel main-panel">
          <div class="section-head">
            <div class="section-head__title">入口</div>
            <div class="section-head__meta">不再在本页回放三阶段 UI</div>
          </div>
          <div class="inspector-grid">
            <section class="inspector-card">
              <div class="section-head">
                <div class="section-head__title">Goal</div>
                <div class="section-head__meta">{{ goalSummary.status }}</div>
              </div>
              <div class="entry-actions">
                <el-button size="small" type="primary" :disabled="!session?.bindings?.goalConversationId && !session?.goalConversationId" @click="openGoalDebugView">调试 Goal</el-button>
                <el-button size="small" plain :disabled="!session?.bindings?.goalConversationId && !session?.goalConversationId" @click="openGoalFormalView">正式 Goal</el-button>
              </div>
            </section>
            <section class="inspector-card">
              <div class="section-head">
                <div class="section-head__title">Path</div>
                <div class="section-head__meta">{{ pathStatusLabel }}</div>
              </div>
              <div class="entry-actions">
                <el-button size="small" type="primary" :disabled="!session?.bindings?.learningPathId && !session?.learningPathId" @click="openPathDebugView">调试 Path</el-button>
                <el-button size="small" plain :disabled="!session?.bindings?.learningPathId && !session?.learningPathId" @click="openPathFormalView">正式 Path</el-button>
              </div>
            </section>
            <section class="inspector-card">
              <div class="section-head">
                <div class="section-head__title">Learn</div>
                <div class="section-head__meta">{{ learnSummary.currentTask }}</div>
              </div>
              <div class="entry-actions">
                <el-button size="small" type="primary" :disabled="!currentLesson?.id" @click="openLearnDebugView">调试 Learn</el-button>
                <el-button size="small" plain :disabled="!currentLesson?.id" @click="openLearnFormalView">正式 Learn</el-button>
              </div>
            </section>
          </div>
        </section>

        <section v-else-if="activeTab === 'events'" class="panel main-panel">
          <div class="section-head">
            <div class="section-head__title">事件</div>
            <div class="section-head__meta">{{ keyEvents.length }}</div>
          </div>
          <div class="event-list">
            <article v-for="event in keyEvents.slice().reverse()" :key="event.id" class="event-row">
              <strong>{{ event.title }}</strong>
              <span>{{ event.stage }}</span>
              <em>{{ event.time }}</em>
            </article>
            <div v-if="keyEvents.length === 0" class="empty-box">暂无</div>
          </div>
        </section>

        <section v-else class="panel main-panel">
          <div class="section-head">
            <div class="section-head__title">日志</div>
            <div class="section-head__meta">
              <el-select v-model="logFilter" size="small" style="width: 150px">
                <el-option label="全部" value="all" />
                <el-option label="虚拟回复" value="virtual-reply" />
                <el-option label="Goal响应" value="goal-response" />
                <el-option label="阶段切换" value="stage-transition" />
                <el-option label="学习开始" value="learning-start" />
                <el-option label="学习回复" value="learning-reply" />
                <el-option label="学习响应" value="learning-response" />
                <el-option label="错误" value="error" />
              </el-select>
            </div>
          </div>
          <div class="log-list">
            <article v-for="(log, index) in filteredLogs.slice().reverse()" :key="`${log.phase}-${index}`" class="log-card">
              <div class="log-card__head"><strong>{{ getLogLabel(log.phase) }}</strong><span>{{ formatTime(log.timestamp) }}</span></div>
              <pre>{{ JSON.stringify(log.details, null, 2) }}</pre>
            </article>
            <div v-if="filteredLogs.length === 0" class="empty-box">暂无</div>
          </div>
        </section>

        <footer class="actionbar">
          <template v-if="session?.currentStage === 'goal' && !goalReady">
            <el-button type="primary" :loading="stepLoading" @click="executeSingleStep"><el-icon><VideoPlay /></el-icon>单步</el-button>
            <el-button type="success" :loading="autoLoading" @click="executeAutoLoop"><el-icon><Refresh /></el-icon>自动</el-button>
          </template>
          <template v-else-if="goalReady && !pathReady">
            <el-button type="primary" :loading="advanceLoading" @click="confirmGeneratePath"><el-icon><VideoPlay /></el-icon>确认生成 Path</el-button>
          </template>
          <template v-else-if="pathReady && session?.currentStage !== 'learning'">
            <el-button type="primary" :loading="learningStartLoading" @click="startLearning"><el-icon><VideoPlay /></el-icon>开始 Learn</el-button>
            <el-button :loading="restartPathLoading" @click="restartPath"><el-icon><Refresh /></el-icon>重新开始 Path</el-button>
          </template>
          <template v-else-if="session?.currentStage === 'learning'">
            <el-button type="primary" :loading="learningStepLoading" @click="executeLearningStep"><el-icon><VideoPlay /></el-icon>学习一步</el-button>
            <el-button type="warning" :loading="autoLearningLoading" @click="executeAutoLearning"><el-icon><Refresh /></el-icon>自动完成</el-button>
            <el-button :loading="restartLearningLoading" @click="restartLearning"><el-icon><Refresh /></el-icon>重新开始 Learn</el-button>
            <el-button type="danger" :loading="stopLearningLoading" @click="stopLearning"><el-icon><Warning /></el-icon>紧急停止</el-button>
          </template>
        </footer>
      </section>

    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft, Check, Loading, Refresh, VideoPlay, Warning } from '@element-plus/icons-vue'
import { adminApi } from '@/api/adminApi'

type LogItem = {
  timestamp: string
  phase: string
  durationMs?: number
  details?: any
}

type ReplayRound = {
  id: string
  round: number
  title: string
  time?: string
  userMessage?: string
  assistantMessage?: string
  badges: Array<{ text: string; tone: string }>
  signalRows: Array<{ label: string; value: string }>
  learnerRows?: Array<{ label: string; value: string }>
  monitorRows?: Array<{ label: string; value: string }>
  knowledgeRows?: Array<{ label: string; value: string }>
  peerMessage?: string
  taskId?: string | null
  kind?: 'opening' | 'round'
  roleLabel?: string
}

type LearnLesson = {
  id: string
  title: string
  description: string
  status: string
  tone: string
  canStart: boolean
  estimatedMinutes: string
  milestoneId: string
  milestoneLabel: string
  stageNumber: number
  taskIndex: number
  orderLabel: string
}

const router = useRouter()
const route = useRoute()
const sessionId = route.params.sessionId as string

const session = ref<any>(null)
const profile = ref<any>(null)
const logs = ref<LogItem[]>([])
const messages = ref<any[]>([])
const messagesRef = ref<any>()

const stepLoading = ref(false)
const autoLoading = ref(false)
const advanceLoading = ref(false)
const learningStartLoading = ref(false)
const learningStepLoading = ref(false)
const autoLearningLoading = ref(false)
const refreshing = ref(false)
const restartPathLoading = ref(false)
const restartLearningLoading = ref(false)
const stopLearningLoading = ref(false)
const pendingTaskId = ref<string | null>(null)

const activeTab = ref<'overview' | 'goal' | 'path' | 'learn' | 'events' | 'logs'>('overview')
const logFilter = ref('all')
const pathStatus = ref<string>('idle')
const pathData = ref<any>(null)
const learningProgress = ref({ currentMilestone: 0, totalMilestones: 0, currentTask: null as string | null })
const selectedLessonId = ref<string | null>(null)
let pathPollTimer: ReturnType<typeof setInterval> | null = null
let autoPollTimer: ReturnType<typeof setInterval> | null = null

const tabs = [
  { key: 'overview', label: '概览' },
  { key: 'links', label: '入口' },
  { key: 'events', label: '事件' },
  { key: 'logs', label: '日志' }
] as const

const normalizeSessionContext = (data: any) => {
  const runtime = data?.runtime || data?.virtualSession?.runtime || data?.session?.runtime || {}
  const bindings = runtime.bindings || data?.bindings || data?.virtualSession?.bindings || {}
  const story = runtime.story || data?.storyContext || data?.virtualSession?.storyContext || data?.stageResults?.story || null
  const stageResults = data?.stageResults || data?.virtualSession?.stageResults || {}
  const learningRuntime = runtime.stageStatus?.learning || stageResults.learning || {}
  const goalRuntime = runtime.stageStatus?.goal || {}
  const pathRuntime = runtime.stageStatus?.path || {}
  const learnerStateRuntime = runtime.learnerState || {}
  const knowledgeStateRuntime = runtime.knowledgeState || {}

  return {
    ...data,
    runtime,
    bindings,
    goalConversationId: data?.goalConversationId || bindings.goalConversationId || null,
    learningPathId: data?.learningPathId || bindings.learningPathId || null,
    currentStage: data?.currentStage || runtime.currentStage || null,
    storyContext: story,
    stageResults: {
      ...stageResults,
      story,
      learning: learningRuntime,
      goal: {
        ...(stageResults.goal || {}),
        ...goalRuntime,
      },
      path_review: pathRuntime.review ? {
        ...(stageResults.path_review || {}),
        ...pathRuntime.review,
      } : (stageResults.path_review || {}),
    },
    learningState: learningRuntime,
    learnerState: learnerStateRuntime,
    knowledgeState: knowledgeStateRuntime,
    conversations: data?.conversations || data?.virtualSession?.conversations || { goal: { messages: [] }, learning: { messages: [] } },
  }
}

const isGoalConvergedStage = (stage?: string | null) => stage === 'ready' || stage === 'completed'

const formatTime = (time: string | null | undefined) => {
  if (!time) return '--'
  const d = new Date(time)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

const goalReady = computed(() => {
  if (session.value?.runtime?.stageStatus?.goal?.ready) return true
  if (session.value?.currentStage === 'path' || session.value?.currentStage === 'learning') return true
  return isGoalConvergedStage(logs.value.filter(l => l.phase === 'goal-response').pop()?.details?.output?.stage)
})

const pathReady = computed(() => ['active', 'ready', 'completed'].includes(pathStatus.value))
const totalRounds = computed(() => {
  const goalCount = Array.isArray(session.value?.conversations?.goal?.messages)
    ? session.value.conversations.goal.messages.filter((item: any) => item.role === 'user').length
    : 0
  const learningCount = Array.isArray(session.value?.conversations?.learning?.messages)
    ? session.value.conversations.learning.messages.filter((item: any) => item.role === 'user').length
    : 0
  if (goalCount > 0 || learningCount > 0) return goalCount + learningCount
  return logs.value.filter(l => l.phase === 'virtual-reply' || l.phase === 'learning-reply').length
})
const errorCount = computed(() => logs.value.filter(l => l.phase === 'error').length)

const filteredLogs = computed(() => (logFilter.value === 'all' ? logs.value : logs.value.filter(l => l.phase === logFilter.value)))
const lastQuickReplies = computed(() => logs.value.filter(l => l.phase === 'goal-response').pop()?.details?.output?.quickReplies || [])

const pathStatusLabel = computed(() => {
  if (pathData.value?.status === 'completed') return '已完成'
  if (pathData.value?.status === 'active') return '进行中'
  if (pathStatus.value === 'generating') return '生成中'
  if (pathStatus.value === 'failed') return '失败'
  if (pathStatus.value === 'not_found') return '丢失'
  if (pathStatus.value === 'not_started') return goalReady.value || session.value?.currentStage === 'path' ? '生成中' : '未开始'
  if (goalReady.value) return '待确认'
  return '未开始'
})

const topMetrics = computed(() => [
  { label: '轮次', value: String(totalRounds.value) },
  { label: 'Path', value: pathStatusLabel.value },
  { label: 'Learn', value: learningProgress.value.totalMilestones > 0 ? `${learningProgress.value.currentMilestone}/${learningProgress.value.totalMilestones}` : '未开始' },
  { label: '错误', value: String(errorCount.value) }
])

const navItems = computed(() => [
  { key: 'goal', label: 'Goal', meta: `${goalRounds.value.length} 轮` },
  { key: 'path', label: 'Path', meta: `${milestoneCards.value.length} stages` },
  { key: 'learn', label: 'Learn', meta: learningProgress.value.currentTask || '暂无 task' },
  { key: 'events', label: '事件', meta: `${keyEvents.value.length}` },
  { key: 'logs', label: '日志', meta: `${logs.value.length}` }
])

const milestoneCards = computed(() => {
  const milestones = pathData.value?.milestones || []
  return milestones.map((item: any, index: number) => {
    const stageNumber = Number(item.stageNumber || index + 1)
    const current = learningProgress.value.currentMilestone || 0
    let status = '未开始'
    let railTone = 'pending'

    if (item.status === 'completed' || (current > 0 && stageNumber < current)) {
      status = '已完成'
      railTone = 'done'
    } else if (current > 0 && stageNumber === current) {
      status = '进行中'
      railTone = 'active'
    } else if (item.status === 'active' || item.status === 'ready') {
      status = '已就绪'
      railTone = 'ready'
    }

    return {
      id: item.id || `milestone-${stageNumber}`,
      stageNumber,
      title: item.title || `阶段 ${stageNumber}`,
      description: item.description || item.goal || '',
      estimatedHours: item.estimatedHours ? `${item.estimatedHours}h` : '--',
      status,
      railTone,
      tasks: (item.subtasks || []).map((task: any) => {
        const isCurrentTask = learningProgress.value.currentTask && task.title === learningProgress.value.currentTask
        let taskStatus = '待开始'
        let tone = 'todo'
        let canStart = false

        if (task.status === 'completed') {
          taskStatus = '已完成'
          tone = 'done'
        } else if (isCurrentTask || task.status === 'in_progress') {
          taskStatus = '进行中'
          tone = 'active'
        } else if (task.status === 'active' || task.status === 'ready' || task.status === 'todo') {
          taskStatus = '可启动'
          tone = 'ready'
          canStart = true
        } else {
          taskStatus = '锁定'
          tone = 'pending'
        }

        return {
          id: task.id,
          title: task.title || '未命名任务',
          description: task.description || '',
          status: taskStatus,
          estimatedMinutes: task.estimatedMinutes ? `${task.estimatedMinutes}m` : '--',
          taskType: task.taskType || '',
          knowledgeType: task.knowledgeType || '',
          cognitiveLevel: task.cognitiveLevel || '',
          displayLabel: task.displayLabel || '',
          conceptLabel: getTaskConceptLabel(task),
          tone,
          canStart
        }
      })
    }
  })
})

const totalTaskCount = computed(() => milestoneCards.value.reduce((sum, item) => sum + item.tasks.length, 0))

const pathCompletedTaskCount = computed(() => milestoneCards.value.reduce((sum, item) => sum + item.tasks.filter((task: any) => task.tone === 'done').length, 0))

const pathCompletionRate = computed(() => {
  if (totalTaskCount.value === 0) return 0
  return Math.round((pathCompletedTaskCount.value / totalTaskCount.value) * 100)
})

const pathOverviewCards = computed(() => [
  { label: '阶段数', value: String(pathData.value?.totalMilestones || milestoneCards.value.length || 0) },
  { label: '预计投入', value: pathData.value?.estimatedHours ? `${pathData.value.estimatedHours} 小时` : '--' },
  { label: '当前阶段', value: pathData.value?.pathContext?.currentStageNumber ? `第 ${pathData.value.pathContext.currentStageNumber} 阶段` : '待开始' },
  { label: '任务进度', value: `${pathCompletedTaskCount.value}/${totalTaskCount.value}` }
])

const nextActionTasks = computed(() => {
  const currentStage = milestoneCards.value.find(item => item.tasks.some((task: any) => task.tone !== 'done')) || milestoneCards.value[0]
  const tasks = currentStage?.tasks || []
  return tasks.filter((task: any) => task.tone !== 'done').slice(0, 3)
})

const currentStageEffortText = computed(() => {
  const total = nextActionTasks.value.reduce((sum: number, task: any) => {
    const minutes = Number(String(task.estimatedMinutes || '').replace('m', '')) || 0
    return sum + minutes
  }, 0)

  return total > 0 ? `${total} 分钟` : '按当前任务推进'
})

const pathDetailNotes = computed(() => {
  const notes: string[] = []
  const currentStage = milestoneCards.value.find(item => item.tasks.some((task: any) => task.tone !== 'done')) || milestoneCards.value[0]

  if (pathData.value?.pathContext?.storyContext?.triggerEvent) {
    notes.push(`这条路径优先回应「${pathData.value.pathContext.storyContext.triggerEvent}」里的真实卡点。`)
  }

  if (pathData.value?.pathContext?.cognitiveFrame?.targetRelation) {
    notes.push(`当前阶段先围绕「${pathData.value.pathContext.cognitiveFrame.targetRelation}」推进，不必同时展开太多分支。`)
  }

  if (currentStage?.tasks?.length) {
    notes.push('先完成当前阶段最小任务，再继续扩展到后续阶段。')
  }

  return notes.slice(0, 3)
})

const pathDetailPlan = computed(() => {
  if (!nextActionTasks.value.length) {
    return [{ title: '当前暂无待推进任务', desc: '等路径状态就绪后，这里会出现最值得先开始的任务。' }]
  }

  return nextActionTasks.value.map((task: any, index: number) => ({
    title: `任务 ${index + 1}`,
    desc: `${task.title}${task.estimatedMinutes ? ` · 预计 ${task.estimatedMinutes}` : ''}`
  }))
})

const paceSuggestionCards = computed(() => {
  const targetDepth = pathData.value?.pathContext?.teachingStrategyGuidance?.targetDepth || '--'
  const interactionPattern = pathData.value?.pathContext?.teachingStrategyGuidance?.interactionPattern || '--'
  return [
    { title: currentStageEffortText.value, desc: '优先把一个任务完整收口，再继续下一个步骤。' },
    { title: `目标深度：${targetDepth}`, desc: `建议互动方式：${interactionPattern}` }
  ]
})

const pathSceneCards = computed(() => {
  const scene = pathData.value?.sceneSummary
  if (!scene) return []

  return [
    scene.firstDeliverable ? { title: '首个最小交付物', desc: scene.firstDeliverable } : null,
    scene.targetState ? { title: '目标状态', desc: scene.targetState } : null,
    Array.isArray(scene.planningFocus) && scene.planningFocus.length ? { title: '当前规划重点', desc: scene.planningFocus.join('、') } : null
  ].filter(Boolean) as Array<{ title: string; desc: string }>
})

const cognitiveConceptCards = computed(() => {
  const concepts = Array.isArray(pathData.value?.cognitiveDesign?.coreConcepts) ? pathData.value.cognitiveDesign.coreConcepts : []
  return concepts.map((concept: any, index: number) => ({
    title: `${concept.role === 'hub' || index === 0 ? '枢纽概念' : '支撑概念'} · ${concept.name}`,
    desc: concept.description || '作为后续教学和任务推进时的隐性认知锚点。'
  }))
})

const goalSummary = computed(() => {
  const rounds = Array.isArray(session.value?.conversations?.goal?.messages)
    ? session.value.conversations.goal.messages.filter((item: any) => item.role === 'user').length
    : logs.value.filter(l => l.phase === 'virtual-reply').length
  const finalStage = session.value?.runtime?.stageStatus?.goal?.stage || logs.value.filter(l => l.phase === 'goal-response').pop()?.details?.output?.stage || '进行中'
  return { status: goalReady.value ? '已收敛' : '待收敛', finalStage, quickReplyCount: lastQuickReplies.value.length, rounds }
})

const learnSummary = computed(() => {
  const total = learningProgress.value.totalMilestones || milestoneCards.value.length || 0
  const current = learningProgress.value.currentMilestone || 0
  return {
    currentMilestone: current > 0 ? `M${current}` : '未开始',
    currentTask: learningProgress.value.currentTask || '暂无 task',
    progressLabel: total > 0 ? `${current}/${total}` : '未开始'
  }
})

const latestLearningTaskTitle = computed(() => {
  return session.value?.runtime?.stageStatus?.learning?.currentTaskTitle || null
})

const learnLessons = computed<LearnLesson[]>(() => milestoneCards.value.flatMap(item => item.tasks.map((task: any, index: number) => ({
  id: task.id,
  title: task.title,
  description: task.description || '',
  status: task.status,
  tone: task.tone,
  canStart: task.canStart,
  estimatedMinutes: task.estimatedMinutes,
  milestoneId: item.id,
  milestoneLabel: `M${item.stageNumber} ${item.title}`,
  stageNumber: item.stageNumber,
  taskIndex: index,
  orderLabel: `${item.stageNumber}.${index + 1}`
}))))

const currentLesson = computed<LearnLesson | null>(() => {
  if (!learnLessons.value.length) return null

  if (selectedLessonId.value) {
    const selected = learnLessons.value.find(item => item.id === selectedLessonId.value)
    if (selected) return selected
  }

  const latestByTitle = latestLearningTaskTitle.value
    ? learnLessons.value.find(item => item.title === latestLearningTaskTitle.value)
    : null

  if (session.value?.currentStage === 'learning' && latestByTitle) return latestByTitle

  const currentByTitle = learningProgress.value.currentTask
    ? learnLessons.value.find(item => item.title === learningProgress.value.currentTask)
    : null
  if (currentByTitle) return currentByTitle

  return learnLessons.value.find(item => item.tone === 'active')
    || learnLessons.value.find(item => item.canStart)
    || learnLessons.value[0]
})

const currentLessonIndex = computed(() => {
  if (!currentLesson.value) return -1
  return learnLessons.value.findIndex(item => item.id === currentLesson.value?.id)
})

const currentLessonDebugRound = computed<ReplayRound | null>(() => {
  if (!currentLessonRounds.value.length) return null
  return currentLessonRounds.value.slice().reverse().find(item => item.kind !== 'opening') || currentLessonRounds.value[currentLessonRounds.value.length - 1] || null
})

const currentLessonKnowledgeRows = computed(() => currentLessonDebugRound.value?.knowledgeRows || [])

const currentLessonLearnerRows = computed(() => currentLessonDebugRound.value?.learnerRows || [])
const runtimeLearningLearnerRows = computed(() => {
  const learnerState = session.value?.learnerState?.learning || session.value?.learnerState?.latest || null
  if (!learnerState || typeof learnerState !== 'object') return []

  return [
    { label: '困惑', value: learnerState.confusionLevel !== undefined ? String(learnerState.confusionLevel) : '--' },
    { label: '真掌握', value: learnerState.actualMastery !== undefined ? String(learnerState.actualMastery) : '--' },
    { label: '自感掌握', value: learnerState.selfPerceivedMastery !== undefined ? String(learnerState.selfPerceivedMastery) : '--' },
    { label: '注意力', value: learnerState.attentionLevel !== undefined ? String(learnerState.attentionLevel) : '--' },
    { label: '可推进', value: learnerState.readyToAdvance !== undefined ? String(learnerState.readyToAdvance) : '--' },
  ]
})

const learnSessionStats = computed(() => [
  { label: 'stage', value: session.value?.currentStage || '--' },
  { label: 'status', value: getStatusLabel(session.value?.status) },
  { label: 'rounds', value: String(currentLessonRounds.value.length) },
  { label: 'lesson', value: currentLesson.value ? `${currentLessonIndex.value + 1}/${learnLessons.value.length || 0}` : '--' }
])

const currentLessonContextRows = computed(() => {
  if (!currentLesson.value) return []

  const matchedMilestone = milestoneCards.value.find(item => item.id === currentLesson.value?.milestoneId)
  const matchedTask = matchedMilestone?.tasks.find((task: any) => task.id === currentLesson.value?.id)

  return [
    { label: 'taskType', value: matchedTask?.taskType ? getTaskTypeText(matchedTask.taskType) : '--' },
    { label: 'displayLabel', value: matchedTask?.displayLabel || '--' },
    { label: 'knowledgeType', value: matchedTask?.knowledgeType ? getKnowledgeTypeLabel(matchedTask.knowledgeType) : '--' },
    { label: 'cognitiveLevel', value: matchedTask?.cognitiveLevel ? getCognitiveLevelLabel(matchedTask.cognitiveLevel) : '--' },
    { label: 'coreConcept', value: matchedTask?.conceptLabel || '--' }
  ]
})

const keyEvents = computed(() => logs.value
  .filter(log => log.phase === 'error' || log.phase === 'stage-transition' || log.phase === 'learning-start' || (log.phase === 'goal-response' && isGoalConvergedStage(log.details?.output?.stage)))
  .map((log, index) => ({
    id: `${log.phase}-${index}-${log.timestamp}`,
    time: formatTime(log.timestamp),
    title: log.phase === 'goal-response' ? 'Goal 已收敛' : getLogLabel(log.phase),
    stage: log.phase === 'learning-start' ? 'Learn' : log.phase === 'goal-response' ? 'Goal' : log.phase === 'stage-transition' ? 'Stage' : 'Error'
  })))

const diagnosisSummary = computed(() => {
  const lastError = logs.value.filter(log => log.phase === 'error').pop()
  if (lastError) return { title: '有错误', actions: ['先看事件'] }
  if (pathStatus.value === 'failed') return { title: 'Path 失败', actions: ['先重试'] }
  if (session.value?.currentStage === 'learning' && session.value?.status !== 'completed') return { title: 'Learn 进行中', actions: ['看当前 task'] }
  if (goalReady.value) return { title: 'Goal 已收敛', actions: ['看 Path / Learn'] }
  return { title: 'Goal 待收敛', actions: ['看 Goal 轮次'] }
})

const overviewCards = computed(() => [
  { label: 'Goal', value: goalSummary.value.status, meta: goalSummary.value.finalStage },
  { label: 'Path', value: pathStatusLabel.value, meta: `${milestoneCards.value.length} stages` },
  { label: 'Learn', value: session.value?.currentStage === 'learning' ? '进行中' : '未进入', meta: `${learnSummary.value.progressLabel}` },
  { label: '故事压力点', value: storyPressurePointsText.value, meta: storyBehaviorHooksText.value }
])

const pathReviewState = computed(() => session.value?.runtime?.stageStatus?.path?.review || null)
const pathReviewDecisionLabel = computed(() => {
  const decision = pathReviewState.value?.decision
  switch (decision) {
    case 'accept': return '接受当前 Path'
    case 'modify': return '希望修改后再走'
    case 'reject': return '暂不接受'
    default: return '待评估'
  }
})
const pathReviewConfidenceLabel = computed(() => {
  const confidence = pathReviewState.value?.confidence
  return typeof confidence === 'number' && Number.isFinite(confidence)
    ? `${Math.round(confidence * 100)}%`
    : '--'
})
const pathReviewConcernLabel = computed(() => pathReviewState.value?.biggestConcern || '--')
const pathReviewReactionText = computed(() => pathReviewState.value?.reaction || '--')
const pathReviewModifyLabel = computed(() => session.value?.stageResults?.path_review?.modifyRequest || '--')

const storyPressurePointsText = computed(() => {
  const items = session.value?.storyContext?.pressurePoints || session.value?.runtime?.story?.pressurePoints
  return Array.isArray(items) && items.length ? items.slice(0, 2).join('；') : '--'
})

const storyBehaviorHooksText = computed(() => {
  const items = session.value?.storyContext?.behaviorHooks || session.value?.runtime?.story?.behaviorHooks
  return Array.isArray(items) && items.length ? items.slice(0, 2).join('；') : '--'
})

const goalRounds = computed<ReplayRound[]>(() => {
  const projectedMessages = session.value?.conversations?.goal?.messages
  if (Array.isArray(projectedMessages) && projectedMessages.length) {
    const rounds: ReplayRound[] = []
    let pendingUser: any = null
    let visibleRound = 0

    for (const message of projectedMessages) {
      if (message.role === 'user') {
        pendingUser = message
        continue
      }

      if (message.role === 'assistant') {
        if (pendingUser) {
          visibleRound += 1
          rounds.push({
            id: `goal-projected-${visibleRound}`,
            round: visibleRound,
            title: `第 ${visibleRound} 轮`,
            time: formatTime(message.timestamp || pendingUser.timestamp),
            userMessage: pendingUser.content || '',
            assistantMessage: message.content || '',
            badges: [],
            signalRows: [],
            learnerRows: [],
            kind: 'round',
            roleLabel: '画像用户'
          })
          pendingUser = null
          continue
        }

        rounds.push({
          id: `goal-projected-opening-${rounds.length + 1}`,
          round: rounds.length + 1,
          title: '系统开场',
          time: formatTime(message.timestamp),
          assistantMessage: message.content || '',
          badges: [{ text: 'opening', tone: 'info' }],
          signalRows: [],
          kind: 'opening',
          roleLabel: '系统开场'
        })
      }
    }

    return rounds
  }

  const rounds: ReplayRound[] = []
  let pendingRound: ReplayRound | null = null

  logs.value.forEach((log, index) => {
    if (log.phase === 'virtual-reply') {
      const isOpening = !!log.details?.output?.opening
      const learnerState = log.details?.output?.learnerState || null

      pendingRound = {
        id: `goal-user-${index}`,
        round: rounds.length + 1,
        title: isOpening ? 'Goal 开场' : `第 ${rounds.length + 1} 轮`,
        time: formatTime(log.timestamp),
        userMessage: log.details?.output?.reply || '',
        assistantMessage: '',
        badges: isOpening
          ? [{ text: 'opening', tone: 'info' }]
          : [],
        signalRows: [],
        learnerRows: learnerState ? [
          { label: '困惑', value: learnerState.confusionLevel !== undefined ? String(learnerState.confusionLevel) : '--' },
          { label: '真掌握', value: learnerState.actualMastery !== undefined ? String(learnerState.actualMastery) : '--' },
          { label: '自感掌握', value: learnerState.selfPerceivedMastery !== undefined ? String(learnerState.selfPerceivedMastery) : '--' },
          { label: '注意力', value: learnerState.attentionLevel !== undefined ? String(learnerState.attentionLevel) : '--' },
          { label: '想追问', value: learnerState.wantsToAsk !== undefined ? String(learnerState.wantsToAsk) : '--' },
          { label: '可推进', value: learnerState.readyToAdvance !== undefined ? String(learnerState.readyToAdvance) : '--' }
        ] : [],
        kind: isOpening ? 'opening' : 'round',
        roleLabel: isOpening ? '画像用户开场' : '画像用户'
      }

      rounds.push(pendingRound)
      return
    }

    if (log.phase === 'goal-response') {
      const assistantMessage = log.details?.output?.userVisible || ''
      const assistantBadges = [
        ...(log.details?.output?.stage ? [{ text: log.details.output.stage, tone: isGoalConvergedStage(log.details.output.stage) ? 'success' : 'neutral' }] : []),
        ...(log.details?.output?.confidence !== undefined ? [{ text: `c ${log.details.output.confidence}`, tone: 'info' }] : []),
        ...(Array.isArray(log.details?.output?.quickReplies) ? [{ text: `${log.details.output.quickReplies.length} replies`, tone: 'warning' }] : [])
      ]
      const signalRows = [
        { label: 'stage', value: log.details?.output?.stage || '--' },
        { label: 'confidence', value: log.details?.output?.confidence !== undefined ? String(log.details.output.confidence) : '--' },
        { label: 'replies', value: Array.isArray(log.details?.output?.quickReplies) ? String(log.details.output.quickReplies.length) : '--' }
      ]

      if (pendingRound && !pendingRound.assistantMessage) {
        pendingRound.assistantMessage = assistantMessage
        pendingRound.time = formatTime(log.timestamp)
        pendingRound.badges = [...pendingRound.badges, ...assistantBadges]
        pendingRound.signalRows = signalRows
        pendingRound = null
        return
      }

      rounds.push({
        id: `goal-ai-${index}`,
        round: rounds.length + 1,
        title: '系统开场',
        time: formatTime(log.timestamp),
        assistantMessage,
        badges: [{ text: 'opening', tone: 'info' }, ...assistantBadges],
        signalRows,
        kind: 'opening',
        roleLabel: '系统开场'
      })
    }
  })

  let visibleRound = 0
  return rounds.map(item => {
    if (item.kind === 'opening') {
      return {
        ...item,
        title: item.title || '开场'
      }
    }

    visibleRound += 1
    return {
      ...item,
      title: `第 ${visibleRound} 轮`
    }
  })
})

const learnRounds = computed<ReplayRound[]>(() => {
  const projectedRounds = session.value?.conversations?.learning?.rounds
  if (Array.isArray(projectedRounds) && projectedRounds.length) {
    return projectedRounds.map((item: any, index: number) => {
      const taskName = item?.currentTask || learningProgress.value.currentTask || '课堂任务'
      const matchedLesson = learnLessons.value.find(entry => entry.title === taskName) || null
      const learnerState = item?.learnerState || null
      const knowledgeRows = Array.isArray(item?.knowledgePoints)
        ? item.knowledgePoints.slice(0, 6).map((point: any) => ({
            label: point.name || point.key || '知识点',
            value: `${point.masteryLevel || point.status || '--'}`
          }))
        : []

      if (item?.isOpening) {
        return {
          id: `learn-opening-${index + 1}`,
          round: typeof item?.round === 'number' ? item.round : 0,
          title: '开场',
          time: formatTime(item?.timestamp || item?.assistantMessage?.timestamp),
          assistantMessage: item?.assistantMessage?.content || '',
          badges: [
            ...(taskName ? [{ text: taskName, tone: 'neutral' as const }] : []),
            { text: 'opening', tone: 'info' as const }
          ],
          signalRows: [
            { label: 'task', value: '开场' },
            { label: 'level', value: '--' },
            { label: 'mile', value: item?.currentMilestone || '--' }
          ],
          learnerRows: [],
          monitorRows: [],
          knowledgeRows,
          taskId: matchedLesson?.id || null,
          kind: 'opening',
          roleLabel: 'AI 开场'
        }
      }

      return {
        id: `learn-round-${index + 1}`,
        round: typeof item?.round === 'number' ? item.round : index + 1,
        title: taskName,
        time: formatTime(item?.timestamp || item?.assistantMessage?.timestamp || item?.learnerMessage?.timestamp),
        userMessage: item?.learnerMessage?.content || '',
        assistantMessage: item?.assistantMessage?.content || '',
        badges: [
          { text: taskName, tone: 'neutral' as const },
          ...(item?.isCompletion ? [{ text: 'done', tone: 'success' as const }] : [{ text: 'run', tone: 'warning' as const }]),
          ...(item?.autoEnded ? [{ text: 'auto-end', tone: 'info' as const }] : []),
          ...(item?.peerTriggered ? [{ text: 'peer', tone: 'warning' as const }] : [])
        ],
        signalRows: [
          { label: 'task', value: item?.isCompletion ? '完成' : '继续' },
          { label: 'level', value: item?.cognitiveLevel || '--' },
          { label: 'mile', value: item?.currentMilestone || '--' }
        ],
        learnerRows: learnerState ? [
          { label: '困惑', value: learnerState.confusionLevel !== undefined ? String(learnerState.confusionLevel) : '--' },
          { label: '真掌握', value: learnerState.actualMastery !== undefined ? String(learnerState.actualMastery) : '--' },
          { label: '自感掌握', value: learnerState.selfPerceivedMastery !== undefined ? String(learnerState.selfPerceivedMastery) : '--' },
          { label: '注意力', value: learnerState.attentionLevel !== undefined ? String(learnerState.attentionLevel) : '--' },
          { label: '想追问', value: learnerState.wantsToAsk !== undefined ? String(learnerState.wantsToAsk) : '--' },
          { label: '可推进', value: learnerState.readyToAdvance !== undefined ? String(learnerState.readyToAdvance) : '--' }
        ] : [],
        monitorRows: [
          { label: '完成候选', value: item?.isCompletion ? 'true' : 'false' },
          { label: '自动结束', value: item?.autoEnded ? 'true' : 'false' },
          { label: '伴学', value: item?.peerTriggered ? 'true' : 'false' },
          { label: '当前点', value: item?.knowledgePoint || '--' },
          { label: 'LSS', value: item?.currentState?.lss !== undefined ? String(item.currentState.lss) : '--' }
        ],
        knowledgeRows,
        peerMessage: item?.peerMessage || '',
        taskId: matchedLesson?.id || null,
        kind: 'round',
        roleLabel: '画像用户'
      }
    })
  }

  const projectedMessages = session.value?.conversations?.learning?.messages
  if (Array.isArray(projectedMessages) && projectedMessages.length) {
    const rounds: ReplayRound[] = []
    let pendingUser: any = null

    for (const message of projectedMessages) {
      if (message.role === 'assistant' && !pendingUser) {
        rounds.push({
          id: `learn-opening-${rounds.length + 1}`,
          round: rounds.length + 1,
          title: '开场',
          time: formatTime(message.timestamp),
          assistantMessage: message.content || '',
          badges: [{ text: 'opening', tone: 'info' }],
          signalRows: [],
          learnerRows: [],
          monitorRows: [],
          knowledgeRows: [],
          kind: 'opening',
          roleLabel: 'AI 开场'
        })
        continue
      }

      if (message.role === 'user') {
        pendingUser = message
        continue
      }

      if (message.role === 'assistant' && pendingUser) {
        rounds.push({
          id: `learn-round-${rounds.length + 1}`,
          round: rounds.length + 1,
          title: learningProgress.value.currentTask || '课堂任务',
          time: formatTime(message.timestamp || pendingUser.timestamp),
          userMessage: pendingUser.content || '',
          assistantMessage: message.content || '',
          badges: [{ text: 'run', tone: 'warning' }],
          signalRows: [],
          learnerRows: runtimeLearningLearnerRows.value,
          monitorRows: [],
          knowledgeRows: Array.isArray(session.value?.knowledgeState?.learning?.knowledgePoints)
            ? session.value.knowledgeState.learning.knowledgePoints.slice(0, 6).map((item: any) => ({
                label: item.name || item.key || '知识点',
                value: `${item.masteryLevel || item.status || '--'}`
              }))
            : [],
          kind: 'round',
          roleLabel: '画像用户'
        })
        pendingUser = null
      }
    }

    return rounds
  }

  const rounds: ReplayRound[] = []
  let pendingRound: ReplayRound | null = null

  logs.value.forEach(log => {
    if (log.phase === 'learning-start') {
      const taskName = log.details?.output?.currentTask || learningProgress.value.currentTask || '课堂任务'
      const matchedLesson = learnLessons.value.find(item => item.title === taskName) || null

      rounds.push({
        id: `learn-start-${rounds.length}`,
        round: rounds.length + 1,
        title: '开场',
        time: formatTime(log.timestamp),
        assistantMessage: log.details?.output?.welcomeMessage || '',
        badges: [
          { text: taskName, tone: 'neutral' },
          { text: 'opening', tone: 'info' }
        ],
        signalRows: [
          { label: 'task', value: '开场' },
          { label: 'level', value: '--' },
          { label: 'mile', value: log.details?.output?.currentMilestone || '--' }
        ],
        learnerRows: [],
        monitorRows: [],
        knowledgeRows: [],
        taskId: matchedLesson?.id || null,
        kind: 'opening',
        roleLabel: 'AI 开场'
      })
      return
    }

    if (log.phase === 'learning-reply') {
      const taskName = log.details?.output?.currentTask || learningProgress.value.currentTask || '课堂任务'
      const matchedLesson = learnLessons.value.find(item => item.title === taskName) || null
      const learnerState = log.details?.output?.learnerState || null

      pendingRound = {
        id: `learn-${rounds.length}`,
        round: rounds.length + 1,
        title: taskName,
        time: formatTime(log.timestamp),
        userMessage: log.details?.output?.reply || '',
        assistantMessage: '',
        badges: [
          { text: taskName, tone: 'neutral' },
          { text: 'run', tone: 'warning' }
        ],
        signalRows: [
          { label: 'task', value: '继续' },
          { label: 'level', value: '--' },
          { label: 'mile', value: log.details?.output?.currentMilestone || '--' }
        ],
        learnerRows: learnerState ? [
          { label: '困惑', value: learnerState.confusionLevel !== undefined ? String(learnerState.confusionLevel) : '--' },
          { label: '真掌握', value: learnerState.actualMastery !== undefined ? String(learnerState.actualMastery) : '--' },
          { label: '自感掌握', value: learnerState.selfPerceivedMastery !== undefined ? String(learnerState.selfPerceivedMastery) : '--' },
          { label: '注意力', value: learnerState.attentionLevel !== undefined ? String(learnerState.attentionLevel) : '--' },
          { label: '想追问', value: learnerState.wantsToAsk !== undefined ? String(learnerState.wantsToAsk) : '--' },
          { label: '可推进', value: learnerState.readyToAdvance !== undefined ? String(learnerState.readyToAdvance) : '--' }
        ] : [],
        monitorRows: [],
        knowledgeRows: [],
        taskId: matchedLesson?.id || null,
        kind: 'round',
        roleLabel: '画像用户'
      }

      rounds.push(pendingRound)
      return
    }

    if (log.phase === 'learning-response' && pendingRound) {
      pendingRound.assistantMessage = log.details?.output?.aiResponse || ''
      pendingRound.time = formatTime(log.timestamp)
      pendingRound.badges = [
        pendingRound.badges[0],
        ...(log.details?.output?.isCompletion ? [{ text: 'done', tone: 'success' }] : [{ text: 'run', tone: 'warning' }]),
        ...(log.details?.output?.autoEnded ? [{ text: 'auto-end', tone: 'info' }] : []),
        ...(log.details?.output?.peerTriggered ? [{ text: 'peer', tone: 'warning' }] : [])
      ]
      pendingRound.signalRows = [
        { label: 'task', value: log.details?.output?.isCompletion ? '完成' : '继续' },
        { label: 'level', value: log.details?.output?.cognitiveLevel || '--' },
        pendingRound.signalRows[2]
      ]
      pendingRound.monitorRows = [
        { label: '阶段', value: log.details?.output?.promptDebug?.learnDebug?.output?.stageDecision?.stage || '--' },
        { label: '完成候选', value: log.details?.output?.isCompletion ? 'true' : 'false' },
        { label: '自动结束', value: log.details?.output?.autoEnded ? 'true' : 'false' },
        { label: '伴学', value: log.details?.output?.peerTriggered ? 'true' : 'false' },
        { label: '当前点', value: log.details?.output?.knowledgePoint || '--' },
        { label: 'LSS', value: log.details?.output?.currentState?.lss !== undefined ? String(log.details.output.currentState.lss) : '--' }
      ]
      pendingRound.knowledgeRows = Array.isArray(log.details?.output?.knowledgePoints)
        ? log.details.output.knowledgePoints.slice(0, 6).map((item: any) => ({
            label: item.name || item.key || '知识点',
            value: `${item.masteryLevel || item.status || '--'}`
          }))
        : []
      pendingRound.peerMessage = log.details?.output?.peerMessage || ''
      pendingRound = null
    }
  })

  if (pendingRound) {
    pendingRound = null
  }

  return rounds
})

const currentLessonRounds = computed(() => {
  if (!currentLesson.value) return []
  const lessonRounds = learnRounds.value
    .filter(item => item.taskId === currentLesson.value?.id || item.title === currentLesson.value?.title)

  const latestOpeningIndex = lessonRounds.map(item => item.kind).lastIndexOf('opening')
  const visibleRounds = latestOpeningIndex >= 0 ? lessonRounds.slice(latestOpeningIndex) : lessonRounds

  let roundNumber = 0
  return visibleRounds.map(item => {
    if (item.kind === 'opening') {
      return {
        ...item,
        title: '课程开场',
        roleLabel: 'AI 开场'
      }
    }

    roundNumber += 1
    return {
      ...item,
      title: `第 ${roundNumber} 轮`,
      roleLabel: '画像用户'
    }
  })
})

const getStagePillClass = (stage: 'goal' | 'path' | 'learning') => {
  if (stage === 'goal') return goalReady.value ? 'done' : (session.value?.currentStage === 'goal' ? 'active' : '')
  if (stage === 'path') return pathReady.value ? 'done' : ((goalReady.value || session.value?.currentStage === 'path') ? 'active' : '')
  return session.value?.status === 'completed' ? 'done' : (session.value?.currentStage === 'learning' ? 'active' : '')
}

const getStatusType = (status: string) => ({ running: 'success', completed: 'info', failed: 'danger' }[status] || 'warning')
const getStatusLabel = (status: string) => ({ created: '已创建', running: '运行中', completed: '已完成', failed: '失败' }[status] || status || '未知')
const getStageLabel = (stage: string) => ({ goal: 'Goal 对话', path: 'Path 生成', learning: 'Learn 课堂' }[stage] || '待开始')
const getLogLabel = (phase: string) => ({ 'virtual-reply': '虚拟回复', 'goal-response': 'Goal 响应', 'stage-transition': '阶段切换', 'learning-start': '学习开始', 'learning-reply': '学习回复', 'learning-response': '学习响应', error: '错误' }[phase] || phase)
const getTaskTypeText = (type: string) => ({
  reading: '阅读',
  practice: '练习',
  project: '项目',
  quiz: '测验',
  acquire: '获取',
  deconstruct: '拆解',
  model: '建模',
  execute: '执行',
  diagnose: '诊断',
  refine: '优化',
  consolidate: '巩固'
}[type] || type)
const getKnowledgeTypeLabel = (type: string) => ({
  factual: '知识点',
  conceptual: '原理理解',
  procedural: '动手操作',
  metacognitive: '反思总结'
}[type] || type)
const getCognitiveLevelLabel = (level: string) => ({
  remember: '了解',
  understand: '搞懂',
  apply: '实战',
  analyze: '拆解',
  evaluate: '决策',
  create: '创造'
}[level] || level)
const getTaskConceptLabel = (task: any) => {
  const conceptId = typeof task?.coreConcept === 'string' ? task.coreConcept : ''
  if (!conceptId) return ''
  const concepts = Array.isArray(pathData.value?.cognitiveDesign?.coreConcepts) ? pathData.value.cognitiveDesign.coreConcepts : []
  const conceptName = concepts.find((concept: any) => concept.id === conceptId)?.name
  return conceptName ? `关联概念：${conceptName}` : ''
}

const buildViewQuery = () => new URLSearchParams({
  virtualSessionId: sessionId,
  viewMode: 'debug'
}).toString()

const openGoalDebugView = () => {
  const goalConversationId = session.value?.bindings?.goalConversationId || session.value?.goalConversationId
  if (!goalConversationId) return
  router.push(`/admin/test/goal-full/${goalConversationId}?${buildViewQuery()}`)
}

const openPathDebugView = () => {
  const learningPathId = session.value?.bindings?.learningPathId || session.value?.learningPathId
  if (!learningPathId) return
  router.push(`/admin/test/learning-path/${learningPathId}?${buildViewQuery()}`)
}

const openLearnDebugView = () => {
  const lessonId = currentLesson.value?.id
  if (!lessonId) return
  router.push(`/admin/test/learn/${lessonId}?${buildViewQuery()}`)
}

const openGoalFormalView = () => {
  const goalConversationId = session.value?.bindings?.goalConversationId || session.value?.goalConversationId
  if (!goalConversationId) return
  window.open(`/goal-conversation/${goalConversationId}?virtualSessionId=${sessionId}&viewMode=formal`, '_blank')
}

const openPathFormalView = () => {
  const learningPathId = session.value?.bindings?.learningPathId || session.value?.learningPathId
  if (!learningPathId) return
  window.open(`/learning-path/${learningPathId}?virtualSessionId=${sessionId}&viewMode=formal`, '_blank')
}

const openLearnFormalView = () => {
  const lessonId = currentLesson.value?.id
  if (!lessonId) return
  window.open(`/learn/${lessonId}?virtualSessionId=${sessionId}&viewMode=formal`, '_blank')
}

const pathBannerText = computed(() => {
  if (pathStatus.value === 'generating' || pathStatus.value === 'not_started' || (goalReady.value && pathStatus.value === 'idle')) return 'Path 生成中'
  if (pathStatus.value === 'failed') return 'Path 失败'
  if (pathStatus.value === 'not_found') return 'Path 记录丢失'
  if (pathReady.value) return `Path 已生成 · ${pathData.value?.title || '--'}`
  return ''
})

const pathBannerTone = computed(() => {
  if (pathStatus.value === 'failed') return 'danger'
  if (pathReady.value) return 'success'
  return 'warn'
})

const selectLesson = (lessonId: string) => {
  selectedLessonId.value = lessonId
}

const openLessonFromPath = (lessonId: string) => {
  selectedLessonId.value = lessonId
  activeTab.value = 'learn'
}

const goPrevLesson = () => {
  if (currentLessonIndex.value <= 0) return
  selectedLessonId.value = learnLessons.value[currentLessonIndex.value - 1]?.id || null
}

const goNextLesson = () => {
  if (currentLessonIndex.value < 0 || currentLessonIndex.value >= learnLessons.value.length - 1) return
  selectedLessonId.value = learnLessons.value[currentLessonIndex.value + 1]?.id || null
}

const scrollToBottom = () => {
  nextTick(() => {
    if (messagesRef.value) messagesRef.value.scrollTop = messagesRef.value.scrollHeight
  })
}

const buildMessagesFromLogs = (items: LogItem[]) => {
  const nextMessages: any[] = []
  items.forEach(log => {
    if (log.phase === 'virtual-reply' && log.details?.output?.reply) nextMessages.push({ role: 'user', content: log.details.output.reply })
    if (log.phase === 'goal-response' && log.details?.output?.userVisible) nextMessages.push({ role: 'assistant', content: log.details.output.userVisible })
    if (log.phase === 'learning-start' && log.details?.output?.welcomeMessage) nextMessages.push({ role: 'assistant', content: log.details.output.welcomeMessage })
    if (log.phase === 'learning-reply' && log.details?.output?.reply) nextMessages.push({ role: 'user', content: log.details.output.reply })
    if (log.phase === 'learning-response' && log.details?.output?.aiResponse) nextMessages.push({ role: 'assistant', content: log.details.output.aiResponse })
  })
  messages.value = nextMessages
}

const exportChat = () => {
  const text = messages.value.map(item => `[${item.role === 'user' ? '虚拟用户' : '系统'}] ${item.content}`).join('\n\n')
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `virtual-session-${sessionId}.txt`
  a.click()
  URL.revokeObjectURL(url)
}

const syncLearningProgressFromPath = () => {
  if (pathData.value?.milestones?.length && learningProgress.value.totalMilestones === 0) {
    learningProgress.value.totalMilestones = pathData.value.milestones.length
  }
}

const loadSession = async () => {
  try {
    const res = await adminApi.getVirtualSession(sessionId)
    if (!res.data?.success) {
      ElMessage.error(res.data?.error || '加载会话失败')
      return
    }
    session.value = normalizeSessionContext(res.data.data)
    profile.value = res.data.data.profile
    logs.value = res.data.data.logs || []
    const learningState = session.value?.learningState || res.data.data.stageResults?.learning
    if (learningState) {
      learningProgress.value = {
        currentMilestone: typeof learningState.currentMilestone === 'number' ? learningState.currentMilestone + 1 : 0,
        totalMilestones: learningState.totalMilestones || pathData.value?.milestones?.length || 0,
        currentTask: learningState.currentTaskTitle || null
      }
      if (learningState.currentTaskId) selectedLessonId.value = learningState.currentTaskId
    }
    buildMessagesFromLogs(logs.value)
    scrollToBottom()
  } catch (error: any) {
    ElMessage.error(error.message || '加载会话失败')
  }
}

const refreshSessionState = async () => {
  refreshing.value = true
  try {
    await loadSession()

    if (session.value?.bindings?.learningPathId || session.value?.learningPathId) {
      await pollPathStatus()
      return
    }

    if (goalReady.value || session.value?.currentStage === 'path') {
      pathStatus.value = 'generating'
      startPathPolling()
      return
    }

    pathStatus.value = 'idle'
  } finally {
    refreshing.value = false
  }
}

const executeSingleStep = async () => {
  stepLoading.value = true
  try {
    const res = await adminApi.virtualSessionStep(sessionId)
    if (res.data?.success) {
      await refreshSessionState()
    } else {
      ElMessage.error(res.data?.error || '单步失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message || '单步失败')
  } finally {
    stepLoading.value = false
  }
}

const executeAutoLoop = async () => {
  autoLoading.value = true
  autoPollTimer = setInterval(() => { loadSession() }, 2000)
  try {
    const res = await adminApi.virtualSessionAuto(sessionId, { maxRounds: 20 })
    if (res.data?.success) {
      await refreshSessionState()
    } else {
      ElMessage.error(res.data?.error || '自动失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message || '自动失败')
  } finally {
    if (autoPollTimer) { clearInterval(autoPollTimer); autoPollTimer = null }
    autoLoading.value = false
  }
}

const retryPathGeneration = async () => {
  advanceLoading.value = true
  try {
    const res = await adminApi.virtualSessionAdvancePath(sessionId)
    if (res.data?.success) {
      pathStatus.value = 'generating'
      startPathPolling()
    } else {
      ElMessage.error(res.data?.error || '路径失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message || '路径失败')
  } finally {
    advanceLoading.value = false
  }
}

const startLearning = async (taskId?: string) => {
  learningStartLoading.value = true
  pendingTaskId.value = taskId || null
  if (taskId) selectedLessonId.value = taskId
  try {
    const res = await adminApi.startVirtualLearning(sessionId, taskId ? { taskId } : undefined)
    if (res.data?.success) {
      const data = res.data.data
      learningProgress.value = { currentMilestone: 1, totalMilestones: data.milestones?.length || 0, currentTask: null }
      await refreshSessionState()
      activeTab.value = 'learn'
    } else {
      ElMessage.error(res.data?.error || '启动学习失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message || '启动学习失败')
  } finally {
    learningStartLoading.value = false
    pendingTaskId.value = null
  }
}

const executeLearningStep = async () => {
  learningStepLoading.value = true
  try {
    const res = await adminApi.virtualSessionLearningStep(sessionId)
    if (res.data?.success) {
      if (res.data.data?.milestoneProgress) learningProgress.value = res.data.data.milestoneProgress
      await refreshSessionState()
      activeTab.value = 'learn'
    } else {
      ElMessage.error(res.data?.error || '学习失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message || '学习失败')
  } finally {
    learningStepLoading.value = false
  }
}

const executeAutoLearning = async () => {
  autoLearningLoading.value = true
  try {
    const res = await adminApi.virtualSessionAutoLearning(sessionId, { maxMilestones: 10 })
    if (res.data?.success) {
      await refreshSessionState()
      activeTab.value = 'learn'
    } else {
      ElMessage.error(res.data?.error || '自动学习失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message || '自动学习失败')
  } finally {
    autoLearningLoading.value = false
  }
}

const restartPath = async () => {
  restartPathLoading.value = true
  try {
    const res = await adminApi.restartVirtualSessionPath(sessionId)
    if (res.data?.success) {
      pathStatus.value = 'generating'
      startPathPolling()
      await refreshSessionState()
      activeTab.value = 'path'
    } else {
      ElMessage.error(res.data?.error || '重新开始 Path 失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message || '重新开始 Path 失败')
  } finally {
    restartPathLoading.value = false
  }
}

const restartLearning = async () => {
  restartLearningLoading.value = true
  try {
    const taskId = currentLesson.value?.id
    if (taskId) selectedLessonId.value = taskId
    const res = await adminApi.restartVirtualLearning(sessionId, taskId ? { taskId } : undefined)
    if (res.data?.success) {
      await refreshSessionState()
      activeTab.value = 'learn'
    } else {
      ElMessage.error(res.data?.error || '重新开始 Learn 失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message || '重新开始 Learn 失败')
  } finally {
    restartLearningLoading.value = false
  }
}

const stopLearning = async () => {
  stopLearningLoading.value = true
  try {
    const res = await adminApi.stopVirtualLearning(sessionId)
    if (res.data?.success) {
      await refreshSessionState()
      ElMessage.success('已紧急停止当前 Learn')
    } else {
      ElMessage.error(res.data?.error || '紧急停止失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message || '紧急停止失败')
  } finally {
    stopLearningLoading.value = false
  }
}

const pollPathStatus = async () => {
  try {
    const res = await adminApi.getVirtualSessionPathStatus(sessionId)
    if (res.data?.success) {
      pathStatus.value = res.data.data.status || 'idle'
      pathData.value = res.data.data.path
      if (res.data.data.pathContext) {
        pathData.value = {
          ...(res.data.data.path || {}),
          pathContext: res.data.data.pathContext
        }
      }
      if (res.data.data.learningPathId && !session.value?.learningPathId) {
        session.value = normalizeSessionContext({
          ...session.value,
          learningPathId: res.data.data.learningPathId,
          bindings: {
            ...(session.value?.bindings || {}),
            learningPathId: res.data.data.learningPathId,
          },
          currentStage: session.value?.currentStage === 'goal' ? 'path' : session.value?.currentStage
        })
      }
      syncLearningProgressFromPath()
      if (pathReady.value || pathStatus.value === 'failed') stopPathPolling()
    }
  } catch {
    // ignore
  }
}

const startPathPolling = () => {
  stopPathPolling()
  pathPollTimer = setInterval(pollPathStatus, 3000)
}

const stopPathPolling = () => {
  if (pathPollTimer) {
    clearInterval(pathPollTimer)
    pathPollTimer = null
  }
}

const loginAsVirtual = () => {
  if (profile.value?.email && profile.value?.password) {
    ElMessage.info(`邮箱 ${profile.value.email} / 密码 ${profile.value.password || 'VirtualTest123'}`)
  }
}

watch(goalReady, ready => {
  if (ready && session.value?.currentStage === 'path' && pathStatus.value === 'idle') {
    pathStatus.value = 'generating'
    startPathPolling()
  }
})

watch([learnLessons, () => learningProgress.value.currentTask], () => {
  if (!learnLessons.value.length) {
    selectedLessonId.value = null
    return
  }

  if (selectedLessonId.value && learnLessons.value.some(item => item.id === selectedLessonId.value)) {
    return
  }

  if (session.value?.currentStage === 'learning' && latestLearningTaskTitle.value) {
    const latestLesson = learnLessons.value.find(item => item.title === latestLearningTaskTitle.value)
    if (latestLesson) {
      selectedLessonId.value = latestLesson.id
      return
    }
  }

  const currentByTitle = learningProgress.value.currentTask
    ? learnLessons.value.find(item => item.title === learningProgress.value.currentTask)
    : null

  selectedLessonId.value = currentByTitle?.id || learnLessons.value.find(item => item.tone === 'active')?.id || learnLessons.value[0].id
}, { immediate: true })

onMounted(async () => {
  await refreshSessionState()
})

onUnmounted(() => {
  stopPathPolling()
  if (autoPollTimer) { clearInterval(autoPollTimer); autoPollTimer = null }
})
</script>

<style scoped>
.session-page {
  min-height: 100vh;
  padding: 16px;
  background: #f6f7fb;
  color: #1f2937;
}

.topbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 0;
  padding: 14px 18px;
  background: #fff;
  border: 1px solid #e5eaf2;
  border-radius: 16px;
}

.topbar-left,
.title-meta,
.mini-row,
.actionbar,
.chips,
.tabbar,
.kv-item,
.task-stage__head,
.turn-card__head,
.section-head,
.section-head__meta,
.log-card__head,
.event-row {
  display: flex;
  align-items: center;
}

.topbar-left {
  gap: 12px;
}

.topbar-avatar {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: linear-gradient(135deg, #1f4fd6, #7c3aed);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 700;
  flex-shrink: 0;
}

.title-wrap h1 {
  margin: 0;
  font-size: 18px;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.topbar-goal {
  margin: 2px 0 0;
  font-size: 13px;
  color: #5f6b7d;
  max-width: 500px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.topbar-meta {
  display: flex;
  gap: 6px;
  font-size: 12px;
  color: #8b94a6;
  margin-top: 4px;
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.title-meta {
  gap: 8px;
}

.stage-strip-wrapper {
  max-width: 1400px;
  margin: 10px auto 12px;
  padding: 0 4px;
}

.stage-strip {
  display: flex;
  align-items: center;
  gap: 8px;
}

.stage-pill {
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 12px;
  background: #eef2f7;
  color: #7a8597;
}

.stage-pill.active {
  background: #eef5ff;
  color: #1f4fd6;
}

.stage-pill.done {
  background: #e7f8eb;
  color: #1f8a4d;
}

.stage-line {
  width: 20px;
  height: 2px;
  background: #dce3ed;
}

.stage-line.done {
  background: #90d0a7;
}

.metrics-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}

.metric-card,
.panel,
.status-banner {
  background: #fff;
  border: 1px solid #e5eaf2;
  border-radius: 16px;
}

.metric-card {
  padding: 14px;
}

.metric-card__label {
  display: block;
  font-size: 11px;
  color: #8a94a6;
  margin-bottom: 6px;
}

.metric-card__value {
  font-size: 24px;
}

.status-banner {
  max-width: 1400px;
  margin: 0 auto 12px;
  padding: 10px 14px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-banner.warn {
  color: #9a6a08;
}

.status-banner.success {
  color: #1f8a4d;
}

.status-banner.danger {
  color: #c53838;
}

.path-hero-card {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  padding: 18px;
  margin-bottom: 12px;
  background: #fff;
  border: 1px solid #e5eaf2;
  border-radius: 16px;
}

.path-hero-card__copy {
  flex: 1;
}

.path-hero-card__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}

.path-hero-card__tag {
  padding: 6px 10px;
  border-radius: 999px;
  background: #eef2f7;
  color: #7a8597;
  font-size: 12px;
}

.path-hero-card h2 {
  margin: 0 0 8px;
  font-size: 22px;
}

.path-hero-card p {
  margin: 0;
  color: #5f6b7d;
  line-height: 1.6;
}

.path-hero-card__side {
  width: 180px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.path-hero-action {
  width: 100%;
}

.path-detail-main-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 330px;
  gap: 12px;
}

.path-stage-column,
.path-side-column {
  min-width: 0;
}

.path-detail-overview-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-top: 12px;
}

.path-detail-overview-card {
  padding: 12px;
  border-radius: 14px;
  background: #fbfcfe;
  border: 1px solid #e7ecf3;
}

.path-detail-overview-card span {
  display: block;
  font-size: 11px;
  color: #7b8597;
  margin-bottom: 6px;
}

.path-detail-overview-card strong {
  font-size: 14px;
}

.path-detail-progress__ring {
  width: 120px;
  height: 120px;
  border-radius: 50%;
  background: conic-gradient(#1f4fd6 calc(var(--progress) * 1%), #eef2f7 0);
  display: flex;
  align-items: center;
  justify-content: center;
}

.path-detail-progress__ring-label {
  width: 84px;
  height: 84px;
  border-radius: 50%;
  background: #fff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.progress-value {
  font-size: 22px;
  font-weight: 700;
}

.progress-label {
  font-size: 11px;
  color: #7b8597;
}

.path-detail-side-card {
  padding: 14px;
}

.path-detail-side-card__head {
  margin-bottom: 10px;
}

.path-detail-side-card__time {
  font-size: 12px;
  color: #7b8597;
  margin-bottom: 10px;
}

.path-detail-note-list {
  margin: 0;
  padding-left: 18px;
  color: #475569;
  line-height: 1.7;
}

.path-detail-plan-list {
  display: grid;
  gap: 10px;
  margin-bottom: 12px;
}

.path-detail-plan-item {
  padding: 12px;
  border-radius: 14px;
  background: #fff;
  border: 1px solid #e7ecf3;
}

.path-detail-plan-item strong {
  display: block;
  margin-bottom: 4px;
}

.path-detail-plan-item p {
  margin: 0;
  color: #5f6b7d;
  line-height: 1.5;
}

.path-detail-domain-block {
  margin-bottom: 10px;
  padding: 12px;
  border-radius: 14px;
  background: #fbfcfe;
  border: 1px solid #e7ecf3;
}

.path-detail-domain-block span {
  display: block;
  font-size: 11px;
  color: #7b8597;
  margin-bottom: 6px;
}

.path-detail-domain-block strong {
  font-size: 14px;
}

.path-context-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 10px 0 12px;
}

.path-context-strip span {
  padding: 4px 8px;
  border-radius: 999px;
  background: #f3f6fb;
  color: #5f6b7d;
  font-size: 12px;
}

.metrics-row,
.layout,
.status-banner {
  max-width: 1400px;
  margin: 0 auto;
}

.layout {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.main {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.panel {
  padding: 14px;
}

.panel-title,
.section-head__title {
  font-size: 13px;
  font-weight: 700;
}

.sample-card {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.sample-avatar {
  width: 38px;
  height: 38px;
  border-radius: 12px;
  background: linear-gradient(135deg, #1f4fd6, #7c3aed);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
}

.muted {
  font-size: 12px;
  color: #7b8597;
}

.kv-list {
  display: grid;
  gap: 10px;
}

.kv-item {
  justify-content: space-between;
  gap: 10px;
}

.kv-item span {
  font-size: 12px;
  color: #7b8597;
}

.kv-item strong {
  font-size: 12px;
  text-align: right;
}

.nav-item,
.tab,
.action-stack :deep(button) {
  width: 100%;
}

.nav-item {
  border: 1px solid #e6ebf2;
  background: #fbfcfe;
  border-radius: 14px;
  padding: 10px 12px;
  text-align: left;
  cursor: pointer;
  margin-bottom: 8px;
}

.nav-item.active {
  border-color: #c8dafd;
  background: #f4f8ff;
}

.nav-item strong,
.nav-item span {
  display: block;
}

.nav-item span {
  font-size: 11px;
  color: #7b8597;
  margin-top: 4px;
}

.action-stack {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tabbar {
  gap: 8px;
  flex-wrap: wrap;
}

.tab {
  width: auto;
  border: 1px solid #dce4ee;
  background: #fff;
  border-radius: 999px;
  padding: 8px 12px;
  cursor: pointer;
}

.tab.active {
  background: #1f4fd6;
  color: #fff;
  border-color: #1f4fd6;
}

.main-panel {
  min-height: 520px;
}

.section-head {
  justify-content: space-between;
  margin-bottom: 12px;
}

.section-head__meta {
  gap: 8px;
  font-size: 12px;
  color: #7b8597;
}

.mini-row {
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.mini-row span,
.chip,
.task-meta,
.event-row span,
.event-row em {
  font-size: 11px;
  color: #6b7280;
  background: #f1f5f9;
  border-radius: 999px;
  padding: 4px 8px;
}

.card-list,
.path-column,
.log-list,
.event-list,
.task-tree,
.task-list,
.lesson-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.overview-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.inspector-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 12px;
}

.inspector-card {
  padding: 12px;
  border: 1px solid #e7ecf3;
  border-radius: 14px;
  background: #fbfcfe;
}

.inspector-card--full {
  grid-column: 1 / -1;
}

.entry-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.inspector-pre {
  margin: 10px 0 0;
  padding: 10px;
  border-radius: 12px;
  background: #111827;
  color: #e5edf9;
  overflow: auto;
  font-size: 12px;
}

.overview-card,
.turn-card,
.milestone-card,
.task-stage,
.log-card,
.event-row,
.signal-box,
.latent-box,
.task-item,
.lesson-item,
.lesson-header-card {
  border: 1px solid #e7ecf3;
  border-radius: 14px;
  background: #fbfcfe;
}

.overview-card,
.turn-card,
.milestone-card,
.task-stage,
.log-card {
  padding: 12px;
}

.overview-card span,
.signal-box span,
.latent-box span {
  display: block;
  font-size: 11px;
  color: #7b8597;
  margin-bottom: 6px;
}

.overview-card strong,
.milestone-card h3,
.task-item strong {
  display: block;
  margin: 0;
}

.overview-card em,
.milestone-card__meta {
  display: block;
  margin-top: 8px;
  font-size: 11px;
  color: #7b8597;
  font-style: normal;
}

.turn-card__head,
.milestone-card__head,
.task-stage__head,
.log-card__head,
.event-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.milestone-card__head--path {
  align-items: flex-start;
}

.milestone-card__meta--path {
  margin-top: 0;
  white-space: nowrap;
}

.milestone-card__desc {
  margin: 8px 0 0;
  color: #5f6b7d;
  line-height: 1.6;
}

.path-task-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}

.path-task-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid #e7ecf3;
  border-radius: 12px;
  background: #ffffff;
}

.path-task-row__info {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.path-task-row__title-line {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.path-task-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.path-task-chip {
  padding: 3px 8px;
  border-radius: 999px;
  background: #f1f5f9;
  color: #64748b;
  font-size: 11px;
}

.path-task-desc {
  margin: 4px 0 0;
  color: #5f6b7d;
  line-height: 1.6;
}

.path-task-link {
  flex: 1;
  border: 0;
  padding: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.path-task-link:hover strong {
  color: #1f4fd6;
}

.path-task-row__info strong {
  line-height: 1.4;
}

.path-task-row__info span {
  font-size: 11px;
  color: #7b8597;
}

.path-task-pill {
  flex: 0 0 auto;
  font-size: 11px;
  line-height: 1;
  padding: 6px 8px;
  border-radius: 999px;
  border: 1px solid transparent;
}

.path-task-row.ready {
  border-color: #cfe0ff;
  background: #f8fbff;
}

.path-task-row.active {
  border-color: #bfd7ff;
  background: #eff6ff;
}

.path-task-row.done {
  border-color: #cfead8;
  background: #f3fbf6;
}

.path-task-row.pending {
  border-color: #e7ecf3;
  background: #f8fafc;
}

.path-task-pill.ready {
  color: #1f4fd6;
  background: #eef5ff;
  border-color: #d7e5ff;
}

.path-task-pill.active {
  color: #1d4ed8;
  background: #dbeafe;
  border-color: #bfdbfe;
}

.path-task-pill.done {
  color: #1f8a4d;
  background: #e7f8eb;
  border-color: #cfead8;
}

.path-task-pill.pending {
  color: #64748b;
  background: #f1f5f9;
  border-color: #e2e8f0;
}

.chips {
  gap: 6px;
  flex-wrap: wrap;
}

.turn-card__title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.turn-card__time {
  font-size: 12px;
  color: #7b8597;
  font-weight: 500;
}

.chip.success {
  background: #e7f8eb;
  color: #1f8a4d;
}

.chip.info {
  background: #eef5ff;
  color: #1f4fd6;
}

.chip.warning {
  background: #fff4df;
  color: #9c6b03;
}

.msg {
  padding: 10px 12px;
  border-radius: 12px;
  margin-top: 8px;
  line-height: 1.55;
}

.dialog-row {
  margin-top: 8px;
}

.dialog-role {
  display: inline-flex;
  margin-bottom: 6px;
  font-size: 11px;
  font-weight: 700;
  color: #475569;
}

.msg-user {
  background: #eef4ff;
  border-left: 3px solid #3b82f6;
}

.msg-ai {
  background: #f8fafc;
  border-left: 3px solid #cbd5e1;
}

.signal-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-top: 8px;
}

.latent-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-top: 8px;
}

.signal-box {
  padding: 10px;
}

.latent-box {
  padding: 10px;
  background: #f8fafc;
}

.signal-box strong {
  font-size: 12px;
}

.latent-box strong {
  font-size: 12px;
  color: #334155;
  line-height: 1.45;
}

.lesson-main {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.learn-workbench {
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr);
  gap: 14px;
}

.learn-sidebar,
.learn-main-column {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.learn-side-card {
  padding: 14px;
  border: 1px solid #e7ecf3;
  border-radius: 14px;
  background: #fbfcfe;
}

.learn-eyebrow {
  display: inline-block;
  margin-bottom: 10px;
  font-size: 11px;
  color: #7b8597;
}

.learn-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.learn-section-head h3 {
  margin: 2px 0 0;
  font-size: 16px;
}

.learn-side-card__desc {
  margin: 6px 0 0;
  color: #5f6b7d;
  line-height: 1.55;
}

.learn-kp-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.learn-kp-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid #e7ecf3;
  border-radius: 12px;
  background: #fff;
}

.learn-kp-item strong,
.learn-kp-item span {
  font-size: 12px;
}

.learn-kp-item span {
  color: #64748b;
}

.latent-grid--sidebar {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.empty-box--compact {
  padding: 12px;
  font-size: 12px;
}

.lesson-main__actions--toolbar {
  padding: 0 2px;
}

.turn-card--learn {
  background: #fff;
}

.learn-conversation-card,
.learn-debug-card {
  background: #fbfcfe;
}

.lesson-header-card,
.lesson-header-card__meta,
.lesson-main__actions {
  display: flex;
  align-items: center;
}

.lesson-header-card,
.lesson-main__actions {
  justify-content: space-between;
  gap: 8px;
}

.lesson-main--full {
  min-width: 0;
}

.lesson-header-card {
  justify-content: space-between;
  padding: 12px;
}

.lesson-header-card h3 {
  margin: 4px 0 0;
  font-size: 18px;
  line-height: 1.4;
}

.lesson-header-card.active {
  border-color: #bfd7ff;
  background: #eff6ff;
}

.lesson-header-card.ready {
  border-color: #cfe0ff;
  background: #f8fbff;
}

.lesson-header-card.done {
  border-color: #cfead8;
  background: #f3fbf6;
}

.lesson-header-card.pending {
  background: #f8fafc;
}

.lesson-header-card__meta,
.lesson-main__actions {
  gap: 8px;
  justify-content: flex-end;
}

.knowledge-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-top: 8px;
}

.msg-peer {
  background: #fff7ed;
  border-left: 3px solid #fb923c;
}

.task-stage.active {
  border-color: #bfd7ff;
  background: #f3f8ff;
}

.task-stage.done {
  border-color: #cfead8;
  background: #f3fbf6;
}

.task-item.active {
  border-color: #bfd7ff;
  background: #eff6ff;
}

.task-item.done {
  border-color: #cfead8;
  background: #f3fbf6;
}

.task-item {
  padding: 10px;
}

.task-meta {
  margin-top: 6px;
  display: inline-flex;
}

.event-row {
  padding: 10px 12px;
}

.log-card pre {
  margin: 10px 0 0;
  padding: 10px;
  border-radius: 12px;
  background: #111827;
  color: #e5edf9;
  overflow: auto;
  font-size: 12px;
}

.empty-box {
  padding: 18px;
  border: 1px dashed #d9e1eb;
  border-radius: 14px;
  text-align: center;
  color: #8a94a6;
}

.actionbar {
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 12px;
}

@media (max-width: 1180px) {
  .learn-workbench,
  .layout,
  .inspector-grid,
  .overview-grid,
  .signal-grid,
  .knowledge-grid,
  .latent-grid {
    grid-template-columns: 1fr;
  }

  .metrics-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .topbar {
    flex-direction: column;
    gap: 12px;
  }

  .topbar-right {
    width: 100%;
    justify-content: flex-end;
  }

  .topbar-goal {
    max-width: 100%;
  }

  .path-task-row {
    align-items: flex-start;
    flex-direction: column;
  }

  .lesson-header-card {
    align-items: flex-start;
    flex-direction: column;
  }

  .latent-grid--sidebar {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .metrics-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 480px) {
  .metrics-row {
    grid-template-columns: 1fr;
  }
}
</style>
