<template>
  <div class="mk-page mk-page--fill">
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
      <span>无法从后端拉取用量统计。</span>
      <button type="button" class="mk-empty__action" @click="() => load(true)">重试</button>
    </div>

    <div v-else-if="!summary && !loading" class="mk-empty mk-empty--min">
      <strong>暂无 Token 成本数据</strong>
      <span>产生 LLM 调用后，用量与成本会自动汇总在这里。</span>
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
        <MkKpi label="失败调用" :value="summary ? summary.totals.failed : '—'" :tone="summary && summary.totals.failed > 0 ? 'bad' : ''" :hint="'含重试后的终态失败'" />
      </section>

      <!-- 趋势图 -->
      <section class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">Token 用量趋势 · 近 {{ days }} 天</h3>
          <span class="mk-card__meta">本地自然日口径</span>
        </div>
        <div v-if="trend.length" class="tc-trend">
          <div
            v-for="d in trend"
            :key="d.date"
            class="tc-trend__col"
            :title="`${d.date}：${fmtTokens(d.tokens)} · ${d.calls} 次 · 失败 ${d.failed}`"
          >
            <div class="tc-trend__bar-track">
              <i class="tc-trend__bar" :style="{ height: trendH(d.tokens) }"></i>
            </div>
            <span class="tc-trend__day">{{ dayLabel(d.date) }}</span>
          </div>
        </div>
        <p v-else class="mk-card__note">近 {{ days }} 天暂无调用记录。</p>
      </section>

      <div class="tc-grid">
        <!-- per-skill 排行 -->
        <section class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">Skill 用量排行</h3>
            <span class="mk-card__meta">{{ bySkill.length }} 个</span>
          </div>
          <div v-if="bySkill.length" class="tc-rank">
            <div v-for="r in bySkill.slice(0, 12)" :key="r.key" class="tc-rank__row">
              <span class="tc-rank__name" :title="r.key">{{ r.display }}</span>
              <div class="tc-rank__bar-track">
                <i class="tc-rank__bar" :style="{ width: rankPct(r.tokens) }"></i>
              </div>
              <span class="tc-rank__num">{{ fmtTokens(r.tokens) }}</span>
              <span class="tc-rank__meta">{{ r.calls }} 次<em v-if="r.failed"> · 败 {{ r.failed }}</em></span>
            </div>
          </div>
          <p v-else class="mk-card__note">暂无数据。</p>
        </section>

        <!-- per-user 排行 -->
        <section class="mk-card">
          <div class="mk-card__head">
            <h3 class="mk-card__title">用户用量排行</h3>
            <span class="mk-card__meta">Top {{ byUser.length }}</span>
          </div>
          <div v-if="byUser.length" class="tc-rank">
            <div v-for="r in byUser" :key="r.key" class="tc-rank__row">
              <span class="tc-rank__name" :title="`${r.name || ''} ${r.email || ''}`.trim() || r.key">
                {{ r.name || shortId(r.key) }}
              </span>
              <div class="tc-rank__bar-track">
                <i class="tc-rank__bar" :style="{ width: rankPct(r.tokens) }"></i>
              </div>
              <span class="tc-rank__num">{{ fmtTokens(r.tokens) }}</span>
              <span class="tc-rank__meta">{{ r.calls }} 次<em v-if="r.failed"> · 败 {{ r.failed }}</em></span>
            </div>
          </div>
          <p v-else class="mk-card__note">暂无数据。</p>
        </section>
      </div>

      <!-- per-model 排行 -->
      <section class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">模型用量排行</h3>
          <span class="mk-card__meta">{{ byModel.length }} 个</span>
        </div>
        <div v-if="byModel.length" class="tc-rank">
          <div v-for="r in byModel" :key="r.key" class="tc-rank__row">
            <span class="tc-rank__name" :title="r.key">{{ r.key }}</span>
            <div class="tc-rank__bar-track">
              <i class="tc-rank__bar" :style="{ width: rankPct(r.tokens) }"></i>
            </div>
            <span class="tc-rank__num">{{ fmtTokens(r.tokens) }}</span>
            <span class="tc-rank__meta">{{ r.calls }} 次<em v-if="r.failed"> · 败 {{ r.failed }}</em></span>
          </div>
        </div>
        <p v-else class="mk-card__note">暂无数据。</p>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { isLive } from './store'
import { errMsg, isPageCacheFresh, markPageFetched } from './live'
import { adminTokenCostApi } from '@/api/adminApi'
import DataScopeToggle from './DataScopeToggle.vue'
import MkKpi from './MkKpi.vue'
import { toast } from '@/utils/toast'

interface RankItem {
  key: string
  display: string
  tokens: number
  calls: number
  failed: number
  promptTokens: number
  completionTokens: number
  name?: string | null
  email?: string | null
}

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
const bySkill = ref<RankItem[]>([])
const byUser = ref<RankItem[]>([])
const byModel = ref<RankItem[]>([])

const rangePills = [
  { days: 7, label: '近 7 天' },
  { days: 30, label: '近 30 天' },
  { days: 90, label: '近 90 天' },
]

const trend = computed(() => summary.value?.trend || [])
const statusTone = computed(() =>
  !summary.value ? 'mk-status--muted'
    : summary.value.totals.failed > 0 ? 'mk-status--warn'
      : 'mk-status--ok'
)

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
    bySkill.value = (skillRes.data?.data?.items ?? []) as RankItem[]
    byUser.value = (userRes.data?.data?.items ?? []) as RankItem[]
    byModel.value = (modelRes.data?.data?.items ?? []) as RankItem[]
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

function shortId(id: string): string {
  if (!id) return '—'
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id
}

function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const today = new Date()
  if (y === today.getFullYear() && m === today.getMonth() + 1 && d === today.getDate()) return '今'
  return `${m}/${d}`
}

const trendMax = computed(() => Math.max(1, ...trend.value.map((t) => t.tokens)))
function trendH(tokens: number): string {
  return `${Math.max(2, Math.round((tokens / trendMax.value) * 100))}%`
}

const rankMax = computed(() => Math.max(1, ...bySkill.value.map((r) => r.tokens), ...byUser.value.map((r) => r.tokens), ...byModel.value.map((r) => r.tokens)))
function rankPct(tokens: number): string {
  return `${Math.max(2, Math.round((tokens / rankMax.value) * 100))}%`
}
</script>

<style scoped>
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
  margin-bottom: 12px;
}
.tc-status--bad { color: var(--mk-red, #dc2626); font-weight: 700; }

/* 概览卡：MkKpi 网格容器（统计卡本体由 MkKpi 提供，含暗色/4K 自动适配） */
.tc-overview {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 14px;
}

/* 趋势图：柱状图（专属可视化，保留自制） */
.tc-trend {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  height: 150px;
  padding: 12px 4px 0;
}
.tc-trend__col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.tc-trend__bar-track {
  flex: 1;
  width: 100%;
  display: flex;
  align-items: flex-end;
}
.tc-trend__bar {
  width: 70%;
  margin: 0 auto;
  background: linear-gradient(180deg, var(--mk-blue, #5b8def), var(--mk-accent-deep, #2f6fed));
  border-radius: 4px 4px 0 0;
  min-height: 2px;
}
.tc-trend__day { font-size: var(--mk-fs-11); color: var(--mk-faint, #9ca3af); font-weight: 600; white-space: nowrap; }

.tc-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 16px;
}
@media (max-width: 1200px) {
  .tc-grid { grid-template-columns: 1fr; }
}

.tc-rank {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tc-rank__row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.tc-rank__name {
  width: 150px;
  min-width: 150px;
  font-size: var(--mk-fs-12_5);
  font-weight: 600;
  color: var(--mk-ink, #1a2a44);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tc-rank__bar-track {
  flex: 1;
  height: 10px;
  background: var(--mk-line, #eef1f6);
  border-radius: 999px;
  overflow: hidden;
}
.tc-rank__bar {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, var(--mk-blue, #6fa1f5), var(--mk-accent-deep, #2f6fed));
  border-radius: 999px;
}
.tc-rank__num {
  width: 74px;
  min-width: 74px;
  text-align: right;
  font-size: var(--mk-fs-12_5);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--mk-ink, #1a2a44);
}
.tc-rank__meta {
  width: 86px;
  min-width: 86px;
  text-align: right;
  font-size: var(--mk-fs-11);
  color: var(--mk-faint, #9ca3af);
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.tc-rank__meta em { font-style: normal; color: var(--mk-red, #dc2626); }

/* 4K：趋势图/排行条跟随全站节奏 */
@media (min-width: 2000px) {
  .tc-trend { height: 170px; }
  .tc-trend__day { font-size: 12px; }
  .tc-rank__name { font-size: 14px; width: 170px; min-width: 170px; }
  .tc-rank__num { font-size: 14px; width: 84px; min-width: 84px; }
  .tc-rank__meta { font-size: 12.5px; width: 98px; min-width: 98px; }
  .tc-rank__bar-track { height: 12px; }
}
@media (min-width: 2800px) {
  .tc-trend { height: 200px; }
  .tc-trend__day { font-size: 14px; }
  .tc-rank__name { font-size: 16.5px; width: 200px; min-width: 200px; }
  .tc-rank__num { font-size: 16.5px; width: 100px; min-width: 100px; }
  .tc-rank__meta { font-size: 14.5px; width: 115px; min-width: 115px; }
  .tc-rank__bar-track { height: 14px; }
}
@media (min-width: 3600px) {
  .tc-trend { height: 235px; }
  .tc-trend__day { font-size: 16.5px; }
  .tc-rank__name { font-size: 19.5px; width: 235px; min-width: 235px; }
  .tc-rank__num { font-size: 19.5px; width: 118px; min-width: 118px; }
  .tc-rank__meta { font-size: 17px; width: 135px; min-width: 135px; }
  .tc-rank__bar-track { height: 16px; }
}

/* 暗色模式（D1 补完）：Token 成本（此前完全缺失） */
html[data-theme='dark'] {
  .tc-trend__bar { background: linear-gradient(180deg, #5b8def, #2f6fed); }
  .tc-rank__bar { background: linear-gradient(90deg, #6fa1f5, #2f6fed); }
  .tc-rank__bar-track { background: #232f45; }
}
</style>
