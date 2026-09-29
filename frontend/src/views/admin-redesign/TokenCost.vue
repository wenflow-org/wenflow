<template>
  <div class="mk-page">
    <!-- 页头（newui/admin 原型 pagehead）：标题 + 口径副文 + 主操作上移；
         原状态条承担的「身份+口径+刷新」迁入页头，三个数字仍归下方 KPI 卡
         （避免同一批数在页头与 KPI 区各说一遍，2026-09-29 口径延续） -->
    <MkPageHead
      title="Token 成本"
      :sub="`近 ${days} 天 · ${includeTest ? '含测试流量' : '仅真实用户'}`"
    >
      <template #actions>
        <button type="button" class="mk-btn mk-btn--sm" :disabled="loading" @click="() => load(true)">
          {{ loading ? '刷新中…' : '刷新' }}
        </button>
      </template>
    </MkPageHead>

    <!-- 调用成本 2026-09-29 收编进概览区第四张 MkKpi 卡（原私有 cost-strip 金额条
         与全站 KPI 语言不一致；单价未配置/加载失败态由 KPI 卡 hint + tone 承担） -->

    <!-- 加载失败（优先于空态） -->
    <MkEmptyState
      v-if="loadFailed && !summary"
      icon="◌"
      min
      title="Token 成本数据加载失败"
      description="无法从后端拉取用量统计，请重试或稍后再来。"
      action-text="重试"
      @action="() => load(true)"
    />

    <!-- 首载骨架：KPI 卡 + 趋势图 + 排行占位（对齐全站 MockSkeleton 语言） -->
    <template v-else-if="!summary && loading">
      <div class="tc-filterbar tc-filterbar--skeleton"></div>
      <section class="mk-kpi-grid">
        <div v-for="i in 4" :key="i" class="mk-kpi tc-skel-kpi"><MkSkeleton w="60%" :h="26" /><MkSkeleton w="40%" :h="12" /></div>
      </section>
      <section class="mk-card">
        <div class="mk-card__head"><MkSkeleton w="180" :h="14" /></div>
        <MkSkeleton class="tc-skel-pad" variant="bars" :count="7" :h="150" :radius="4" />
      </section>
      <section class="mk-card">
        <div class="mk-card__head"><MkSkeleton w="180" :h="14" /></div>
        <MkSkeleton class="tc-skel-pad" variant="rows" :count="4" :h="22" :radius="8" />
      </section>
    </template>

    <!-- 加载完成（含空窗口）：后端 getSummary 恒返回对象，「!summary」整页空态不可达——空窗口
         改判 summary.totals.calls===0，在筛选条之下渲染一次 MkEmptyState，替掉 4 处零值卡 + 「暂无数据」 -->
    <template v-else>
      <!-- 筛选条（范围 + 数据范围，独立一行，对齐 TraceWaterfall 筛选条形态）：空窗口同样常驻，窗口切换不被遮 -->
      <div class="tc-filterbar">
        <div class="mk-pills tc-pills">
          <button
            v-for="p in rangePills"
            :key="p.days"
            type="button"
            class="mk-pill"
            :class="{ 'mk-pill--active': days === p.days }"
            @click="days = p.days"
          >
            {{ p.label }}
          </button>
        </div>
        <DataScopeToggle v-if="isLive" v-model="includeTest" />
      </div>
      <MkEmptyState
        v-if="summaryEmpty"
        min
        icon="◌"
        title="这个时间窗暂无 LLM 调用"
        :description="`近 ${days} 天${includeTest ? '（含测试流量）' : ''}没有任何调用记录，产生调用后这里展示 Token 用量、趋势与排行。`"
        :action-text="days !== 90 ? '看近 90 天' : ''"
        @action="days = 90"
      />
      <template v-else>
      <!-- 概览卡（统一走共享 .mk-kpi-grid + MkKpi）：四个数字的唯一去处——
           状态条不再复述；第四张「调用成本」承接原私有 cost-strip 金额条。
           每张卡的 hint 给派生口径（拆分/均值/失败率/待补单价），不是把数字再说一遍。 -->
      <section class="mk-kpi-grid">
        <MkKpi label="总 Token" :value="summary ? fmtTokens(summary.totals.tokens) : '—'" :hint="`prompt ${summary ? fmtTokens(summary.totals.promptTokens) : '—'} · completion ${summary ? fmtTokens(summary.totals.completionTokens) : '—'}`" />
        <MkKpi label="调用次数" :value="summary ? summary.totals.calls : '—'" :hint="callsHint" />
        <MkKpi label="失败调用" :value="summary ? summary.totals.failed : '—'" :tone="summary && summary.totals.failed > 0 ? 'bad' : ''" :hint="failRateHint" />
        <MkKpi
          label="调用成本"
          :value="costLoading ? '…' : costFailed ? '加载失败' : costUsd !== null ? `≈ $${fmtCostUsd(costUsd)}` : (costPricedCalls === 0 && costMissingCalls === 0) ? '无调用' : '单价未配置'"
          :tone="costFailed ? 'warn' : ''"
          :hint="costHint"
        />
      </section>

      <!-- 趋势图 -->
      <section class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">Token 用量趋势 · 近 {{ days }} 天</h3>
          <div class="tc-head-links">
            <span class="mk-card__meta" title="本页为 token-cost 端点精确聚合（含重试后终态失败）；总览「LLM 用量」卡为近 7 天汇总 hero">口径：本地自然日 · 精确聚合</span>
            <button type="button" class="mk-link" @click="goOverview">总览趋势 →</button>
            <button type="button" class="mk-link" @click="goExecLogs">逐调用明细 →</button>
          </div>
        </div>
        <!-- 趋势柱：走全 admin 统一图表语言 OvBars（2026-09-29 自 MkChart/ECharts 换入，
             与总览「调用趋势 · 近 7 天」同构）。原 ECharts 双系列柱宽不一致（38%/18%），
             失败柱压在调用柱后只露一条边；OvBars 双柱等宽并排，语义由列 title 承载。 -->
        <OvBars v-if="trend.length" :cols="trendCols" :bar-width="44" :min-bars-height="150" />
        <p v-if="trend.length" class="mk-card__note">
          合计 {{ fmtTokens(trend.reduce((acc, d) => acc + d.tokens, 0)) }} token · {{ trend.reduce((acc, d) => acc + d.calls, 0) }} 次调用 · 失败 {{ trend.reduce((acc, d) => acc + d.failed, 0) }} 次
        </p>
        <p v-else class="mk-card__note">近 {{ days }} 天暂无调用记录。</p>
      </section>

      <!-- 用量排行：Skill 全宽大表 + 用户/模型半宽侧表 -->
      <section class="mk-card tc-card tc-card--skill">
        <div class="mk-card__head">
          <h3 class="mk-card__title">Skill 用量排行</h3>
          <div class="mk-card__head-right">
            <span class="mk-card__meta">{{ bySkill.length }} 个<template v-if="!skillAll && bySkill.length > skillLimit"> · 显示前 {{ skillLimit }}</template></span>
            <button
              v-if="bySkill.length > skillLimit"
              type="button"
              class="tc-more"
              @click="skillAll = !skillAll"
            >
              {{ skillAll ? '收起' : `查看全部 ${bySkill.length}` }}
            </button>
          </div>
        </div>
        <TcRankTable v-if="bySkill.length" :items="skillRows" variant="skill" :total-tokens="totalTokens" />
        <p v-else class="mk-card__note">暂无数据。</p>
      </section>

      <div class="tc-ranks">
        <section class="mk-card tc-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">用户用量排行</h3>
            <div class="mk-card__head-right">
              <span class="mk-card__meta">Top {{ byUser.length }}<template v-if="!userAll && byUser.length > userLimit"> · 显示前 {{ userLimit }}</template></span>
              <button
                v-if="byUser.length > userLimit"
                type="button"
                class="tc-more"
                @click="userAll = !userAll"
              >
                {{ userAll ? '收起' : `查看全部 ${byUser.length}` }}
              </button>
            </div>
          </div>
          <TcRankTable v-if="byUser.length" :items="userRows" variant="user" :total-tokens="totalTokens" />
          <p v-else class="mk-card__note">暂无数据。</p>
        </section>

        <section class="mk-card tc-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">模型用量排行</h3>
            <span class="mk-card__meta">{{ byModel.length }} 个</span>
          </div>
          <TcRankTable v-if="byModel.length" :items="byModel" variant="model" :total-tokens="totalTokens" />
          <p v-else class="mk-card__note">暂无数据。</p>
        </section>
      </div>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { isLive, intent, tokenCostCacheKey, tokenCostFilters } from './store'
import { errMsg, isPageCacheFresh, markPageFetched } from './live'
import { adminTokenCostApi } from '@/api/adminApi'
import DataScopeToggle from './DataScopeToggle.vue'
import MkKpi from '@/components/mk/MkKpi.vue'
import OvBars from './OvBars.vue'
import TcRankTable, { type RankRow } from './TcRankTable.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import MkSkeleton from '@/components/mk/MkSkeleton.vue'
import { toast } from '@/utils/toast'

interface Summary {
  days: number
  includeTest: boolean
  totals: { tokens: number; promptTokens: number; completionTokens: number; calls: number; failed: number }
  trend: Array<{ date: string; tokens: number; calls: number; failed: number }>
}

// 筛选状态存于 store（与金额条同源）；此处以可写计算属性保持既有模板绑定
const days = computed({
  get: () => tokenCostFilters.days,
  set: (v: number) => { tokenCostFilters.days = v }
})
const includeTest = computed({
  get: () => tokenCostFilters.includeTest,
  set: (v: boolean) => { tokenCostFilters.includeTest = v }
})
const loading = ref(false)
const loadFailed = ref(false)

const summary = ref<Summary | null>(null)
const bySkill = ref<RankRow[]>([])
const byUser = ref<RankRow[]>([])
const byModel = ref<RankRow[]>([])

/** Skill 排行默认展示行数；超出可一键展开全部 */
const skillLimit = 6
const skillAll = ref(false)

/** 用户排行默认展示行数（与模型卡等高，避免右列过长失衡）；超出可一键展开全部 */
const userLimit = 5
const userAll = ref(false)

const rangePills = [
  { days: 7, label: '近 7 天' },
  { days: 30, label: '近 30 天' },
  { days: 90, label: '近 90 天' },
]

const trend = computed(() => summary.value?.trend || [])
const totalTokens = computed(() => summary.value?.totals.tokens || 0)
/* 空窗口判据：后端 getSummary 恒返回对象（totals 全 0），「!summary」整页空态不可达；
   以 calls === 0 判空，筛选项（时间窗/测试流量）切换后用户仍可换窗自救 */
const summaryEmpty = computed(() => !!summary.value && summary.value.totals.calls === 0)
const skillRows = computed(() => bySkill.value.slice(0, skillAll.value ? bySkill.value.length : skillLimit))
const userRows = computed(() => byUser.value.slice(0, userAll.value ? byUser.value.length : userLimit))
const failRateHint = computed(() => {
  const s = summary.value?.totals
  if (!s) return '含重试后的终态失败'
  const rate = s.calls > 0 ? Math.round((s.failed / s.calls) * 100) : 0
  return `失败率 ${rate}% · 含重试后的终态失败`
})

/* 调用次数副行：窗口 + 每次调用的平均 token（派生量，状态条不给） */
const callsHint = computed(() => {
  const s = summary.value?.totals
  const window = `近 ${days.value} 天`
  if (!s || s.calls <= 0) return window
  return `${window} · 平均 ${fmtTokens(Math.round(s.tokens / s.calls))}/次`
})

/* 成本卡副行：数值本身只给结论，口径/待补模型明细收在 hint（title 可悬停展开） */
const costHint = computed(() => {
  if (costLoading.value) return '金额统计中'
  if (costFailed.value) return '金额统计拉取失败，可刷新重试；不影响下方逐调用明细'
  if (costUsd.value !== null) {
    const priced = `已定价 ${costPricedCalls.value} 次`
    return costMissingCalls.value > 0 ? `${priced} · ${costMissingCalls.value} 次未定价（未计入）` : priced
  }
  if (costPricedCalls.value === 0 && costMissingCalls.value === 0) return `近 ${days.value} 天没有带 token 的 LLM 调用`
  const missing = missingPricingModels.value
  return missing.length
    ? `暂不展示金额 · 待补单价模型 ${missing.length} 个：${missing.join('、')}`
    : 'models.config.ts 的 pricing 尚未填权威单价，暂不展示金额'
})

/* 跨页互跳：成本聚合页 ⇄ 明细页（执行日志行级 token）/ 总览趋势
   口径说明：本页为 token-cost 端点精确聚合（含重试终态失败）；执行日志展示逐调用行级 token 明细；
   总览「LLM 用量」卡为近 7 天汇总 hero。三处同域但粒度/窗口不同，互跳避免口径黑盒。 */
function goExecLogs() {
  intent.scene = 'execution-logs'
}
function goOverview() {
  intent.scene = 'overview'
}

const costLoading = ref(false)
const costFailed = ref(false)
const costUsd = ref<number | null>(null)
const costPricingKnown = ref(false)
const costPricedCalls = ref(0)
const costMissingCalls = ref(0)
const missingPricingModels = ref<string[]>([])

function fmtCostUsd(v: number): string {
  if (!Number.isFinite(v) || v < 0) return '0.000000'
  return v.toFixed(6)
}

async function loadCostSummary() {
  if (costLoading.value) return
  costLoading.value = true
  costFailed.value = false
  try {
    const res = await adminTokenCostApi.getSummary({ days: days.value, includeTest: includeTest.value })
    const totals = res.data?.data?.totals ?? null
    costUsd.value = totals?.usd ?? null
    costPricingKnown.value = totals?.pricingKnown ?? false
    costPricedCalls.value = totals?.pricedCalls ?? 0
    costMissingCalls.value = totals?.callsMissingPricing ?? 0
    missingPricingModels.value = res.data?.pricingStatus?.missingPricingModels ?? []
  } catch {
    /* 金额条为辅助信息：失败显式报错并可重试，绝不静默降级成「无调用」 */
    costFailed.value = true
    costUsd.value = null
    costPricingKnown.value = false
  } finally {
    costLoading.value = false
  }
}

watch([days, includeTest], () => {
  void load()
  void loadCostSummary()
}, { immediate: true })



async function load(force = false) {
  if (loading.value) return
  if (!force && isPageCacheFresh(tokenCostCacheKey()) && summary.value) return
  loading.value = true
  loadFailed.value = false
  try {
    const params = { days: days.value, includeTest: includeTest.value }
    const [sumRes, skillRes, userRes, modelRes] = await Promise.all([
      adminTokenCostApi.getSummary(params),
      adminTokenCostApi.getBySkill(params),
      adminTokenCostApi.getByUser({ ...params, limit: 20 }),
      adminTokenCostApi.getByModel(params),
    ])
    summary.value = sumRes.data?.data ?? sumRes.data ?? null
    bySkill.value = (skillRes.data?.data?.items ?? []) as RankRow[]
    byUser.value = (userRes.data?.data?.items ?? []) as RankRow[]
    byModel.value = (modelRes.data?.data?.items ?? []) as RankRow[]
    markPageFetched(tokenCostCacheKey())
  } catch (e) {
    loadFailed.value = true
    toast.error(`加载失败：${errMsg(e)}`)
  } finally {
    loading.value = false
  }
}

function fmtTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(n)
}

/** M/D 标签（今日由 trendCols 单独给「今日」，此处不再判日） */
function dayLabel(date: string): string {
  const [, m, d] = date.split('-').map(Number)
  return `${m}/${d}`
}

/* 趋势柱数据映射（OvBars 列式结构，与总览 trend7dCols 同构）：
   主柱 Token（蓝）、副柱失败调用（琥珀）；数值行给 Token，失败数进 title。 */
const trendMax = computed(() => Math.max(1, ...trend.value.map((d) => d.tokens)))
const barPct = (v: number, max: number) => `${v > 0 ? Math.max(Math.round((v / max) * 100), 6) : 3}%`
const todayKey = computed(() => {
  const n = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`
})
const trendCols = computed(() => trend.value.map((d) => ({
  key: d.date,
  label: d.date === todayKey.value ? '今日' : dayLabel(d.date),
  today: d.date === todayKey.value,
  num: fmtTokens(d.tokens),
  title: `${d.date}：Token ${fmtTokens(d.tokens)} · ${d.calls.toLocaleString()} 次调用 · 失败 ${d.failed.toLocaleString()} 次`,
  bars: [
    { pct: barPct(d.tokens, trendMax.value), tone: 'blue' as const },
    { pct: barPct(d.failed, trendMax.value), tone: 'amber' as const },
  ],
})))
</script>

<style scoped>
/* 嵌入模式（宿主执行日志页 flex 列内）：占满剩余高度，整页接管滚动 */
.tc-pills { display: inline-flex; }
/* 筛选条（范围 + 数据范围，独立一行卡片形态） */
.tc-filterbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 8px 14px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-xl);
  background: var(--mk-surface);
}
/* KPI 区已改用共享 .mk-kpi-grid（2026-09-29 重设：原私有 .tc-overview
   repeat(4,1fr)/gap14 与全站 KPI 栅格不是同一套；.tc-status--bad 随状态条
   去数字一并退役 → 见下方模板注释 */

/* 趋势图：柱状图 + Y 轴刻度 + 网格线 + 柱顶数值 + 今日高亮（对齐 AntD Chart 语言） */
.tc-head-links {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-left: auto;
}
.tc-head-links .mk-card__meta { margin-left: 0; }
/* 批D：手搓 tc-trend 柱图已换 MkChart（双系列 tokens+failed），原 80 行私有图表 CSS 与 6 处渐变 hex 一并移除 */

/* —— 用量排行 —— */
.tc-card--skill { grid-column: 1 / -1; }
.tc-ranks {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  align-items: start;
}
@media (max-width: 1200px) {
  .tc-ranks { grid-template-columns: 1fr; }
}

/* 展开全部 / 收起（Skill 排行） */
.tc-more {
  border: 0;
  background: transparent;
  padding: 2px 8px;
  font: inherit;
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  color: var(--mk-blue);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.12s;
}
.tc-more:hover { background: color-mix(in srgb, var(--mk-blue) 8%, transparent); }

/* 4K 档 tc-trend 规则随 MkChart 迁移移除（批D）；MkChart 高度如需 4K 放大走其组件内档位 */

/* 暗色模式（D1 补完）：Token 成本 */
html[data-theme='dark'] {
  /* tc-trend 柱暗色渐变已随 MkChart 迁移移除（批D），图表暗色走 MK_CHART_PALETTES.dark */
  .tc-more:hover { background: rgba(91, 141, 239, 0.14); }
}

/* 首载骨架：KPI 卡 / 趋势图 / 排行行 占位（skeleton shimmer 对齐 SkillReconciliation sk-rec__skeleton 手法） */
.tc-filterbar--skeleton { height: 44px; }
.tc-skel-kpi { display: grid; gap: 8px; }
/* 骨架内边距（形状由 MkSkeleton 提供） */
.tc-skel-pad { padding: 12px 16px 16px; }
</style>
