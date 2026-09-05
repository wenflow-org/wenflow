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
    <div v-if="loadFailed && !summary" class="mk-empty mk-empty--min">
      <span class="mk-empty__icon" aria-hidden="true">◌</span>
      <strong>Token 成本数据加载失败</strong>
      <span>无法从后端拉取用量统计，请重试或稍后再来。</span>
      <button type="button" class="mk-empty__action" @click="() => load(true)">重试</button>
    </div>

    <!-- 首载骨架：KPI 卡 + 趋势图 + 排行占位（对齐全站 MockSkeleton 语言） -->
    <template v-else-if="!summary && loading">
      <div class="tc-filterbar tc-filterbar--skeleton"></div>
      <section class="tc-overview">
        <div v-for="i in 3" :key="i" class="mk-kpi tc-skel-kpi"><i class="tc-skel tc-skel--kpi-num"></i><i class="tc-skel tc-skel--kpi-label"></i></div>
      </section>
      <section class="mk-card">
        <div class="mk-card__head"><i class="tc-skel tc-skel--title"></i></div>
        <div class="tc-skel-chart">
          <i v-for="i in 7" :key="i" class="tc-skel tc-skel--bar"></i>
        </div>
      </section>
      <section class="mk-card">
        <div class="mk-card__head"><i class="tc-skel tc-skel--title"></i></div>
        <div class="tc-skel-rows">
          <i v-for="i in 4" :key="i" class="tc-skel tc-skel--row"></i>
        </div>
      </section>
    </template>

    <!-- 整页无数据（真实空态）：summary 为空且已加载完成 -->
    <div v-else-if="!summary && !loading" class="mk-empty mk-empty--min">
      <strong>暂无 Token 成本数据</strong>
      <span>近 {{ days }} 天没有任何 LLM 调用记录，产生调用后这里会展示用量与成本。</span>
    </div>

    <template v-else>
      <!-- 筛选条（范围 + 数据范围，独立一行，对齐 TraceWaterfall 筛选条形态） -->
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
        <div v-if="trend.length" class="tc-trend">
          <!-- Y 轴刻度 -->
          <div class="tc-trend__axis" aria-hidden="true">
            <span>{{ fmtTokens(trendMax) }}</span>
            <span>{{ fmtTokens(trendMax / 2) }}</span>
            <span>0</span>
          </div>
          <div class="tc-trend__plot">
            <div
              v-for="d in trend"
              :key="d.date"
              class="tc-trend__col"
              :title="`${d.date}：${fmtTokens(d.tokens)} · ${d.calls} 次 · 失败 ${d.failed}`"
            >
              <div class="tc-trend__bar-track">
                <i
                  v-if="d.tokens > 0"
                  class="tc-trend__bar"
                  :class="{ 'tc-trend__bar--today': isToday(d.date) }"
                  :style="{ height: trendH(d.tokens) }"
                >
                  <span class="tc-trend__val">{{ fmtTokens(d.tokens) }}</span>
                </i>
              </div>
              <span class="tc-trend__day" :class="{ 'tc-trend__day--today': isToday(d.date), 'tc-trend__day--empty': d.tokens === 0 }">{{ dayLabel(d.date) }}</span>
            </div>
          </div>
        </div>
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
            <span class="mk-card__meta">Top {{ byUser.length }}</span>
          </div>
          <TcRankTable v-if="byUser.length" :items="byUser" variant="user" :total-tokens="totalTokens" />
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
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { isLive, intent } from './store'
import { errMsg, isPageCacheFresh, markPageFetched } from './live'
import { adminTokenCostApi } from '@/api/adminApi'
import DataScopeToggle from './DataScopeToggle.vue'
import MkKpi from './MkKpi.vue'
import TcRankTable, { type RankRow } from './TcRankTable.vue'
import { toast } from '@/utils/toast'

/** 嵌入模式：作为「执行日志」页「成本分析」tab 渲染（仅去掉外层壳，状态条/筛选/排行保留） */
withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

interface Summary {
  days: number
  includeTest: boolean
  totals: { tokens: number; promptTokens: number; completionTokens: number; calls: number; failed: number }
  trend: Array<{ date: string; tokens: number; calls: number; failed: number }>
}

const days = ref(7)
const includeTest = ref(false)
const loading = ref(false)
const loadFailed = ref(false)

const summary = ref<Summary | null>(null)
const bySkill = ref<RankRow[]>([])
const byUser = ref<RankRow[]>([])
const byModel = ref<RankRow[]>([])

/** Skill 排行默认展示行数；超出可一键展开全部 */
const skillLimit = 6
const skillAll = ref(false)

const rangePills = [
  { days: 7, label: '近 7 天' },
  { days: 30, label: '近 30 天' },
  { days: 90, label: '近 90 天' },
]

const trend = computed(() => summary.value?.trend || [])
const totalTokens = computed(() => summary.value?.totals.tokens || 0)
const skillRows = computed(() => bySkill.value.slice(0, skillAll.value ? bySkill.value.length : skillLimit))
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
  if (!force && isPageCacheFresh('token-cost') && summary.value) return
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
    markPageFetched('token-cost')
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

function isToday(date: string): boolean {
  const [y, m, d] = date.split('-').map(Number)
  const today = new Date()
  return y === today.getFullYear() && m === today.getMonth() + 1 && d === today.getDate()
}

const trendMax = computed(() => Math.max(1, ...trend.value.map((t) => t.tokens)))
function trendH(tokens: number): string {
  return `${Math.max(2, Math.round((tokens / trendMax.value) * 100))}%`
}
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
  border-radius: 10px;
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
.tc-trend {
  display: grid;
  grid-template-columns: 48px 1fr;
  gap: 12px;
  height: 200px;
  padding: 14px 16px 12px;
}
/* Y 轴刻度（max / max/2 / 0 三档，与网格线对齐） */
.tc-trend__axis {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: flex-end;
  padding-bottom: 24px; /* 留出底部日期行高，使 0 刻度线不与日期重叠 */
  font-size: var(--mk-fs-11);
  color: var(--mk-faint);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.tc-trend__plot {
  display: flex;
  gap: 8px;
  /* 三条水平网格线：max / max/2 / 0（背景渐变重复模拟虚线网格） */
  background-image: repeating-linear-gradient(
    to top,
    transparent 0,
    transparent calc(33.333% - 1px),
    var(--mk-line) calc(33.333% - 1px),
    var(--mk-line) 33.333%
  );
  background-size: 100% 100%;
  padding-bottom: 24px;
}
.tc-trend__col {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.tc-trend__bar-track {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.tc-trend__bar {
  position: relative;
  width: 62%;
  min-height: 2px;
  background: linear-gradient(180deg, var(--mk-blue, #5b8def), var(--mk-accent-deep, #2f6fed));
  border-radius: 4px 4px 0 0;
  opacity: 0.72;
  transition: opacity 0.12s;
}
.tc-trend__bar:hover { opacity: 1; }
/* 今日柱：实色高亮（非透明），视觉聚焦最新一天 */
.tc-trend__bar--today {
  opacity: 1;
  background: linear-gradient(180deg, #5b8def, #1f57cc);
  box-shadow: 0 0 0 1px rgba(44, 99, 208, 0.25);
}
/* 柱顶数值（柱子够高时显示；矮柱可借 hover title 查看） */
.tc-trend__val {
  position: absolute;
  top: -18px;
  left: 50%;
  transform: translateX(-50%);
  font-size: var(--mk-fs-11);
  color: var(--mk-muted);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  pointer-events: none;
}
.tc-trend__day {
  font-size: var(--mk-fs-11);
  color: var(--mk-faint);
  font-weight: 600;
  white-space: nowrap;
}
.tc-trend__day--today { color: var(--mk-blue); font-weight: 700; }
.tc-trend__day--empty { color: var(--mk-faint); opacity: 0.55; }

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
  font-size: var(--mk-fs-12);
  font-weight: 700;
  color: var(--mk-blue);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.12s;
}
.tc-more:hover { background: rgba(44, 99, 208, 0.08); }

/* 4K：趋势图跟随全站节奏 */
@media (min-width: 2000px) {
  .tc-trend { height: 230px; }
  .tc-trend__day, .tc-trend__val, .tc-trend__axis { font-size: 12px; }
  .tc-trend__bar { width: 58%; }
}
@media (min-width: 2800px) {
  .tc-trend { height: 270px; }
  .tc-trend__day, .tc-trend__val, .tc-trend__axis { font-size: 14px; }
  .tc-trend__bar { width: 54%; }
}
@media (min-width: 3600px) {
  .tc-trend { height: 310px; }
  .tc-trend__day, .tc-trend__val, .tc-trend__axis { font-size: 16.5px; }
  .tc-trend__bar { width: 50%; }
}

/* 暗色模式（D1 补完）：Token 成本 */
html[data-theme='dark'] {
  .tc-trend__bar { background: linear-gradient(180deg, #5b8def, #2f6fed); }
  .tc-trend__bar--today { background: linear-gradient(180deg, #7aa2ff, #3b6fe0); }
  .tc-more:hover { background: rgba(91, 141, 239, 0.14); }
}

/* 首载骨架：KPI 卡 / 趋势图 / 排行行 占位（skeleton shimmer 对齐 SkillReconciliation sk-rec__skeleton 手法） */
.tc-filterbar--skeleton { height: 44px; }
.tc-skel-kpi { display: grid; gap: 8px; }
.tc-skel-kpi .tc-skel { display: block; }
.tc-skel {
  display: block;
  border-radius: 6px;
  background: linear-gradient(90deg, #eef2fa, #f7f9fc, #eef2fa);
  background-size: 200% 100%;
  animation: tc-skel-shimmer 1.2s infinite;
}
@keyframes tc-skel-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
.tc-skel--kpi-num { width: 60%; height: 26px; }
.tc-skel--kpi-label { width: 40%; height: 12px; }
.tc-skel--title { width: 180px; height: 14px; }
.tc-skel-chart {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  height: 150px;
  padding: 12px 16px 16px;
}
.tc-skel--bar { flex: 1; height: 70%; border-radius: 4px 4px 0 0; }
.tc-skel--bar:nth-child(2n) { height: 45%; }
.tc-skel--bar:nth-child(3n) { height: 85%; }
.tc-skel-rows { display: grid; gap: 10px; padding: 12px 16px 16px; }
.tc-skel--row { height: 22px; border-radius: 8px; }
html[data-theme='dark'] .tc-skel {
  background: linear-gradient(90deg, #1f2b40, #26334d, #1f2b40);
  background-size: 200% 100%;
}
</style>
