<template>
  <div class="mk-page">
    <div class="mk-status" :class="`mk-status--${barTone}`">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">巡检工作台</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta" v-if="displayReport">Skill {{ global.total }} · {{ displayReport.generatedAt ? '更新于 ' + timeAgo(displayReport.generatedAt) : '' }}</span>
      <span class="mk-badge" :class="topAbnormal > 0 ? 'mk-badge--bad' : 'mk-badge--ok'" v-if="displayReport">{{ topAbnormal > 0 ? `异常 ${topAbnormal}` : '全部健康' }}</span>
      <span class="mk-status__spacer"></span>
      <button type="button" class="mk-status__action" :disabled="loading" @click="refresh(true)">{{ loading ? '检测中…' : '刷新' }}</button>
    </div>

    <div v-if="failed" class="wb-failed"><span>加载失败：{{ errorText }}</span> <button type="button" class="mk-status__action" :disabled="loading" @click="refresh(true)">重试</button></div>

    <template v-if="displayReport">
      <!-- 四张概要卡片 -->
      <div class="hc-summary">
        <button type="button" class="hc-card" :class="healthAbnormal > 0 ? 'hc-card--warn' : 'hc-card--ok'" @click="scrollTo('health')">
          <span class="hc-card__num">{{ displayReport.health.summary.total }}</span>
          <span class="hc-card__label">健康检查</span>
          <span class="hc-card__sub">{{ healthAbnormal > 0 ? `${healthAbnormal} 异常` : '全部正常' }}</span>
        </button>
        <button type="button" class="hc-card" :class="driftTotal > 0 ? 'hc-card--warn' : 'hc-card--ok'" @click="scrollTo('drift')">
          <span class="hc-card__num">{{ driftTotal }}</span>
          <span class="hc-card__label">漂移</span>
          <span class="hc-card__sub">{{ driftTotal > 0 ? '需处理' : '正常' }}</span>
        </button>
        <button type="button" class="hc-card" :class="reconAbnormal > 0 ? 'hc-card--warn' : 'hc-card--ok'" @click="scrollTo('recon')">
          <span class="hc-card__num">{{ reconciliation.total }}</span>
          <span class="hc-card__label">对账</span>
          <span class="hc-card__sub">{{ reconAbnormal > 0 ? `${reconAbnormal} 异常` : '一致' }}</span>
        </button>
        <button type="button" class="hc-card hc-card--ok" @click="scrollTo('completion')">
          <span class="hc-card__num">{{ completionLive }}</span>
          <span class="hc-card__label">已上线</span>
          <span class="hc-card__sub">/ {{ reconciliation.total }}</span>
        </button>
      </div>

      <!-- 健康检查 -->
      <section class="mk-card" id="hc-health">
        <details class="hc-details" open>
          <summary class="mk-card__head hc-details__summary">
            <h3 class="mk-card__title">健康检查</h3>
            <span class="mk-card__meta">{{ displayReport.health.summary.total }} 项</span>
            <span class="mk-badge" :class="healthAbnormal > 0 ? 'mk-badge--bad' : 'mk-badge--ok'">{{ healthAbnormal > 0 ? `${healthAbnormal} 异常` : '无异常' }}</span>
          </summary>
          <div class="hc-checks">
            <div v-for="item in sortedHealthItems" :key="item.id" class="hc-check" :class="`hc-check--${item.severity}`">
              <span class="hc-check__dot" :class="`hc-check__dot--${item.severity}`"></span>
              <div class="hc-check__main">
                <strong>{{ item.label }}</strong>
                <span>{{ item.cause }}</span>
              </div>
              <span class="hc-check__count">{{ item.count }}</span>
              <span class="hc-check__sem">{{ semanticsLabel(item.semantics) }}</span>
              <button v-if="item.action === 'fixable' && item.severity !== 'ok'" type="button" class="hc-check__btn" :disabled="fixingId === item.id" @click="fix(item.id)">{{ fixingId === item.id ? '修复中…' : '修复' }}</button>
              <button v-else-if="item.action === 'manual' && item.severity !== 'ok'" type="button" class="hc-check__btn" @click="jump(item.id)">查看 →</button>
            </div>
          </div>
        </details>
      </section>

      <!-- 漂移 -->
      <section v-if="driftTotal > 0" class="mk-card" id="hc-drift">
        <details class="hc-details" open>
          <summary class="mk-card__head hc-details__summary">
            <h3 class="mk-card__title">漂移</h3>
            <span class="mk-card__meta">{{ driftTotal }} 项</span>
          </summary>
          <div class="hc-drift">
            <div class="hc-drift__item" v-if="drift.contract">
              <strong>{{ TERMS.driftContractQualified }}</strong>
              <span class="mk-badge" :class="badgeCls(drift.contract, 'bad')">{{ drift.contract }}</span>
              <button type="button" class="mk-link" @click="goDrift('contract')">编排结构 →</button>
            </div>
            <div class="hc-drift__item" v-if="drift.hash">
              <strong>{{ TERMS.driftHashQualified }}</strong>
              <span class="mk-badge" :class="badgeCls(drift.hash, 'bad')">{{ drift.hash }}</span>
              <button type="button" class="mk-link" @click="goDrift('hash')">Skill 工作台 →</button>
            </div>
            <div class="hc-drift__item" v-if="drift.runtime">
              <strong>{{ TERMS.driftRuntime }}</strong>
              <span class="mk-badge" :class="badgeCls(drift.runtime, 'warn')">{{ drift.runtime }}</span>
              <button type="button" class="mk-link" @click="goDrift('runtime')">执行日志 →</button>
            </div>
          </div>
        </details>
      </section>

      <!-- 技能对账 -->
      <section class="mk-card" id="hc-recon">
        <SkillReconciliation />
      </section>

      <!-- 完成度分布 -->
      <section class="mk-card" id="hc-completion">
        <details class="hc-details">
          <summary class="mk-card__head hc-details__summary">
            <h3 class="mk-card__title">完成度分布</h3>
            <span class="mk-card__meta">{{ completionLive }} / {{ reconciliation.total }} 已上线</span>
          </summary>
          <div class="hc-completion">
            <div v-for="tier in completionTiers" :key="tier.status" class="hc-completion__bar">
              <span class="hc-completion__label">{{ tier.label }}</span>
              <span class="hc-completion__track"><i :style="{ width: Math.max((tierCount(tier.status) / Math.max(reconciliation.total, 1)) * 100, 0) + '%' }" :class="`hc-completion__fill--${tier.status}`"></i></span>
              <span class="hc-completion__num">{{ tierCount(tier.status) }}</span>
            </div>
          </div>
        </details>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { toast } from '@/utils/toast'
import { errMsg, timeAgo } from './live'
import { askConfirm } from './useConfirm'
import { isLive } from './store'
import {
  adminHealthCenterApi,
  type HealthCenterItem,
  type HealthCenterItemId,
  type HealthCenterSummaryReport,
  type HealthDriftSummary,
  type HealthGlobalSummary,
  type HealthReconciliationSummary,
} from '@/api/adminApi'
import { TERMS } from './terms'
import { COMPLETION_META } from './glossaryMeta'
import SkillReconciliation from './SkillReconciliation.vue'

const driftTotal = computed(() => (displayReport.value?.drift?.contract || 0) + (displayReport.value?.drift?.hash || 0) + (displayReport.value?.drift?.runtime || 0))
const reconAbnormal = computed(() => { const r = displayReport.value?.reconciliation; return (r?.missingRegistration || 0) + (r?.missingActive || 0) + (r?.zombieRegistration || 0) + (r?.zombieActive || 0) + (r?.zombieSkillActive || 0) + (r?.unwired || 0) })
const completionLive = computed(() => displayReport.value?.completion?.live || 0)

function scrollTo(id: string) {
  document.getElementById('hc-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const router = useRouter()
const route = useRoute()

const report = ref<HealthCenterSummaryReport | null>(null)
const loading = ref(false)
const failed = ref(false)
const errorText = ref('')
const fixingId = ref<HealthCenterItemId | null>(null)

const displayReport = computed(() => report.value)
/** 健康检查项按 severity 降序（error→warn→ok），异常优先视觉 */
const severityOrder: Record<string, number> = { error: 0, warn: 1, ok: 2 }
const sortedHealthItems = computed(() => {
  const items = displayReport.value?.health?.items ?? []
  return [...items].sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9))
})

const global = computed<HealthGlobalSummary>(
  () => displayReport.value?.global || { total: 0, aux: 0, mainline: 0, handlerOnly: 0, abnormalSkills: 0 },
)
const drift = computed<HealthDriftSummary>(
  () => displayReport.value?.drift || { contract: 0, hash: 0, runtime: 0 },
)
const reconciliation = computed<HealthReconciliationSummary>(
  () =>
    displayReport.value?.reconciliation || {
      total: 0, missingRegistration: 0, zombieRegistration: 0,
      missingActive: 0, zombieActive: 0, zombieSkillActive: 0, unwired: 0,
    },
)
const distribution = computed(() => displayReport.value?.completion.distribution || {})
const healthAbnormal = computed(() => displayReport.value?.health.abnormal ?? 0)
const topAbnormal = computed(() => healthAbnormal.value + (displayReport.value?.global.abnormalSkills ?? 0))

/** 客户端聚合严重度计数（服务端 summary 不输出 ok/warn/error 明细） */
const counts = computed(() => {
  const c = { ok: 0, warn: 0, error: 0, info: 0 }
  for (const item of displayReport.value?.health.items || []) c[item.severity] = (c[item.severity] || 0) + 1
  return c
})

/** 分类计数（P3 对账）：按检查项 semantics 客户端实计，分类之和恒等于「N 项检查」总数，
    修复服务端 summary 分类漏计第 13 项（运行时观测）导致 12 ≠ 13 的口径差 */
const semanticsCounts = computed(() => {
  const c: Record<string, number> = {}
  for (const item of displayReport.value?.health.items || []) {
    const label = semanticsLabel(item.semantics)
    c[label] = (c[label] || 0) + 1
  }
  return c
})
const lastSemanticsKey = computed(() => Object.keys(semanticsCounts.value).slice(-1)[0] || '')

const barTone = computed(() => {
  if (!displayReport.value) return 'muted'
  if (counts.value.error > 0 || global.value.abnormalSkills > 0) return 'bad'
  if (counts.value.warn > 0) return 'warn'
  return 'ok'
})

const completionTiers = COMPLETION_META

function tierCount(status: string): number {
  return distribution.value?.[status as keyof typeof distribution.value] ?? 0
}

/* ---------- 异常显眼标注（1B mk-badge 档位：红=需处理 / 琥珀虚线=关注） ---------- */
function badgeCls(n: number, severe: 'bad' | 'warn'): string {
  if (n <= 0) return 'mk-badge--ok'
  return severe === 'bad' ? 'mk-badge--bad' : 'mk-badge--warn'
}
function driftTone(n: number): string {
  return n > 0 ? 'wb-stat--alert' : ''
}
function reconTone(key: string): string {
  return (displayReport.value?.reconciliation[key as keyof HealthReconciliationSummary] ?? 0) > 0 ? 'wb-stat--alert' : ''
}

/* ---------- 健康检查项展示（沿用 2B 现有实现） ---------- */
const statusLabelMap: Record<string, string> = {
  clean: '干净',
  drifted: '漂移',
  orphan: '孤儿',
  missing: '缺项',
  unregistered: '未注册',
  unwired: '未接线',
  'type-mismatch': '类型不一致',
  'missing-declarations': TERMS.statusMissing,
  active: '存在',
  none: '无',
  observed: '观测到',
  unavailable: '不可用',
}
function statusLabel(item: HealthCenterItem) {
  return statusLabelMap[item.status] || item.status
}
const semanticsLabelMap: Record<string, string> = {
  'baseline-drift': '基准漂移',
  consistency: '一致性偏差',
  'override-record': '覆盖记录',
  'runtime-info': '运行时观测',
}
function semanticsLabel(semantics: HealthCenterItem['semantics']) {
  return semanticsLabelMap[semantics] || semantics
}
function actionLabel(action: HealthCenterItem['action']) {
  return action === 'fixable' ? '可一键修复' : action === 'manual' ? '人工决策' : '仅观察'
}

async function refresh(force = false) {
  if (!isLive.value) return
  loading.value = true
  failed.value = false
  try {
    const res = await adminHealthCenterApi.getSummary(force)
    report.value = res.data?.data ?? null
  } catch (e) {
    failed.value = true
    errorText.value = errMsg(e)
  } finally {
    loading.value = false
  }
}

/* ---------- 跳转（2B 起全部 router 导航；入口卡 → 明细页） ---------- */
function goDrift(kind: keyof HealthDriftSummary) {
  if (kind === 'contract') void router.push('/admin/orchestrator?tab=drift')
  else if (kind === 'hash') void router.push('/admin/skill-workbench')
  else void router.push('/admin/execution-logs')
}
function goSkills(diff: '' | 'unregistered' | 'active-missing' = '') {
  const query: Record<string, string> = { recon: '1' }
  if (diff) query.diff = diff
  void router.push({ path: '/admin/skills', query })
}

/** manual 项跳对应面板：字段路由/契约维度 → 编排结构漂移 tab；参数/契约/对账类 → Skills；yaml → Skill 工作台 */
function jump(id: HealthCenterItemId) {
  if (id === 'field-routing' || id === 'field-routing-contract' || id === 'fields-sync') void router.push('/admin/orchestrator?tab=drift')
  else if (id === 'yaml-crosscheck' || id === 'params-consistency') void router.push('/admin/skill-workbench')
  else void router.push('/admin/skills')
}

async function fix(id: HealthCenterItemId) {
  const item = displayReport.value?.health.items.find((i) => i.id === id)
  // 安全审计 K-M1：一键修复（编译 core + DB 对账 + 重写 snapshots）执行前二次确认，注明检查项与影响范围
  const ok = await askConfirm({
    title: '一键修复',
    message: `将执行「${item?.label || id}」的自动修复：编译相关 core 文件、执行 DB 对账并重写 agent-snapshots。执行前自动备份、结果写入审计日志。`,
    confirmText: '执行修复',
  })
  if (!ok) return
  fixingId.value = id
  try {
    const res = await adminHealthCenterApi.fix(id)
    const data = res.data?.data
    if (!data) throw new Error('修复响应为空')
    toast.success(data.gitCommitHint)
    // 修复后强制复检并刷新（后端已写审计，缓存已失效）
    await refresh(true)
  } catch (e: any) {
    const hint = e?.response?.data?.error?.fixHint
    toast.error(`修复失败：${errMsg(e)}${hint ? `（${hint}）` : ''}`)
  } finally {
    fixingId.value = null
  }
}

onMounted(() => {
  // ?refresh=1：深链强制重算（避开 60s 缓存）
  const force = route.query.refresh === '1' || route.query.refresh === 'true'
  if (isLive.value) void refresh(force)
})
defineExpose({ refresh })
</script>

<style scoped>
/* 概要卡片 */
.hc-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 14px; }
.hc-card { display: grid; gap: 4px; padding: 18px 16px; border-radius: 10px; border: 1px solid var(--mk-line); background: var(--mk-surface); text-align: center; cursor: pointer; font: inherit; transition: border-color 0.12s ease, box-shadow 0.12s ease; }
.hc-card:hover { border-color: rgba(44,99,208,0.3); }
.hc-card--ok { border-color: rgba(21,128,61,0.2); }
.hc-card--warn { border-color: rgba(220,38,38,0.25); background: #fefafa; }
.hc-card__num { font-size: 30px; font-weight: 800; line-height: 1; }
.hc-card--ok .hc-card__num { color: var(--mk-green); }
.hc-card--warn .hc-card__num { color: var(--mk-red); }
.hc-card__label { font-size: 12px; font-weight: 700; color: var(--mk-ink); }
.hc-card__sub { font-size: 11px; color: var(--mk-faint); }

/* 可折叠 */
.hc-details__summary { cursor: pointer; user-select: none; list-style: none; }
.hc-details__summary::-webkit-details-marker { display: none; }

/* 健康检查行 */
.hc-checks { }
.hc-check { display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-bottom: 1px solid #f3f4f6; }
.hc-check:last-child { border-bottom: none; }
.hc-check__dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.hc-check__dot--ok { background: var(--mk-green); }
.hc-check__dot--warn { background: var(--mk-amber); }
.hc-check__dot--error { background: var(--mk-red); }
.hc-check__dot--info { background: var(--mk-blue); }
.hc-check__main { flex: 1; min-width: 0; display: grid; gap: 2px; }
.hc-check__main strong { font-size: 12.5px; }
.hc-check__main span { font-size: 11px; color: var(--mk-faint); }
.hc-check__count { font-size: 13px; font-weight: 800; color: var(--mk-ink); min-width: 30px; text-align: right; }
.hc-check__sem { font-size: 10.5px; color: var(--mk-faint); background: #f3f4f6; padding: 1px 6px; border-radius: 4px; white-space: nowrap; }
.hc-check__btn { border: 1px solid var(--mk-line); border-radius: 6px; background: #fff; padding: 3px 10px; font: inherit; font-size: 11px; font-weight: 600; cursor: pointer; color: var(--mk-blue); white-space: nowrap; }
.hc-check__btn:hover { border-color: var(--mk-blue); }
.hc-check__btn:disabled { opacity: 0.5; }

/* 漂移 */
.hc-drift { padding: 8px 0; }
.hc-drift__item { display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-bottom: 1px solid #f3f4f6; }
.hc-drift__item:last-child { border-bottom: none; }
.hc-drift__item strong { font-size: 12.5px; }

/* 完成度条 */
.hc-completion { display: grid; gap: 8px; padding: 14px 16px; }
.hc-completion__bar { display: flex; align-items: center; gap: 10px; }
.hc-completion__label { font-size: 11px; font-weight: 700; width: 100px; flex-shrink: 0; color: var(--mk-muted); }
.hc-completion__track { flex: 1; height: 8px; border-radius: 4px; background: #f3f4f6; overflow: hidden; }
.hc-completion__track i { display: block; height: 100%; border-radius: 4px; transition: width 0.3s ease; }
.hc-completion__fill--draft { background: #cbd5e1; }
.hc-completion__fill--handler-ready { background: #93c5fd; }
.hc-completion__fill--core-ready { background: #60a5fa; }
.hc-completion__fill--fields-synced { background: #3b82f6; }
.hc-completion__fill--live { background: var(--mk-green); }
.hc-completion__num { font-size: 12px; font-weight: 800; min-width: 30px; text-align: right; }

@media (max-width: 700px) { .hc-summary { grid-template-columns: repeat(2, 1fr); } }
</style>