<template>
  <div class="mk-page">
    <div class="mk-status" :class="statusTone">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">{{ statusTitle }}</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">{{ rows.length }} 个快照</span>
      <span class="mk-status__meta">需关注 {{ riskCount }}</span>
      <span class="mk-status__meta">快照过期 {{ staleCount }}</span>
      <button type="button" class="mk-status__action" :disabled="recomputingAll" @click="recomputeAll">
        {{ recomputingAll ? '重算中…' : '全部重算' }}
      </button>
    </div>

    <div v-if="toast" class="mk-toast mk-toast--ok">✓ {{ toast }}</div>

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
      </div>

      <table v-if="filtered.length" class="mk-table">
        <thead>
          <tr>
            <th>学习者</th>
            <th>当前进度</th>
            <th>趋势</th>
            <th>疲劳</th>
            <th>风险摘要</th>
            <th>更新</th>
            <th style="text-align:right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in filtered" :key="r.id">
            <td>
              <div class="mk-cell-main">
                <strong>{{ r.name }}</strong>
                <span class="mk-cell-sub">{{ r.email }}</span>
              </div>
            </td>
            <td>
              <div class="mk-cell-main">
                <strong class="progress-title">{{ r.task || '未开始' }}</strong>
                <span class="mk-cell-sub">{{ r.path || '尚未开始学习' }}</span>
              </div>
            </td>
            <td><span class="trend" :class="`trend--${r.trend}`">{{ trendText(r.trend) }}</span></td>
            <td><span class="mk-badge" :class="fatigueBadge(r.fatigue)">{{ r.fatigue }}</span></td>
            <td class="risk-text" :class="{ 'mk-na': !r.risk }">{{ r.risk || '—' }}</td>
            <td class="mk-na">{{ r.updating ? '重算中…' : r.updated }}</td>
            <td>
              <div class="mk-actions">
                <button type="button" class="mk-link" @click="openSubPage('learner', r.id)">详情</button>
                <button type="button" class="mk-link" :disabled="r.updating" @click="recompute(r)">重算</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <div v-else class="mk-empty">
        <strong>{{ pill === 'all' ? '还没有学习者快照' : '当前分组没有人' }}</strong>
        <span>{{ pill === 'all' ? '学习轨迹累积后自动生成。' : '这是好事。' }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { openSubPage } from './mockStore'

const props = defineProps<{ state: 'normal' | 'risk' | 'empty' }>()

interface Row {
  id: string
  name: string
  email: string
  path: string
  task: string
  trend: 'up' | 'down' | 'flat'
  fatigue: '低' | '中' | '高'
  risk: string
  updated: string
  updating?: boolean
}

const normalRows: Row[] = [
  { id: 'l1', name: '陈晓', email: 'chenxiao@…', path: 'Excel 自动化入门', task: '阶段 2 · 数据清洗练习', trend: 'up', fatigue: '低', risk: '', updated: '6 分钟前' },
  { id: 'l2', name: '刘一帆', email: 'liu**@…', path: '数据分析思维', task: '阶段 1 · 提问训练', trend: 'flat', fatigue: '低', risk: '概念「采样偏差」挣扎', updated: '22 分钟前' },
  { id: 'l3', name: '赵敏', email: 'zhaomin@…', path: 'SQL 基础', task: '阶段 3 · JOIN 实战', trend: 'flat', fatigue: '低', risk: '', updated: '1 小时前' },
  { id: 'l4', name: '孙可', email: 'sunke@…', path: 'Python 入门', task: '阶段 2 · 函数', trend: 'up', fatigue: '低', risk: '', updated: '2 小时前' },
  { id: 'l5', name: '周洁', email: 'zhoujie@…', path: '职场英语', task: '阶段 1 · 邮件表达', trend: 'flat', fatigue: '低', risk: '', updated: '昨天 22:05' },
  { id: 'l6', name: '吴迪', email: 'wudi@…', path: '', task: '', trend: 'flat', fatigue: '低', risk: '', updated: '昨天 18:40' }
]

const riskRows: Row[] = [
  { id: 'l3', name: '赵敏', email: 'zhaomin@…', path: 'SQL 基础', task: '阶段 3 · JOIN 实战', trend: 'down', fatigue: '高', risk: '连续 3 次任务失败', updated: '4 分钟前' },
  { id: 'l4', name: '孙可', email: 'sunke@…', path: 'Python 入门', task: '阶段 2 · 函数', trend: 'down', fatigue: '中', risk: '近 7 天活跃下降 60%', updated: '13 分钟前' },
  { id: 'l1', name: '陈晓', email: 'chenxiao@…', path: 'Excel 自动化入门', task: '阶段 2 · 数据清洗练习', trend: 'up', fatigue: '低', risk: '', updated: '6 分钟前' },
  { id: 'l2', name: '刘一帆', email: 'liu**@…', path: '数据分析思维', task: '阶段 1 · 提问训练', trend: 'flat', fatigue: '低', risk: '概念「采样偏差」挣扎', updated: '22 分钟前' }
]

const rows = ref<Row[]>([])
watch(
  () => props.state,
  (s) => {
    rows.value = s === 'risk' ? riskRows : s === 'empty' ? [] : normalRows
    pill.value = s === 'risk' ? 'risk' : 'all'
  },
  { immediate: true }
)

const pill = ref<'all' | 'risk' | 'stale'>('all')
const pills = [
  { id: 'all' as const, label: '全部' },
  { id: 'risk' as const, label: '需关注' },
  { id: 'stale' as const, label: '快照过期' }
]

const isRisk = (r: Row) => r.trend === 'down' || r.fatigue !== '低' || !!r.risk
const riskCount = computed(() => rows.value.filter(isRisk).length)
const staleCount = computed(() => rows.value.filter((r) => r.updated.includes('小时')).length)

const filtered = computed(() => {
  if (pill.value === 'risk') return rows.value.filter(isRisk)
  if (pill.value === 'stale') return rows.value.filter((r) => r.updated.includes('小时'))
  return rows.value
})

const statusTone = computed(() => (!rows.value.length ? 'mk-status--muted' : riskCount.value > 0 ? 'mk-status--warn' : 'mk-status--ok'))
const statusTitle = computed(() => (!rows.value.length ? '还没有学习者快照' : riskCount.value > 0 ? `${riskCount.value} 位学习者需要关注` : '学习者状态平稳'))

const trendText = (t: string) => (t === 'up' ? '↗ 上升' : t === 'down' ? '↘ 下降' : '→ 稳定')
const fatigueBadge = (f: string) => (f === '高' ? 'mk-badge--bad' : f === '中' ? 'mk-badge--warn' : 'mk-badge--ok')

/* 重算：真实状态反馈 */
const toast = ref('')
const recomputingAll = ref(false)
let toastTimer: ReturnType<typeof setTimeout> | null = null

function showToast(msg: string) {
  toast.value = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 2600)
}

function recompute(row: Row) {
  if (row.updating) return
  row.updating = true
  setTimeout(() => {
    row.updating = false
    row.updated = '刚刚'
    showToast(`「${row.name}」快照已重算`)
  }, 800)
}

function recomputeAll() {
  if (recomputingAll.value || !rows.value.length) return
  recomputingAll.value = true
  rows.value.forEach((r) => (r.updating = true))
  setTimeout(() => {
    rows.value.forEach((r) => {
      r.updating = false
      r.updated = '刚刚'
    })
    recomputingAll.value = false
    showToast(`已重算 ${rows.value.length} 个快照`)
  }, 1200)
}
</script>

<style scoped>
.trend { font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
.trend--up { color: var(--mk-green); }
.trend--down { color: var(--mk-red); }
.trend--flat { color: var(--mk-muted); }
.progress-title { font-weight: 600; }
.risk-text { color: var(--mk-amber); font-size: 12.5px; }
</style>
