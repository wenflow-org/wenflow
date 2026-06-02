<template>
  <div class="story-overview-page">
    <header class="story-overview-topbar">
        <div class="story-overview-topbar__left">
          <div class="story-overview-topbar__title">
            <div class="story-overview-topbar__crumbs">
              <el-button text class="story-overview-topbar__back" @click="router.push(`/admin/virtual-learners/${profileId}`)">
                <el-icon><ArrowLeft /></el-icon>
                返回学习者面板
              </el-button>
            </div>
            <h1>{{ selectedStorySummary?.storyTitle || selectedStorySummary?.title || '故事包' }}</h1>
            <p>{{ storyOverviewSubtitle }}</p>
          </div>
        </div>
      <div class="story-overview-topbar__actions">
        <el-button @click="loadOverview" :loading="loading">刷新</el-button>
      </div>
    </header>

    <main class="story-overview-layout" v-if="selectedStorySummary">
      <section class="story-overview-hero panel-card">
        <div class="story-overview-hero__copy">
          <div class="story-overview-hero__head">
            <span class="story-overview-hero__label">故事概览</span>
            <h2>{{ selectedStorySummary.storyTitle || selectedStorySummary.title || '未命名故事' }}</h2>
          </div>
          <p>{{ selectedStorySummary.storyOutline || selectedStorySummary.storyTriggerEvent || '暂无故事摘要' }}</p>
          <div class="story-overview-hero__actions">
            <el-button type="primary" @click="handleStartSession(selectedStorySummary, selectedStorySummary?.index)">
              {{ selectedStorySession ? '重新开始学习' : '开始学习' }}
            </el-button>
            <el-button plain @click="openStoryEditDialog(selectedStorySummary, selectedStorySummary.index)">编辑故事</el-button>
          </div>
          <div class="story-overview-hero__context-grid">
            <article class="story-context-card story-context-card--trigger">
              <span>触发源头</span>
              <strong>{{ storyContextTrigger.title }}</strong>
              <p>{{ storyContextTrigger.description }}</p>
            </article>

            <article class="story-context-card story-context-card--opening">
              <span>当前卡点</span>
              <strong>{{ storyContextBlocker.title }}</strong>
              <p>{{ storyContextBlocker.description }}</p>
            </article>
          </div>
        </div>
        <div class="story-overview-hero__side">
          <div class="story-overview-hero__summary">
            <div class="story-overview-summary-row">
              <span>当前状态</span>
              <div>
                <strong>{{ selectedStoryStatusTag }}</strong>
                <em>{{ selectedStorySession ? `当前位于 ${getSessionStageLabel(selectedStorySession.currentStage)}` : '尚未开始' }}</em>
              </div>
            </div>
            <div class="story-overview-summary-row">
              <span>当前任务</span>
              <div>
                <strong>{{ selectedStoryTaskLabel }}</strong>
                <em>{{ selectedStoryLearnVisibleState }}</em>
              </div>
            </div>
            <div class="story-overview-summary-row">
              <span>学习路线</span>
              <div>
                <strong>{{ selectedStoryPathVisibleState }}</strong>
                <em>{{ selectedStoryPathSummary }}</em>
              </div>
            </div>
          </div>
          <article class="story-context-card story-context-card--pressure story-context-card--entry-side">
            <span>问题基础</span>
            <strong>{{ storyContextKnowledge.title }}</strong>
            <p>{{ storyContextKnowledge.description }}</p>
            <div v-if="storyPressurePoints.length" class="story-pressure-list">
              <span v-for="item in storyPressurePoints.slice(0, 2)" :key="item" class="story-pressure-chip">{{ item }}</span>
            </div>
          </article>
        </div>
      </section>

      <section class="story-overview-flow panel-card">
        <div class="section-head">
          <div>
            <span class="section-head__eyebrow">Stage Entry</span>
            <h3>阶段入口</h3>
          </div>
        </div>

        <div class="story-stage-grid story-stage-grid--entry">
          <button
            v-for="item in stageEntryCards"
            :key="item.stage"
            type="button"
            class="story-stage-entry"
            :class="[`story-stage-entry--${item.stage}`, { 'story-stage-entry--active': activeStageTab === item.stage }]"
            @click="selectStageTab(item.stage)"
          >
            <div class="story-stage-entry__main">
              <div class="story-stage-entry__top">
                <span class="story-stage-entry__eyebrow">{{ item.label }}</span>
                <strong>{{ item.status }}</strong>
              </div>
              <div class="story-stage-entry__subline">
                <span>{{ item.extra }}</span>
                <em>{{ item.updatedAt }}</em>
              </div>
            </div>
            <div class="story-stage-entry__facts story-stage-entry__facts--compact">
              <span>{{ item.meta }}</span>
            </div>
          </button>
        </div>

        <VirtualStoryStageDetailBase :stage="activeStageTab" embedded @refresh="loadOverview" />
      </section>

      <section class="story-overview-history panel-card">
          <div class="section-head">
            <div>
              <span class="section-head__eyebrow">Session History</span>
              <h3>当前故事历史</h3>
            </div>
            <div class="section-head__meta">仅当前故事 · {{ storySessions.length }} 条</div>
          </div>

        <div v-if="storySessions.length" class="story-session-list">
          <div class="story-session-table-head">
            <span>状态</span>
            <span>当前阶段</span>
            <span>触发事件</span>
            <span>更新时间</span>
            <span>操作</span>
          </div>
          <article v-for="session in storySessions" :key="session.id" class="story-session-card" :class="{ active: selectedStorySession?.id === session.id }">
            <div class="story-session-cell story-session-cell--status">
              <strong>{{ getSessionStatusLabel(session.status) }}</strong>
            </div>
            <div class="story-session-cell">
              <span>{{ getSessionStageLabel(session.currentStage) }}</span>
            </div>
            <div class="story-session-cell story-session-cell--trigger">
              <p>{{ session.storyContext?.triggerEvent || selectedStorySummary.storyTriggerEvent || '暂无触发事件' }}</p>
            </div>
            <div class="story-session-cell story-session-cell--time">
              <span>{{ formatRelativeTime(session.updatedAt) }}</span>
            </div>
            <div class="story-session-card__actions">
              <el-button size="small" @click="openSessionInspector(session.id)">进入诊断</el-button>
            </div>
          </article>
        </div>
        <div v-else class="empty-box">这个故事还没有运行记录。先从这个故事开始学习。</div>
      </section>
    </main>

    <div v-else class="empty-box empty-box--full">未找到这个故事。请回到学习者面板重新选择。</div>

    <el-dialog v-model="storyEditDialogVisible" :title="storyEditDialogTitle" width="640px" destroy-on-close>
      <el-form ref="storyFormRef" :model="storyFormData" :rules="storyFormRules" label-width="100px">
        <el-form-item label="故事标题" prop="title">
          <el-input v-model="storyFormData.title" maxlength="80" show-word-limit placeholder="如：第一次独立做复盘时卡住" />
        </el-form-item>
        <el-form-item label="故事摘要" prop="storyOutline">
          <el-input v-model="storyFormData.storyOutline" type="textarea" :rows="4" maxlength="300" show-word-limit placeholder="用 2-4 句描述这个具体场景、前因后果和卡点。" />
        </el-form-item>
        <el-form-item label="触发事件" prop="storyTriggerEvent">
          <el-input v-model="storyFormData.storyTriggerEvent" type="textarea" :rows="3" maxlength="160" show-word-limit placeholder="如：明天要向主管汇报，但她发现自己还说不清关键问题。" />
        </el-form-item>
        <el-form-item label="自然开场" prop="visibleOpening">
          <el-input v-model="storyFormData.visibleOpening" type="textarea" :rows="3" maxlength="180" show-word-limit placeholder="如果是真人第一轮开口，他最可能怎么说。" />
        </el-form-item>
        <el-form-item label="压力点" prop="pressurePointsText">
          <el-input v-model="storyFormData.pressurePointsText" type="textarea" :rows="3" maxlength="240" show-word-limit placeholder="每行一个压力点，如：害怕在主管面前讲不清楚&#10;担心临时被追问细节" />
        </el-form-item>
        <el-divider>问题基础</el-divider>
        <el-form-item label="熟悉度">
          <el-select v-model="storyFormData.problemKnowledge.domainFamiliarity" placeholder="当前问题熟悉度">
            <el-option label="低" value="low" />
            <el-option label="中" value="medium" />
            <el-option label="高" value="high" />
          </el-select>
        </el-form-item>
        <el-form-item label="已经会的">
          <el-input v-model="storyFormData.problemKnowledge.knownConceptsText" type="textarea" :rows="2" maxlength="200" show-word-limit placeholder="每行一个，写这次问题里已经会的点" />
        </el-form-item>
        <el-form-item label="容易卡的">
          <el-input v-model="storyFormData.problemKnowledge.struggleConceptsText" type="textarea" :rows="2" maxlength="200" show-word-limit placeholder="每行一个，写这次问题里容易卡的点" />
        </el-form-item>
        <el-form-item label="自我判断">
          <el-input v-model="storyFormData.problemKnowledge.selfAssessment" type="textarea" :rows="2" maxlength="180" show-word-limit placeholder="这个人会怎么描述自己在这件事上的基础" />
        </el-form-item>
        <el-form-item label="隐藏缺口">
          <el-input v-model="storyFormData.problemKnowledge.hiddenGapsText" type="textarea" :rows="2" maxlength="200" show-word-limit placeholder="每行一个，写他自己未必意识到的缺口" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="storyEditDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="storySubmitting" @click="saveStoryEdits">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, type FormInstance } from 'element-plus'
import { ArrowLeft } from '@element-plus/icons-vue'
import { adminApi } from '@/api/adminApi'
import VirtualStoryStageDetailBase from './VirtualStoryStageDetailBase.vue'

const router = useRouter()
const route = useRoute()

const profileId = route.params.profileId as string
const storyId = route.params.storyId as string

const profileData = ref<any>(null)
const sessions = ref<any[]>([])
const storySummaries = ref<any[]>([])
const loading = ref(false)
const submitting = ref(false)
const storyEditDialogVisible = ref(false)
const storySubmitting = ref(false)
const storyFormRef = ref<FormInstance>()
const editingStoryIndex = ref<number | null>(null)

const stepLoading = ref(false)
const autoLoading = ref(false)
const advanceLoading = ref(false)
const learningStartLoading = ref(false)
const learningStepLoading = ref(false)
const autoLearningLoading = ref(false)
const activeStageTab = ref<'goal' | 'path' | 'learn'>('goal')

const selectedStoryTaskId = ref<string | null>(null)
const selectedStoryPathStatus = ref('idle')
const selectedStoryPathData = ref<any | null>(null)
const goalConversationData = ref<any | null>(null)

const storyFormData = ref({
  title: '',
  storyOutline: '',
  storyTriggerEvent: '',
  visibleOpening: '',
  pressurePointsText: '',
  problemKnowledge: {
    domainFamiliarity: 'low',
    knownConceptsText: '',
    struggleConceptsText: '',
    selfAssessment: '',
    hiddenGapsText: ''
  }
})

const storyFormRules = {
  title: [{ required: true, message: '请输入故事标题', trigger: 'blur' }],
  storyOutline: [{ required: true, message: '请输入故事摘要', trigger: 'blur' }],
  storyTriggerEvent: [{ required: true, message: '请输入触发事件', trigger: 'blur' }],
  visibleOpening: [{ required: true, message: '请输入自然开场', trigger: 'blur' }],
  pressurePointsText: [{ required: true, message: '请输入至少一个压力点', trigger: 'blur' }]
}

const normalizeSession = (session: any) => {
  const runtime = session?.runtime || {}
  const bindings = runtime.bindings || session?.bindings || {}
  const goalRuntime = runtime.stageStatus?.goal || {}
  const learningRuntime = runtime.stageStatus?.learning || {}
  const learnerStateRuntime = runtime.learnerState || {}

  return {
    ...session,
    runtime,
    bindings,
    storyContext: session?.storyContext || runtime.story || null,
    goalStage: session?.goalStage || goalRuntime.stage || null,
    learnerState: session?.learnerState || learnerStateRuntime.goal || goalRuntime.learnerState || null,
    currentTaskTitle: session?.currentTaskTitle || learningRuntime.currentTaskTitle || null,
    currentMilestoneTitle: session?.currentMilestoneTitle || learningRuntime.currentMilestoneTitle || null,
    conversations: session?.conversations || { goal: { messages: [] }, learning: { messages: [] } },
    stageResults: session?.stageResults || {},
  }
}

const normalizeSessions = (items: any[]) => Array.isArray(items) ? items.map(normalizeSession) : []
const shortId = (value?: string | null) => value ? value.slice(0, 8) : '--'

const getSessionStatusLabel = (status: string) => {
  switch (status) {
    case 'created': return '已创建'
    case 'running': return '运行中'
    case 'completed': return '已完成'
    case 'failed': return '失败'
    default: return status || '未知'
  }
}

const getSessionStageLabel = (stage: string) => {
  switch (stage) {
    case 'goal': return 'Goal'
    case 'path': return 'Path'
    case 'learning': return 'Learn'
    default: return stage || '-'
  }
}

const getStorySourceLabel = (sourceType?: string) => {
  switch (sourceType) {
    case 'generated': return 'AI 生成'
    case 'manual': return '手动创建'
    case 'imported': return '外部导入'
    default: return sourceType || '未知来源'
  }
}

const formatRelativeTime = (time: string | null | undefined) => {
  if (!time) return '--'
  const now = Date.now()
  const diff = now - new Date(time).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}天前`
  const d = new Date(time)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const selectedStorySummary = computed(() => {
  return storySummaries.value.find((story: any) => String(story.storyId || story.key || '') === storyId) || null
})

const storyEditDialogTitle = computed(() => '编辑故事')

const selectedStorySession = computed(() => {
  const story = selectedStorySummary.value
  if (!story) return null
  if (story.latestRun?.sessionId) {
    const byId = sessions.value.find((item: any) => item.id === story.latestRun.sessionId)
    if (byId) return byId
  }
  if (story.storyId) {
    const relatedSessions = sessions.value.filter((item: any) => item.storyContext?.storyId === story.storyId)
    return relatedSessions.sort((a: any, b: any) => {
      const aTime = new Date(a?.updatedAt || a?.createdAt || 0).getTime()
      const bTime = new Date(b?.updatedAt || b?.createdAt || 0).getTime()
      return bTime - aTime
    })[0] || null
  }
  return null
})

const storySessions = computed(() => {
  const story = selectedStorySummary.value
  if (!story?.storyId) return []
  return sessions.value.filter((item: any) => item.storyContext?.storyId === story.storyId)
})

const selectedStoryGoalReady = computed(() => {
  const session = selectedStorySession.value
  if (!session) return false
  if (session.runtime?.stageStatus?.goal?.ready) return true
  if (session.currentStage === 'path' || session.currentStage === 'learning') return true
  return !!session.bindings?.goalConversationId
})

const selectedStoryCurrentTaskId = computed(() => selectedStorySession.value?.runtime?.stageStatus?.learning?.currentTaskId || selectedStorySession.value?.bindings?.currentTaskId || null)

const selectedStoryTaskOptions = computed(() => {
  const milestones = selectedStoryPathData.value?.milestones || []
  const currentTaskId = selectedStoryCurrentTaskId.value
  return milestones.flatMap((milestone: any, milestoneIndex: number) => {
    const stageNumber = Number(milestone.stageNumber || milestoneIndex + 1)
    return (milestone.subtasks || []).map((task: any, taskIndex: number) => {
      const status = String(task.status || '').toLowerCase()
      const canStart = task.id === currentTaskId || ['active', 'ready', 'todo', 'in_progress'].includes(status)
      return {
        id: task.id,
        label: `${stageNumber}.${taskIndex + 1} ${task.title || '未命名任务'}`,
        canStart
      }
    })
  })
})

const selectedStoryGoalStatusLabel = computed(() => {
  const session = selectedStorySession.value
  if (!session) return '未启动'
  if (selectedStoryGoalReady.value) return '已完成，可查看对话'
  return `${getSessionStatusLabel(session.status)} / 对话进行中`
})

const selectedStoryPathStatusLabel = computed(() => {
  const session = selectedStorySession.value
  if (!session) return '等待 Goal'
  if (!session.bindings?.learningPathId) {
    if (selectedStoryGoalReady.value) return selectedStoryPathStatus.value === 'generating' ? '生成中' : '待生成'
    return '等待目标对齐完成'
  }
  switch (selectedStoryPathStatus.value) {
    case 'completed': return '已完成'
    case 'active':
    case 'ready': return '已生成'
    case 'failed': return '生成失败'
    case 'not_found': return '路径丢失'
    default: return '已生成'
  }
})

const selectedStoryPathSummary = computed(() => {
  const path = selectedStoryPathData.value
  if (!path?.milestones?.length) return '生成后可选 task'
  const taskCount = path.milestones.reduce((sum: number, item: any) => sum + (item.subtasks || []).length, 0)
  return `${path.milestones.length} 个阶段 / ${taskCount} 个 task`
})

const selectedStoryPathHint = computed(() => {
  if (!selectedStorySession.value) return '这个故事还没有对应运行，先从这个故事开始学习。'
  if (!selectedStorySession.value.bindings?.learningPathId) return '开始学习后，系统会先完成目标对齐，再在这里生成 Path，并挑一个 task 进入 Learn。'
  return selectedStoryPathData.value?.summary || selectedStoryPathData.value?.description || 'Path 已生成，可以直接查看，或选一个 task 开始学习。'
})

const selectedStoryTaskLabel = computed(() => {
  const selected = selectedStoryTaskOptions.value.find((item: any) => item.id === selectedStoryTaskId.value)
  if (selected) return selected.label
  const current = selectedStoryTaskOptions.value.find((item: any) => item.id === selectedStoryCurrentTaskId.value)
  if (current) return current.label
  return '尚未选择 task'
})

const selectedStoryLearnStatusLabel = computed(() => {
  const session = selectedStorySession.value
  const teachingStage = session?.stageResults?.learning?.teachingState?.classroomContext?.stage?.current
  if (session?.status === 'completed' && session?.currentStage === 'learning') return '已结束评估'
  if (teachingStage === 'ready_to_close') return '可结束'
  if (!session?.bindings?.currentTaskId) return session?.currentStage === 'learning' ? '已进入学习' : '未开始'
  return session.currentStage === 'learning' ? '学习进行中' : '已选定 task'
})

const selectedStoryLearnHint = computed(() => {
  if (!selectedStorySession.value?.bindings?.learningPathId) return '先生成 Path，再从 task 开始 Learn。'
  if (!selectedStorySession.value?.bindings?.currentTaskId) return '可以先选一个 task，再让虚拟学习者开始学。'
  return 'Learn 阶段支持手动学或自动学，且可以直接查看该 task 的对话。'
})

const selectedStoryGoalNextStep = computed(() => {
  if (!selectedStorySession.value) return '先开始学习'
  if (selectedStoryGoalReady.value) return '查看完整对话'
  return '继续推进对话'
})

const selectedStoryPathNextStep = computed(() => {
  if (!selectedStorySession.value) return '等待 Goal'
  if (!selectedStorySession.value.bindings?.learningPathId) return '生成路径'
  return '查看阶段拆解'
})

const selectedStoryLearnNextStep = computed(() => {
  if (!selectedStorySession.value?.bindings?.learningPathId) return '等待 Path'
  if (!selectedStorySession.value?.bindings?.currentTaskId) return '选择 task'
  return '查看学习推进'
})

const selectedStoryGoalVisibleState = computed(() => {
  if (!selectedStorySession.value) return '尚未开始'
  if (selectedStoryGoalReady.value) return '方向已收敛'
  return goalConversationPreview.value.length ? '正在澄清问题' : '等待开场'
})

const selectedStoryPathVisibleState = computed(() => {
  if (!selectedStorySession.value) return '等待开始'
  if (!selectedStorySession.value.bindings?.learningPathId) {
    return selectedStoryGoalReady.value ? '等待生成学习路线' : '等待问题澄清'
  }
  return selectedStoryPathData.value?.milestones?.length ? '学习路线已生成' : '已生成路线骨架'
})

const selectedStoryLearnVisibleState = computed(() => {
  if (!selectedStorySession.value?.bindings?.learningPathId) return '等待学习路线'
  if (!selectedStorySession.value?.bindings?.currentTaskId) return '等待选择任务'
  if (selectedStorySession.value.status === 'completed' && selectedStorySession.value.currentStage === 'learning') return '本轮学习已结束'
  if (selectedStorySession.value.currentStage === 'learning') return '正在学习中'
  return '任务已准备好'
})

const canRunGoalForSelectedStory = computed(() => !!selectedStorySession.value && selectedStorySession.value.currentStage === 'goal' && !selectedStoryGoalReady.value)
const canAdvancePathForSelectedStory = computed(() => !!selectedStorySession.value && selectedStoryGoalReady.value && !selectedStorySession.value.bindings?.learningPathId)
const canStartLearningForSelectedStory = computed(() => {
  const session = selectedStorySession.value
  if (!session?.bindings?.learningPathId) return false
  if (session.currentStage === 'learning' && session.bindings?.currentTaskId) return false
  return !!selectedStoryTaskId.value || selectedStoryTaskOptions.value.length > 0
})
const canRunLearningForSelectedStory = computed(() => !!selectedStorySession.value && selectedStorySession.value.currentStage === 'learning')

const storyTaskCount = computed(() => selectedStoryTaskOptions.value.length)

const stageOverviewCards = computed(() => [
  {
    label: 'Goal',
    value: selectedStoryGoalStatusLabel.value,
    meta: goalConversationPreview.value.length ? `${goalConversationPreview.value.length} 条对话` : '尚未生成对话'
  },
  {
    label: 'Path',
    value: selectedStoryPathStatusLabel.value,
    meta: selectedStoryPathData.value?.milestones?.length ? `${selectedStoryPathData.value.milestones.length} 个阶段` : '暂无路径'
  },
  {
    label: 'Learn',
    value: selectedStoryLearnStatusLabel.value,
    meta: selectedStoryTaskLabel.value
  }
])

const stageEntryCards = computed(() => [
  {
    stage: 'goal',
    label: 'Goal',
    status: selectedStoryGoalStatusLabel.value,
    meta: goalConversationPreview.value.length ? `${goalConversationPreview.value.length} 条对话` : '尚未生成对话',
    extra: selectedStoryGoalVisibleState.value,
    updatedAt: selectedStorySession.value?.updatedAt ? formatRelativeTime(selectedStorySession.value.updatedAt) : '未启动'
  },
  {
    stage: 'path',
    label: 'Path',
    status: selectedStoryPathStatusLabel.value,
    meta: selectedStoryPathSummary.value,
    extra: selectedStoryPathVisibleState.value,
    updatedAt: selectedStorySession.value?.updatedAt ? formatRelativeTime(selectedStorySession.value.updatedAt) : '未启动'
  },
  {
    stage: 'learn',
    label: 'Learn',
    status: selectedStoryLearnStatusLabel.value,
    meta: selectedStoryTaskLabel.value,
    extra: selectedStoryLearnVisibleState.value,
    updatedAt: selectedStorySession.value?.updatedAt ? formatRelativeTime(selectedStorySession.value.updatedAt) : '未启动'
  }
])

const resolveStageTab = (value: unknown): 'goal' | 'path' | 'learn' | null => {
  if (value === 'goal' || value === 'path' || value === 'learn') return value
  return null
}

const selectStageTab = (stage: 'goal' | 'path' | 'learn') => {
  if (activeStageTab.value === stage && route.query.tab === stage) return
  activeStageTab.value = stage
  router.replace({
    path: `/admin/virtual-learners/${profileId}/stories/${storyId}`,
    query: { ...route.query, tab: stage }
  })
}

const storyPressurePoints = computed(() => {
  const points = selectedStorySummary.value?.pressurePoints
  return Array.isArray(points) ? points.filter((item: any) => typeof item === 'string' && item.trim()) : []
})

const storyOverviewSubtitle = computed(() => {
  const name = profileData.value?.userName || '--'
  const occupation = profileData.value?.profile?.occupation
  return occupation && occupation !== name ? `${name} · ${occupation}` : name
})

const selectedStoryStatusTag = computed(() => {
  if (!selectedStorySummary.value?.latestRun) return '尚未运行'
  return `${getSessionStageLabel(selectedStorySummary.value.latestRun.currentStage)} / ${getSessionStatusLabel(selectedStorySummary.value.latestRun.status)}`
})

const storyContextTrigger = computed(() => ({
  title: selectedStorySummary.value?.storyTriggerEvent || '暂无触发事件',
  description: selectedStorySummary.value?.storyOutline || '暂无补充说明'
}))

const storyContextBlocker = computed(() => ({
  title: storyPressurePoints.value[0] || '尚未提炼核心卡点',
  description: selectedStorySummary.value?.visibleOpening || '暂无自然开场'
}))

const storyContextEntry = computed(() => {
  if (!selectedStorySession.value?.bindings?.learningPathId) {
    return {
      title: '先完成目标对齐',
      description: '完成问题澄清后再进入 Path。'
    }
  }

  return {
    title: selectedStoryTaskLabel.value,
    description: selectedStoryCurrentTaskId.value
      ? '当前 task 已就绪，可直接进入 Learn。'
      : '先选一个 task 开始学习。'
  }
})

const storyProblemKnowledge = computed(() => selectedStorySummary.value?.problemKnowledge || selectedStorySession.value?.storyContext?.problemKnowledge || null)

const storyContextKnowledge = computed(() => {
  const knowledge = storyProblemKnowledge.value
  if (!knowledge) {
    return {
      title: '当前未单独标注',
      description: '这条故事还没有补充问题基础，当前会结合长期概念基础和对话内容继续判断。'
    }
  }

  const familiarityMap: Record<string, string> = {
    low: '对这类问题不熟',
    medium: '有一些基础',
    high: '对这类问题较熟'
  }

  return {
    title: familiarityMap[knowledge.domainFamiliarity] || '已补充问题基础',
    description: knowledge.selfAssessment || knowledge.hiddenGaps?.[0] || '已补充这次问题的基础与缺口。'
  }
})

const goalConversationPreview = computed(() => {
  const messages = goalConversationData.value?.messages || selectedStorySession.value?.conversations?.goal?.messages
  return Array.isArray(messages) ? messages.slice(-4) : []
})

const learnConversationPreview = computed(() => {
  const messages = selectedStorySession.value?.conversations?.learning?.messages || []
  return messages.slice(-4).map((message: any) => ({
    roleLabel: message.role === 'assistant' ? '系统' : '学习者',
    text: getDialoguePreviewText(message)
  }))
})

const loadSelectedStoryPathStatus = async () => {
  const sessionId = selectedStorySession.value?.id
  if (!sessionId) {
    selectedStoryPathStatus.value = 'idle'
    selectedStoryPathData.value = null
    return
  }
  try {
    const res = await adminApi.getVirtualSessionPathStatus(sessionId)
    if (!res.data?.success) {
      selectedStoryPathStatus.value = 'failed'
      selectedStoryPathData.value = null
      return
    }
    selectedStoryPathStatus.value = res.data.data?.status || 'idle'
    selectedStoryPathData.value = res.data.data?.path || null
  } catch {
    selectedStoryPathStatus.value = 'failed'
    selectedStoryPathData.value = null
  }
}

const loadGoalConversation = async () => {
  const sessionId = selectedStorySession.value?.id
  const goalId = selectedStorySession.value?.bindings?.goalConversationId
  if (!sessionId || !goalId) {
    goalConversationData.value = null
    return
  }
  try {
    const res = await adminApi.getVirtualSessionGoalConversation(sessionId)
    goalConversationData.value = res.data?.success ? res.data.data : null
  } catch {
    goalConversationData.value = null
  }
}

const loadOverview = async () => {
  loading.value = true
  try {
    const [profileRes, storiesRes] = await Promise.all([
      adminApi.getVirtualLearner(profileId),
      adminApi.getVirtualLearnerStories(profileId)
    ])
    if (!profileRes.data?.success) throw new Error(profileRes.data?.error || '加载失败')
    profileData.value = profileRes.data.data
    sessions.value = normalizeSessions(profileRes.data.data.sessions || [])
    storySummaries.value = storiesRes.data?.success && Array.isArray(storiesRes.data.data?.stories)
      ? storiesRes.data.data.stories
      : []
  } catch (error: any) {
    ElMessage.error(error.message || '加载失败')
  } finally {
    loading.value = false
  }
}

const openStoryEditDialog = (story?: any | null, index?: number | null) => {
  if (!story || typeof index !== 'number') return
  editingStoryIndex.value = index
  storyFormData.value = {
    title: story?.storyTitle || story?.title || '',
    storyOutline: story?.storyOutline || '',
    storyTriggerEvent: story?.storyTriggerEvent || story?.triggerEvent || '',
    visibleOpening: story?.visibleOpening || '',
    pressurePointsText: Array.isArray(story?.pressurePoints) ? story.pressurePoints.join('\n') : '',
    problemKnowledge: {
      domainFamiliarity: story?.problemKnowledge?.domainFamiliarity || 'low',
      knownConceptsText: Array.isArray(story?.problemKnowledge?.knownConcepts) ? story.problemKnowledge.knownConcepts.join('\n') : '',
      struggleConceptsText: Array.isArray(story?.problemKnowledge?.struggleConcepts) ? story.problemKnowledge.struggleConcepts.join('\n') : '',
      selfAssessment: story?.problemKnowledge?.selfAssessment || '',
      hiddenGapsText: Array.isArray(story?.problemKnowledge?.hiddenGaps) ? story.problemKnowledge.hiddenGaps.join('\n') : ''
    }
  }
  storyEditDialogVisible.value = true
}

const parsePressurePoints = (value: string) => {
  return value
    .split(/\r?\n|[;,，；]/)
    .map((item) => item.trim())
    .filter((item, index, list) => !!item && list.indexOf(item) === index)
}

const saveStoryEdits = async () => {
  if (editingStoryIndex.value === null) return
  const valid = await storyFormRef.value?.validate().catch(() => false)
  if (!valid) return

  storySubmitting.value = true
  try {
    const res = await adminApi.updateStoryStatus(profileId, editingStoryIndex.value, {
      title: storyFormData.value.title,
      storyOutline: storyFormData.value.storyOutline,
      storyTriggerEvent: storyFormData.value.storyTriggerEvent,
      visibleOpening: storyFormData.value.visibleOpening,
      pressurePoints: parsePressurePoints(storyFormData.value.pressurePointsText),
      problemKnowledge: {
        domainFamiliarity: storyFormData.value.problemKnowledge.domainFamiliarity,
        knownConcepts: parsePressurePoints(storyFormData.value.problemKnowledge.knownConceptsText),
        struggleConcepts: parsePressurePoints(storyFormData.value.problemKnowledge.struggleConceptsText),
        selfAssessment: storyFormData.value.problemKnowledge.selfAssessment.trim(),
        hiddenGaps: parsePressurePoints(storyFormData.value.problemKnowledge.hiddenGapsText)
      }
    })
    if (!res.data?.success) throw new Error(res.data?.error || '保存失败')
    ElMessage.success('故事已更新')
    storyEditDialogVisible.value = false
    await loadOverview()
  } catch (error: any) {
    ElMessage.error(error.message || '保存失败')
  } finally {
    storySubmitting.value = false
  }
}

const handleStartSession = async (story?: any, storyIndex?: number) => {
  try {
    const payload = story ? { storyId: story.id, storyIndex } : undefined
    const res = await adminApi.startVirtualSession(profileId, payload)
    if (!res.data?.success) throw new Error(res.data?.error || '创建会话失败')
    ElMessage.success('会话已创建')
    await loadOverview()
  } catch (error: any) {
    ElMessage.error(error.message || '创建会话失败')
  }
}

const openStagePage = (stage: 'goal' | 'path' | 'learn') => {
  router.push(`/admin/virtual-learners/${profileId}/stories/${storyId}/${stage}`)
}

const openSessionInspector = (sessionId: string) => {
  router.push(`/admin/virtual-session/${sessionId}`)
}

const openDebugGoalFor = (session?: any | null) => {
  if (!session?.bindings?.goalConversationId) return
  router.push(`/admin/test/goal-full/${session.bindings.goalConversationId}?virtualSessionId=${session.id}&viewMode=debug`)
}

const openDebugPathFor = (session?: any | null) => {
  if (!session?.bindings?.learningPathId) return
  router.push(`/admin/test/learning-path/${session.bindings.learningPathId}?virtualSessionId=${session.id}&viewMode=debug`)
}

const openDebugLearnFor = (session?: any | null) => {
  if (!session?.bindings?.currentTaskId) return
  router.push(`/admin/test/learn/${session.bindings.currentTaskId}?virtualSessionId=${session.id}&viewMode=debug`)
}

const openFormalGoalFor = (session?: any | null) => {
  if (!session?.bindings?.goalConversationId) return
  window.open(`/goal-conversation/${session.bindings.goalConversationId}?virtualSessionId=${session.id}&viewMode=formal`, '_blank')
}

const openFormalPathFor = (session?: any | null) => {
  if (!session?.bindings?.learningPathId) return
  window.open(`/learning-path/${session.bindings.learningPathId}?virtualSessionId=${session.id}&viewMode=formal`, '_blank')
}

const withSession = async (sessionArg: any | null | undefined, runner: (sessionId: string) => Promise<void>) => {
  if (!sessionArg?.id) {
    ElMessage.warning('请先选择一个 session')
    return
  }
  await runner(sessionArg.id)
  await loadOverview()
}

const runGoalStepFor = async (session?: any | null) => {
  stepLoading.value = true
  try {
    await withSession(session, async (sessionId) => {
      const res = await adminApi.virtualSessionStep(sessionId)
      if (!res.data?.success) throw new Error(res.data?.error || 'Goal 单步失败')
    })
  } catch (error: any) {
    ElMessage.error(error.message || 'Goal 单步失败')
  } finally {
    stepLoading.value = false
  }
}

const runGoalAutoFor = async (session?: any | null) => {
  autoLoading.value = true
  try {
    await withSession(session, async (sessionId) => {
      const res = await adminApi.virtualSessionAuto(sessionId, { maxRounds: 20 })
      if (!res.data?.success) throw new Error(res.data?.error || 'Goal 自动失败')
    })
  } catch (error: any) {
    ElMessage.error(error.message || 'Goal 自动失败')
  } finally {
    autoLoading.value = false
  }
}

const confirmGeneratePathFor = async (session?: any | null) => {
  advanceLoading.value = true
  try {
    await withSession(session, async (sessionId) => {
      const res = await adminApi.virtualSessionAdvancePath(sessionId)
      if (!res.data?.success) throw new Error(res.data?.error || '生成 Path 失败')
    })
  } catch (error: any) {
    ElMessage.error(error.message || '生成 Path 失败')
  } finally {
    advanceLoading.value = false
  }
}

const startLearningFor = async (session?: any | null, taskId?: string) => {
  learningStartLoading.value = true
  try {
    await withSession(session, async (sessionId) => {
      const effectiveTaskId = taskId || selectedStoryTaskId.value || selectedStoryTaskOptions.value.find((item: any) => item.canStart)?.id
      const res = await adminApi.startVirtualLearning(sessionId, effectiveTaskId ? { taskId: effectiveTaskId } : undefined)
      if (!res.data?.success) throw new Error(res.data?.error || '启动 Learn 失败')
    })
  } catch (error: any) {
    ElMessage.error(error.message || '启动 Learn 失败')
  } finally {
    learningStartLoading.value = false
  }
}

const runLearningStepFor = async (session?: any | null) => {
  learningStepLoading.value = true
  try {
    await withSession(session, async (sessionId) => {
      const res = await adminApi.virtualSessionLearningStep(sessionId)
      if (!res.data?.success) throw new Error(res.data?.error || 'Learn 单步失败')
    })
  } catch (error: any) {
    ElMessage.error(error.message || 'Learn 单步失败')
  } finally {
    learningStepLoading.value = false
  }
}

const runLearningAutoFor = async (session?: any | null) => {
  autoLearningLoading.value = true
  try {
    await withSession(session, async (sessionId) => {
      const res = await adminApi.virtualSessionAutoLearning(sessionId, { maxMilestones: 10 })
      if (!res.data?.success) throw new Error(res.data?.error || 'Learn 自动失败')
    })
  } catch (error: any) {
    ElMessage.error(error.message || 'Learn 自动失败')
  } finally {
    autoLearningLoading.value = false
  }
}

onMounted(() => {
  loadOverview()
})

watch(
  () => route.query.tab,
  (tab) => {
    const resolved = resolveStageTab(tab)
    if (resolved && activeStageTab.value !== resolved) {
      activeStageTab.value = resolved
    }
  },
  { immediate: true }
)

watch(
  () => selectedStorySession.value?.id,
  () => {
    loadSelectedStoryPathStatus()
    loadGoalConversation()
  },
  { immediate: true }
)

watch(
  [selectedStoryTaskOptions, selectedStoryCurrentTaskId],
  () => {
    const currentTaskId = selectedStoryCurrentTaskId.value
    if (currentTaskId && selectedStoryTaskOptions.value.some((item: any) => item.id === currentTaskId)) {
      selectedStoryTaskId.value = currentTaskId
      return
    }
    const firstRunnable = selectedStoryTaskOptions.value.find((item: any) => item.canStart)
    selectedStoryTaskId.value = firstRunnable?.id || selectedStoryTaskOptions.value[0]?.id || null
  },
  { immediate: true }
)

watch(
  () => selectedStorySession.value?.currentStage,
  (stage) => {
    if (resolveStageTab(route.query.tab)) return
    if (stage === 'goal' || stage === 'path' || stage === 'learning') {
      activeStageTab.value = stage === 'learning' ? 'learn' : stage
    }
  },
  { immediate: true }
)

const getDialogueRoleLabel = (role?: string) => {
  switch (role) {
    case 'assistant': return '系统'
    case 'user': return '学习者'
    case 'system': return '系统'
    default: return role || '消息'
  }
}

const getDialoguePreviewText = (message: any) => {
  if (!message) return '--'
  if (typeof message === 'string') return message
  return message.content || message.text || message.message || message.reply || message.opening || message.currentTask || JSON.stringify(message)
}
</script>

<style scoped>
.story-overview-page {
  min-height: 100vh;
  padding: 16px;
  background: #f3f5f8;
  color: #1f2937;
}

.story-overview-topbar,
.story-overview-layout {
  max-width: 1360px;
  margin: 0 auto;
}

.story-overview-topbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
  padding: 16px 18px;
  border-radius: 14px;
  border: 1px solid #dfe5ee;
  background: #ffffff;
  box-shadow: 0 8px 18px rgba(15, 23, 42, 0.04);
}

.story-overview-topbar__left,
.story-overview-topbar__actions,
.story-stage-card__actions,
.story-session-card__actions {
  display: flex;
  gap: 8px;
}

.story-overview-topbar__left {
  align-items: flex-start;
}

.story-overview-topbar__actions,
.story-stage-card__actions,
.story-session-card__actions {
  flex-wrap: wrap;
}

.story-overview-topbar__actions {
  align-items: center;
  justify-content: flex-end;
}

.story-overview-topbar__title {
  display: grid;
  gap: 4px;
}

.story-overview-topbar__crumbs {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.story-overview-topbar__back {
  padding-inline: 0;
}

.story-overview-topbar__title h1 {
  font-size: 24px;
  line-height: 1.12;
}

.story-overview-topbar__title h1,
.story-overview-hero__copy h2,
.section-head h3 {
  margin: 0;
}

.story-overview-topbar__title p,
.story-overview-hero__copy p,
.story-stage-card p,
.story-session-card p {
  margin: 0;
  color: #5f6b7d;
  line-height: 1.65;
}

.story-overview-topbar__eyebrow,
.story-overview-hero__eyebrow,
.section-head__eyebrow,
.story-stage-card__eyebrow {
  display: inline-flex;
  width: fit-content;
  padding: 3px 8px;
  border-radius: 999px;
  background: #f1f5f9;
  color: #475569;
  font-size: 11px;
  font-weight: 700;
}

.story-overview-layout {
  display: grid;
  gap: 16px;
}

.panel-card {
  padding: 16px;
  border-radius: 14px;
  border: 1px solid #e3e8ef;
  background: #ffffff;
  box-shadow: none;
}

.story-overview-hero {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(340px, 0.95fr);
  gap: 14px;
  align-items: stretch;
}

.story-metric-grid,
.story-data-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.story-dialogue-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 0;
}

.story-metric-card,
.story-data-card,
.story-dialogue-card {
  padding: 14px;
  border-radius: 16px;
  border: 1px solid #e7ecf3;
  background: #fbfcfe;
}

.story-metric-card span,
.story-data-card > span {
  display: block;
  margin-bottom: 8px;
  font-size: 12px;
  color: #7b8597;
}

.story-metric-card strong,
.story-data-card strong,
.story-dialogue-card__head strong {
  display: block;
  color: #1f2937;
  font-size: 15px;
}

.story-metric-card em,
.story-dialogue-card__head span {
  display: block;
  margin-top: 8px;
  font-style: normal;
  font-size: 12px;
  color: #64748b;
}

.story-kv-list,
.story-dialogue-list {
  display: grid;
  gap: 8px;
  margin-top: 10px;
}

.story-kv-row,
.story-dialogue-card__head,
.story-dialogue-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.story-kv-row span,
.story-dialogue-row span {
  font-size: 12px;
  color: #7b8597;
  flex-shrink: 0;
}

.story-kv-row em {
  font-style: normal;
  color: #334155;
  text-align: right;
  word-break: break-word;
}

.story-dialogue-row {
  align-items: flex-start;
  padding: 10px 0;
  border-top: 1px solid #eef2f7;
}

.story-dialogue-row:first-child {
  border-top: 0;
  padding-top: 0;
}

.story-dialogue-row p {
  margin: 0;
  color: #334155;
  line-height: 1.6;
}

.story-overview-hero__copy {
  display: grid;
  gap: 10px;
 }

.story-overview-hero__head {
  display: grid;
  gap: 4px;
}

.story-overview-hero__label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #6b7280;
}

.story-overview-hero__context-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  padding-top: 6px;
}

.story-overview-hero__copy p {
  color: #5f6b7d;
  font-size: 13px;
  line-height: 1.65;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.story-overview-hero__copy h2 {
  font-size: clamp(18px, 2vw, 22px);
  line-height: 1.25;
  letter-spacing: -0.01em;
}

.story-overview-hero__side {
  display: grid;
  gap: 10px;
  align-content: start;
}

.story-overview-hero__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding-top: 0;
}

.story-overview-hero__actions :deep(.el-button) {
  min-width: 0;
}

.story-overview-hero__actions :deep(.el-button--success.is-plain) {
  background: rgba(34, 197, 94, 0.08);
  border-color: rgba(34, 197, 94, 0.24);
}

.story-overview-hero__summary {
  display: grid;
  gap: 8px;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid #e6ebf2;
  background: #f8fafc;
}

.story-overview-summary-row {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
}

.story-overview-summary-row > span {
  font-size: 12px;
  line-height: 1.5;
  color: #64748b;
}

.story-overview-summary-row > div {
  display: grid;
  gap: 2px;
}

.story-overview-summary-row strong {
  font-size: 15px;
  line-height: 1.35;
  color: #1f2937;
}

.story-overview-summary-row em {
  font-style: normal;
  font-size: 12px;
  line-height: 1.5;
  color: #7b8597;
}

.section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.section-head--compact {
  margin-bottom: 12px;
}

.section-head__meta,
.story-stage-card__meta,
.story-session-card__actions span {
  font-size: 12px;
  color: #7b8597;
}

.section-head h3 {
  font-size: 18px;
  line-height: 1.3;
}

.story-stage-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}

.story-stage-grid--entry {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.story-stage-entry {
  display: grid;
  gap: 6px;
  width: 100%;
  min-height: 0;
  padding: 10px 12px;
  text-align: left;
  border-radius: 10px;
  border: 1px solid #e4e9f1;
  background: #ffffff;
  cursor: pointer;
  transition: border-color 0.18s ease, background-color 0.18s ease;
}

.story-stage-entry:hover {
  border-color: #cfd8e3;
  background: #fafcff;
}

.story-stage-entry--active {
  border-color: #b8c6db;
  background: #f8fafc;
}

.story-stage-entry--goal {
  border-left: 3px solid #94a3b8;
}

.story-stage-entry--path {
  border-left: 3px solid #a3a3a3;
}

.story-stage-entry--learn {
  border-left: 3px solid #c4b38a;
}

.story-stage-entry__main {
  display: grid;
  gap: 4px;
}

.story-stage-entry__top,
.story-stage-entry__facts,
.story-stage-entry__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.story-stage-entry__eyebrow {
  display: inline-flex;
  width: fit-content;
  padding: 0;
  border-radius: 0;
  background: transparent;
  color: #64748b;
  font-size: 11px;
  font-weight: 700;
}

.story-stage-entry em,
.story-stage-entry__facts span,
.story-stage-entry__footer span {
  font-style: normal;
  font-size: 12px;
  color: #7b8597;
}

.story-stage-entry strong {
  color: #1f2937;
  font-size: 13px;
  line-height: 1.35;
}

.story-stage-entry__subline {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
}

.story-stage-entry__subline span {
  font-size: 12px;
  color: #6f7b8f;
  max-width: 48%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.story-stage-entry p {
  margin: 0;
  color: #475569;
  font-size: 12px;
  line-height: 1.55;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.story-stage-entry__link {
  color: #214fcf !important;
  font-weight: 700;
}

.story-stage-inline-panel {
  display: grid;
  gap: 12px;
  margin-top: 14px;
  padding: 16px;
  border-radius: 18px;
  border: 1px solid #e7ecf3;
  background: linear-gradient(180deg, #fbfdff, #ffffff);
}

.story-stage-inline-panel__head,
.story-stage-inline-panel__actions,
.story-inline-kv-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}

.story-stage-inline-panel__head h4 {
  margin: 6px 0 0;
  font-size: 22px;
  line-height: 1.2;
  color: #1f2937;
}

.story-stage-inline-panel__actions {
  flex-wrap: wrap;
  justify-content: flex-end;
}

.story-inline-kv-row {
  padding-top: 2px;
  border-top: 1px solid #edf2f8;
}

.story-inline-kv-row span {
  font-size: 12px;
  color: #7b8597;
}

.story-inline-kv-row strong {
  color: #1f2937;
}

.story-inline-preview-list {
  display: grid;
  gap: 10px;
}

.story-inline-preview-item {
  display: grid;
  gap: 6px;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid #e8edf5;
  background: #f8fbff;
}

.story-inline-preview-item span {
  font-size: 12px;
  color: #6b7a90;
  font-weight: 700;
}

.story-inline-preview-item p {
  margin: 0;
  color: #334155;
  line-height: 1.65;
}

.story-inline-chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.story-inline-chip {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: 0 10px;
  border-radius: 999px;
  background: #eef4ff;
  color: #2956d7;
  font-size: 12px;
  font-weight: 600;
}

.story-stage-entry__facts {
  padding-top: 6px;
  border-top: 1px dashed #e8edf3;
}

.story-stage-entry__facts--compact span {
  max-width: 100%;
}

.story-stage-entry__facts span {
  max-width: 48%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.story-stage-card {
  display: grid;
  gap: 12px;
  padding: 16px;
  border-radius: 18px;
  border: 1px solid #e7ecf3;
  background: #fbfcfe;
}

.story-stage-card--goal {
  border-color: #cfe0ff;
  background: linear-gradient(180deg, #f8fbff, #ffffff);
}

.story-stage-card--path {
  border-color: #d7ebdd;
  background: linear-gradient(180deg, #f8fff9, #ffffff);
}

.story-stage-card--learn {
  border-color: #f6dfb1;
  background: linear-gradient(180deg, #fffdf6, #ffffff);
}

.story-context-stack {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.story-context-card {
  display: grid;
  align-content: start;
  gap: 6px;
  min-height: 0;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid #e6ebf1;
  background: #fafbfd;
}

.story-context-card span {
  font-size: 12px;
  color: #66758a;
}

.story-context-card strong {
  font-size: 14px;
  line-height: 1.5;
  color: #14213d;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.story-context-card p {
  margin: 0;
  color: #475569;
  font-size: 12px;
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.story-context-card--trigger,
.story-context-card--opening {
  min-height: 0;
}

.story-context-card--entry-side {
  min-height: 0;
  background: #fafbfd;
}

.story-pressure-list {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.story-pressure-chip {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 8px;
  border-radius: 999px;
  background: #eef4ff;
  color: #2956d7;
  font-size: 11px;
  font-weight: 600;
}

.story-stage-card__head,
.story-session-card {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.story-task-picker {
  display: grid;
  gap: 8px;
}

.story-task-picker span {
  font-size: 12px;
  color: #7b8597;
}

.story-session-list {
  display: grid;
  gap: 0;
  border: 1px solid #e5eaf1;
  border-radius: 12px;
  overflow: hidden;
}

.story-session-table-head,
.story-session-card {
  display: grid;
  grid-template-columns: 140px 110px minmax(0, 1fr) 96px 96px;
  gap: 12px;
  align-items: center;
}

.story-session-table-head {
  padding: 10px 14px;
  background: #f8fafc;
  border-bottom: 1px solid #e5eaf1;
}

.story-session-table-head span {
  font-size: 12px;
  color: #64748b;
}

.story-session-card {
  padding: 12px 14px;
  border-radius: 0;
  border: 0;
  border-bottom: 1px solid #eef2f6;
  background: #ffffff;
}

.story-session-card:last-child {
  border-bottom: 0;
}

.story-session-cell {
  min-width: 0;
}

.story-session-cell span,
.story-session-card__actions span {
  font-size: 12px;
  color: #475569;
}

.story-session-cell strong {
  font-size: 13px;
  color: #111827;
}

.story-session-card p {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.story-session-card.active {
  background: #f8fbff;
}

.story-session-card__actions {
  justify-content: flex-end;
}

.empty-box {
  text-align: center;
  padding: 28px 20px;
  background: #fbfcfe;
  border-radius: 16px;
  border: 1px dashed #dce4ee;
  color: #8b94a6;
}

.empty-box--full {
  max-width: 1360px;
  margin: 0 auto;
}

.empty-box--inline {
  padding: 16px;
}

@media (max-width: 1200px) {
  .story-metric-grid,
  .story-data-grid,
  .story-dialogue-grid {
    grid-template-columns: 1fr;
  }

  .story-overview-hero,
  .story-overview-hero__context-grid,
  .story-stage-grid--entry {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .story-session-table-head,
  .story-session-card {
    grid-template-columns: 120px 96px minmax(0, 1fr) 84px 88px;
  }

  .story-overview-summary-row {
    grid-template-columns: 64px minmax(0, 1fr);
  }
}

@media (max-width: 1024px) {
  .story-stage-grid--entry,
  .story-overview-hero__context-grid {
    grid-template-columns: 1fr;
  }

  .story-stage-entry {
    min-height: auto;
  }

  .story-overview-hero {
    grid-template-columns: 1fr;
  }

  .story-session-table-head {
    display: none;
  }

  .story-session-card {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .story-session-card__actions {
    justify-content: flex-start;
  }
}

@media (max-width: 900px) {
  .story-overview-topbar,
  .story-overview-topbar__crumbs,
  .story-overview-hero__actions,
  .story-stage-entry__top,
  .story-stage-entry__subline,
  .story-stage-entry__facts,
  .story-stage-entry__footer,
  .story-stage-inline-panel__head,
  .story-stage-inline-panel__actions,
  .story-inline-kv-row,
  .story-stage-card__head,
  .story-session-card,
  .section-head {
    flex-direction: column;
  }

  .story-overview-topbar__actions,
  .story-session-card__actions {
    width: 100%;
  }

  .story-overview-topbar__actions {
    justify-content: flex-start;
  }

  .story-overview-hero__actions :deep(.el-button),
  .story-overview-hero__actions :deep(.el-button--primary) {
    min-width: 0;
  }

  .story-overview-page {
    padding: 12px;
  }

  .panel-card,
  .story-overview-topbar {
    padding: 14px;
    border-radius: 12px;
  }

  .story-overview-topbar__title h1,
  .story-overview-hero__copy h2 {
    font-size: 22px;
  }

  .story-overview-summary-row {
    grid-template-columns: 1fr;
    gap: 4px;
  }
}
</style>
