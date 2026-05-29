<template>
  <div class="profile-page">
    <header class="topbar">
      <div class="topbar-left">
        <el-button text @click="router.push('/admin/virtual-learners')">
          <el-icon><ArrowLeft /></el-icon>
          返回总控台
        </el-button>
        <div class="title-wrap">
          <h1>{{ profileData?.userName || '加载中' }}</h1>
          <div class="title-meta">
            <el-tag v-if="storyPool.length" size="small" type="warning" effect="plain">
              {{ storyPool.length }} 个故事
            </el-tag>
          </div>
        </div>
      </div>
      <div class="topbar-right">
        <el-button @click="openEditDialog">编辑画像</el-button>
        <el-button :loading="draftStoriesLoading" @click="generateStoryDraft">生成故事草稿</el-button>
        <el-button type="primary" @click="handleStartSession()">
          <el-icon><VideoPlay /></el-icon>
          新建会话
        </el-button>
      </div>
    </header>

    <main class="layout">
      <section class="main">
        <section class="panel persona-hero">
          <div class="persona-hero__main">
            <div class="profile-header profile-header--hero">
              <div class="profile-avatar profile-avatar--hero">{{ profileData?.userName?.charAt(0) || '?' }}</div>
              <div class="profile-identity">
                <strong>{{ profileData?.userName || '--' }}</strong>
                <span>{{ profileData?.profile?.occupation || '虚拟学习者' }}</span>
              </div>
            </div>
            <div class="persona-hero__intro">
              <span class="persona-hero__eyebrow">稳定人物画像</span>
              <h2>{{ personaHeadline }}</h2>
              <p>{{ personaNarrative }}</p>
            </div>
          </div>
          <div class="persona-hero__facts">
            <article v-for="item in personaFactCards" :key="item.label" class="persona-fact-card">
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
            </article>
          </div>
        </section>

        <section class="panel trait-panel">
          <div class="panel-head">
            <div>
              <div class="panel-title">这个人通常怎么反应</div>
              <div class="panel-meta panel-meta--block">这里不是平台参数，而是这个人物长期稳定的表达习惯、求助方式和受压反应。</div>
            </div>
          </div>
          <div class="trait-grid">
            <article v-for="item in traitSummaryCards" :key="item.label" class="trait-card">
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
              <p>{{ item.helper }}</p>
            </article>
          </div>
        </section>

        <section class="panel story-pool-panel">
          <div class="panel-head">
            <div>
              <div class="panel-title">故事池</div>
              <div class="panel-meta panel-meta--block">同一个人物在不同情境下会怎么开口、卡在哪里、优先暴露什么问题，都在这里。</div>
            </div>
            <div class="draft-actions">
              <el-button :loading="draftStoriesLoading" @click="generateStoryDraft">生成故事草稿</el-button>
              <el-button v-if="draftStories" type="primary" @click="applyStoryDraft">应用故事草稿</el-button>
            </div>
          </div>

          <div v-if="draftStories" class="draft-story-banner">
            <strong>已生成故事草稿</strong>
            <span>{{ draftStories.stories?.length || 0 }} 个候选故事，确认后会写入当前人物的故事池。</span>
          </div>

          <div v-if="draftStories?.stories?.length" class="story-grid story-grid--draft">
            <article v-for="(story, index) in draftStories.stories" :key="story.id || index" class="story-feature-card story-feature-card--draft">
              <div class="story-feature-card__head">
                <span class="story-feature-card__index">草稿故事 {{ index + 1 }}</span>
                <span class="story-feature-card__source">{{ getStorySourceLabel(story.sourceType) }}</span>
              </div>
              <strong>{{ story.title || `故事 ${index + 1}` }}</strong>
              <p>{{ story.storyOutline || '暂无故事摘要' }}</p>
            </article>
          </div>

          <div v-if="storyPool.length" class="story-grid">
            <article v-for="(story, index) in storyPool" :key="story.id || index" class="story-feature-card" :class="{ active: selectedStoryKey === getStoryKey(story, index) }">
              <button type="button" class="story-feature-card__main" @click="selectStory(story, index)">
                <div class="story-feature-card__head">
                  <span class="story-feature-card__index">故事 {{ index + 1 }}</span>
                  <span class="story-feature-card__source">{{ getStorySourceLabel(story.sourceType) }}</span>
                </div>
                <strong>{{ story.title || `故事 ${index + 1}` }}</strong>
                <p>{{ story.storyOutline || story.outline || story.goalSeed || '暂无故事摘要' }}</p>
                <div class="story-feature-card__lines">
                  <span v-if="story.triggerEvent">触发：{{ story.triggerEvent }}</span>
                  <span v-if="story.visibleOpening">开场：{{ story.visibleOpening }}</span>
                  <span v-if="story.pressurePoints?.length">压力点：{{ story.pressurePoints.slice(0, 2).join('；') }}</span>
                  <span v-if="story.behaviorHooks?.length">行为钩子：{{ story.behaviorHooks.slice(0, 2).join('；') }}</span>
                </div>
              </button>
              <div class="story-feature-card__actions">
                <el-button size="small" type="primary" @click="handleStartSession(story, index)">用此故事开局</el-button>
              </div>
            </article>
          </div>
          <div v-else class="empty-box">当前还没有故事池。先生成 2-3 个故事，再从某一个故事开始实验。</div>
        </section>

        <section class="panel control-panel">
          <div class="panel-head">
            <div>
              <div class="panel-title">当前实验</div>
              <div class="panel-meta">这里只保留当前 session 的最小入口；更细的调试动作再往下看。</div>
            </div>
            <el-button text :loading="loading" @click="loadProfile">刷新</el-button>
          </div>

          <div class="active-session-hero" :class="{ 'active-session-hero--empty': !activeSession }">
            <div class="active-session-hero__main">
              <span class="active-session-hero__eyebrow">Active Session</span>
              <h2>{{ activeSession?.storyContext?.title || selectedStory?.title || '还没有活动 session' }}</h2>
              <p>{{ activeSession?.storyContext?.triggerEvent || selectedStory?.triggerEvent || '先从上面的故事池选择一个故事开局。' }}</p>
            </div>
            <div class="active-session-hero__meta">
              <div class="active-session-chip-group">
                <span class="active-session-chip">{{ activeSession ? getSessionStatusLabel(activeSession.status) : '未创建' }}</span>
                <span class="active-session-chip">{{ activeSession ? getSessionStageLabel(activeSession.currentStage) : 'Goal' }}</span>
                <span class="active-session-chip">{{ activeBindingsSummary }}</span>
              </div>
              <el-button type="primary" :disabled="!activeSession" @click="openSessionInspector(activeSession.id)">进入诊断</el-button>
            </div>
          </div>

          <div class="control-grid control-grid--session">
            <article class="control-card control-card--focus">
              <span>当前会话</span>
              <strong>{{ activeSession?.id || '--' }}</strong>
              <em>{{ activeSession ? `${getSessionStatusLabel(activeSession.status)} / ${getSessionStageLabel(activeSession.currentStage)}` : '尚未创建 session' }}</em>
            </article>
            <article class="control-card">
              <span>当前故事</span>
              <strong>{{ activeSession?.storyContext?.title || selectedStory?.title || '--' }}</strong>
              <em>{{ activeSession?.storyContext?.triggerEvent || selectedStory?.triggerEvent || '尚未选择故事' }}</em>
            </article>
            <article class="control-card">
              <span>绑定对象</span>
              <strong>{{ activeBindingsSummary }}</strong>
              <em>{{ activeBindingIdsText }}</em>
            </article>
          </div>

          <div class="view-entry-grid">
            <article class="entry-card entry-card--actions">
              <div class="entry-card__head">
                <strong>实验入口</strong>
                <span>需要更细调试时再展开这些入口</span>
              </div>
              <div class="entry-card__actions">
                <el-button type="primary" :disabled="!canOpenDebugGoal" @click="openDebugGoal">调试 Goal</el-button>
                <el-button :disabled="!canOpenDebugPath" @click="openDebugPath">调试 Path</el-button>
                <el-button :disabled="!canOpenDebugLearn" @click="openDebugLearn">调试 Learn</el-button>
                <el-button plain :disabled="!canOpenFormalGoal" @click="openFormalGoal">正式 Goal</el-button>
                <el-button plain :disabled="!canOpenFormalPath" @click="openFormalPath">正式 Path</el-button>
                <el-button plain :disabled="!canOpenFormalLearn" @click="openFormalLearn">正式 Learn</el-button>
              </div>
            </article>

            <article class="entry-card entry-card--actions">
              <div class="entry-card__head">
                <strong>控制动作</strong>
                <span>只围绕当前活动 session</span>
              </div>
              <div class="entry-card__actions entry-card__actions--wrap">
                <el-button size="small" :disabled="!activeSession || activeSession.currentStage !== 'goal' || goalReady" :loading="stepLoading" @click="runGoalStep">Goal 单步</el-button>
                <el-button size="small" :disabled="!activeSession || activeSession.currentStage !== 'goal' || goalReady" :loading="autoLoading" @click="runGoalAuto">Goal 自动</el-button>
                <el-button size="small" type="primary" :disabled="!activeSession || !goalReady || activeSession.bindings?.learningPathId" :loading="advanceLoading" @click="confirmGeneratePath">确认生成 Path</el-button>
                <el-button size="small" type="primary" plain :disabled="!activeSession || !activeSession.bindings?.learningPathId" :loading="learningStartLoading" @click="startLearning">启动 Learn</el-button>
                <el-button size="small" :disabled="!activeSession || activeSession.currentStage !== 'learning'" :loading="learningStepLoading" @click="runLearningStep">Learn 单步</el-button>
                <el-button size="small" :disabled="!activeSession || activeSession.currentStage !== 'learning'" :loading="autoLearningLoading" @click="runLearningAuto">Learn 自动</el-button>
              </div>
            </article>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <div class="panel-title">历史会话</div>
            <div class="panel-meta">共 {{ sessions.length }} 个会话</div>
          </div>

          <template v-if="sessions.length === 0 && !loading">
            <div class="empty-session-state">
              <div class="empty-session-icon">📋</div>
              <h3>还没有创建过会话</h3>
              <p>先从当前人物或某个故事启动一次 session。</p>
              <el-button type="primary" @click="handleStartSession">创建第一个会话</el-button>
            </div>
          </template>
          <template v-else>
            <el-table :data="sessions" v-loading="loading" stripe size="small" @row-click="setActiveSession">
              <el-table-column label="状态" width="90" align="center">
                <template #default="{ row }">
                  <el-tag :type="getSessionStatusType(row.status)" size="small">{{ getSessionStatusLabel(row.status) }}</el-tag>
                </template>
              </el-table-column>

              <el-table-column label="阶段" width="90" align="center">
                <template #default="{ row }">
                  <el-tag type="info" size="small" effect="plain">{{ getSessionStageLabel(row.currentStage) }}</el-tag>
                </template>
              </el-table-column>

              <el-table-column label="故事" min-width="150">
                <template #default="{ row }">
                  {{ row.storyContext?.title || '--' }}
                </template>
              </el-table-column>

              <el-table-column label="轮次" width="70" align="center">
                <template #default="{ row }">{{ row.roundCount ?? '-' }}</template>
              </el-table-column>

              <el-table-column label="绑定" min-width="180">
                <template #default="{ row }">
                  <div class="binding-stack">
                    <span>goal: {{ row.bindings?.goalConversationId ? 'yes' : '--' }}</span>
                    <span>path: {{ row.bindings?.learningPathId ? 'yes' : '--' }}</span>
                    <span>learn: {{ row.bindings?.teachingSessionId ? 'yes' : '--' }}</span>
                  </div>
                </template>
              </el-table-column>

              <el-table-column label="最后活跃" min-width="120">
                <template #default="{ row }">{{ formatRelativeTime(row.updatedAt) }}</template>
              </el-table-column>

              <el-table-column label="操作" width="220" align="center" fixed="right">
                <template #default="{ row }">
                  <el-button type="primary" link size="small" @click.stop="openSessionInspector(row.id)">诊断</el-button>
                  <el-button type="primary" link size="small" :disabled="!row.bindings?.goalConversationId" @click.stop="openDebugGoal(row)">调试 Goal</el-button>
                  <el-button type="danger" link size="small" @click.stop="deleteSession(row.id)">删除</el-button>
                </template>
              </el-table-column>
            </el-table>
          </template>
        </section>
      </section>
    </main>

    <el-dialog v-model="editDialogVisible" title="编辑画像" width="640px" destroy-on-close>
      <el-form ref="formRef" :model="formData" :rules="formRules" label-width="100px">
        <el-form-item label="学习者称呼" prop="name">
          <el-input v-model="formData.name" placeholder="这个虚拟学习者怎么称呼，如：小林 / 王姐 / 店长A" />
        </el-form-item>
        <div class="panel-meta">用于在人物详情、会话和故事中称呼这个学习者。</div>
        <el-divider>基础身份</el-divider>
        <el-form-item label="年龄">
          <el-input-number v-model="formData.profile.age" :min="18" :max="60" style="width: 120px" />
        </el-form-item>
        <el-form-item label="职业">
          <el-input v-model="formData.profile.occupation" placeholder="如：产品经理、工程师、学生" />
        </el-form-item>
        <el-form-item label="学历">
          <el-input v-model="formData.profile.education" placeholder="如：本科、硕士、大专" />
        </el-form-item>
        <el-form-item label="背景描述">
          <el-input v-model="formData.profile.background" type="textarea" :rows="2" placeholder="简要背景经历..." />
        </el-form-item>
        <el-divider>稳定特质</el-divider>
        <div class="panel-meta panel-meta--block">这组字段描述这个人长期稳定的表达习惯、求助方式和受压反应。</div>
        <el-form-item label="核心人格">
          <el-input v-model="formData.profile.corePersonality" placeholder="如：遇到真实压力时会先保留判断，不会一上来把话说满" />
        </el-form-item>
        <el-form-item label="情感底色">
          <el-input v-model="formData.profile.emotionalBaseline" type="textarea" :rows="2" placeholder="如：平时不一定明显表达，但在连续受挫或公开出错时会明显紧张" />
        </el-form-item>
        <el-form-item label="求助模式">
          <el-input v-model="formData.profile.helpSeekingPattern" type="textarea" :rows="2" placeholder="如：先自己试，卡两次才问；一旦开口就希望对方给具体例子" />
        </el-form-item>
        <el-form-item label="对抗模式">
          <el-input v-model="formData.profile.adversarialPattern" type="textarea" :rows="2" placeholder="如：建议太理想化时，会先说时间不够或条件不允许" />
        </el-form-item>
        <el-form-item label="元认知特征">
          <el-input v-model="formData.profile.metacognitiveProfile" type="textarea" :rows="2" placeholder="如：能感觉到自己没懂，但不太会立刻说清具体卡点" />
        </el-form-item>
        <el-form-item label="负荷容忍度">
          <el-input v-model="formData.profile.cognitiveLoadTolerance" placeholder="如：信息一多就容易先抓表面，之后才慢慢整理重点" />
        </el-form-item>
        <el-form-item label="纠错方式">
          <el-input v-model="formData.profile.memoryRepairPattern" placeholder="如：忘了会先模糊带过，被追问后才承认没记住" />
        </el-form-item>
        <el-divider>内部信息</el-divider>
        <el-form-item label="管理员备注">
          <el-input v-model="formData.notes" type="textarea" :rows="2" placeholder="仅管理员可见的补充说明" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleUpdateProfile">保存修改</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, VideoPlay } from '@element-plus/icons-vue'
import { adminApi } from '@/api/adminApi'

const router = useRouter()
const route = useRoute()
const profileId = route.params.profileId as string
const routeSessionId = computed(() => typeof route.query.sessionId === 'string' ? route.query.sessionId.trim() : '')

const profileData = ref<any>(null)
const sessions = ref<any[]>([])
const loading = ref(false)
const editDialogVisible = ref(false)
const submitting = ref(false)
const formRef = ref()
const activeSessionId = ref<string | null>(null)
const selectedStoryKey = ref<string | null>(null)
const draftProfileLoading = ref(false)
const draftStoriesLoading = ref(false)
const draftProfile = ref<any | null>(null)
const draftStories = ref<any | null>(null)

const stepLoading = ref(false)
const autoLoading = ref(false)
const advanceLoading = ref(false)
const learningStartLoading = ref(false)
const learningStepLoading = ref(false)
const autoLearningLoading = ref(false)
const restartPathLoading = ref(false)
const restartLearningLoading = ref(false)
const stopLearningLoading = ref(false)

const formData = ref({
  name: '',
  profile: {
    age: undefined as number | undefined,
    occupation: '',
    education: '',
    background: '',
    corePersonality: '',
    emotionalBaseline: '',
    helpSeekingPattern: '',
    adversarialPattern: '',
    metacognitiveProfile: '',
    cognitiveLoadTolerance: '',
    memoryRepairPattern: ''
  },
  simulationMode: 'manual',
  simulationTemperature: 0.8,
  personalityTraits: {
    verbosity: 'normal',
    enthusiasm: 'normal',
    confusionStyle: 'direct'
  },
  notes: ''
})

const formRules = {
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }]
}

const storyPool = computed(() => {
  const pool = profileData.value?.profile?.storyPool
  return Array.isArray(pool) ? pool : []
})

const selectedStory = computed(() => {
  if (!selectedStoryKey.value) return storyPool.value[0] || null
  return storyPool.value.find((story: any, index: number) => getStoryKey(story, index) === selectedStoryKey.value) || storyPool.value[0] || null
})

const activeSession = computed(() => {
  if (!sessions.value.length) return null
  if (activeSessionId.value) {
    const matched = sessions.value.find((item: any) => item.id === activeSessionId.value)
    if (matched) return matched
  }
  return sessions.value[0]
})

const goalReady = computed(() => {
  if (!activeSession.value) return false
  if (activeSession.value.currentStage === 'path' || activeSession.value.currentStage === 'learning') return true
  return !!activeSession.value.bindings?.goalConversationId
})

const activeBindingsSummary = computed(() => {
  if (!activeSession.value) return '--'
  const bindings = activeSession.value.bindings || {}
  const boundCount = [bindings.goalConversationId, bindings.learningPathId, bindings.teachingSessionId].filter(Boolean).length
  return `${boundCount}/3 已绑定`
})

const activeBindingIdsText = computed(() => {
  if (!activeSession.value) return '尚未创建 session'
  const bindings = activeSession.value.bindings || {}
  return `goal:${shortId(bindings.goalConversationId)} path:${shortId(bindings.learningPathId)} learn:${shortId(bindings.teachingSessionId)}`
})

const canOpenDebugGoal = computed(() => !!activeSession.value?.bindings?.goalConversationId)
const canOpenDebugPath = computed(() => !!activeSession.value?.bindings?.learningPathId)
const canOpenDebugLearn = computed(() => !!activeSession.value?.bindings?.currentTaskId)
const canOpenFormalGoal = computed(() => !!activeSession.value?.bindings?.goalConversationId)
const canOpenFormalPath = computed(() => !!activeSession.value?.bindings?.learningPathId)
const canOpenFormalLearn = computed(() => !!activeSession.value?.bindings?.currentTaskId)

const personaHeadline = computed(() => {
  const occupation = profileData.value?.profile?.occupation || '学习者'
  const summary = profileData.value?.profile?.behavioralProfileSummary || profileData.value?.profile?.corePersonality || '带着真实限制来求助'
  return `${occupation}，${summary}`
})

const personaNarrative = computed(() => {
  return profileData.value?.profile?.background
    || '这是一个长期稳定的人物底座。具体某一次 session 的冲突、触发点和开场表达，由下方故事池决定。'
})

const personaFactCards = computed(() => [
  { label: '职业', value: profileData.value?.profile?.occupation || '--' },
  { label: '年龄', value: profileData.value?.profile?.age ? `${profileData.value.profile.age} 岁` : '--' },
  { label: '知识水平', value: getKnowledgeLevelLabel(profileData.value?.knowledgeLevel) },
  { label: '可用时间', value: getAvailableTimeLabel(profileData.value?.profile?.availableTime) },
  { label: '故事数量', value: `${storyPool.value.length} 个` }
])

const traitSummaryCards = computed(() => {
  const p = profileData.value?.profile || {}
  return [
    {
      label: '核心人格',
      value: p.corePersonality || '会先从眼前场景判断有没有用，不会轻易接受脱离现实的建议。',
      helper: p.behavioralProfileSummary || '这是这个人物更长期的表达与反应基线。'
    },
    {
      label: '情感底色',
      value: p.emotionalBaseline || '平时未显性表达，但会受真实压力影响',
      helper: '重点看他在压力上来时，情绪会怎么外露。'
    },
    {
      label: '求助与对抗',
      value: p.helpSeekingPattern || '遇到卡点时会按自己的节奏决定何时开口求助',
      helper: p.adversarialPattern || '当建议不贴脸时，可能会先保留或确认，而不是立即接受'
    },
    {
      label: '自我觉察',
      value: p.selfAwarenessPattern || p.metacognitiveProfile || '能感觉到自己不顺，但不一定会马上说清根因。',
      helper: p.planningFollowThrough || p.selfRegulationStyle || '会怎么计划、掉队后怎么补，是这个人的长期执行习惯。'
    },
    {
      label: '负荷反应',
      value: p.overloadReaction || p.cognitiveLoadTolerance || '信息一多时，会先抓最表面的可执行点。',
      helper: p.memoryRepairPattern || '忘了或没完全懂时，通常会先模糊带过，再慢慢承认或修正。'
    }
  ]
})

const getKnowledgeLevelLabel = (value?: string) => {
  switch (value) {
    case 'beginner': return '初学者'
    case 'intermediate': return '中级'
    case 'advanced': return '高级'
    default: return value || '--'
  }
}

const getAvailableTimeLabel = (value?: string) => {
  switch (value) {
    case 'minimal': return '很少'
    case 'moderate': return '一般'
    case 'abundant': return '充足'
    default: return '--'
  }
}

const formatTime = (time: string | null | undefined) => {
  if (!time) return '--'
  const d = new Date(time)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
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
  return formatTime(time)
}

const getSessionStatusType = (status: string) => {
  switch (status) {
    case 'running': return 'success'
    case 'completed': return 'info'
    case 'failed': return 'danger'
    default: return 'warning'
  }
}

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

const shortId = (value?: string | null) => value ? value.slice(0, 8) : '--'

const getStoryKey = (story: any, index: number) => story?.id || `story-${index}`

const selectStory = (story: any, index: number) => {
  selectedStoryKey.value = getStoryKey(story, index)
}

const normalizeSessions = (items: any[]) => {
  return Array.isArray(items) ? items : []
}

const loadProfile = async () => {
  loading.value = true
  try {
    const res = await adminApi.getVirtualLearner(profileId)
    if (res.data?.success) {
      profileData.value = res.data.data
      sessions.value = normalizeSessions(res.data.data.sessions || [])
      activeSessionId.value = routeSessionId.value && sessions.value.some((item: any) => item.id === routeSessionId.value)
        ? routeSessionId.value
        : sessions.value[0]?.id || null
      if (!selectedStoryKey.value && storyPool.value.length) {
        selectedStoryKey.value = getStoryKey(storyPool.value[0], 0)
      }
    } else {
      ElMessage.error(res.data?.error || '加载失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message || '加载失败')
  } finally {
    loading.value = false
  }
}

const generateProfileDraft = async () => {
  draftProfileLoading.value = true
  try {
    const res = await adminApi.draftVirtualLearnerProfile(profileId)
    if (res.data?.success) {
      draftProfile.value = res.data.data?.generatedProfile || null
      ElMessage.success('画像草稿已生成')
    } else {
      ElMessage.error(res.data?.error || '画像草稿生成失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message || '画像草稿生成失败')
  } finally {
    draftProfileLoading.value = false
  }
}

const generateStoryDraft = async () => {
  draftStoriesLoading.value = true
  try {
    const res = await adminApi.draftVirtualLearnerStories(profileId)
    if (res.data?.success) {
      draftStories.value = res.data.data || null
      ElMessage.success('故事草稿已生成')
    } else {
      ElMessage.error(res.data?.error || '故事草稿生成失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message || '故事草稿生成失败')
  } finally {
    draftStoriesLoading.value = false
  }
}

const applyProfileDraft = async () => {
  if (!draftProfile.value || !profileData.value) return
  submitting.value = true
  try {
    const payload = {
      learningGoal: profileData.value.learningGoal,
      knowledgeLevel: profileData.value.knowledgeLevel,
      profile: {
        ...(profileData.value.profile || {}),
        ...draftProfile.value,
        storyPool: profileData.value.profile?.storyPool || []
      },
      personalityTraits: {
        ...(profileData.value.personalityTraits || {}),
        ...(draftProfile.value.personalityTraits || {})
      }
    }
    const res = await adminApi.updateVirtualLearner(profileId, payload)
    if (res.data?.success) {
      draftProfile.value = null
      ElMessage.success('画像草稿已应用')
      await loadProfile()
    } else {
      ElMessage.error(res.data?.error || '应用画像草稿失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message || '应用画像草稿失败')
  } finally {
    submitting.value = false
  }
}

const applyStoryDraft = async () => {
  if (!draftStories.value || !profileData.value) return
  submitting.value = true
  try {
    const currentProfile = profileData.value.profile || {}
    const nextProfile = {
      ...currentProfile,
      ...(draftStories.value.personaSeed || {}),
      storyPool: Array.isArray(draftStories.value.stories) ? draftStories.value.stories : currentProfile.storyPool || []
    }
    const nextGoal = draftStories.value.goalSeed?.surfaceGoal || profileData.value.learningGoal
    const nextLevel = draftStories.value.personaSeed?.knowledgeLevel || profileData.value.knowledgeLevel
    const nextTraits = {
      ...(profileData.value.personalityTraits || {}),
      ...(draftStories.value.personaSeed?.personalityTraits || {})
    }

    const res = await adminApi.updateVirtualLearner(profileId, {
      learningGoal: nextGoal,
      knowledgeLevel: nextLevel,
      profile: nextProfile,
      personalityTraits: nextTraits,
      notes: profileData.value.notes
    })
    if (res.data?.success) {
      draftStories.value = null
      ElMessage.success('故事草稿已应用')
      await loadProfile()
    } else {
      ElMessage.error(res.data?.error || '应用故事草稿失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message || '应用故事草稿失败')
  } finally {
    submitting.value = false
  }
}

const handleStartSession = async (story?: any, storyIndex?: number) => {
  try {
    const payload = story ? { storyId: story.id, storyIndex } : undefined
    const res = await adminApi.startVirtualSession(profileId, payload)
    if (res.data?.success) {
      ElMessage.success('会话已创建')
      await loadProfile()
      activeSessionId.value = res.data.data?.id || sessions.value[0]?.id || null
    }
  } catch (error: any) {
    ElMessage.error(error.message || '创建会话失败')
  }
}

const setActiveSession = (session: any) => {
  activeSessionId.value = session.id
}

const openSessionInspector = (sessionId: string) => {
  router.push(`/admin/virtual-session/${sessionId}`)
}

const openDebugGoal = (sessionArg?: any) => {
  const session = sessionArg || activeSession.value
  if (!session?.bindings?.goalConversationId) return
  router.push(`/admin/test/goal-full/${session.bindings.goalConversationId}?virtualSessionId=${session.id}&viewMode=debug`)
}

const openDebugPath = () => {
  const session = activeSession.value
  if (!session?.bindings?.learningPathId) return
  router.push(`/admin/test/learning-path/${session.bindings.learningPathId}?virtualSessionId=${session.id}&viewMode=debug`)
}

const openDebugLearn = () => {
  const session = activeSession.value
  if (!session?.bindings?.currentTaskId) return
  router.push(`/admin/test/learn/${session.bindings.currentTaskId}?virtualSessionId=${session.id}&viewMode=debug`)
}

const openFormalGoal = () => {
  const session = activeSession.value
  if (!session?.bindings?.goalConversationId) return
  window.open(`/goal-conversation/${session.bindings.goalConversationId}?virtualSessionId=${session.id}&viewMode=formal`, '_blank')
}

const openFormalPath = () => {
  const session = activeSession.value
  if (!session?.bindings?.learningPathId) return
  window.open(`/learning-path/${session.bindings.learningPathId}?virtualSessionId=${session.id}&viewMode=formal`, '_blank')
}

const openFormalLearn = () => {
  const session = activeSession.value
  if (!session?.bindings?.currentTaskId) return
  window.open(`/learn/${session.bindings.currentTaskId}?virtualSessionId=${session.id}&viewMode=formal`, '_blank')
}

const withActiveSession = async (runner: (sessionId: string) => Promise<void>) => {
  if (!activeSession.value?.id) {
    ElMessage.warning('请先选择一个 session')
    return
  }
  await runner(activeSession.value.id)
  await loadProfile()
}

const runGoalStep = async () => {
  stepLoading.value = true
  try {
    await withActiveSession(async (sessionId) => {
      const res = await adminApi.virtualSessionStep(sessionId)
      if (!res.data?.success) throw new Error(res.data?.error || 'Goal 单步失败')
    })
  } catch (error: any) {
    ElMessage.error(error.message || 'Goal 单步失败')
  } finally {
    stepLoading.value = false
  }
}

const runGoalAuto = async () => {
  autoLoading.value = true
  try {
    await withActiveSession(async (sessionId) => {
      const res = await adminApi.virtualSessionAuto(sessionId, { maxRounds: 20 })
      if (!res.data?.success) throw new Error(res.data?.error || 'Goal 自动失败')
    })
  } catch (error: any) {
    ElMessage.error(error.message || 'Goal 自动失败')
  } finally {
    autoLoading.value = false
  }
}

const confirmGeneratePath = async () => {
  advanceLoading.value = true
  try {
    await withActiveSession(async (sessionId) => {
      const res = await adminApi.virtualSessionAdvancePath(sessionId)
      if (!res.data?.success) throw new Error(res.data?.error || '生成 Path 失败')
    })
  } catch (error: any) {
    ElMessage.error(error.message || '生成 Path 失败')
  } finally {
    advanceLoading.value = false
  }
}

const startLearning = async () => {
  learningStartLoading.value = true
  try {
    await withActiveSession(async (sessionId) => {
      const res = await adminApi.startVirtualLearning(sessionId)
      if (!res.data?.success) throw new Error(res.data?.error || '启动 Learn 失败')
    })
  } catch (error: any) {
    ElMessage.error(error.message || '启动 Learn 失败')
  } finally {
    learningStartLoading.value = false
  }
}

const runLearningStep = async () => {
  learningStepLoading.value = true
  try {
    await withActiveSession(async (sessionId) => {
      const res = await adminApi.virtualSessionLearningStep(sessionId)
      if (!res.data?.success) throw new Error(res.data?.error || 'Learn 单步失败')
    })
  } catch (error: any) {
    ElMessage.error(error.message || 'Learn 单步失败')
  } finally {
    learningStepLoading.value = false
  }
}

const runLearningAuto = async () => {
  autoLearningLoading.value = true
  try {
    await withActiveSession(async (sessionId) => {
      const res = await adminApi.virtualSessionAutoLearning(sessionId, { maxMilestones: 10 })
      if (!res.data?.success) throw new Error(res.data?.error || 'Learn 自动失败')
    })
  } catch (error: any) {
    ElMessage.error(error.message || 'Learn 自动失败')
  } finally {
    autoLearningLoading.value = false
  }
}

const restartPath = async () => {
  restartPathLoading.value = true
  try {
    await withActiveSession(async (sessionId) => {
      const res = await adminApi.restartVirtualSessionPath(sessionId)
      if (!res.data?.success) throw new Error(res.data?.error || '重启 Path 失败')
    })
  } catch (error: any) {
    ElMessage.error(error.message || '重启 Path 失败')
  } finally {
    restartPathLoading.value = false
  }
}

const restartLearning = async () => {
  restartLearningLoading.value = true
  try {
    await withActiveSession(async (sessionId) => {
      const res = await adminApi.restartVirtualLearning(sessionId)
      if (!res.data?.success) throw new Error(res.data?.error || '重启 Learn 失败')
    })
  } catch (error: any) {
    ElMessage.error(error.message || '重启 Learn 失败')
  } finally {
    restartLearningLoading.value = false
  }
}

const stopLearning = async () => {
  stopLearningLoading.value = true
  try {
    await withActiveSession(async (sessionId) => {
      const res = await adminApi.stopVirtualLearning(sessionId)
      if (!res.data?.success) throw new Error(res.data?.error || '紧急停止失败')
    })
  } catch (error: any) {
    ElMessage.error(error.message || '紧急停止失败')
  } finally {
    stopLearningLoading.value = false
  }
}

const deleteSession = async (sessionId: string) => {
  try {
    await ElMessageBox.confirm('确定删除此会话？相关数据将被清除。', '确认删除', { type: 'warning' })
    const res = await adminApi.deleteVirtualSession(sessionId)
    if (res.data?.success) {
      ElMessage.success('会话已删除')
      sessions.value = sessions.value.filter((s: any) => s.id !== sessionId)
      if (activeSessionId.value === sessionId) {
        activeSessionId.value = sessions.value[0]?.id || null
      }
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || '删除失败')
    }
  }
}

const openEditDialog = () => {
  if (!profileData.value) return
  const p = profileData.value
  formData.value = {
    name: p.userName || '',
    profile: {
      age: p.profile?.age,
      occupation: p.profile?.occupation || '',
      education: p.profile?.education || '',
      background: p.profile?.background || '',
      corePersonality: p.profile?.corePersonality || '',
      emotionalBaseline: p.profile?.emotionalBaseline || '',
      helpSeekingPattern: p.profile?.helpSeekingPattern || '',
      adversarialPattern: p.profile?.adversarialPattern || '',
      metacognitiveProfile: p.profile?.metacognitiveProfile || '',
      cognitiveLoadTolerance: p.profile?.cognitiveLoadTolerance || '',
      memoryRepairPattern: p.profile?.memoryRepairPattern || ''
    },
    simulationMode: p.simulationMode || 'manual',
    simulationTemperature: p.simulationTemperature || 0.8,
    personalityTraits: {
      verbosity: p.personalityTraits?.verbosity || 'normal',
      enthusiasm: p.personalityTraits?.enthusiasm || 'normal',
      confusionStyle: p.personalityTraits?.confusionStyle || 'direct'
    },
    notes: p.notes || ''
  }
  editDialogVisible.value = true
}

const handleUpdateProfile = async () => {
  try {
    await formRef.value?.validate()
  } catch {
    return
  }
  submitting.value = true
  try {
    const res = await adminApi.updateVirtualLearner(profileId, formData.value)
    if (res.data?.success) {
      ElMessage.success('更新成功')
      editDialogVisible.value = false
      loadProfile()
    }
  } catch (error: any) {
    ElMessage.error(error.message || '更新失败')
  } finally {
    submitting.value = false
  }
}

onMounted(() => {
  loadProfile()
})
</script>

<style scoped>
.profile-page {
  min-height: 100vh;
  padding: 16px;
  background: #f6f7fb;
  color: #1f2937;
}

.topbar,
.layout {
  max-width: 1440px;
  margin: 0 auto;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
  padding: 14px 18px;
  background: #fff;
  border: 1px solid #e5eaf2;
  border-radius: 16px;
}

.topbar-left,
.topbar-right,
.title-meta,
.panel-head,
.profile-header,
.entry-card__head,
.entry-card__actions,
.control-grid,
.story-card__head,
.story-card__meta,
.binding-stack {
  display: flex;
  align-items: center;
}

.topbar-left,
.topbar-right,
.title-meta,
.entry-card__actions,
.story-card__meta {
  gap: 8px;
}

.title-wrap h1 {
  margin: 0;
  font-size: 20px;
}

.layout {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.panel {
  background: #fff;
  border: 1px solid #e5eaf2;
  border-radius: 16px;
  padding: 18px;
}

.panel-title {
  font-size: 14px;
  font-weight: 700;
  color: #1f2937;
}

.panel-head {
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.panel-head--stack {
  flex-direction: column;
  align-items: flex-start;
}

.panel-meta {
  font-size: 12px;
  color: #8b94a6;
}

.panel-meta--block {
  max-width: 560px;
  line-height: 1.55;
}

.draft-panel {
  display: grid;
  gap: 14px;
}

.draft-actions {
  display: flex;
  gap: 8px;
}

.draft-story-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid #dbe6f8;
  border-radius: 14px;
  background: #f8fbff;
  color: #36507a;
}

.draft-story-banner strong {
  font-size: 13px;
  color: #1f2937;
}

.draft-story-banner span {
  font-size: 12px;
  color: #61708a;
}

.draft-grid {
  display: grid;
  grid-template-columns: repeat(1, minmax(0, 1fr));
  gap: 12px;
}

.draft-card {
  padding: 14px;
  border-radius: 16px;
  border: 1px solid #d8e3f4;
  background: linear-gradient(180deg, #f8fbff, #ffffff);
}

.draft-card span {
  display: block;
  margin-bottom: 8px;
  font-size: 12px;
  color: #7b8597;
}

.draft-card strong {
  display: block;
  margin-bottom: 8px;
  font-size: 16px;
  color: #1f2937;
}

.draft-card p {
  margin: 0 0 10px;
  color: #526074;
  line-height: 1.65;
}

.draft-mini-list {
  display: grid;
  gap: 6px;
}

.draft-mini-list span {
  margin: 0;
  color: #5f6b7d;
  font-size: 12px;
}

.profile-header {
  gap: 12px;
  margin-bottom: 18px;
  padding-bottom: 16px;
  border-bottom: 1px solid #edf1f6;
}

.profile-header--hero {
  margin-bottom: 0;
  padding-bottom: 0;
  border-bottom: 0;
}

.profile-avatar {
  width: 52px;
  height: 52px;
  border-radius: 16px;
  background: linear-gradient(135deg, #1f4fd6, #7c3aed);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  font-weight: 700;
  flex-shrink: 0;
}

.profile-avatar--hero {
  width: 64px;
  height: 64px;
  border-radius: 20px;
  font-size: 28px;
}

.profile-identity {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.profile-identity strong {
  font-size: 16px;
}

.profile-identity span {
  font-size: 12px;
  color: #7b8597;
}

.kv-list,
.story-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.kv-item {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.kv-item span,
.binding-stack span,
.story-card__head span,
.story-card__meta span,
.control-card span,
.control-card em {
  font-size: 12px;
  color: #7b8597;
}

.kv-item strong,
.story-card__head strong,
.control-card strong {
  font-size: 12px;
  text-align: right;
  word-break: break-all;
}

.kv-value--truncate {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-align: left;
}

.story-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid #e7ecf3;
  border-radius: 14px;
  background: #fbfcfe;
}

.story-card.active {
  border-color: #c9dcff;
  background: #f5f9ff;
}

.story-card__main {
  border: 0;
  padding: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.story-card__head,
.story-card__meta,
.binding-stack {
  justify-content: space-between;
}

.story-card p {
  margin: 8px 0;
  color: #475569;
  line-height: 1.55;
}

.control-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.active-session-hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
  border: 1px solid #dbe6f6;
  border-radius: 18px;
  background: linear-gradient(135deg, #f8fbff, #ffffff);
}

.active-session-hero--empty {
  border-style: dashed;
  background: #fbfcfe;
}

.active-session-hero__main {
  min-width: 0;
}

.active-session-hero__eyebrow {
  display: inline-flex;
  margin-bottom: 10px;
  padding: 4px 10px;
  border-radius: 999px;
  background: #eaf2ff;
  color: #2458d6;
  font-size: 11px;
  font-weight: 700;
}

.active-session-hero__main h2 {
  margin: 0 0 6px;
  font-size: 24px;
  line-height: 1.2;
}

.active-session-hero__main p {
  margin: 0;
  color: #5f6b7d;
  line-height: 1.6;
}

.active-session-hero__meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 12px;
}

.active-session-chip-group {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.active-session-chip {
  padding: 4px 10px;
  border-radius: 999px;
  background: #f1f5f9;
  color: #607086;
  font-size: 12px;
}

.control-grid--session {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.control-grid {
  gap: 10px;
  flex-wrap: wrap;
}

.control-card,
.entry-card {
  flex: 1 1 220px;
  min-width: 0;
  padding: 14px;
  border: 1px solid #e7ecf3;
  border-radius: 14px;
  background: #fbfcfe;
}

.control-card strong {
  display: block;
  margin: 6px 0;
  font-size: 18px;
  color: #1f2937;
}

.control-card--focus {
  border-color: #cfddf5;
  background: linear-gradient(180deg, #f7faff, #ffffff);
}

.control-card em {
  display: block;
  font-style: normal;
  line-height: 1.5;
}

.view-entry-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.entry-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.view-entry-grid--top {
  grid-template-columns: 1.15fr 0.85fr;
}

.entry-card__head {
  justify-content: space-between;
}

.entry-card__head strong {
  font-size: 14px;
}

.entry-card__actions {
  flex-wrap: wrap;
}

.entry-card__actions--primary :deep(.el-button:not(.el-button--primary)) {
  border-color: #d6dfed;
  color: #4c617c;
}

.entry-card--debug {
  border-color: #dbe6f8;
  background: linear-gradient(180deg, #f8fbff, #ffffff);
}

.entry-card--formal {
  background: #fcfdff;
}

.entry-card--actions {
  background: #fbfcfe;
}

.entry-card__actions--wrap :deep(button) {
  margin: 0;
}

.binding-stack {
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}

.empty-session-state,
.empty-box {
  text-align: center;
  padding: 28px 20px;
  background: #fbfcfe;
  border-radius: 16px;
  border: 1px dashed #dce4ee;
  color: #8b94a6;
}

.empty-session-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.empty-session-state h3 {
  margin: 0 0 8px;
  font-size: 16px;
  color: #1f2937;
}

.empty-session-state p {
  margin: 0 0 20px;
  font-size: 13px;
  color: #8b94a6;
}

.personality-settings {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.personality-item {
  display: flex;
  align-items: center;
  gap: 12px;
}

.personality-item .label {
  font-size: 13px;
  color: #6b7280;
}

@media (max-width: 1200px) {
  .persona-hero,
  .story-grid,
  .view-entry-grid {
    grid-template-columns: 1fr;
  }

  .control-grid--session {
    grid-template-columns: 1fr;
  }
}

.persona-hero {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(280px, 0.7fr);
  gap: 16px;
  align-items: stretch;
}

.persona-hero__main {
  display: grid;
  gap: 16px;
}

.persona-hero__intro {
  display: grid;
  gap: 10px;
}

.persona-hero__eyebrow {
  display: inline-flex;
  width: fit-content;
  padding: 4px 10px;
  border-radius: 999px;
  background: #eef4ff;
  color: #2355d8;
  font-size: 11px;
  font-weight: 700;
}

.persona-hero__intro h2 {
  margin: 0;
  font-size: 28px;
  line-height: 1.25;
}

.persona-hero__intro p {
  margin: 0;
  color: #5f6b7d;
  line-height: 1.7;
  font-size: 14px;
}

.persona-hero__facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.persona-fact-card {
  padding: 14px;
  border-radius: 16px;
  background: #fbfcfe;
  border: 1px solid #e7ecf3;
}

.persona-fact-card span {
  display: block;
  margin-bottom: 8px;
  font-size: 12px;
  color: #7b8597;
}

.persona-fact-card strong {
  display: block;
  font-size: 15px;
  line-height: 1.45;
  color: #1f2937;
}

.story-pool-panel {
  display: grid;
  gap: 14px;
}

.story-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.story-feature-card {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 12px;
  padding: 14px;
  border-radius: 18px;
  border: 1px solid #e7ecf3;
  background: #fbfcfe;
}

.story-feature-card.active {
  border-color: #c9dafd;
  background: linear-gradient(180deg, #f8fbff, #ffffff);
}

.story-feature-card__main {
  border: 0;
  padding: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.story-feature-card__head,
.story-feature-card__lines,
.story-feature-card__actions {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.story-feature-card__head {
  align-items: center;
  margin-bottom: 8px;
}

.story-feature-card__index,
.story-feature-card__source {
  font-size: 11px;
  color: #7b8597;
}

.story-feature-card strong {
  display: block;
  margin-bottom: 10px;
  font-size: 18px;
  line-height: 1.35;
}

.story-feature-card p {
  margin: 0;
  color: #526074;
  line-height: 1.65;
  min-height: 72px;
}

.story-feature-card__lines {
  flex-direction: column;
  margin-top: 12px;
}

.story-feature-card__lines span {
  font-size: 12px;
  color: #6b7280;
}

.engine-panel {
  display: grid;
  gap: 14px;
}

.trait-panel {
  display: grid;
  gap: 14px;
}

.trait-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.trait-card {
  padding: 14px;
  border-radius: 16px;
  border: 1px solid #e7ecf3;
  background: #fbfcfe;
}

.trait-card span {
  display: block;
  margin-bottom: 8px;
  font-size: 12px;
  color: #7b8597;
}

.trait-card strong {
  display: block;
  margin-bottom: 8px;
  font-size: 15px;
  line-height: 1.5;
  color: #1f2937;
}

.trait-card p {
  margin: 0;
  color: #5f6b7d;
  line-height: 1.6;
  font-size: 13px;
}

.engine-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.engine-card {
  padding: 14px;
  border-radius: 16px;
  border: 1px solid #e7ecf3;
  background: #fbfcfe;
}

.engine-card span {
  display: block;
  margin-bottom: 8px;
  font-size: 12px;
  color: #7b8597;
}

.engine-card strong {
  display: block;
  margin-bottom: 8px;
  font-size: 15px;
  line-height: 1.4;
  color: #1f2937;
}

.engine-card p {
  margin: 0;
  color: #5f6b7d;
  line-height: 1.6;
  font-size: 13px;
}

@media (max-width: 1200px) {
  .persona-hero,
  .trait-grid,
  .engine-grid,
  .story-grid,
  .view-entry-grid {
    grid-template-columns: 1fr;
  }

  .control-grid--session {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 900px) {
  .topbar {
    flex-direction: column;
    align-items: flex-start;
  }

  .topbar-right,
  .control-grid {
    width: 100%;
  }

  .active-session-hero {
    flex-direction: column;
  }

  .active-session-hero__meta {
    width: 100%;
    align-items: flex-start;
  }

  .active-session-chip-group {
    justify-content: flex-start;
  }
}
</style>
