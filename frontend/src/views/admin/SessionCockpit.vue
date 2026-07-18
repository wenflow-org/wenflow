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
        <el-button
          v-if="isBlackboxMode && isTerminal"
          type="primary"
          plain
          :loading="loadingRerun"
          :disabled="!isRerunAvailable"
          :title="isRerunAvailable ? '使用创建时固化的完整运行配置创建新 Run' : '旧 Run 缺少完整运行时快照，无法保证同配置重跑'"
          @click="handleRerun"
        >
          按原输入重跑
        </el-button>
      </template>
    </AdminPageHeader>

    <section class="session-overview" :class="{ 'session-overview--terminal': isTerminal }">
      <div class="session-overview__headline">
        <div>
          <span class="session-overview__eyebrow">{{ isBlackboxMode ? '实验态势' : '会话态势' }}</span>
          <h2>{{ overviewTitle }}</h2>
          <p>{{ overviewLead }}</p>
        </div>
        <div class="session-overview__tags">
          <el-tag v-if="isBlackboxMode" type="info" size="small" effect="plain">Blackbox API</el-tag>
          <el-tag :type="statusTagType" size="small" effect="dark">{{ statusText }}</el-tag>
        </div>
      </div>

      <nav class="overview-stage-strip" aria-label="会话阶段">
        <button
          v-for="(s, index) in stageStripItems"
          :key="s.key"
          type="button"
          class="overview-stage"
          :class="{ active: s.key === activeNav, current: s.key === liveNav, done: s.done, disabled: s.disabled }"
          :disabled="s.disabled"
          @click="selectStage(s.key)"
        >
          <span class="overview-stage__index">{{ s.done ? '✓' : index + 1 }}</span>
          <span class="overview-stage__copy">
            <strong>{{ s.label }}</strong>
            <small>{{ s.statusLabel }}</small>
          </span>
        </button>
      </nav>

      <div class="session-overview__facts">
        <div v-for="fact in overviewFacts" :key="fact.label" class="overview-fact">
          <span>{{ fact.label }}</span>
          <strong :title="fact.value">{{ fact.value }}</strong>
          <small>{{ fact.meta }}</small>
        </div>
      </div>

      <div v-if="isBlackboxMode" class="session-overview__footer">
        <code>EXP {{ experimentMeta?.experimentId?.slice(0, 10) || '—' }}</code>
        <code>RUN {{ experimentMeta?.runId?.slice(0, 10) || '—' }}</code>
        <span>{{ publicTraceCount }} 条公开轨迹</span>
        <span>{{ refereeTraceCount }} 条裁判轨迹</span>
        <span v-if="refereeReportCount || actorAuditReportCount">{{ refereeReportCount + actorAuditReportCount }} 份报告</span>
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
            <h3>终局评估 · Referee</h3>
            <el-button v-if="isTerminal && (!latestRefereeReport || !latestActorAuditReport)" type="primary" :loading="loadingReferee" @click="handleGenerateReferee">
              生成双评估
            </el-button>
          </div>
          <div v-if="latestRefereeReport || latestActorAuditReport" class="evaluation-grid">
            <div class="evaluation-conclusion">
              <span>实验结论</span>
              <strong>{{ experimentConclusionLabel }}</strong>
            </div>
            <article class="evaluation-report">
              <div class="referee-report__hero">
                <div>
                  <span>平台质量</span>
                  <strong>{{ refereeVerdictLabel }}</strong>
                  <p>{{ latestRefereeReport ? formatEventTime(latestRefereeReport.evaluatedAt) : '未生成' }}</p>
                </div>
                <div class="referee-score">
                  <strong>{{ latestRefereeReport?.report?.scores?.overall ?? '—' }}</strong>
                  <span>platform</span>
                </div>
              </div>
              <div v-if="latestRefereeReport" class="referee-score-grid">
                <div v-for="metric in refereeScoreItems" :key="metric.label">
                  <span>{{ metric.label }}</span>
                  <strong>{{ metric.value ?? '—' }}</strong>
                </div>
              </div>
              <div v-if="latestRefereeReport?.report?.findings?.length" class="referee-report__section">
                <h4>平台发现</h4>
                <article v-for="item in latestRefereeReport.report.findings" :key="item.code" class="referee-finding">
                  <el-tag size="small" :type="findingTagType(item.severity)">{{ item.severity }}</el-tag>
                  <div>
                    <strong>{{ item.title }}</strong><p>{{ item.detail }}</p>
                    <details v-if="findingEvidence(latestRefereeReport, item).length" class="finding-evidence">
                      <summary>证据 {{ findingEvidence(latestRefereeReport, item).length }}</summary>
                      <div v-for="evidence in findingEvidence(latestRefereeReport, item)" :key="evidence.id">
                        <code>{{ evidence.source }}{{ evidence.index === null ? '' : `[${evidence.index}]` }} · {{ evidence.path }}</code>
                        <p>{{ evidence.excerpt || evidence.interpretation }}</p>
                      </div>
                    </details>
                  </div>
                </article>
              </div>
              <div v-if="latestRefereeReport?.report?.recommendations?.length" class="referee-report__section">
                <h4>平台建议</h4>
                <article v-for="item in latestRefereeReport.report.recommendations" :key="`${item.priority}-${item.action}`" class="referee-recommendation">
                  <strong>{{ item.priority }}</strong><p>{{ item.action }}</p>
                </article>
              </div>
            </article>

            <article class="evaluation-report">
              <div class="referee-report__hero">
                <div>
                  <span>角色保真</span>
                  <strong>{{ actorAuditVerdictLabel }}</strong>
                  <p>{{ latestActorAuditReport ? formatEventTime(latestActorAuditReport.evaluatedAt) : '未生成' }}</p>
                </div>
                <div class="referee-score">
                  <strong>{{ latestActorAuditReport?.report?.scores?.overall ?? '—' }}</strong>
                  <span>actor</span>
                </div>
              </div>
              <div v-if="latestActorAuditReport" class="referee-score-grid referee-score-grid--actor">
                <div v-for="metric in actorAuditScoreItems" :key="metric.label">
                  <span>{{ metric.label }}</span>
                  <strong>{{ metric.value ?? '—' }}</strong>
                </div>
              </div>
              <div v-if="latestActorAuditReport?.report?.findings?.length" class="referee-report__section">
                <h4>角色发现</h4>
                <article v-for="item in latestActorAuditReport.report.findings" :key="item.code" class="referee-finding">
                  <el-tag size="small" :type="findingTagType(item.severity)">{{ item.severity }}</el-tag>
                  <div>
                    <strong>{{ item.title }}</strong><p>{{ item.detail }}</p>
                    <details v-if="findingEvidence(latestActorAuditReport, item).length" class="finding-evidence">
                      <summary>证据 {{ findingEvidence(latestActorAuditReport, item).length }}</summary>
                      <div v-for="evidence in findingEvidence(latestActorAuditReport, item)" :key="evidence.id">
                        <code>{{ evidence.source }}{{ evidence.index === null ? '' : `[${evidence.index}]` }} · {{ evidence.path }}</code>
                        <p>{{ evidence.excerpt || evidence.interpretation }}</p>
                      </div>
                    </details>
                  </div>
                </article>
              </div>
              <div v-if="latestActorAuditReport?.report?.recommendations?.length" class="referee-report__section">
                <h4>模拟器建议</h4>
                <article v-for="item in latestActorAuditReport.report.recommendations" :key="`${item.priority}-${item.action}`" class="referee-recommendation">
                  <strong>{{ item.priority }}</strong><p>{{ item.action }}</p>
                </article>
              </div>
            </article>
          </div>
          <div v-else class="stage-panel__empty">
            <p>{{ isTerminal ? '尚无终局评估' : '实验进行中' }}</p>
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
          @abandon="handleAbandon"
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

type NavKey = 'goal' | 'path' | 'learning' | 'wrapup' | 'referee'

interface CockpitConfig {
  maxRounds: number
  maxMilestones: number
  autoAdvanceToPath: boolean
  autoAdvanceToLearning: boolean
  continueOnTaskComplete: boolean
  frictionBudget: 'none' | 'low' | 'normal' | 'high' | 'stress_test'
}

interface CockpitMessage {
  role?: string
  content?: string
  text?: string
  signals?: Record<string, unknown> | null
  closureDecision?: {
    teacherReady?: boolean
    learnerReady?: boolean
    [key: string]: unknown
  } | null
  [key: string]: unknown
}

interface PathMilestone {
  title?: string
  status?: string
  description?: string
  subtasks?: Array<{ id?: string; title?: string; status?: string; [key: string]: unknown }>
  [key: string]: unknown
}

interface BlackboxObservation {
  stage?: string
  visibleMessages?: CockpitMessage[]
  visiblePath?: { title?: string; milestones?: PathMilestone[]; [key: string]: unknown }
  visibleTask?: { title?: string; [key: string]: unknown }
  lastActionResult?: { visibleMessage?: string; [key: string]: unknown }
  availableActions?: string[]
  [key: string]: unknown
}

interface BlackboxTraceEntry {
  observation?: BlackboxObservation
  [key: string]: unknown
}

interface EvaluationReportEnvelope {
  id?: string
  evaluatedAt?: string
  report?: {
    verdict?: string
    scores?: { overall?: number; [key: string]: number | undefined }
    findings?: Array<{
      code?: string
      severity?: string
      title?: string
      detail?: string
      evidenceIds?: Array<string | number>
      [key: string]: unknown
    }>
    recommendations?: Array<{ priority?: string; action?: string; [key: string]: unknown }>
    evidence?: Array<{
      id?: string | number
      source?: string
      index?: number | null
      path?: string
      excerpt?: string
      interpretation?: string
      [key: string]: unknown
    }>
    [key: string]: unknown
  }
  [key: string]: unknown
}

interface WrapupEvaluation {
  sessionLss?: number
  sessionKtl?: number
  sessionLf?: number
  confidence?: number
  reasoning?: string
  [key: string]: unknown
}

interface WrapupSummary {
  summary?: string
  topicSummary?: string
  knowledgeSummary?: string
  practiceAdvice?: string
  learningEvaluation?: string
  overallAssessment?: string
  evaluation?: WrapupEvaluation
  [key: string]: unknown
}

interface PathReviewInfo {
  decision?: string
  status?: string
  reaction?: string
  biggestConcern?: string
  visibleRequestedChanges?: string[]
  [key: string]: unknown
}

interface SessionBindings {
  goalConversationId?: string
  learningPathId?: string
  currentTaskId?: string
  teachingSessionId?: string
  [key: string]: unknown
}

interface SessionStageResults {
  experiment?: { mode?: string; experimentId?: string; runId?: string; [key: string]: unknown }
  blackbox?: {
    publicTrace?: BlackboxTraceEntry[]
    refereeReports?: EvaluationReportEnvelope[]
    actorAuditReports?: EvaluationReportEnvelope[]
    latestRefereeReportId?: string
    latestActorAuditReportId?: string
    refereeTrace?: unknown[]
    control?: { goalCompleted?: boolean; runCompleted?: boolean; [key: string]: unknown }
    [key: string]: unknown
  }
  goal?: {
    finalStage?: string
    stage?: string
    conversationHistory?: CockpitMessage[]
    concernPool?: Record<string, { disclosed?: boolean; [key: string]: unknown }>
    [key: string]: unknown
  }
  learning?: {
    teachingSessionId?: string
    currentTaskTitle?: string
    currentMilestoneTitle?: string
    taskRuntime?: { taskTitle?: string; [key: string]: unknown }
    conversationHistory?: CockpitMessage[]
    wrapup?: WrapupSummary
    learnerState?: unknown
    [key: string]: unknown
  }
  path_review?: PathReviewInfo
  experimentSnapshot?: {
    simulators?: {
      goal?: {
        route?: { providerId?: string; credentialFingerprint?: string; endpoint?: string; model?: string; [key: string]: unknown }
        temperature?: number
        maxTokens?: number
        [key: string]: unknown
      }
      learning?: {
        route?: { providerId?: string; credentialFingerprint?: string; endpoint?: string; model?: string; [key: string]: unknown }
        temperature?: number
        maxTokens?: number
        [key: string]: unknown
      }
      [key: string]: unknown
    }
    actorProfile?: unknown
    frictionBudget?: string
    simulatorPrompts?: { goal?: unknown; learning?: unknown; [key: string]: unknown }
    [key: string]: unknown
  }
  simulationConfig?: { frictionBudget?: string; [key: string]: unknown }
  [key: string]: unknown
}

interface VirtualSessionDetail {
  id?: string
  currentStage?: string
  status?: string
  bindings?: SessionBindings
  goalConversationId?: string
  learningPathId?: string
  currentTaskId?: string
  runtime?: {
    bindings?: SessionBindings
    story?: { storyId?: string; [key: string]: unknown }
    stageStatus?: {
      path?: { review?: PathReviewInfo; [key: string]: unknown }
      learning?: { wrapup?: WrapupSummary; [key: string]: unknown }
      [key: string]: unknown
    }
    [key: string]: unknown
  }
  stageResults?: SessionStageResults
  conversations?: {
    goal?: { messages?: CockpitMessage[]; [key: string]: unknown }
    learning?: { messages?: CockpitMessage[]; [key: string]: unknown }
    [key: string]: unknown
  }
  storyContext?: { title?: string; storyTitle?: string; storyId?: string; [key: string]: unknown }
  profile?: { id?: string; name?: string; [key: string]: unknown }
  profileId?: string
  virtualLearnerId?: string
  [key: string]: unknown
}

interface VirtualSessionPathData {
  status?: string
  path?: { milestones?: PathMilestone[]; [key: string]: unknown }
  milestones?: PathMilestone[]
  [key: string]: unknown
}

interface BlackboxSnapshot {
  experiment?: { experimentId?: string; runId?: string; mode?: string; [key: string]: unknown }
  observation?: BlackboxObservation
  latestRefereeReport?: EvaluationReportEnvelope
  latestActorAuditReport?: EvaluationReportEnvelope
  refereeTraceCount?: number
  refereeReportCount?: number
  actorAuditReportCount?: number
  publicTrace?: BlackboxTraceEntry[]
  control?: { goalCompleted?: boolean; runCompleted?: boolean; [key: string]: unknown }
  [key: string]: unknown
}

const getErrorMessage = (error: unknown, fallback: string) => {
  const message = (error as { message?: unknown } | null)?.message
  return typeof message === 'string' && message ? message : fallback
}

// res.data.error 可能是字符串也可能是 { message } 对象，直接 new Error(obj) 会得到 "[object Object]"
const getApiErrorMessage = (error: unknown, fallback: string) => {
  if (typeof error === 'string' && error) return error
  return getErrorMessage(error, fallback)
}

const router = useRouter()
const route = useRoute()
// 响应式路由参数：同组件切换 sessionId（如重跑新 Run）时由 watch 触发重新加载
const sessionId = computed(() => route.params.sessionId as string)

/* ===== Reactive state ===== */
const session = ref<VirtualSessionDetail | null>(null)
const loading = ref(false)
const logEntries = ref<LogEntry[]>([])
const profileName = ref('')

const loadingStep = ref(false)
const loadingAuto = ref(false)
const loadingBridge = ref(false)
const loadingWrapup = ref(false)
const loadingReferee = ref(false)
const loadingRerun = ref(false)
const blackboxSnapshot = ref<BlackboxSnapshot | null>(null)
const logsPollingDisabled = ref(false)

const activeNav = ref<NavKey>('goal')
const activeDetailTab = ref<'bindings' | 'json'>('bindings')
// 标志: 用户主动切换 nav 后, watch 不再强制同步到 currentStage（声明需先于下方各 handler 的首次引用）
const navManuallyOverridden = ref(false)

const cockpitConfig = ref<CockpitConfig>({
  maxRounds: 20,
  maxMilestones: 10,
  autoAdvanceToPath: false,
  autoAdvanceToLearning: false,
  continueOnTaskComplete: true,
  frictionBudget: 'normal'
})

/* ===== Computed session properties ===== */
const currentStage = computed(() => session.value?.currentStage || 'goal')
const status = computed(() => session.value?.status || 'created')
const bindings = computed((): SessionBindings => {
  const s = session.value
  if (!s) return {}
  const b: SessionBindings = s.bindings || s.runtime?.bindings || {}
  return {
    goalConversationId: b.goalConversationId || s.goalConversationId,
    learningPathId: b.learningPathId || s.learningPathId,
    currentTaskId: b.currentTaskId || s.currentTaskId,
    teachingSessionId: b.teachingSessionId || s.stageResults?.learning?.teachingSessionId
  }
})

const stageResults = computed((): SessionStageResults => session.value?.stageResults || {})
const isBlackboxMode = computed(() => stageResults.value?.experiment?.mode === 'blackbox-api')
const experimentMeta = computed(() => blackboxSnapshot.value?.experiment || stageResults.value?.experiment || null)
const latestBlackboxObservation = computed(() => blackboxSnapshot.value?.observation || stageResults.value?.blackbox?.publicTrace?.slice(-1)[0]?.observation || null)
const latestBlackboxPathObservation = computed(() => {
  const trace = stageResults.value?.blackbox?.publicTrace
  if (!Array.isArray(trace)) return latestBlackboxObservation.value?.stage === 'path' ? latestBlackboxObservation.value : null
  return [...trace].reverse().find((entry) => entry?.observation?.stage === 'path' && entry?.observation?.visiblePath)?.observation || null
})
const latestRefereeReport = computed(() => {
  if (blackboxSnapshot.value?.latestRefereeReport) return blackboxSnapshot.value.latestRefereeReport
  const reports = stageResults.value?.blackbox?.refereeReports
  if (!Array.isArray(reports)) return null
  const latestId = stageResults.value?.blackbox?.latestRefereeReportId
  return reports.find((item) => item.id === latestId) || reports[reports.length - 1] || null
})
const latestActorAuditReport = computed(() => {
  if (blackboxSnapshot.value?.latestActorAuditReport) return blackboxSnapshot.value.latestActorAuditReport
  const reports = stageResults.value?.blackbox?.actorAuditReports
  if (!Array.isArray(reports)) return null
  const latestId = stageResults.value?.blackbox?.latestActorAuditReportId
  return reports.find((item) => item.id === latestId) || reports[reports.length - 1] || null
})
const refereeTraceCount = computed(() => blackboxSnapshot.value?.refereeTraceCount || stageResults.value?.blackbox?.refereeTrace?.length || 0)
const publicTraceCount = computed(() => blackboxSnapshot.value?.publicTrace?.length || stageResults.value?.blackbox?.publicTrace?.length || 0)
const refereeReportCount = computed(() => blackboxSnapshot.value?.refereeReportCount || stageResults.value?.blackbox?.refereeReports?.length || 0)
const actorAuditReportCount = computed(() => blackboxSnapshot.value?.actorAuditReportCount || stageResults.value?.blackbox?.actorAuditReports?.length || 0)
const isTerminal = computed(() => ['completed', 'failed', 'abandoned'].includes(status.value))
const isRerunAvailable = computed(() => {
  const snapshot = stageResults.value?.experimentSnapshot
  const simulators = [snapshot?.simulators?.goal, snapshot?.simulators?.learning]
  return !!snapshot?.actorProfile
    && !!snapshot?.frictionBudget
    && typeof snapshot?.simulatorPrompts?.goal === 'string'
    && typeof snapshot?.simulatorPrompts?.learning === 'string'
    && simulators.every((item) => item?.route?.providerId
      && item?.route?.credentialFingerprint
      && item?.route?.endpoint
      && item?.route?.model
      && Number.isFinite(item?.temperature)
      && Number.isFinite(item?.maxTokens))
})
const blackboxMessagesFor = (stage: 'goal' | 'learning') => {
  const trace = stageResults.value?.blackbox?.publicTrace
  if (!Array.isArray(trace)) return []
  return trace
    .filter((entry) => entry?.observation?.stage === stage)
    .flatMap((entry) => entry?.observation?.visibleMessages || [])
}

/* Goal */
const goalReady = computed(() => {
  if (!session.value) return false
  const g = stageResults.value?.goal
  const stage = g?.finalStage || g?.stage
  if (['ready', 'completed'].includes(stage || '')) return true
  return !!bindings.value.goalConversationId && !!bindings.value.learningPathId
})

const goalStageLabel = computed(() => {
  const g = stageResults.value?.goal
  return g?.finalStage || g?.stage || null
})

const goalConversation = computed<CockpitMessage[]>(() => {
  if (isBlackboxMode.value) {
    return blackboxMessagesFor('goal').map((m) => ({
      role: m.role === 'learner' ? 'learner' : 'assistant',
      content: m.content || '',
      signals: null
    }))
  }
  const conv = session.value?.conversations?.goal?.messages
  if (Array.isArray(conv) && conv.length) return conv
  const raw = stageResults.value?.goal?.conversationHistory
  return Array.isArray(raw) ? raw.map((m) => ({
    role: m.role === 'user' ? 'learner' : m.role === 'assistant' ? 'assistant' : m.role,
    content: m.content || m.text || '',
    signals: null
  })) : []
})

const concernPool = computed<Array<{ label: string; disclosed: boolean }> | null>(() => {
  const pool = stageResults.value?.goal?.concernPool
  if (pool && typeof pool === 'object') {
    return Object.entries(pool).map(([k, v]) => ({
      label: k,
      disclosed: v?.disclosed || false
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

const pathData = ref<VirtualSessionPathData | null>(null)
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
    || (Array.isArray(trace) && trace.some((entry) => entry?.observation?.stage === 'learning'))
})
const currentTaskId = computed(() => bindings.value.currentTaskId)
const currentTaskTitle = computed(() => {
  return latestBlackboxObservation.value?.visibleTask?.title || stageResults.value?.learning?.currentTaskTitle || stageResults.value?.learning?.taskRuntime?.taskTitle || null
})
const currentMilestoneTitle = computed(() => {
  return stageResults.value?.learning?.currentMilestoneTitle || null
})

const learnConversation = computed<CockpitMessage[]>(() => {
  if (isBlackboxMode.value) {
    return blackboxMessagesFor('learning').map((m) => ({
      role: m.role === 'learner' ? 'learner' : 'assistant',
      content: m.content || '',
      closureDecision: null
    }))
  }
  const conv = session.value?.conversations?.learning?.messages
  if (Array.isArray(conv) && conv.length) return conv
  const raw = stageResults.value?.learning?.conversationHistory
  return Array.isArray(raw) ? raw.map((m) => ({
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
  const stages = new Set<string | undefined>()
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
    ...(latestRefereeReport.value && latestActorAuditReport.value ? ['referee'] : [])
  ])
})
const liveNav = computed(() => {
  if (isBlackboxMode.value && isTerminal.value) return 'referee'
  return stageOrder.value.includes(currentStage.value as 'goal' | 'path' | 'learning') ? currentStage.value : 'goal'
})
const stageIndex = computed(() => Math.max(stageOrder.value.indexOf(liveNav.value as 'goal' | 'path' | 'learning'), 0))

const stageStripItems = computed(() => {
  return stageOrder.value.map((key, idx) => {
    const done = isBlackboxMode.value ? blackboxCompletedStages.value.has(key) : idx < stageIndex.value || status.value === 'completed'
    const reached = key === 'goal' || blackboxReachedStages.value.has(key)
    const unlocked = !isBlackboxMode.value
      ? idx <= stageIndex.value
      : reached || (key === 'referee' && isTerminal.value)
    return {
      key,
      label: key === 'goal' ? 'Goal' : key === 'path' ? 'Path' : key === 'learning' ? 'Learn' : key === 'referee' ? 'Referee' : 'Wrapup',
      done,
      disabled: !unlocked,
      statusLabel: done ? '已完成'
        : key === liveNav.value ? '当前阶段'
          : isBlackboxMode.value && reached ? '已到达'
            : isBlackboxMode.value && isTerminal.value ? '未到达' : '待进入'
    }
  })
})

const detailTabs = computed(() => [
  { key: 'bindings' as const, label: '当前绑定' },
  ...(!isBlackboxMode.value || isTerminal.value ? [{ key: 'json' as const, label: '原始数据' }] : [])
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

const actorAuditVerdictLabel = computed(() => {
  const verdict = latestActorAuditReport.value?.report?.verdict
  return verdict === 'credible' ? '可信'
    : verdict === 'credible_with_concerns' ? '基本可信'
      : verdict === 'invalid' ? '无效' : '证据不足'
})

const actorAuditScoreItems = computed(() => {
  const scores = latestActorAuditReport.value?.report?.scores || {}
  return [
    { label: '画像一致', value: scores.personaConsistency },
    { label: '故事一致', value: scores.storyConsistency },
    { label: '披露节奏', value: scores.disclosureDiscipline },
    { label: '摩擦校准', value: scores.frictionCalibration },
    { label: '状态连续', value: scores.stateContinuity },
    { label: '行为可信', value: scores.behaviorPlausibility },
    { label: '证据充分', value: scores.evidenceSufficiency }
  ]
})

const experimentConclusionLabel = computed(() => {
  const platform = latestRefereeReport.value?.report?.verdict
  const actor = latestActorAuditReport.value?.report?.verdict
  if (!platform || !actor) return '待完成双评估'
  if (actor === 'invalid') return '模拟无效，建议重跑'
  if (actor === 'inconclusive') return '角色证据不足'
  if (platform === 'fail') return '可信的平台缺陷'
  if (platform === 'inconclusive') return '平台证据不足'
  if (platform === 'pass_with_concerns' || actor === 'credible_with_concerns') return '实验有效，有改进项'
  return '实验有效通过'
})

const overviewTitle = computed(() => {
  return session.value?.storyContext?.title
    || session.value?.storyContext?.storyTitle
    || profileName.value
    || '虚拟学习者会话'
})

const overviewLead = computed(() => {
  if (isBlackboxMode.value && isTerminal.value) {
    if (latestRefereeReport.value && latestActorAuditReport.value) return experimentConclusionLabel.value
    return '实验已结束，等待生成平台质量与角色保真双评估。'
  }
  if (status.value === 'failed') return '会话执行失败，请查看当前阶段输出和运行日志。'
  const message = latestBlackboxObservation.value?.lastActionResult?.visibleMessage
  if (message) return message
  if (currentTaskTitle.value) return `正在学习：${currentTaskTitle.value}`
  if (pathReady.value) return '学习路径已就绪，可继续进入教学阶段。'
  if (goalReady.value) return '学习目标已收敛，正在准备学习路径。'
  return '从全局进度进入任一已开放阶段，查看对话、路径、教学与评估证据。'
})

const overviewFacts = computed(() => {
  const taskCount = milestones.value.reduce((sum: number, milestone) => sum + (Array.isArray(milestone?.subtasks) ? milestone.subtasks.length : 0), 0)
  const currentStageLabel = stageStripItems.value.find(item => item.key === liveNav.value)?.label || currentStage.value
  const outputTitle = latestBlackboxObservation.value?.visibleTask?.title
    || latestBlackboxObservation.value?.visiblePath?.title
    || latestBlackboxPathObservation.value?.visiblePath?.title
    || currentTaskTitle.value
    || (milestones.value.length ? `${milestones.value.length} 个里程碑的学习路径` : '暂无公开产物')

  if (isBlackboxMode.value) {
    const platformScore = latestRefereeReport.value?.report?.scores?.overall
    const actorScore = latestActorAuditReport.value?.report?.scores?.overall
    return [
      { label: '当前定位', value: `${currentStageLabel} · ${statusText.value}`, meta: `${blackboxCompletedStages.value.size}/${stageOrder.value.length} 阶段完成` },
      { label: '最新产物', value: outputTitle, meta: latestBlackboxObservation.value?.stage ? `来自 ${latestBlackboxObservation.value.stage}` : '等待平台输出' },
      { label: '路径规模', value: milestones.value.length ? `${milestones.value.length} 个里程碑` : '尚无 Path', meta: taskCount ? `${taskCount} 个学习任务` : milestones.value.length ? '路径结果已生成' : '等待路径结果' },
      { label: '终局评估', value: platformScore != null && actorScore != null ? `${platformScore} / ${actorScore}` : '待双评估', meta: '平台质量 / 角色保真' }
    ]
  }

  return [
    { label: '当前定位', value: `${currentStageLabel} · ${statusText.value}`, meta: `${Math.min(stageIndex.value + 1, stageOrder.value.length)}/${stageOrder.value.length} 阶段` },
    { label: 'Goal 对话', value: `${goalConversation.value.length} 轮消息`, meta: goalReady.value ? '目标已收敛' : '目标对齐中' },
    { label: '路径规模', value: milestones.value.length ? `${milestones.value.length} 个里程碑` : '尚无 Path', meta: taskCount ? `${taskCount} 个学习任务` : '等待路径结果' },
    { label: 'Learn 进展', value: `${learnConversation.value.length} 轮消息`, meta: wrapupSummary.value ? '总结已生成' : learningStarted.value ? '教学进行中' : '尚未开始' }
  ]
})

const findingEvidence = (report: EvaluationReportEnvelope | null, finding: { evidenceIds?: Array<string | number> }) => {
  const ids: Set<unknown> = new Set(Array.isArray(finding?.evidenceIds) ? finding.evidenceIds : [])
  return (Array.isArray(report?.report?.evidence) ? report.report.evidence : []).filter((item) => ids.has(item.id))
}

const findingTagType = (severity?: string) => severity === 'critical' ? 'danger'
  : severity === 'major' ? 'warning' : severity === 'minor' ? 'info' : 'success'

/* ===== Data loading ===== */
const loadSession = async () => {
  loading.value = true
  try {
    const res = await adminApi.getVirtualSession(sessionId.value)
    if (!res.data?.success) throw new Error(getApiErrorMessage(res.data?.error, '加载失败'))
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
  } catch (error) {
    ElMessage.error(getErrorMessage(error, '加载会话失败'))
  } finally {
    loading.value = false
  }
}

const loadPathStatus = async () => {
  try {
    const res = await adminApi.getVirtualSessionPathStatus(sessionId.value)
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
    const res = await adminApi.getVirtualSessionLogs(sessionId.value)
    const logs = res.data?.data?.logs
    if (res.data?.success && Array.isArray(logs)) {
      logsPollingDisabled.value = false
      logEntries.value = logs.map((l: { id?: string; _id?: string; createdAt?: string; timestamp?: string; phase?: string; level?: string; message?: string; content?: string }) => ({
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
  await runner(sessionId.value)
}

const handleStep = async () => {
  navManuallyOverridden.value = false
  if (isBlackboxMode.value) {
    loadingStep.value = true
    try {
      const res = await adminApi.blackboxVirtualSessionStep(sessionId.value, publicTraceCount.value)
      if (!res.data?.success) throw new Error(getApiErrorMessage(res.data?.error, '黑盒单步失败'))
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
        if (!res.data?.success) throw new Error(getApiErrorMessage(res.data?.error, '单步失败'))
      })
      await loadSession()
    } catch (error) {
      ElMessage.error(getErrorMessage(error, 'Goal 单步失败'))
    } finally {
      loadingStep.value = false
    }
  } else if (currentStage.value === 'learning') {
    loadingStep.value = true
    try {
      await withSession(async (sid) => {
        const res = await adminApi.virtualSessionLearningStep(sid)
        if (!res.data?.success) throw new Error(getApiErrorMessage(res.data?.error, '单步失败'))
      })
      await loadSession()
    } catch (error) {
      ElMessage.error(getErrorMessage(error, 'Learn 单步失败'))
    } finally {
      loadingStep.value = false
    }
  }
}

const handleGenerateReferee = async () => {
  navManuallyOverridden.value = false
  loadingReferee.value = true
  try {
    const res = await adminApi.generateBlackboxEvaluations(sessionId.value)
    if (!res.data?.success) throw new Error(getApiErrorMessage(res.data?.error, '终局评估生成失败'))
    const reused = res.data?.data?.platform?.reused && res.data?.data?.actor?.reused
    ElMessage.success(reused ? '已复用当前双评估' : '双评估已生成')
    await loadBlackboxSnapshot()
    activeNav.value = 'referee'
  } catch (error: any) {
    ElMessage.error(error.response?.data?.error || error.message || '终局评估生成失败')
  } finally {
    loadingReferee.value = false
  }
}

const handleRerun = async () => {
  if (!isRerunAvailable.value) return
  try {
    await ElMessageBox.confirm('将使用本次实验创建时固化的 Persona、Story、摩擦预算、Prompt 和模型路由创建新 Run。旧轨迹与报告不会修改。', '按原输入重跑', {
      type: 'info',
      confirmButtonText: '创建新 Run',
      cancelButtonText: '取消'
    })
    loadingRerun.value = true
    const res = await adminApi.rerunBlackboxVirtualSession(sessionId.value)
    const nextSessionId = res.data?.data?.id || res.data?.data?.sessionId
    if (!res.data?.success || !nextSessionId) throw new Error(getApiErrorMessage(res.data?.error, '重跑创建失败'))
    ElMessage.success('新 Run 已创建')
    // 路由参数变化由 watch(sessionId) 触发状态重置与重新加载，无需整页刷新
    await router.replace(`/admin/virtual-session/${nextSessionId}`)
  } catch (error: any) {
    if (error !== 'cancel') ElMessage.error(error.response?.data?.error || error.message || '重跑创建失败')
  } finally {
    loadingRerun.value = false
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
          if (!res.data?.success) throw new Error(getApiErrorMessage(res.data?.error, '一键全流程失败'))
        })
      } else {
        await withSession(async (sid) => {
          const res = await adminApi.virtualSessionAuto(sid, { maxRounds: cockpitConfig.value.maxRounds })
          if (!res.data?.success) throw new Error(getApiErrorMessage(res.data?.error, '自动失败'))
        })
        // auto-advance to path
        await loadSession()
        if (cockpitConfig.value.autoAdvanceToPath && goalReady.value && !bindings.value.learningPathId) {
          await handleAdvancePath()
        }
      }
      await loadSession()
    } catch (error) {
      ElMessage.error(getErrorMessage(error, 'Goal 自动失败'))
    } finally {
      loadingAuto.value = false
    }
  } else if (currentStage.value === 'learning') {
    loadingAuto.value = true
    try {
      await withSession(async (sid) => {
        const res = await adminApi.virtualSessionAutoLearning(sid, { maxMilestones: cockpitConfig.value.maxMilestones })
        if (!res.data?.success) throw new Error(getApiErrorMessage(res.data?.error, '自动学习失败'))
      })
      await loadSession()
    } catch (error) {
      ElMessage.error(getErrorMessage(error, 'Learn 自动失败'))
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
      if (!res.data?.success) throw new Error(getApiErrorMessage(res.data?.error, '生成 Path 失败'))
    })
    await loadSession()
    await loadPathStatus()

    // auto-advance to learning
    if (cockpitConfig.value.autoAdvanceToLearning && pathReady.value) {
      await handleStartLearning()
    }
  } catch (error) {
    ElMessage.error(getErrorMessage(error, '生成 Path 失败'))
  } finally {
    loadingBridge.value = false
  }
}

const loadBlackboxSnapshot = async () => {
  try {
    const res = await adminApi.getBlackboxVirtualSnapshot(sessionId.value)
    if (res.data?.success) blackboxSnapshot.value = res.data.data
  } catch {
    blackboxSnapshot.value = null
  }
}

const handleReviewPath = async () => {
  loadingBridge.value = true
  try {
    const res = await adminApi.reviewVirtualSessionPath(sessionId.value)
    if (!res.data?.success) throw new Error(getApiErrorMessage(res.data?.error, 'Path 评审失败'))
    const result = res.data.data
    ElMessage.success(result?.decision === 'accept' ? 'Path 已接受，已进入 Learn' : 'Path 已根据评审反馈重规划，等待再次评审')
    await loadSession()
    await loadPathStatus()
    await loadLogs()
  } catch (error) {
    ElMessage.error(getErrorMessage(error, 'Path 评审失败'))
  } finally {
    loadingBridge.value = false
  }
}

const handleStartLearning = async () => {
  loadingBridge.value = true
  try {
    await withSession(async (sid) => {
      const res = await adminApi.startVirtualLearning(sid)
      if (!res.data?.success) throw new Error(getApiErrorMessage(res.data?.error, '启动 Learn 失败'))
    })
    activeNav.value = 'learning'
    await loadSession()
  } catch (error) {
    ElMessage.error(getErrorMessage(error, '启动 Learn 失败'))
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
      if (!res.data?.success) throw new Error(getApiErrorMessage(res.data?.error, '停止失败'))
    })
    ElMessage.success('学习已停止')
    await loadSession()
  } catch (error) {
    if (error !== 'cancel') ElMessage.error(getErrorMessage(error, '停止失败'))
  }
}

const handleAbandon = async () => {
  try {
    await ElMessageBox.confirm('确认放弃本次黑盒实验？当前轨迹会保留，并可继续生成终局双评估。', '放弃实验', {
      type: 'warning',
      confirmButtonText: '放弃实验',
      cancelButtonText: '继续运行'
    })
    const res = await adminApi.executeBlackboxVirtualAction(sessionId.value, {
      type: 'abandon',
      reason: '管理员在实验控制台主动放弃'
    }, publicTraceCount.value)
    if (!res.data?.success) throw new Error(getApiErrorMessage(res.data?.error, '放弃实验失败'))
    ElMessage.success('实验已放弃，轨迹已保留')
    await loadSession()
  } catch (error: any) {
    if (error !== 'cancel') ElMessage.error(error.response?.data?.error || error.message || '放弃实验失败')
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
      if (!res.data?.success) throw new Error(getApiErrorMessage(res.data?.error, '重建 Path 失败'))
    })
    ElMessage.success('Path 已重建')
    await loadSession()
    await loadPathStatus()
  } catch (error) {
    if (error !== 'cancel') ElMessage.error(getErrorMessage(error, '重建 Path 失败'))
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
      if (!res.data?.success) throw new Error(getApiErrorMessage(res.data?.error, '重启 Learn 失败'))
    })
    ElMessage.success('Learn 已重启')
    await loadSession()
  } catch (error) {
    if (error !== 'cancel') ElMessage.error(getErrorMessage(error, '重启 Learn 失败'))
  }
}

const handleGenerateWrapup = async () => {
  loadingWrapup.value = true
  try {
    await withSession(async (sid) => {
      const res = await adminApi.virtualSessionWrapup(sid)
      if (!res.data?.success) throw new Error(getApiErrorMessage(res.data?.error, '生成总结失败'))
    })
    ElMessage.success('总结已生成')
    await loadSession()
  } catch (error) {
    ElMessage.error(getErrorMessage(error, '生成总结失败'))
  } finally {
    loadingWrapup.value = false
  }
}

const handleDeleteSession = async () => {
  try {
    await ElMessageBox.confirm('确认删除此会话？此操作不可撤销。', '删除会话', { type: 'warning' })
    await withSession(async (sid) => {
      const res = await adminApi.deleteVirtualSession(sid)
      if (!res.data?.success) throw new Error(getApiErrorMessage(res.data?.error, '删除失败'))
    })
    ElMessage.success('会话已删除')
    backToStory()
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(getErrorMessage(error, '删除失败'))
    }
  }
}

// 可变参数签名以兼容子组件 emit 校验（vue-tsc 2.x 严格变体检查），内部按 CockpitConfig 使用
const handleConfigChange = async (...args: unknown[]) => {
  if (isBlackboxMode.value) return
  const config = args[0] as CockpitConfig
  const prevFriction = cockpitConfig.value.frictionBudget
  cockpitConfig.value = { ...cockpitConfig.value, ...config }
  // 仅 frictionBudget 变化时持久化到后端 session
  if (config.frictionBudget && config.frictionBudget !== prevFriction) {
    try {
      await adminApi.updateSessionSimulationConfig(sessionId.value, {
        frictionBudget: config.frictionBudget
      })
    } catch (err) {
      ElMessage.warning(`对抗预算保存失败: ${getErrorMessage(err, String(err))}`)
    }
  }
}

/* ===== Navigation ===== */
const selectStage = (key: string) => {
  activeNav.value = key as NavKey
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

watch(currentStage, async (stage) => {
  if (!isBlackboxMode.value && (stage === 'path' || stage === 'learning' || stage === 'wrapup')) {
    await loadPathStatus()
  }
  if (!navManuallyOverridden.value && stageOrder.value.includes(stage as 'goal' | 'path' | 'learning')) {
    activeNav.value = stage as NavKey
  }
})

watch(status, (newStatus) => {
  if (['completed', 'failed', 'abandoned'].includes(newStatus)) {
    activeNav.value = isBlackboxMode.value ? 'referee' : 'wrapup'
    navManuallyOverridden.value = false
  }
})

// 同组件切换 sessionId（如重跑产生新 Run 后 router.replace）时重置状态并重新加载，避免沿用旧会话数据
watch(sessionId, async (next, prev) => {
  if (!next || next === prev) return
  session.value = null
  logEntries.value = []
  blackboxSnapshot.value = null
  pathData.value = null
  pathStatus.value = 'idle'
  profileName.value = ''
  activeNav.value = 'goal'
  activeDetailTab.value = 'bindings'
  navManuallyOverridden.value = false
  await loadSession()
  await loadLogs()
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

.session-overview {
  display: grid;
  overflow: hidden;
  border: 1px solid #d7e0eb;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 8px 24px rgba(37, 58, 87, 0.06);
}

.session-overview--terminal {
  border-color: #cbd8e8;
}

.session-overview__headline {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  padding: 20px 22px 17px;
  background: linear-gradient(105deg, #f8fbff 0%, #ffffff 62%);
}

.session-overview__headline > div:first-child {
  min-width: 0;
}

.session-overview__eyebrow {
  color: #50709a;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.12em;
}

.session-overview__headline h2 {
  margin: 5px 0 4px;
  color: #172b49;
  font-size: 20px;
  line-height: 1.3;
}

.session-overview__headline p {
  max-width: 780px;
  margin: 0;
  color: #64748b;
  font-size: 12px;
  line-height: 1.6;
}

.session-overview__tags {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 8px;
}

.overview-stage-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border-top: 1px solid #e4eaf1;
  border-bottom: 1px solid #e4eaf1;
  background: #f8fafc;
}

.overview-stage {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 12px 16px;
  border: 0;
  border-right: 1px solid #e4eaf1;
  background: transparent;
  color: #667085;
  cursor: pointer;
  font: inherit;
  text-align: left;
  transition: background 0.18s ease, color 0.18s ease;
}

.overview-stage:last-child {
  border-right: 0;
}

.overview-stage:not(:disabled):hover {
  background: #eef4fd;
}

.overview-stage.active {
  background: #edf4ff;
  box-shadow: inset 0 -2px 0 #3478f6;
}

.overview-stage.disabled {
  cursor: not-allowed;
  opacity: 0.52;
}

.overview-stage__index {
  display: grid;
  flex: 0 0 26px;
  width: 26px;
  height: 26px;
  place-items: center;
  border: 1px solid #cdd7e4;
  border-radius: 50%;
  background: #ffffff;
  color: #7a8798;
  font-size: 11px;
  font-weight: 800;
}

.overview-stage.current .overview-stage__index,
.overview-stage.active .overview-stage__index {
  border-color: #3478f6;
  background: #3478f6;
  color: #ffffff;
}

.overview-stage.done .overview-stage__index {
  border-color: #72c18c;
  background: #eaf8ef;
  color: #168544;
}

.overview-stage__copy {
  display: grid;
  min-width: 0;
  gap: 1px;
}

.overview-stage__copy strong {
  color: #273b57;
  font-size: 12px;
}

.overview-stage__copy small {
  color: #8b96a7;
  font-size: 10px;
}

.session-overview__facts {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  padding: 17px 22px;
}

.overview-fact {
  display: grid;
  min-width: 0;
  gap: 4px;
  padding: 0 18px;
  border-right: 1px solid #e8edf3;
}

.overview-fact:first-child {
  padding-left: 0;
}

.overview-fact:last-child {
  padding-right: 0;
  border-right: 0;
}

.overview-fact span,
.overview-fact small {
  overflow: hidden;
  color: #8792a3;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.overview-fact strong {
  overflow: hidden;
  color: #1a2a44;
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-overview__footer {
  display: flex;
  align-items: center;
  gap: 7px 12px;
  flex-wrap: wrap;
  padding: 8px 22px;
  border-top: 1px solid #edf1f5;
  background: #fbfcfe;
  color: #7a8798;
  font-size: 10px;
}

.session-overview__footer code,
.blackbox-action-list code {
  color: #496480;
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

.referee-report,
.evaluation-report {
  display: grid;
  gap: 18px;
}

.evaluation-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  align-items: start;
}

.evaluation-conclusion {
  grid-column: 1 / -1;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid #dbe5f0;
  border-radius: 8px;
  background: #f8fafc;
}

.evaluation-conclusion span {
  color: #7a8597;
  font-size: 11px;
  font-weight: 700;
}

.evaluation-conclusion strong {
  color: #1a2a44;
  font-size: 14px;
}

.evaluation-report {
  min-width: 0;
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

.finding-evidence {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed #dbe5f0;
}

.finding-evidence summary {
  cursor: pointer;
  color: #5b6577;
  font-size: 11px;
  font-weight: 700;
}

.finding-evidence > div {
  display: grid;
  gap: 3px;
  margin-top: 8px;
}

.finding-evidence code {
  color: #36516f;
  font-size: 10px;
  word-break: break-all;
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

.referee-score-grid--actor {
  grid-template-columns: repeat(4, minmax(0, 1fr));
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

  .evaluation-grid {
    grid-template-columns: 1fr;
  }

  .session-overview__facts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px 0;
  }

  .overview-fact:nth-child(2) {
    border-right: 0;
  }

  .overview-fact:nth-child(3) {
    padding-left: 0;
  }
}

@media (max-width: 760px) {
  .session-overview__headline,
  .referee-report__hero {
    align-items: stretch;
    flex-direction: column;
  }

  .session-overview__headline {
    padding: 17px 16px;
  }

  .overview-stage-strip {
    grid-template-columns: repeat(4, minmax(112px, 1fr));
    overflow-x: auto;
  }

  .overview-stage,
  .detail-tabs {
    overflow-x: auto;
  }

  .overview-stage {
    padding: 10px 12px;
  }

  .session-overview__facts {
    grid-template-columns: 1fr;
    gap: 0;
    padding: 8px 16px;
  }

  .overview-fact,
  .overview-fact:first-child,
  .overview-fact:nth-child(3),
  .overview-fact:last-child {
    padding: 10px 0;
    border-right: 0;
    border-bottom: 1px solid #edf1f5;
  }

  .overview-fact:last-child {
    border-bottom: 0;
  }

  .session-overview__footer {
    padding: 9px 16px;
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
