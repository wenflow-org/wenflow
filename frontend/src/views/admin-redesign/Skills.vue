<template>
  <div class="mk-page mk-page--fill">
    <div class="mk-status" :class="statusTone">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">Skill 运行</strong>
      <span class="mk-status__sep"></span>
      <MkLoading v-if="liveLoading && !cards.length" inline text="Skill 加载中…" /><span v-else class="mk-status__meta" :title="skillCountHint">共 {{ cards.length }} 个 Skill</span>
      <span v-if="overallRate != null" class="mk-status__meta" :class="rateNumTone === 'bad' ? 'mk-status__meta--bad' : rateNumTone === 'warn' ? 'mk-status__meta--warn' : ''" :title="'窗口内成功率 = 成功调用 / 总调用'">
        成功率 {{ overallRate }}%<template v-if="totalCalls">（{{ okCalls }}/{{ totalCalls }}）</template>
      </span>
      <button
        v-if="errorCount > 0"
        type="button"
        class="mk-status__meta-link"
        :class="{ 'mk-status__meta-link--on': onlyAttention }"
        :title="'窗口内出现失败调用的节点数；点击筛选「仅看需关注」'"
        @click="onlyAttention = !onlyAttention"
      >失败节点 {{ errorCount }}</button>
      <span v-if="idleCount > 0" class="mk-status__meta" title="窗口内无调用的 Skill 数">空闲 {{ idleCount }}</span>
      <span v-if="avgLatencyText !== '—'" class="mk-status__meta" title="成功调用平均耗时（按调用量加权）">平均耗时 {{ avgLatencyText }}</span>
      <span class="mk-status__actions">
        <span class="mk-status__meta">{{ rangeLabel }}</span>
      </span>
    </div>

    <!-- 主视图切换（统一样板：状态条正下方的独立一行，按内容宽度、左对齐） -->
    <div class="mk-pills" role="tablist" aria-label="视图模式切换">
      <button type="button" role="tab" class="mk-pill" :aria-selected="view === 'list'" :class="{ 'mk-pill--active': view === 'list' }" @click="view = 'list'">列表</button>
      <button type="button" role="tab" class="mk-pill" :aria-selected="view === 'grid'" :class="{ 'mk-pill--active': view === 'grid' }" @click="view = 'grid'">网格</button>
    </div>

    <div class="mk-card mk-card--fill">
      <div class="mk-card__head">
        <div class="mk-filter">
          <div class="mk-pills">
            <button type="button" class="mk-pill" :class="{ 'mk-pill--active': !onlyAttention }" @click="onlyAttention = false">全部<span class="mk-pill__count">{{ cards.length }}</span></button>
            <button type="button" class="mk-pill" :class="{ 'mk-pill--active': onlyAttention }" @click="onlyAttention = true">仅看需关注<span class="mk-pill__count">{{ errorCount }}</span></button>
          </div>
          <select v-model="categoryFilter" class="mk-filter__select" aria-label="按类别筛选">
            <option value="">全部类别</option>
            <option v-for="c in categoryOptions" :key="c" :value="c">{{ categoryText(c) }}</option>
          </select>
          <select v-model="statsRange" class="mk-filter__select" aria-label="统计窗口">
            <option value="7d">近 7 天</option>
            <option value="24h">近 24 小时</option>
            <option value="30d">近 30 天</option>
            <option value="all">全部</option>
          </select>
          <MkFilterSearch v-model="keyword" placeholder="搜索名称 / ID / 类别" />
          <button v-if="isFiltered" type="button" class="mk-link" @click="clearFilters">清除筛选</button>
        </div>
        <div class="mk-card__head-right">
          <MkCols
            v-if="view === 'list'"
            :col-defs="skColDefs"
            :storage-key="SK_COLS_KEY"
            v-model:hidden="hiddenCols"
          />
          <span class="mk-card__meta">{{ filtered.length }} / {{ cards.length }}</span>
        </div>
      </div>

      <MockSkeletonTable v-if="liveLoading && !cards.length" :cols="10" />
      <template v-else>
      <!-- 列表视图：列对齐 + 排序，问题浮顶 -->
      <div v-if="view === 'list'" class="mk-table-scroll">
        <table v-if="filtered.length" class="mk-table sk-table mk-table--fixed">
          <colgroup>
            <!-- Skill 名：弹性吸收列（不设宽度） -->
            <col style="width:var(--mk-col-text)">
            <col v-if="showCol('agent')" style="width:var(--mk-col-model-wide)">
            <col v-if="showCol('cat')" style="width:var(--mk-col-badge)">
            <col v-if="showCol('completion')" style="width:var(--mk-col-badge)">
            <col v-if="showCol('rate')" style="width:var(--mk-col-num)">
            <col v-if="showCol('last')" style="width:var(--mk-col-time-full)">
          </colgroup>
          <thead>
            <tr>
              <th
                scope="col"
                class="mk-th--sortable"
                :aria-sort="sortState('skill')"
                @click="toggleSort('skill')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleSort('skill')">Skill<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th
                v-if="showCol('agent')"
                scope="col"
                class="mk-th--sortable"
                :aria-sort="sortState('agent')"
                @click="toggleSort('agent')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleSort('agent')">所属阶段<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th
                v-if="showCol('cat')"
                scope="col"
                class="mk-th--sortable"
                :aria-sort="sortState('cat')"
                @click="toggleSort('cat')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleSort('cat')">类别<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th
                v-if="showCol('completion')"
                scope="col"
                class="mk-th--sortable"
                :aria-sort="sortState('completion')"
                @click="toggleSort('completion')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleSort('completion')">完成度<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th
                v-if="showCol('rate')"
                scope="col"
                class="mk-th--right mk-th--sortable"
                :aria-sort="sortState('rate')"
                @click="toggleSort('rate')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleSort('rate')">成功率<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th v-if="showCol('last')">最近调用</th>
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
              <td v-if="showCol('agent')">
                <span v-if="s.agentId" class="sk-agent-tag" :title="s.agentId">{{ s.agentName || s.agentId }}</span>
                <span v-else class="mk-na">工具类</span>
              </td>
              <td v-if="showCol('cat')"><span class="mk-badge mk-badge--muted" :title="s.category">{{ categoryText(s.category) }}</span></td>
              <td v-if="showCol('completion')">
                <span
                  v-if="completionBadgeOf(s.id)"
                  class="mk-badge"
                  :class="completionBadgeOf(s.id)!.cls"
                  :title="completionBadgeOf(s.id)!.title"
                >{{ completionBadgeOf(s.id)!.text }}</span>
                <span v-else class="mk-na">—</span>
              </td>
              <td v-if="showCol('rate')" class="mk-num" :class="rateTone(s)">{{ successRate(s) }}</td>
              <td v-if="showCol('last')"><span :class="{ 'mk-na': !s.calls }">{{ s.lastAt }}</span></td>
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

      <MkEmptyState
        v-if="skillsError && !cards.length"
        title="Skill 数据加载失败"
        :description="skillsError"
        action-text="重试"
        @action="retrySkills"
      />
      <MkEmptyState
        v-else-if="!filtered.length"
        :title="onlyAttention ? '没有需关注的 Skill' : keyword ? '当前筛选无 Skill' : '暂无运行数据'"
        :description="onlyAttention ? '一切健康。' : keyword ? '换个关键词试试。' : ''"
        :action-text="isFiltered ? '清除筛选' : ''"
        @action="clearFilters"
      />
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
import { computed, onMounted, ref, watch } from 'vue'
import { skillStatOf, openSkillDrawer, isLive } from './store'
import { liveSkillProfiles, liveSkillStatsRange, refreshLiveSkills, liveFailures, liveLoading, errMsg } from './live'
import { categoryText } from './statusText'
import { COMPLETION_META, completionMetaOf } from './glossaryMeta'
import { EXTRA_CAPABILITY_SKILLS } from '@/views/admin/capabilityCatalog'
import MockSkeletonTable from './SkeletonTable.vue'
import MkCols from '@/components/mk/MkCols.vue'
import MkFilterSearch from '@/components/mk/MkFilterSearch.vue'
import Pagination from './Pagination.vue'
import { useIsNarrow } from './useIsNarrow'
import { useTableSort } from './useTableSort'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkLoading from '@/components/mk/MkLoading.vue'
import { adminSkillsApi, type SkillCompletion, type SkillReconciliationReport } from '@/api/adminApi'

type Health = 'ok' | 'idle' | 'error'
/** 目录表行（档案 + 实时统计 + 健康态） */
interface SkillRow {
  id: string
  name: string
  category: string
  agentId: string
  agentName?: string
  calls: number
  errors: number
  avgMs: number
  lastAt: string
  health: Health
}

const onlyAttention = ref(false)
const keyword = ref('')
const categoryFilter = ref('')
const view = ref<'list' | 'grid'>('list')

/* D3 表格增强：列显隐（持久化 / 点击外部与 Esc 关闭由共享 MkCols 组件承担；Skill 列固定） */
const SK_COLS_KEY = 'wf_skills_hidden_cols'
const skColDefs = [
  { key: 'agent', label: '所属阶段', title: '所属顶层 Agent' },
  { key: 'cat', label: '类别', title: 'Skill 类别' },
  { key: 'completion', label: '完成度', title: '完成度五档' },
  { key: 'rate', label: '成功率', title: '窗口内成功率' },
  { key: 'last', label: '最近调用', title: '最近调用时间' },
] as const
const hiddenCols = ref<Set<string>>(new Set())

/* 移动端仅保留「Skill / 状态」：隐藏所属阶段、类别、完成度、最近调用，减少横向滚动 */
const isNarrow = useIsNarrow()
const MOBILE_HIDDEN_COLS = new Set(['agent', 'cat', 'completion', 'last'])
const showCol = (key: string) => !hiddenCols.value.has(key) && !(isNarrow.value && MOBILE_HIDDEN_COLS.has(key))
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
  try {
    await refreshLiveSkills()
    liveSkillsError.value = ''
  } catch (e) {
    liveSkillsError.value = errMsg(e)
  }
})

/** live 拉取失败：初始装载失败（liveFailures.skills）或窗口切换/重试失败（本地） */
const liveSkillsError = ref('')
const skillsError = computed(() => liveSkillsError.value || liveFailures.value.skills || '')

async function retrySkills() {
  liveSkillsError.value = ''
  try {
    await refreshLiveSkills()
    if (liveFailures.value.skills) delete liveFailures.value.skills
  } catch (e) {
    liveSkillsError.value = errMsg(e)
  }
}

// 卡片数据 = 档案 + 实时统计（live 注册表；为空即空态）
const cards = computed<SkillRow[]>(() => {
  const profiles = liveSkillProfiles.value.map((p) => ({ ...p, promptVersion: '', description: '' }))
  return profiles.map((p) => {
    const stat = skillStatOf(p.id)
    const health: Health = stat.errors > 0 ? 'error' : stat.calls === 0 ? 'idle' : 'ok'
    return { ...p, ...stat, health }
  })
})

/* 表格排序：默认失败数优先（问题浮顶，保持既有行为），表头可点切换。
   数据为 live 注册表全量（有界）→ 客户端排序是诚实的；截断/服务端分页列表不适用本机制。 */
const { sortState, toggle: toggleSort, sortRows } = useTableSort<SkillRow>({
  accessors: {
    errors: (s) => s.errors,
    skill: (s) => s.name || s.id,
    agent: (s) => s.agentName || s.agentId || '',
    cat: (s) => s.category || '',
    completion: (s) => completionRank(s.id),
    rate: (s) => (s.calls > 0 ? (s.calls - s.errors) / s.calls : null)
  },
  defaultKey: 'errors',
  defaultDir: 'desc',
  storageKey: 'wf_skills_sort'
})

const filtered = computed(() => {
  let list = cards.value
  // "仅看需关注"只含失败节点；"从未调用"（idle）是常态不是问题
  if (onlyAttention.value) list = list.filter((c) => c.health === 'error')
  if (categoryFilter.value) list = list.filter((c) => String(c.category || '').toLowerCase() === categoryFilter.value)
  const q = keyword.value.trim().toLowerCase()
  if (q) list = list.filter((c) => `${c.name} ${c.id} ${c.category}`.toLowerCase().includes(q))
  return sortRows(list)
})

const activeCount = computed(() => cards.value.filter((c) => c.calls > 0).length)
const errorCount = computed(() => cards.value.filter((c) => c.errors > 0).length)

/* ===== Skill 运营概览（sk-dash：窗口内聚合 + 结论 + KPI） ===== */
const totalCalls = computed(() => cards.value.reduce((a, c) => a + c.calls, 0))
const totalErrors = computed(() => cards.value.reduce((a, c) => a + c.errors, 0))
const okCalls = computed(() => Math.max(0, totalCalls.value - totalErrors.value))
const overallRate = computed(() => (totalCalls.value > 0 ? Math.round((okCalls.value / totalCalls.value) * 100) : null))
/** 口径提示：Skill 运行页不含外挂能力（MCP + 能力 Skill），而健康中心/对账的登记总数含它们——避免「31/28/3」三处数字无从解释 */
const skillCountHint = computed(
  () => (EXTRA_CAPABILITY_SKILLS.length
    ? `不含 ${EXTRA_CAPABILITY_SKILLS.length} 个外挂能力（见「外挂能力」页）；健康中心 / 对账的登记总数含它们`
    : ''),
)
const rateNumTone = computed<'' | 'bad' | 'warn'>(() => (overallRate.value == null ? '' : overallRate.value < 70 ? 'bad' : overallRate.value < 90 ? 'warn' : ''))
const idleCount = computed(() => cards.value.filter((c) => c.calls === 0).length)
const avgLatencyMs = computed(() => {
  const called = cards.value.filter((c) => c.calls > 0 && c.avgMs > 0)
  if (!called.length) return null
  return Math.round(called.reduce((a, c) => a + c.calls * c.avgMs, 0) / called.reduce((a, c) => a + c.calls, 0))
})
const avgLatencyText = computed(() => (avgLatencyMs.value == null ? '—' : avgLatencyMs.value >= 1000 ? `${(avgLatencyMs.value / 1000).toFixed(1)}s` : `${avgLatencyMs.value}ms`))
const RANGE_LABELS: Record<string, string> = { '7d': '近 7 天', '24h': '近 24 小时', '30d': '近 30 天', all: '全部时间' }
const rangeLabel = computed(() => RANGE_LABELS[statsRange.value] || '近期')

const isFiltered = computed(() => onlyAttention.value || !!keyword.value.trim() || !!categoryFilter.value)
function clearFilters() {
  onlyAttention.value = false
  keyword.value = ''
  categoryFilter.value = ''
}

/* 长列表分批渲染：每批 15 行 */
/* 客户端分页（P2：替代「加载更多」——统一 mk-pagination 页码器）：
   数据全量在客户端（live 拉取），筛选后按页切片；
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

const successRate = (s: { calls: number; errors: number }) =>
  s.calls ? `${(((s.calls - s.errors) / s.calls) * 100).toFixed(0)}%` : '—'

/* ================= 对账数据（目录表完成度列投影） =================
   明细对账面板本体在健康中心内嵌的 SkillReconciliation（含 ?recon=/?diff= 深链定位）；
   本页只消费其 completion 映射用于完成度列，不再重复深链逻辑。 */
const recReport = ref<SkillReconciliationReport | null>(null)
const recLoading = ref(false)
const recError = ref('')

async function refreshReconciliation() {
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

watch(isLive, () => {
  refreshReconciliation()
})

onMounted(() => {
  refreshReconciliation()
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

/** 完成度序号（0=draft … 4=live；无对账行 → null 排末尾），供表头排序 */
function completionRank(skillId: string): number | null {
  const c = recCompletionOf.value.get(skillId)
  if (!c) return null
  const i = COMPLETION_META.findIndex((m) => m.status === c.status)
  return i >= 0 ? i : null
}

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
/* 列宽统一走 <colgroup> + token（见模板上方）；Skill 列为 auto 吸收列。
   此处不再用 th/td:nth-child 写宽——它与 colgroup 冲突，且 nth-child(7~10) 已无对应列，
   会导致列宽既非 colgroup 也非 token、且不可预测。 */
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
  font-size: var(--mk-fs-12);
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

/* 指标阈值着色 */
.sk-rate--bad { color: var(--mk-red); font-weight: 700; }
.sk-rate--warn { color: var(--mk-amber); font-weight: 700; }

/* 网格视图 */
.sk-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
}
/* 应用式布局（mk-card--fill）：不内滚，高度交给页面滚动（消除双滚动条） */
.sk-grid--inset {
  padding: 12px;
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
.sk-card__cat { font-size: var(--mk-fs-11); font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--mk-faint); }
.sk-card__flag { margin-left: auto; font-size: var(--mk-fs-11); font-weight: 700; color: var(--mk-red); }
.sk-card--idle .sk-card__flag { color: var(--mk-faint); }

/* 英文原名（id）主行 + 中文解释副行 */
.sk-card__name {
  font-family: var(--mk-mono);
  font-size: var(--mk-fs-13);
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sk-card__id {
  font-size: var(--mk-fs-11);
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
  font-size: var(--mk-fs-12);
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
  font-size: var(--mk-fs-11);
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

/* 大屏档位（mk 体系：2000 ≈×1.15，2800 ≈×1.17，3600 ≈×1.3） */
@media (min-width: 2000px) {
  .sk-card__cat,
  .sk-card__flag { font-size: 12px; }
  .sk-dot { width: 10px; height: 10px; }
  .sk-agent-tag { font-size: 12.5px; padding: 3px 11px; }

  .sk-id-main { font-size: 13.5px; }
  .sk-name-desc { font-size: 13px; }
}
@media (min-width: 2800px) {
  .sk-card__cat,
  .sk-card__flag { font-size: 14px; }
  .sk-dot { width: 12px; height: 12px; }
  .sk-agent-tag { font-size: 14.5px; padding: 4px 13px; }

  .sk-id-main { font-size: 16px; }
  .sk-name-desc { font-size: 15.5px; }
}
@media (min-width: 3600px) {
  .sk-card__cat,
  .sk-card__flag { font-size: 16.5px; }
  .sk-dot { width: 14px; height: 14px; }
  .sk-agent-tag { font-size: 17px; padding: 5px 15px; }

  .sk-id-main { font-size: 18.5px; }
  .sk-name-desc { font-size: 18px; }
}

/* ================= 暗色模式（D1 补完）：Skill 运行 ================= */
html[data-theme='dark'] {
  .sk-card__rate { background: #232f45; }
  .sk-card { background: #141c2b; border-color: #232f45; }
  .sk-card__head { border-bottom-color: #232f45; }
  .sk-card--error { background: linear-gradient(180deg, #241a1a, #141c2b); }
  .sk-dot--idle, .sk-card--idle .sk-card__dot { background: #4a5874; }
  .sk-agent-tag { background: #232f45; color: #9fb0c8; }
}

/* ================= D3 表格增强：Skill 列设置菜单 ================= */









@media (min-width: 2000px) {

}
@media (min-width: 2800px) {

}
@media (min-width: 3600px) {

}
</style>
