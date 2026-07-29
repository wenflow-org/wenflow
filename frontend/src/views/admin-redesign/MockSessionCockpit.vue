<template>
  <div class="mk-page cp">
    <button type="button" class="cp-back" @click="closeSubPage">← 画像</button>

    <div v-if="toast" class="mk-toast" :class="toastCls">{{ toast }}</div>

    <!-- 控制台状态条 -->
    <div class="mk-status" :class="statusTone">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">{{ statusTitle }}</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta mono">{{ shortId }}</span>
      <span class="mk-status__meta">{{ modeText }}</span>
      <span class="mk-status__meta">{{ statusText(session?.status) }}</span>
      <template v-if="isBlackbox">
        <span class="mk-status__meta">{{ blackboxTraceCount }} 条公开轨迹</span>
        <span class="mk-status__meta">{{ refereeTraceCount }} 条裁判轨迹</span>
        <span class="mk-status__meta">{{ privateStateTraceCount }} 条角色私有状态</span>
        <span v-if="refereeReports.length + actorAuditReports.length" class="mk-status__meta">
          {{ refereeReports.length + actorAuditReports.length }} 份终局评估
        </span>
      </template>
      <button type="button" class="mk-status__action" :disabled="busy" @click="refresh">刷新</button>
      <button type="button" class="mk-status__action cp-danger" :disabled="busy" @click="removeSession">删除会话</button>
    </div>

    <!-- 阶段进度 -->
    <div class="cp-stages">
      <template v-for="(st, i) in stageFlow" :key="st">
        <div class="cp-stage" :class="stageCls(st)">
          <span class="cp-stage__order">{{ String(i + 1).padStart(2, '0') }}</span>
          <strong>{{ stageLabel(st) }}</strong>
          <span class="cp-stage__state">{{ stageState(st) }}</span>
        </div>
        <span v-if="i < stageFlow.length - 1" class="cp-stage__arrow">→</span>
      </template>
    </div>

    <div class="cp-grid">
      <!-- 控制面板 -->
      <section class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">推进控制</h3>
          <span class="mk-card__meta">{{ isBlackbox ? '黑盒 API' : '辅助模拟' }}</span>
        </div>
        <div class="cp-controls">
          <button type="button" class="cp-btn" :disabled="stepDisabled" :title="stepTitle" @click="act('step')">
            {{ currentStage === 'learning' && !isBlackbox ? 'Learn 单步' : '单步推进' }}
          </button>
          <button type="button" class="cp-btn" :disabled="autoDisabled" :title="autoTitle" @click="act('auto')">
            {{ currentStage === 'learning' ? '自动完成本课' : '自动到阶段末' }}
          </button>
          <button type="button" class="cp-btn cp-btn--primary" :disabled="runFullDisabled" :title="runFullTitle" @click="act('runFull')">一键全流程</button>
          <button type="button" class="cp-btn" :disabled="advancePathDisabled" :title="advancePathTitle" @click="act('advancePath')">生成 Path</button>
          <button type="button" class="cp-btn" :disabled="reviewPathDisabled" :title="reviewPathTitle" @click="act('reviewPath')">评审 Path</button>
          <button type="button" class="cp-btn" :disabled="startLearningDisabled" :title="startLearningTitle" @click="act('startLearning')">启动 Learn</button>
          <button type="button" class="cp-btn" :disabled="wrapupDisabled" :title="wrapupTitle" @click="act('wrapup')">生成总结</button>
          <button type="button" class="cp-btn" :disabled="stopLearningDisabled" :title="stopLearningTitle" @click="act('stop')">停止 Learn</button>
          <button type="button" class="cp-btn" :disabled="resetPathDisabled" :title="resetPathTitle" @click="act('resetPath')">重建 Path</button>
          <button type="button" class="cp-btn" :disabled="resetLearningDisabled" :title="resetLearningTitle" @click="act('resetLearn')">重启 Learn</button>
          <button v-if="isBlackbox && !isTerminal" type="button" class="cp-btn cp-danger-btn" :disabled="busy" :title="busy ? '操作执行中' : '终止当前黑盒实验'" @click="act('abandon')">放弃实验</button>
          <button v-if="isBlackbox && isTerminal" type="button" class="cp-btn cp-btn--primary" :disabled="busy" :title="busy ? '操作执行中' : '生成终局裁判评估'" @click="act('referee')">生成裁判评估</button>
          <button v-if="isBlackbox && isTerminal" type="button" class="cp-btn" :disabled="busy" :title="busy ? '操作执行中' : '以相同输入创建新的实验会话'" @click="act('rerun')">按原输入重跑</button>
        </div>
        <div v-if="!isBlackbox" class="cp-config">
          <label>
            对抗预算
            <select v-model="frictionBudget" class="mk-filter__select" @change="saveFriction">
              <option value="none">无</option>
              <option value="low">低</option>
              <option value="normal">正常</option>
              <option value="high">高</option>
              <option value="stress_test">压力测试</option>
            </select>
          </label>
        </div>

        <!-- 阶段摘要 -->
        <div class="cp-summary">
          <div v-if="goalInfo" class="cp-summary__item">
            <span>Goal 对话</span>
            <p>{{ goalInfo }}</p>
          </div>
          <div v-if="pathInfo" class="cp-summary__item">
            <span>Path</span>
            <p>{{ pathInfo }}</p>
          </div>
          <div v-if="learnInfo" class="cp-summary__item">
            <span>Learn</span>
            <p>{{ learnInfo }}</p>
          </div>
          <p v-if="!goalInfo && !pathInfo && !learnInfo" class="cp-none">会话刚启动，推进后这里显示各阶段摘要。</p>
          <div v-if="showPathReadiness" class="cp-path-readiness" :class="`cp-path-readiness--${pathReadinessTone}`">
            <span>Path 就绪状态</span>
            <p>{{ pathReadinessText }}</p>
          </div>
        </div>
      </section>

      <!-- 实时日志 -->
      <section class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">会话日志</h3>
          <span class="mk-card__meta">{{ isTerminal ? '已终态' : '5s 轮询' }}</span>
        </div>
        <div class="cp-logs" ref="logBox">
          <div v-for="(l, i) in logs" :key="i" class="cp-log">
            <span class="cp-log__time">{{ l.time }}</span>
            <span class="cp-log__text">{{ l.text }}</span>
          </div>
          <p v-if="!logs.length" class="cp-none">暂无日志</p>
        </div>
      </section>
    </div>

    <section v-if="!isBlackbox && (goalConversationMessages.length || learnConversationMessages.length || teachingSessionHistory.length)" class="mk-card">
      <div class="mk-card__head">
        <h3 class="mk-card__title">对话与课堂记录</h3>
        <span class="mk-card__meta">中断恢复与人工审计证据</span>
      </div>
      <div class="cp-transcripts">
        <details v-if="goalConversationMessages.length" class="cp-transcript" open>
          <summary>Goal 对话 · {{ goalConversationMessages.length }} 条</summary>
          <article
            v-for="(message, index) in goalConversationMessages"
            :key="`goal-${index}`"
            class="cp-transcript__message"
            :class="message.role === 'assistant' ? 'is-teacher' : 'is-learner'"
          >
            <span>{{ message.role === 'assistant' ? '平台 Goal' : '虚拟学习者' }}</span>
            <p>{{ message.content }}</p>
          </article>
        </details>

        <details v-if="learnConversationMessages.length || teachingSessionHistory.length" class="cp-transcript" open>
          <summary>
            Learn 课堂
            <template v-if="displayedTeachingSessionId"> · {{ displayedTeachingSessionId.slice(-8) }}</template>
            <template v-if="learnConversationMessages.length"> · {{ learnConversationMessages.length }} 条</template>
          </summary>
          <div v-if="teachingSessionHistory.length" class="cp-teaching-history">
            <button
              type="button"
              class="cp-history-btn"
              :class="{ 'is-current': !selectedTeachingSessionId }"
              @click="showCurrentTeaching"
            >
              当前课堂
            </button>
            <button
              v-for="item in teachingSessionHistory"
              :key="item.id"
              type="button"
              class="cp-history-btn"
              :class="{ 'is-current': selectedTeachingSessionId === item.id }"
              @click="showArchivedTeaching(item.id)"
            >
              {{ item.taskTitle || `课堂 ${item.id.slice(-8)}` }}
            </button>
          </div>
          <p v-if="teachingDetailLoading" class="cp-none">正在读取教学会话记录…</p>
          <article
            v-for="(message, index) in learnConversationMessages"
            :key="`learn-${index}`"
            class="cp-transcript__message"
            :class="message.role === 'assistant' ? 'is-teacher' : 'is-learner'"
          >
            <span>{{ message.role === 'assistant' ? '教师' : '虚拟学习者' }}</span>
            <p>{{ message.content }}</p>
          </article>
          <p v-if="!teachingDetailLoading && !learnConversationMessages.length" class="cp-none">该课堂暂未记录可展示消息。</p>
        </details>
      </div>
    </section>

    <!-- 裁判报告（黑盒终态） -->
    <section v-if="refereeReports.length || actorAuditReports.length" class="mk-card">
      <div class="mk-card__head">
        <h3 class="mk-card__title">终局评估</h3>
        <span class="mk-card__meta">
          平台 {{ refereeReports.length }} · 角色 {{ actorAuditReports.length }}
        </span>
      </div>

      <div v-if="refereeReports.length" class="cp-eval-group">
        <h4 class="cp-eval-group__title">平台质量裁判</h4>
        <template v-for="(r, i) in refereeReports" :key="`r-${i}`">
          <article v-if="r.report" class="cp-eval">
            <div class="cp-eval__head">
              <div>
                <strong>{{ verdictLabel(r.report.verdict) }}</strong>
                <span class="cp-eval__time">{{ formatTime(r.evaluatedAt) }}</span>
              </div>
              <span class="mk-badge" :class="verdictBadgeCls(r.report.verdict)">
                {{ formatScore(r.report.scores?.overall) }}
              </span>
            </div>
            <div v-if="r.report.scores" class="cp-eval__scores">
              <span v-for="item in scoreItems(r.report.scores, 'referee')" :key="item.label">
                <code>{{ item.label }}</code>
                <strong>{{ item.value ?? '—' }}</strong>
              </span>
            </div>
            <div v-if="r.report.findings?.length" class="cp-eval__section">
              <h5>平台发现</h5>
              <article v-for="f in r.report.findings" :key="f.code" class="cp-finding">
                <span class="cp-finding__sev" :data-sev="f.severity">{{ f.severity }}</span>
                <div>
                  <strong>{{ f.title }}</strong>
                  <p>{{ f.detail }}</p>
                  <details v-if="findingEvidence(r, f).length" class="cp-evidence">
                    <summary>证据 {{ findingEvidence(r, f).length }}</summary>
                    <div v-for="e in findingEvidence(r, f)" :key="e.id">
                      <code>{{ e.source }}{{ e.index === null ? '' : `[${e.index}]` }} · {{ e.path }}</code>
                      <p>{{ e.excerpt || e.interpretation }}</p>
                    </div>
                  </details>
                </div>
              </article>
            </div>
            <div v-if="r.report.recommendations?.length" class="cp-eval__section">
              <h5>平台建议</h5>
              <article v-for="(rec, rIdx) in r.report.recommendations" :key="`rec-${rIdx}`" class="cp-rec">
                <div class="cp-rec__head">
                  <strong>{{ rec.priority }}</strong>
                  <span v-if="rec.findingCodes?.length" class="cp-rec__codes">
                    <code v-for="c in rec.findingCodes" :key="String(c)">{{ c }}</code>
                  </span>
                </div>
                <p>{{ rec.action }}</p>
                <details v-if="rec.rationale" class="cp-rec__rationale">
                  <summary>依据</summary>
                  <p>{{ rec.rationale }}</p>
                </details>
              </article>
            </div>
          </article>
        </template>
      </div>

      <div v-if="actorAuditReports.length" class="cp-eval-group">
        <h4 class="cp-eval-group__title">角色保真审计</h4>
        <template v-for="(r, i) in actorAuditReports" :key="`a-${i}`">
          <article v-if="r.report" class="cp-eval">
            <div class="cp-eval__head">
              <div>
                <strong>{{ verdictLabel(r.report.verdict) }}</strong>
                <span class="cp-eval__time">{{ formatTime(r.evaluatedAt) }}</span>
              </div>
              <span class="mk-badge" :class="verdictBadgeCls(r.report.verdict)">
                {{ formatScore(r.report.scores?.overall) }}
              </span>
            </div>
            <div v-if="r.report.scores" class="cp-eval__scores cp-eval__scores--actor">
              <span v-for="item in scoreItems(r.report.scores, 'actor')" :key="item.label">
                <code>{{ item.label }}</code>
                <strong>{{ item.value ?? '—' }}</strong>
              </span>
            </div>
            <div v-if="r.report.findings?.length" class="cp-eval__section">
              <h5>角色发现</h5>
              <article v-for="f in r.report.findings" :key="f.code" class="cp-finding">
                <span class="cp-finding__sev" :data-sev="f.severity">{{ f.severity }}</span>
                <div>
                  <strong>{{ f.title }}</strong>
                  <p>{{ f.detail }}</p>
                  <details v-if="findingEvidence(r, f).length" class="cp-evidence">
                    <summary>证据 {{ findingEvidence(r, f).length }}</summary>
                    <div v-for="e in findingEvidence(r, f)" :key="e.id">
                      <code>{{ e.source }}{{ e.index === null ? '' : `[${e.index}]` }} · {{ e.path }}</code>
                      <p>{{ e.excerpt || e.interpretation }}</p>
                    </div>
                  </details>
                </div>
              </article>
            </div>
            <div v-if="r.report.recommendations?.length" class="cp-eval__section">
              <h5>模拟器建议</h5>
              <article v-for="(rec, rIdx) in r.report.recommendations" :key="`arec-${rIdx}`" class="cp-rec">
                <div class="cp-rec__head">
                  <strong>{{ rec.priority }}</strong>
                  <span v-if="rec.findingCodes?.length" class="cp-rec__codes">
                    <code v-for="c in rec.findingCodes" :key="String(c)">{{ c }}</code>
                  </span>
                </div>
                <p>{{ rec.action }}</p>
                <details v-if="rec.rationale" class="cp-rec__rationale">
                  <summary>依据</summary>
                  <p>{{ rec.rationale }}</p>
                </details>
              </article>
            </div>
          </article>
        </template>
      </div>
    </section>

    <!-- 裁判旁路诊断轨迹 -->
    <details v-if="refereeTrace.length" class="cp-trace-panel">
      <summary>
        <span>裁判旁路诊断</span>
        <code>{{ refereeTrace.length }} 条 · trace={{ refereeTraceCount }}</code>
      </summary>
      <ol class="cp-trace-list">
        <li v-for="(item, idx) in refereeTrace" :key="(item.traceId || '') + idx">
          <div class="cp-trace-list__head">
            <span class="cp-trace-list__seq">#{{ idx + 1 }}</span>
            <time>{{ formatTime(item.timestamp) }}</time>
            <code v-if="item.traceId" class="cp-trace-list__id">{{ item.traceId }}</code>
          </div>
          <pre v-if="item.diagnostic" class="cp-trace-list__body">{{ summarizeDiagnostic(item.diagnostic) }}</pre>
        </li>
      </ol>
    </details>

    <!-- 角色私有状态轨迹（虚拟学习者脑子里在想什么） -->
    <details v-if="privateStateTrace.length" class="cp-trace-panel">
      <summary>
        <span>角色私有状态轨迹</span>
        <code>{{ privateStateTraceCount }} 条</code>
      </summary>
      <ol class="cp-trace-list">
        <li v-for="(item, idx) in privateStateTrace" :key="(item.sequence ?? idx)">
          <div class="cp-trace-list__head">
            <span class="cp-trace-list__seq">#{{ item.sequence ?? (idx + 1) }}</span>
            <span class="cp-trace-list__stage" :data-stage="item.stage">{{ item.stage }}</span>
            <code v-if="item.taskId">task={{ item.taskId.slice(0, 8) }}</code>
            <time v-if="item.generatedAt">{{ formatTime(item.generatedAt) }}</time>
            <span v-if="item.emotion" class="cp-trace-list__emotion">{{ item.emotion }}</span>
            <span v-if="item.degraded" class="cp-trace-list__degraded" title="LLM/校验失败时的兜底状态">degraded</span>
            <span v-if="item.transition" class="cp-trace-list__transition">{{ item.transition }}</span>
          </div>
          <div v-if="item.phaseFocus" class="cp-trace-list__focus">聚焦：{{ item.phaseFocus }}</div>
          <div v-if="item.visibleSignal" class="cp-trace-list__signal">{{ item.visibleSignal }}</div>
          <div v-if="item.stateChangeReason" class="cp-trace-list__reason">状态变化：{{ item.stateChangeReason }}</div>
          <div v-if="item.metrics && Object.keys(item.metrics).length" class="cp-trace-list__metrics">
            <span v-for="(v, k) in item.metrics" :key="k">
              <code>{{ k }}</code><strong>{{ v }}</strong>
            </span>
          </div>
          <div v-if="item.flags && Object.keys(item.flags).length" class="cp-trace-list__flags">
            <span v-for="(v, k) in item.flags" :key="k" :class="{ active: !!v }">{{ k }}</span>
          </div>
          <div v-if="item.blockers?.length" class="cp-trace-list__blockers">
            <span>阻塞：</span>
            <span v-for="(b, bIdx) in item.blockers" :key="bIdx" class="cp-trace-list__blocker">{{ b }}</span>
          </div>
        </li>
      </ol>
    </details>

    <!-- 调试：原始 JSON -->
    <details class="cp-raw">
      <summary>原始会话数据</summary>
      <pre>{{ rawJson }}</pre>
    </details>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { subPage, closeSubPage } from './mockStore'
import { errMsg } from './mockLive'
import { adminVirtualLearnersApi } from '@/api/adminApi'

const sessionId = computed(() => subPage.value?.id || '')
const shortId = computed(() => (sessionId.value.length > 20 ? `…${sessionId.value.slice(-16)}` : sessionId.value))

const session = ref<Record<string, unknown> | null>(null)
const logs = ref<{ time: string; text: string }[]>([])
const pathStatus = ref<Record<string, unknown> | null>(null)
const teachingDetail = ref<Record<string, unknown> | null>(null)
const teachingDetailLoading = ref(false)
const selectedTeachingSessionId = ref('')

interface EvaluationReport {
  id?: string
  evaluatedAt?: string
  report?: {
    verdict?: string
    scores?: Record<string, number | null>
    findings?: Array<{
      code: string
      severity: string
      title: string
      detail: string
      evidenceIds?: Array<string | number>
    }>
    recommendations?: Array<{
      priority?: string
      action?: string
      rationale?: string
      findingCodes?: Array<string | number>
    }>
    evidence?: Array<{
      id?: string | number
      source?: string
      index?: number | null
      path?: string
      excerpt?: string
      interpretation?: string
    }>
  }
}

interface RefereeTraceItem {
  timestamp: string
  traceId: string | null
  diagnostic: Record<string, unknown> | null
}

interface PrivateStateTraceItem {
  sequence?: number
  stage: 'goal' | 'learning'
  taskId?: string | null
  transition?: string | null
  emotion?: string | null
  phaseFocus?: string | null
  degraded?: boolean
  visibleSignal?: string | null
  stateChangeReason?: string | null
  metrics?: Record<string, number>
  flags?: Record<string, boolean>
  blockers?: string[]
  generatedAt?: string | null
}

const refereeReports = ref<EvaluationReport[]>([])
const actorAuditReports = ref<EvaluationReport[]>([])
const refereeTrace = ref<RefereeTraceItem[]>([])
const refereeTraceCount = ref(0)
const privateStateTrace = ref<PrivateStateTraceItem[]>([])
const privateStateTraceCount = ref(0)
const busy = ref(false)
const toast = ref('')
const toastCls = ref('mk-toast--ok')
let toastTimer: ReturnType<typeof setTimeout> | null = null

function showToast(msg: string, cls = 'mk-toast--ok') {
  toast.value = msg
  toastCls.value = cls
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 3200)
}

const stageResults = computed(() => (session.value?.stageResults || {}) as Record<string, unknown>)
const runtime = computed(() => (session.value?.runtime || {}) as Record<string, unknown>)
const stageStatus = computed(() => (runtime.value.stageStatus || {}) as Record<string, Record<string, unknown>>)

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function normalized(value: unknown): string {
  return String(value || '').trim().toLowerCase()
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function boolValue(value: unknown): boolean | undefined {
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  return undefined
}

function numberValue(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

function conversationMessages(value: unknown) {
  if (!Array.isArray(value)) return [] as Array<{ role: string; content: string }>
  return value.map(asRecord).map((message) => ({
    role: normalized(message.role) === 'assistant' || normalized(message.role) === 'teacher' ? 'assistant' : 'user',
    content: firstText(message.content, message.text, message.message)
  })).filter((message) => message.content)
}

const isBlackbox = computed(() => !!(stageResults.value.blackbox || stageResults.value.experiment))
const blackboxTraceCount = computed(() => {
  const bb = (stageResults.value.blackbox || {}) as Record<string, unknown>
  const trace = bb.publicTrace
  return Array.isArray(trace) ? trace.length : 0
})
const modeText = computed(() => (isBlackbox.value ? '黑盒模式' : '辅助模式'))
const isTerminal = computed(() => {
  const st = normalized(session.value?.status || runtime.value.status)
  return ['completed', 'failed', 'abandoned', 'error', 'done', 'wrapup', 'timeout'].includes(st)
})
const terminalStatus = computed(() => normalized(session.value?.status || runtime.value.status))
const isFailedTerminal = computed(() => ['failed', 'abandoned', 'error', 'timeout'].includes(terminalStatus.value))
const statusTone = computed(() =>
  !session.value
    ? 'mk-status--muted'
    : isFailedTerminal.value
      ? 'mk-status--bad'
      : isTerminal.value
        ? 'mk-status--ok'
        : 'mk-status--warn'
)
const statusTitle = computed(() =>
  !session.value
    ? '加载中…'
    : isFailedTerminal.value
      ? '会话失败'
      : isTerminal.value
        ? '会话已完成'
        : '会话进行中'
)

/* 阶段流：与后端 currentStage 对齐（learning，不是 learn） */
const stageFlow = ['goal', 'path', 'learning', 'wrapup'] as const
type StageKey = (typeof stageFlow)[number]

const bindings = computed(() => {
  const fromRuntime = (runtime.value.bindings || {}) as Record<string, unknown>
  const fromSession = (session.value?.bindings || {}) as Record<string, unknown>
  return {
    goalConversationId:
      fromRuntime.goalConversationId ||
      fromSession.goalConversationId ||
      session.value?.goalConversationId ||
      stageStatus.value.goal?.conversationId ||
      null,
    learningPathId:
      fromRuntime.learningPathId ||
      fromSession.learningPathId ||
      session.value?.learningPathId ||
      null,
    teachingSessionId:
      fromRuntime.teachingSessionId ||
      fromSession.teachingSessionId ||
      stageStatus.value.learning?.teachingSessionId ||
      null,
    currentTaskId:
      fromRuntime.currentTaskId ||
      fromSession.currentTaskId ||
      session.value?.currentTaskId ||
      stageStatus.value.learning?.currentTaskId ||
      null
  }
})

const goalResult = computed(() => asRecord(stageResults.value.goal))
const pathResult = computed(() => asRecord(stageResults.value.path))
const pathReview = computed(() => asRecord(stageResults.value.path_review || stageResults.value.pathReview))
const learningResult = computed(() => asRecord(stageResults.value.learning))
const conversations = computed(() => asRecord(session.value?.conversations))
const goalConversationMessages = computed(() => conversationMessages(asRecord(conversations.value.goal).messages))
const fallbackLearnConversationMessages = computed(() => conversationMessages(asRecord(conversations.value.learning).messages))
const teachingSessionHistory = computed(() => {
  const history = learningResult.value.teachingSessionHistory
  if (!Array.isArray(history)) return [] as Array<{ id: string; taskTitle: string }>
  const seen = new Set<string>()
  return history.map(asRecord).map((item) => ({
    id: firstText(item.teachingSessionId),
    taskTitle: firstText(item.taskTitle)
  })).filter((item) => item.id && !seen.has(item.id) && !!seen.add(item.id))
})
const teachingDetailMessages = computed(() => conversationMessages(teachingDetail.value?.messages))
const learnConversationMessages = computed(() =>
  teachingDetailMessages.value.length ? teachingDetailMessages.value : fallbackLearnConversationMessages.value
)
const displayedTeachingSessionId = computed(() => firstText(
  teachingDetail.value?.id,
  selectedTeachingSessionId.value,
  bindings.value.teachingSessionId
))
const pathStatusPath = computed(() => asRecord(pathStatus.value?.path))
const pathGenerationStatus = computed(() => {
  const value = pathStatusPath.value.generationStatus ?? pathStatus.value?.generationStatus
  return asRecord(value)
})
const pathId = computed(() => firstText(
  bindings.value.learningPathId,
  pathStatus.value?.learningPathId,
  pathStatusPath.value.id,
  stageStatus.value.path?.learningPathId
))
const pathStateValues = computed(() => [
  normalized(pathStatus.value?.status),
  normalized(pathStatusPath.value.status),
  normalized(pathStatusPath.value.generationStatus),
  normalized(pathStatus.value?.generationStatus),
  normalized(pathGenerationStatus.value.status),
  normalized(pathGenerationStatus.value.core),
  normalized(pathGenerationStatus.value.stageDesign),
  normalized(pathGenerationStatus.value.phase)
].filter(Boolean))
const pathGenerationInProgress = computed(() =>
  pathStateValues.value.some((state) => ['generating', 'pending', 'queued', 'processing', 'in_progress', 'running'].includes(state))
)
const pathGenerationFailed = computed(() =>
  pathStateValues.value.some((state) => ['failed', 'error', 'cancelled'].includes(state))
)
const hasPath = computed(() =>
  !!(pathId.value || stageStatus.value.path?.generated || pathResult.value.generated)
)
const pathGeneratedOrReady = computed(() =>
  hasPath.value
  && !pathGenerationInProgress.value
  && !pathGenerationFailed.value
  && !['not_started', 'not_found'].includes(normalized(pathStatus.value?.status))
)
const pathStartable = computed(() => {
  const value = boolValue(pathStatusPath.value.canStartLearning)
    ?? boolValue(pathStatus.value?.canStartLearning)
  return value === true
})
const learningBlockedReason = computed(() => firstText(
  pathStatusPath.value.learningBlockedReason,
  pathStatus.value?.learningBlockedReason
))
const pathMilestones = computed(() => {
  const milestones = pathStatusPath.value.milestones
    || pathStatusPath.value.stages
    || pathStatus.value?.milestones
    || pathStatus.value?.stages
  return Array.isArray(milestones) ? milestones.map(asRecord) : []
})

const currentStage = computed(() => {
  const raw = String(runtime.value.currentStage || session.value?.currentStage || 'goal').toLowerCase()
  // 兼容旧 UI / 日志里的 learn 别名
  if (raw === 'learn' || raw === 'teach') return 'learning'
  if (raw === 'summary') return 'wrapup'
  return raw
})

const goalConverged = computed(() => {
  const goalStage = normalized(goalResult.value.finalStage || goalResult.value.stage || stageStatus.value.goal?.stage)
  return stageStatus.value.goal?.ready === true
    || ['ready', 'completed'].includes(goalStage)
    || effectiveStageIndex.value >= 1
    || hasPath.value
})

const pathReviewAccepted = computed(() => {
  const reviewStatus = normalized(pathReview.value.status)
  const runtimeReview = asRecord(stageStatus.value.path?.review)
  const decision = normalized(pathReview.value.decision || runtimeReview.decision)
  const reviewedPathId = firstText(pathReview.value.reviewedPathId)
  return reviewStatus === 'accepted'
    && decision === 'accept'
    && !!pathId.value
    && reviewedPathId === pathId.value
})

const learningConversation = computed(() => {
  const history = learningResult.value.conversationHistory
  return Array.isArray(history) ? history : []
})
const learningTaskRuntime = computed(() => asRecord(learningResult.value.taskRuntime))
const completedTaskCount = computed(() => numberValue(session.value?.completedTasks) || 0)
const hasCompletedTask = computed(() =>
  completedTaskCount.value > 0 || normalized(learningTaskRuntime.value.status) === 'completed'
)
const hasRunnablePathTask = computed(() => pathMilestones.value.some((milestone) => {
  const tasks = milestone.subtasks || milestone.tasks
  return Array.isArray(tasks) && tasks.some((task) => normalized(asRecord(task).status) !== 'completed')
}) || (!!bindings.value.currentTaskId && !hasCompletedTask.value))
const hasLearningProgress = computed(() =>
  !!bindings.value.teachingSessionId
  || !!bindings.value.currentTaskId
  || learningConversation.value.length > 0
  || Object.keys(learningTaskRuntime.value).length > 0
  || learningResult.value.currentMilestone !== undefined
  || learningResult.value.currentTaskId !== undefined
  || hasCompletedTask.value
)
const hasLearnHistoryOrProgress = computed(() => hasLearningProgress.value)
const learningActive = computed(() =>
  !isTerminal.value
  && currentStage.value === 'learning'
  && stageStatus.value.learning?.manualStop !== true
  && learningResult.value.manualStop !== true
)
const terminalPathCompleted = computed(() => {
  const completedMilestones = numberValue(pathStatusPath.value.completedMilestones)
  const totalMilestones = numberValue(pathStatusPath.value.totalMilestones)
  const allMilestonesCompleted = completedMilestones !== null
    && totalMilestones !== null
    && totalMilestones > 0
    && completedMilestones >= totalMilestones
  return !isFailedTerminal.value
    && isTerminal.value
    && (allMilestonesCompleted || currentStage.value === 'learning' || hasLearnHistoryOrProgress.value)
})
const wrapupAvailable = computed(() =>
  !hasWrapup.value && (hasLearningProgress.value || terminalPathCompleted.value)
)

const assistedControlBlockReason = computed(() => {
  if (!session.value) return '会话仍在加载'
  if (busy.value) return '操作执行中'
  if (isBlackbox.value) return '黑盒模式不支持此辅助控制'
  if (isFailedTerminal.value) return '会话已失败或终止，请保留现场记录'
  if (isTerminal.value) return '会话已完成'
  return ''
})
const stepDisabled = computed(() => !session.value || busy.value || isTerminal.value)
const stepTitle = computed(() => {
  if (!session.value) return '会话仍在加载'
  if (busy.value) return '操作执行中'
  if (isTerminal.value) return '会话已终态，不能继续推进'
  return isBlackbox.value ? '执行一条黑盒实验轨迹' : '推进当前阶段一步'
})
const autoDisabled = computed(() => !session.value || busy.value || isTerminal.value || isBlackbox.value)
const autoTitle = computed(() => {
  if (!session.value) return '会话仍在加载'
  if (busy.value) return '操作执行中'
  if (isBlackbox.value) return '黑盒模式仅支持单步推进'
  if (isTerminal.value) return '会话已终态，不能继续推进'
  return '自动推进当前阶段'
})
const runFullDisabled = computed(() => !!assistedControlBlockReason.value)
const runFullTitle = computed(() => assistedControlBlockReason.value || '自动执行 Goal、Path 和 Learn 流程')
const advancePathDisabled = computed(() =>
  !!assistedControlBlockReason.value || !goalConverged.value || hasPath.value
)
const advancePathTitle = computed(() => {
  if (assistedControlBlockReason.value) return assistedControlBlockReason.value
  if (!goalConverged.value) return 'Goal 对话尚未收敛，不能生成 Path'
  if (hasPath.value) return '已有 Path，不能重复生成'
  return '根据已收敛的 Goal 生成 Path'
})
const reviewPathDisabled = computed(() =>
  !!assistedControlBlockReason.value || !pathGeneratedOrReady.value || pathReviewAccepted.value
)
const reviewPathTitle = computed(() => {
  if (assistedControlBlockReason.value) return assistedControlBlockReason.value
  if (pathReviewAccepted.value) return '当前 Path 已通过评审'
  if (pathGenerationFailed.value) return 'Path 生成失败，请重新生成 Path'
  if (pathGenerationInProgress.value) return 'Path 正在生成或补全阶段任务'
  if (!pathGeneratedOrReady.value) return '请先生成并等待 Path 就绪'
  return '以虚拟学习者视角评审当前 Path'
})
const startLearningDisabled = computed(() =>
  !!assistedControlBlockReason.value || !pathReviewAccepted.value || !pathStartable.value || learningActive.value
)
const startLearningTitle = computed(() => {
  if (assistedControlBlockReason.value) return assistedControlBlockReason.value
  if (learningActive.value) return 'Learn 已在进行中'
  if (!pathReviewAccepted.value) return 'Path 尚未通过虚拟学习者评审'
  if (!pathStartable.value) return learningBlockedReason.value || 'Path 尚未准备好启动 Learn'
  return '启动已评审且可学习的 Path'
})
const wrapupDisabled = computed(() => {
  if (!session.value || busy.value || isBlackbox.value || isFailedTerminal.value) return true
  return !wrapupAvailable.value
})
const wrapupTitle = computed(() => {
  if (!session.value) return '会话仍在加载'
  if (busy.value) return '操作执行中'
  if (isBlackbox.value) return '黑盒模式不支持此辅助控制'
  if (isFailedTerminal.value) return '会话已失败或终止，不能生成学习总结'
  if (hasWrapup.value) return '学习总结已生成'
  if (!wrapupAvailable.value) return '请先启动 Learn 并产生消息或学习进度'
  return '根据当前 Learn 记录生成总结'
})
const stopLearningDisabled = computed(() => !!assistedControlBlockReason.value || !learningActive.value)
const stopLearningTitle = computed(() => {
  if (assistedControlBlockReason.value) return assistedControlBlockReason.value
  if (!learningActive.value) return '仅可停止正在进行的 Learn'
  return '停止当前 Learn'
})
const resetPathDisabled = computed(() =>
  !!assistedControlBlockReason.value || !hasPath.value || hasLearnHistoryOrProgress.value
)
const resetPathTitle = computed(() => {
  if (hasLearnHistoryOrProgress.value) return '已有 Learn 历史或进度，为保留历史不能重建 Path'
  if (assistedControlBlockReason.value) return assistedControlBlockReason.value
  if (!hasPath.value) return '尚无 Path 可重建'
  return '删除当前 Path 并重新生成'
})
const resetLearningBlockReason = computed(() => {
  if (!session.value) return '会话仍在加载'
  if (busy.value) return '操作执行中'
  if (isBlackbox.value) return '黑盒模式不支持此辅助控制'
  if (isTerminal.value && !isFailedTerminal.value) return '会话已完成，不能重启 Learn'
  return ''
})
const canRestartFromFailedLearn = computed(() => isFailedTerminal.value && hasRunnablePathTask.value)
const resetLearningDisabled = computed(() =>
  !!resetLearningBlockReason.value
  || !pathReviewAccepted.value
  || !(pathStartable.value || canRestartFromFailedLearn.value)
  || !hasRunnablePathTask.value
)
const resetLearningTitle = computed(() => {
  if (resetLearningBlockReason.value) return resetLearningBlockReason.value
  if (!pathReviewAccepted.value) return 'Path 尚未通过虚拟学习者评审'
  if (!pathStartable.value && !canRestartFromFailedLearn.value) return learningBlockedReason.value || 'Path 尚未准备好启动 Learn'
  if (!hasRunnablePathTask.value) return 'Path 中没有可重启的学习任务'
  return isFailedTerminal.value ? '从当前可运行任务恢复失败的 Learn' : '以可运行任务重新启动 Learn'
})
const showPathReadiness = computed(() =>
  !isBlackbox.value && (goalConverged.value || hasPath.value || ['path', 'learning', 'wrapup'].includes(currentStage.value))
)
const pathReadinessTone = computed(() => {
  if (pathGenerationFailed.value) return 'bad'
  if (pathGenerationInProgress.value) return 'warn'
  if (pathStartable.value) return 'ok'
  return 'muted'
})
const pathReadinessText = computed(() => {
  if (!hasPath.value) return goalConverged.value ? 'Goal 已收敛，等待生成 Path。' : '等待 Goal 对话收敛后生成 Path。'
  if (pathGenerationFailed.value) return learningBlockedReason.value || 'Path 生成失败，请重新生成。'
  if (pathGenerationInProgress.value) return learningBlockedReason.value || 'Path 正在生成或补全阶段任务，请稍候。'
  if (pathStartable.value) return pathReviewAccepted.value
    ? 'Path 已就绪，可启动或重启 Learn。'
    : 'Path 已就绪，等待虚拟学习者评审。'
  return learningBlockedReason.value || 'Path 已生成，正在确认 Learn 启动条件。'
})

/** 进度条索引：优先 currentStage，并用 bindings 兜底（避免 key 不一致时全「未开始」） */
const effectiveStageIndex = computed(() => {
  const raw = currentStage.value
  let idx = stageFlow.indexOf(raw as StageKey)
  if (idx >= 0) return idx

  // 后端偶发非标准 stage 时，用绑定证据推断
  if (bindings.value.teachingSessionId || bindings.value.currentTaskId) return 2
  if (bindings.value.learningPathId || stageStatus.value.path?.generated) return 1
  if (bindings.value.goalConversationId) return 0
  return 0
})

const hasWrapup = computed(() => {
  const learning = (stageResults.value.learning || {}) as Record<string, unknown>
  return !!(stageStatus.value.learning?.wrapup || learning.wrapup)
})

function stageLabel(st: string) {
  return {
    goal: 'Goal 对话',
    path: 'Path 生成',
    learning: 'Learn 学习',
    wrapup: 'Wrapup 总结'
  }[st] || st
}

function stageDone(st: StageKey) {
  const idx = stageFlow.indexOf(st)
  const cur = effectiveStageIndex.value

  // Wrapup 不是会话终态的同义词：只有确实写出总结时才算完成。
  if (st === 'wrapup') return hasWrapup.value
  // 失败终态只确认失败点以前的阶段；当前失败阶段不能伪装成完成。
  if (isFailedTerminal.value && idx === cur) return false
  if (isTerminal.value && idx <= cur) return true
  if (idx < cur) return true
  // 同阶段但已有下游证据时，也标完成（如 learning 时 Goal/Path 已完成）
  if (st === 'goal' && (bindings.value.learningPathId || bindings.value.teachingSessionId || cur >= 1)) return true
  if (st === 'path' && (bindings.value.teachingSessionId || cur >= 2)) return true
  if (st === 'learning' && (isTerminal.value || stageStatus.value.learning?.wrapup)) return true
  return false
}

function stageActive(st: StageKey) {
  if (isTerminal.value) {
    return st === 'wrapup'
      ? hasWrapup.value
      : stageFlow.indexOf(st) === effectiveStageIndex.value
  }
  if (stageDone(st) && stageFlow.indexOf(st) !== effectiveStageIndex.value) return false
  return stageFlow.indexOf(st) === effectiveStageIndex.value
}

function stageCls(st: string) {
  const key = st as StageKey
  return {
    'cp-stage--done': stageDone(key),
    'cp-stage--active': stageActive(key) && !isTerminal.value
  }
}

function stageState(st: string) {
  const key = st as StageKey
  if (isFailedTerminal.value && stageFlow.indexOf(key) === effectiveStageIndex.value) return '失败'
  if (stageDone(key) && !stageActive(key)) return '已完成'
  if (stageActive(key)) return isTerminal.value ? '已完成' : '进行中'
  if (stageDone(key)) return '已完成'
  return '未开始'
}

/* 阶段摘要（读 runtime.stageStatus + bindings） */
const goalInfo = computed(() => {
  const g = stageStatus.value.goal || {}
  const id = bindings.value.goalConversationId || g.conversationId
  if (!id) return ''
  if (g.ready || effectiveStageIndex.value >= 1) return `对话已创建 · 已收敛/可生成 Path`
  return `对话已创建 · 进行中`
})
const pathInfo = computed(() => {
  const p = stageStatus.value.path || {}
  if (bindings.value.learningPathId || p.generated) {
    return p.totalMilestones ? `${p.totalMilestones} 个里程碑已生成` : '路径已生成'
  }
  return ''
})
const learnInfo = computed(() => {
  const l = stageStatus.value.learning || {}
  if (l.currentTaskTitle) return `当前任务：${String(l.currentTaskTitle)}`
  if (bindings.value.teachingSessionId || l.teachingSessionId) return '教学会话进行中'
  return ''
})

/* 数据加载 */
async function refresh() {
  if (!sessionId.value) return
  try {
    const res = await adminVirtualLearnersApi.getVirtualSession(sessionId.value)
    session.value = res.data?.data ?? res.data ?? {}
    const sr = (session.value?.stageResults || {}) as Record<string, unknown>
    const simCfg = (sr.simulationConfig || {}) as Record<string, unknown>
    const fb = String(simCfg.frictionBudget || '')
    if (['none', 'low', 'normal', 'high', 'stress_test'].includes(fb)) {
      frictionBudget.value = fb as typeof frictionBudget.value
    }
    parseBlackbox()
    await Promise.all([
      loadLogs(),
      isBlackbox.value ? Promise.resolve() : loadPathStatus(),
      isBlackbox.value ? Promise.resolve() : loadTeachingDetail()
    ])
  } catch (e) {
    showToast(`加载失败：${errMsg(e)}`, 'mk-toast--bad')
  }
}

async function loadLogs() {
  try {
    const res = await adminVirtualLearnersApi.getVirtualSessionLogs(sessionId.value)
    const body = res.data?.data ?? res.data ?? []
    let items = Array.isArray(body) ? body : body.logs || body.items || []
    // 回退：会话对象自带的 logs 字段
    if (!items.length && Array.isArray(session.value?.logs)) {
      items = session.value.logs as Record<string, unknown>[]
    }
    logs.value = items.slice(-60).map((l: Record<string, unknown>) => ({
      time: l.createdAt ? new Date(String(l.createdAt)).toLocaleTimeString('zh-CN', { hour12: false }) : '',
      text: String(l.message || l.text || l.type || JSON.stringify(l)).slice(0, 160)
    }))
  } catch {
    logs.value = []
  }
}

async function loadPathStatus() {
  if (!sessionId.value || isBlackbox.value) {
    pathStatus.value = null
    return
  }
  try {
    const res = await adminVirtualLearnersApi.getVirtualSessionPathStatus(sessionId.value)
    pathStatus.value = asRecord(res.data?.data ?? res.data)
  } catch {
    // Path 状态仅用于控制台就绪提示；主会话数据仍可正常操作和刷新。
    pathStatus.value = null
  }
}

async function loadTeachingDetail(teachingSessionId = selectedTeachingSessionId.value) {
  if (!sessionId.value || isBlackbox.value) {
    teachingDetail.value = null
    return
  }

  const currentTeachingSessionId = firstText(bindings.value.teachingSessionId)
  if (!teachingSessionId && !currentTeachingSessionId) {
    teachingDetail.value = null
    return
  }

  teachingDetailLoading.value = true
  try {
    const res = await adminVirtualLearnersApi.getVirtualSessionTeachingDetail(sessionId.value, teachingSessionId || undefined)
    teachingDetail.value = asRecord(res.data?.data ?? res.data)
  } catch {
    // 当前课堂尚未创建或历史课堂被清理时，仍可展示会话日志投影。
    teachingDetail.value = null
  } finally {
    teachingDetailLoading.value = false
  }
}

function showCurrentTeaching() {
  selectedTeachingSessionId.value = ''
  void loadTeachingDetail()
}

function showArchivedTeaching(teachingSessionId: string) {
  selectedTeachingSessionId.value = teachingSessionId
  void loadTeachingDetail(teachingSessionId)
}

function parseBlackbox() {
  const bb = (stageResults.value.blackbox || {}) as Record<string, unknown>
  // 平台质量裁判与角色保真审计（结构化报告）
  refereeReports.value = Array.isArray(bb.refereeReports) ? bb.refereeReports as EvaluationReport[] : []
  actorAuditReports.value = Array.isArray(bb.actorAuditReports) ? bb.actorAuditReports as EvaluationReport[] : []
  // 裁判旁路诊断轨迹
  const rawRefereeTrace = Array.isArray(bb.refereeTrace) ? bb.refereeTrace : []
  refereeTrace.value = rawRefereeTrace as RefereeTraceItem[]
  refereeTraceCount.value = rawRefereeTrace.length
  // 角色私有状态轨迹
  const rawPrivateTrace = Array.isArray(bb.learnerPrivateStateTrace) ? bb.learnerPrivateStateTrace : []
  privateStateTrace.value = rawPrivateTrace as PrivateStateTraceItem[]
  privateStateTraceCount.value = rawPrivateTrace.length
}

/* 评估报告展示助手 */
function verdictLabel(verdict?: string) {
  if (!verdict) return '未生成'
  const map: Record<string, string> = {
    pass: '通过', pass_with_concerns: '有条件通过',
    fail: '失败', inconclusive: '证据不足',
    credible: '可信', credible_with_concerns: '基本可信',
    invalid: '无效'
  }
  return map[verdict] || verdict
}
function verdictBadgeCls(verdict?: string) {
  if (verdict === 'pass' || verdict === 'credible') return 'mk-badge--ok'
  if (verdict === 'pass_with_concerns' || verdict === 'credible_with_concerns') return 'mk-badge--warn'
  if (verdict === 'fail' || verdict === 'invalid') return 'mk-badge--bad'
  return 'mk-badge--muted'
}
function formatScore(v?: number | null) {
  if (typeof v !== 'number') return '—'
  return String(v)
}
function formatTime(value?: string | null) {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString('zh-CN', { hour12: false })
}
function scoreItems(scores: Record<string, number | null>, kind: 'referee' | 'actor') {
  const labels = kind === 'referee'
    ? [['goalExperience', 'Goal 体验'], ['pathExperience', 'Path 体验'], ['teachingExperience', 'Teaching 体验'], ['controlConsistency', '控制一致'], ['boundaryIntegrity', '边界完整'], ['evidenceSufficiency', '证据充分']]
    : [['personaConsistency', '画像一致'], ['storyConsistency', '故事一致'], ['disclosureDiscipline', '披露节奏'], ['frictionCalibration', '摩擦校准'], ['stateContinuity', '状态连续'], ['behaviorPlausibility', '行为可信'], ['evidenceSufficiency', '证据充分']]
  return labels.map(([key, label]) => ({ label, value: scores[key] ?? null }))
}
function findingEvidence(report: EvaluationReport, finding: { evidenceIds?: Array<string | number> }) {
  const ids = new Set(Array.isArray(finding.evidenceIds) ? finding.evidenceIds : [])
  return (Array.isArray(report.report?.evidence) ? report.report.evidence : []).filter((e) => ids.has(e.id as never))
}
function summarizeDiagnostic(value: Record<string, unknown> | null): string {
  if (!value || typeof value !== 'object') return ''
  try {
    const t = JSON.stringify(value, null, 2)
    return t.length > 800 ? `${t.slice(0, 800)}…` : t
  } catch {
    return ''
  }
}

const frictionBudget = ref<'none' | 'low' | 'normal' | 'high' | 'stress_test'>('normal')

async function saveFriction() {
  if (!sessionId.value || isBlackbox.value) return
  try {
    await adminVirtualLearnersApi.updateSessionSimulationConfig(sessionId.value, {
      frictionBudget: frictionBudget.value
    })
    showToast(`对抗预算已更新：${frictionBudget.value}`)
  } catch (e) {
    showToast(`更新失败：${errMsg(e)}`, 'mk-toast--bad')
  }
}

/* 控制动作：按阶段路由（learning 走 learning-step / auto-learning） */
async function act(kind: string) {
  if (busy.value) return
  busy.value = true
  const id = sessionId.value
  const stage = currentStage.value
  try {
    switch (kind) {
      case 'step':
        if (isBlackbox.value) {
          await adminVirtualLearnersApi.blackboxVirtualSessionStep(id, blackboxTraceCount.value)
        } else if (stage === 'learning') {
          await adminVirtualLearnersApi.virtualSessionLearningStep(id)
        } else {
          await adminVirtualLearnersApi.virtualSessionStep(id)
        }
        break
      case 'auto':
        if (stage === 'learning') {
          await adminVirtualLearnersApi.virtualSessionAutoLearning(id, { maxMilestones: 1 })
        } else {
          await adminVirtualLearnersApi.virtualSessionAuto(id, { maxRounds: 10 })
        }
        break
      case 'runFull':
        await adminVirtualLearnersApi.virtualSessionRunFull(id, {
          maxRounds: 10,
          maxMilestones: 5,
          autoAdvanceToPath: true,
          autoAdvanceToLearning: true
        })
        break
      case 'advancePath':
        await adminVirtualLearnersApi.virtualSessionAdvancePath(id)
        break
      case 'reviewPath':
        await adminVirtualLearnersApi.reviewVirtualSessionPath(id)
        break
      case 'startLearning':
        await adminVirtualLearnersApi.startVirtualLearning(id)
        break
      case 'wrapup':
        await adminVirtualLearnersApi.virtualSessionWrapup(id)
        break
      case 'stop':
        await adminVirtualLearnersApi.stopVirtualLearning(id)
        break
      case 'resetPath':
        await adminVirtualLearnersApi.restartVirtualSessionPath(id)
        break
      case 'resetLearn':
        await adminVirtualLearnersApi.restartVirtualLearning(id)
        break
      case 'abandon':
        await adminVirtualLearnersApi.executeBlackboxVirtualAction(
          id,
          { type: 'abandon', reason: 'operator_abandon' },
          blackboxTraceCount.value
        )
        break
      case 'referee':
        await adminVirtualLearnersApi.generateBlackboxEvaluations(id)
        break
      case 'rerun': {
        const res = await adminVirtualLearnersApi.rerunBlackboxVirtualSession(id)
        const d = res.data?.data ?? res.data ?? {}
        const newId = String(d.id || d.sessionId || '')
        showToast('已按原输入重跑，正在切换到新会话')
        if (newId) subPage.value = { view: 'session', id: newId }
        return
      }
    }
    showToast('指令已执行')
    await refresh()
  } catch (e) {
    const message = `执行失败：${errMsg(e)}`
    await refresh()
    showToast(message, 'mk-toast--bad')
  } finally {
    busy.value = false
  }
}

async function removeSession() {
  if (!window.confirm('确认删除该会话？')) return
  try {
    await adminVirtualLearnersApi.deleteVirtualSession(sessionId.value)
    closeSubPage()
  } catch (e) {
    showToast(`删除失败：${errMsg(e)}`, 'mk-toast--bad')
  }
}

/* 会话、日志与 Path 就绪状态共用同一轮询（非终态 5s） */
let pollTimer: ReturnType<typeof setInterval> | null = null
function startPolling() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = setInterval(() => {
    if (document.hidden || isTerminal.value) return
    void loadLogs()
    void adminVirtualLearnersApi.getVirtualSession(sessionId.value).then((res) => {
      session.value = res.data?.data ?? res.data ?? {}
      parseBlackbox()
      if (isBlackbox.value) {
        pathStatus.value = null
        teachingDetail.value = null
      } else {
        void loadPathStatus()
        void loadTeachingDetail()
      }
    }).catch(() => undefined)
  }, 5000)
}

watch(
  sessionId,
  async (id) => {
    if (!id) return
    session.value = null
    logs.value = []
    pathStatus.value = null
    teachingDetail.value = null
    selectedTeachingSessionId.value = ''
    refereeReports.value = []
    actorAuditReports.value = []
    refereeTrace.value = []
    refereeTraceCount.value = 0
    privateStateTrace.value = []
    privateStateTraceCount.value = 0
    await refresh()
    startPolling()
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer)
})

const rawJson = computed(() => JSON.stringify(session.value, null, 2)?.slice(0, 4000) || '')
const statusText = (s?: unknown) =>
  ({
    completed: '已完成',
    running: '进行中',
    in_progress: '进行中',
    active: '进行中',
    created: '已创建',
    error: '错误',
    failed: '失败',
    abandoned: '已放弃',
    timeout: '超时'
  }[String(s)] || String(s || '未知'))
</script>

<style scoped>
.cp { gap: 14px; }
.cp-back {
  border: 0;
  background: transparent;
  color: var(--mk-blue);
  font: inherit;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  padding: 0;
  width: fit-content;
}
.cp-danger { color: var(--mk-red) !important; border-color: rgba(220, 38, 38, 0.35) !important; }

.cp-stages {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.cp-stage {
  display: grid;
  gap: 2px;
  padding: 10px 16px;
  border-radius: 12px;
  border: 1px solid var(--mk-line);
  background: var(--mk-surface);
  min-width: 130px;
}
.cp-stage__order { font-size: 10px; font-weight: 800; color: var(--mk-faint); letter-spacing: 0.08em; }
.cp-stage strong { font-size: 13px; }
.cp-stage__state { font-size: 11px; color: var(--mk-faint); }
.cp-stage--active { border-color: var(--mk-blue); background: #eef5ff; }
.cp-stage--active .cp-stage__state { color: var(--mk-blue); font-weight: 700; }
.cp-stage--done { border-color: rgba(21, 128, 61, 0.3); }
.cp-stage--done .cp-stage__state { color: var(--mk-green); }
.cp-stage__arrow { color: var(--mk-faint); }

.cp-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  align-items: start;
}

.cp-controls {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  padding: 14px 16px 0;
}
.cp-btn {
  padding: 7px 13px;
  border-radius: 8px;
  border: 1px solid var(--mk-line);
  background: var(--mk-surface);
  color: var(--mk-ink);
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.cp-btn:hover:not(:disabled) { border-color: rgba(52, 120, 246, 0.4); color: var(--mk-blue); }
.cp-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.cp-btn--primary { background: var(--mk-blue); border-color: var(--mk-blue); color: #fff; }
.cp-btn--primary:hover:not(:disabled) { color: #fff; opacity: 0.9; }
.cp-danger-btn { color: var(--mk-red) !important; border-color: rgba(220, 38, 38, 0.35) !important; }
.cp-config {
  padding: 10px 16px 0;
  display: flex;
  gap: 12px;
  align-items: center;
  font-size: 12px;
  color: var(--mk-muted);
}
.cp-config label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
}
.cp-config select { min-width: 140px; }

.cp-summary { padding: 12px 16px 16px; display: grid; gap: 8px; }
.cp-summary__item {
  display: grid;
  gap: 3px;
  padding: 9px 12px;
  border: 1px solid var(--mk-line);
  border-radius: 9px;
}
.cp-summary__item span { font-size: 11px; font-weight: 700; color: var(--mk-faint); }
.cp-summary__item p { margin: 0; font-size: 12.5px; }
.cp-none { margin: 0; font-size: 12.5px; color: var(--mk-faint); }
.cp-path-readiness {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 8px 10px;
  border-left: 3px solid var(--mk-line);
  border-radius: 5px;
  background: #f8fafc;
}
.cp-path-readiness span { flex: 0 0 auto; font-size: 11px; font-weight: 800; color: var(--mk-muted); }
.cp-path-readiness p { margin: 0; font-size: 11.5px; color: var(--mk-muted); line-height: 1.5; }
.cp-path-readiness--ok { border-left-color: var(--mk-green); background: #f0fdf4; }
.cp-path-readiness--ok p { color: #15803d; }
.cp-path-readiness--warn { border-left-color: #d97706; background: #fffbeb; }
.cp-path-readiness--warn p { color: #b45309; }
.cp-path-readiness--bad { border-left-color: var(--mk-red); background: #fff1f0; }
.cp-path-readiness--bad p { color: #cf1322; }

.cp-logs {
  max-height: 320px;
  overflow-y: auto;
  padding: 10px 16px 14px;
  display: grid;
  gap: 6px;
}
.cp-log { display: flex; gap: 10px; font-size: 12px; }
.cp-log__time { color: var(--mk-faint); font-family: var(--mk-mono); font-size: 10.5px; white-space: nowrap; padding-top: 1px; }
.cp-log__text { color: var(--mk-muted); word-break: break-all; }

.cp-transcripts { display: grid; gap: 10px; padding: 12px 16px 16px; }
.cp-transcript {
  display: grid;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--mk-line);
  border-radius: 10px;
}
.cp-transcript summary { cursor: pointer; font-size: 12px; font-weight: 800; color: var(--mk-muted); }
.cp-transcript__message {
  display: grid;
  gap: 3px;
  padding: 8px 10px;
  border-left: 3px solid #cbd5e1;
  border-radius: 5px;
  background: #f8fafc;
}
.cp-transcript__message.is-teacher { border-left-color: var(--mk-blue); background: #eff6ff; }
.cp-transcript__message.is-learner { border-left-color: #0f766e; background: #f0fdfa; }
.cp-transcript__message span { font-size: 10.5px; font-weight: 800; color: var(--mk-faint); }
.cp-transcript__message p { margin: 0; font-size: 12px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
.cp-teaching-history { display: flex; flex-wrap: wrap; gap: 6px; }
.cp-history-btn {
  border: 1px solid var(--mk-line);
  border-radius: 6px;
  background: var(--mk-surface);
  color: var(--mk-muted);
  padding: 4px 7px;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.cp-history-btn:hover, .cp-history-btn.is-current { border-color: var(--mk-blue); color: var(--mk-blue); background: #eff6ff; }

.cp-raw { font-size: 12px; color: var(--mk-faint); }
.cp-raw summary { cursor: pointer; padding: 4px 2px; }
.cp-raw pre {
  margin: 8px 0 0;
  padding: 12px;
  border-radius: 10px;
  background: #0d1420;
  color: #8ba3c7;
  font: 10.5px/1.6 'JetBrains Mono', monospace;
  max-height: 300px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

@media (max-width: 1100px) {
  .cp-grid { grid-template-columns: 1fr; }
}

/* ===== 终局评估结构化渲染 ===== */
.cp-eval-group { display: grid; gap: 10px; padding: 14px 16px 4px; }
.cp-eval-group + .cp-eval-group { border-top: 1px solid var(--mk-line); }
.cp-eval-group__title { margin: 0; font-size: 12px; font-weight: 700; color: var(--mk-muted); letter-spacing: 0.04em; }

.cp-eval {
  border: 1px solid var(--mk-line);
  border-radius: 10px;
  padding: 12px 14px;
  display: grid;
  gap: 10px;
  margin-bottom: 8px;
}
.cp-eval__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.cp-eval__head strong { font-size: 13px; }
.cp-eval__time { display: block; font-size: 11px; color: var(--mk-faint); margin-top: 2px; }

.cp-eval__scores { display: flex; flex-wrap: wrap; gap: 8px; }
.cp-eval__scores span {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 5px;
  background: #f6f8fb;
  font-size: 11px;
}
.cp-eval__scores code { font-size: 11px; color: var(--mk-faint); }
.cp-eval__scores strong { font-variant-numeric: tabular-nums; color: var(--mk-ink); }

.cp-eval__section { display: grid; gap: 6px; }
.cp-eval__section h5 { margin: 0; font-size: 11.5px; font-weight: 700; color: var(--mk-muted); }

.cp-finding {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px dashed var(--mk-line);
}
.cp-finding:last-child { border-bottom: none; }
.cp-finding strong { font-size: 12.5px; }
.cp-finding p { margin: 4px 0 0; font-size: 12px; color: var(--mk-muted); line-height: 1.6; }
.cp-finding__sev {
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 10.5px;
  font-weight: 700;
  height: fit-content;
  background: #f3f5f9;
  color: var(--mk-muted);
}
.cp-finding__sev[data-sev='critical'] { background: #fff1f0; color: #cf1322; }
.cp-finding__sev[data-sev='major'] { background: #fff7e6; color: #d46b08; }
.cp-finding__sev[data-sev='minor'] { background: #e6f4ff; color: #0958d9; }
.cp-finding__sev[data-sev='info'] { background: #f0fff5; color: #389e0d; }

.cp-evidence { margin-top: 6px; font-size: 11.5px; }
.cp-evidence summary { cursor: pointer; color: var(--mk-faint); font-weight: 600; }
.cp-evidence > div { padding: 4px 8px; border-left: 2px solid var(--mk-line); margin: 6px 0; }
.cp-evidence code { font-size: 10.5px; color: var(--mk-faint); }
.cp-evidence p { margin: 2px 0 0; font-size: 11.5px; color: var(--mk-muted); }

.cp-rec { padding: 6px 0; border-bottom: 1px dashed var(--mk-line); }
.cp-rec:last-child { border-bottom: none; }
.cp-rec__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.cp-rec strong { font-size: 12px; }
.cp-rec__codes { display: inline-flex; flex-wrap: wrap; gap: 4px; }
.cp-rec__codes code { font-size: 10px; padding: 1px 5px; background: #f3f5f9; color: var(--mk-faint); border-radius: 3px; }
.cp-rec p { margin: 4px 0 0; font-size: 12.5px; color: var(--mk-muted); }
.cp-rec__rationale { margin-top: 6px; font-size: 11.5px; color: var(--mk-faint); }
.cp-rec__rationale summary { cursor: pointer; font-weight: 600; }
.cp-rec__rationale p { margin: 6px 0 0; }

/* =====三类轨迹折叠面板 ===== */
.cp-trace-panel {
  border: 1px solid var(--mk-line);
  border-radius: 10px;
  background: #f8fafc;
  margin-top: 12px;
}
.cp-trace-panel > summary {
  list-style: none;
  cursor: pointer;
  padding: 10px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--mk-ink);
  user-select: none;
}
.cp-trace-panel > summary::-webkit-details-marker { display: none; }
.cp-trace-panel > summary::before { content: '▸'; font-size: 11px; color: var(--mk-faint); margin-right: 4px; }
.cp-trace-panel[open] > summary::before { content: '▾'; }
.cp-trace-panel > summary code { font-size: 11px; color: var(--mk-faint); }

.cp-trace-list {
  list-style: none;
  margin: 0;
  padding: 0 14px 14px;
  max-height: 460px;
  overflow-y: auto;
  display: grid;
  gap: 8px;
}
.cp-trace-list > li {
  padding: 9px 12px;
  border: 1px solid var(--mk-line);
  border-radius: 6px;
  background: #fff;
  display: grid;
  gap: 6px;
}
.cp-trace-list__head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 11.5px; }
.cp-trace-list__seq { font-variant-numeric: tabular-nums; color: var(--mk-faint); font-weight: 700; }
.cp-trace-list__head time { color: var(--mk-faint); font-variant-numeric: tabular-nums; }
.cp-trace-list__id { font-size: 10.5px; color: var(--mk-faint); }
.cp-trace-list__stage {
  padding: 1px 8px; border-radius: 999px; font-size: 10.5px; font-weight: 700;
  background: #eef2ff; color: #4453a1;
}
.cp-trace-list__stage[data-stage='learning'] { background: #ecfdf5; color: #0a8551; }
.cp-trace-list__emotion,
.cp-trace-list__transition {
  padding: 1px 6px; border-radius: 4px; font-size: 10.5px;
  background: #f3f5f9; color: var(--mk-muted);
}
.cp-trace-list__degraded { padding: 1px 6px; border-radius: 4px; font-size: 10.5px; background: #fff1f0; color: #cf1322; }
.cp-trace-list__focus,
.cp-trace-list__reason { font-size: 11.5px; color: var(--mk-muted); }
.cp-trace-list__signal { font-size: 11.5px; color: var(--mk-faint); font-style: italic; }
.cp-trace-list__metrics { display: flex; flex-wrap: wrap; gap: 6px; }
.cp-trace-list__metrics > span { display: inline-flex; align-items: baseline; gap: 4px; padding: 2px 6px; background: #f6f8fb; border-radius: 4px; font-size: 10.5px; }
.cp-trace-list__metrics code { font-size: 10.5px; color: var(--mk-faint); }
.cp-trace-list__metrics strong { font-variant-numeric: tabular-nums; color: var(--mk-ink); }
.cp-trace-list__flags { display: flex; flex-wrap: wrap; gap: 5px; }
.cp-trace-list__flags > span { padding: 2px 7px; border-radius: 4px; font-size: 10.5px; background: #f3f5f9; color: var(--mk-faint); border: 1px solid transparent; }
.cp-trace-list__flags > span.active { background: #e6f4ff; color: #0958d9; border-color: #91caff; }
.cp-trace-list__blockers { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 11.5px; color: var(--mk-muted); }
.cp-trace-list__blocker { padding: 1px 6px; background: #fff7e6; color: #d46b08; border-radius: 3px; }
.cp-trace-list__body {
  margin: 4px 0 0; padding: 8px 10px; background: #f8fafc;
  border-radius: 4px; font-size: 10.5px; line-height: 1.5;
  color: var(--mk-muted); white-space: pre-wrap;
  word-break: break-word; max-height: 200px; overflow-y: auto;
}
</style>
