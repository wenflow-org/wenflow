<template>
  <div class="mk-page">
    <div class="mk-status" :class="statusTone">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">{{ statusTitle }}</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">{{ rows.length }} 位学习者</span>
      <span class="mk-status__meta">需关注 {{ riskCount }}</span>
      <span class="mk-status__meta">低置信 {{ lowConfCount }}</span>
      <button type="button" class="mk-status__action" :disabled="recomputingAll || !rows.length" @click="recomputeAll">
        {{ recomputingAll ? `重算中 ${recomputeProgress}/${rows.length}…` : '全部重算' }}
      </button>
    </div>


    <div class="mk-card">
      <div class="mk-card__head">
        <div class="mk-pills">
          <button
            v-for="p in pills"
            :key="p.id"
            type="button"
            class="mk-pill"
            :class="{ 'mk-pill--active': pill === p.id }"
            @click="pill = p.id"
          >
            {{ p.label }}
          </button>
        </div>
        <span class="mk-card__meta">先找有问题的人</span>
        <input
          v-model="keyword"
          class="mk-filter__input"
          style="width: 200px;"
          placeholder="搜索名称 / 邮箱 / ID"
        />
      </div>

      <MockSkeletonTable v-if="liveLoading && !rows.length" :cols="8" />
      <div v-else-if="loadFailed" class="mk-empty">
        <span class="mk-empty__icon" aria-hidden="true">◌</span>
        <strong>学习者快照加载失败</strong>
        <span>无法从后端拉取学习者状态。</span>
        <button type="button" class="mk-empty__action" @click="retryLoad">重试</button>
      </div>
      <div v-else-if="filtered.length" class="mk-table-scroll">
      <table class="mk-table">
        <thead>
          <tr>
            <th>学习者</th>
            <th>当前进度</th>
            <th>趋势</th>
            <th>疲劳</th>
            <th title="快照置信度：模型对该学习者状态的把握程度，低于 50% 为低置信">置信</th>
            <th>风险摘要</th>
            <th>更新</th>
            <th class="mk-th--right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in shown" :key="r.id" class="lc-row" @click="openSubPage('learner', r.id)">
            <td>
              <div class="mk-cell-main">
                <strong>{{ r.name }}</strong>
                <span class="mk-cell-sub">{{ r.email }}</span>
              </div>
              <span v-if="r.isTestAccount" class="mk-badge mk-badge--sm mk-badge--warn" title="虚拟学习者/测试账号不参与风险队列">测试账号</span>
            </td>
            <td>
              <div class="mk-cell-main">
                <strong class="progress-title">{{ r.task || '未开始' }}</strong>
                <span class="mk-cell-sub">{{ r.path || '尚未开始学习' }}</span>
              </div>
            </td>
            <td><span class="trend" :class="`trend--${r.trend}`">{{ trendText(r.trend) }}</span></td>
            <td><span class="mk-badge" :class="fatigueBadge(r.fatigue)">{{ r.fatigue }}</span></td>
            <td class="mk-num">
              <span
                v-if="r.confidence != null && r.task"
                class="conf"
                :class="{ 'conf--low': evidenceLowConfidence(r.confidence) }"
                :title="`模型对当前快照的置信度：${Math.round(r.confidence * 100)}%。低于 50% 表示证据不足，建议重算。`"
              >
                {{ Math.round(r.confidence * 100) }}%<em v-if="evidenceLowConfidence(r.confidence)" class="conf__lack">证据不足</em>
              </span>
              <span v-else class="mk-na" :title="r.task ? '' : '尚未开始学习，暂无置信度'">—</span>
            </td>
            <td class="risk-text" :class="{ 'mk-na': !r.risk }">{{ r.risk || '—' }}</td>
            <td class="mk-na">{{ isUpdating(r.id) ? '重算中…' : r.updated }}</td>
            <td>
              <div class="mk-actions">
                <button type="button" class="mk-icon-btn" title="详情" @click="openSubPage('learner', r.id)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M6 21v-1a6 6 0 0 1 12 0v1"/></svg></button>
                <button type="button" class="mk-icon-btn" :disabled="isUpdating(r.id)" :title="isUpdating(r.id) ? '重算中…' : '重算'" @click="recompute(r)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg></button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      </div>

      <div v-else class="mk-empty">
        <strong>{{ pill === 'all' ? '还没有学习者快照' : '当前分组没有人' }}</strong>
        <span>{{ pill === 'all' ? '学习轨迹累积后自动生成。' : '这是好事。' }}</span>
      </div>
      <div v-if="canMore" class="lc-more">
        <button type="button" class="mk-link" @click="loadMore">加载更多（已显示 {{ shown.length }} / {{ filtered.length }}）</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { openSubPage, isLive } from './store'
import { liveLearners, liveRecomputeLearner, liveLoading, liveFailures, loadLiveData, timeAgo, errMsg } from './live'
import { evidenceLowConfidence } from './evidence'
import { useLoadMore } from './useLoadMore'
import { askConfirm } from './useConfirm'
import { toast } from '@/utils/toast'
import MockSkeletonTable from './SkeletonTable.vue'

interface Row {
  id: string
  name: string
  email: string
  isTestAccount?: boolean
  path: string
  task: string
  trend: 'up' | 'down' | 'flat'
  fatigue: '低' | '中' | '高'
  risk: string
  updated: string
  confidence?: number
  /** 更新时间戳（用于排序），demo 按相对时间倒推 */
  ts?: number
}

const now = Date.now()
const normalRows: Row[] = [
  { id: 'l1', name: '陈晓', email: 'chenxiao@…', path: 'Excel 自动化入门', task: '阶段 2 · 数据清洗练习', trend: 'up', fatigue: '低', risk: '', updated: '6 分钟前', confidence: 0.86, ts: now - 6 * 60000 },
  { id: 'l2', name: '刘一帆', email: 'liu**@…', path: '数据分析思维', task: '阶段 1 · 提问训练', trend: 'flat', fatigue: '中', risk: '概念「采样偏差」挣扎', updated: '22 分钟前', confidence: 0.72, ts: now - 22 * 60000 },
  { id: 'l3', name: '赵敏', email: 'zhaomin@…', path: 'SQL 基础', task: '阶段 3 · JOIN 实战', trend: 'flat', fatigue: '低', risk: '', updated: '1 小时前', confidence: 0.9, ts: now - 60 * 60000 },
  { id: 'l4', name: '孙可', email: 'sunke@…', path: 'Python 入门', task: '阶段 2 · 函数', trend: 'up', fatigue: '低', risk: '', updated: '2 小时前', confidence: 0.83, ts: now - 120 * 60000 },
  { id: 'l5', name: '周洁', email: 'zhoujie@…', path: '职场英语', task: '阶段 1 · 邮件表达', trend: 'flat', fatigue: '低', risk: '', updated: '昨天 22:05', confidence: 0.68, ts: now - 20 * 3600000 },
  { id: 'l6', name: '吴迪', email: 'wudi@…', path: '', task: '', trend: 'flat', fatigue: '低', risk: '', updated: '昨天 18:40', confidence: 0.42, ts: now - 23.5 * 3600000 },
  { id: 'l7', name: '郑爽', email: 'zhengshuang@…', path: '产品经理入门', task: '阶段 2 · 需求文档', trend: 'up', fatigue: '中', risk: '连续学习 9 天，注意节奏', updated: '40 分钟前', confidence: 0.77, ts: now - 40 * 60000 },
  { id: 'l8', name: '冯远', email: 'fengyuan@…', path: '日语 N5', task: '阶段 1 · 五十音', trend: 'down', fatigue: '中', risk: '近 5 天活跃下降', updated: '3 小时前', confidence: 0.59, ts: now - 180 * 60000 }
]

const pill = ref<'all' | 'risk' | 'stale'>('all')
const keyword = ref('')

const demoRows = ref<Row[]>([...normalRows])

const rows = computed<Row[]>(() => {
  if (isLive.value) {
    return liveLearners.value.map((m) => ({
      id: m.userId,
      name: m.name,
      email: m.email,
      isTestAccount: m.isTestAccount,
      path: m.pathTitle || '',
      task: m.currentTask || m.currentMilestone || '',
      trend: m.trend,
      fatigue: m.fatigue as Row['fatigue'],
      risk: m.struggling.length
        ? `概念「${m.struggling[0]}」挣扎`
        : m.fatigue === '高'
          ? '疲劳风险高'
          : m.fragile.length
            ? `概念「${m.fragile[0]}」记忆待巩固`
            : '',
      updated: timeAgo(m.generatedAt),
      confidence: m.confidence,
      ts: m.generatedAt ? new Date(m.generatedAt).getTime() : undefined
    }))
  }
  return demoRows.value
})

const pills = [
  { id: 'all' as const, label: '全部' },
  { id: 'risk' as const, label: '需关注' },
  { id: 'stale' as const, label: '低置信' }
]

const isRisk = (r: Row) => r.trend === 'down' || r.fatigue !== '低' || !!r.risk
const riskCount = computed(() => rows.value.filter(isRisk).length)
const lowConfCount = computed(() => rows.value.filter((r) => evidenceLowConfidence(r.confidence ?? 1)).length)

const filtered = computed(() => {
  let list = rows.value
  if (pill.value === 'risk') list = rows.value.filter(isRisk)
  if (pill.value === 'stale') list = rows.value.filter((r) => evidenceLowConfidence(r.confidence ?? 1))
  // 关键词搜索
  const kw = keyword.value.trim().toLowerCase()
  if (kw) {
    list = list.filter((r) =>
      r.name?.toLowerCase().includes(kw) ||
      r.email?.toLowerCase().includes(kw) ||
      r.id?.toLowerCase().includes(kw)
    )
  }
  // 先找有问题的人：风险位优先，组内按更新时间新→旧
  return [...list].sort((a, b) => {
    const riskDiff = Number(isRisk(a)) - Number(isRisk(b))
    if (riskDiff) return -riskDiff
    return (b.ts ?? 0) - (a.ts ?? 0)
  })
})

const statusTone = computed(() => (!rows.value.length ? 'mk-status--muted' : riskCount.value > 0 ? 'mk-status--warn' : 'mk-status--ok'))
const statusTitle = computed(() => (!rows.value.length ? '还没有学习者快照' : riskCount.value > 0 ? `${riskCount.value} 位学习者需要关注` : '学习者状态平稳'))

/** live 学习者域拉取失败（且列表为空）→ 错误态；空态只在真正无数据时展示 */
const loadFailed = computed(
  () => isLive.value && !liveLoading.value && !!liveFailures.value.learners && !liveLearners.value.length
)
function retryLoad() {
  void loadLiveData()
}

/* 长列表分批渲染：每批 15 行 */
const { shown, canMore, loadMore } = useLoadMore(filtered, 15)

const trendText = (t: string) => (t === 'up' ? '↗ 上升' : t === 'down' ? '↘ 下降' : '→ 稳定')
const fatigueBadge = (f: string) => (f === '高' ? 'mk-badge--bad' : f === '中' ? 'mk-badge--warn' : 'mk-badge--ok')

/* 重算 */
const recomputingAll = ref(false)
const recomputeProgress = ref(0)
/** 行级重算中状态：独立 Set，保证模板能及时响应重渲染 */
const updatingIds = ref<Set<string>>(new Set())
const isUpdating = (id: string) => updatingIds.value.has(id)

async function recompute(row: Row) {
  if (isUpdating(row.id)) return
  updatingIds.value = new Set(updatingIds.value).add(row.id)
  try {
    if (isLive.value) {
      await liveRecomputeLearner(row.id)
      toast.success(`「${row.name}」快照已重算（真实）`)
    } else {
      await new Promise((r) => setTimeout(r, 800))
      row.updated = '刚刚'
      toast.success(`「${row.name}」快照已重算`)
    }
  } catch (e) {
    toast.error(`重算失败：${errMsg(e)}`)
  } finally {
    const next = new Set(updatingIds.value)
    next.delete(row.id)
    updatingIds.value = next
  }
}

async function recomputeAll() {
  if (recomputingAll.value || !rows.value.length) return
  const ok = await askConfirm({
    title: '全部重算快照',
    message: `确认重算全部 ${rows.value.length} 位学习者的快照？将逐个重新生成，耗时取决于人数。`,
    confirmText: '全部重算',
    danger: false
  })
  if (!ok) return
  recomputingAll.value = true
  recomputeProgress.value = 0
  if (isLive.value) {
    let ok = 0
    let fail = 0
    for (const r of rows.value) {
      updatingIds.value = new Set(updatingIds.value).add(r.id)
      try {
        await liveRecomputeLearner(r.id)
        ok++
      } catch {
        fail++
      } finally {
        const next = new Set(updatingIds.value)
        next.delete(r.id)
        updatingIds.value = next
        recomputeProgress.value++
      }
    }
    if (fail) {
      toast.error(`重算完成：${ok} 成功 · ${fail} 失败`)
    } else {
      toast.success(`已重算 ${ok} 个快照（真实）`)
    }
  } else {
    await new Promise((r) => setTimeout(r, 1200))
    demoRows.value.forEach((r) => (r.updated = '刚刚'))
    toast.success(`已重算 ${rows.value.length} 个快照`)
  }
  recomputingAll.value = false
}
</script>

<style scoped>
.lc-row { cursor: pointer; }
.trend { font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
.trend--up { color: var(--mk-green); }
.trend--down { color: var(--mk-red); }
.trend--flat { color: var(--mk-muted); }
.progress-title { font-weight: 600; }
.risk-text { color: var(--mk-amber); font-size: 12.5px; }
.conf { font-variant-numeric: tabular-nums; font-weight: 700; color: var(--mk-muted); cursor: help; }
.conf__lack { font-style: normal; font-size: 10.5px; font-weight: 700; color: var(--mk-amber); background: var(--mk-amber-bg); border-radius: 6px; padding: 1px 6px; margin-left: 6px; }
.conf--low { color: var(--mk-amber); }
.lc-tag-test {
  display: inline-block;
  margin-top: 2px;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.03em;
  background: #fef3c7;
  color: #b45309;
}
.lc-more {
  display: flex;
  justify-content: center;
  padding: 10px 0 12px;
  border-top: 1px dashed var(--mk-line);
}

@media (min-width: 2000px) {
  .risk-text { font-size: 14px; }
  .lc-more { padding: 12px 0 14px; }
}
@media (min-width: 2800px) {
  .risk-text { font-size: 16.5px; }
  .lc-more { padding: 14px 0 17px; }
}
</style>
