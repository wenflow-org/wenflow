<template>
  <div class="story-stage-page" :class="{ 'story-stage-page--embedded': embedded }">
    <header v-if="!embedded" class="story-stage-topbar">
      <div class="story-stage-topbar__left">
        <el-button text @click="router.push(`/admin/virtual-learners/${profileId}/stories/${storyId}`)">
          <el-icon><ArrowLeft /></el-icon>
          返回学情概览
        </el-button>
        <div class="story-stage-topbar__title">
          <span class="story-stage-topbar__eyebrow">{{ stageLabel }}</span>
          <h1>{{ selectedStorySummary?.storyTitle || selectedStorySummary?.title || '故事阶段页' }}</h1>
          <p>{{ stageTitle }}</p>
        </div>
      </div>
      <div class="story-stage-topbar__actions">
        <el-button @click="loadStageData" :loading="loading">刷新</el-button>
        <el-button @click="router.push(`/admin/virtual-session/${selectedStorySession?.id}`)" :disabled="!selectedStorySession?.id">进入诊断</el-button>
      </div>
    </header>

    <main v-if="selectedStorySummary" class="story-stage-layout">
      <section v-if="!embedded" class="story-stage-hero panel-card">
        <div>
          <span class="story-stage-hero__eyebrow">{{ stageLabel }}</span>
          <h2>{{ stageHeadline }}</h2>
          <p>{{ stageDescription }}</p>
        </div>
        <div class="story-stage-hero__facts">
          <article v-for="item in stageFactCards" :key="item.label" class="story-stage-fact-card">
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
            <em>{{ item.meta }}</em>
          </article>
        </div>
      </section>

      <section class="story-stage-main-grid" :class="{ 'story-stage-main-grid--goal': stage === 'goal', 'story-stage-main-grid--embedded': embedded }">
        <section class="panel-card story-stage-main-panel" :class="{ 'story-stage-main-panel--goal': stage === 'goal' }">
          <div v-if="!embedded" class="section-head">
            <div>
              <span class="section-head__eyebrow">Control Panel</span>
              <h3>{{ stagePanelTitle }}</h3>
            </div>
            <div v-if="stageMetaLine" class="section-head__meta">{{ stageMetaLine }}</div>
          </div>

          <template v-if="stage === 'goal'">
            <div class="stage-card stage-card--goal story-stage-goal-card">
              <div class="stage-card__head" :class="{ 'stage-card__head--embedded': embedded }">
                <div>
                  <span class="stage-card__eyebrow">Goal</span>
                  <strong>{{ selectedStoryGoalStatusLabel }}</strong>
                </div>
                <div class="stage-card__head-actions">
                  <span v-if="!embedded" class="stage-card__meta">{{ selectedStorySession ? `session ${shortId(selectedStorySession.id)}` : '先创建一次运行' }}</span>
                  <span v-else class="stage-card__meta">{{ goalConversationStageLabel }}</span>
                  <div class="stage-card__actions" :class="{ 'stage-card__actions--embedded': embedded }">
                    <el-button size="small" type="primary" plain :disabled="!selectedStorySession?.bindings?.goalConversationId" @click="openDebugGoalFor(selectedStorySession)">看 Goal 对话</el-button>
                    <el-button size="small" :disabled="!canRunGoalForSelectedStory" :loading="stepLoading" @click="runGoalStepFor(selectedStorySession)">手动跑</el-button>
                    <el-button size="small" :disabled="!canRunGoalForSelectedStory" :loading="autoLoading" @click="runGoalAutoFor(selectedStorySession)">自动跑</el-button>
                    <el-button size="small" type="danger" plain :loading="restartLoading" @click="restartStoryGoal">清空并重新开始</el-button>
                  </div>
                </div>
              </div>
              <p v-if="!embedded">{{ selectedStorySession?.storyContext?.triggerEvent || selectedStorySummary.storyTriggerEvent || '从故事开场进入 goal 对话。' }}</p>
            </div>

            <section class="detail-block detail-block--dialogue detail-block--goal-dialogue">
              <div class="detail-block__head detail-block__head--dialogue">
                <div class="goal-dialogue-title">
                  <strong>Goal 对话</strong>
                  <em v-if="!embedded">当前阶段 {{ goalConversationStageLabel }}</em>
                </div>
                <span v-if="!embedded">{{ goalConversationRounds.length }} 轮</span>
              </div>
              <div v-if="goalConversationRounds.length" class="dialogue-list dialogue-list--goal">
                <article
                  v-for="(message, index) in goalConversationRounds"
                  :key="`goal-${index}`"
                  class="dialogue-row dialogue-row--goal"
                >
                  <div class="dialogue-row__meta">
                    <span class="dialogue-round-pill">第 {{ message.round }} 轮</span>
                    <span v-if="message.isOpening" class="dialogue-opening-pill">开场白</span>
                  </div>
                  <div class="goal-round-rail">
                    <div class="goal-round-bubble goal-round-bubble--learner">
                      <div class="goal-round-bubble__head">
                        <div class="goal-round-bubble__title-row">
                          <strong>虚拟学习者</strong>
                        </div>
                        <span class="dialogue-side-pill dialogue-side-pill--learner">reply</span>
                      </div>
                      <p>{{ message.learnerText }}</p>
                    </div>

                    <div class="goal-round-bubble goal-round-bubble--agent">
                      <div class="goal-round-bubble__head">
                        <div class="goal-round-bubble__title-row">
                          <strong>Goal Agent</strong>
                        </div>
                        <span class="dialogue-side-pill dialogue-side-pill--agent">response</span>
                      </div>
                      <p>{{ message.agentText }}</p>
                    </div>
                  </div>
                </article>
              </div>
              <div v-else class="empty-box empty-box--inline">暂无 Goal 对话</div>
            </section>

            <el-collapse v-if="!embedded" class="goal-internal-collapse">
              <el-collapse-item title="查看内部推进信号" name="goal-internal-signals">
                <section class="detail-block detail-block--status-strip detail-block--status-strip-compact">
                  <div class="detail-block__head detail-block__head--dialogue">
                    <strong>当前推进状态</strong>
                    <span>{{ goalConversationStageLabel }}</span>
                  </div>
                  <div class="goal-status-pill-row">
                    <span class="goal-status-pill">
                      <em>理解</em>
                      <strong>{{ learnerUnderstandingDisplay }}</strong>
                      <small>{{ learnerEmotionDisplay }}</small>
                    </span>
                    <span class="goal-status-pill">
                      <em>准备度</em>
                      <strong>{{ learnerGoalReadinessDisplay }}</strong>
                      <small>{{ learnerClarificationDisplay }}</small>
                    </span>
                    <span class="goal-status-pill">
                      <em>推进</em>
                      <strong>{{ learnerAdvanceDisplay }}</strong>
                      <small>{{ learnerUnknownsDisplay }}</small>
                    </span>
                  </div>
                </section>
              </el-collapse-item>
            </el-collapse>
          </template>

          <template v-else-if="stage === 'path'">
            <div class="stage-card stage-card--path stage-card--path-hero">
              <div class="stage-card__head" :class="{ 'stage-card__head--embedded': embedded }">
                <div>
                  <span class="stage-card__eyebrow">Path</span>
                  <strong>{{ selectedStoryPathStatusLabel }}</strong>
                </div>
                <div class="stage-card__head-actions">
                  <span v-if="!embedded" class="stage-card__meta">{{ selectedStoryPathSummary }}</span>
                  <div class="stage-card__actions" :class="{ 'stage-card__actions--embedded': embedded }">
                    <el-button size="small" type="primary" plain :disabled="!selectedStorySession?.bindings?.learningPathId" @click="openDebugPathFor(selectedStorySession)">看 Path</el-button>
                    <el-button size="small" :disabled="!canAdvancePathForSelectedStory" :loading="advanceLoading" @click="confirmGeneratePathFor(selectedStorySession)">生成 Path</el-button>
                    <el-button size="small" type="danger" plain :loading="restartLoading" @click="restartStoryPath">重建 Path</el-button>
                  </div>
                </div>
              </div>
              <p v-if="!embedded">{{ selectedStoryPathNarrative }}</p>
            </div>

            <section class="detail-block detail-block--path-map">
              <div class="detail-block__head detail-block__head--dialogue">
                <div>
                  <strong>路径地图</strong>
                  <span>阶段结构与任务状态一目了然</span>
                </div>
                <span>{{ storyTaskCount }} 个 task</span>
              </div>

              <div v-if="selectedStoryPathData?.milestones?.length" class="path-map-grid">
                <article v-for="(milestone, milestoneIndex) in selectedStoryPathData.milestones" :key="milestone.id || milestoneIndex" class="path-milestone-card">
                  <div class="path-milestone-card__head">
                    <div>
                      <span class="path-milestone-card__eyebrow">Stage {{ milestone.stageNumber || milestoneIndex + 1 }}</span>
                      <strong>{{ milestone.title || milestone.name || `阶段 ${milestoneIndex + 1}` }}</strong>
                    </div>
                    <span class="path-milestone-card__meta">{{ (milestone.subtasks || []).length }} 个 task</span>
                  </div>
                  <p>{{ milestone.description || milestone.summary || milestone.goal || '该阶段暂无额外说明。' }}</p>
                  <div class="path-task-list">
                    <article
                      v-for="(task, taskIndex) in milestone.subtasks || []"
                      :key="task.id || `${milestoneIndex}-${taskIndex}`"
                      class="path-task-chip"
                      :class="{
                        'path-task-chip--current': task.id === selectedStoryCurrentTaskId,
                        'path-task-chip--runnable': canStartPathTask(task),
                        'path-task-chip--locked': !canStartPathTask(task) && task.id !== selectedStoryCurrentTaskId
                      }"
                    >
                      <div class="path-task-chip__head">
                        <strong>{{ task.title || task.name || `Task ${taskIndex + 1}` }}</strong>
                        <span>{{ task.status || 'unknown' }}</span>
                      </div>
                      <p>{{ task.description || task.summary || task.objective || '暂无任务描述。' }}</p>
                      <div class="path-task-chip__actions">
                        <el-button
                          v-if="task.status === 'completed'"
                          size="small"
                          disabled
                        >
                          已完成
                        </el-button>
                        <el-button
                          v-else
                          size="small"
                          type="primary"
                          :loading="learningStartLoading && pendingLearningTaskId === task.id"
                          :disabled="!canStartPathTask(task) || !selectedStorySession?.bindings?.learningPathId"
                          @click="startLearningFor(selectedStorySession, task.id)"
                        >
                          {{ getPathTaskActionLabel(task) }}
                        </el-button>
                      </div>
                    </article>
                  </div>
                </article>
              </div>

              <div v-else class="empty-box empty-box--inline">还没有可视化路径，先生成 Path。</div>
            </section>

            <section class="detail-block detail-block--path-review">
              <div class="detail-block__head detail-block__head--dialogue">
                <div>
                  <strong>虚拟学习者对 Path 的自然反应</strong>
                  <span>这里只展示学习者实际会怎么回应，以及他明确提出的修改点。</span>
                </div>
                <span>{{ pathReviewDecisionLabel }}</span>
              </div>

              <div v-if="selectedStoryPathReview" class="path-review-grid">
                <article class="path-review-card">
                  <span>当前反应</span>
                  <strong>{{ pathReviewDecisionLabel }}</strong>
                  <em>{{ pathReviewSignalLabel }}</em>
                </article>
                <article class="path-review-card path-review-card--wide">
                  <span>学习者自然反应</span>
                  <strong>{{ pathReviewReactionText }}</strong>
                  <em>{{ pathReviewModifyLabel }}</em>
                </article>
              </div>

              <div v-else class="empty-box empty-box--inline">当前还没有 Path 接受评估记录。生成 Path 后会在这里展示是否接受这版方案。</div>
            </section>

          </template>

          <template v-else>
            <section class="learn-cockpit">
              <div class="stage-card stage-card--learn">
                <div class="stage-card__head" :class="{ 'stage-card__head--embedded': embedded }">
                  <div>
                    <span class="stage-card__eyebrow">Learn</span>
                    <strong>{{ selectedStoryLearnStatusLabel }}</strong>
                  </div>
                  <div class="stage-card__head-actions">
                    <span v-if="!embedded" class="stage-card__meta">{{ currentLearningMilestoneDisplay }}</span>
                    <div class="stage-card__actions learn-command-bar" :class="{ 'stage-card__actions--embedded': embedded }">
                     <el-button size="small" type="primary" plain :disabled="!selectedStorySession?.bindings?.currentTaskId" @click="openDebugLearnFor(selectedStorySession)">看 Learn 对话</el-button>
                     <el-button size="small" type="primary" :disabled="!previousStoryTaskOption" :loading="learningStartLoading && pendingLearningTaskId === previousStoryTaskOption?.id" @click="switchLearningTask('previous')">上一个</el-button>
                     <el-button size="small" type="primary" :disabled="!nextStoryTaskOption" :loading="learningStartLoading && pendingLearningTaskId === nextStoryTaskOption?.id" @click="switchLearningTask('next')">下一个</el-button>
                     <el-button size="small" :disabled="!canRunLearningForSelectedStory" :loading="learningStepLoading" @click="runLearningStepFor(selectedStorySession)">手动学</el-button>
                     <el-button size="small" :disabled="!canRunLearningForSelectedStory" :loading="autoLearningLoading" @click="runLearningAutoFor(selectedStorySession)">自动学</el-button>
                     <el-button size="small" type="warning" plain :disabled="!canStopLearningForSelectedStory" :loading="stopLearningLoading" @click="stopLearningFor(selectedStorySession)">紧急停止</el-button>
                     <el-button size="small" type="danger" plain :loading="restartLoading" @click="restartStoryLearning">重新开始当前学习任务</el-button>
                    </div>
                  </div>
                </div>
                <p v-if="!embedded">{{ selectedStoryLearnHint }}</p>
              </div>

              <div class="learn-main-grid">
                <section v-if="learnWrapupSummary" class="detail-block detail-block--learn-evaluation">
                  <div class="detail-block__head detail-block__head--dialogue">
                    <div>
                      <strong>当堂评估</strong>
                      <span>{{ learnWrapupSummary.status }}</span>
                    </div>
                    <span>{{ learnWrapupSummary.duration }}</span>
                  </div>
                  <div class="path-review-grid">
                    <article class="path-review-card path-review-card--wide">
                      <span>课程总结</span>
                      <strong>{{ learnWrapupSummary.topicSummary }}</strong>
                      <em>{{ learnWrapupSummary.evaluation }}</em>
                    </article>
                    <article class="path-review-card">
                      <span>评估来源</span>
                      <strong>{{ learnWrapupSummary.evaluationSource }}</strong>
                      <em>{{ learnWrapupSummary.summarySource }}</em>
                    </article>
                    <article v-if="learnAdvisorySummary" class="path-review-card">
                      <span>后续建议</span>
                      <strong>{{ learnAdvisorySummary.recommendation }}</strong>
                      <em>{{ learnAdvisorySummary.priority }}</em>
                    </article>
                  </div>
                </section>

                <section class="detail-block detail-block--dialogue detail-block--learn-dialogue">
                  <div class="detail-block__head detail-block__head--dialogue">
                    <div class="goal-dialogue-title">
                      <strong>Learn 对话</strong>
                      <em v-if="!embedded">每轮展示学习者回应、教学反馈和知识点推进</em>
                    </div>
                    <span v-if="!embedded">{{ learnConversationRounds.length }} 轮</span>
                  </div>
                  <div v-if="learnConversationRounds.length" class="dialogue-list dialogue-list--goal">
                <article
                  v-for="(message, index) in learnConversationRounds"
                  :key="`learn-${index}`"
                  class="dialogue-row dialogue-row--goal dialogue-row--learn-round"
                >
                  <div class="dialogue-row__meta">
                    <span class="dialogue-round-pill">第 {{ message.round }} 轮</span>
                    <span v-if="message.isOpening" class="dialogue-opening-pill">学习开始</span>
                  </div>
                  <div class="learn-round-layout">
                    <div class="learn-round-conversation">
                      <div class="goal-round-bubble goal-round-bubble--learner">
                      <div class="goal-round-bubble__head">
                        <strong>{{ message.learnerLabel }}</strong>
                        <span class="dialogue-side-pill dialogue-side-pill--learner">reply</span>
                      </div>
                      <div class="goal-round-signals">
                        <span class="goal-round-signal"><em>任务</em><strong>{{ message.learnerSignals.task }}</strong></span>
                        <span class="goal-round-signal"><em>里程碑</em><strong>{{ message.learnerSignals.milestone }}</strong></span>
                        <span class="goal-round-signal"><em>情绪</em><strong>{{ message.learnerSignals.emotion }}</strong></span>
                      </div>
                      <p>{{ message.learnerText }}</p>
                      </div>

                      <div class="goal-round-bubble goal-round-bubble--agent">
                      <div class="goal-round-bubble__head">
                        <strong>{{ message.agentLabel }}</strong>
                        <span class="dialogue-side-pill dialogue-side-pill--agent">response</span>
                      </div>
                      <div class="goal-round-signals goal-round-signals--agent">
                        <span class="goal-round-signal"><em>完成态</em><strong>{{ message.agentSignals.completion }}</strong></span>
                        <span class="goal-round-signal"><em>认知层级</em><strong>{{ message.agentSignals.cognitiveLevel }}</strong></span>
                        <span class="goal-round-signal"><em>知识点</em><strong>{{ message.agentSignals.knowledge }}</strong></span>
                      </div>
                      <p>{{ message.agentText }}</p>
                      <div v-if="message.agentSignals.strategies.length" class="learn-chip-list">
                        <span v-for="item in message.agentSignals.strategies" :key="`${message.round}-${item}`" class="learn-chip">{{ item }}</span>
                      </div>
                      </div>
                    </div>

                    <aside class="learn-round-knowledge" v-if="message.agentSignals.knowledgePoints.length">
                      <div class="learn-round-knowledge__head">
                        <strong>本轮知识点进度</strong>
                        <span>{{ message.agentSignals.knowledgePoints.length }} 项</span>
                      </div>
                      <div class="knowledge-inline-list">
                        <article
                          v-for="point in message.agentSignals.knowledgePoints"
                          :key="`${message.round}-${point.name}`"
                          class="knowledge-inline-item"
                        >
                          <div class="knowledge-inline-item__head">
                            <strong>{{ point.name }}</strong>
                            <span>{{ point.statusLabel }}</span>
                          </div>
                          <el-progress :percentage="point.progressPercent" :stroke-width="8" :show-text="false" />
                        </article>
                      </div>
                    </aside>
                  </div>
                </article>
                  </div>
                  <div v-else class="empty-box empty-box--inline">暂无 Learn 对话</div>
                </section>
              </div>
            </section>
          </template>
        </section>

        <aside v-if="!embedded" class="panel-card story-stage-side-panel" :class="{ 'story-stage-side-panel--goal': stage === 'goal', 'story-stage-side-panel--compact': stage !== 'goal' }">
          <div class="section-head section-head--compact">
            <div>
              <span class="section-head__eyebrow">Story Context</span>
              <h3>这个故事的上下文</h3>
            </div>
          </div>

          <div class="context-stack">
            <article class="context-card">
              <span>触发事件</span>
              <strong>{{ selectedStorySummary.storyTriggerEvent || '暂无触发事件' }}</strong>
            </article>
            <article class="context-card">
              <span>自然开场</span>
              <p>{{ selectedStorySummary.visibleOpening || '暂无自然开场' }}</p>
            </article>
            <article class="context-card">
              <span>压力点</span>
              <div v-if="storyPressurePoints.length" class="pressure-list">
                <span v-for="item in storyPressurePoints" :key="item" class="pressure-chip">{{ item }}</span>
              </div>
              <p v-else>当前没有标注压力点。</p>
            </article>
          </div>
        </aside>
      </section>

      <section v-if="!embedded" class="panel-card">
        <div class="section-head">
          <div>
            <span class="section-head__eyebrow">Session History</span>
            <h3>{{ stageHistoryTitle }}</h3>
          </div>
          <div class="section-head__meta">{{ stageSessions.length }} 条</div>
        </div>
        <div v-if="stageSessions.length" class="session-list">
          <article v-for="session in stageSessions" :key="session.id" class="session-card" :class="{ active: selectedStorySession?.id === session.id }">
            <div>
              <strong>{{ getSessionStatusLabel(session.status) }} / {{ getSessionStageLabel(session.currentStage) }}</strong>
              <p>{{ session.storyContext?.triggerEvent || selectedStorySummary.storyTriggerEvent || '暂无触发事件' }}</p>
            </div>
            <div class="session-card__actions">
              <span>{{ formatRelativeTime(session.updatedAt) }}</span>
              <el-button size="small" @click="openSessionInspector(session.id)">进入诊断</el-button>
            </div>
          </article>
        </div>
        <div v-else class="empty-box">这个阶段还没有相关历史运行。</div>
      </section>
    </main>

    <div v-else class="empty-box empty-box--full">未找到这个故事。请回到学习者面板重新选择。</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft } from '@element-plus/icons-vue'
import { adminApi } from '@/api/adminApi'
import { setProjectionToken } from '@/utils/projection'

const props = withDefaults(defineProps<{
  stage: 'goal' | 'path' | 'learn'
  embedded?: boolean
}>(), {
  embedded: false
})

const emit = defineEmits<{
  refresh: []
}>()

const embedded = props.embedded

const router = useRouter()
const route = useRoute()

const profileId = route.params.profileId as string
const storyId = route.params.storyId as string

const loading = ref(false)
const stepLoading = ref(false)
const autoLoading = ref(false)
const advanceLoading = ref(false)
const learningStartLoading = ref(false)
const learningStepLoading = ref(false)
const autoLearningLoading = ref(false)
const stopLearningLoading = ref(false)
const restartLoading = ref(false)
const pendingLearningTaskId = ref<string | null>(null)
let goalRefreshTimer: ReturnType<typeof setTimeout> | null = null
let pathRefreshTimer: ReturnType<typeof setTimeout> | null = null
let learnRefreshTimer: ReturnType<typeof setTimeout> | null = null

const profileData = ref<any>(null)
const sessions = ref<any[]>([])
const storySummaries = ref<any[]>([])
const selectedStoryTaskId = ref<string | null>(null)

const buildLearnStoryQuery = (taskId?: string | null) => {
  const query: Record<string, string> = {}
  if (taskId) {
    query.taskId = taskId
  }
  return query
}

const syncLearnTaskSelection = async (taskId?: string | null, navigationMode: 'replace' | 'push' = 'replace') => {
  selectedStoryTaskId.value = taskId || null
  const nextQuery = {
    ...route.query,
    ...buildLearnStoryQuery(taskId || null)
  }

  if (navigationMode === 'push') {
    await router.push({
      path: `/admin/virtual-learners/${profileId}/stories/${storyId}/learn`,
      query: nextQuery
    })
    return
  }

  await router.replace({ query: nextQuery })
}
const selectedStoryPathStatus = ref('idle')
const selectedStoryPathData = ref<any | null>(null)
const goalConversationData = ref<any | null>(null)
const teachingDetailData = ref<any | null>(null)

const normalizeSession = (session: any) => {
  const runtime = session?.runtime || {}
  const bindings = runtime.bindings || session?.bindings || {}
  const goalRuntime = runtime.stageStatus?.goal || {}
  const learningRuntime = runtime.stageStatus?.learning || {}
  const learnerStateRuntime = runtime.learnerState || {}
  const knowledgeStateRuntime = runtime.knowledgeState || {}

  return {
    ...session,
    runtime,
    bindings,
    storyContext: session?.storyContext || runtime.story || null,
    goalStage: session?.goalStage || goalRuntime.stage || null,
    learnerState: session?.learnerState || learnerStateRuntime.goal || goalRuntime.learnerState || null,
    knowledgeState: session?.knowledgeState || knowledgeStateRuntime.learning?.knowledgePoints || learningRuntime.knowledgeState || [],
    currentTaskTitle: session?.currentTaskTitle || learningRuntime.currentTaskTitle || null,
    currentMilestoneTitle: session?.currentMilestoneTitle || learningRuntime.currentMilestoneTitle || null,
    conversations: session?.conversations || { goal: { messages: [] }, learning: { messages: [] } },
    stageResults: session?.stageResults || {},
  }
}

const normalizeSessions = (items: any[]) => Array.isArray(items) ? items.map(normalizeSession) : []
const shortId = (value?: string | null) => value ? value.slice(0, 8) : '--'

const upsertSession = (session: any) => {
  if (!session?.id) return
  const normalized = normalizeSession(session)
  const index = sessions.value.findIndex((item: any) => item.id === normalized.id)
  if (index >= 0) {
    sessions.value = sessions.value.map((item: any) => item.id === normalized.id ? normalized : item)
  } else {
    sessions.value = [normalized, ...sessions.value]
  }
}

const refreshSessionDetail = async (sessionId?: string | null) => {
  if (!sessionId) return
  try {
    const res = await adminApi.getVirtualSession(sessionId)
    if (res.data?.success && res.data.data) {
      upsertSession(res.data.data)
    }
  } catch {
    // 详情补拉失败不阻断主刷新；profile 摘要仍可作为兜底。
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

const selectedStorySession = computed(() => {
  const story = selectedStorySummary.value
  if (!story) return null
  if (story.latestRun?.sessionId) {
    const byId = sessions.value.find((item: any) => item.id === story.latestRun.sessionId)
    if (byId) return byId
  }
  if (story.storyId) {
    const relatedSessions = sessions.value.filter((item: any) => item.storyContext?.storyId === story.storyId)
    const latestRelatedSession = [...relatedSessions].sort((a: any, b: any) => {
      const aTime = new Date(a?.updatedAt || a?.createdAt || 0).getTime()
      const bTime = new Date(b?.updatedAt || b?.createdAt || 0).getTime()
      return bTime - aTime
    })[0]
    return latestRelatedSession
      || relatedSessions.find((item: any) => item.bindings?.goalConversationId)
      || relatedSessions[0]
      || null
  }
  return null
})

const storySessions = computed(() => {
  const story = selectedStorySummary.value
  if (!story?.storyId) return []
  return sessions.value.filter((item: any) => item.storyContext?.storyId === story.storyId)
})

const stageSessions = computed(() => {
  switch (props.stage) {
    case 'goal':
      return storySessions.value.filter((item: any) => item.currentStage === 'goal' || item.bindings?.goalConversationId)
    case 'path':
      return storySessions.value.filter((item: any) => item.currentStage === 'path' || item.bindings?.learningPathId)
    case 'learn':
      return storySessions.value.filter((item: any) => item.currentStage === 'learning' || item.bindings?.currentTaskId)
    default:
      return storySessions.value
  }
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

const selectedStoryTaskIndex = computed(() => {
  const activeTaskId = selectedStoryTaskId.value || selectedStoryCurrentTaskId.value
  if (!activeTaskId) return -1
  return selectedStoryTaskOptions.value.findIndex((item: any) => item.id === activeTaskId)
})

const previousStoryTaskOption = computed(() => {
  const index = selectedStoryTaskIndex.value
  if (index <= 0) return null
  const candidate = selectedStoryTaskOptions.value[index - 1]
  return candidate?.canStart ? candidate : null
})

const nextStoryTaskOption = computed(() => {
  const index = selectedStoryTaskIndex.value
  if (index < 0 || index >= selectedStoryTaskOptions.value.length - 1) return null
  const candidate = selectedStoryTaskOptions.value[index + 1]
  return candidate?.canStart ? candidate : null
})

const getPreferredLearningTaskId = () => {
  const currentSelected = selectedStoryTaskId.value
  const currentTaskId = selectedStoryCurrentTaskId.value

  if (currentSelected && selectedStoryTaskOptions.value.some((item: any) => item.id === currentSelected && item.canStart)) {
    return currentSelected
  }

  if (currentTaskId && selectedStoryTaskOptions.value.some((item: any) => item.id === currentTaskId)) {
    return currentTaskId
  }

  return selectedStoryTaskOptions.value.find((item: any) => item.canStart)?.id || selectedStoryTaskOptions.value[0]?.id || undefined
}

const canStartPathTask = (task: any) => {
  if (!task) return false
  if (task.id === selectedStoryCurrentTaskId.value) return true
  const status = String(task.status || '').toLowerCase()
  return ['active', 'ready', 'todo', 'in_progress'].includes(status)
}

const getPathTaskActionLabel = (task: any) => {
  if (!task) return '开始学习'
  if (task.status === 'completed') return '已完成'
  return task.status === 'in_progress' ? '继续学习' : '开始学习'
}

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
    return '等待 Goal 完成'
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

const selectedStoryPathTitle = computed(() => {
  const path = selectedStoryPathData.value
  return path?.title || path?.name || path?.subject || '当前学习路径'
})

const selectedStoryPathNarrative = computed(() => {
  const path = selectedStoryPathData.value
  return path?.description || path?.summary || path?.aiPromptTemplate || selectedStoryPathHint.value
})

const selectedStoryPathReview = computed(() => selectedStorySession.value?.runtime?.stageStatus?.path?.review || null)

const pathReviewDecisionLabel = computed(() => {
  if ((selectedStoryPathReview.value?.visibleRequestedChanges || []).length) return '提出了明确修改点'
  if (selectedStoryPathReview.value?.reaction) return '已给出反应'
  return '待评估'
})

const pathReviewReactionText = computed(() => selectedStoryPathReview.value?.reaction || '暂无自然反应记录')
const pathReviewModifyLabel = computed(() => {
  const changes = Array.isArray(selectedStoryPathReview.value?.visibleRequestedChanges)
    ? selectedStoryPathReview.value.visibleRequestedChanges.filter((item: any) => typeof item === 'string' && item.trim())
    : []
  return changes.length ? changes.join('；') : '当前没有明确提出修改点'
})
const pathReviewSignalLabel = computed(() => Array.isArray(selectedStoryPathReview.value?.visibleRequestedChanges) && selectedStoryPathReview.value.visibleRequestedChanges.length
  ? `${selectedStoryPathReview.value.visibleRequestedChanges.length} 个可见修改点`
  : '以学习者自然表达为准')

const selectedStoryPathHint = computed(() => {
  if (!selectedStorySession.value) return '这个故事还没有对应运行，先从这个故事启动 Goal。'
  if (!selectedStorySession.value.bindings?.learningPathId) return 'Goal 完成后，在这里生成 Path，并挑一个 task 进入 Learn。'
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
  if (learnWrapupSummary.value) return '已结束评估'
  if (teachingDetailData.value?.state?.classroomContext?.stage?.current === 'ready_to_close') return '可结束'
  if (!session?.bindings?.currentTaskId) return session?.currentStage === 'learning' ? '已进入学习' : '未开始'
  return session.currentStage === 'learning' ? '学习进行中' : '已选定 task'
})

const selectedStoryLearnHint = computed(() => {
  if (!selectedStorySession.value?.bindings?.learningPathId) return '先生成 Path，再从 task 开始 Learn。'
  if (!selectedStorySession.value?.bindings?.currentTaskId) return '可以先选一个 task，再让虚拟学习者开始学。'
  return 'Learn 阶段支持手动学或自动学，且可以直接查看该 task 的对话。'
})

const selectedStoryLearningState = computed(() => {
  return selectedStorySession.value?.runtime?.stageStatus?.learning || selectedStorySession.value?.stageResults?.learning || {}
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
const canStopLearningForSelectedStory = computed(() => !!selectedStorySession.value && selectedStorySession.value.currentStage === 'learning' && selectedStorySession.value.status !== 'failed')

const storyTaskCount = computed(() => selectedStoryTaskOptions.value.length)
const storyPressurePoints = computed(() => {
  const points = selectedStorySummary.value?.pressurePoints
  return Array.isArray(points) ? points.filter((item: any) => typeof item === 'string' && item.trim()) : []
})

const goalConversationPreview = computed(() => {
  const messages = goalConversationData.value?.messages || selectedStorySession.value?.conversations?.goal?.messages
  return Array.isArray(messages) ? messages.slice(-10) : []
})

const goalConversationStageLabel = computed(() => {
  const stage = selectedStorySession.value?.runtime?.stageStatus?.goal?.stage
    || goalConversationData.value?.stage
    || selectedStorySession.value?.goalStage
    || 'understanding'
  switch (stage) {
    case 'understanding': return '问题理解'
    case 'probing': return '继续追问'
    case 'proposal': return '提出方案'
    case 'ready': return '准备生成路径'
    case 'completed': return '已完成'
    default: return stage
  }
})

const formatBool = (value?: boolean) => value === true ? 'true' : value === false ? 'false' : '--'
const formatUnit = (value?: number) => typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(2)) : '--'
const clampProgress = (value: any) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  const normalized = value <= 1 ? value * 100 : value
  return Math.max(0, Math.min(100, Math.round(normalized)))
}
const getKnowledgeStatusLabel = (status?: string) => {
  switch (status) {
    case 'mastered': return '已掌握'
    case 'learning': return '学习中'
    case 'review': return '待复习'
    case 'pending': return '未开始'
    default: return status || '未知'
  }
}
const getKnowledgeProgressStatus = (status?: string) => {
  switch (status) {
    case 'mastered': return 'success'
    case 'review': return 'warning'
    case 'learning': return undefined
    default: return undefined
  }
}
const normalizeKnowledgePoints = (points: any[]) => {
  return points
    .filter((item: any) => item && typeof item.name === 'string' && item.name.trim())
    .map((item: any) => {
      const progressPercent = clampProgress(item.progress)
      return {
        name: item.name,
        status: item.status || 'pending',
        statusLabel: getKnowledgeStatusLabel(item.status),
        progressPercent,
        progressLabel: `${progressPercent}%`,
        progressStatus: getKnowledgeProgressStatus(item.status)
      }
    })
}

const goalConversationRounds = computed(() => {
  const projectedMessages = selectedStorySession.value?.conversations?.goal?.messages
  if (Array.isArray(projectedMessages) && projectedMessages.length) {
    const rounds: any[] = []
    let pendingLearner: any = null
    let round = 0

    for (const message of projectedMessages) {
      if (message.role === 'user') {
        pendingLearner = message
        continue
      }

      if (message.role === 'assistant') {
        if (pendingLearner) {
          round += 1
          rounds.push({
            round,
            isOpening: round === 1 && rounds.length === 0,
            learnerText: pendingLearner.content || '--',
            agentText: message.content || '--',
            learnerSignals: {
              understandingLevel: String(formatUnit(learnerStateSnapshot.value?.understandingLevel)),
              goalReadiness: String(formatUnit(learnerStateSnapshot.value?.goalReadiness)),
              wantsClarification: formatBool(learnerStateSnapshot.value?.wantsClarification),
              readyToAdvance: formatBool(learnerStateSnapshot.value?.readyToAdvance)
            },
            agentSignals: {
              stage: String(goalConversationStageCode.value),
              confidence: '--',
              done: ['ready', 'completed'].includes(String(goalConversationStageCode.value || '')) ? 'true' : 'false'
            }
          })
          pendingLearner = null
          continue
        }

        rounds.push({
          round: 0,
          isOpening: true,
          learnerText: '--',
          agentText: message.content || '--',
          learnerSignals: {
            understandingLevel: '--',
            goalReadiness: '--',
            wantsClarification: '--',
            readyToAdvance: '--'
          },
          agentSignals: {
            stage: String(goalConversationStageCode.value),
            confidence: '--',
            done: ['ready', 'completed'].includes(String(goalConversationStageCode.value || '')) ? 'true' : 'false'
          }
        })
      }
    }

    return rounds.filter((item) => item.learnerText !== '--' || item.agentText !== '--')
  }

  const logs = Array.isArray(selectedStorySession.value?.logs) ? selectedStorySession.value.logs : []
  const virtualReplies = logs.filter((log: any) => log?.phase === 'virtual-reply')
  const goalResponses = logs.filter((log: any) => log?.phase === 'goal-response')
  const total = Math.max(virtualReplies.length, goalResponses.length)

  return Array.from({ length: total }, (_, index) => {
    const learnerLog = virtualReplies[index]
    const agentLog = goalResponses[index]
    const learnerOutput = learnerLog?.details?.output || {}
    const agentOutput = agentLog?.details?.output || {}
    const learnerState = learnerOutput?.learnerState || {}

    return {
      round: index + 1,
      isOpening: !!learnerOutput?.opening,
      learnerText: learnerOutput?.reply || '--',
      agentText: agentOutput?.userVisible || '--',
      learnerSignals: {
        understandingLevel: String(formatUnit(learnerState?.understandingLevel)),
        goalReadiness: String(formatUnit(learnerState?.goalReadiness)),
        wantsClarification: formatBool(learnerState?.wantsClarification),
        readyToAdvance: formatBool(learnerState?.readyToAdvance)
      },
      agentSignals: {
        stage: String(agentOutput?.stage || goalConversationStageCode.value),
        confidence: String(formatUnit(agentOutput?.confidence)),
        done: ['ready', 'completed'].includes(String(agentOutput?.stage || '')) ? 'true' : 'false'
      }
    }
  })
})

const learnerStateSnapshot = computed(() => selectedStorySession.value?.runtime?.learnerState?.goal || selectedStorySession.value?.runtime?.stageStatus?.goal?.learnerState || selectedStorySession.value?.learnerState || null)

const goalConversationStageCode = computed(() => selectedStorySession.value?.runtime?.stageStatus?.goal?.stage || selectedStorySession.value?.goalStage || goalConversationData.value?.stage || 'understanding')

const toPercentLabel = (value?: number | null) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
  return `${Math.round(value * 100)}%`
}

const learnerUnderstandingDisplay = computed(() => toPercentLabel(learnerStateSnapshot.value?.understandingLevel))
const learnerGoalReadinessDisplay = computed(() => toPercentLabel(learnerStateSnapshot.value?.goalReadiness))
const learnerEmotionDisplay = computed(() => {
  const emotion = learnerStateSnapshot.value?.emotion
  switch (emotion) {
    case 'neutral': return '情绪平稳'
    case 'slightly_frustrated': return '轻度受挫'
    case 'happy': return '较积极'
    case 'confident': return '较自信'
    case 'confused': return '仍有困惑'
    default: return '无显式情绪'
  }
})

const learnerClarificationDisplay = computed(() => {
  const wantsClarification = learnerStateSnapshot.value?.wantsClarification
  if (wantsClarification === true) return '仍想追问'
  if (wantsClarification === false) return '不再追问'
  return '追问倾向未知'
})

const learnerAdvanceDisplay = computed(() => {
  const readyToAdvance = learnerStateSnapshot.value?.readyToAdvance
  if (readyToAdvance === true) return '可推进'
  if (readyToAdvance === false) return '暂不推进'
  return '推进判断未知'
})

const learnerUnknownsDisplay = computed(() => {
  const unknowns = learnerStateSnapshot.value?.remainingUnknowns
  if (Array.isArray(unknowns) && unknowns.length) {
    return `待澄清：${unknowns.slice(0, 2).join('、')}`
  }
  return '无显式待澄清项'
})

const learnConversationPreview = computed(() => {
  const messages = selectedStorySession.value?.conversations?.learning?.messages || []
  return messages.slice(-10).map((message: any) => ({
    roleLabel: message.role === 'assistant' ? '系统' : '学习者',
    text: getDialoguePreviewText(message)
  }))
})

const currentLearningMilestoneDisplay = computed(() => selectedStorySession.value?.runtime?.stageStatus?.learning?.currentMilestoneTitle || selectedStorySession.value?.currentMilestoneTitle || selectedStoryLearningState.value?.currentMilestoneTitle || '未开始')
const currentLearningTaskDisplay = computed(() => selectedStorySession.value?.runtime?.stageStatus?.learning?.currentTaskTitle || selectedStorySession.value?.currentTaskTitle || selectedStoryLearningState.value?.currentTaskTitle || '暂无 task')
const teachingSessionShortId = computed(() => shortId(selectedStorySession.value?.bindings?.teachingSessionId))
const teachingSessionStatusDisplay = computed(() => selectedStorySession.value?.bindings?.teachingSessionId ? '已接管' : '未接管')
const learningProgressDisplay = computed(() => {
  const currentMilestone = selectedStoryLearningState.value?.currentMilestone
  const totalMilestones = selectedStoryLearningState.value?.totalMilestones
  if (typeof currentMilestone === 'number' && typeof totalMilestones === 'number' && totalMilestones > 0) {
    return `${Math.min(currentMilestone + 1, totalMilestones)}/${totalMilestones}`
  }
  return '进度未知'
})
const completedTaskDisplay = computed(() => {
  const completed = Number(selectedStorySession.value?.completedTasks || 0)
  const totalFromSession = Number(selectedStorySession.value?.totalTasks || 0)
  const totalFromPath = selectedStoryTaskOptions.value.length
  const total = totalFromPath > 0 ? totalFromPath : totalFromSession
  return `${completed} / ${total} tasks`
})
const learningStopStateDisplay = computed(() => selectedStoryLearningState.value?.manualStop ? '已停止' : '运行中')
const learningStopReasonDisplay = computed(() => selectedStoryLearningState.value?.stoppedReason || '无')
const currentKnowledgePoints = computed(() => {
  const points = selectedStorySession.value?.runtime?.knowledgeState?.learning?.knowledgePoints
    || selectedStorySession.value?.runtime?.stageStatus?.learning?.knowledgeState
    || selectedStorySession.value?.knowledgeState
  return Array.isArray(points) ? normalizeKnowledgePoints(points) : []
})
const currentKnowledgePointDisplay = computed(() => currentKnowledgePoints.value[0]?.name || '暂无知识点')
const latestLearningResponseOutput = computed(() => {
  return {
    currentState: selectedStorySession.value?.runtime?.knowledgeState?.learning?.currentState || selectedStorySession.value?.runtime?.stageStatus?.learning?.currentState || null,
    knowledgePoint: selectedStorySession.value?.runtime?.knowledgeState?.learning?.latestKnowledgePoint || selectedStorySession.value?.runtime?.stageStatus?.learning?.latestKnowledgePoint || null,
    strategies: [],
  }
})
const learningStateMetricCards = computed(() => {
  const currentState = latestLearningResponseOutput.value?.currentState || {}
  const items = [
    { label: '理解负荷', key: 'lss' },
    { label: '知识迁移', key: 'ktl' },
    { label: '学习疲劳', key: 'lf' },
    { label: '稳定性', key: 'lsb' }
  ]

  return items.map((item) => ({
    label: item.label,
    value: typeof currentState?.[item.key] === 'number' ? String(Number(currentState[item.key].toFixed(1))) : '--'
  }))
})
const latestStrategyDisplay = computed(() => {
  const strategies = latestLearningResponseOutput.value?.strategies
  if (!Array.isArray(strategies) || !strategies.length) return '暂无策略'
  return strategies.slice(0, 2).join(' / ')
})
const learnWrapupSummary = computed(() => {
  const wrapup = teachingDetailData.value?.wrapup
  if (!wrapup) return null
  return {
    status: wrapup?.status || '已结束',
    duration: typeof wrapup?.duration === 'number' ? `${wrapup.duration} 分钟` : '时长未知',
    topicSummary: wrapup?.summary?.topicSummary || '本节学习已结束',
    evaluation: wrapup?.evaluation?.learningEvaluation || wrapup?.summary?.nextFocus || '已生成课堂总结',
    summarySource: wrapup?.summarySource || wrapup?.sources?.summary || 'summary',
    evaluationSource: wrapup?.evaluationSource || wrapup?.sources?.evaluation || 'evaluation'
  }
})
const learnAdvisorySummary = computed(() => {
  const advisory = teachingDetailData.value?.advisory
  if (!advisory?.shouldSuggest) return null
  return {
    recommendation: advisory.recommendation || advisory.ui?.title || '建议查看后续调整',
    priority: advisory.priority || 'normal'
  }
})

const learnConversationRounds = computed(() => {
  const projectedRounds = selectedStorySession.value?.conversations?.learning?.rounds
  if (Array.isArray(projectedRounds) && projectedRounds.length) {
    return projectedRounds.map((item: any) => {
      const knowledgePoints = Array.isArray(item?.knowledgePoints)
        ? normalizeKnowledgePoints(item.knowledgePoints)
        : []
      const strategies = Array.isArray(item?.strategies)
        ? item.strategies.filter((entry: any) => typeof entry === 'string' && entry.trim()).slice(0, 4)
        : []

      return {
        round: typeof item?.round === 'number' ? item.round : 0,
        isOpening: !!item?.isOpening,
        learnerLabel: item?.isOpening ? '系统开场' : '虚拟学习者',
        learnerText: item?.learnerMessage?.content || item?.assistantMessage?.content || '--',
        learnerSignals: {
          task: String(item?.currentTask || '--'),
          milestone: String(item?.currentMilestone || '--'),
          emotion: String(item?.emotion || '--')
        },
        agentLabel: '教学系统',
        agentText: item?.assistantMessage?.content || '--',
        agentSignals: {
          completion: item?.autoEnded ? '已结束评估' : item?.isCompletion ? '可结束' : '继续',
          cognitiveLevel: String(item?.cognitiveLevel || '--'),
          knowledge: String(knowledgePoints[0]?.name || item?.knowledgePoint || '--'),
          strategies,
          knowledgePoints
        }
      }
    })
  }

  const projectedMessages = selectedStorySession.value?.conversations?.learning?.messages
  if (Array.isArray(projectedMessages) && projectedMessages.length) {
    const rounds: any[] = []
    let pendingLearner: any = null
    let openingConsumed = false
    let round = 0

    for (const message of projectedMessages) {
      if (message.role === 'assistant' && !openingConsumed) {
        openingConsumed = true
        rounds.push({
          round: 0,
          isOpening: true,
          learnerLabel: '系统开场',
          learnerText: message.content || '学习已开始',
          learnerSignals: {
            task: String(currentLearningTaskDisplay.value || '--'),
            milestone: String(currentLearningMilestoneDisplay.value || '--'),
            emotion: '--'
          },
          agentLabel: '教学系统',
          agentText: message.content || '已进入学习阶段',
          agentSignals: {
            completion: '继续',
            cognitiveLevel: '--',
            knowledge: currentKnowledgePointDisplay.value || '--',
            strategies: [],
            knowledgePoints: []
          }
        })
        continue
      }

      if (message.role === 'user') {
        pendingLearner = message
        continue
      }

      if (message.role === 'assistant' && pendingLearner) {
        round += 1
        rounds.push({
          round,
          isOpening: false,
          learnerLabel: '虚拟学习者',
          learnerText: pendingLearner.content || '--',
          learnerSignals: {
            task: String(currentLearningTaskDisplay.value || '--'),
            milestone: String(currentLearningMilestoneDisplay.value || '--'),
            emotion: String(selectedStorySession.value?.runtime?.learnerState?.learning?.emotion || '--')
          },
          agentLabel: '教学系统',
          agentText: message.content || '--',
          agentSignals: {
            completion: '继续',
            cognitiveLevel: '--',
            knowledge: String(currentKnowledgePointDisplay.value || '--'),
            strategies: [],
            knowledgePoints: []
          }
        })
        pendingLearner = null
      }
    }

    return rounds
  }

  const logs = Array.isArray(selectedStorySession.value?.logs) ? selectedStorySession.value.logs : []
  const startLogs = logs.filter((log: any) => log?.phase === 'learning-start')
  const learnerLogs = logs.filter((log: any) => log?.phase === 'learning-reply')
  const responseLogs = logs.filter((log: any) => log?.phase === 'learning-response')
  const rounds: any[] = []

  if (startLogs[0]) {
    const output = startLogs[0]?.details?.output || {}
    rounds.push({
      round: 0,
      isOpening: true,
      learnerLabel: '系统开场',
      learnerText: output.welcomeMessage || output.currentTask || '学习已开始',
      learnerSignals: {
        task: String(output.currentTask || '--'),
        milestone: String(output.currentMilestone || '--'),
        emotion: '--'
      },
      agentLabel: '教学系统',
      agentText: output.welcomeMessage || '已进入学习阶段',
      agentSignals: {
        completion: '继续',
        cognitiveLevel: '--',
        knowledge: '--',
        strategies: []
      }
    })
  }

  const total = Math.max(learnerLogs.length, responseLogs.length)
  for (let index = 0; index < total; index++) {
    const learnerLog = learnerLogs[index]
    const responseLog = responseLogs[index]
    const learnerOutput = learnerLog?.details?.output || {}
    const responseOutput = responseLog?.details?.output || {}

    const knowledgePoints = Array.isArray(responseOutput?.knowledgePoints)
      ? normalizeKnowledgePoints(responseOutput.knowledgePoints)
      : []

    const strategies = Array.isArray(responseOutput?.strategies)
      ? responseOutput.strategies.filter((item: any) => typeof item === 'string' && item.trim()).slice(0, 4)
      : []

    rounds.push({
      round: index + 1,
      isOpening: false,
      learnerLabel: '虚拟学习者',
      learnerText: learnerOutput?.reply || '--',
      learnerSignals: {
        task: String(learnerOutput?.currentTask || '--'),
        milestone: String(learnerOutput?.currentMilestone || '--'),
        emotion: String(learnerOutput?.emotion || '--')
      },
      agentLabel: '教学系统',
      agentText: responseOutput?.aiResponse || '--',
      agentSignals: {
        completion: responseOutput?.autoEnded ? '已结束评估' : responseOutput?.isCompletion ? '可结束' : '继续',
        cognitiveLevel: String(responseOutput?.cognitiveLevel || '--'),
        knowledge: String(knowledgePoints[0]?.name || responseOutput?.knowledgePoint || '--'),
        strategies,
        knowledgePoints
      }
    })
  }

  return rounds
})

const stageLabel = computed(() => props.stage === 'goal' ? 'Goal' : props.stage === 'path' ? 'Path' : 'Learn')
const stageTitle = computed(() => props.stage === 'goal' ? '聚焦这个故事的 Goal 对话与推进记录' : props.stage === 'path' ? '聚焦这个故事的 Path 生成与任务拆解' : '聚焦这个故事的 Learn 学习过程与对话')
const stageHeadline = computed(() => props.stage === 'goal' ? selectedStoryGoalStatusLabel.value : props.stage === 'path' ? selectedStoryPathStatusLabel.value : selectedStoryLearnStatusLabel.value)
const stageDescription = computed(() => props.stage === 'goal' ? (selectedStorySummary.value?.storyTriggerEvent || '从这个故事进入 goal 对话。') : props.stage === 'path' ? selectedStoryPathHint.value : selectedStoryLearnHint.value)
const stagePanelTitle = computed(() => embedded
  ? (props.stage === 'goal' ? 'Goal 控制' : props.stage === 'path' ? 'Path 控制' : 'Learn 控制')
  : (props.stage === 'goal' ? 'Goal 控制面板' : props.stage === 'path' ? 'Path 控制面板' : 'Learn 控制面板'))
const stageMetaLine = computed(() => embedded
  ? ''
  : props.stage === 'goal'
    ? `${goalConversationPreview.value.length} 条对话`
    : props.stage === 'path'
      ? `${storyTaskCount.value} 个 task`
      : `${learnConversationPreview.value.length} 条对话`)
const stageHistoryTitle = computed(() => `${stageLabel.value} 相关历史运行`)

const stageFactCards = computed(() => {
  if (props.stage === 'goal') {
    return [
      { label: '最近会话', value: shortId(selectedStorySession.value?.id), meta: selectedStorySession.value ? getSessionStatusLabel(selectedStorySession.value.status) : '未启动' },
      { label: 'Goal 对话', value: `${goalConversationPreview.value.length} 条`, meta: selectedStorySummary.value?.storyTriggerEvent || '暂无触发事件' }
    ]
  }
  if (props.stage === 'path') {
    return [
      { label: 'Path 状态', value: selectedStoryPathStatusLabel.value, meta: selectedStoryPathSummary.value },
      { label: '任务数量', value: `${storyTaskCount.value} 个`, meta: selectedStoryTaskLabel.value }
    ]
  }
  return [
    { label: '当前任务', value: selectedStoryTaskLabel.value, meta: shortId(selectedStoryCurrentTaskId.value) },
    { label: 'Learn 对话', value: `${learnConversationPreview.value.length} 条`, meta: selectedStoryLearnStatusLabel.value }
  ]
})

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

const loadTeachingDetail = async () => {
  const sessionId = selectedStorySession.value?.id
  const teachingSessionId = selectedStorySession.value?.bindings?.teachingSessionId
  if (!sessionId || !teachingSessionId) {
    teachingDetailData.value = null
    return
  }
  try {
    const res = await adminApi.getVirtualSessionTeachingDetail(sessionId)
    teachingDetailData.value = res.data?.success ? res.data.data : null
  } catch {
    teachingDetailData.value = null
  }
}

const loadStageData = async () => {
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
    await refreshSessionDetail(selectedStorySession.value?.id)
    await loadSelectedStoryPathStatus()
    await loadGoalConversation()
    await loadTeachingDetail()
    if (embedded) {
      emit('refresh')
    }
  } catch (error: any) {
    ElMessage.error(error.message || '加载失败')
  } finally {
    loading.value = false
  }
}

const stopRefreshTimer = (type: 'goal' | 'path' | 'learn') => {
  const currentTimer = type === 'goal'
    ? goalRefreshTimer
    : type === 'path'
      ? pathRefreshTimer
      : learnRefreshTimer

  if (!currentTimer) return

  clearTimeout(currentTimer)

  if (type === 'goal') goalRefreshTimer = null
  if (type === 'path') pathRefreshTimer = null
  if (type === 'learn') learnRefreshTimer = null
}

const scheduleStageRefresh = (
  type: 'goal' | 'path' | 'learn',
  checker: () => boolean,
  attempts = 6,
  delay = 600,
  afterRefresh?: () => Promise<void> | void
) => {
  stopRefreshTimer(type)
  if (!attempts) return

  const timer = setTimeout(async () => {
    await loadStageData()
    if (afterRefresh) {
      await afterRefresh()
    }

    if (checker()) {
      stopRefreshTimer(type)
      return
    }

    scheduleStageRefresh(type, checker, attempts - 1, delay, afterRefresh)
  }, delay)

  if (type === 'goal') goalRefreshTimer = timer
  if (type === 'path') pathRefreshTimer = timer
  if (type === 'learn') learnRefreshTimer = timer
}

const scheduleLearningRefresh = (taskId?: string | null, attempts = 8, previousRoundCount?: number) => {
  scheduleStageRefresh('learn', () => {
    const session = selectedStorySession.value
    const hasTaskMatch = !taskId || selectedStoryCurrentTaskId.value === taskId || selectedStoryTaskId.value === taskId
    const hasTeachingSession = !!session?.bindings?.teachingSessionId
    const hasNewLearnRound = typeof previousRoundCount === 'number'
      ? learnConversationRounds.value.length > previousRoundCount
      : learnConversationRounds.value.length > 0

    return (hasTaskMatch && hasTeachingSession && hasNewLearnRound)
      || (!!session && session.currentStage !== 'learning' && hasNewLearnRound)
  }, attempts)
}

const scheduleGoalRefresh = (attempts = 8, previousRoundCount?: number) => {
  scheduleStageRefresh(
    'goal',
    () => {
      const hasNewRound = typeof previousRoundCount === 'number'
        ? goalConversationRounds.value.length > previousRoundCount
        : goalConversationRounds.value.length > 0
      return hasNewRound || selectedStorySession.value?.currentStage === 'path' || selectedStorySession.value?.currentStage === 'learning'
    },
    attempts,
    600,
    () => loadGoalConversation()
  )
}

const schedulePathRefresh = (attempts = 8, previousPathId?: string | null) => {
  scheduleStageRefresh(
    'path',
    () => {
      const currentPathId = selectedStorySession.value?.bindings?.learningPathId || selectedStoryPathData.value?.id || selectedStoryPathData.value?.learningPathId || null
      return previousPathId ? currentPathId !== previousPathId : !!currentPathId
    },
    attempts,
    700,
    () => loadSelectedStoryPathStatus()
  )
}

const withSession = async (sessionArg: any | null | undefined, runner: (sessionId: string) => Promise<void>) => {
  if (!sessionArg?.id) {
    ElMessage.warning('请先选择一个 session')
    return
  }
  await runner(sessionArg.id)
  await loadStageData()
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
  void openProjectedFormalView(session, 'goal')
}

const openFormalPathFor = (session?: any | null) => {
  void openProjectedFormalView(session, 'path')
}

const openProjectedFormalView = async (session: any | null | undefined, target: 'goal' | 'path') => {
  const targetId = target === 'goal' ? session?.bindings?.goalConversationId : session?.bindings?.learningPathId
  if (!session?.id || !targetId) return

  const openedWindow = window.open('', '_blank')
  if (!openedWindow) {
    ElMessage.warning('浏览器拦截了新窗口，请允许弹窗后重试')
    return
  }

  try {
    const res = await adminApi.createProjectionToken(profileId, {
      storyId,
      virtualSessionId: session.id,
      scope: 'full'
    })
    const projectionToken = res.data?.data?.token
    if (!res.data?.success || !projectionToken) {
      throw new Error(res.data?.error || '创建投影 token 失败')
    }

    setProjectionToken(projectionToken, {
      profileId,
      virtualSessionId: session.id,
      storyId,
      scope: 'full'
    })

    const targetPath = target === 'goal'
      ? `/goal-conversation/${targetId}?virtualSessionId=${session.id}&viewMode=formal&projection=1`
      : `/learning-path/${targetId}?virtualSessionId=${session.id}&viewMode=formal&projection=1`

    openedWindow.location.href = targetPath
  } catch (error: any) {
    openedWindow.close()
    ElMessage.error(error.message || '打开前台视图失败')
  }
}

const restartStoryGoal = async () => {
  if (!selectedStorySummary.value) {
    ElMessage.warning('当前故事不存在')
    return
  }

  try {
    await ElMessageBox.confirm(
      '这会清空当前故事下已有的 Goal 对话、Path 和 Learn 进度，并重新创建一局新的 Goal。是否继续？',
      '重新开始这个故事',
      {
        type: 'warning',
        confirmButtonText: '重新开始',
        cancelButtonText: '取消'
      }
    )
  } catch {
    return
  }

  restartLoading.value = true
  try {
    for (const session of storySessions.value) {
      if (!session?.id) continue
      const deleteRes = await adminApi.deleteVirtualSession(session.id)
      if (!deleteRes.data?.success) {
        throw new Error(deleteRes.data?.error || '清理旧会话失败')
      }
    }

    const startRes = await adminApi.startVirtualSession(profileId, {
      storyId: selectedStorySummary.value.storyId || selectedStorySummary.value.id,
      storyIndex: selectedStorySummary.value.index
    })

    if (!startRes.data?.success) {
      throw new Error(startRes.data?.error || '创建新 Goal 会话失败')
    }

    ElMessage.success('已重新开始这个故事的 Goal')
    await loadStageData()
  } catch (error: any) {
    ElMessage.error(error.message || '重新开始失败')
  } finally {
    restartLoading.value = false
  }
}

const restartStoryPath = async () => {
  if (!selectedStorySession.value?.id) {
    ElMessage.warning('当前没有可重建的 Path 会话')
    return
  }

  try {
    await ElMessageBox.confirm(
      '这会保留当前 Goal 对话，只清空当前 Path 与其后的 Learn 进度，并基于现有 Goal 结果重新生成 Path。是否继续？',
      '重建 Path',
      {
        type: 'warning',
        confirmButtonText: '重建 Path',
        cancelButtonText: '取消'
      }
    )
  } catch {
    return
  }

  restartLoading.value = true
  try {
    const res = await adminApi.restartVirtualSessionPath(selectedStorySession.value.id)
    if (!res.data?.success) {
      throw new Error(res.data?.error || '重建 Path 失败')
    }

    ElMessage.success('已重建当前故事的 Path')
    await loadStageData()
  } catch (error: any) {
    ElMessage.error(error.message || '重建 Path 失败')
  } finally {
    restartLoading.value = false
  }
}

const restartStoryLearningInternal = async (taskId?: string) => {
  if (!selectedStorySession.value?.id) {
    throw new Error('当前没有可重新开始的学习任务')
  }

  restartLoading.value = true
  try {
    const effectiveTaskId = taskId || getPreferredLearningTaskId()
    pendingLearningTaskId.value = effectiveTaskId || null
    const payload = effectiveTaskId ? { taskId: effectiveTaskId } : undefined
    const res = await adminApi.restartVirtualLearning(selectedStorySession.value.id, payload)
    if (!res.data?.success) {
      throw new Error(res.data?.error || '重新开始当前学习任务失败')
    }

    const confirmedTaskId = res.data?.data?.selectedTaskId || effectiveTaskId || null

    await loadStageData()
    await syncLearnTaskSelection(confirmedTaskId)
    scheduleLearningRefresh(confirmedTaskId)

    return confirmedTaskId
  } finally {
    restartLoading.value = false
    pendingLearningTaskId.value = null
  }
}

const restartStoryLearning = async (taskId?: string) => {
  if (!selectedStorySession.value?.id) {
    ElMessage.warning('当前没有可重新开始的学习任务')
    return
  }

  try {
    await ElMessageBox.confirm(
      '将清空当前学习任务的进度（对话、知识点推进、小检核状态），并从这个任务的开头重新开始。Goal 与 Path 会保留。此操作不可撤销。',
      '重新开始当前学习任务',
      {
        type: 'warning',
        confirmButtonText: '确认重置',
        cancelButtonText: '继续学习'
      }
    )
  } catch {
    return
  }

  try {
    await restartStoryLearningInternal(taskId)
    ElMessage.success('已重新开始当前学习任务')
  } catch (error: any) {
    ElMessage.error(error.message || '重新开始当前学习任务失败')
  }
}

const stopLearningFor = async (session?: any | null) => {
  if (!session?.id) {
    ElMessage.warning('当前没有可停止的 Learn 会话')
    return
  }

  try {
    await ElMessageBox.confirm(
      '这会立即停止当前学习任务的自动推进。停止后可重新开始当前学习任务，或切换到其他 task。是否继续？',
      '紧急停止 Learn',
      {
        type: 'warning',
        confirmButtonText: '立即停止',
        cancelButtonText: '取消'
      }
    )
  } catch {
    return
  }

  stopLearningLoading.value = true
  try {
    const res = await adminApi.stopVirtualLearning(session.id)
    if (!res.data?.success) {
      throw new Error(res.data?.error || '紧急停止失败')
    }

    ElMessage.success('已紧急停止当前 Learn')
    await loadStageData()
  } catch (error: any) {
    ElMessage.error(error.message || '紧急停止失败')
  } finally {
    stopLearningLoading.value = false
    autoLearningLoading.value = false
  }
}

const runGoalStepFor = async (session?: any | null) => {
  const previousRoundCount = goalConversationRounds.value.length
  stepLoading.value = true
  try {
    await withSession(session, async (sessionId) => {
      const res = await adminApi.virtualSessionStep(sessionId)
      if (!res.data?.success) throw new Error(res.data?.error || 'Goal 单步失败')
    })
    scheduleGoalRefresh(8, previousRoundCount)
  } catch (error: any) {
    ElMessage.error(error.message || 'Goal 单步失败')
  } finally {
    stepLoading.value = false
  }
}

const runGoalAutoFor = async (session?: any | null) => {
  const previousRoundCount = goalConversationRounds.value.length
  const previousPathId = selectedStorySession.value?.bindings?.learningPathId || null
  autoLoading.value = true
  try {
    await withSession(session, async (sessionId) => {
      const res = await adminApi.virtualSessionAuto(sessionId, { maxRounds: 20 })
      if (!res.data?.success) throw new Error(res.data?.error || 'Goal 自动失败')
    })
    scheduleGoalRefresh(8, previousRoundCount)
    schedulePathRefresh(8, previousPathId)
  } catch (error: any) {
    ElMessage.error(error.message || 'Goal 自动失败')
  } finally {
    autoLoading.value = false
  }
}

const confirmGeneratePathFor = async (session?: any | null) => {
  const previousPathId = selectedStorySession.value?.bindings?.learningPathId || null
  advanceLoading.value = true
  try {
    await withSession(session, async (sessionId) => {
      const res = await adminApi.virtualSessionAdvancePath(sessionId)
      if (!res.data?.success) throw new Error(res.data?.error || '生成 Path 失败')
    })
    schedulePathRefresh(8, previousPathId)
  } catch (error: any) {
    ElMessage.error(error.message || '生成 Path 失败')
  } finally {
    advanceLoading.value = false
  }
}

const startLearningFor = async (session?: any | null, taskId?: string) => {
  const previousRoundCount = learnConversationRounds.value.length
  learningStartLoading.value = true
  pendingLearningTaskId.value = taskId || getPreferredLearningTaskId() || null
  try {
    if (!session?.id) {
      ElMessage.warning('请先选择一个 session')
      return
    }

    const effectiveTaskId = taskId || getPreferredLearningTaskId()
    const res = await adminApi.startVirtualLearning(session.id, effectiveTaskId ? { taskId: effectiveTaskId } : undefined)
    if (!res.data?.success) throw new Error(res.data?.error || '启动 Learn 失败')
    const confirmedTaskId = res.data?.data?.selectedTaskId || effectiveTaskId || null

    ElMessage.success('已进入 Learn')
    await loadStageData()
    await syncLearnTaskSelection(confirmedTaskId, props.stage === 'path' ? 'push' : 'replace')
    scheduleLearningRefresh(confirmedTaskId, 8, previousRoundCount)

  } catch (error: any) {
    ElMessage.error(error.message || '启动 Learn 失败')
  } finally {
    learningStartLoading.value = false
    pendingLearningTaskId.value = null
  }
}

const switchLearningTask = async (direction: 'previous' | 'next') => {
  const target = direction === 'previous' ? previousStoryTaskOption.value : nextStoryTaskOption.value
  if (!target?.id) {
    ElMessage.warning(direction === 'previous' ? '已经是第一个可切换 task' : '已经是最后一个可切换 task')
    return
  }

  pendingLearningTaskId.value = target.id

  if (selectedStorySession.value?.currentStage === 'learning') {
    try {
      await restartStoryLearningInternal(target.id)
      ElMessage.success('已切换到新的 Learn 任务')
    } catch (error: any) {
      ElMessage.error(error.message || '切换 Learn 任务失败')
    }
    return
  }

  await startLearningFor(selectedStorySession.value, target.id)
}

const runLearningStepFor = async (session?: any | null) => {
  const previousRoundCount = learnConversationRounds.value.length
  learningStepLoading.value = true
  try {
    await withSession(session, async (sessionId) => {
      const res = await adminApi.virtualSessionLearningStep(sessionId)
      if (!res.data?.success) throw new Error(res.data?.error || 'Learn 单步失败')
    })
    scheduleLearningRefresh(selectedStoryCurrentTaskId.value, 8, previousRoundCount)
  } catch (error: any) {
    ElMessage.error(error.message || 'Learn 单步失败')
  } finally {
    learningStepLoading.value = false
  }
}

const runLearningAutoFor = async (session?: any | null) => {
  const previousRoundCount = learnConversationRounds.value.length
  autoLearningLoading.value = true
  try {
    await withSession(session, async (sessionId) => {
      const res = await adminApi.virtualSessionAutoLearning(sessionId, { maxMilestones: 10 })
      if (!res.data?.success) throw new Error(res.data?.error || 'Learn 自动失败')
    })
    scheduleLearningRefresh(selectedStoryCurrentTaskId.value, 8, previousRoundCount)
  } catch (error: any) {
    ElMessage.error(error.message || 'Learn 自动失败')
  } finally {
    autoLearningLoading.value = false
  }
}

watch(
  () => selectedStorySession.value?.id,
  () => {
    loadSelectedStoryPathStatus()
    loadGoalConversation()
    loadTeachingDetail()
  }
)

watch(
  [selectedStoryTaskOptions, selectedStoryCurrentTaskId, () => route.query.taskId],
  () => {
    const routeTaskId = typeof route.query.taskId === 'string' ? route.query.taskId.trim() : ''
    if (routeTaskId && selectedStoryTaskOptions.value.some((item: any) => item.id === routeTaskId)) {
      selectedStoryTaskId.value = routeTaskId
      return
    }

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

onUnmounted(() => {
  stopRefreshTimer('goal')
  stopRefreshTimer('path')
  stopRefreshTimer('learn')
})

onMounted(() => {
  loadStageData()
})
</script>

<style scoped>
.story-stage-page {
  min-height: 100vh;
  padding: 18px;
  background: linear-gradient(180deg, #f4f7fc 0%, #eef2f8 100%);
  color: #1f2937;
}

.story-stage-page--embedded {
  min-height: auto;
  padding: 0;
  background: transparent;
}

.story-stage-topbar,
.story-stage-layout,
.empty-box--full {
  max-width: 1360px;
  margin: 0 auto;
}

.story-stage-page--embedded .story-stage-layout,
.story-stage-page--embedded .empty-box--full {
  max-width: none;
}

.story-stage-topbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
  padding: 18px 20px;
  border-radius: 18px;
  border: 1px solid #e5eaf2;
  background: rgba(255, 255, 255, 0.84);
}

.story-stage-topbar__left,
.story-stage-topbar__actions,
.stage-card__actions,
.session-card__actions,
.pressure-list {
  display: flex;
  gap: 8px;
}

.story-stage-topbar__actions,
.stage-card__actions,
.session-card__actions,
.pressure-list {
  flex-wrap: wrap;
}

.story-stage-topbar__title,
.story-stage-layout,
.story-stage-hero,
.story-stage-hero__facts,
.story-stage-main-grid,
.context-stack,
.detail-block,
.dialogue-list,
.session-list {
  display: grid;
  gap: 16px;
}

.story-stage-topbar__title h1,
.story-stage-hero h2,
.section-head h3 {
  margin: 0;
}

.story-stage-topbar__title p,
.story-stage-hero p,
.stage-card p,
.context-card p,
.session-card p,
.dialogue-row p {
  margin: 0;
  color: #5f6b7d;
  line-height: 1.65;
}

.story-stage-topbar__eyebrow,
.story-stage-hero__eyebrow,
.section-head__eyebrow,
.stage-card__eyebrow {
  display: inline-flex;
  width: fit-content;
  padding: 4px 10px;
  border-radius: 999px;
  background: #eef4ff;
  color: #2355d8;
  font-size: 11px;
  font-weight: 700;
}

.panel-card {
  padding: 20px;
  border-radius: 24px;
  border: 1px solid rgba(226, 232, 240, 0.9);
  background: rgba(255, 255, 255, 0.92);
}

.story-stage-hero {
  grid-template-columns: minmax(0, 1.25fr) minmax(280px, 0.75fr);
}

.story-stage-hero__facts,
.story-stage-main-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.story-stage-main-grid--goal {
  grid-template-columns: minmax(0, 1.55fr) minmax(320px, 0.75fr);
  align-items: start;
}

.story-stage-main-grid--embedded,
.story-stage-main-grid--embedded.story-stage-main-grid--goal {
  grid-template-columns: 1fr;
}

.story-stage-page--embedded .story-stage-main-grid:not(.story-stage-main-grid--goal) {
  grid-template-columns: 1fr;
}

.story-stage-main-grid:not(.story-stage-main-grid--goal) {
  grid-template-columns: minmax(0, 1.85fr) minmax(240px, 0.55fr);
  align-items: start;
}

.story-stage-fact-card,
.context-card,
.detail-block,
.session-card,
.stage-card {
  padding: 16px;
  border-radius: 18px;
  border: 1px solid #e7ecf3;
  background: #fbfcfe;
}

.story-stage-fact-card span,
.context-card span,
.detail-block__head span,
.session-card__actions span,
.stage-card__meta,
.dialogue-row span {
  font-size: 12px;
  color: #7b8597;
}

.story-stage-fact-card strong,
.context-card strong,
.detail-block__head strong,
.stage-card__head strong {
  color: #1f2937;
}

.stage-card__head-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  flex-wrap: wrap;
}

.section-head,
.stage-card__head,
.session-card,
.detail-block__head,
.dialogue-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.section-head {
  margin-bottom: 14px;
}

.section-head--compact {
  margin-bottom: 0;
}

.stage-card,
.context-card {
  display: grid;
  gap: 12px;
}

.stage-card--goal {
  border-color: #cfe0ff;
}

.story-stage-page--embedded .stage-card {
  gap: 10px;
  padding: 12px 14px;
  border-radius: 16px;
}

.story-stage-page--embedded .story-stage-goal-card,
.story-stage-page--embedded .stage-card--path-hero,
.story-stage-page--embedded .stage-card--learn {
  grid-template-columns: 1fr;
  align-items: stretch;
  column-gap: 16px;
}

.story-stage-page--embedded .story-stage-goal-card > p,
.story-stage-page--embedded .stage-card--path-hero > p,
.story-stage-page--embedded .stage-card--learn > p {
  display: none;
}

.story-stage-page--embedded .story-stage-goal-card .stage-card__head,
.story-stage-page--embedded .stage-card--path-hero .stage-card__head,
.story-stage-page--embedded .stage-card--learn .stage-card__head {
  align-items: center;
}

.story-stage-page--embedded .stage-card__head--embedded {
  align-items: center;
}

.story-stage-page--embedded .story-stage-goal-card .stage-card__actions,
.story-stage-page--embedded .stage-card--path-hero .stage-card__actions,
.story-stage-page--embedded .stage-card--learn .stage-card__actions {
  justify-content: flex-start;
  align-items: center;
}

.story-stage-page--embedded .stage-card__actions--embedded {
  padding-top: 0;
  padding-bottom: 0;
}

.story-stage-page--embedded .stage-card__head strong {
  font-size: 20px;
  line-height: 1.2;
}

.story-stage-page--embedded .stage-card__actions {
  gap: 6px;
}

.story-stage-page--embedded .stage-card__actions :deep(.el-button) {
  min-height: 30px;
  padding-inline: 12px;
}

.story-stage-goal-card {
  background: linear-gradient(180deg, #f8fbff, #ffffff);
}

.story-stage-page--embedded .story-stage-goal-card,
.story-stage-page--embedded .stage-card--path-hero,
.story-stage-page--embedded .stage-card--learn {
  background: #ffffff;
}

.story-stage-main-panel--goal {
  display: grid;
  gap: 16px;
}

.story-stage-side-panel--goal {
  position: sticky;
  top: 18px;
}

.story-stage-side-panel--compact {
  padding: 16px;
}

.story-stage-side-panel--compact .context-stack {
  gap: 10px;
}

.story-stage-side-panel--compact .context-card {
  padding: 12px;
  border-radius: 14px;
}

.story-stage-side-panel--compact .context-card strong,
.story-stage-side-panel--compact .context-card p {
  font-size: 13px;
  line-height: 1.55;
}

.detail-block--dialogue {
  background: linear-gradient(180deg, #ffffff, #fbfdff);
}

.detail-block--status-strip {
  background: linear-gradient(180deg, #f8fbff, #ffffff);
}

.detail-block--status-strip-compact {
  background: transparent;
}

.goal-internal-collapse {
  margin-top: 12px;
}

.goal-internal-collapse :deep(.el-collapse-item__header) {
  color: #64748b;
  font-size: 13px;
}

.goal-internal-collapse :deep(.el-collapse-item__content) {
  padding-bottom: 0;
}

.goal-internal-collapse :deep(.el-collapse-item__wrap) {
  border-bottom: 0;
}

.goal-status-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.goal-status-card {
  display: grid;
  gap: 6px;
  padding: 14px;
  border-radius: 16px;
  border: 1px solid #e4ebf5;
  background: rgba(255, 255, 255, 0.82);
}

.goal-status-card span {
  font-size: 12px;
  color: #64748b;
}

.goal-status-card strong {
  color: #1f2937;
  font-size: 22px;
  line-height: 1.2;
}

.goal-status-card em {
  font-style: normal;
  font-size: 12px;
  color: #7b8597;
}

.goal-status-grid--inline {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.goal-status-pill-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.goal-status-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid #e3eaf5;
  background: #f8fbff;
  color: #1f2937;
}

.goal-status-pill em,
.goal-status-pill small {
  font-style: normal;
  font-size: 12px;
  color: #6b7280;
}

.goal-status-pill strong {
  font-size: 13px;
  color: #111827;
}

.story-stage-page--embedded .story-stage-goal-card .goal-status-grid--inline {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.detail-block--goal-dialogue {
  min-height: 520px;
}

.detail-block__head--dialogue {
  align-items: center;
}

.dialogue-list--goal {
  gap: 12px;
  min-height: 420px;
}

.dialogue-list--goal .dialogue-row {
  padding: 14px 0 0;
}

.dialogue-list--goal .dialogue-row p {
  font-size: 15px;
  line-height: 1.75;
}

.goal-dialogue-title {
  display: grid;
  gap: 4px;
}

.goal-dialogue-title em {
  font-style: normal;
  font-size: 12px;
  color: #64748b;
}

.dialogue-row--goal {
  display: grid;
  gap: 10px;
}

.goal-round-rail {
  display: grid;
  gap: 12px;
}

.goal-round-bubble {
  display: grid;
  gap: 10px;
  padding: 14px;
  border-radius: 16px;
  border: 1px solid #e6ebf3;
  background: #ffffff;
}

.goal-round-bubble--learner {
  border-color: #d7ebdd;
  background: linear-gradient(180deg, #f8fff9, #ffffff);
}

.goal-round-bubble--agent {
  border-color: #cfe0ff;
  background: linear-gradient(180deg, #f8fbff, #ffffff);
}

.goal-round-bubble__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.goal-round-bubble__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.goal-round-signals {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.goal-round-signals--inline {
  align-items: center;
}

.goal-round-signal {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding: 4px 8px;
  border-radius: 999px;
  background: #f8fafc;
  border: 1px solid #e5eaf2;
  line-height: 1;
}

.goal-round-signal em {
  font-style: normal;
  font-size: 10px;
  color: #64748b;
}

.goal-round-signal em::after {
  content: ':';
  margin-left: 1px;
}

.goal-round-signal strong {
  font-size: 11px;
  font-weight: 700;
  color: #1f2937;
}


.dialogue-row__meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.dialogue-round-pill,
.dialogue-side-pill,
.dialogue-stage-pill,
.dialogue-opening-pill {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}

.dialogue-round-pill {
  background: #e8eefc;
  color: #214fcf;
}

.dialogue-side-pill--learner {
  background: #eefaf2;
  color: #198754;
}

.dialogue-side-pill--agent {
  background: #fff3e8;
  color: #b45309;
}

.dialogue-stage-pill {
  background: #f3f4f6;
  color: #475569;
}

.dialogue-opening-pill {
  background: #fef3c7;
  color: #92400e;
}

.stage-card--path {
  border-color: #d7ebdd;
}

.stage-card--path-hero {
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(circle at top right, rgba(84, 169, 110, 0.12), transparent 36%),
    linear-gradient(180deg, #f9fffb 0%, #ffffff 100%);
}

.detail-block--path-map,
.detail-block--path-picker {
  border-color: #dbe8dd;
}

.detail-block--path-map {
  display: grid;
  gap: 14px;
}

.path-map-grid {
  display: grid;
  gap: 14px;
}

.path-milestone-card {
  display: grid;
  gap: 12px;
  padding: 16px;
  border-radius: 18px;
  border: 1px solid #d8e9da;
  background: linear-gradient(180deg, rgba(247, 255, 248, 0.92), rgba(255, 255, 255, 0.96));
}

.path-milestone-card__head,
.path-task-chip__head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: flex-start;
}

.path-milestone-card__eyebrow {
  display: inline-flex;
  width: fit-content;
  margin-bottom: 4px;
  padding: 4px 10px;
  border-radius: 999px;
  background: #e9f8ee;
  color: #2b8a57;
  font-size: 11px;
  font-weight: 700;
}

.path-milestone-card__meta,
.path-task-chip__head span {
  font-size: 12px;
  color: #7b8597;
}

.path-milestone-card p,
.path-task-chip p {
  margin: 0;
  color: #5c6b64;
  line-height: 1.65;
}

.path-task-list {
  display: grid;
  gap: 10px;
}

.path-task-chip {
  display: grid;
  gap: 8px;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid #e0e9e2;
  background: rgba(255, 255, 255, 0.9);
}

.path-task-chip--current {
  border-color: #9fd4ac;
  background: #f1fbf4;
}

.path-task-chip--runnable {
  box-shadow: inset 0 0 0 1px rgba(43, 138, 87, 0.08);
}

.path-task-chip--locked {
  opacity: 0.72;
}

.path-task-chip__head strong {
  font-size: 14px;
  color: #1d3529;
}

.path-task-chip__actions {
  display: flex;
  justify-content: flex-end;
}

.stage-card--learn {
  border-color: #f6dfb1;
  background: linear-gradient(180deg, #fffdf7 0%, #ffffff 100%);
}

.story-stage-page--embedded .learn-cockpit {
  gap: 14px;
}

.story-stage-page--embedded .learn-status-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.story-stage-page--embedded .learn-focus-strip {
  grid-template-columns: 1fr;
}

.story-stage-page--embedded .learn-stat-card,
.story-stage-page--embedded .learn-metric-tile,
.story-stage-page--embedded .learn-summary-item {
  padding: 12px;
  border-radius: 14px;
}

.story-stage-page--embedded .learn-stat-card strong,
.story-stage-page--embedded .learn-metric-tile strong,
.story-stage-page--embedded .learn-summary-item strong {
  font-size: 18px;
}

.learn-cockpit,
.learn-main-grid,
.learn-status-grid,
.learn-focus-strip,
.learn-metrics-stack,
.learn-summary-list {
  display: grid;
  gap: 16px;
}

.learn-cockpit {
  gap: 18px;
}

.learn-command-bar {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.learn-status-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.learn-stat-card {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid rgba(231, 214, 177, 0.8);
  background: rgba(255, 255, 255, 0.86);
  min-height: 88px;
}

.learn-stat-card--accent {
  background: linear-gradient(180deg, #fff8e7, #ffffff);
  border-color: rgba(238, 186, 77, 0.5);
}

.learn-stat-card--warning {
  background: linear-gradient(180deg, #fff5eb, #ffffff);
  border-color: rgba(245, 158, 11, 0.45);
}

.learn-stat-card span,
.learn-metric-tile span,
.learn-summary-item span {
  font-size: 12px;
  color: #7b8597;
}

.learn-stat-card strong,
.learn-metric-tile strong,
.learn-summary-item strong {
  font-size: 18px;
  color: #1f2937;
  line-height: 1.3;
}

.learn-stat-card em {
  font-style: normal;
  font-size: 12px;
  color: #8b94a6;
}

.learn-focus-strip {
  grid-template-columns: minmax(220px, 0.9fr) minmax(0, 1.4fr);
  align-items: stretch;
  gap: 12px;
}

.learn-focus-card {
  display: grid;
  gap: 6px;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid rgba(232, 210, 156, 0.8);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(255, 250, 240, 0.95));
}

.learn-focus-card span {
  font-size: 12px;
  color: #8c6724;
}

.learn-focus-card strong {
  font-size: 16px;
  line-height: 1.35;
  color: #33220b;
}

.learn-metrics-stack {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.learn-metric-tile,
.learn-summary-item {
  display: grid;
  gap: 4px;
  padding: 12px;
  border-radius: 14px;
  border: 1px solid #ece7d8;
  background: rgba(255, 255, 255, 0.84);
}

.learn-metric-tile {
  align-content: start;
}

.learn-main-grid {
  grid-template-columns: 1fr;
  align-items: start;
  gap: 14px;
}

.learn-overview-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  gap: 14px;
}

.detail-block--learn-summary {
  border-color: #ece0c2;
  background: linear-gradient(180deg, #fffdfa 0%, #ffffff 100%);
}

.detail-block--learn-summary .detail-block__head,
.detail-block--learn-knowledge .detail-block__head {
  margin-bottom: 2px;
}

.detail-block--learn-dialogue {
  min-height: 520px;
}

.detail-block--overview {
  align-content: start;
}

.detail-block--learn-knowledge {
  display: grid;
  gap: 12px;
  border-color: #f3e2b0;
  background: linear-gradient(180deg, #fffdf8 0%, #ffffff 100%);
}

.knowledge-progress-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.knowledge-progress-card,
.knowledge-inline-item {
  display: grid;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid #eee5cf;
  background: rgba(255, 255, 255, 0.92);
}

.knowledge-progress-card__head,
.knowledge-inline-item__head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
}

.knowledge-progress-card__head div,
.knowledge-inline-item__head {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.knowledge-progress-card__head span,
.knowledge-inline-item__head span {
  font-size: 12px;
  color: #8a6d2f;
}

.knowledge-progress-card__head em {
  font-style: normal;
  font-size: 12px;
  font-weight: 700;
  color: #7c5d19;
}

.learn-summary-list {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.learn-summary-item {
  min-height: 90px;
}

.knowledge-inline-list {
  display: grid;
  gap: 8px;
}

.dialogue-row--learn-round {
  display: grid;
  gap: 12px;
}

.learn-round-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(280px, 0.8fr);
  gap: 12px;
  align-items: start;
}

.learn-round-conversation {
  display: grid;
  gap: 10px;
}

.learn-round-knowledge {
  display: grid;
  gap: 10px;
  padding: 12px;
  border-radius: 16px;
  border: 1px solid #e7edf7;
  background: linear-gradient(180deg, #fbfdff 0%, #ffffff 100%);
}

.learn-round-knowledge__head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
}

.learn-round-knowledge__head strong {
  font-size: 14px;
  color: #1f2937;
}

.learn-round-knowledge__head span {
  font-size: 12px;
  color: #8b94a6;
}

.learn-chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.learn-chip {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  background: #fff5e8;
  color: #a15c00;
  font-size: 12px;
  font-weight: 600;
}

.pressure-chip {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  background: #eef4ff;
  color: #2956d7;
  font-size: 12px;
  font-weight: 600;
}

.task-picker {
  display: grid;
  gap: 8px;
}

.dialogue-row {
  align-items: flex-start;
  padding-top: 12px;
  border-top: 1px solid #eef2f7;
}

.dialogue-row:first-child {
  padding-top: 0;
  border-top: 0;
}

.empty-box {
  text-align: center;
  padding: 28px 20px;
  background: #fbfcfe;
  border-radius: 16px;
  border: 1px dashed #dce4ee;
  color: #8b94a6;
}

.empty-box--inline {
  padding: 16px;
}

@media (max-width: 1200px) {
  .story-stage-hero,
  .story-stage-hero__facts,
  .story-stage-main-grid {
    grid-template-columns: 1fr;
  }

  .goal-status-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .story-stage-side-panel--goal {
    position: static;
  }

  .learn-hero,
  .learn-main-grid,
  .learn-overview-grid,
  .learn-status-grid,
  .learn-focus-strip,
  .learn-metrics-stack,
  .knowledge-progress-list,
  .learn-summary-list,
  .learn-round-layout {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 900px) {
  .story-stage-topbar,
  .section-head,
  .stage-card__head,
  .session-card,
  .detail-block__head,
  .dialogue-row {
    flex-direction: column;
  }

  .goal-status-grid {
    grid-template-columns: 1fr;
  }

  .goal-round-signal {
    min-width: 0;
    width: 100%;
  }

  .learn-metrics-stack {
    grid-template-columns: 1fr;
    display: grid;
  }
}
</style>
