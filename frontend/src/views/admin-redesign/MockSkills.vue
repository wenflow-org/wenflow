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
      <div class="sk-view">
        <button type="button" class="sk-view__btn" :class="{ 'sk-view__btn--active': view === 'list' }" @click="view = 'list'">列表</button>
        <button type="button" class="sk-view__btn" :class="{ 'sk-view__btn--active': view === 'grid' }" @click="view = 'grid'">网格</button>
      </div>
    </div>

    <div class="mk-card">
      <div class="mk-card__head">
        <div class="mk-filter">
          <input class="mk-filter__input" v-model="keyword" placeholder="搜索名称 / ID / 类别" />
        </div>
        <span class="mk-card__meta">{{ filtered.length }} / {{ cards.length }}</span>
      </div>

      <!-- 列表视图：列对齐 + 排序，问题浮顶 -->
      <div v-if="view === 'list'" class="sk-scroll">
        <table v-if="filtered.length" class="mk-table sk-table">
          <thead>
            <tr>
              <th>Skill</th>
              <th>类别</th>
              <th class="sk-sort" :class="{ 'sk-sort--on': sortKey === 'calls' }" @click="toggleSort('calls')">
                调用 {{ sortKey === 'calls' ? (sortDir === 'desc' ? '↓' : '↑') : '' }}
              </th>
              <th class="sk-sort" :class="{ 'sk-sort--on': sortKey === 'errors' }" @click="toggleSort('errors')">
                失败 {{ sortKey === 'errors' ? (sortDir === 'desc' ? '↓' : '↑') : '' }}
              </th>
              <th>成功率</th>
              <th class="sk-sort" :class="{ 'sk-sort--on': sortKey === 'avgMs' }" @click="toggleSort('avgMs')">
                平均耗时 {{ sortKey === 'avgMs' ? (sortDir === 'desc' ? '↓' : '↑') : '' }}
              </th>
              <th>最近调用</th>
              <th style="text-align:right">详情</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in filtered" :key="s.id" class="sk-row" @click="openSkillDrawer(s.id)">
              <td>
                <div class="sk-cell">
                  <span class="sk-dot" :class="`sk-dot--${s.health}`"></span>
                  <div class="mk-cell-main">
                    <strong :title="s.name">{{ s.name }}</strong>
                    <span class="mk-cell-sub mono">{{ s.id }}</span>
                  </div>
                </div>
              </td>
              <td><span class="mk-badge mk-badge--muted">{{ s.category }}</span></td>
              <td class="mk-num">{{ s.calls || '—' }}</td>
              <td class="mk-num" :class="{ 'sk-err': s.errors > 0 }">{{ s.calls ? s.errors : '—' }}</td>
              <td class="mk-num">{{ successRate(s) }}</td>
              <td class="mk-num">{{ s.calls ? fmtMs(s.avgMs) : '—' }}</td>
              <td><span :class="{ 'mk-na': !s.calls }">{{ s.lastAt }}</span></td>
              <td style="text-align:right"><span class="sk-go">→</span></td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 网格视图：健康矩阵（保留对比） -->
      <div v-else class="sk-grid sk-grid--inset">
        <button
          v-for="s in filtered"
          :key="s.id"
          type="button"
          class="sk-card"
          :class="`sk-card--${s.health}`"
          @click="openSkillDrawer(s.id)"
        >
          <span class="sk-card__head">
            <span class="sk-card__dot"></span>
            <span class="sk-card__cat">{{ s.category }}</span>
            <span v-if="s.health !== 'ok'" class="sk-card__flag">{{ s.health === 'error' ? '异常' : '空闲' }}</span>
          </span>
          <strong class="sk-card__name">{{ s.name }}</strong>
          <span class="sk-card__id">{{ s.id }}</span>
          <span class="sk-card__stats">
            <span>{{ s.calls }} 调用</span>
            <span v-if="s.errors" class="sk-card__err">{{ s.errors }} 失败</span>
            <span v-else :class="{ 'mk-na': !s.calls }">{{ s.calls ? '无失败' : '—' }}</span>
          </span>
        </button>
      </div>

      <div v-if="!filtered.length" class="mk-empty">
        <strong>{{ onlyAttention ? '没有需关注的 Skill' : keyword ? '没有匹配的 Skill' : '暂无运行数据' }}</strong>
        <span v-if="onlyAttention">一切健康。</span>
        <span v-else-if="keyword">换个关键词试试。</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { skillProfiles, skillStatOf, openSkillDrawer, dataSource } from './mockStore'
import { liveSkillProfiles } from './mockLive'

type Health = 'ok' | 'idle' | 'error'
type SortKey = 'calls' | 'errors' | 'avgMs'

const onlyAttention = ref(false)
const keyword = ref('')
const view = ref<'list' | 'grid'>('list')
const sortKey = ref<SortKey>('errors')
const sortDir = ref<'asc' | 'desc'>('desc')

// 卡片数据 = 档案 + 实时统计（live 模式用真实注册表，demo 模式用演示档案）
const cards = computed(() => {
  const profiles =
    dataSource.value === 'live' && liveSkillProfiles.value.length
      ? liveSkillProfiles.value.map((p) => ({ ...p, agentId: '', agentName: '', promptVersion: '', description: '' }))
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
  if (onlyAttention.value) list = list.filter((c) => c.health !== 'ok')
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

const statusTone = computed(() => (errorCount.value ? 'mk-status--bad' : activeCount.value ? 'mk-status--ok' : 'mk-status--muted'))
const statusTitle = computed(() =>
  errorCount.value ? `${errorCount.value} 个节点存在失败` : activeCount.value ? 'Skill 网络健康' : '还没有运行数据'
)

const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`)
const successRate = (s: { calls: number; errors: number }) =>
  s.calls ? `${(((s.calls - s.errors) / s.calls) * 100).toFixed(0)}%` : '—'
</script>

<style scoped>
/* 视图切换 */
.sk-view {
  display: inline-flex;
  gap: 3px;
  padding: 2px;
  background: #eef2fa;
  border-radius: 8px;
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
.sk-scroll { max-height: 68vh; overflow-y: auto; }
.sk-table thead th {
  position: sticky;
  top: 0;
  background: var(--mk-surface);
  z-index: 1;
}
.sk-sort { cursor: pointer; user-select: none; white-space: nowrap; }
.sk-sort:hover { color: var(--mk-blue); }
.sk-sort--on { color: var(--mk-blue); }
.sk-row { cursor: pointer; }
.sk-row:hover { background: #f6f9ff; }
.sk-cell { display: flex; align-items: center; gap: 10px; }
.sk-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.sk-dot--ok { background: var(--mk-green); }
.sk-dot--idle { background: #c3cede; }
.sk-dot--error { background: var(--mk-red); animation: sk-blink 1.2s ease infinite; }
.sk-err { color: var(--mk-red); font-weight: 700; }
.sk-go { color: var(--mk-faint); font-weight: 700; }
.sk-row:hover .sk-go { color: var(--mk-blue); }
.mono { font-family: var(--mk-mono); }

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

.sk-card__name { font-size: 13.5px; font-weight: 700; }
.sk-card__id {
  font-family: var(--mk-mono);
  font-size: 11px;
  color: var(--mk-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
</style>
