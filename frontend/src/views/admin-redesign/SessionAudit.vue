<template>
  <!-- 会话评审报告（2026-11-22 UX 走查 P2.1）：裁判/角色审计 API 在 2026-09-27 拆出独立
       挂载面（POST /api/admin/session-audits/sessions/:id/evaluations）后一直只有 API 没有
       页面——报告落在 virtual_sessions 的 blackbox JSON 里，管理台没有任何一处能看。本页
       补上消费端：粘贴/深链一个已结束的黑盒运行会话，生成并阅读双评估报告。只读页面，
       不提供删除/重跑实验等危险动作。 -->
  <div class="sa mk-page mk-page--fill">
    <MkPageHead title="会话评审报告">
      <!-- 画像运行行带来的深链（?fromProfile=<id>）补返回入口：本页是一级场景，
           画像页跳来后 subPage 已被场景切换清掉，壳层面包屑回不去——没有这个按钮
           「画像 → 评审报告」只能靠浏览器后退（2026-11-22 审计 P2） -->
      <template v-if="fromProfileId" #actions>
        <button type="button" class="mk-btn mk-btn--sm" @click="goBackToProfile">返回画像</button>
      </template>
    </MkPageHead>

    <!-- 查询卡：会话 ID 输入 + 生成按钮。深链 ?session= 自动预填并生成（画像页运行记录
         「评审报告」入口落点）。同一会话重复生成由后端按报告指纹复用（不重复调用模型），
         页面只如实展示「复用已有报告」。 -->
    <div class="mk-card sa-query">
      <div class="sa-query__row">
        <input
          v-model="sessionInput"
          class="mk-field__input sa-query__input mono"
          placeholder="粘贴虚拟学习者会话 ID"
          aria-label="会话 ID"
          :disabled="generating"
          @keydown.enter="generate"
        />
        <button
          type="button"
          class="mk-btn mk-btn--primary"
          :disabled="generating || !sessionIdTrimmed"
          @click="generate"
        >{{ generating ? '生成中…' : (hasReport ? '重新生成' : '生成评审报告') }}</button>
      </div>
      <p class="sa-query__hint">评审对象是已结束的黑盒运行会话。同一份运行重复生成会返回已有报告，不会重复消耗模型调用。</p>
      <span v-if="reportedSessionId" class="sa-query__sid mono" :title="reportedSessionId">会话 {{ shortId(reportedSessionId) }}</span>
    </div>

    <!-- 失败条（R2：有输入保留输入，重试就地发起，不清空；已有报告时与报告并存，不藏内容） -->
    <div v-if="error" class="mk-alert mk-alert--row" role="alert">
      <span class="mk-alert__msg">{{ error }}</span>
      <button type="button" class="mk-alert__btn" :disabled="generating" @click="generate">{{ generating ? '生成中…' : '重试' }}</button>
    </div>

    <!-- 首次生成中的加载态 -->
    <div v-if="generating && !hasReport" class="mk-card sa-pending">
      <MkLoading text="正在生成评审报告，通常需要一两分钟…" />
    </div>

    <!-- 空态紧跟表单（2026-11-26 管理端手机走查 AM-08）：此前带 min，
         空态按 --mk-empty-min-h 铺满视口并垂直居中——桌面与手机都在表单下方留出近 930px 空白，
         首屏看不到任何结果反馈。这一页不需要「垫满一屏」，内容跟着表单走。 -->
    <MkEmptyState
      v-else-if="!hasReport && !generating"
      title="还没有评审报告"
      description="把一次已结束的黑盒运行会话 ID 粘贴进来，生成两份报告：裁判终局评审与角色保真审计。"
    />

    <!-- 双报告：platform=裁判终局评审，actor=角色保真审计。两份报告同一渲染模型，逐卡输出 -->
    <template v-else>
      <section v-for="view in reportViews" :key="view.key" class="mk-card sa-report">
        <div class="mk-card__head">
          <h3 class="mk-card__title">{{ view.title }}</h3>
          <span v-if="view.meta" class="mk-card__meta">{{ view.meta }}</span>
        </div>

        <div class="sa-verdict">
          <span class="mk-badge mk-badge--sm" :class="view.verdictTone">{{ view.verdictLabel }}</span>
          <span class="sa-verdict__overall mono">{{ view.overallText }}</span>
        </div>

        <!-- 完整性诊断：证据不足时如实列出原因（缺证据 / 缺分 / 悬空引用 / 维度缺实质证据），
             不把 inconclusive 藏成普通低分 -->
        <div v-if="view.integrityReasons.length" class="mk-alert mk-alert--row sa-integrity" role="alert">
          <span class="mk-alert__msg">这份报告证据不完整：{{ view.integrityReasons.join('；') }}</span>
        </div>

        <div v-if="view.scoreRows.length" class="sa-scores">
          <div v-for="row in view.scoreRows" :key="row.key" class="sa-score">
            <span class="sa-score__label">{{ row.label }}</span>
            <span class="sa-score__value" :class="{ 'sa-score__value--none': row.value == null }">{{ row.value == null ? '—' : row.value }}</span>
          </div>
        </div>
        <p v-else class="sa-section-empty">{{ view.emptyNote }}</p>

        <details class="sa-block" :open="view.findings.length > 0">
          <summary class="sa-block__summary">发现的问题 · {{ view.findings.length }}</summary>
          <MkEmptyState v-if="!view.findings.length" title="没有记录到问题" />
          <template v-else>
            <div v-for="f in view.findings" :key="f.code" class="sa-finding" :class="`sa-finding--${f.severityKey}`">
              <div class="sa-finding__head">
                <span class="mk-badge mk-badge--sm" :class="f.severityTone">{{ f.severityLabel }}</span>
                <span class="mk-badge mk-badge--sm mk-badge--muted">{{ f.categoryLabel }}</span>
                <strong class="sa-finding__title">{{ f.title }}</strong>
              </div>
              <p class="sa-finding__detail">{{ f.detail }}</p>
              <p v-if="f.evidenceText" class="sa-finding__refs mono">{{ f.evidenceText }}</p>
            </div>
          </template>
        </details>

        <details class="sa-block" :open="view.recommendations.length > 0">
          <summary class="sa-block__summary">改进建议 · {{ view.recommendations.length }}</summary>
          <MkEmptyState v-if="!view.recommendations.length" title="没有改进建议" />
          <template v-else>
            <div v-for="r in view.recommendations" :key="r.action" class="sa-rec">
              <div class="sa-rec__head">
                <span class="mk-badge mk-badge--sm mk-badge--info">{{ r.priority }}</span>
                <strong class="sa-rec__action">{{ r.action }}</strong>
              </div>
              <p class="sa-rec__why">{{ r.rationale }}</p>
              <p v-if="r.findingText" class="sa-rec__refs mono">{{ r.findingText }}</p>
            </div>
          </template>
        </details>

        <details class="sa-block">
          <summary class="sa-block__summary">证据明细 · {{ view.evidence.length }}</summary>
          <MkEmptyState v-if="!view.evidence.length" title="这份报告没有附证据" />
          <template v-else>
            <div v-for="ev in view.evidence" :key="ev.id" class="sa-ev">
              <div class="sa-ev__head">
                <span class="sa-ev__id mono">{{ ev.id }}</span>
                <span class="mk-badge mk-badge--sm mk-badge--muted">{{ ev.sourceLabel }}</span>
                <span v-if="ev.indexText" class="sa-ev__loc mono">{{ ev.indexText }}</span>
                <span v-if="ev.whenText" class="sa-ev__time">{{ ev.whenText }}</span>
              </div>
              <p v-if="ev.path" class="sa-ev__path mono">{{ ev.path }}</p>
              <p class="sa-ev__reading">{{ ev.interpretation }}</p>
              <blockquote v-if="ev.excerpt" class="sa-ev__excerpt">{{ ev.excerpt }}</blockquote>
            </div>
          </template>
        </details>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { adminSessionAuditsApi } from '@/api/adminApi'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkLoading from '@/components/mk/MkLoading.vue'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import { errMsg, shortId } from './live'

/* ===== 报告数据形状（与后端 referee/actorAudit 落库记录对齐；字段可能缺省，读取全部宽容） ===== */
interface ReportIntegrity {
  valid?: boolean
  missingEvidence?: boolean
  missingScores?: string[]
  danglingEvidenceRefs?: string[]
  danglingFindingCodes?: string[]
  missingDimensionEvidence?: string[]
}
interface ReportFinding {
  code: string
  severity?: string
  category?: string
  title?: string
  detail?: string
  evidenceIds?: string[]
}
interface ReportRecommendation {
  priority?: string
  action?: string
  rationale?: string
  findingCodes?: string[]
}
interface ReportEvidence {
  id: string
  source?: string
  index?: number | null
  path?: string
  timestamp?: string | null
  excerpt?: string
  interpretation?: string
}
interface ReportPayload {
  verdict?: string
  integrity?: ReportIntegrity
  scores?: Record<string, number | null>
  findings?: ReportFinding[]
  recommendations?: ReportRecommendation[]
  evidence?: ReportEvidence[]
}
interface ReportRecord {
  evaluatedAt?: string
  reused?: boolean
  evaluator?: { model?: string | null; providerId?: string | null }
  report?: ReportPayload | null
}

const route = useRoute()
const router = useRouter()
/** 画像页带来的来源（?fromProfile=<profileId>）：存在时页头给「返回画像」 */
const fromProfileId = computed(() => (typeof route.query.fromProfile === 'string' ? route.query.fromProfile : ''))
function goBackToProfile(): void {
  void router.push({ path: '/admin/virtual-learners', query: { view: 'virtual', id: fromProfileId.value } })
}
const sessionInput = ref('')
const generating = ref(false)
const error = ref('')
const platform = ref<ReportRecord | null>(null)
const actor = ref<ReportRecord | null>(null)
/** 已出报告的会话：页面用「会话 <短 ID>」回显对象，重生成不再造成歧义 */
const reportedSessionId = ref('')
const sessionIdTrimmed = computed(() => sessionInput.value.trim())
const hasReport = computed(() => !!(platform.value || actor.value))

/* ===== 展示标签映射（值全部中文，键为后端枚举；读取端按键查表，缺键回退原值） ===== */
const REFEREE_VERDICTS: Record<string, { label: string; tone: string }> = {
  pass: { label: '通过', tone: 'mk-badge--ok' },
  pass_with_concerns: { label: '通过，有保留意见', tone: 'mk-badge--warn' },
  fail: { label: '不通过', tone: 'mk-badge--bad' },
  inconclusive: { label: '证据不足，无法判定', tone: 'mk-badge--muted' }
}
const ACTOR_VERDICTS: Record<string, { label: string; tone: string }> = {
  credible: { label: '角色可信', tone: 'mk-badge--ok' },
  credible_with_concerns: { label: '角色可信，有保留意见', tone: 'mk-badge--warn' },
  invalid: { label: '角色失真', tone: 'mk-badge--bad' },
  inconclusive: { label: '证据不足，无法判定', tone: 'mk-badge--muted' }
}
const REFEREE_SCORES: Record<string, string> = {
  overall: '总分',
  goalExperience: '目标体验',
  goalUnderstanding: '目标理解',
  pathExperience: '路径体验',
  teachingExperience: '教学体验',
  controlConsistency: '控制一致性',
  boundaryIntegrity: '边界完整性',
  evidenceSufficiency: '证据充分度'
}
const ACTOR_SCORES: Record<string, string> = {
  overall: '总分',
  personaConsistency: '人设一致性',
  storyConsistency: '故事一致性',
  disclosureDiscipline: '信息边界纪律',
  frictionCalibration: '摩擦校准',
  stateContinuity: '状态连续性',
  behaviorPlausibility: '行为合理性',
  evidenceSufficiency: '证据充分度'
}
const SEVERITIES: Record<string, { label: string; tone: string }> = {
  critical: { label: '严重', tone: 'mk-badge--bad' },
  major: { label: '主要', tone: 'mk-badge--warn' },
  minor: { label: '次要', tone: 'mk-badge--muted' },
  info: { label: '提示', tone: 'mk-badge--muted' }
}
const REFEREE_CATEGORIES: Record<string, string> = {
  goal: '目标', path: '路径', teaching: '教学', control: '控制',
  boundary: '边界', completion: '完成', trace: '轨迹', data: '数据'
}
const ACTOR_CATEGORIES: Record<string, string> = {
  persona: '人设', story: '故事', disclosure: '信息边界', friction: '摩擦',
  state: '状态', behavior: '行为', trace: '轨迹'
}
const REFEREE_SOURCES: Record<string, string> = {
  publicTrace: '公开轨迹', refereeTrace: '裁判轨迹', control: '控制回执',
  experimentSummary: '实验摘要', storyMeta: '故事档案', metricCompleteness: '数据完整性'
}
const ACTOR_SOURCES: Record<string, string> = {
  actorProfile: '角色档案', story: '故事', learnerPrivateState: '私有状态',
  publicTrace: '公开轨迹', experimentSummary: '实验摘要'
}

function labelOf(map: Record<string, string>, key: string | undefined | null, fallback: string): string {
  if (!key) return fallback
  return map[key] || key
}

function formatStamp(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('zh-CN', { hour12: false })
}

function recordMeta(record: ReportRecord | null): string {
  if (!record) return ''
  const parts: string[] = []
  const at = formatStamp(record.evaluatedAt)
  if (at) parts.push(`评估于 ${at}`)
  const model = record.evaluator?.model
  if (model) parts.push(`模型 ${model}`)
  if (record.reused) parts.push('复用已有报告')
  return parts.join(' · ')
}

/** 完整性诊断 → 人类可读原因清单（valid 为 true 时为空） */
function integrityReasonsOf(payload: ReportPayload, scoreLabels: Record<string, string>): string[] {
  const integrity = payload.integrity
  if (!integrity || integrity.valid !== false) return []
  const out: string[] = []
  if (integrity.missingEvidence) out.push('没有给出任何证据')
  if (integrity.missingScores?.length) {
    out.push(`缺少评分：${integrity.missingScores.map((k) => labelOf(scoreLabels, k, k)).join('、')}`)
  }
  if (integrity.danglingEvidenceRefs?.length) out.push('有结论引用了不存在的证据编号')
  if (integrity.danglingFindingCodes?.length) out.push('有建议指向不存在的问题编号')
  if (integrity.missingDimensionEvidence?.length) {
    out.push(`缺少实质证据的维度：${integrity.missingDimensionEvidence.map((k) => labelOf(scoreLabels, k, k)).join('、')}`)
  }
  return out
}

/* ===== 双报告统一渲染模型 ===== */
interface ScoreRow { key: string; label: string; value: number | null }
interface ReportView {
  key: 'platform' | 'actor'
  title: string
  meta: string
  verdictLabel: string
  verdictTone: string
  overallText: string
  integrityReasons: string[]
  scoreRows: ScoreRow[]
  emptyNote: string
  findings: Array<{ code: string; severityKey: string; severityLabel: string; severityTone: string; categoryLabel: string; title: string; detail: string; evidenceText: string }>
  recommendations: Array<{ priority: string; action: string; rationale: string; findingText: string }>
  evidence: Array<{ id: string; sourceLabel: string; indexText: string; whenText: string; path: string; interpretation: string; excerpt: string }>
}

function buildView(
  key: 'platform' | 'actor',
  title: string,
  record: ReportRecord | null,
  verdicts: Record<string, { label: string; tone: string }>,
  scoreLabels: Record<string, string>,
  categoryLabels: Record<string, string>,
  sourceLabels: Record<string, string>,
  emptyNote: string
): ReportView {
  const payload = record?.report || {}
  const scores = payload.scores || {}
  const verdict = verdicts[payload.verdict || ''] || {
    label: payload.verdict || '报告缺失',
    tone: 'mk-badge--muted'
  }
  const scoreRows: ScoreRow[] = Object.keys(scoreLabels)
    .filter((k) => k in scores)
    .map((k) => ({ key: k, label: scoreLabels[k], value: scores[k] ?? null }))
  return {
    key,
    title,
    meta: recordMeta(record),
    verdictLabel: verdict.label,
    verdictTone: verdict.tone,
    overallText: scores.overall == null ? '' : `总分 ${scores.overall}`,
    integrityReasons: integrityReasonsOf(payload, scoreLabels),
    scoreRows,
    emptyNote,
    findings: (payload.findings || []).map((f) => ({
      code: f.code,
      severityKey: f.severity || 'minor',
      severityLabel: SEVERITIES[f.severity || '']?.label || f.severity || '提示',
      severityTone: SEVERITIES[f.severity || '']?.tone || 'mk-badge--muted',
      categoryLabel: labelOf(categoryLabels, f.category, '轨迹'),
      title: f.title || f.code,
      detail: f.detail || '',
      evidenceText: f.evidenceIds?.length ? `涉及证据：${f.evidenceIds.join('、')}` : ''
    })),
    recommendations: (payload.recommendations || []).map((r) => ({
      priority: r.priority || 'P2',
      action: r.action || '',
      rationale: r.rationale || '',
      findingText: r.findingCodes?.length ? `对应问题：${r.findingCodes.join('、')}` : ''
    })),
    evidence: (payload.evidence || []).map((ev) => ({
      id: ev.id,
      sourceLabel: labelOf(sourceLabels, ev.source, ev.source || '其他'),
      indexText: ev.index == null ? '' : `第 ${ev.index + 1} 条`,
      whenText: formatStamp(ev.timestamp),
      path: ev.path || '',
      interpretation: ev.interpretation || '',
      excerpt: ev.excerpt || ''
    }))
  }
}

/** 评分缺失时的卡内说明（两份报告同一句，常量单点避免文案复读） */
const EMPTY_SCORE_NOTE = '这份报告没有给出评分。'

const reportViews = computed<ReportView[]>(() => [
  buildView('platform', '裁判终局评审', platform.value, REFEREE_VERDICTS, REFEREE_SCORES, REFEREE_CATEGORIES, REFEREE_SOURCES, EMPTY_SCORE_NOTE),
  buildView('actor', '角色保真审计', actor.value, ACTOR_VERDICTS, ACTOR_SCORES, ACTOR_CATEGORIES, ACTOR_SOURCES, EMPTY_SCORE_NOTE)
])

/* ===== 生成动作 ===== */
async function generate(): Promise<void> {
  const sid = sessionIdTrimmed.value
  if (!sid || generating.value) return
  generating.value = true
  error.value = ''
  try {
    const res = await adminSessionAuditsApi.generateEvaluations(sid)
    const body = (res.data?.data ?? res.data ?? {}) as { platform?: ReportRecord; actor?: ReportRecord }
    platform.value = body.platform || null
    actor.value = body.actor || null
    reportedSessionId.value = sid
  } catch (e) {
    // 保留旧报告：重生成失败不清空已读内容（错误条就地给重试）
    error.value = `生成评审报告失败：${errMsg(e)}`
  } finally {
    generating.value = false
  }
}

/* 深链 ?session= 预填并自动生成；会话变化（画像页换运行点进来）跟着重查 */
onMounted(() => {
  const sid = typeof route.query.session === 'string' ? route.query.session.trim() : ''
  if (!sid) return
  sessionInput.value = sid
  void generate()
})
watch(() => route.query.session, (val) => {
  const sid = typeof val === 'string' ? val.trim() : ''
  if (!sid || sid === reportedSessionId.value) return
  sessionInput.value = sid
  void generate()
})
</script>

<style scoped>
.sa-query { margin-bottom: 12px; }
.sa-query__row { display: flex; gap: 8px; align-items: center; }
.sa-query__input { flex: 1; min-width: 0; }
.sa-query__hint { margin: 8px 2px 0; font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.sa-query__sid { display: inline-block; margin-top: 4px; font-size: var(--mk-fs-micro); color: var(--mk-faint); }

.sa-pending { padding: 32px 16px; }

.sa-report { margin-bottom: 12px; }
.sa-verdict { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 0 2px 10px; }
.sa-verdict__overall { font-size: var(--mk-fs-emphasis); font-weight: 700; color: var(--mk-ink); }

.sa-integrity { margin-bottom: 10px; }

.sa-scores { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; margin-bottom: 12px; }
.sa-score { padding: 8px 10px; background: var(--mk-surface-3); border-radius: var(--mk-radius-sm); display: flex; flex-direction: column; gap: 2px; }
.sa-score__label { font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.sa-score__value { font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--mk-ink); }
.sa-score__value--none { color: var(--mk-faint); font-weight: 400; }

.sa-section-empty { margin: 4px 2px 12px; font-size: var(--mk-fs-body); color: var(--mk-muted); }

.sa-block { border-top: 1px solid var(--mk-line); padding-top: 8px; margin-top: 4px; }
.sa-block__summary { cursor: pointer; font-size: var(--mk-fs-body); font-weight: 600; color: var(--mk-ink); user-select: none; }
.sa-block > .mk-empty { margin-top: 8px; }

.sa-finding, .sa-rec, .sa-ev { padding: 10px 2px; border-bottom: 1px dashed var(--mk-line); }
.sa-finding:last-child, .sa-rec:last-child, .sa-ev:last-child { border-bottom: 0; }
.sa-finding__head, .sa-rec__head, .sa-ev__head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.sa-finding__title, .sa-rec__action { font-size: var(--mk-fs-body); color: var(--mk-ink); }
.sa-finding__detail, .sa-rec__why, .sa-ev__reading { margin: 6px 0 0; font-size: var(--mk-fs-body); color: var(--mk-muted); line-height: 1.55; }
.sa-finding__refs, .sa-rec__refs { margin: 6px 0 0; font-size: var(--mk-fs-micro); color: var(--mk-faint); }

.sa-ev__id { font-size: var(--mk-fs-micro); color: var(--mk-blue-text); }
.sa-ev__loc { font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.sa-ev__time { font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.sa-ev__path { margin: 4px 0 0; font-size: var(--mk-fs-micro); color: var(--mk-faint); word-break: break-all; }
.sa-ev__excerpt { margin: 6px 0 0; padding: 6px 10px; border-left: 3px solid var(--mk-line); background: var(--mk-surface-3); border-radius: 0 var(--mk-radius-sm) var(--mk-radius-sm) 0; font-size: var(--mk-fs-micro); color: var(--mk-muted); white-space: pre-wrap; word-break: break-word; }
</style>
