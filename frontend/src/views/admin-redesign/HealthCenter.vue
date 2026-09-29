<template>
  <div class="mk-page">
    <div class="mk-status" :class="`mk-status--${barTone}`">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">健康中心</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta" v-if="displayReport" :title="skillCountTitle">
        技能 {{ global.total }}<template v-if="extraCapabilityCount">（含 {{ extraCapabilityCount }} 个外挂能力）</template> · 上线 {{ completionLive }}/{{ reconciliation.total }} · {{ displayReport.generatedAt ? '更新于 ' + timeAgo(displayReport.generatedAt) : '' }}
      </span>
      <span class="mk-badge" :class="topAbnormal > 0 ? 'mk-badge--bad' : 'mk-badge--ok'" v-if="displayReport" :title="badgeTitle">{{ topAbnormal > 0 ? `异常 ${topAbnormal}` : '全部健康' }}</span>
      <span class="mk-status__actions">
        <button type="button" class="mk-status__action" :disabled="loading" @click="refresh(true)">{{ loading ? '检测中…' : '刷新' }}</button>
      </span>
    </div>

    <MkEmptyState
      v-if="failed"
      tone="error"
      icon="!"
      title="健康报告加载失败"
      :description="errorText"
      action-text="重试"
      action-busy-text="重试中…"
      :action-busy="loading"
      min
      @action="refresh(true)"
    />

    <!-- 首载骨架（R3）：状态条保持可用，内容区用共享 MkSkeleton 版式占位，避免数秒空白。
         版式与真实内容一致：KPI 行 + 健康检查卡（原首块是引导卡骨架，随引导卡一并撤除） -->
    <div v-else-if="loading && !displayReport" class="hc-skel" aria-hidden="true">
      <div class="hc-summary">
        <div v-for="i in 4" :key="i" class="mk-kpi hc-skel__kpi">
          <MkSkeleton w="48%" :h="12" />
          <MkSkeleton w="64%" :h="26" :radius="8" />
        </div>
      </div>
      <section class="mk-card">
        <div class="mk-card__head"><MkSkeleton w="140" :h="14" /></div>
        <MkSkeleton class="hc-skel__rows" variant="rows" :count="7" :h="22" :radius="8" />
      </section>
    </div>

    <template v-else-if="displayReport">
      <!-- 「本页看什么？」引导卡 2026-09-29 撤除（用户：「这个说明文不需要占位了吧」）：
           它原本的职责是解释「三个 tab 各是什么」，合一成页后三段标题自解释；
           术语本身（ACTIVE / W1-W4 / 哈希漂移 / 遥测漂移…）在顶栏「运营术语表」的「健康」类下
           有更细的词条，口径留在各段标题与卡片的 title 上，不必再占 48px 首屏。
           下面删掉 kpi 前的引导卡后，概要 KPI 上移到首屏。 -->

      <!-- 概要 KPI（共享 MkKpi 统一形态：标签 + 数字 + 副行，可点击跳转锚点） -->
      <div class="hc-summary">
        <MkKpi
          label="健康检查"
          :value="displayReport.health.summary.total"
          :hint="healthAbnormal > 0 ? `${healthAbnormal} 异常` : '全部正常'"
          :tone="healthAbnormal > 0 ? 'warn' : 'ok'"
          clickable
          :title="`${displayReport.health.summary.total} 项健康检查，${healthAbnormal} 项异常`"
          @click="kpiGo('health')"
        />
        <MkKpi
          :label="TERMS.driftContract"
          :value="driftActionable"
          :hint="driftActionable > 0 ? '需处理' : drift.runtime > 0 ? `另 ${drift.runtime} 条只读遥测` : '正常'"
          :tone="driftActionable > 0 ? 'warn' : 'ok'"
          clickable
          :title="driftCardTitle"
          @click="kpiGo('drift')"
        />
        <MkKpi
          :label="TERMS.reconcile"
          :value="reconciliation.total"
          :hint="reconAbnormal > 0 ? `${reconAbnormal} 异常` : '一致'"
          :tone="reconAbnormal > 0 ? 'warn' : 'ok'"
          clickable
          :title="reconCardTitle"
          @click="kpiGo('recon')"
        />
        <MkKpi
          label="已上线"
          :value="completionLive"
          :hint="completionHint"
          tone="ok"
          clickable
          :title="`完成度已达 live 档的技能数：${completionLive} / ${reconciliation.total} 个登记`"
          @click="kpiGo('completion')"
        />
      </div>

      <!-- 健康检查 -->
      <section class="mk-card" id="hc-health">
        <details open>
          <summary class="mk-card__head mk-section__summary">
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

      <!-- 漂移：配置与生效不一致（改完配置没同步/发布，普通运营可理解为「配置改了但没生效」）
           段内那行可见说明 2026-09-29 收进折叠头条的 title（用户：「说明文不需要占位」）：
           三行漂移各自带「去同步/去发布/执行日志」出口与 title 口径，说明文只是重复。 -->
      <section v-if="driftAny" class="mk-card" id="hc-drift">
        <details open>
          <summary
            class="mk-card__head mk-section__summary"
            title="配置内容与实际运行不一致：通常是修改了 Skill 配置但尚未同步/发布生效；处理后可保持线上行为与配置一致"
          >
            <h3 class="mk-card__title">{{ TERMS.driftContract }}</h3>
            <span class="mk-card__meta">{{ driftActionable }} 项需处理</span>
            <span v-if="drift.runtime" class="mk-card__meta">遥测 {{ drift.runtime }} 条</span>
          </summary>
          <div class="hc-drift">
            <div class="hc-drift__item" v-if="drift.contract">
              <strong :title="TERMS.driftValueMismatch">{{ TERMS.driftContractQualified }}</strong>
              <span class="mk-badge mk-badge--bad" title="编排文件声明与数据库不一致的处数">{{ drift.contract }}</span>
              <button type="button" class="mk-link" @click="goDrift('contract')">去同步 →</button>
            </div>
            <div class="hc-drift__item" v-if="drift.hash">
              <strong title="核心文件与编译产物、数据库三方哈希不一致">{{ TERMS.driftHashQualified }}</strong>
              <span class="mk-badge mk-badge--bad" title="需重新编译/发布使生效的处数">{{ drift.hash }}</span>
              <button type="button" class="mk-link" @click="goDrift('hash')">去发布 →</button>
            </div>
            <div class="hc-drift__item" v-if="drift.runtime">
              <strong title="线上实际调用使用的提示词版本与当前配置不一致">{{ TERMS.driftRuntime }}</strong>
              <span class="mk-badge mk-badge--info" :title="`所有调用中 prompt 与数据库 ACTIVE 不一致的历史记录（最近 ${drift.runtime} 条采样）`">{{ drift.runtime }}</span>
              <button type="button" class="mk-link" @click="goDrift('runtime')">执行日志 →</button>
              <span class="hc-drift__hint">只读观测记录：若确认线上行为正常可忽略；配置同步后不再新增。</span>
            </div>
          </div>
        </details>
      </section>

      <!-- 技能对账（SkillReconciliation 自身即是 mk-card，外层仅作滚动锚点，避免卡中卡） -->
      <section id="hc-recon" class="hc-anchor">
        <!-- @openSkill 此前未绑定 → 对账行点击无反应（审计 附 A #5）。绑定到全局 skill 抽屉。 -->
        <SkillReconciliation ref="reconRef" :report="reconReport" :error="reconError" @openSkill="openSkillDrawer" @refresh="emit('refreshRecon')" />
      </section>

      <!-- 完成度分布（归属对账视图：完成度即对账 completion 映射的来源） -->
      <section class="mk-card" id="hc-completion">
        <details>
          <summary class="mk-card__head mk-section__summary">
            <h3 class="mk-card__title">完成度分布</h3>
            <span class="mk-card__meta">{{ completionLive }} / {{ reconciliation.total }} 已上线</span>
          </summary>
          <div class="hc-completion">
            <div v-for="tier in completionTiers" :key="tier.status" class="hc-completion__bar">
              <span class="hc-completion__label">{{ tier.label }}</span>
              <span class="mk-minibar hc-completion__track"><i class="mk-minibar__fill" :style="{ width: Math.max((tierCount(tier.status) / Math.max(reconciliation.total, 1)) * 100, 0) + '%' }" :class="`hc-completion__fill--${tier.status}`"></i></span>
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
import { isLive, openSkillDrawer } from './store'
import {
  adminHealthCenterApi,
  type HealthCenterItem,
  type HealthCenterItemId,
  type HealthCenterSummaryReport,
  type HealthDriftSummary,
  type HealthGlobalSummary,
  type HealthReconciliationSummary,
  type SkillReconciliationReport,
} from '@/api/adminApi'
import { TERMS } from './terms'
import { COMPLETION_META, SEMANTICS_META } from './glossaryMeta'
import { EXTRA_CAPABILITY_SKILLS } from './capabilityCatalog'
import MkKpi from '@/components/mk/MkKpi.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkSkeleton from '@/components/mk/MkSkeleton.vue'
import SkillReconciliation from './SkillReconciliation.vue'

/* ---------- 独立场景（2026-09-29 用户拍板：合一 + 独立 + 归系统组） ----------
   此前它是 skills 宿主的 3 个 tab（健康检查 / 漂移 / 对账），靠 view prop 单选渲染。
   那三个 tab 本就是同一份报表的三刀（后端一次返回 13 项检查 + 漂移分维度 + 对账 + 完成度），
   且刀口切错：唯一 error 级的「参数一致性 19 处」属 baseline-drift，却只出现在健康检查里，
   漂移 tab 显示 0 项需处理。现在整页呈现全部区块（健康检查 → 漂移 → 对账 → 完成度），
   三个 id（#hc-health / #hc-drift / #hc-recon）继续存在，作为概要卡跳转的锚点。 */
/* reconReport/reconError：对账面板可直接用外部下发的报告（缺省自行拉取）。
   Skill 运行页的完成度列也要对账报告，跨页下发属可选优化，故两者都可缺省。 */
defineProps<{ reconReport?: SkillReconciliationReport | null; reconError?: string | null }>()
const emit = defineEmits<{ (e: 'refreshRecon'): void }>()

const reconRef = ref<{ openPanel?: () => void } | null>(null)

/** 外挂能力数（MCP + 能力 Skill）：健康中心/对账的登记总数含它们，Skill 运行页不含——口径标注用 */
const extraCapabilityCount = EXTRA_CAPABILITY_SKILLS.length

/** 只读观测不计入「需处理」：漂移卡仅统计契约漂移 + W4 哈希漂移 */
const driftActionable = computed(() => (displayReport.value?.drift?.contract || 0) + (displayReport.value?.drift?.hash || 0))
const driftAny = computed(() => (displayReport.value?.drift?.contract || 0) + (displayReport.value?.drift?.hash || 0) + (displayReport.value?.drift?.runtime || 0) > 0)
/** 对账异常口径：剔除与健康检查「ACTIVE 检查（W1）」同源的 zombieSkillActive，避免同一条异常计两次 */
const reconAbnormal = computed(() => {
  const r = displayReport.value?.reconciliation
  return (r?.missingRegistration || 0) + (r?.zombieRegistration || 0) + (r?.missingActive || 0) + (r?.zombieActive || 0) + (r?.unwired || 0)
})
const completionLive = computed(() => displayReport.value?.completion?.live || 0)
/** 概要卡副行统一成「状态词」：原来这张是裸 `/ 37`，与「1 异常 / 一致 / 另 50 条只读遥测」不成句。
    总数仍可从卡头「已上线 37/37」与 title 读到，不必在副行重复。 */
const completionHint = computed(() => {
  const pending = reconciliation.value.total - completionLive.value
  return pending > 0 ? `待上线 ${pending} 个` : '全部上线'
})

/** 概要卡 tooltip：解释口径，避免红色数字误读 */
const driftCardTitle = computed(() => {
  const parts = [`需处理：${driftActionable.value} 项（配置改后未同步/发布生效）`]
  if (drift.value.runtime > 0) parts.push(`另 ${drift.value.runtime} 条运行观测记录为只读参考，不计入需处理`)
  return parts.join('；')
})
const reconCardTitle = computed(() => {
  const r = reconciliation.value
  const parts = [
    `登记缺项 ${r.missingRegistration}`,
    `失效注册 ${r.zombieRegistration}`,
    `无生效版本 ${r.missingActive}`,
    `失效生效版本 ${r.zombieActive}`,
    `接线不一致 ${r.unwired}`,
  ]
  const note = r.zombieSkillActive > 0 ? `（另有 ${r.zombieSkillActive} 条失效 ACTIVE 与健康检查「生效版本检查」同源，不重复计数）` : ''
  const scope = extraCapabilityCount > 0 ? `（对账总数含 ${extraCapabilityCount} 个外挂能力，Skill 运行页不含）` : ''
  return parts.join(' · ') + note + scope
})
const skillCountTitle = computed(
  () => `登记总数 ${global.value.total} = Skill 运行 ${global.value.total - extraCapabilityCount} 个 + 外挂能力 ${extraCapabilityCount} 个（数据源 prompts/skills.yaml）`,
)
const badgeTitle = computed(() => {
  const c = counts.value
  const parts: string[] = []
  if (c.error > 0) parts.push(`${c.error} 项严重`)
  if (c.warn > 0) parts.push(`${c.warn} 项关注`)
  if (global.value.abnormalSkills > 0) parts.push(`${global.value.abnormalSkills} 项技能完成度未达标`)
  const note = drift.value.runtime > 0 ? `；另有 ${drift.value.runtime} 条运行观测记录（只读参考，非异常）` : ''
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

/** 概要卡跳转：整页呈现后一律锚点滚动（此前单视图模式下要通知宿主切 tab） */
function kpiGo(target: 'health' | 'drift' | 'recon' | 'completion') {
  scrollTo(target === 'completion' ? 'completion' : target)
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
function visibleDetail(item: HealthCenterItem): string[] {
  // 运行时遥测：后端按 Skill 归并 + 带最近时间 → 先本地化再截断（归并后行数通常很少）
  if (item.id === 'runtime-prompt') return runtimePromptLines(item).slice(0, DETAIL_LIMIT)
  return item.detail.slice(0, DETAIL_LIMIT)
}
/** 运行时遥测明细本地化：后端 `agent ×N @ ISO` → `agent ×N｜最近 9月6日 10:14` */
function runtimePromptLines(item: HealthCenterItem): string[] {
  return item.detail.map((line) => {
    const at = line.lastIndexOf(' @ ')
    if (at < 0) return line
    const ts = new Date(line.slice(at + 3)).getTime()
    return Number.isFinite(ts) ? `${line.slice(0, at)}｜最近 ${formatLocalTime(ts)}` : line
  })
}
function formatLocalTime(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return '—'
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`
}
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
/** 归一 skillId：去 skill: 前缀并校验词法，不合法返回 null（detail 是自由文本，宁缺毋滥） */
function normSkillId(token: string | undefined): string | null {
  const t = (token ?? '').replace(/^skill:/, '')
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(t) ? t : null
}
/** 从检查项明细尽力提取首个 skillId（hash/yaml 异常跳 Skill 工作台时深链 ?skill= 定位用）。
    后端 detail 为自由文本，按各检查项的实际格式宽松解析：w4 行首是 agentId（`skill:<id> status=…`）、
    params 行首是裸 skillId（`<id> <字段>：core=…`，缺声明行首是「[提示]」自然解析不出）、
    yaml 交叉校验的 skillId 内嵌在全角冒号后（`…：<id>` / `…：<id>=`）。提取不到则退回不带参跳转。 */
function extractSkillId(id: HealthCenterItemId): string | null {
  const lines = displayReport.value?.health.items.find((i) => i.id === id)?.detail ?? []
  if (id === 'w4-corehash') return normSkillId(lines[0]?.split(/\s+/)[0])
  if (id === 'params-consistency') {
    for (const line of lines) {
      const hit = normSkillId(line.split(/\s+/)[0])
      if (hit) return hit
    }
    return null
  }
  for (const line of lines) {
    const m = /[：:]\s*([a-z0-9]+(?:-[a-z0-9]+)*)(?:[=\s]|$)/.exec(line)
    if (m) return m[1]
  }
  return null
}
/** Skill 工作台深链：能定位到具体 skill 就带上 ?skill=。
    注意：目标页 PromptWorkbench.vue（/admin/skill-workbench）目前【未】消费该参数
    （纯核心文件清单页，无 route.query 读取），本次只把参数带上、不改目标页，
    待其支持后深链即自动生效（落点为列表页首行定位的预留约定）。 */
function workbenchPath(id: HealthCenterItemId): string {
  const skillId = extractSkillId(id)
  return skillId ? `/admin/skill-workbench?skill=${encodeURIComponent(skillId)}` : '/admin/skill-workbench'
}
function goDrift(kind: keyof HealthDriftSummary) {
  if (kind === 'contract') void router.push('/admin/orchestrator?tab=drift')
  // hash 漂移即健康项 w4-corehash 的口径（HealthDriftSummary 注释），深链带上首个漂移 skill
  else if (kind === 'hash') void router.push(workbenchPath('w4-corehash'))
  else void router.push('/admin/execution-logs')
}

/** manual 项跳对应面板：字段路由/契约维度 → 编排图漂移 tab；参数/契约/yaml → Skill 工作台；
    其余（W1/W2/W3 对账族等）**留在本页**：它们的检查行就在本页健康检查区，
    展开明细并滚过去即可——原兜底指向 /admin/skills?tab=health，那是本页被抽出前的宿主，
    2026-09-29 抽出后那条路径只会绕一圈回到本页（Skills 侧还会把退役 tab 改投回来）。 */
function jump(id: HealthCenterItemId) {
  if (id === 'field-routing' || id === 'field-routing-contract' || id === 'fields-sync') void router.push('/admin/orchestrator?tab=drift')
  else if (id === 'yaml-crosscheck' || id === 'params-consistency') void router.push(workbenchPath(id))
  else {
    scrollTo('health')
    if (!detailOpen(id)) toggleDetail(id)
  }
}

async function fix(id: HealthCenterItemId) {
  const item = displayReport.value?.health.items.find((i) => i.id === id)
  // 安全审计 K-M1：一键修复（编译 core + DB 对账 + 重写 snapshots）执行前二次确认，注明检查项与影响范围
  const ok = await askConfirm({
    title: '一键修复',
    message: `将执行「${item?.label || id}」的自动修复：编译相关 core 文件、执行 DB 对账并重写 agent-snapshots。执行前自动备份、结果写入审计日志。`,
    confirmText: '执行修复',
    danger: false,
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
/* 概要 KPI（共享 MkKpi 组件：标签 + 数字 + 副行，点击跳转锚点） */
.hc-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 14px; }
/* 首载骨架（R3）：形状由 MkSkeleton 提供，本类只补占位布局与间距 */
.hc-skel__kpi { display: grid; gap: 8px; align-content: start; }
.hc-skel__rows { padding: 12px 16px 14px; }
/* 滚动锚点（技能对账外层：组件自身即卡，这里只留定位不留卡盒） */
.hc-anchor { scroll-margin-top: 14px; }

/* 可折叠头走 .mk-section__summary（shared.css） */


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
.hc-check__main strong { font-size: var(--mk-fs-micro); }
.hc-check__main span { font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.hc-check__num { font-size: var(--mk-fs-body); font-weight: 800; color: var(--mk-ink); min-width: 30px; text-align: right; }
.hc-check__sem { font-size: var(--mk-fs-micro); color: var(--mk-muted); background: var(--mk-line); padding: 1px 6px; border-radius: 4px; white-space: nowrap; }
.hc-check__caret { color: var(--mk-faint); font-size: var(--mk-fs-micro); }
.hc-check__actions { display: flex; align-items: center; }
.hc-check__detail { grid-column: 1 / -1; padding: 0 0 10px 18px; display: grid; gap: 4px; }
.hc-check__detail p { margin: 0; font-family: var(--mk-mono); font-size: var(--mk-fs-micro); line-height: 1.5; color: var(--mk-muted); overflow-wrap: anywhere; }
.hc-check__detail-more { color: var(--mk-amber) !important; }

/* 其余正常项折叠组 */
.hc-ok { border-top: 1px dashed var(--mk-line); }
.hc-ok__summary { display: flex; align-items: center; gap: 8px; padding: 8px 16px; cursor: pointer; user-select: none; list-style: none; font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-muted); }
.hc-ok__summary::-webkit-details-marker { display: none; }
.hc-ok__summary::before { content: "▸"; color: var(--mk-blue); transition: transform 0.14s ease; }
.hc-ok[open] > .hc-ok__summary::before { transform: rotate(90deg); }
.hc-ok__label { color: var(--mk-green); }
.hc-ok .hc-check:last-child { border-bottom: none; }

/* 漂移 */
.hc-drift { padding: 8px 0; }
.hc-drift__item { display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-bottom: 1px solid var(--mk-line); flex-wrap: wrap; }
.hc-drift__item:last-child { border-bottom: none; }
.hc-drift__item strong { font-size: var(--mk-fs-micro); }
.hc-drift__hint { font-size: var(--mk-fs-micro); color: var(--mk-faint); width: 100%; padding-left: 0; }

/* 完成度条 */
.hc-completion { display: grid; gap: 8px; padding: 14px 16px; }
.hc-completion__bar { display: flex; align-items: center; gap: 10px; }
.hc-completion__label { font-size: var(--mk-fs-micro); font-weight: 700; width: 100px; flex-shrink: 0; color: var(--mk-muted); }
/* 进度条统一走 .mk-minibar（shared.css）；本类只保留布局与完成度色调 */
.hc-completion__track { flex: 1; }
.hc-completion__fill--draft { background: var(--mk-rec-draft); }
.hc-completion__fill--handler-ready { background: var(--mk-rec-handler); }
.hc-completion__fill--core-ready { background: var(--mk-rec-core); }
.hc-completion__fill--fields-synced { background: var(--mk-rec-synced); }
.hc-completion__fill--live { background: var(--mk-rec-live); }
.hc-completion__num { font-size: var(--mk-fs-micro); font-weight: 800; min-width: 30px; text-align: right; }

@media (max-width: 700px) { .hc-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); } }

/* 4K：检查行/完成度条跟随全站节奏（概要 KPI 由 MkKpi 自带档位） */
@media (min-width: 2000px) {
  .hc-check__main strong { font-size: var(--mk-fs-body); }
  .hc-check__main span, .hc-check__sem { font-size: var(--mk-fs-micro); }
  .hc-check__num { font-size: var(--mk-fs-body); }
  .hc-drift__item strong { font-size: var(--mk-fs-body); }
  .hc-completion__label { font-size: var(--mk-fs-micro); }
  .hc-completion__num { font-size: var(--mk-fs-micro); }
}
@media (min-width: 2800px) {
  .hc-check__main strong { font-size: var(--mk-fs-body); }
  .hc-check__main span, .hc-check__sem { font-size: var(--mk-fs-micro); }
  .hc-check__num { font-size: var(--mk-fs-body); }
  .hc-drift__item strong { font-size: var(--mk-fs-body); }
  .hc-completion__label { font-size: var(--mk-fs-micro); }
  .hc-completion__num { font-size: var(--mk-fs-micro); }
}
@media (min-width: 3600px) {
  .hc-check__main strong { font-size: var(--mk-fs-emphasis); }
  .hc-check__main span, .hc-check__sem { font-size: var(--mk-fs-body); }
  .hc-check__num { font-size: var(--mk-fs-emphasis); }
  .hc-drift__item strong { font-size: var(--mk-fs-emphasis); }
  .hc-completion__label { font-size: var(--mk-fs-body); }
  .hc-completion__num { font-size: var(--mk-fs-emphasis); }
}
</style>