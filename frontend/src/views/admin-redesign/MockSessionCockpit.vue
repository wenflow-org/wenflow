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
          <button type="button" class="cp-btn" :disabled="busy || isTerminal" @click="act('step')">单步推进</button>
          <button type="button" class="cp-btn" :disabled="busy || isTerminal || isBlackbox" @click="act('auto')">自动到阶段末</button>
          <button type="button" class="cp-btn cp-btn--primary" :disabled="busy || isTerminal || isBlackbox" @click="act('runFull')">一键全流程</button>
          <button type="button" class="cp-btn" :disabled="busy || isTerminal || isBlackbox" @click="act('advancePath')">生成 Path</button>
          <button type="button" class="cp-btn" :disabled="busy || isTerminal || isBlackbox" @click="act('reviewPath')">评审 Path</button>
          <button type="button" class="cp-btn" :disabled="busy || isTerminal || isBlackbox" @click="act('startLearning')">启动 Learn</button>
          <button type="button" class="cp-btn" :disabled="busy || isTerminal || isBlackbox" @click="act('wrapup')">生成总结</button>
          <button type="button" class="cp-btn" :disabled="busy || isTerminal || isBlackbox" @click="act('stop')">停止 Learn</button>
          <button type="button" class="cp-btn" :disabled="busy || isTerminal || isBlackbox" @click="act('resetPath')">重建 Path</button>
          <button type="button" class="cp-btn" :disabled="busy || isTerminal || isBlackbox" @click="act('resetLearn')">重启 Learn</button>
          <button v-if="isBlackbox && !isTerminal" type="button" class="cp-btn cp-danger-btn" :disabled="busy" @click="act('abandon')">放弃实验</button>
          <button v-if="isBlackbox && isTerminal" type="button" class="cp-btn cp-btn--primary" :disabled="busy" @click="act('referee')">生成裁判评估</button>
          <button v-if="isBlackbox && isTerminal" type="button" class="cp-btn" :disabled="busy" @click="act('rerun')">按原输入重跑</button>
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

const isBlackbox = computed(() => !!(stageResults.value.blackbox || stageResults.value.experiment))
const blackboxTraceCount = computed(() => {
  const bb = (stageResults.value.blackbox || {}) as Record<string, unknown>
  const trace = bb.publicTrace
  return Array.isArray(trace) ? trace.length : 0
})
const modeText = computed(() => (isBlackbox.value ? '黑盒模式' : '辅助模式'))
const isTerminal = computed(() => {
  const st = String(session.value?.status || runtime.value.status || '')
  return ['completed', 'failed', 'abandoned', 'error', 'done', 'wrapup'].includes(st)
})
const statusTone = computed(() =>
  !session.value ? 'mk-status--muted' : isTerminal.value ? 'mk-status--ok' : 'mk-status--warn'
)
const statusTitle = computed(() =>
  !session.value ? '加载中…' : isTerminal.value ? '会话已终态' : '会话进行中'
)

/* 阶段流 */
const stageFlow = ['goal', 'path', 'learn', 'wrapup'] as const
const currentStage = computed(() =>
  String(runtime.value.currentStage || session.value?.currentStage || 'goal').toLowerCase()
)

function stageLabel(st: string) {
  return { goal: 'Goal 对话', path: 'Path 生成', learn: 'Learn 学习', wrapup: 'Wrapup 总结' }[st] || st
}
function stageCls(st: string) {
  const idx = stageFlow.indexOf(st as (typeof stageFlow)[number])
  const cur = stageFlow.indexOf(currentStage.value as (typeof stageFlow)[number])
  const curIdx = cur === -1 ? 0 : cur
  return {
    'cp-stage--done': idx < curIdx || (isTerminal.value && st === 'wrapup'),
    'cp-stage--active': idx === curIdx && !isTerminal.value
  }
}
function stageState(st: string) {
  const idx = stageFlow.indexOf(st as (typeof stageFlow)[number])
  const cur = stageFlow.indexOf(currentStage.value as (typeof stageFlow)[number])
  if (idx < cur) return '已完成'
  if (idx === cur) return isTerminal.value ? '已完成' : '进行中'
  return '未开始'
}

/* 阶段摘要（读 runtime.stageStatus 真实结构） */
const goalInfo = computed(() => {
  const g = stageStatus.value.goal || {}
  if (g.conversationId) return `对话已创建 · ${g.ready ? '就绪' : '进行中'}`
  return ''
})
const pathInfo = computed(() => {
  const p = stageStatus.value.path || {}
  if (p.generated) return p.totalMilestones ? `${p.totalMilestones} 个里程碑已生成` : '路径已生成'
  return ''
})
const learnInfo = computed(() => {
  const l = stageStatus.value.learning || {}
  if (l.currentTaskTitle) return `当前任务：${String(l.currentTaskTitle)}`
  if (l.teachingSessionId) return '教学会话进行中'
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
    await loadLogs()
    parseBlackbox()
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

/* 控制动作 */
async function act(kind: string) {
  if (busy.value) return
  busy.value = true
  const id = sessionId.value
  try {
    switch (kind) {
      case 'step':
        if (isBlackbox.value) await adminVirtualLearnersApi.blackboxVirtualSessionStep(id, blackboxTraceCount.value)
        else await adminVirtualLearnersApi.virtualSessionStep(id)
        break
      case 'auto':
        await adminVirtualLearnersApi.virtualSessionAuto(id, { maxRounds: 10 })
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
    showToast(`执行失败：${errMsg(e)}`, 'mk-toast--bad')
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

/* 日志轮询（非终态 5s） */
let pollTimer: ReturnType<typeof setInterval> | null = null
function startPolling() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = setInterval(() => {
    if (document.hidden || isTerminal.value) return
    void loadLogs()
    void adminVirtualLearnersApi.getVirtualSession(sessionId.value).then((res) => {
      session.value = res.data?.data ?? res.data ?? {}
    }).catch(() => undefined)
  }, 5000)
}

watch(
  sessionId,
  async (id) => {
    if (!id) return
    session.value = null
    logs.value = []
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
const statusText = (s?: unknown) => ({ completed: '已完成', in_progress: '进行中', active: '进行中', error: '错误', failed: '失败', abandoned: '已放弃' }[String(s)] || String(s || '未知'))
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

@media (max-width: 900px) {
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
