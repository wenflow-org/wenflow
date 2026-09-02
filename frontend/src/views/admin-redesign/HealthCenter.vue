<template>
  <div class="mk-page">
    <div class="mk-status" :class="`mk-status--${barTone}`">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">健康中心</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta" v-if="displayReport">
        技能 {{ global.total }} · 上线 {{ completionLive }}/{{ reconciliation.total }} · {{ displayReport.generatedAt ? '更新于 ' + timeAgo(displayReport.generatedAt) : '' }}
      </span>
      <span class="mk-badge" :class="topAbnormal > 0 ? 'mk-badge--bad' : 'mk-badge--ok'" v-if="displayReport" :title="badgeTitle">{{ topAbnormal > 0 ? `异常 ${topAbnormal}` : '全部健康' }}</span>
      <span class="mk-status__actions">
        <button type="button" class="mk-status__action" :disabled="loading" @click="refresh(true)">{{ loading ? '检测中…' : '刷新' }}</button>
      </span>
    </div>

    <div v-if="failed" class="mk-empty mk-empty--min">
      <span class="mk-empty__icon" aria-hidden="true">◌</span>
      <strong>健康报告加载失败</strong>
      <span>{{ errorText }}</span>
      <button type="button" class="mk-empty__action" :disabled="loading" @click="refresh(true)">{{ loading ? '重试中…' : '重试' }}</button>
    </div>

    <template v-if="displayReport">
      <!-- 四张概要卡片（MkKpi 统一形态：数字 + 标签 + 副行，可点击跳转锚点） -->
      <div class="hc-summary">
        <button type="button" class="hc-card" :class="healthAbnormal > 0 ? 'hc-card--warn' : 'hc-card--ok'" @click="scrollTo('health')" :title="`${displayReport.health.summary.total} 项健康检查，${healthAbnormal} 项异常`">
          <span class="hc-card__num">{{ displayReport.health.summary.total }}</span>
          <span class="hc-card__label">健康检查</span>
          <span class="hc-card__sub">{{ healthAbnormal > 0 ? `${healthAbnormal} 异常` : '全部正常' }}</span>
        </button>
        <button type="button" class="hc-card" :class="driftActionable > 0 ? 'hc-card--warn' : 'hc-card--ok'" @click="scrollTo('drift')" :title="driftCardTitle">
          <span class="hc-card__num">{{ driftActionable }}</span>
          <span class="hc-card__label">漂移</span>
          <span class="hc-card__sub">{{ driftActionable > 0 ? '需处理' : '正常' }}</span>
        </button>
        <button type="button" class="hc-card" :class="reconAbnormal > 0 ? 'hc-card--warn' : 'hc-card--ok'" @click="scrollTo('recon')" :title="reconCardTitle">
          <span class="hc-card__num">{{ reconciliation.total }}</span>
          <span class="hc-card__label">对账</span>
          <span class="hc-card__sub">{{ reconAbnormal > 0 ? `${reconAbnormal} 异常` : '一致' }}</span>
        </button>
        <button type="button" class="hc-card hc-card--ok" @click="scrollTo('completion')" title="完成度已达 live 档的技能数">
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
            <!-- 异常/关注项：默认展开 -->
            <div v-for="item in healthHighlight" :key="item.id" class="hc-check" :class="`hc-check--${item.severity}`">
              <button type="button" class="hc-check__row" :aria-expanded="detailOpen(item.id)" @click="toggleDetail(item.id)">
                <span class="hc-check__dot" :class="`hc-check__dot--${item.severity}`"></span>
                <span class="hc-check__main">
                  <strong>{{ item.label }}</strong>
                  <span>{{ item.cause }}</span>
                </span>
                <span class="hc-check__num" :title="countTitle(item)">{{ item.count }}</span>
                <span class="hc-check__sem" :title="semHint(item.semantics)">{{ semanticsLabel(item.semantics) }}</span>
                <span v-if="item.detail.length" class="hc-check__caret">{{ detailOpen(item.id) ? '▾' : '▸' }}</span>
              </button>
              <span class="hc-check__actions">
                <button v-if="item.action === 'fixable' && item.severity !== 'ok'" type="button" class="mk-btn mk-btn--sm" :disabled="fixingId === item.id" @click="fix(item.id)">{{ fixingId === item.id ? '修复中…' : '修复' }}</button>
                <button v-else-if="item.action === 'manual' && item.severity !== 'ok'" type="button" class="mk-btn mk-btn--sm" @click="jump(item.id)">查看 →</button>
              </span>
              <div v-if="detailOpen(item.id) && item.detail.length" class="hc-check__detail">
                <p v-for="(d, i) in visibleDetail(item)" :key="i">{{ d }}</p>
                <p v-if="detailTruncated(item)" class="hc-check__detail-more">共 {{ item.detail.length }} 条明细，仅显示前 {{ DETAIL_LIMIT }} 条</p>
              </div>
            </div>

            <!-- 正常项：收进折叠组，降低噪音 -->
            <details v-if="healthRemaining.length" class="hc-ok">
              <summary class="hc-ok__summary"><span class="hc-ok__label">其余 {{ healthRemaining.length }} 项正常</span><span class="mk-card__meta">点击展开</span></summary>
              <div class="hc-checks">
                <div v-for="item in healthRemaining" :key="item.id" class="hc-check" :class="`hc-check--${item.severity}`">
                  <button type="button" class="hc-check__row" :aria-expanded="detailOpen(item.id)" @click="toggleDetail(item.id)">
                    <span class="hc-check__dot" :class="`hc-check__dot--${item.severity}`"></span>
                    <span class="hc-check__main">
                      <strong>{{ item.label }}</strong>
                      <span>{{ item.cause }}</span>
                    </span>
                    <span class="hc-check__num" :title="countTitle(item)">{{ item.count }}</span>
                    <span class="hc-check__sem" :title="semHint(item.semantics)">{{ semanticsLabel(item.semantics) }}</span>
                    <span v-if="item.detail.length" class="hc-check__caret">{{ detailOpen(item.id) ? '▾' : '▸' }}</span>
                  </button>
                  <div v-if="detailOpen(item.id) && item.detail.length" class="hc-check__detail">
                    <p v-for="(d, i) in visibleDetail(item)" :key="i">{{ d }}</p>
                    <p v-if="detailTruncated(item)" class="hc-check__detail-more">共 {{ item.detail.length }} 条明细，仅显示前 {{ DETAIL_LIMIT }} 条</p>
                  </div>
                </div>
              </div>
            </details>
          </div>
        </details>
      </section>

      <!-- 漂移 -->
      <section v-if="driftAny" class="mk-card" id="hc-drift">
        <details class="hc-details" open>
          <summary class="mk-card__head hc-details__summary">
            <h3 class="mk-card__title">漂移</h3>
            <span class="mk-card__meta">{{ driftActionable }} 项需处理</span>
            <span v-if="drift.runtime" class="mk-card__meta">遥测 {{ drift.runtime }} 条</span>
          </summary>
          <div class="hc-drift">
            <div class="hc-drift__item" v-if="drift.contract">
              <strong>{{ TERMS.driftContractQualified }}</strong>
              <span class="mk-badge mk-badge--bad">{{ drift.contract }}</span>
              <button type="button" class="mk-link" @click="goDrift('contract')">编排结构 →</button>
            </div>
            <div class="hc-drift__item" v-if="drift.hash">
              <strong>{{ TERMS.driftHashQualified }}</strong>
              <span class="mk-badge mk-badge--bad">{{ drift.hash }}</span>
              <button type="button" class="mk-link" @click="goDrift('hash')">Skill 工作台 →</button>
            </div>
            <div class="hc-drift__item" v-if="drift.runtime">
              <strong>{{ TERMS.driftRuntime }}</strong>
              <span class="mk-badge mk-badge--info" :title="`所有调用中 prompt 与数据库 ACTIVE 不一致的历史记录（最近 ${drift.runtime} 条采样）`">{{ drift.runtime }}</span>
              <button type="button" class="mk-link" @click="goDrift('runtime')">执行日志 →</button>
              <span class="hc-drift__hint">历史遥测记录，只读观测；数据库同步后不再新增（健康检查 W4 一键修复）</span>
            </div>
          </div>
        </details>
      </section>

      <!-- 技能对账（SkillReconciliation 自身即是 mk-card，外层仅作滚动锚点，避免卡中卡） -->
      <section id="hc-recon" class="hc-anchor">
        <SkillReconciliation ref="reconRef" />
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
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { toast } from '@/utils/toast'
import { errMsg, timeAgo } from './live'
import { askConfirm } from './useConfirm'
import { useSafePolling } from '@/composables/useSafePolling'
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
import { COMPLETION_META, SEMANTICS_META } from './glossaryMeta'
import SkillReconciliation from './SkillReconciliation.vue'

const reconRef = ref<{ openPanel?: () => void } | null>(null)

/** 只读观测不计入「需处理」：漂移卡仅统计契约漂移 + W4 哈希漂移 */
const driftActionable = computed(() => (displayReport.value?.drift?.contract || 0) + (displayReport.value?.drift?.hash || 0))
const driftAny = computed(() => (displayReport.value?.drift?.contract || 0) + (displayReport.value?.drift?.hash || 0) + (displayReport.value?.drift?.runtime || 0) > 0)
/** 对账异常口径：剔除与健康检查「ACTIVE 检查（W1）」同源的 zombieSkillActive，避免同一条异常计两次 */
const reconAbnormal = computed(() => {
  const r = displayReport.value?.reconciliation
  return (r?.missingRegistration || 0) + (r?.zombieRegistration || 0) + (r?.missingActive || 0) + (r?.zombieActive || 0) + (r?.unwired || 0)
})
const completionLive = computed(() => displayReport.value?.completion?.live || 0)

/** 概要卡 tooltip：解释口径，避免红色数字误读 */
const driftCardTitle = computed(() => {
  const parts = [`需处理（契约 + W4）：${driftActionable.value} 项`]
  if (drift.value.runtime > 0) parts.push(`运行时遥测 ${drift.value.runtime} 条为只读观测，不计入需处理`)
  return parts.join('；')
})
const reconCardTitle = computed(() => {
  const r = reconciliation.value
  const parts = [
    `缺注册 ${r.missingRegistration}`,
    `幽灵注册 ${r.zombieRegistration}`,
    `缺 ACTIVE ${r.missingActive}`,
    `幽灵 ACTIVE ${r.zombieActive}`,
    `接线差集 ${r.unwired}`,
  ]
  const note = r.zombieSkillActive > 0 ? `（W1 僵尸 ACTIVE 残留 ${r.zombieSkillActive} 条与健康检查「ACTIVE 检查」同源，不重复计数）` : ''
  return parts.join(' · ') + note
})
const badgeTitle = computed(() => {
  const c = counts.value
  const parts: string[] = []
  if (c.error > 0) parts.push(`${c.error} 项严重`)
  if (c.warn > 0) parts.push(`${c.warn} 项关注`)
  if (global.value.abnormalSkills > 0) parts.push(`${global.value.abnormalSkills} 项技能完成度未达标`)
  const note = drift.value.runtime > 0 ? `；另有运行时遥测 ${drift.value.runtime} 条（只读观测，非异常）` : ''
  return parts.length > 0 ? parts.join('、') + note : '全部健康'
})

function scrollTo(id: string) {
  if (id === 'recon') {
    reconRef.value?.openPanel?.()
  }
  const el = document.getElementById('hc-' + id)
  if (!el) return
  // 滚动目标若默认折叠则先展开，避免滚到空白标题
  const details = el.querySelector('details')
  if (details && !details.open && id !== 'recon') details.open = true
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
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

/* ---------- 健康检查项分组：异常/关注项展开，正常项收进折叠组 ---------- */
function isHealthAbnormal(item: HealthCenterItem): boolean {
  return item.severity === 'error' || item.severity === 'warn' || item.count > 0
}
const healthHighlight = computed(() => sortedHealthItems.value.filter(isHealthAbnormal))
const healthRemaining = computed(() => sortedHealthItems.value.filter((i) => !isHealthAbnormal(i)))

/** 行内明细展开状态（默认：异常/关注项展开，正常项收起） */
const detailOpenIds = ref<Set<string>>(new Set())
function seedDetailOpen(items: HealthCenterItem[]) {
  const s = new Set<string>()
  for (const i of items) if (isHealthAbnormal(i)) s.add(i.id)
  detailOpenIds.value = s
}
watch(() => displayReport.value?.health.items, (items) => { if (items) seedDetailOpen(items) }, { immediate: true })
function detailOpen(id: string): boolean { return detailOpenIds.value.has(id) }
function toggleDetail(id: string) {
  const s = new Set(detailOpenIds.value)
  if (s.has(id)) s.delete(id); else s.add(id)
  detailOpenIds.value = s
}

/** 明细截断：防止几十条遥测把页面拉爆 */
const DETAIL_LIMIT = 20
function visibleDetail(item: HealthCenterItem): string[] { return item.detail.slice(0, DETAIL_LIMIT) }
function detailTruncated(item: HealthCenterItem): boolean { return item.detail.length > DETAIL_LIMIT }

/* ---------- 数字带单位 + 语义标签提示 ---------- */
const COUNT_UNITS: Record<string, string> = {
  'baseline-drift': '处不一致',
  consistency: '处偏差',
  'override-record': '条覆盖记录',
  'runtime-info': '条遥测记录',
}
function countTitle(item: HealthCenterItem): string {
  const unit = COUNT_UNITS[item.semantics] || '项'
  const detail = item.detail.length ? `（明细 ${item.detail.length} 条）` : ''
  return `${item.count} ${unit}${detail}`
}
function semHint(semantics: HealthCenterItem['semantics']): string {
  return SEMANTICS_META.find((m) => m.id === semantics)?.hint || ''
}

/* ---------- 健康检查项展示 ---------- */
const semanticsLabelMap: Record<string, string> = {
  'baseline-drift': '基准漂移',
  consistency: '一致性偏差',
  'override-record': '覆盖记录',
  'runtime-info': '运行时观测',
}
function semanticsLabel(semantics: HealthCenterItem['semantics']) {
  return semanticsLabelMap[semantics] || semantics
}

async function refresh(force = false) {
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

/* 60s 自动轮询：统一走 useSafePolling（并发守卫 + 指数退避 + 断路器 + 页面隐藏跳过），
   替代此前无防护的裸 setInterval */
const { start: startPolling, stop: stopPolling } = useSafePolling(
  async () => {
    if (isLive.value && !loading.value) await refresh(false)
  },
  {
    interval: 60_000,
    maxBackoff: 300_000,
    circuitBreakerThreshold: 5,
    skipWhenHidden: true,
  }
)
onMounted(() => {
  // ?refresh=1：深链强制重算（避开 60s 缓存）
  const force = route.query.refresh === '1' || route.query.refresh === 'true'
  if (isLive.value) void refresh(force)
  startPolling()
})
onUnmounted(() => {
  stopPolling()
})
defineExpose({ refresh })
</script>

<style scoped>
/* 概要卡片（MkKpi 同形态：数字 + 标签 + 副行，点击跳转锚点） */
.hc-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 14px; }
/* 滚动锚点（技能对账外层：组件自身即卡，这里只留定位不留卡盒） */
.hc-anchor { scroll-margin-top: 14px; }
.hc-card {
  display: grid; gap: 4px; padding: 14px 16px;
  border-radius: 12px; border: 1px solid #e8edf6;
  background: var(--mk-surface);
  text-align: left; cursor: pointer; font: inherit;
  transition: border-color 0.12s ease, box-shadow 0.12s ease, transform 0.12s ease;
}
.hc-card:hover { border-color: rgba(44,99,208,0.5); transform: translateY(-1px); }
.hc-card--ok { border-color: rgba(21,128,61,0.2); }
.hc-card--warn { border-color: rgba(220,38,38,0.25); }
.hc-card__num { font-size: 22px; font-weight: 800; line-height: 1.25; font-variant-numeric: tabular-nums; }
.hc-card--ok .hc-card__num { color: var(--mk-green); }
.hc-card--warn .hc-card__num { color: var(--mk-red); }
.hc-card__label { font-size: var(--mk-fs-12); font-weight: 700; color: var(--mk-faint); }
.hc-card__sub { font-size: var(--mk-fs-11); color: var(--mk-muted); }

/* 可折叠 */
.hc-details__summary { cursor: pointer; user-select: none; list-style: none; }
.hc-details__summary::-webkit-details-marker { display: none; }

/* 健康检查行 */
.hc-check { display: grid; grid-template-columns: 1fr auto; gap: 0 10px; padding: 0 16px; border-bottom: 1px solid var(--mk-line); }
.hc-check:last-child { border-bottom: none; }
.hc-check__row { display: flex; align-items: center; gap: 10px; padding: 10px 0; min-width: 0; background: none; border: 0; font: inherit; text-align: left; cursor: pointer; }
.hc-check__dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.hc-check__dot--ok { background: var(--mk-green); }
.hc-check__dot--warn { background: var(--mk-amber); }
.hc-check__dot--error { background: var(--mk-red); }
.hc-check__dot--info { background: var(--mk-blue); }
.hc-check__main { flex: 1; min-width: 0; display: grid; gap: 2px; }
.hc-check__main strong { font-size: var(--mk-fs-12_5); }
.hc-check__main span { font-size: var(--mk-fs-11); color: var(--mk-faint); }
.hc-check__num { font-size: var(--mk-fs-13); font-weight: 800; color: var(--mk-ink); min-width: 30px; text-align: right; }
.hc-check__sem { font-size: var(--mk-fs-11); color: var(--mk-muted); background: var(--mk-line); padding: 1px 6px; border-radius: 4px; white-space: nowrap; }
.hc-check__caret { color: var(--mk-faint); font-size: var(--mk-fs-11); }
.hc-check__actions { display: flex; align-items: center; }
.hc-check__detail { grid-column: 1 / -1; padding: 0 0 10px 18px; display: grid; gap: 4px; }
.hc-check__detail p { margin: 0; font-family: var(--mk-mono); font-size: var(--mk-fs-11); line-height: 1.5; color: var(--mk-muted); overflow-wrap: anywhere; }
.hc-check__detail-more { color: var(--mk-amber) !important; }

/* 其余正常项折叠组 */
.hc-ok { border-top: 1px dashed var(--mk-line); }
.hc-ok__summary { display: flex; align-items: center; gap: 8px; padding: 8px 16px; cursor: pointer; user-select: none; list-style: none; font-size: var(--mk-fs-12); font-weight: 700; color: var(--mk-muted); }
.hc-ok__summary::-webkit-details-marker { display: none; }
.hc-ok__summary::before { content: "▸"; color: var(--mk-blue); transition: transform 0.14s ease; }
.hc-ok[open] > .hc-ok__summary::before { transform: rotate(90deg); }
.hc-ok__label { color: var(--mk-green); }
.hc-ok .hc-check:last-child { border-bottom: none; }

/* 漂移 */
.hc-drift { padding: 8px 0; }
.hc-drift__item { display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-bottom: 1px solid var(--mk-line); flex-wrap: wrap; }
.hc-drift__item:last-child { border-bottom: none; }
.hc-drift__item strong { font-size: var(--mk-fs-12_5); }
.hc-drift__hint { font-size: var(--mk-fs-11); color: var(--mk-faint); width: 100%; padding-left: 0; }

/* 完成度条 */
.hc-completion { display: grid; gap: 8px; padding: 14px 16px; }
.hc-completion__bar { display: flex; align-items: center; gap: 10px; }
.hc-completion__label { font-size: var(--mk-fs-11); font-weight: 700; width: 100px; flex-shrink: 0; color: var(--mk-muted); }
.hc-completion__track { flex: 1; height: 8px; border-radius: 4px; background: var(--mk-line); overflow: hidden; }
.hc-completion__track i { display: block; height: 100%; border-radius: 4px; transition: width 0.3s ease; }
.hc-completion__fill--draft { background: #cbd5e1; }
.hc-completion__fill--handler-ready { background: #93c5fd; }
.hc-completion__fill--core-ready { background: #60a5fa; }
.hc-completion__fill--fields-synced { background: #3b82f6; }
.hc-completion__fill--live { background: var(--mk-green); }
.hc-completion__num { font-size: var(--mk-fs-12); font-weight: 800; min-width: 30px; text-align: right; }

@media (max-width: 700px) { .hc-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); } }

/* 4K：概要卡/检查行/完成度条跟随全站节奏 */
@media (min-width: 2000px) {
  .hc-card { padding: 16px 19px; }
  .hc-card__num { font-size: 25px; }
  .hc-card__label { font-size: 13.5px; }
  .hc-card__sub { font-size: 12.5px; }
  .hc-check__main strong { font-size: 14px; }
  .hc-check__main span, .hc-check__sem { font-size: 12.5px; }
  .hc-check__num { font-size: 14.5px; }
  .hc-drift__item strong { font-size: 14px; }
  .hc-completion__label { font-size: 12.5px; }
  .hc-completion__num { font-size: 13.5px; }
}
@media (min-width: 2800px) {
  .hc-card { padding: 19px 22px; }
  .hc-card__num { font-size: 29px; }
  .hc-card__label { font-size: 16px; }
  .hc-card__sub { font-size: 14.5px; }
  .hc-check__main strong { font-size: 16.5px; }
  .hc-check__main span, .hc-check__sem { font-size: 14.5px; }
  .hc-check__num { font-size: 17px; }
  .hc-drift__item strong { font-size: 16.5px; }
  .hc-completion__label { font-size: 14.5px; }
  .hc-completion__num { font-size: 16px; }
}
@media (min-width: 3600px) {
  .hc-card { padding: 22px 26px; }
  .hc-card__num { font-size: 34px; }
  .hc-card__label { font-size: 18.5px; }
  .hc-card__sub { font-size: 17px; }
  .hc-check__main strong { font-size: 19.5px; }
  .hc-check__main span, .hc-check__sem { font-size: 17px; }
  .hc-check__num { font-size: 20px; }
  .hc-drift__item strong { font-size: 19.5px; }
  .hc-completion__label { font-size: 17px; }
  .hc-completion__num { font-size: 18.5px; }
}

/* ================= 暗色模式（D1 补完）：健康中心 ================= */
html[data-theme='dark'] {
  .hc-card--warn { border-color: rgba(248, 113, 113, 0.25); }
}
</style>