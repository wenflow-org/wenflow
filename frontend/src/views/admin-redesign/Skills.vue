<template>
  <div class="mk-page mk-page--fill">
    <div class="mk-status" :class="statusTone">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">{{ statusTitle }}</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">共 {{ cards.length }} 个 Skill</span>
    </div>

    <!-- Skill 运营概览（共享组件 MkOverview） -->
    <MkOverview :tone="skDashTone" :title="skDashTitle" :subline="skDashSubline" :window="rangeLabel" :has-data="skDashHasData">
      <template #kpis>
        <MkKpi label="成功率" :value="overallRate == null ? '—' : `${overallRate}%`" :tone="rateNumTone" :hint="`成功 ${okCalls} / ${totalCalls}`" :title="'窗口内成功率 = 成功调用 / 总调用'" />
        <MkKpi label="有调用" :value="activeCount" :hint="`共 ${cards.length} 个 Skill`" :title="'窗口内有调用的 Skill 数'" />
        <MkKpi label="失败节点" :value="errorCount" :tone="errorCount > 0 ? 'bad' : ''" :hint="`空闲节点 ${idleCount}`" :title="'窗口内出现失败调用的节点数'" />
        <MkKpi label="平均耗时" :value="avgLatencyText" :hint="`最近调用 ${lastActiveText}`" :title="'成功调用平均耗时（按调用量加权）'" />
      </template>
      <template #detail>
        <span>总调用 {{ totalCalls }}</span>
        <span>失败 {{ totalErrors }}</span>
        <span>空闲 {{ idleCount }}</span>
        <span>{{ rangeDetailLabel }}</span>
      </template>
    </MkOverview>

    <div class="mk-card mk-card--fill">
      <div class="mk-card__head">
        <div class="mk-filter">
          <div class="mk-pills">
            <button type="button" class="mk-pill" :class="{ 'mk-pill--active': !onlyAttention }" @click="onlyAttention = false">全部</button>
            <button type="button" class="mk-pill" :class="{ 'mk-pill--active': onlyAttention }" @click="onlyAttention = true">仅看需关注</button>
          </div>
          <select v-model="categoryFilter" class="mk-filter__select" aria-label="按类别筛选">
            <option value="">全部类别</option>
            <option v-for="c in categoryOptions" :key="c" :value="c">{{ categoryText(c) }}</option>
          </select>
          <select v-model="statsRange" class="mk-filter__select" aria-label="统计窗口" :disabled="!isLive">
            <option value="7d">近 7 天</option>
            <option value="24h">近 24 小时</option>
            <option value="30d">近 30 天</option>
            <option value="all">全部</option>
          </select>
          <input class="mk-filter__input" v-model="keyword" placeholder="搜索名称 / ID / 类别" />
        </div>
        <div class="mk-card__head-right">
          <div class="mk-pills">
            <button type="button" class="mk-pill" :class="{ 'mk-pill--active': view === 'list' }" @click="view = 'list'">列表</button>
            <button type="button" class="mk-pill" :class="{ 'mk-pill--active': view === 'grid' }" @click="view = 'grid'">网格</button>
          </div>
          <div v-if="view === 'list'" class="sk-cols">
            <button type="button" class="mk-link" :class="{ 'mk-link--active': colsOpen }" @click="colsOpen = !colsOpen" :aria-expanded="colsOpen">列</button>
            <div v-if="colsOpen" class="sk-cols__menu" @click.stop>
              <label v-for="c in skColDefs" :key="c.key" class="sk-cols__item" :title="c.title">
                <input type="checkbox" :checked="!hiddenCols.has(c.key)" @change="toggleSkCol(c.key)" />
                <span>{{ c.label }}</span>
              </label>
              <button v-if="hiddenCols.size" type="button" class="sk-cols__reset" @click="hiddenCols = new Set()">恢复全部列</button>
            </div>
          </div>
          <span class="mk-card__meta">{{ filtered.length }} / {{ cards.length }}</span>
        </div>
      </div>

      <MockSkeletonTable v-if="liveLoading && !cards.length" :cols="10" />
      <template v-else>
      <!-- 列表视图：列对齐 + 排序，问题浮顶 -->
      <div v-if="view === 'list'" class="mk-table-scroll">
        <table v-if="filtered.length" class="mk-table sk-table mk-table--fixed">
          <colgroup>
            <col style="width:auto">
            <col v-if="!hiddenCols.has('agent')" style="width:120px">
            <col v-if="!hiddenCols.has('cat')" style="width:80px">
            <col v-if="!hiddenCols.has('completion')" style="width:100px">
            <col v-if="!hiddenCols.has('rate')" style="width:80px">
            <col v-if="!hiddenCols.has('last')" style="width:120px">
          </colgroup>
          <thead>
            <tr>
              <th>Skill</th>
              <th v-if="!hiddenCols.has('agent')">所属阶段</th>
              <th v-if="!hiddenCols.has('cat')">类别</th>
              <th v-if="!hiddenCols.has('completion')">完成度</th>
              <th v-if="!hiddenCols.has('rate')" class="mk-th--right">成功率</th>
              <th v-if="!hiddenCols.has('last')">最近调用</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in paged" :key="s.id" class="sk-row" @click="openSkillDrawer(s.id)">
              <td>
                <div class="sk-cell">
                  <span class="sk-dot" :class="`sk-dot--${s.health}`" :title="s.health === 'ok' ? '健康' : s.health === 'error' ? '异常' : '空闲'"></span>
                  <div class="mk-cell-main">
                    <strong class="sk-id-main mk-ellipsis" :title="s.id">{{ s.id }}</strong>
                    <span class="sk-name-desc mk-ellipsis" :title="s.name">{{ s.name }}</span>
                  </div>
                </div>
              </td>
              <td v-if="!hiddenCols.has('agent')">
                <span v-if="s.agentId" class="sk-agent-tag" :title="s.agentId">{{ s.agentName || s.agentId }}</span>
                <span v-else class="mk-na">工具类</span>
              </td>
              <td v-if="!hiddenCols.has('cat')"><span class="mk-badge mk-badge--muted" :title="s.category">{{ categoryText(s.category) }}</span></td>
              <td v-if="!hiddenCols.has('completion')">
                <span
                  v-if="completionBadgeOf(s.id)"
                  class="mk-badge"
                  :class="completionBadgeOf(s.id)!.cls"
                  :title="completionBadgeOf(s.id)!.title"
                >{{ completionBadgeOf(s.id)!.text }}</span>
                <span v-else class="mk-na">—</span>
              </td>
              <td v-if="!hiddenCols.has('rate')" class="mk-num" :class="rateTone(s)">{{ successRate(s) }}</td>
              <td v-if="!hiddenCols.has('last')"><span :class="{ 'mk-na': !s.calls }">{{ s.lastAt }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 网格视图：健康矩阵（保留对比）；与列表共用同一分页器 -->
      <div v-else class="sk-grid sk-grid--inset">
        <button
          v-for="s in paged"
          :key="s.id"
          type="button"
          class="sk-card"
          :class="`sk-card--${s.health}`"
          @click="openSkillDrawer(s.id)"
        >
          <span class="sk-card__head">
            <span class="sk-card__dot"></span>
            <span class="sk-card__cat">{{ categoryText(s.category) }}</span>
            <span v-if="s.health !== 'ok'" class="sk-card__flag">{{ s.health === 'error' ? '异常' : '空闲' }}</span>
          </span>
          <strong class="sk-card__name" :title="s.name">{{ s.id }}</strong>
          <span class="sk-card__id">{{ s.name }}</span>
          <span class="sk-card__stats">
            <span>{{ s.calls }} 调用</span>
            <span v-if="s.errors" class="sk-card__err">{{ s.errors }} 失败</span>
            <span v-else :class="{ 'mk-na': !s.calls }">{{ s.calls ? '无失败' : '—' }}</span>
          </span>
          <!-- 失败率进度条 -->
          <span v-if="s.calls > 0" class="sk-card__rate" :title="`成功率 ${s.calls - s.errors}/${s.calls}`">
            <i class="sk-card__rate-bar" :class="{ 'is-bad': s.errors > 0 }" :style="{ width: ((s.calls - s.errors) / s.calls * 100) + '%' }"></i>
          </span>
        </button>
      </div>

      <div v-if="skillsError && !cards.length" class="mk-empty">
        <strong>Skill 数据加载失败</strong>
        <span>{{ skillsError }}</span>
        <button type="button" class="mk-empty__action" @click="retrySkills">重试</button>
      </div>
      <div v-else-if="!filtered.length" class="mk-empty">
        <strong>{{ onlyAttention ? '没有需关注的 Skill' : keyword ? '没有匹配的 Skill' : '暂无运行数据' }}</strong>
        <span v-if="onlyAttention">一切健康。</span>
        <span v-else-if="keyword">换个关键词试试。</span>
        <button v-if="isFiltered" type="button" class="mk-empty__action" @click="clearFilters">清除筛选</button>
      </div>
      </template>
      <!-- 客户端分页（统一 mk-pagination 页码器）：列表/网格共用，筛选后按页切片 -->
      <Pagination
        v-if="filtered.length"
        v-model:page="page"
        v-model:pageSize="pageSize"
        :total="filtered.length"
        :showTotal="true"
      />
    </div>

    
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { skillProfiles, skillStatOf, openSkillDrawer, dataSource, isLive } from './store'
import { liveSkillProfiles, liveSkillStatsRange, refreshLiveSkills, liveFailures, liveLoading, errMsg } from './live'
import { categoryText } from './statusText'
import { completionMetaOf } from './glossaryMeta'
import MockSkeletonTable from './SkeletonTable.vue'
import Pagination from './Pagination.vue'
import MkOverview from './MkOverview.vue'
import MkKpi from './MkKpi.vue'
import { adminSkillsApi, type SkillCompletion, type SkillReconciliationReport } from '@/api/adminApi'

type Health = 'ok' | 'idle' | 'error'
type SortKey = 'calls' | 'errors' | 'avgMs'

const onlyAttention = ref(false)
const keyword = ref('')
const categoryFilter = ref('')
const view = ref<'list' | 'grid'>('list')

/* D3 表格增强：列显隐（localStorage 持久化；Skill 列固定） */
const SK_COLS_KEY = 'wf_skills_hidden_cols'
const skColDefs = [
  { key: 'agent', label: '所属阶段', title: '所属顶层 Agent' },
  { key: 'cat', label: '类别', title: 'Skill 类别' },
  { key: 'completion', label: '完成度', title: '完成度五档' },
  { key: 'rate', label: '成功率', title: '窗口内成功率' },
  { key: 'last', label: '最近调用', title: '最近调用时间' },
] as const
const colsOpen = ref(false)
const hiddenCols = ref<Set<string>>(new Set())
try {
  const saved = JSON.parse(localStorage.getItem(SK_COLS_KEY) || '[]') as unknown
  if (Array.isArray(saved)) hiddenCols.value = new Set(saved.filter((x): x is string => typeof x === 'string'))
} catch { /* 隐私模式忽略 */ }
watch(hiddenCols, (s) => {
  try { localStorage.setItem(SK_COLS_KEY, JSON.stringify([...s])) } catch { /* ignore */ }
}, { deep: true })
function toggleSkCol(key: string) {
  const next = new Set(hiddenCols.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  hiddenCols.value = next
}
const sortKey = ref<SortKey>('errors')
const sortDir = ref<'asc' | 'desc'>('desc')
const statsRange = liveSkillStatsRange

/** 类别下拉动态化：取当前档案实际出现的类别（覆盖 standard/teaching/simulation/tool） */
const categoryOptions = computed(() => {
  const seen: string[] = []
  cards.value.forEach((c) => {
    const key = String(c.category || '').toLowerCase()
    if (key && !seen.includes(key)) seen.push(key)
  })
  return seen
})

/** 成功率阈值着色：<70% 红、<90% 琥珀 */
function rateTone(s: { calls: number; errors: number }) {
  if (!s.calls) return ''
  const rate = ((s.calls - s.errors) / s.calls) * 100
  if (rate < 70) return 'sk-rate--bad'
  if (rate < 90) return 'sk-rate--warn'
  return ''
}
/** 平均耗时阈值着色：>40s 红、>20s 琥珀 */
// 时间窗口切换 → 按新窗口重新拉取统计
watch(statsRange, async () => {
  if (isLive.value) {
    try {
      await refreshLiveSkills()
      liveSkillsError.value = ''
    } catch (e) {
      liveSkillsError.value = errMsg(e)
    }
  }
})

/** live 拉取失败：初始装载失败（liveFailures.skills）或窗口切换/重试失败（本地） */
const liveSkillsError = ref('')
const skillsError = computed(() => liveSkillsError.value || (isLive.value ? liveFailures.value.skills || '' : ''))

async function retrySkills() {
  liveSkillsError.value = ''
  try {
    await refreshLiveSkills()
    if (liveFailures.value.skills) delete liveFailures.value.skills
  } catch (e) {
    liveSkillsError.value = errMsg(e)
  }
}

// 卡片数据 = 档案 + 实时统计（live 模式用真实注册表，为空即空态；demo 模式用演示档案）
const cards = computed(() => {
  const profiles =
    dataSource.value === 'live'
      ? liveSkillProfiles.value.map((p) => ({ ...p, promptVersion: '', description: '' }))
      : skillProfiles
  return profiles.map((p) => {
    const stat = skillStatOf(p.id)
    const health: Health = stat.errors > 0 ? 'error' : stat.calls === 0 ? 'idle' : 'ok'
    return { ...p, ...stat, health }
  })
})

const filtered = computed(() => {
  let list = cards.value
  // "仅看需关注"只含失败节点；"从未调用"（idle）是常态不是问题
  if (onlyAttention.value) list = list.filter((c) => c.health === 'error')
  if (categoryFilter.value) list = list.filter((c) => String(c.category || '').toLowerCase() === categoryFilter.value)
  const q = keyword.value.trim().toLowerCase()
  if (q) list = list.filter((c) => `${c.name} ${c.id} ${c.category}`.toLowerCase().includes(q))
  // 排序：默认失败优先，其次调用量
  const dir = sortDir.value === 'desc' ? -1 : 1
  return [...list].sort((a, b) => {
    const diff = (a[sortKey.value] - b[sortKey.value]) * dir
    if (diff !== 0) return diff
    return b.calls - a.calls
  })
})

const activeCount = computed(() => cards.value.filter((c) => c.calls > 0).length)
const errorCount = computed(() => cards.value.filter((c) => c.errors > 0).length)

/* ===== Skill 运营概览（sk-dash：窗口内聚合 + 结论 + KPI） ===== */
const totalCalls = computed(() => cards.value.reduce((a, c) => a + c.calls, 0))
const totalErrors = computed(() => cards.value.reduce((a, c) => a + c.errors, 0))
const okCalls = computed(() => Math.max(0, totalCalls.value - totalErrors.value))
const overallRate = computed(() => (totalCalls.value > 0 ? Math.round((okCalls.value / totalCalls.value) * 100) : null))
const rateNumTone = computed<'' | 'bad' | 'warn'>(() => (overallRate.value == null ? '' : overallRate.value < 70 ? 'bad' : overallRate.value < 90 ? 'warn' : ''))
const idleCount = computed(() => cards.value.filter((c) => c.calls === 0).length)
const avgLatencyMs = computed(() => {
  const called = cards.value.filter((c) => c.calls > 0 && c.avgMs > 0)
  if (!called.length) return null
  return Math.round(called.reduce((a, c) => a + c.calls * c.avgMs, 0) / called.reduce((a, c) => a + c.calls, 0))
})
const avgLatencyText = computed(() => (avgLatencyMs.value == null ? '—' : avgLatencyMs.value >= 1000 ? `${(avgLatencyMs.value / 1000).toFixed(1)}s` : `${avgLatencyMs.value}ms`))
const lastActiveText = computed(() => {
  const t = cards.value.reduce((max, c) => (c.lastAt && c.lastAt !== '从未' && ((max == null) || c.lastAt > max) ? c.lastAt : max), null as string | null)
  return t || '从未'
})
const skDashHasData = computed(() => totalCalls.value > 0 || errorCount.value > 0)
const skDashTone = computed<'ok' | 'warn' | 'bad' | 'muted'>(() =>
  errorCount.value > 0 ? 'bad' : totalCalls.value > 0 ? 'ok' : 'muted'
)
const skDashTitle = computed(() =>
  errorCount.value ? `${errorCount.value} 个节点存在失败` : totalCalls.value ? 'Skill 网络健康' : '暂无运行数据'
)
const RANGE_LABELS: Record<string, string> = { '7d': '近 7 天', '24h': '近 24 小时', '30d': '近 30 天', all: '全部时间' }
const rangeLabel = computed(() => RANGE_LABELS[statsRange.value] || '近期')
const skDashSubline = computed(() =>
  errorCount.value ? '建议优先处理失败节点，排查窗口内异常调用' : totalCalls.value ? `${activeCount.value} 个 Skill 有调用 · 运行平稳` : '产生调用后自动呈现统计'
)
const rangeDetailLabel = computed(() => `窗口：${rangeLabel.value}`)

const isFiltered = computed(() => onlyAttention.value || !!keyword.value.trim() || !!categoryFilter.value)
function clearFilters() {
  onlyAttention.value = false
  keyword.value = ''
  categoryFilter.value = ''
}

/* 长列表分批渲染：每批 15 行 */
/* 客户端分页（P2：替代「加载更多」——统一 mk-pagination 页码器）：
   数据全量在客户端（live 拉取 / demo 本地），筛选后按页切片；
   筛选/数据变化自动回第 1 页（watch filtered）；recShown 属对账明细，仍用加载更多 */
const page = ref(1)
const pageSize = ref(15)
const paged = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})
watch(filtered, () => {
  page.value = 1
})

const statusTone = computed(() => (errorCount.value ? 'mk-status--bad' : activeCount.value ? 'mk-status--ok' : 'mk-status--muted'))
const statusTitle = computed(() =>
  cards.value.length ? 'Skill 运行' : '暂无运行数据'
)

const successRate = (s: { calls: number; errors: number }) =>
  s.calls ? `${(((s.calls - s.errors) / s.calls) * 100).toFixed(0)}%` : '—'

/* ================= 技能对账面板（SKILL_READINESS_SPEC §4.2） ================= */
const recReport = ref<SkillReconciliationReport | null>(null)
const recLoading = ref(false)
const recError = ref('')
/** 滚动修复 #4：对账卡默认折叠（32 行分组表不再默认撑长页面） */
const recOpen = ref(false)
/** 深链定位：?recon=1 展开 + 滚动；?diff=unregistered|active-missing|live 过滤差集行（巡检工作台计数卡 → 目录对账闭环） */
const route = useRoute()
const recDiff = ref('')
const recPanelRef = ref<HTMLElement | null>(null)
let recDeepLinked = false

function applyRecQuery() {
  const recon = String(route.query.recon || '')
  const diff = typeof route.query.diff === 'string' ? route.query.diff : ''
  recDeepLinked = recon === '1' || recon === 'true'
  recOpen.value = recDeepLinked
  recDiff.value = diff === 'unregistered' || diff === 'active-missing' || diff === 'live' ? diff : ''
}

/** 深链落地：数据到达后滚动定位到对账面板（避免折叠态下 scrollIntoView 落空） */
watch(recReport, async (report) => {
  if (!report || !recDeepLinked || !recOpen.value) return
  await nextTick()
  recPanelRef.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
})

async function refreshReconciliation() {
  if (!isLive.value) return
  recLoading.value = true
  recError.value = ''
  try {
    const res = await adminSkillsApi.getReconciliation()
    recReport.value = res.data?.data ?? null
  } catch (e) {
    recError.value = errMsg(e)
    recReport.value = null
  } finally {
    recLoading.value = false
  }
}

watch(isLive, (live) => {
  if (live) refreshReconciliation()
})

onMounted(() => {
  applyRecQuery()
  if (isLive.value) refreshReconciliation()
})

/** 完成度五档色标（draft → live）；文案单源：glossaryMeta.ts（与后端 glossary-content 对齐） */
const recStatusText = (status: string) =>
  completionMetaOf(status)?.label || status

/** 目录表完成度列数据源：复用对账面板 completion（live 模式一次拉取合并加载），
    skillId → SkillCompletion；目录行不在对账口径（外挂等）时返回 null 显示 — */
const recCompletionOf = computed(() => {
  const m = new Map<string, SkillCompletion>()
  for (const r of recReport.value?.items ?? []) m.set(r.skillId, r.completion)
  return m
})

function completionBadgeOf(skillId: string): { cls: string; text: string; title: string } | null {
  const c = recCompletionOf.value.get(skillId)
  if (!c) return null
  return { cls: `mk-badge--rec-${c.status}`, text: recStatusText(c.status), title: recGateDetail(c) }
}

/** 行健康点：live 绿、差集红、其余灰 */
/** 完成度徽标 tooltip：首个失败档的依据文本 */
function recGateDetail(completion: SkillCompletion): string {
  const gates: Array<[string, string]> = [
    ['draft', '户口簿'],
    ['handlerReady', 'handler 注册'],
    ['coreReady', 'core 文件'],
    ['fieldsSynced', '字段路由'],
    ['live', 'ACTIVE prompt'],
  ]
  for (const [key, label] of gates) {
    const gate = completion.gates[key as keyof typeof completion.gates]
    if (!gate?.ok) return `${label}：${gate?.detail || '未通过'}`
  }
  return '全部门槛通过'
}
</script>

<style scoped>
/* 列表视图 */
.sk-row { cursor: pointer; }
.sk-cell { display: flex; align-items: center; gap: 10px; }
/* 目录表列宽防抖（ADMIN_COLUMN_WIDTH_AUDIT ④）：全部固定宽，杜绝内容撑宽抖动；
   Skill 列 = 吸收列（剩余宽度主要进它，1920 不再全列等比放大 42%）。
   用 :not(.sk-rec-table) 排除下方对账表（7 列结构不同） */
.sk-table:not(.sk-rec-table) th:nth-child(1), .sk-table:not(.sk-rec-table) td:nth-child(1) { width: 380px; }
.sk-table:not(.sk-rec-table) th:nth-child(2), .sk-table:not(.sk-rec-table) td:nth-child(2) { width: 170px; }
.sk-table:not(.sk-rec-table) th:nth-child(3), .sk-table:not(.sk-rec-table) td:nth-child(3) { width: var(--mk-col-badge); }
.sk-table:not(.sk-rec-table) th:nth-child(4), .sk-table:not(.sk-rec-table) td:nth-child(4) { width: 96px; }
.sk-table:not(.sk-rec-table) th:nth-child(5), .sk-table:not(.sk-rec-table) td:nth-child(5),
.sk-table:not(.sk-rec-table) th:nth-child(6), .sk-table:not(.sk-rec-table) td:nth-child(6),
.sk-table:not(.sk-rec-table) th:nth-child(7), .sk-table:not(.sk-rec-table) td:nth-child(7) { width: 64px; }
.sk-table:not(.sk-rec-table) th:nth-child(8), .sk-table:not(.sk-rec-table) td:nth-child(8) { width: 72px; }
.sk-table:not(.sk-rec-table) th:nth-child(9), .sk-table:not(.sk-rec-table) td:nth-child(9) { width: 88px; }
.sk-table:not(.sk-rec-table) th:nth-child(10), .sk-table:not(.sk-rec-table) td:nth-child(10) { width: 60px; }
/* 英文原名（id）主行：等宽突出；中文描述副行：灰色正文（非 mono）。
   截断上限统一引用 token（原散落 460px） */
.sk-id-main {
  font-family: var(--mk-mono);
  font-weight: 700;
  max-width: var(--mk-cell-main-max);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sk-name-desc {
  font-size: 11.5px;
  color: var(--mk-faint);
  line-height: 1.5;
  font-family: inherit;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  max-width: var(--mk-cell-main-max);
}
.sk-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.sk-dot--ok { background: var(--mk-green); }
.sk-dot--idle { background: #c3cede; }
.sk-dot--error { background: var(--mk-red); animation: sk-blink 1.2s ease infinite; }
.sk-err { color: var(--mk-red); font-weight: 700; }
/* 指标阈值着色 */
.sk-rate--bad { color: var(--mk-red); font-weight: 700; }
.sk-rate--warn { color: var(--mk-amber); font-weight: 700; }

/* 网格视图 */
.sk-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
}
.sk-grid--inset {
  padding: 12px;
  max-height: 68vh;
  overflow-y: auto;
}
.sk-card {
  display: grid;
  gap: 6px;
  min-height: 110px;
  padding: 13px 14px;
  border-radius: 12px;
  border: 1px solid var(--mk-line);
  background: var(--mk-surface);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: 0.14s ease;
}
.sk-card:hover { border-color: rgba(44, 99, 208, 0.35); transform: translateY(-1px); }
.sk-card--error { border-color: rgba(220, 38, 38, 0.4); background: linear-gradient(180deg, #fff7f7, #fff); }

.sk-card__head { display: flex; align-items: center; gap: 7px; }
.sk-card__dot { width: 8px; height: 8px; border-radius: 50%; background: var(--mk-green); }
.sk-card--idle .sk-card__dot { background: #c3cede; }
.sk-card--error .sk-card__dot { background: var(--mk-red); animation: sk-blink 1.2s ease infinite; }
@keyframes sk-blink { 50% { opacity: 0.3; } }
.sk-card__cat { font-size: 10.5px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--mk-faint); }
.sk-card__flag { margin-left: auto; font-size: 10.5px; font-weight: 700; color: var(--mk-red); }
.sk-card--idle .sk-card__flag { color: var(--mk-faint); }

/* 英文原名（id）主行 + 中文解释副行 */
.sk-card__name {
  font-family: var(--mk-mono);
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sk-card__id {
  font-size: 11px;
  color: var(--mk-faint);
  line-height: 1.5;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.sk-card__stats {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--mk-muted);
  font-variant-numeric: tabular-nums;
  border-top: 1px dashed var(--mk-line);
  padding-top: 7px;
  margin-top: 2px;
}
.sk-card__err { color: var(--mk-red); font-weight: 700; }
/* 失败率进度条 */
.sk-card__rate { display: block; width: 100%; height: 4px; border-radius: 99px; background: var(--mk-line); overflow: hidden; margin-top: 2px; }
.sk-card__rate-bar { display: block; height: 100%; border-radius: 99px; background: var(--mk-green); transition: width 0.15s ease; }
.sk-card__rate-bar.is-bad { background: var(--mk-red); }

/* 所属阶段标签 */
.sk-agent-tag {
  display: inline-flex;
  align-items: center;
  padding: 2px 9px;
  border-radius: 999px;
  background: var(--mk-line);
  color: var(--mk-muted);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}
.sk-agent-tag::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--mk-blue, #2c63d0);
  margin-right: 6px;
  flex-shrink: 0;
}

/* ================= 技能对账面板（SKILL_READINESS_SPEC §4.2） ================= */
.sk-rec { margin-top: 14px; }
/* 滚动修复 #4：对账卡 details 折叠（summary = 卡头） */
.sk-rec__summary { cursor: pointer; user-select: none; list-style: none; }
.sk-rec__summary::-webkit-details-marker { display: none; }
.sk-rec__summary::before {
  content: '▸';
  display: inline-block;
  margin-right: 6px;
  color: var(--mk-blue, #2c63d0);
  transition: transform 0.14s ease;
}
.sk-rec[open] > .sk-rec__summary::before { transform: rotate(90deg); }
.sk-rec__more {
  display: flex;
  justify-content: center;
  padding: 8px 0 10px;
  border-top: 1px dashed var(--mk-line);
}
.sk-rec-tools {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px 14px 4px;
}
.sk-rec__title { display: flex; flex-direction: column; gap: 2px; }
.sk-rec__title strong { font-size: 14px; }
.sk-rec__clear { width: fit-content; }
.sk-rec-flash { animation: sk-rec-flash 1.4s ease 2; }
@keyframes sk-rec-flash {
  0%, 100% { background: transparent; }
  50% { background: #fdf3e3; }
}
.sk-rec__loading { color: var(--mk-faint); font-size: 12px; margin-left: auto; }
.sk-rec__pills { display: inline-flex; gap: 6px; margin-left: auto; flex-wrap: wrap; }
.sk-pill--bad { color: var(--mk-red-strong, #b91c1c); background: #fdecec; }
.sk-pill--warn { color: var(--mk-amber, #d97706); background: #fdf3e3; }
.sk-rec__refresh {
  border: 1px solid var(--mk-line);
  background: #fff;
  border-radius: 8px;
  padding: 3px 10px;
  font: inherit;
  font-size: 11.5px;
  color: var(--mk-muted);
  cursor: pointer;
  white-space: nowrap;
}
.sk-rec__refresh:hover { border-color: rgba(44, 99, 208, 0.4); color: var(--mk-blue); }
.sk-rec__refresh:disabled { opacity: 0.5; cursor: default; }
.sk-rec__skeleton { display: grid; gap: 8px; padding: 12px; }
.sk-rec__skeleton span { height: 26px; border-radius: 8px; background: linear-gradient(90deg, #eef2fa, #f7f9fc, #eef2fa); background-size: 200% 100%; animation: sk-rec-shimmer 1.2s infinite; }
@keyframes sk-rec-shimmer { 50% { background-position: -200% 0; } }

.sk-rec-table th, .sk-rec-table td { text-align: left; }
.sk-rec-yn { font-weight: 700; font-size: 13px; }
.sk-rec-yn--ok { color: var(--mk-green, #16a34a); }
.sk-rec-yn--no { color: var(--mk-red, #dc2626); }
.sk-rec-tag {
  display: inline-block;
  margin-left: 4px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--mk-line);
  color: var(--mk-muted);
  font-size: 10px;
  font-weight: 600;
  vertical-align: 1px;
}
.sk-rec-tag--bad { background: #fdecec; color: var(--mk-red-strong, #b91c1c); }

/* 完成度五档色标：draft → live */
.sk-rec-diff { font-size: 11px; font-weight: 700; }
.sk-rec-diff--bad { color: var(--mk-red, #dc2626); }
.sk-rec-diff--warn { color: var(--mk-amber, #d97706); }

.sk-rec-orphans {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 10px 14px;
  border-top: 1px dashed var(--mk-line);
  font-size: 12px;
  color: var(--mk-muted);
}
.sk-rec-orphans .sk-rec-tag { margin-left: 0; }

/* parentAgent 分组节头（P2 补全：goal-agent 下辖 N 条） */
.sk-rec-group td {
  padding: 6px 14px;
  background: var(--mk-surface);
  border-bottom: 1px solid var(--mk-line, #e6ebf4);
}
.sk-rec-group__name {
  font-family: var(--mk-mono);
  font-size: 11.5px;
  font-weight: 700;
  color: var(--mk-blue, #2c63d0);
}
.sk-rec-group__meta {
  margin-left: 8px;
  font-size: 11px;
  font-weight: 600;
  color: var(--mk-muted, #5b6577);
}

.sk-rec-legend {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 10px 14px;
  border-top: 1px dashed var(--mk-line);
  font-size: 11.5px;
  color: var(--mk-muted);
}
.sk-rec-legend__item { display: inline-flex; align-items: center; gap: 5px; }
.sk-rec-legend__item .mk-badge { padding: 2px 8px; font-size: 10px; }

/* 大屏档位（mk 体系：2000 ≈×1.15，2800 ≈×1.17） */
@media (min-width: 2000px) {
  .sk-card__cat,
  .sk-card__flag { font-size: 12px; }
  .sk-rec__loading { font-size: 13.5px; }
  .sk-rec-diff { font-size: 12.5px; }
  .sk-rec-legend__item .mk-badge { font-size: 11.5px; }
  .sk-dot { width: 10px; height: 10px; }
}
@media (min-width: 2800px) {
  .sk-card__cat,
  .sk-card__flag { font-size: 14px; }
  .sk-rec__loading { font-size: 16px; }
  .sk-rec-diff { font-size: 15px; }
  .sk-rec-legend__item .mk-badge { font-size: 14px; }
  .sk-dot { width: 12px; height: 12px; }
}
@media (min-width: 3600px) {
  .sk-card__cat,
  .sk-card__flag { font-size: 16.5px; }
  .sk-rec__loading { font-size: 18.5px; }
  .sk-rec-diff { font-size: 17.5px; }
  .sk-rec-legend__item .mk-badge { font-size: 16.5px; }
  .sk-dot { width: 14px; height: 14px; }
}

/* ================= 暗色模式（D1 补完）：Skill 运行 ================= */
html[data-theme='dark'] {
  .sk-card__rate, .sk-table__statusbar { background: #232f45; }
  .sk-pill--bad { color: #fca5a5; background: rgba(248, 113, 113, 0.14); }
  .sk-pill--warn { color: #fcd34d; background: rgba(251, 191, 36, 0.14); }
  .sk-rec-tag--bad { color: #fca5a5; background: rgba(248, 113, 113, 0.14); }
  .sk-card { background: #141c2b; border-color: #232f45; }
  .sk-card__head { border-bottom-color: #232f45; }
  .sk-card--error { background: linear-gradient(180deg, #241a1a, #141c2b); }
  .sk-dot--idle, .sk-card--idle .sk-card__dot { background: #4a5874; }
  .sk-agent-tag, .sk-rec-tag { background: #232f45; color: #9fb0c8; }
  .sk-rec-group td { background: #1b2537; }
  .sk-rec__refresh { background: #17202f; }
  .sk-rec-flash { animation: none; }
}

/* ================= D3 表格增强：Skill 列设置菜单 ================= */
.sk-cols { position: relative; display: inline-flex; }
.sk-cols__menu {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  z-index: var(--mk-z-menu);
  min-width: 150px;
  padding: 6px;
  display: grid;
  gap: 2px;
  background: var(--mk-surface, #fff);
  border: 1px solid var(--mk-line);
  border-radius: 10px;
  box-shadow: var(--mk-shadow-pop);
}
.sk-cols__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 7px;
  font-size: 12.5px;
  color: var(--mk-muted);
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
}
.sk-cols__item:hover { background: #f0f5ff; }
html[data-theme='dark'] .sk-cols__item:hover { background: #1f2b40; }
.sk-cols__item input { accent-color: var(--mk-blue, #2c63d0); }
.sk-cols__reset {
  margin-top: 4px;
  border: 0;
  background: transparent;
  padding: 6px 8px;
  border-radius: 7px;
  border-top: 1px dashed var(--mk-line);
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  color: var(--mk-blue);
  cursor: pointer;
  text-align: left;
}
.sk-cols__reset:hover { background: #eff6ff; }
html[data-theme='dark'] .sk-cols__reset:hover { background: #1f2b40; }
</style>
