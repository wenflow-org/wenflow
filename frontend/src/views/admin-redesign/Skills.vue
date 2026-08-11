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
      <div class="sk-view">
        <button type="button" class="sk-view__btn" :class="{ 'sk-view__btn--active': view === 'list' }" @click="view = 'list'">列表</button>
        <button type="button" class="sk-view__btn" :class="{ 'sk-view__btn--active': view === 'grid' }" @click="view = 'grid'">网格</button>
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

      <MockSkeletonTable v-if="liveLoading && !cards.length" :cols="9" />
      <template v-else>
      <!-- 列表视图：列对齐 + 排序，问题浮顶 -->
      <div v-if="view === 'list'" class="mk-table-scroll">
        <table v-if="filtered.length" class="mk-table sk-table">
          <thead>
            <tr>
              <th>Skill</th>
              <th>所属阶段</th>
              <th>类别</th>
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
                  <span class="sk-dot" :class="`sk-dot--${s.health}`"></span>
                  <div class="mk-cell-main">
                    <strong class="sk-id-main" :title="s.name">{{ s.id }}</strong>
                    <span class="sk-name-desc" :title="s.name">{{ s.name }}</span>
                  </div>
                </div>
              </td>
              <td>
                <span v-if="s.agentId" class="sk-agent-tag" :title="s.agentId">{{ s.agentName || s.agentId }}</span>
                <span v-else class="mk-na">工具类</span>
              </td>
              <td><span class="mk-badge mk-badge--muted" :title="s.category">{{ categoryText(s.category) }}</span></td>
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
      </div>
      </template>
      <div v-if="canMore" class="sk-more">
        <button type="button" class="mk-link" @click="loadMore">加载更多（已显示 {{ shown.length }} / {{ filtered.length }}）</button>
      </div>
    </div>

    <!-- 技能对账面板（SKILL_READINESS_SPEC §4.2）：户口簿 × manifest × 注册 × ACTIVE + 完成度 -->
    <div class="mk-card sk-rec">
      <div class="mk-card__head">
        <div class="sk-rec__title">
          <strong>技能对账</strong>
          <span class="mk-card__meta">户口簿 × manifest × gateway 注册 × ACTIVE prompt</span>
        </div>
        <div v-if="recLoading" class="sk-rec__loading">加载中…</div>
        <template v-else-if="recReport">
          <div class="sk-rec__pills">
            <span class="mk-pill">完成度 live {{ recReport.summary.byStatus.live || 0 }} / {{ recReport.summary.total }}</span>
            <span v-if="recReport.summary.unregistered" class="mk-pill sk-pill--bad">未注册 {{ recReport.summary.unregistered }}</span>
            <span v-if="recReport.summary.activeMissing" class="mk-pill sk-pill--warn">缺 ACTIVE {{ recReport.summary.activeMissing }}</span>
            <span v-if="recReport.summary.orphanRegistrations" class="mk-pill sk-pill--bad">幽灵注册 {{ recReport.summary.orphanRegistrations }}</span>
            <span v-else class="mk-pill">幽灵注册 0</span>
          </div>
          <button type="button" class="sk-rec__refresh" :disabled="recLoading" @click="refreshReconciliation">刷新</button>
        </template>
      </div>

      <div v-if="recError" class="mk-empty">
        <strong>对账数据加载失败</strong>
        <span>{{ recError }}</span>
        <button type="button" class="mk-empty__action" @click="refreshReconciliation">重试</button>
      </div>
      <div v-else-if="recLoading && !recReport" class="sk-rec__skeleton">
        <span v-for="n in 8" :key="n"></span>
      </div>
      <template v-else-if="recReport">
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
              <tr v-for="row in recReport.items" :key="row.skillId" class="sk-row" @click="openSkillDrawer(row.skillId)">
                <td>
                  <div class="sk-cell">
                    <span class="sk-dot" :class="`sk-dot--${recDotTone(row)}`"></span>
                    <div class="mk-cell-main">
                      <strong class="sk-id-main" style="max-width:340px">{{ row.skillId }}</strong>
                      <span class="sk-name-desc" style="max-width:340px">{{ row.displayName || recKindText(row.kind) }}<template v-if="row.stage"> · {{ row.stage }}</template></span>
                    </div>
                  </div>
                </td>
                <td><span class="sk-rec-yn sk-rec-yn--ok">✓</span></td>
                <td>
                  <span :class="['sk-rec-yn', row.manifest ? 'sk-rec-yn--ok' : 'sk-rec-yn--no']">{{ row.manifest ? '✓' : '✗' }}</span>
                  <span v-if="row.kind === 'aux' && !row.manifest" class="sk-rec-tag">F12 豁免</span>
                </td>
                <td>
                  <span :class="['sk-rec-yn', row.registered ? 'sk-rec-yn--ok' : 'sk-rec-yn--no']">{{ row.registered ? '✓' : '✗' }}</span>
                  <span v-if="row.registrationExempt" class="sk-rec-tag">豁免</span>
                </td>
                <td>
                  <span :class="['sk-rec-yn', row.active ? 'sk-rec-yn--ok' : 'sk-rec-yn--no']">{{ row.active ? '✓' : '✗' }}</span>
                  <span v-if="row.noPromptFile" class="sk-rec-tag">handler-only</span>
                </td>
                <td>
                  <span class="sk-rec-badge" :class="`sk-rec-badge--${row.completion.status}`" :title="recGateDetail(row.completion)">
                    {{ recStatusText(row.completion.status) }}
                  </span>
                </td>
                <td>
                  <span v-if="row.diff === 'unregistered'" class="sk-rec-diff sk-rec-diff--bad">未注册</span>
                  <span v-else-if="row.diff === 'active-missing'" class="sk-rec-diff sk-rec-diff--warn">缺 ACTIVE</span>
                  <span v-else class="mk-na">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="recReport.orphanRegistrations.length" class="sk-rec-orphans">
          <strong>幽灵注册残留（注册表有、户口簿无）</strong>
          <span v-for="orphan in recReport.orphanRegistrations" :key="orphan.name" class="sk-rec-tag sk-rec-tag--bad">{{ orphan.name }}</span>
        </div>
        <div class="sk-rec-legend">
          <span v-for="s in recStatusOrder" :key="s" class="sk-rec-legend__item">
            <i class="sk-rec-badge" :class="`sk-rec-badge--${s}`"></i>{{ recStatusText(s) }}
          </span>
          <span class="mk-card__meta" style="margin-left:auto">点击行进入设计页 · {{ recReport.generatedAt ? '对账于 ' + new Date(recReport.generatedAt).toLocaleString() : '' }}</span>
        </div>
      </template>
      <div v-else class="mk-empty">
        <strong>对账面板需要真实数据</strong>
        <span>请切换到「真实数据」模式后查看（户口簿/manifest/注册表/ACTIVE 为后端快照）。</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
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
  if (isLive.value) refreshReconciliation()
})

/** 完成度五档色标（draft → live）；文案单源：glossaryMeta.ts（与后端 glossary-content 对齐） */
const recStatusOrder = ['draft', 'handler-ready', 'core-ready', 'fields-synced', 'live'] as const
const recStatusText = (status: string) =>
  completionMetaOf(status)?.label || status

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
.sk-view {
  display: inline-flex;
  gap: 3px;
  padding: 2px;
  background: #eef2fa;
  border-radius: 10px;
}
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
.sk-view__btn {
  border: 0;
  background: transparent;
  padding: 4px 10px;
  border-radius: 6px;
  font: inherit;
  font-size: 11.5px;
  font-weight: 700;
  color: var(--mk-muted);
  cursor: pointer;
}
.sk-view__btn--active { background: #fff; color: var(--mk-ink); box-shadow: 0 1px 2px rgba(23, 32, 51, 0.1); }

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
/* 英文原名（id）主行：等宽突出；中文描述副行：灰色正文（非 mono） */
.sk-id-main {
  font-family: var(--mk-mono);
  font-weight: 700;
  max-width: 460px;
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
  max-width: 460px;
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
  padding: 13px 14px;
  border-radius: 12px;
  border: 1px solid var(--mk-line);
  background: var(--mk-surface);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: 0.14s ease;
}
.sk-card:hover { border-color: rgba(52, 120, 246, 0.35); transform: translateY(-1px); }
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
  background: var(--mk-blue, #3478f6);
  margin-right: 6px;
  flex-shrink: 0;
}

/* ================= 技能对账面板（SKILL_READINESS_SPEC §4.2） ================= */
.sk-rec { margin-top: 14px; }
.sk-rec__title { display: flex; flex-direction: column; gap: 2px; }
.sk-rec__title strong { font-size: 14px; }
.sk-rec__loading { color: var(--mk-faint); font-size: 12px; margin-left: auto; }
.sk-rec__pills { display: inline-flex; gap: 6px; margin-left: auto; flex-wrap: wrap; }
.sk-pill--bad { color: var(--mk-red, #dc2626); background: #fdecec; }
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
.sk-rec__refresh:hover { border-color: rgba(52, 120, 246, 0.4); color: var(--mk-blue); }
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
.sk-rec-tag--bad { background: #fdecec; color: var(--mk-red, #dc2626); }

/* 完成度五档色标：draft → live */
.sk-rec-badge {
  display: inline-block;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
  color: #fff;
}
.sk-rec-badge--draft { background: #9aa4b2; }
.sk-rec-badge--handler-ready { background: #d97706; }
.sk-rec-badge--core-ready { background: #3478f6; }
.sk-rec-badge--fields-synced { background: #0d9488; }
.sk-rec-badge--live { background: #16a34a; }

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
.sk-rec-legend__item .sk-rec-badge { padding: 2px 8px; font-size: 10px; }
</style>
