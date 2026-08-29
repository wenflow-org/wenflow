<template>
  <div class="mk-page mk-page--fill">
    <!-- 状态条 -->
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
      <span class="mk-status__sep"></span>
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
      <button type="button" class="mk-status__action" :disabled="loading" @click="() => load(true)">
        {{ loading ? '刷新中…' : '刷新' }}
      </button>
    </div>

    <div v-if="!isLive" class="mk-empty mk-empty--min">
      <strong>暂无 Token 成本数据</strong>
      <span>切换到真实数据查看 LLM 用量透视。</span>
    </div>

    <template v-else>
      <!-- 概览卡 -->
      <section class="tc-overview">
        <div class="tc-card tc-card--kpi">
          <span class="tc-kpi__label">总 Token</span>
          <strong class="tc-kpi__num">{{ summary ? fmtTokens(summary.totals.tokens) : '—' }}</strong>
          <span class="tc-kpi__sub">
            prompt {{ summary ? fmtTokens(summary.totals.promptTokens) : '—' }} ·
            completion {{ summary ? fmtTokens(summary.totals.completionTokens) : '—' }}
          </span>
        </div>
        <div class="tc-card tc-card--kpi">
          <span class="tc-kpi__label">调用次数</span>
          <strong class="tc-kpi__num">{{ summary ? summary.totals.calls : '—' }}</strong>
          <span class="tc-kpi__sub">近 {{ days }} 天</span>
        </div>
        <div class="tc-card tc-card--kpi" :class="{ 'tc-card--bad': summary && summary.totals.failed > 0 }">
          <span class="tc-kpi__label">失败调用</span>
          <strong class="tc-kpi__num">{{ summary ? summary.totals.failed : '—' }}</strong>
          <span class="tc-kpi__sub">含重试后的终态失败</span>
        </div>
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
  !isLive.value || !summary.value ? 'mk-status--muted'
    : summary.value.totals.failed > 0 ? 'mk-status--warn'
      : 'mk-status--ok'
)

watch([days, includeTest], () => {
  if (isLive.value) void load()
})

async function load(force = false) {
  if (!isLive.value || loading.value) return
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
.tc-status--bad { color: var(--mk-red, #dc2626); font-weight: 700; }

.tc-overview {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 14px;
}
.tc-card {
  background: var(--mk-card-bg, #fff);
  border: 1px solid var(--mk-border, #e5e9f2);
  border-radius: 12px;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.tc-card--kpi .tc-kpi__label { font-size: 12px; font-weight: 700; color: var(--mk-muted, #6b7280); letter-spacing: 0.02em; }
.tc-card--kpi .tc-kpi__num { font-size: 26px; font-weight: 800; font-variant-numeric: tabular-nums; color: var(--mk-ink, #1a2a44); }
.tc-card--kpi .tc-kpi__sub { font-size: 11.5px; color: var(--mk-faint, #9ca3af); font-variant-numeric: tabular-nums; }
.tc-card--bad .tc-kpi__num { color: var(--mk-red, #dc2626); }

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
  background: linear-gradient(180deg, #5b8def, #2f6fed);
  border-radius: 4px 4px 0 0;
  min-height: 2px;
}
.tc-trend__day { font-size: 10.5px; color: var(--mk-faint, #9ca3af); font-weight: 600; white-space: nowrap; }

.tc-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-bottom: 14px;
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
  font-size: 12.5px;
  font-weight: 600;
  color: var(--mk-ink, #1a2a44);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tc-rank__bar-track {
  flex: 1;
  height: 10px;
  background: var(--mk-track-bg, #eef1f6);
  border-radius: 999px;
  overflow: hidden;
}
.tc-rank__bar {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #6fa1f5, #2f6fed);
  border-radius: 999px;
}
.tc-rank__num {
  width: 74px;
  min-width: 74px;
  text-align: right;
  font-size: 12.5px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--mk-ink, #1a2a44);
}
.tc-rank__meta {
  width: 86px;
  min-width: 86px;
  text-align: right;
  font-size: 11px;
  color: var(--mk-faint, #9ca3af);
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.tc-rank__meta em { font-style: normal; color: var(--mk-red, #dc2626); }
</style>
