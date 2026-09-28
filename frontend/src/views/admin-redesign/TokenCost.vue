<template>
  <div :class="embedded ? 'mk-page tc-embedded' : 'mk-page'">
    <!-- 状态条（单行：计数 + 刷新；范围/数据范围移入下方筛选条） -->
    <div class="mk-status" :class="statusTone">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">Token 成本</strong>
      <span class="mk-status__sep"></span>
      <template v-if="isLive && summary">
        <span class="mk-status__meta">{{ fmtTokens(summary.totals.tokens) }}</span>
        <span class="mk-status__meta">{{ summary.totals.calls }} 次调用</span>
        <span class="mk-status__meta" :class="{ 'tc-status--bad': summary.totals.failed > 0 }">
          失败 {{ summary.totals.failed }}
        </span>
      </template>
      <span class="mk-status__actions">
        <button type="button" class="mk-status__action" :disabled="loading" @click="() => load(true)">
          {{ loading ? '刷新中…' : '刷新' }}
        </button>
      </span>
    </div>

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
      <section class="tc-overview">
        <div v-for="i in 3" :key="i" class="mk-kpi tc-skel-kpi"><MkSkeleton w="60%" :h="26" /><MkSkeleton w="40%" :h="12" /></div>
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
      <!-- 概览卡（MkKpi 统一形态） -->
      <section class="tc-overview">
        <MkKpi label="总 Token" :value="summary ? fmtTokens(summary.totals.tokens) : '—'" :hint="`prompt ${summary ? fmtTokens(summary.totals.promptTokens) : '—'} · completion ${summary ? fmtTokens(summary.totals.completionTokens) : '—'}`" />
        <MkKpi label="调用次数" :value="summary ? summary.totals.calls : '—'" :hint="`近 ${days} 天`" />
        <MkKpi label="失败调用" :value="summary ? summary.totals.failed : '—'" :tone="summary && summary.totals.failed > 0 ? 'bad' : ''" :hint="failRateHint" />
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
        <!-- 批D：MkChart 双系列（Token 主柱+失败副柱），tooltip/图例/暗色主题随 mk 体系 -->
        <MkChart v-if="trend.length" :option="trendChartOption" height="200px" />
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
import MkChart from '@/components/mk/MkChart.vue'
import { MK_CHART_PALETTES } from '@/components/mk/chartPalette'
import { useIsDark } from '@/composables/useIsDark'
import TcRankTable, { type RankRow } from './TcRankTable.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkSkeleton from '@/components/mk/MkSkeleton.vue'
import { toast } from '@/utils/toast'
import type { EChartsCoreOption } from 'echarts/core'

/** 嵌入模式：作为「执行日志」页「成本分析」tab 渲染（仅去掉外层壳，状态条/筛选/排行保留） */
const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

/* 嵌入在宿主执行日志页内时，切明细由宿主切换页内 tab（emit）；独立渲染时退回跨页 intent */
const emit = defineEmits<{ (e: 'goto-logs'): void }>()

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
const statusTone = computed(() =>
  !summary.value ? 'mk-status--muted'
    : summary.value.totals.failed > 0 ? 'mk-status--warn'
      : 'mk-status--ok'
)
const failRateHint = computed(() => {
  const s = summary.value?.totals
  if (!s) return '含重试后的终态失败'
  const rate = s.calls > 0 ? Math.round((s.failed / s.calls) * 100) : 0
  return `失败率 ${rate}% · 含重试后的终态失败`
})

/* 跨页互跳：成本聚合页 ⇄ 明细页（执行日志行级 token）/ 总览趋势
   口径说明：本页为 token-cost 端点精确聚合（含重试终态失败）；执行日志展示逐调用行级 token 明细；
   总览「LLM 用量」卡为近 7 天汇总 hero。三处同域但粒度/窗口不同，互跳避免口径黑盒。 */
function goExecLogs() {
  /* 宿主已是 execution-logs scene：AdminConsole 对 intent.scene 的 watch 值相等不触发，
     点击无反应——嵌入态改为让宿主切页内 tab 到日志页 */
  if (props.embedded) {
    emit('goto-logs')
    return
  }
  intent.scene = 'execution-logs'
}
function goOverview() {
  intent.scene = 'overview'
}

watch([days, includeTest], () => {
  void load()
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

function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const today = new Date()
  if (y === today.getFullYear() && m === today.getMonth() + 1 && d === today.getDate()) return '今'
  return `${m}/${d}`
}

/* 批D：手搓柱的 isToday/trendMax/trendH 随 MkChart 迁移移除 */

/* 批D：手搓 CSS 趋势柱 → MkChart 双系列（tokens 主柱 + failed 副柱）。
   数据与 Overview trend7d 同构；今日列用 axisLabel 强调替代原「实色柱」。 */
const isDark = useIsDark()
const trendChartOption = computed<EChartsCoreOption>(() => {
  const days = trend.value
  const pal = MK_CHART_PALETTES[isDark.value ? 'dark' : 'light']
  return {
    animationDuration: 300,
    grid: { left: 46, right: 8, top: 14, bottom: 20 },
    tooltip: { trigger: 'axis', confine: true, axisPointer: { type: 'shadow' } },
    legend: { show: true, itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 10 } },
    xAxis: {
      type: 'category',
      data: days.map((d) => dayLabel(d.date)),
      axisTick: { show: false },
      axisLabel: { fontSize: 10 },
    },
    yAxis: { type: 'value', axisLabel: { fontSize: 10, formatter: (v: number) => fmtTokens(v) } },
    series: [
      {
        name: 'Token',
        type: 'bar',
        data: days.map((d) => d.tokens),
        barWidth: '38%',
        itemStyle: { color: pal.primaryBright, borderRadius: [2, 2, 0, 0] },
      },
      {
        name: '失败调用',
        type: 'bar',
        data: days.map((d) => d.failed),
        barWidth: '18%',
        itemStyle: { color: pal.danger, borderRadius: [2, 2, 0, 0] },
      },
    ],
  }
})
</script>

<style scoped>
/* 嵌入模式（宿主执行日志页 flex 列内）：占满剩余高度，整页接管滚动 */
.tc-embedded { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
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
.tc-status--bad { color: var(--mk-red, #dc2626); font-weight: 700; }

/* 概览卡：MkKpi 网格容器（统计卡本体由 MkKpi 提供，含暗色/4K 自动适配） */
.tc-overview {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

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
