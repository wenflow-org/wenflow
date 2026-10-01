<template>
  <div class="mk-page mk-page--fill skills-host">
    <!-- 页头（newui/admin pagehead）：页名；本页无页级动作（范围控件在卡头），状态条承载活状态 -->
    <MkPageHead title="Skill 运行" />
    <div class="mk-status" :class="hostTone">
      <span class="mk-status__dot"></span>
      <template v-if="tab === 'run'">
        <MkLoading v-if="liveLoading && !cards.length" inline text="Skill 加载中…" /><span v-else class="mk-status__meta" :title="skillCountHint">共 {{ cards.length }} 个 Skill</span>
        <!-- 窗口切换刷新中：先摘掉旧窗口的统计数字，避免新口径加载完成前旧 KPI 滞留误导（live.ts 侧 boot 窗口静默 no-op 属 live.ts，这里只兜 UI 观感） -->
        <MkLoading v-if="rangeRefreshing" inline text="统计刷新中…" />
        <template v-else>
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
        </template>
      </template>
      <template v-else>
        <span class="mk-status__meta" title="技能 × 通道 × 参数 × 兜底的覆盖矩阵">覆盖矩阵</span>
      </template>
      <span v-if="tab === 'run'" class="mk-status__meta">{{ rangeLabel }}</span>
    </div>

    <!-- 视图切换（原型 .tabs 下划线页签：12px/600、激活蓝字+2px 蓝下划线、通栏底线；
         2026-10-01 由 mk-pills 胶囊迁入——胶囊只做筛选 chips，视图/分区切换归页签）：
         Skill 运行 / 模型路由。健康检查 · 漂移 · 对账三 tab 已退役（2026-09-29 用户拍板）：
         三者本就是同一份报表的三刀，合一后独立成 /admin/health-center，侧栏落在「系统」组。 -->
    <div class="tabs skills-tabs" role="tablist" aria-label="Skill 视图切换">
      <button type="button" role="tab" class="tab" :aria-selected="tab === 'run'" @click="switchTab('run')">Skill 运行</button>
      <button type="button" role="tab" class="tab" :aria-selected="tab === 'model-routing'" @click="switchTab('model-routing')">模型路由</button>
    </div>

    <!-- ===== Tab1: Skill 运行（原 Skills.vue 全量内容） ===== -->
    <template v-if="tab === 'run'">

    <div class="mk-card mk-card--fill">
      <div class="mk-card__head">
        <div class="mk-filter">
          <div class="mk-pills">
            <button type="button" class="mk-pill" :class="{ 'mk-pill--active': !onlyAttention }" :aria-pressed="!onlyAttention" @click="onlyAttention = false">全部<span class="mk-pill__count">{{ cards.length }}</span></button>
            <button type="button" class="mk-pill" :class="{ 'mk-pill--active': onlyAttention }" :aria-pressed="onlyAttention" @click="onlyAttention = true">仅看需关注<span class="mk-pill__count">{{ errorCount }}</span></button>
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
      <div class="mk-table-scroll">
        <!-- 原型 .tbl：width:100% 自动布局（无 colgroup/无 fixed，2026-10-01 对齐 Users 判例），
             单元格 nowrap、列按内容自然分宽；Skill 名/id 两行都设 max-width 截断兜底，
             防长名单列独吃宽度（上限引用 --mk-cell-main-max token） -->
        <table v-if="filtered.length" class="mk-table sk-table">
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
              <th scope="col" class="mk-th--right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in paged" :key="s.id" class="sk-row" tabindex="0" @click="openSkillDrawer(s.id)" @keydown.enter.prevent="openSkillDrawer(s.id)">
              <td>
                <div class="sk-cell">
                  <span class="sk-dot" :class="`sk-dot--${s.health}`" role="img" :aria-label="healthLabel(s.health)" :title="healthLabel(s.health)"></span>
                  <div class="mk-cell-main">
                    <strong class="sk-name-main mk-ellipsis" :title="s.name">{{ s.name }}</strong>
                    <span class="sk-id-desc mk-ellipsis mono" :title="s.id">{{ s.id }}</span>
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
                <!-- 对账未就绪三态：加载中 / 加载失败 / 不在对账口径。
                     此前失败与无数据同显「—」，整列塌成无意义符号、用户无从判断 -->
                <span v-else-if="recLoading" class="mk-na" title="对账报告加载中，完成度暂不可用">…</span>
                <span v-else-if="recError" class="mk-na sk-rec-fail" :title="`对账加载失败：${recError}`">对账失败</span>
                <span v-else class="mk-na" title="对账报告中无此 Skill（外挂能力等不在对账口径内）">—</span>
              </td>
              <td v-if="showCol('rate')">
                <!-- 行级设计（批C）：数字+比例条（与网格卡 sk-card__rate 同语言，消灭同页双形态） -->
                <div class="sk-rate" :class="rateTone(s)" :title="s.calls ? `成功率 ${s.calls - s.errors}/${s.calls}` : '窗口内无调用'">
                  <b>{{ successRate(s) }}</b>
                  <span v-if="s.calls" class="sk-rate__bar" aria-hidden="true"><i :style="{ width: rateNum(s) + '%' }"></i></span>
                </div>
              </td>
              <td v-if="showCol('last')"><span :class="{ 'mk-na': !s.calls }">{{ s.lastAt }}</span></td>
              <td>
                <div class="mk-actions">
                  <!-- 轻运营直达：跳过抽屉一跳，直接进设计页「协议」页签改提示词
                       （原型操作列：文字小钮 .btn--sm 形态，对齐 Users 判例） -->
                  <button type="button" class="mk-btn mk-btn--sm" @click.stop="openDesign(s.id)">设计</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
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
      <!-- 客户端分页（统一 mk-pagination 页码器）：筛选后按页切片 -->
      <Pagination
        v-if="filtered.length"
        v-model:page="page"
        v-model:pageSize="pageSize"
        :total="filtered.length"
        :showTotal="true"
      />
    </div>
    </template>
    <!-- ===== Tab2: 模型路由覆盖矩阵（技能 × 通道 × 参数 × 兜底） ===== -->
    <SkillModelCoverage v-if="tab === 'model-routing'" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { skillStatOf, openSkillDrawer, isLive, intent } from './store'
import { liveSkillProfiles, liveSkillStatsRange, refreshLiveSkills, liveFailures, liveLoading, errMsg } from './live'
import { categoryText } from './statusText'
import { COMPLETION_META, completionMetaOf } from './glossaryMeta'
import { EXTRA_CAPABILITY_SKILLS } from './capabilityCatalog'
import MockSkeletonTable from './SkeletonTable.vue'
import MkCols from '@/components/mk/MkCols.vue'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import MkFilterSearch from '@/components/mk/MkFilterSearch.vue'
import Pagination from './Pagination.vue'
import { useIsNarrow } from './useIsNarrow'
import { useTableSort } from './useTableSort'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkLoading from '@/components/mk/MkLoading.vue'
import SkillModelCoverage from './SkillModelCoverage.vue'
import { adminSkillsApi, type SkillCompletion, type SkillReconciliationReport } from '@/api/adminApi'

/* ================= 宿主：Skill 运行 · 模型路由（原 5 tab 收敛为 2，健康中心 2026-09-29 独立成页） =================
   健康中心由独立场景折入本宿主 tab（侧栏 15→14 项）；?tab= 双向同步，深链/刷新/前进后退可寻址；
   唯一 tab 控件 = 本行 pills（健康中心内不再嵌套 pills，R1）。 */
const SKILLS_TABS = ['run', 'model-routing'] as const
type SkillsTab = (typeof SKILLS_TABS)[number]
const tab = ref<SkillsTab>('run')
const route = useRoute()
const router = useRouter()
/** 轻运营直达：列表行「设计」→ 设计页「协议」页签（改提示词的唯一编辑点） */
function openDesign(id: string) {
  void router.push(`/admin/skills/${encodeURIComponent(id)}?tab=protocol`)
}

/** 退役 tab 的老深链（健康检查/漂移/对账）改投独立页；只认现役 tab，其余回落 run */
const RETIRED_TABS = new Set(['health', 'drift', 'recon'])
const toHealthCenter = (extra: Record<string, string> = {}) =>
  void router.replace({ path: '/admin/health-center', query: extra })

watch(
  () => route?.query?.tab,
  (t) => {
    if (typeof t === 'string' && RETIRED_TABS.has(t)) {
      // 老书签 / 旧文档链接：/admin/skills?tab=health → /admin/health-center（?recon=/?diff= 等定位参数一并带走）
      const { tab: _drop, ...rest } = route.query as Record<string, string>
      toHealthCenter(rest)
      return
    }
    const v = typeof t === 'string' && (SKILLS_TABS as readonly string[]).includes(t) ? (t as SkillsTab) : null
    if (v && v !== tab.value) tab.value = v
    else if (!v && tab.value !== 'run') tab.value = 'run'
  },
  { immediate: true }
)
function switchTab(t: SkillsTab) {
  tab.value = t
  if (route && router && route.query.tab !== t) void router.replace({ query: { ...route.query, tab: t } })
}
/* 跨页深链：intent.tab 指向退役 tab（旧调用方还在传 health/drift/recon）也改投独立页 */
watch(
  () => intent.tab,
  (t) => {
    if (!t) return
    if (RETIRED_TABS.has(t)) {
      intent.tab = ''
      toHealthCenter()
      return
    }
    if ((SKILLS_TABS as readonly string[]).includes(t)) {
      tab.value = t as SkillsTab
      intent.tab = ''
    }
  },
  { immediate: true }
)
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
// 时间窗口切换 → 按新窗口重新拉取统计；期间状态条展示局部 loading，摘掉旧窗口数字
const rangeRefreshing = ref(false)
watch(statsRange, async () => {
  rangeRefreshing.value = true
  try {
    await refreshLiveSkills()
    liveSkillsError.value = ''
  } catch (e) {
    liveSkillsError.value = errMsg(e)
  } finally {
    rangeRefreshing.value = false
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

/** 健康状态文案（状态点 tooltip + aria-label 共用）：状态点是无内容的 span，
    仅靠 title 时触屏/读屏拿不到状态（且 title 会成为行可访问名的首词） */
function healthLabel(health: Health): string {
  if (health === 'error') return '异常'
  if (health === 'idle') return '空闲'
  return '健康'
}

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
   仅筛选条件变化才回第 1 页；后台数据刷新（轮询/窗口切换）不重置页码，
   否则每次刷新都把用户翻到的页拽回去；越界时收敛到最后一页；
   recShown 属对账明细，仍用加载更多 */
const page = ref(1)
const pageSize = ref(15)
const paged = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})
watch([onlyAttention, keyword, categoryFilter], () => {
  page.value = 1
})
watch(filtered, (list) => {
  const maxPage = Math.max(1, Math.ceil(list.length / pageSize.value))
  if (page.value > maxPage) page.value = maxPage
})

const statusTone = computed(() => (errorCount.value ? 'mk-status--bad' : activeCount.value ? 'mk-status--ok' : 'mk-status--muted'))
/** 状态条基调：只剩运行视图三态（健康/漂移/对账已独立成 /admin/health-center） */
const hostTone = computed(() => statusTone.value)

const successRate = (s: { calls: number; errors: number }) =>
  s.calls ? `${(((s.calls - s.errors) / s.calls) * 100).toFixed(0)}%` : '—'
const rateNum = (s: { calls: number; errors: number }) =>
  s.calls ? ((s.calls - s.errors) / s.calls) * 100 : 0

/* ================= 对账数据（目录表完成度列投影） =================
   本页只用它渲染「完成度」列与排序（对账明细面板自 2026-09-29 起在独立页
   /admin/health-center，那边自行拉取，不再经本页下发）。 */
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
/* ================= 宿主布局（tab 宿主：运行 tab 内滚；模型路由 tab 自管） ================= */
/* 视图切换（原型 .tabs 下划线页签，页面本地复刻；写法与 Users.vue 卡内页签、OpsHub 宿主页签同款：
   12px/600、激活蓝字+2px 蓝下划线、通栏底线） */
.tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--mk-line); }
.tab {
  border: 0;
  background: transparent;
  color: var(--mk-muted);
  padding: 9px 12px;
  cursor: pointer;
  font: inherit;
  font-weight: 600;
  font-size: var(--mk-fs-micro);
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  white-space: nowrap;
  transition: color 0.14s ease, border-color 0.14s ease;
}
.tab:hover { color: var(--mk-ink); }
.tab[aria-selected='true'] { color: var(--mk-blue); border-bottom-color: var(--mk-blue); }

/* 列表视图 */
.sk-row { cursor: pointer; }
.sk-cell { display: flex; align-items: center; gap: 10px; }
/* 原型 .tbl：自动布局 + 单元格 nowrap（列按内容自然分宽，不再 colgroup 定宽） */
.sk-table td { white-space: nowrap; }
/* 中文名主行（正文重色，与同站 SkillDrawer 头部一致）；英文 id 降副行（等宽灰）。
   截断上限统一引用 token（--mk-cell-main-max）：自动布局下防长 Skill 名/长 id 独吃列宽 */
.sk-name-main {
  font-weight: 700;
  max-width: var(--mk-cell-main-max);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sk-id-desc {
  font-family: var(--mk-mono);
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  line-height: 1.5;
  max-width: var(--mk-cell-main-max);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sk-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.sk-dot--ok { background: var(--mk-green); }
.sk-dot--idle { background: #c3cede; }
.sk-dot--error { background: var(--mk-red); animation: sk-blink 1.2s ease infinite; }
/* 完成度列：对账拉取失败的行内提示（红字 + title 带原因） */
.sk-rec-fail { color: var(--mk-red); font-weight: 700; }

/* 指标阈值着色 */
.sk-rate--bad { color: var(--mk-red); font-weight: 700; }
.sk-rate--warn { color: var(--mk-amber); font-weight: 700; }
/* 列表成功率列（批C）：数字+比例条 */
.sk-rate { display: grid; gap: 3px; justify-items: end; }
.sk-rate b { font-variant-numeric: tabular-nums; }
.sk-rate__bar { display: block; width: 56px; height: 4px; border-radius: var(--mk-radius-pill); background: var(--mk-line); overflow: hidden; }
.sk-rate__bar i { display: block; height: 100%; border-radius: var(--mk-radius-pill); background: var(--mk-green); }
.sk-rate--warn .sk-rate__bar i { background: var(--mk-amber); }
.sk-rate--bad .sk-rate__bar i { background: var(--mk-red); }

/* 所属阶段标签 */
.sk-agent-tag {
  display: inline-flex;
  align-items: center;
  padding: 2px 9px;
  border-radius: 999px;
  background: var(--mk-line);
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
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
  .sk-dot { width: 10px; height: 10px; }
  .sk-agent-tag { font-size: var(--mk-fs-micro); padding: 3px 11px; }

  .sk-name-main { font-size: var(--mk-fs-micro); }
  .sk-id-desc { font-size: var(--mk-fs-micro); }
}
@media (min-width: 2800px) {
  .sk-dot { width: 12px; height: 12px; }
  .sk-agent-tag { font-size: var(--mk-fs-micro); padding: 4px 13px; }

  .sk-name-main { font-size: var(--mk-fs-micro); }
  .sk-id-desc { font-size: var(--mk-fs-micro); }
}
@media (min-width: 3600px) {
  .sk-dot { width: 14px; height: 14px; }
  .sk-agent-tag { font-size: var(--mk-fs-body); padding: 5px 15px; }

  .sk-name-main { font-size: var(--mk-fs-emphasis); }
  .sk-id-desc { font-size: var(--mk-fs-body); }
}

/* ================= 暗色模式（D1 补完）：Skill 运行 ================= */
html[data-theme='dark'] {
  .sk-agent-tag { background: #2a2b2d; color: #afb1b6; }
}

</style>
