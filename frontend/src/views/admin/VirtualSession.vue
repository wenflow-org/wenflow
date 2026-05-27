<template>
  <div class="session-page">
    <header class="topbar">
      <div class="topbar-left">
        <el-button text @click="router.push('/admin/virtual-learners')">
          <el-icon><ArrowLeft /></el-icon>
          返回
        </el-button>
        <el-button text :loading="refreshing" @click="refreshSessionState">
          <el-icon><Refresh /></el-icon>
          刷新
        </el-button>
        <div class="title-wrap">
          <h1>{{ profile?.userName || '会话详情' }}</h1>
          <div class="title-meta">
            <el-tag size="small" :type="getStatusType(session?.status)">{{ getStatusLabel(session?.status) }}</el-tag>
            <el-tag size="small" type="info">{{ getStageLabel(session?.currentStage) }}</el-tag>
          </div>
        </div>
      </div>

      <div class="stage-strip">
        <span class="stage-pill" :class="getStagePillClass('goal')">Goal</span>
        <span class="stage-line" :class="{ done: goalReady }"></span>
        <span class="stage-pill" :class="getStagePillClass('path')">Path</span>
        <span class="stage-line" :class="{ done: pathReady }"></span>
        <span class="stage-pill" :class="getStagePillClass('learning')">Learn</span>
      </div>
    </header>

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

    <main class="layout layout--compact">
      <aside class="sidebar">
        <section class="panel">
          <div class="panel-title">样本</div>
          <div class="sample-card">
            <div class="sample-avatar">{{ profile?.userName?.charAt(0) || '?' }}</div>
            <div>
              <strong>{{ profile?.userName || '--' }}</strong>
              <div class="muted">{{ profile?.knowledgeLevel || '--' }}</div>
            </div>
          </div>
          <div class="kv-list">
            <div class="kv-item"><span>目标</span><strong>{{ profile?.learningGoal || '--' }}</strong></div>
            <div class="kv-item"><span>模式</span><strong>{{ profile?.simulationMode === 'ai' ? 'AI' : '手动' }}</strong></div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-title">操作</div>
          <div class="action-stack">
            <el-button round @click="loginAsVirtual">登录账号</el-button>
            <el-button round @click="exportChat">导出</el-button>
          </div>
        </section>
      </aside>

      <section class="main">
        <div class="tabbar">
          <button v-for="item in tabs" :key="item.key" class="tab" :class="{ active: activeTab === item.key }" @click="activeTab = item.key">{{ item.label }}</button>
        </div>

        <section v-if="activeTab === 'overview'" class="panel main-panel">
          <div class="section-head">
            <div class="section-head__title">总览</div>
            <div class="section-head__meta">{{ keyEvents.length }} 事件</div>
          </div>
          <div class="overview-grid">
            <article v-for="item in overviewCards" :key="item.label" class="overview-card">
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
              <em>{{ item.meta }}</em>
            </article>
          </div>
        </section>

        <section v-else-if="activeTab === 'goal'" class="panel main-panel">
          <div class="section-head">
            <div class="section-head__title">Goal</div>
            <div class="section-head__meta">{{ goalRounds.length }} 轮</div>
          </div>
          <div class="mini-row">
            <span>{{ goalSummary.status }}</span>
            <span>{{ goalSummary.finalStage }}</span>
            <span>{{ goalSummary.quickReplyCount }} replies</span>
          </div>
          <div class="card-list">
            <article v-for="item in goalRounds" :key="item.id" class="turn-card">
              <div class="turn-card__head">
                <strong>第 {{ item.round }} 轮</strong>
                <div class="chips"><span v-for="chip in item.badges" :key="chip.text" class="chip" :class="chip.tone">{{ chip.text }}</span></div>
              </div>
              <div v-if="item.userMessage" class="dialog-row dialog-row-user">
                <span class="dialog-role">画像用户</span>
                <div class="msg msg-user">{{ item.userMessage }}</div>
              </div>
              <div v-if="item.assistantMessage" class="dialog-row dialog-row-ai">
                <span class="dialog-role">系统追问</span>
                <div class="msg msg-ai">{{ item.assistantMessage }}</div>
              </div>
              <div v-if="item.learnerRows?.length" class="latent-grid">
                <div v-for="state in item.learnerRows" :key="state.label" class="latent-box"><span>{{ state.label }}</span><strong>{{ state.value }}</strong></div>
              </div>
            </article>
            <div v-if="goalRounds.length === 0" class="empty-box">暂无</div>
          </div>
        </section>

        <section v-else-if="activeTab === 'path'" class="panel main-panel">
          <div class="section-head">
            <div class="section-head__title">Path</div>
            <div class="section-head__meta">{{ milestoneCards.length }} milestones / {{ totalTaskCount }} tasks</div>
          </div>
          <div class="mini-row">
            <span>{{ pathStatusLabel }}</span>
            <span>{{ pathData?.title || '--' }}</span>
            <span>{{ pathData?.estimatedHours ? `${pathData.estimatedHours}h` : '--' }}</span>
          </div>
          <div class="path-column">
            <article v-for="item in milestoneCards" :key="item.id" class="milestone-card">
              <div class="milestone-card__head milestone-card__head--path">
                <div>
                  <strong>M{{ item.stageNumber }} {{ item.status }}</strong>
                  <h3>{{ item.title }}</h3>
                </div>
                <span class="milestone-card__meta milestone-card__meta--path">{{ item.estimatedHours }}</span>
              </div>
              <div v-if="item.tasks.length" class="path-task-list">
                <div v-for="task in item.tasks" :key="task.id" class="path-task-row" :class="task.tone">
                  <button type="button" class="path-task-row__info path-task-link" @click="openLessonFromPath(task.id)">
                    <strong>{{ task.title }}</strong>
                    <span>{{ task.status }} · {{ task.estimatedMinutes }}</span>
                  </button>
                  <span v-if="!task.canStart" class="path-task-pill" :class="task.tone">{{ task.status }}</span>
                  <el-button
                    v-if="task.canStart && pathReady && session?.currentStage !== 'learning'"
                    size="small"
                    type="primary"
                    plain
                    :loading="learningStartLoading && pendingTaskId === task.id"
                    @click="startLearning(task.id)"
                  >
                    从此开始
                  </el-button>
                </div>
              </div>
            </article>
            <div v-if="milestoneCards.length === 0" class="empty-box">暂无</div>
          </div>
        </section>

        <section v-else-if="activeTab === 'learn'" class="panel main-panel learn-panel">
          <div class="section-head">
            <div class="section-head__title">Learn</div>
            <div class="section-head__meta">{{ currentLessonRounds.length }} 轮</div>
          </div>
          <div class="mini-row">
            <span>{{ learnSummary.progressLabel }}</span>
            <span>{{ learnSummary.currentMilestone }}</span>
            <span>{{ currentLesson?.title || learnSummary.currentTask }}</span>
          </div>
          <div class="lesson-main lesson-main--full">
              <div v-if="currentLesson" class="lesson-header-card" :class="currentLesson.tone">
                <div>
                  <div class="muted">{{ currentLesson.milestoneLabel }}</div>
                  <h3>{{ currentLesson.title }}</h3>
                </div>
                <div class="lesson-header-card__meta">
                  <span class="path-task-pill pending">{{ currentLessonIndex + 1 }}/{{ learnLessons.length || 0 }}</span>
                  <span class="path-task-pill" :class="currentLesson.tone">{{ currentLesson.status }}</span>
                  <span class="path-task-pill pending">{{ currentLesson.estimatedMinutes }}</span>
                </div>
              </div>
              <div v-else class="empty-box">暂无课次</div>

              <div class="lesson-main__actions">
                <el-button size="small" :disabled="currentLessonIndex <= 0" @click="goPrevLesson">上一节</el-button>
                <el-button size="small" :disabled="currentLessonIndex >= learnLessons.length - 1" @click="goNextLesson">下一节</el-button>
                <el-button
                  v-if="currentLesson?.canStart && session?.currentStage !== 'learning'"
                  size="small"
                  type="primary"
                  plain
                  :loading="learningStartLoading && pendingTaskId === currentLesson.id"
                  @click="startLearning(currentLesson.id)"
                >
                  从此开始
                </el-button>
              </div>

              <div class="card-list">
                <article v-for="item in currentLessonRounds" :key="item.id" class="turn-card">
                  <div class="turn-card__head">
                    <div class="turn-card__title">
                      <strong>{{ item.title }}</strong>
                      <span v-if="item.time" class="turn-card__time">{{ item.time }}</span>
                    </div>
                    <div class="chips"><span v-for="chip in item.badges" :key="chip.text" class="chip" :class="chip.tone">{{ chip.text }}</span></div>
                  </div>
                  <div v-if="item.userMessage" class="dialog-row dialog-row-user">
                    <span class="dialog-role">画像用户</span>
                    <div class="msg msg-user">{{ item.userMessage }}</div>
                  </div>
                  <div v-if="item.assistantMessage" class="dialog-row dialog-row-ai">
                    <span class="dialog-role">AI 教师</span>
                    <div class="msg msg-ai">{{ item.assistantMessage }}</div>
                  </div>
                  <div v-if="item.signalRows?.length" class="signal-grid">
                    <div v-for="signal in item.signalRows" :key="signal.label" class="signal-box"><span>{{ signal.label }}</span><strong>{{ signal.value }}</strong></div>
                  </div>
                  <div v-if="item.monitorRows?.length" class="signal-grid">
                    <div v-for="monitor in item.monitorRows" :key="monitor.label" class="signal-box"><span>{{ monitor.label }}</span><strong>{{ monitor.value }}</strong></div>
                  </div>
                  <div v-if="item.peerMessage" class="msg msg-ai msg-peer">伴学：{{ item.peerMessage }}</div>
                  <div v-if="item.knowledgeRows?.length" class="knowledge-grid">
                    <div v-for="knowledge in item.knowledgeRows" :key="knowledge.label" class="signal-box"><span>{{ knowledge.label }}</span><strong>{{ knowledge.value }}</strong></div>
                  </div>
                  <div v-if="item.learnerRows?.length" class="latent-grid">
                    <div v-for="state in item.learnerRows" :key="state.label" class="latent-box"><span>{{ state.label }}</span><strong>{{ state.value }}</strong></div>
                  </div>
                </article>
                <div v-if="currentLessonRounds.length === 0" class="empty-box">这节课还没有学习会话</div>
              </div>
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
}

type LearnLesson = {
  id: string
  title: string
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

const tabs = [
  { key: 'overview', label: '全流程' },
  { key: 'goal', label: 'Goal' },
  { key: 'path', label: 'Path' },
  { key: 'learn', label: 'Learn' },
  { key: 'events', label: '事件' },
  { key: 'logs', label: '日志' }
] as const

const isGoalConvergedStage = (stage?: string | null) => stage === 'ready' || stage === 'completed'

const formatTime = (time: string | null | undefined) => {
  if (!time) return '--'
  const d = new Date(time)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

const goalReady = computed(() => {
  if (session.value?.currentStage === 'path' || session.value?.currentStage === 'learning') return true
  return isGoalConvergedStage(logs.value.filter(l => l.phase === 'goal-response').pop()?.details?.output?.stage)
})

const pathReady = computed(() => ['active', 'ready', 'completed'].includes(pathStatus.value))
const totalRounds = computed(() => logs.value.filter(l => l.phase === 'virtual-reply' || l.phase === 'learning-reply').length)
const errorCount = computed(() => logs.value.filter(l => l.phase === 'error').length)

const filteredLogs = computed(() => (logFilter.value === 'all' ? logs.value : logs.value.filter(l => l.phase === logFilter.value)))
const lastQuickReplies = computed(() => logs.value.filter(l => l.phase === 'goal-response').pop()?.details?.output?.quickReplies || [])

const pathStatusLabel = computed(() => {
  if (pathReady.value) return '已生成'
  if (pathStatus.value === 'generating') return '生成中'
  if (pathStatus.value === 'failed') return '失败'
  if (pathStatus.value === 'not_found') return '丢失'
  if (pathStatus.value === 'not_started') return goalReady.value || session.value?.currentStage === 'path' ? '生成中' : '未开始'
  if (goalReady.value) return '待确认'
  return '未开始'
})

const topMetrics = computed(() => [
  { label: '阶段', value: getStageLabel(session.value?.currentStage) },
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
          status: taskStatus,
          estimatedMinutes: task.estimatedMinutes ? `${task.estimatedMinutes}m` : '--',
          tone,
          canStart
        }
      })
    }
  })
})

const totalTaskCount = computed(() => milestoneCards.value.reduce((sum, item) => sum + item.tasks.length, 0))

const goalSummary = computed(() => {
  const rounds = logs.value.filter(l => l.phase === 'virtual-reply').length
  const finalStage = logs.value.filter(l => l.phase === 'goal-response').pop()?.details?.output?.stage || '进行中'
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
  const latestLearningLog = logs.value.slice().reverse().find(log =>
    log.phase === 'learning-reply' || log.phase === 'learning-start'
  )

  return latestLearningLog?.details?.output?.currentTask || null
})

const learnLessons = computed<LearnLesson[]>(() => milestoneCards.value.flatMap(item => item.tasks.map((task: any, index: number) => ({
  id: task.id,
  title: task.title,
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
  { label: 'Learn', value: session.value?.currentStage === 'learning' ? '进行中' : '未进入', meta: `${learnSummary.value.progressLabel}` }
])

const goalRounds = computed<ReplayRound[]>(() => {
  const rounds: ReplayRound[] = []
  const virtualLogs = logs.value.filter(l => l.phase === 'virtual-reply')
  const goalResponseLogs = logs.value.filter(l => l.phase === 'goal-response')
  const total = Math.max(virtualLogs.length, goalResponseLogs.length)
  for (let i = 0; i < total; i++) {
    const userLog = virtualLogs[i]
    const assistantLog = goalResponseLogs[i]
      rounds.push({
        id: `goal-${i}`,
        round: i + 1,
        title: `第 ${i + 1} 轮`,
        userMessage: userLog?.details?.output?.reply || '',
          assistantMessage: assistantLog?.details?.output?.userVisible || '',
          badges: [
            ...(assistantLog?.details?.output?.stage ? [{ text: assistantLog.details.output.stage, tone: isGoalConvergedStage(assistantLog.details.output.stage) ? 'success' : 'neutral' }] : []),
            ...(assistantLog?.details?.output?.confidence !== undefined ? [{ text: `c ${assistantLog.details.output.confidence}`, tone: 'info' }] : []),
            ...(Array.isArray(assistantLog?.details?.output?.quickReplies) ? [{ text: `${assistantLog.details.output.quickReplies.length} replies`, tone: 'warning' }] : [])
          ],
      signalRows: [
        { label: 'stage', value: assistantLog?.details?.output?.stage || '--' },
        { label: 'confidence', value: assistantLog?.details?.output?.confidence !== undefined ? String(assistantLog.details.output.confidence) : '--' },
        { label: 'replies', value: Array.isArray(assistantLog?.details?.output?.quickReplies) ? String(assistantLog.details.output.quickReplies.length) : '--' }
      ]
    })
  }
  return rounds
})

const learnRounds = computed<ReplayRound[]>(() => {
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
        kind: 'opening'
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
        kind: 'round'
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
        title: '课程开场'
      }
    }

    roundNumber += 1
    return {
      ...item,
      title: `第 ${roundNumber} 轮`
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
    session.value = res.data.data
    profile.value = res.data.data.profile
    logs.value = res.data.data.logs || []
    const learningState = res.data.data.stageResults?.learning
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

    if (session.value?.learningPathId) {
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
      if (res.data.data.learningPathId && !session.value?.learningPathId) {
        session.value = {
          ...session.value,
          learningPathId: res.data.data.learningPathId,
          currentStage: session.value?.currentStage === 'goal' ? 'path' : session.value?.currentStage
        }
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
})
</script>

<style scoped>
.session-page {
  min-height: 100vh;
  padding: 16px;
  background: #f6f7fb;
  color: #1f2937;
}

.topbar,
.metrics-row,
.layout {
  max-width: 1400px;
  margin: 0 auto;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}

.topbar-left,
.title-meta,
.stage-strip,
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

.title-wrap h1 {
  margin: 0;
  font-size: 24px;
}

.title-meta {
  gap: 8px;
  margin-top: 4px;
}

.stage-strip {
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
  grid-template-columns: repeat(5, minmax(0, 1fr));
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

.layout {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 12px;
}

.sidebar,
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
  .layout,
  .overview-grid,
  .signal-grid,
  .knowledge-grid,
  .latent-grid {
    grid-template-columns: 1fr;
  }

  .metrics-row {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .layout {
    display: flex;
    flex-direction: column;
  }

  .path-task-row {
    align-items: flex-start;
    flex-direction: column;
  }

  .lesson-header-card {
    align-items: flex-start;
    flex-direction: column;
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
