<template>
  <!-- 记忆与复习 · 跨用户总览（2026-10-12 用户拍板恢复：独立页退役时跨用户积压视图跟着没了，
       本页从 git 历史原样找回列表态——按待复习量排序的用户列表 + 到期时间轴下钻）。
       单用户明细不在这里：点行进学习者详情「记忆与复习 / 记忆调度」页签；
       旧深链 /admin/memory-review?userId=… 转发 learner 详情（见 onMounted）。 -->
  <div class="mr mk-page mk-page--fill">
    <!-- 页头（newui/admin pagehead）：页名（悬停带口径长注）+ 作用域开关/刷新上移；
         原状态条整体退役 -->
    <MkPageHead
      title="记忆与复习观测"
      sub="遗忘曲线调度 · 到期积压、课内温故与概念归并审计"
      hint="到期积压 · 课内温故 · 概念归并审计。归并默认只记录建议，不改动数据"
    >
      <template #actions>
        <!-- 口径开关收在页头（2026-10-04 整组统一为 DataScopeToggle：学习组六页同一位、同一状态）。
             它切换的是整页口径：含虚拟学习者时，用户 / 痕迹 / 到期与归并队列一并纳入仿真账号 -->
        <DataScopeToggle v-model="includeVirtual" />
      </template>
    </MkPageHead>
    <!-- 页头 KPI 带（2026-09-28）：页级绝对值只在这里出现一次；口径说明进各卡 title。
         B5-F3-2：取数未落定前显「—」+「取数中…」（不渲染裸 0），栅格挂 aria-busy。
         2026-10-12 用户走查「怎么双 kpi」：原为两段栅格（量值五卡 + 碎片率三卡），1920 下
         两段卡宽不一致（5 卡 ~310px vs 3 卡 ~530px），读作两套 KPI——并为一条单带。
         两域取数语义各自保留：碎片域（fragmentation）缺失仍显 '—' +「指标未取到」，不当 0。 -->
    <section class="mk-kpi-grid" :aria-busy="kpiPending || undefined">
      <MkKpi
        v-for="card in headKpiCards"
        :key="card.label"
        :label="card.label"
        :value="card.value"
        :hint="card.hint"
        :tone="card.tone"
        :title="card.title"
        :aria-busy="kpiPending || undefined"
      />
    </section>

    <!-- 到期时间轴（教学组标准件 MkDistBand；点某档 = 只看窗口内该档有到期痕迹的学习者）。
         口径：复习队列 = extractionCount>0，窗口 = 最近 200 条痕迹（updatedAt 倒序），非全量
         ——全量到期数见页头 KPI「当前到期」。
         2026-10-14 用户：教学组各页这条分布带一律默认折叠（表格才是各页主体）——折叠走共享
         .mk-section__summary 原语，收起仍露标题与口径副文 -->
    <MkDistBand
      v-if="traceWindowReady"
      card
      collapsible
      class="mr-distband"
      title="到期时间轴"
      :sub="`共 ${queueRows.length} 个复习点 · 按到期时间分档`"
      unit="个"
      aria-label="按到期时间筛选学习者"
      :bins="mrDueBins"
      :active-key="dueBandFilter"
      @select="toggleDueBand"
    />

    <div class="mk-card mk-card--fill">
      <div class="mk-card__head">
        <h3 class="mk-card__title">用户列表</h3>
        <!-- 口径：totals.users 是后端全量统计，唯一住在页头 KPI「用户」卡；卡头只报本列表的窗口事实 -->
        <span class="mk-card__meta" :title="`按待复习量从多到少排序，每页 ${userPageSize} 位。全部用户数见页首「用户」卡${dueBandFilter ? '。当前按到期时间筛选，仅显示对应学习者' : ''}`">第 {{ userPage }} 页 · 每页 {{ userPageSize }} 位 · 按待复习量倒序<template v-if="dueBandFilter"> · 已筛 {{ visibleRows.length }} 位</template></span>
      </div>
      <!-- 取数失败不得渲染成「暂无数据」（R2）：有旧行时保留旧行并给带重试的 .mk-alert -->
      <div v-if="error && rows.length" class="mk-alert mk-alert--row" role="alert">
        <span class="mk-alert__msg">{{ error }}</span>
        <button type="button" class="mk-alert__btn" :disabled="loading" @click="refreshAll">{{ loading ? '重试中…' : '重试' }}</button>
      </div>
      <MkEmptyState
        v-if="error && !rows.length"
        tone="error"
        :title="error"
        description="统计数据加载失败，页面数字可能不完整。"
        action-text="重试"
        :action-busy="loading"
        action-busy-text="重试中…"
        @action="refreshAll"
      />
      <MockSkeletonTable v-else-if="loading && !rows.length" :cols="7" :rows="8" />
      <MkEmptyState v-else-if="!loading && !rows.length" title="暂无记忆痕迹数据" description="还没有用户产生记忆记录。学习者开始学习并完成概念提取后，这里会按待复习量从多到少列出用户。" />
      <!-- 用户列表（列集 = 原型 renderMemory；行点击跳学习者详情，EG1：回车不劫持行内按钮） -->
      <div v-else class="mk-table-scroll">
        <table v-if="visibleRows.length" class="mk-table mk-table--click">
          <thead>
            <tr><th>学习者</th><th class="mk-num">待复习</th><th class="mk-num">需人工看</th><th class="mk-num">薄弱项</th><th class="mk-num">平均记忆强度</th><th>最近复习</th><th>操作</th></tr>
          </thead>
          <tbody>
            <tr
              v-for="row in visibleRows"
              :key="row.userId"
              :data-mr-row="row.userId"
              :class="{ 'mr__row--active': false }"
              tabindex="0"
              @click="openSubPage('learner', row.userId, includeVirtual ? { includeTest: true } : undefined)"
              @keydown.enter.self.prevent="openSubPage('learner', row.userId, includeVirtual ? { includeTest: true } : undefined)"
            >
              <td>
                <div class="mr__user">
                  <MkCellAvatar :name="row.name" :tone="row.isVirtualLearner ? 'virtual' : 'default'" />
                  <div class="mk-cell-main">
                    <strong>{{ row.name || '未命名' }}</strong>
                    <span class="mk-cell-sub">{{ shortId(row.userId) }}</span>
                  </div>
                  <MkVariantBadge v-if="row.isVirtualLearner" kind="virtual" />
                </div>
              </td>
              <td class="mk-num">
                <span class="mr__due" :class="`mr__due--${dueTone(row)}`" :title="`到该复习而未复习 ${row.due} 条，占该用户痕迹 ${duePctOf(row)}%`">
                  <span class="mk-minibar mr__bar" aria-hidden="true"><i class="mk-minibar__fill" :data-tone="dueTone(row) === 'high' ? 'bad' : dueTone(row) === 'warn' ? 'warn' : undefined" :style="{ width: duePctOf(row) + '%' }"></i></span>
                  <b>{{ row.due }}</b>
                </span>
              </td>
              <td class="mk-num">
                <span v-if="row.audit?.ambiguous" class="mk-badge mk-badge--sm mk-badge--warn mr__need" :title="`${row.audit.ambiguous} 条归并候选需人工确认，不会自动执行`">{{ row.audit.ambiguous }}</span>
                <span v-else class="mk-na" title="没有待人工确认的归并候选">—</span>
              </td>
              <td class="mk-num">
                <span v-if="row.weak > 0" class="mk-badge mk-badge--sm mk-badge--warn mr__need" :title="`${row.weak} 条痕迹强度已跌破 40%，临近遗忘`">{{ row.weak }}</span>
                <span v-else class="mk-na" title="没有跌破 40% 的痕迹">—</span>
              </td>
              <td class="mk-num">
                <span v-if="row.avgStrength != null" class="mr__strength" title="有强度痕迹的平均记忆强度">
                  <span class="mk-minibar mr__bar"><i class="mk-minibar__fill" :style="{ width: Math.round(row.avgStrength * 100) + '%' }"></i></span>
                  <span class="mono">{{ Math.round(row.avgStrength * 100) }}%</span>
                </span>
                <span v-else class="mk-na" title="该用户的痕迹都还没有记忆强度数据">—</span>
              </td>
              <td :title="row.lastReviewedAt ? new Date(row.lastReviewedAt).toLocaleString('zh-CN', { hour12: false }) : undefined">
                <span class="mk-cell-sub mono">{{ row.lastReviewedAt ? timeAgo(row.lastReviewedAt) : '—' }}</span>
              </td>
              <td>
                <div class="mk-actions">
                  <button type="button" class="mk-btn mk-btn--sm" :disabled="recomputingId === row.userId" title="重新跑一次该用户的记忆复盘，结果实时刷新" @click.stop="recompute(row.userId, row.name)">{{ recomputingId === row.userId ? '观察中…' : '重新观察' }}</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <!-- 到期档下钻筛空：下钻命中窗口内学习者，列表是分页窗口，交集为空 ≠ 窗口内没有 -->
        <MkEmptyState
          v-else-if="dueBandFilter"
          :title="dueBandEmpty.title"
          :description="dueBandEmpty.desc"
        />
      </div>
      <!-- 服务端分页（审核 #41）：total=后端全量有痕迹用户数（totals.users）；v-model:pageSize 接住条数变更 -->
      <Pagination
        v-model:page="userPage"
        v-model:pageSize="userPageSize"
        :total="totals.users"
        :loading="loading"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { adminMemoryReviewApi, adminMemoryTracesApi } from '@/api/adminApi'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkKpi from '@/components/mk/MkKpi.vue'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import MkCellAvatar from '@/components/mk/MkCellAvatar.vue'
import MkVariantBadge from '@/components/mk/MkVariantBadge.vue'
import MkDistBand from '@/components/mk/MkDistBand.vue'
import MockSkeletonTable from './SkeletonTable.vue'
import Pagination from './Pagination.vue'
import DataScopeToggle from './DataScopeToggle.vue'
import { askConfirm } from './useConfirm'
import { openSubPage } from './store'
import { toast } from '@/utils/toast'
import { errMsg, shortId, timeAgo, liveIncludeVirtual, liveSetIncludeVirtual } from './live'

interface AuditUserSummary {
  mode: string
  generatedAt: string
  candidates: number
  proposed: number
  autoApplicable: number
  ambiguous: number
  drops: number
  applied: number
  deleted: number
}

interface OverviewRow {
  userId: string
  name: string | null
  email: string | null
  isVirtualLearner: boolean
  traces: number
  due: number
  audit: AuditUserSummary | null
  /** 按次留档的归并凭据计数（权威；审计滚动窗口之外的历史归并也计入） */
  merges?: { rollbackable: number; rolledBack: number }
  /* 原型 renderMemory 三列：薄弱 = FSRS 强度<40% 的痕迹数；平均强度 0-1，null = 无带 FSRS 强度的痕迹 */
  weak: number
  avgStrength: number | null
  lastReviewedAt: string | null
}

/** 碎片率指标（R7 outlet 域契约 D）。字段缺失 → KPI 显 '—'（不把缺失当 0）。 */
interface FragmentationMetrics {
  duplicateLabelRatio?: number
  unattachedKeys?: number
  pendingReview?: number
}

/** GET /admin/memory-traces 行（只声明本页用到的字段） */
interface AdminTraceRow {
  id: string
  userId: string
  conceptKey: string
  label: string | null
  extractionCount: number
  dueAt: string | null
  retrievability: number | null
}

const loading = ref(false)
const busy = ref(false)
const error = ref('')
/* 口径整组统一（2026-10-04 用户拍板）：get/set 走 live.ts 共享态，本页 watch 负责整页重新统计 */
const includeVirtual = computed({
  get: () => liveIncludeVirtual.value,
  set: (v) => liveSetIncludeVirtual(v)
})
watch(includeVirtual, () => {
  userPage.value = 1
  void refreshAll()
})
const rows = ref<OverviewRow[]>([])
/* 用户列表服务端分页（审核 #41）：页码驱动 offset，totals.users 作分页 total */
const userPage = ref(1)
const userPageSize = ref(50)
watch(userPage, () => {
  void loadOverview()
})
watch(userPageSize, () => {
  if (userPage.value !== 1) {
    userPage.value = 1
  } else {
    void loadOverview()
  }
})
const totals = ref({
  users: 0,
  traces: 0,
  due: 0,
  usersWithAudit: 0,
  proposed: 0,
  autoApplicable: 0,
  ambiguous: 0,
  applied: 0,
  deleted: 0,
  fragmentation: null as FragmentationMetrics | null
})
const overviewReady = ref(false)
const kpiPending = computed(() => !overviewReady.value && !error.value)

const duePct = computed(() => (totals.value.traces ? Math.round((totals.value.due / totals.value.traces) * 100) : 0));

/* 到期示警阈值（P1#13）：占全部痕迹 ≥20% 或人均 ≥5 条才抬警示；阈值写入 KPI title 披露 */
const DUE_WARN_PCT = 20
const DUE_WARN_PER_USER = 5
const dueWarn = computed(() => {
  const t = totals.value
  if (!t.due) return false
  const pct = t.traces ? (t.due / t.traces) * 100 : 100
  const perUser = t.users ? t.due / t.users : t.due
  return pct >= DUE_WARN_PCT || perUser >= DUE_WARN_PER_USER
})
const dueCardTitle = computed(() => {
  const t = totals.value
  return `到该复习而未复习 ${t.due} 条，占全部记录 ${duePct.value}%。达到 ${DUE_WARN_PCT}% 或人均 ${DUE_WARN_PER_USER} 条以上时标为需关注`
})

/* ===== 到期时间轴：窗口 = adminMemoryTracesApi.list（上限 200 条、updatedAt 倒序）=====
   队列口径 = extractionCount > 0 且 dueAt 非空；六档按 dueAt 与今天 0 点的日差分桶 */
const traceRows = ref<AdminTraceRow[]>([])
const traceFailed = ref(false)
let traceSeq = 0

async function loadTraceWindow() {
  const seq = ++traceSeq
  traceFailed.value = false
  try {
    const res = await adminMemoryTracesApi.list({ limit: 200, includeVirtual: includeVirtual.value, testOnly: includeVirtual.value || undefined })
    if (seq !== traceSeq) return
    const body = res.data?.data ?? res.data ?? {}
    traceRows.value = Array.isArray(body.rows) ? body.rows : []
  } catch {
    if (seq !== traceSeq) return
    traceFailed.value = true
  }
}

const queueRows = computed(() => traceRows.value.filter((row) => row.extractionCount > 0 && !!row.dueAt))

const MR_DUE_BAND: Array<{ key: string; name: string; tone: string; title: string }> = [
  { key: 'over', name: '已逾期', tone: 'var(--mk-red)', title: '到期时间早于今天' },
  { key: 'today', name: '今天', tone: 'var(--mk-amber)', title: '今天内到期' },
  { key: 'tmrw', name: '明天', tone: 'var(--mk-blue)', title: '明天到期' },
  { key: 'd2', name: '2天后', tone: 'var(--mk-purple)', title: '2 天后到期' },
  { key: 'd3', name: '3天后', tone: 'var(--mk-green)', title: '3–4 天后到期' },
  { key: 'd5', name: '5天后', tone: 'var(--mk-faint)', title: '5 天后及以远到期' }
]

/** 到期日差（天）：按本地日历日取整（UTC 归一），负 = 已逾期 */
function dayIndexFromToday(dueAt: string, epoch: Date): number {
  const due = new Date(dueAt)
  const a = Date.UTC(due.getFullYear(), due.getMonth(), due.getDate())
  const b = Date.UTC(epoch.getFullYear(), epoch.getMonth(), epoch.getDate())
  return Math.round((a - b) / 86400000)
}

/** 日差 → 桶位：负 = 已逾期；0/1/2 = 今天/明天/2天后；3–4 归「3天后」桶；≥5 归「5天后」桶 */
function dueBucketIndexOf(dueAt: string, epoch: Date): number {
  const idx = dayIndexFromToday(dueAt, epoch)
  return idx < 0 ? 0 : idx <= 2 ? idx + 1 : idx <= 4 ? 4 : 5
}

const mrDueBand = computed(() => {
  const epoch = new Date()
  const counts = MR_DUE_BAND.map(() => 0)
  for (const row of queueRows.value) {
    counts[dueBucketIndexOf(row.dueAt as string, epoch)] += 1
  }
  return MR_DUE_BAND.map((def, i) => ({ ...def, n: counts[i] }))
})

/* ===== 到期带下钻：点某档 = 窗口内该档有到期痕迹的学习者；再点取消 ===== */
const dueBandFilter = ref<string | null>(null)
function toggleDueBand(key: string) {
  dueBandFilter.value = dueBandFilter.value === key ? null : key
}
const dueBucketUsers = computed(() => {
  const map = new Map<string, Set<string>>()
  const epoch = new Date()
  for (const row of queueRows.value) {
    const key = MR_DUE_BAND[dueBucketIndexOf(row.dueAt as string, epoch)].key
    let set = map.get(key)
    if (!set) {
      set = new Set()
      map.set(key, set)
    }
    set.add(row.userId)
  }
  return map
})
const visibleRows = computed(() =>
  dueBandFilter.value
    ? rows.value.filter((r) => dueBucketUsers.value.get(dueBandFilter.value!)?.has(r.userId))
    : rows.value
)
const mrDueBins = computed(() =>
  mrDueBand.value.map((entry) => ({ key: entry.key, label: entry.name, n: entry.n, tone: entry.tone }))
)

const dueBandEmpty = computed(() => {
  const band = dueBandFilter.value
  const inWindow = band ? (dueBucketUsers.value.get(band)?.size ?? 0) : 0
  const label = band ? (mrDueBins.value.find((b) => b.key === band)?.label ?? band) : ''
  if (inWindow > 0) {
    return {
      title: `前 ${userPageSize.value} 名里没有该档学习者`,
      desc: `最近记录中有 ${inWindow} 位学习者的到期时间落在「${label}」档，但都不在当前列表前 ${userPageSize.value} 位内。`
    }
  }
  return {
    title: '该到期档暂无学习者',
    desc: '窗口内没有学习者的到期痕迹落在这个时间档。'
  }
})

const traceWindowReady = computed(() => !traceFailed.value && queueRows.value.length > 0)

interface OverviewCard {
  label: string
  value: string | number
  hint: string
  title: string
  tone?: 'ok' | 'warn' | 'bad' | 'muted' | ''
}

/** 页级绝对值单一来源；失败/未落定一律 '—'（R2 + B5-F3-2），不静默归零 */
const overviewCards = computed<OverviewCard[]>(() => {
  const t = totals.value;
  const failed = !!error.value
  const pending = kpiPending.value
  const na = failed || pending
  const val = (v: number) => (na ? '—' : v)
  const numTone = (tone: OverviewCard['tone']): OverviewCard['tone'] => (failed ? 'bad' : pending ? 'muted' : tone)
  const numHint = (text: string) => (failed ? '取数失败' : pending ? '取数中…' : text)
  return [
    { label: '用户', value: val(t.users), hint: numHint('有记忆痕迹'), tone: numTone(''), title: '全部有记忆记录的用户数。是否含虚拟学习者随页头开关' },
    { label: '记忆痕迹', value: val(t.traces), hint: numHint('跨全部学习路径'), tone: numTone(''), title: '记忆记录总数（用户级、跨全部学习路径）' },
    { label: '当前到期', value: val(t.due), hint: numHint(t.traces ? `占痕迹 ${duePct.value}%` : '暂无痕迹'), tone: numTone(dueWarn.value ? 'warn' : ''), title: dueCardTitle.value },
    { label: '需人工看', value: val(t.ambiguous), hint: numHint('归并候选 · 不自动执行'), tone: numTone(t.ambiguous > 0 ? 'warn' : ''), title: '像但不确定的归并候选，需人工确认，不会自动执行' },
    { label: '待归并建议', value: val(t.proposed), hint: numHint(`可自动 ${t.autoApplicable} · 已执行 ${t.applied}/${t.deleted}`), tone: numTone(''), title: '模型给出的同义概念候选。「可自动」指系统有把握且名称足够相似。执行后保留备份，可回滚' }
  ];
});

/* 碎片率 KPI 行（R7 outlet 域契约 D）：后端未部署（字段整体缺失）→ '—' +「指标未取到」 */
const fragmentationCards = computed<OverviewCard[]>(() => {
  const frag = totals.value.fragmentation
  const failed = !!error.value
  const pending = kpiPending.value
  const na = failed || pending
  const metricMissing = !frag
  const numTone = (tone: OverviewCard['tone']): OverviewCard['tone'] => (failed ? 'bad' : pending ? 'muted' : tone)
  const numHint = (text: string) => (failed ? '取数失败' : pending ? '取数中…' : metricMissing ? '指标未取到' : text)
  const ratio = frag?.duplicateLabelRatio
  const unattached = frag?.unattachedKeys
  const pendingReview = frag?.pendingReview
  /* 「需人工看」这一项（totals.ambiguous）既是同带上的独立一卡，又是 pendingReview 求和公式里的加数
     （后端 memory-review.ts:64-68：review 档归并建议 + ambiguous + 散键清理建议）——
     它非 0 而另两项为 0 时，两卡必然同数。 */
  const ambiguous = totals.value.ambiguous
  return [
    {
      label: '措辞重复率',
      value: na || ratio == null ? '—' : `${Math.round(ratio * 100)}%`,
      hint: numHint('措辞重复的痕迹占比'),
      tone: numTone(!na && ratio != null && ratio >= 0.2 ? 'warn' : ''),
      title: '含义相同、措辞重复的记忆记录占比，越高说明概念越碎，达到 20% 时标为需关注。虚拟学习者是否计入随所处视角变化'
    },
    {
      label: '未挂靠散键',
      value: na || unattached == null ? '—' : unattached,
      hint: numHint('未关联到标准概念的键'),
      tone: numTone(!na && unattached != null && unattached > 0 ? 'warn' : ''),
      title: '自由填写的、未关联到标准概念的概念标识数量——无法自动收拢，只能通过归并 / 清理建议逐条治理'
    },
    {
      label: '待审队列',
      value: na || pendingReview == null ? '—' : pendingReview,
      /* hint 明写包含关系（2026-10-14 走查）：旧 hint「人审队列中的建议数」不给任何线索，
         而本卡是「人审档归并建议 + **需人工看** + 散键清理建议」之和 —— 带上那枚独立卡
         「需人工看」就在和里，另两项为 0 时两卡同数，7 与 7 并排读作矛盾数字。 */
      hint: numHint(pendingReview != null && ambiguous > 0 ? `含需人工看 ${ambiguous}` : '人审队列中的建议数'),
      tone: numTone(!na && pendingReview != null && pendingReview > 0 ? 'warn' : ''),
      title: '待审队列深度：归并建议、需人工看与散键清理建议之和（「需人工看」已含在此数内）。不会自动执行'
    }
  ];
});

/** 页头 KPI 单带（2026-10-12 用户走查「怎么双 kpi」）：量值五卡 + 治理碎片三卡合成一条，
    不再两段栅格——1920 下两段卡宽不一致（5 卡 ~310px vs 3 卡 ~530px），读作两套 KPI。
    两域取数语义各自保留：fragmentation 缺失仍由 fragmentationCards 出 '—' +「指标未取到」 */
const headKpiCards = computed<OverviewCard[]>(() => [...overviewCards.value, ...fragmentationCards.value])

/** 到期压力档：0=安静；占痕迹 ≥50% 或绝对数 ≥12 = 重压（红）；其余 = 提醒（琥珀） */
function dueTone(row: OverviewRow): 'none' | 'warn' | 'high' {
  if (!row.due) return 'none';
  const pct = row.traces ? (row.due / row.traces) * 100 : 100;
  return pct >= 50 || row.due >= 12 ? 'high' : 'warn';
}
function duePctOf(row: OverviewRow): number {
  return row.traces ? Math.min(Math.round((row.due / row.traces) * 100), 100) : row.due ? 100 : 0;
}

/* last-wins 代际号（P2）：切口径/翻页时旧响应不得覆盖新状态 */
let overviewSeq = 0

async function loadOverview() {
  const seq = ++overviewSeq
  loading.value = true
  error.value = ''
  try {
    const res = await adminMemoryReviewApi.overview({ limit: userPageSize.value, offset: (userPage.value - 1) * userPageSize.value, includeVirtual: includeVirtual.value, testOnly: includeVirtual.value || undefined })
    if (seq !== overviewSeq) return
    const body = res.data?.data ?? res.data ?? {}
    rows.value = Array.isArray(body.users) ? body.users : []
    if (!rows.value.length && userPage.value > 1) {
      userPage.value = 1
      return
    }
    totals.value = { ...totals.value, ...(body.totals || {}) }
    overviewReady.value = true
  } catch (e) {
    if (seq !== overviewSeq) return
    error.value = errMsg(e)
  } finally {
    if (seq === overviewSeq) loading.value = false
  }
}

/** 页头刷新：概览 + 到期窗口必刷 */
async function refreshAll() {
  await Promise.all([loadOverview(), loadTraceWindow()])
}

/** 行内「重新观察」进行中标记：只转该行按钮文案，不锁整页 */
const recomputingId = ref('')

async function recompute(userId: string, name?: string | null) {
  if (recomputingId.value) return
  /* B5-F3-5：行级写动作补确认（observe 语义，仍写审计投影行） */
  const ok = await askConfirm({
    title: '重新观察',
    message: `确认对「${name || shortId(userId)}」重新跑一次记忆复盘？将重新观察其记忆痕迹与归并建议（只记录建议，不改动记忆痕迹），结果实时刷新。`,
    confirmText: '重新观察',
    danger: false
  })
  if (!ok) return
  busy.value = true
  recomputingId.value = userId
  error.value = ''
  try {
    await adminMemoryReviewApi.recompute(userId)
    await Promise.all([loadOverview(), loadTraceWindow()])
    toast.success('已完成一次记忆复盘')
  } catch (e) {
    error.value = errMsg(e)
    toast.error(`重新观察失败：${errMsg(e)}`)
  } finally {
    busy.value = false
    recomputingId.value = ''
  }
}

const route = useRoute()
const router = useRouter()

onMounted(async () => {
  // 旧深链 /admin/memory-review?userId=… → 学习者详情「记忆调度」页签（单用户明细单家，
  // 2026-10-12 拍板）；总览页自己只服务无 userId 的跨用户视图
  const queryUserId = typeof route.query.userId === 'string' ? route.query.userId : ''
  if (queryUserId) {
    const { userId: _drop, ...rest } = route.query
    router.replace({ path: '/admin/learner-state', query: { ...rest, view: 'learner', id: queryUserId, tab: 'memory-ops' } })
    return
  }
  await Promise.all([loadOverview(), loadTraceWindow()])
})
</script>

<style scoped>
.mr { display: flex; flex-direction: column; }

/* ===== 用户列表（2026-09-28：表头回归——行列表没有表头，右侧裸数字无从解读）===== */
.mr__user { display: flex; align-items: center; gap: 9px; min-width: 0; }
.mr__user .mk-cell-main { min-width: 0; flex: 1; }

/* 到期压力条：数字在上、比例条在下；右对齐与同列的数字表头对齐 */
.mr__due { display: inline-flex; align-items: center; gap: 6px; }
/* 数值盒定宽（2026-10-15 用户走查「百分比条不一样长」）：td.mk-num 右对齐下组宽随数值
   文字宽变（「100%」比「64%」宽、「19」比「0」宽），每行条的起点左右横跳——轨道虽恒
   64px、填充比例也对，看起来却「不一样长」。数值盒给定宽（内部右对齐）后组宽恒定，
   条起点逐行对齐，数值右缘仍与右对齐表头同侧。 */
.mr__due b { font-variant-numeric: tabular-nums; font-weight: 700; width: 26px; text-align: right; }
.mr__due--none b { color: var(--mk-faint); font-weight: 400; }
.mr__due--warn b { color: var(--mk-amber); }
.mr__due--high b { color: var(--mk-red-strong); }
/* 比例条走共享 mk-minibar（tone=warn/bad 由模板 data-tone 驱动）；页私有只留列内宽度 */
.mr__bar { width: 64px; }

/* 平均记忆强度格（原型 meterrow：小条 + mono %）；% 盒定宽理由同 .mr__due b */
.mr__strength { display: inline-flex; align-items: center; gap: 8px; }
.mr__strength .mono { color: var(--mk-muted); font-size: var(--mk-fs-micro); width: 34px; text-align: right; }

/* 需人工看：>0 抬成琥珀胶囊；页私有只留数字对齐 */
.mr__need { min-width: 22px; font-variant-numeric: tabular-nums; justify-content: center; }
.mr__row--active { background: var(--mk-blue-bg); }
</style>
