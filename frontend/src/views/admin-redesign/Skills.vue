<template>
  <div class="mk-page">
    <div class="mk-status" :class="statusTone">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">{{ statusTitle }}</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">{{ cards.length }} 个 Skill</span>
      <span class="mk-status__meta">有调用 {{ activeCount }}</span>
      <span class="mk-status__meta">失败节点 {{ errorCount }}</span>
      <div class="mk-pills" style="margin-left:auto">
        <button type="button" class="mk-pill" :class="{ 'mk-pill--active': !onlyAttention }" @click="onlyAttention = false">全部</button>
        <button type="button" class="mk-pill" :class="{ 'mk-pill--active': onlyAttention }" @click="onlyAttention = true">仅看需关注</button>
      </div>
      <label v-if="isLive" class="sk-range-wrap" title="统计时间窗口（默认近 7 天）">
        <span class="sk-range-label">统计窗口</span>
        <select v-model="statsRange" class="sk-range">
          <option value="7d">近 7 天</option>
          <option value="24h">近 24 小时</option>
          <option value="30d">近 30 天</option>
          <option value="all">全部</option>
        </select>
      </label>
      <div class="mk-pills">
        <button type="button" class="mk-pill" :class="{ 'mk-pill--active': view === 'list' }" @click="view = 'list'">列表</button>
        <button type="button" class="mk-pill" :class="{ 'mk-pill--active': view === 'grid' }" @click="view = 'grid'">网格</button>
      </div>
    </div>

    <div class="mk-card">
      <div class="mk-card__head">
        <div class="mk-filter">
          <select v-model="categoryFilter" class="mk-filter__select" aria-label="按类别筛选">
            <option value="">全部类别</option>
            <option v-for="c in categoryOptions" :key="c" :value="c">{{ categoryText(c) }}</option>
          </select>
          <input class="mk-filter__input" v-model="keyword" placeholder="搜索名称 / ID / 类别" />
        </div>
        <span class="mk-card__meta">{{ filtered.length }} / {{ cards.length }}</span>
      </div>

      <MockSkeletonTable v-if="liveLoading && !cards.length" :cols="10" />
      <template v-else>
      <!-- 列表视图：列对齐 + 排序，问题浮顶 -->
      <div v-if="view === 'list'" class="mk-table-scroll">
        <table v-if="filtered.length" class="mk-table sk-table mk-table--fixed">
          <thead>
            <tr>
              <th style="width:200px">Skill</th>
              <th style="width:110px">所属阶段</th>
              <th style="width:80px">类别</th>
              <th style="width:80px">完成度</th>
              <th>
                <button type="button" class="sk-sort" :class="{ 'sk-sort--on': sortKey === 'calls' }" @click="toggleSort('calls')">
                  调用 {{ sortKey === 'calls' ? (sortDir === 'desc' ? '↓' : '↑') : '' }}
                </button>
              </th>
              <th>
                <button type="button" class="sk-sort" :class="{ 'sk-sort--on': sortKey === 'errors' }" @click="toggleSort('errors')">
                  失败 {{ sortKey === 'errors' ? (sortDir === 'desc' ? '↓' : '↑') : '' }}
                </button>
              </th>
              <th>成功率</th>
              <th>
                <button type="button" class="sk-sort" :class="{ 'sk-sort--on': sortKey === 'avgMs' }" @click="toggleSort('avgMs')">
                  平均耗时 {{ sortKey === 'avgMs' ? (sortDir === 'desc' ? '↓' : '↑') : '' }}
                </button>
              </th>
              <th>最近调用</th>
              <th class="mk-th--right">详情</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in shown" :key="s.id" class="sk-row" @click="openSkillDrawer(s.id)">
              <td>
                <div class="sk-cell">
                  <span class="sk-dot" :class="`sk-dot--${s.health}`" :title="s.health === 'ok' ? '健康' : s.health === 'error' ? '异常' : '空闲'"></span>
                  <div class="mk-cell-main">
                    <strong class="sk-id-main mk-ellipsis" :title="s.id">{{ s.id }}</strong>
                    <span class="sk-name-desc mk-ellipsis" :title="s.name">{{ s.name }}</span>
                  </div>
                </div>
              </td>
              <td>
                <span v-if="s.agentId" class="sk-agent-tag" :title="s.agentId">{{ s.agentName || s.agentId }}</span>
                <span v-else class="mk-na">工具类</span>
              </td>
              <td><span class="mk-badge mk-badge--muted" :title="s.category">{{ categoryText(s.category) }}</span></td>
              <td>
                <span
                  v-if="completionBadgeOf(s.id)"
                  class="mk-badge"
                  :class="completionBadgeOf(s.id)!.cls"
                  :title="completionBadgeOf(s.id)!.title"
                >{{ completionBadgeOf(s.id)!.text }}</span>
                <span v-else class="mk-na">—</span>
                <span v-if="s.errors > 0" class="mk-badge mk-badge--sm mk-badge--bad" :title="`${s.errors} 次失败`">{{ s.errors }}</span>
              </td>
              <td class="mk-num">{{ s.calls || '—' }}</td>
              <td class="mk-num" :class="{ 'sk-err': s.errors > 0 }">{{ s.calls ? s.errors : '—' }}</td>
              <td class="mk-num" :class="rateTone(s)">{{ successRate(s) }}</td>
              <td class="mk-num" :class="latencyTone(s)">{{ s.calls ? fmtMs(s.avgMs) : '—' }}</td>
              <td><span :class="{ 'mk-na': !s.calls }">{{ s.lastAt }}</span></td>
              <td><span class="sk-go">→</span></td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 网格视图：健康矩阵（保留对比） -->
      <div v-else class="sk-grid sk-grid--inset">
        <button
          v-for="s in shown"
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
      <div v-if="canMore" class="sk-more">
        <button type="button" class="mk-link" @click="loadMore">加载更多（已显示 {{ shown.length }} / {{ filtered.length }}）</button>
      </div>
    </div>

    <!-- 技能对账面板（SKILL_READINESS_SPEC §4.2）：户口簿 × manifest × 注册 × ACTIVE + 完成度
         滚动修复 #4：整卡默认折叠（details），展开后表内 10 行/页，不再把页面撑到 3.5 屏
         深链 ?recon=1[&diff=unregistered|active-missing|live]：落地自动展开并滚动定位（ADMIN_DEEP_SKILLS_APICONFIG_AUDIT §4.2） -->
    <details ref="recPanelRef" class="mk-card sk-rec" :open="recOpen">
      <summary class="mk-card__head sk-rec__summary">
        <div class="sk-rec__title">
          <strong>技能对账</strong>
          <span class="mk-card__meta">户口簿 × manifest × gateway 注册 × ACTIVE prompt</span>
          <button v-if="recDiff" type="button" class="mk-link sk-rec__clear" @click.stop="clearRecDiff">✕ 清除差集定位</button>
        </div>
        <div v-if="recLoading" class="sk-rec__loading">加载中…</div>
        <template v-else-if="recReport">
          <div class="sk-rec__pills">
            <span
              class="mk-pill"
              :title="`对账口径 = 户口簿全量 ${recReport.summary.total} 条（含外挂能力）；目录 ${cards.length} 条已排除外挂能力（mcp-tool 等）`"
            >完成度 live {{ recReport.summary.byStatus.live || 0 }} / {{ recReport.summary.total }} · 目录 {{ cards.length }}</span>
            <span v-if="recReport.summary.unregistered" class="mk-pill sk-pill--bad">未注册 {{ recReport.summary.unregistered }}</span>
            <span v-if="recReport.summary.activeMissing" class="mk-pill sk-pill--warn">缺 ACTIVE {{ recReport.summary.activeMissing }}</span>
            <span v-if="recReport.summary.orphanRegistrations" class="mk-pill sk-pill--bad">幽灵注册 {{ recReport.summary.orphanRegistrations }}</span>
            <span v-else class="mk-pill">幽灵注册 0</span>
          </div>
          <button type="button" class="sk-rec__refresh" :disabled="recLoading" @click.stop="refreshReconciliation">刷新</button>
        </template>
      </summary>

      <div v-if="recError" class="mk-empty">
        <strong>对账数据加载失败</strong>
        <span>{{ recError }}</span>
        <button type="button" class="mk-empty__action" @click="refreshReconciliation">重试</button>
      </div>
      <div v-else-if="recLoading && !recReport" class="sk-rec__skeleton">
        <span v-for="n in 8" :key="n"></span>
      </div>
      <template v-else-if="recReport">
        <div class="sk-rec-tools">
          <div class="mk-pills">
            <button type="button" class="mk-pill" :class="{ 'mk-pill--active': !recOnlyAbnormal }" @click="recOnlyAbnormal = false">全部</button>
            <button type="button" class="mk-pill" :class="{ 'mk-pill--active': recOnlyAbnormal }" @click="recOnlyAbnormal = true">仅看异常</button>
          </div>
          <span class="mk-card__meta">异常 = 未注册 / 缺 ACTIVE / 未上线（非 live）</span>
        </div>
        <div class="mk-table-scroll">
          <table v-if="recReport.items.length" class="mk-table sk-table sk-rec-table">
            <thead>
              <tr>
                <th>Skill</th>
                <th>户口簿</th>
                <th>manifest</th>
                <th>gateway 注册</th>
                <th>ACTIVE prompt</th>
                <th>完成度</th>
                <th>差集</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="(e, i) in recPageRows" :key="e.kind === 'group' ? `g-${e.group.parentAgent}-${i}` : e.row.skillId">
                <tr v-if="e.kind === 'group'" class="sk-rec-group">
                  <td colspan="7">
                    <span class="sk-rec-group__name">{{ e.group.parentAgent }}</span>
                    <span class="sk-rec-group__meta">下辖 {{ e.group.items.length }} 条</span>
                    <span class="sk-rec-group__meta">live {{ e.group.liveCount }} / {{ e.group.items.length }}</span>
                  </td>
                </tr>
                <tr v-else class="sk-row" :class="{ 'sk-rec-flash': recDiff && e.row.diff === recDiff }" @click="openSkillDrawer(e.row.skillId)">
                  <td>
                    <div class="sk-cell">
                      <span class="sk-dot" :class="`sk-dot--${recDotTone(e.row)}`" :title="recDotTone(e.row) === 'ok' ? '健康' : recDotTone(e.row) === 'error' ? '异常' : '空闲'"></span>
                      <div class="mk-cell-main">
                        <strong class="sk-id-main" :title="e.row.skillId">{{ e.row.skillId }}</strong>
                        <span class="sk-name-desc">{{ e.row.displayName || recKindText(e.row.kind) }}<template v-if="e.row.stage"> · {{ e.row.stage }}</template></span>
                      </div>
                    </div>
                  </td>
                  <td><span class="sk-rec-yn sk-rec-yn--ok">✓</span></td>
                  <td>
                    <span :class="['sk-rec-yn', e.row.manifest ? 'sk-rec-yn--ok' : 'sk-rec-yn--no']">{{ e.row.manifest ? '✓' : '✗' }}</span>
                    <span v-if="e.row.kind === 'aux' && !e.row.manifest" class="sk-rec-tag">F12 豁免</span>
                  </td>
                  <td>
                    <span :class="['sk-rec-yn', e.row.registered ? 'sk-rec-yn--ok' : 'sk-rec-yn--no']">{{ e.row.registered ? '✓' : '✗' }}</span>
                    <span v-if="e.row.registrationExempt" class="sk-rec-tag">豁免</span>
                  </td>
                  <td>
                    <span :class="['sk-rec-yn', e.row.active ? 'sk-rec-yn--ok' : 'sk-rec-yn--no']">{{ e.row.active ? '✓' : '✗' }}</span>
                    <span v-if="e.row.noPromptFile" class="sk-rec-tag">handler-only</span>
                  </td>
                  <td>
                    <span class="mk-badge" :class="`mk-badge--rec-${e.row.completion.status}`" :title="recGateDetail(e.row.completion)">
                      {{ recStatusText(e.row.completion.status) }}
                    </span>
                  </td>
                  <td>
                    <span v-if="e.row.diff === 'unregistered'" class="sk-rec-diff sk-rec-diff--bad">未注册</span>
                    <span v-else-if="e.row.diff === 'active-missing'" class="sk-rec-diff sk-rec-diff--warn">缺 ACTIVE</span>
                    <span v-else class="mk-na">—</span>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
        <div v-if="recCanMore" class="sk-rec__more">
          <button type="button" class="mk-link" @click="recLoadMore">
            加载更多对账行（已显示 {{ recShown.length }} / {{ recFlat.length }}）
          </button>
        </div>
        <div v-if="recReport.orphanRegistrations.length" class="sk-rec-orphans">
          <strong>幽灵注册残留（注册表有、户口簿无）</strong>
          <span v-for="orphan in recReport.orphanRegistrations" :key="orphan.name" class="sk-rec-tag sk-rec-tag--bad">{{ orphan.name }}</span>
        </div>
        <div class="sk-rec-legend">
          <span v-for="s in recStatusOrder" :key="s" class="sk-rec-legend__item">
            <i class="mk-badge" :class="`mk-badge--rec-${s}`"></i>{{ recStatusText(s) }}
          </span>
          <span class="mk-card__meta">户口簿口径 {{ recReport.summary.total }} 条（含外挂能力）· 目录 {{ cards.length }} 条</span>
          <span class="mk-card__meta" style="margin-left:auto">点击行进入设计页 · {{ recReport.generatedAt ? '对账于 ' + new Date(recReport.generatedAt).toLocaleString() : '' }}</span>
        </div>
      </template>
      <div v-else class="mk-empty">
        <strong>对账面板需要真实数据</strong>
        <span>请切换到「真实数据」模式后查看（户口簿/manifest/注册表/ACTIVE 为后端快照）。</span>
      </div>
    </details>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { skillProfiles, skillStatOf, openSkillDrawer, dataSource, isLive } from './store'
import { liveSkillProfiles, liveSkillStatsRange, refreshLiveSkills, liveFailures, liveLoading, errMsg } from './live'
import { categoryText } from './statusText'
import { completionMetaOf } from './glossaryMeta'
import { useLoadMore } from './useLoadMore'
import MockSkeletonTable from './SkeletonTable.vue'
import { adminSkillsApi, type SkillCompletion, type SkillReconciliationReport } from '@/api/adminApi'

type Health = 'ok' | 'idle' | 'error'
type SortKey = 'calls' | 'errors' | 'avgMs'

const onlyAttention = ref(false)
const keyword = ref('')
const categoryFilter = ref('')
const view = ref<'list' | 'grid'>('list')
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
function latencyTone(s: { calls: number; avgMs: number }) {
  if (!s.calls || !s.avgMs) return ''
  if (s.avgMs > 40000) return 'sk-lat--bad'
  if (s.avgMs > 20000) return 'sk-lat--warn'
  return ''
}
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

function toggleSort(key: SortKey) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'desc' ? 'asc' : 'desc'
  } else {
    sortKey.value = key
    sortDir.value = 'desc'
  }
}

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

const isFiltered = computed(() => onlyAttention.value || !!keyword.value.trim() || !!categoryFilter.value)
function clearFilters() {
  onlyAttention.value = false
  keyword.value = ''
  categoryFilter.value = ''
}

/* 长列表分批渲染：每批 15 行 */
const { shown, canMore, loadMore } = useLoadMore(filtered, 15)

const statusTone = computed(() => (errorCount.value ? 'mk-status--bad' : activeCount.value ? 'mk-status--ok' : 'mk-status--muted'))
const statusTitle = computed(() =>
  errorCount.value ? `${errorCount.value} 个节点存在失败` : activeCount.value ? 'Skill 网络健康' : '还没有运行数据'
)

const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`)
const successRate = (s: { calls: number; errors: number }) =>
  s.calls ? `${(((s.calls - s.errors) / s.calls) * 100).toFixed(0)}%` : '—'

/* ================= 技能对账面板（SKILL_READINESS_SPEC §4.2） ================= */
const recReport = ref<SkillReconciliationReport | null>(null)
const recLoading = ref(false)
const recError = ref('')
/** 滚动修复 #4：对账卡默认折叠（32 行分组表不再默认撑长页面） */
const recOpen = ref(false)
/** 面板内「仅看异常」切换（与目录表「仅看需关注」对称；纯前端过滤） */
const recOnlyAbnormal = ref(false)
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

function clearRecDiff() {
  recDiff.value = ''
  recOpen.value = false
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
const recStatusOrder = ['draft', 'handler-ready', 'core-ready', 'fields-synced', 'live'] as const
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

/** 对账面板按 parentAgent 分组（P2：goal-agent 下辖 N 条 节头）；无 parentAgent 归"未归属" */
const REC_AGENT_ORDER = ['goal-agent', 'path-agent', 'teaching-agent', 'profile-agent', 'simulation-agent']
type RecRow = SkillReconciliationReport['items'][number]
interface RecGroup { parentAgent: string; items: RecRow[]; liveCount: number }
type RecEntry = { kind: 'group'; group: RecGroup } | { kind: 'row'; row: RecRow }

const recGroups = computed<RecGroup[]>(() => {
  if (!recReport.value) return []
  const groups = new Map<string, RecRow[]>()
  for (const row of recReport.value.items) {
    const key = row.parentAgent || '未归属'
    const list = groups.get(key) || []
    list.push(row)
    groups.set(key, list)
  }
  const keys = [...groups.keys()].sort((a, b) => {
    const ai = REC_AGENT_ORDER.indexOf(a)
    const bi = REC_AGENT_ORDER.indexOf(b)
    const ar = ai === -1 ? REC_AGENT_ORDER.length : ai
    const br = bi === -1 ? REC_AGENT_ORDER.length : bi
    if (ar !== br) return ar - br
    return a.localeCompare(b)
  })
  return keys.map((parentAgent) => {
    const items = groups.get(parentAgent)!
    return {
      parentAgent,
      items,
      liveCount: items.filter((row) => row.completion.status === 'live').length,
    }
  })
})

/** 差集过滤：深链 ?diff= 或「仅看异常」时仅保留匹配行，组头随行过滤（空组不显示） */
function matchesRecFilter(row: RecRow): boolean {
  if (recOnlyAbnormal.value && !isRecAbnormal(row)) return false
  if (recDiff.value === 'unregistered') return row.diff === 'unregistered'
  if (recDiff.value === 'active-missing') return row.diff === 'active-missing'
  if (recDiff.value === 'live') return row.completion.status === 'live'
  return true
}

/** 「仅看异常」判定：差集非空（未注册/缺 ACTIVE）或完成度未达 live */
function isRecAbnormal(row: RecRow): boolean {
  return row.diff !== null || row.completion.status !== 'live'
}

/** 滚动修复 #4：对账行展平（组头 + 行）→ 10 行/页分页 */
const recFlat = computed<RecEntry[]>(() => {
  const out: RecEntry[] = []
  for (const g of recGroups.value) {
    const items = recDiff.value || recOnlyAbnormal.value ? g.items.filter(matchesRecFilter) : g.items
    if ((recDiff.value || recOnlyAbnormal.value) && !items.length) continue
    out.push({ kind: 'group', group: { ...g, items, liveCount: items.filter((row) => row.completion.status === 'live').length } })
    for (const row of items) out.push({ kind: 'row', row })
  }
  return out
})
const { shown: recShown, canMore: recCanMore, loadMore: recLoadMore } = useLoadMore(recFlat, 15)

/** 分页切片跨组时自动补组头（组头仅在当前页首现时渲染，重复组头 = 分页边界标识，数据不丢） */
const recPageRows = computed<RecEntry[]>(() => {
  const seen = new Set<string>()
  const out: RecEntry[] = []
  for (const e of recShown.value) {
    if (e.kind === 'group') {
      seen.add(e.group.parentAgent)
      out.push(e)
    } else {
      const key = e.row.parentAgent || '未归属'
      if (!seen.has(key)) {
        const found = recFlat.value.find((x) => x.kind === 'group' && x.group.parentAgent === key)
        const g = found?.kind === 'group' ? found.group : undefined
        if (g) {
          out.push({ kind: 'group', group: g })
          seen.add(key)
        }
      }
      out.push(e)
    }
  }
  return out
})

const recKindText = (kind: string) =>
  ({ mainline: '主线', aux: '辅助', 'handler-only': '仅 handler' })[kind] || kind

/** 行健康点：live 绿、差集红、其余灰 */
function recDotTone(row: SkillReconciliationReport['items'][number]) {
  if (row.diff === 'unregistered') return 'error'
  if (row.completion.status === 'live') return 'ok'
  return 'idle'
}

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
/* 视图切换 */
.sk-range-wrap {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--mk-muted);
  white-space: nowrap;
}
.sk-range {
  border: 1px solid var(--mk-line);
  border-radius: 8px;
  padding: 3px 8px;
  font-size: 12px;
  color: var(--mk-muted, #5a6a85);
  background: #fff;
}
/* 列表视图 */
/* 可排序表头：button 包裹表头文字，样式重置为继承 th 外观 */
.sk-sort {
  border: 0;
  background: transparent;
  padding: 0;
  font: inherit;
  color: inherit;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}
.sk-sort:hover { color: var(--mk-blue); }
.sk-sort--on { color: var(--mk-blue); }
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
.sk-more {
  display: flex;
  justify-content: center;
  padding: 10px 0 12px;
  border-top: 1px dashed var(--mk-line);
}
.sk-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.sk-dot--ok { background: var(--mk-green); }
.sk-dot--idle { background: #c3cede; }
.sk-dot--error { background: var(--mk-red); animation: sk-blink 1.2s ease infinite; }
.sk-err { color: var(--mk-red); font-weight: 700; }
/* 指标阈值着色 */
.sk-rate--bad { color: var(--mk-red); font-weight: 700; }
.sk-rate--warn { color: var(--mk-amber); font-weight: 700; }
.sk-lat--bad { color: var(--mk-red); font-weight: 700; }
.sk-lat--warn { color: var(--mk-amber); font-weight: 700; }
.sk-go { color: var(--mk-faint); font-weight: 700; }
.sk-row:hover .sk-go { color: var(--mk-blue); }

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
.sk-card__rate { display: block; width: 100%; height: 4px; border-radius: 99px; background: #eef2fa; overflow: hidden; margin-top: 2px; }
.sk-card__rate-bar { display: block; height: 100%; border-radius: 99px; background: var(--mk-green); transition: width 0.15s ease; }
.sk-card__rate-bar.is-bad { background: var(--mk-red); }

/* 所属阶段标签 */
.sk-agent-tag {
  display: inline-flex;
  align-items: center;
  padding: 2px 9px;
  border-radius: 999px;
  background: #eef2fa;
  color: #41516e;
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
  background: #eef2fa;
  color: #41516e;
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
  background: #f4f7fc;
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
  .sk-range-wrap { font-size: 13px; }
  .sk-range { font-size: 13.5px; padding: 5px 10px; }
  .sk-card__cat,
  .sk-card__flag { font-size: 12px; }
  .sk-rec__loading { font-size: 13.5px; }
  .sk-rec-diff { font-size: 12.5px; }
  .sk-rec-legend__item .mk-badge { font-size: 11.5px; }
  .sk-dot { width: 10px; height: 10px; }
}
@media (min-width: 2800px) {
  .sk-range-wrap { font-size: 15px; }
  .sk-range { font-size: 16px; padding: 6px 12px; }
  .sk-card__cat,
  .sk-card__flag { font-size: 14px; }
  .sk-rec__loading { font-size: 16px; }
  .sk-rec-diff { font-size: 15px; }
  .sk-rec-legend__item .mk-badge { font-size: 14px; }
  .sk-dot { width: 12px; height: 12px; }
}
</style>
