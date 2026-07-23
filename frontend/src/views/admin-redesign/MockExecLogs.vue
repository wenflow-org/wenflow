<template>
  <div class="mk-page">
    <!-- 终端状态条 -->
    <div class="log-status" :class="`log-status--${statusTone}`">
      <span class="log-status__dot"></span>
      <strong>{{ statusTitle }}</strong>
      <span class="log-status__sep"></span>
      <span class="log-status__meta mono">{{ filtered.length }} / {{ logs.length }} 行</span>
      <span v-if="isFiltered" class="log-status__filter">
        排查中：{{ intent.agentFilter }} · {{ intent.statusFilter === 'err' ? '仅失败' : '' }}
        <button type="button" class="log-status__clear" @click="clearFilter">×</button>
      </span>
      <div class="log-status__filters">
        <div class="mk-pills">
          <button
            v-for="p in statusPills"
            :key="p.id"
            type="button"
            class="mk-pill"
            :class="{ 'mk-pill--active': statusFilter === p.id }"
            @click="statusFilter = statusFilter === p.id ? '' : p.id"
          >
            {{ p.label }}
          </button>
        </div>
        <select v-model="agentFilter" class="log-agent mono">
          <option value="">全部节点</option>
          <option v-for="a in agentOptions" :key="a" :value="a">{{ a }}</option>
        </select>
        <select v-if="isLive" v-model="timeRange" class="log-agent" @change="applyServerQuery">
          <option value="today">今天</option>
          <option value="yesterday">昨天</option>
          <option value="week">近 7 天</option>
          <option value="month">近 30 天</option>
          <option value="all">全部</option>
        </select>
        <input
          v-if="isLive"
          v-model="keyword"
          class="log-keyword"
          placeholder="关键词，回车查询"
          @keydown.enter="applyServerQuery"
        />
        <label v-if="isLive" class="log-auto">
          <input type="checkbox" v-model="autoRefresh" />
          自动刷新
        </label>
        <button v-if="isLive" type="button" class="mk-link" @click="exportJson">导出</button>
      </div>
    </div>

    <!-- 日志流 -->
    <div v-if="filtered.length" class="log-body" role="log">
      <div
        v-for="log in filtered"
        :key="log.id"
        class="tline"
        :class="[`tline--${log.status}`, { 'tline--open': openId === log.id }]"
      >
        <button type="button" class="tline__main" @click="openId = openId === log.id ? '' : log.id">
          <span class="tline__kind">{{ log.kind === 'flow' ? '流程' : '调用' }}</span>
          <span class="tline__agent mono" @click.stop="openSkillDrawer(log.agent)">{{ log.agent }}</span>
          <span class="tline__msg">{{ log.title }}<em>{{ log.detail }}</em></span>
          <span class="tline__dur mono">{{ fmtMs(log.durationMs) }}</span>
          <span class="tline__trace mono" @click.stop="openTrace(log.traceId)">{{ log.traceId }}</span>
        </button>
        <div v-if="openId === log.id" class="tline__payload">
          <div class="tline__payload-meta">
            <span>trace {{ log.traceId }}</span>
            <button type="button" class="mk-link" @click.stop="openTrace(log.traceId)">在瀑布中查看完整链路 →</button>
          </div>
          <template v-if="isLive">
            <p v-if="detailLoading === log.id" class="tline__none">拉取日志详情…</p>
            <template v-else-if="detailCache[log.id]">
              <!-- 重试时间线：网关升级后的逐次尝试遥测 -->
              <div v-if="detailCache[log.id].attempts.length" class="tline__section">
                <span class="tline__label">调用时间线{{ detailCache[log.id].attemptCount > 1 ? ` · 共 ${detailCache[log.id].attemptCount}/${detailCache[log.id].maxAttempts} 次尝试` : '' }}</span>
                <div class="tline-attempts">
                  <div
                    v-for="(a, i) in detailCache[log.id].attempts"
                    :key="i"
                    class="tline-attempt"
                    :class="{ 'tline-attempt--fail': !a.success, 'tline-attempt--retry': a.willRetry }"
                  >
                    <div class="tline-attempt__head">
                      <span class="tline-attempt__no">P#{{ a.promptAttemptNo }} · N#{{ a.transportAttemptNo }}</span>
                      <span class="mk-badge" :class="a.success ? 'mk-badge--ok' : 'mk-badge--bad'">{{ a.success ? '成功' : '失败' }}</span>
                      <span v-if="a.willRetry" class="tline-attempt__retry">将在 {{ a.backoffMs ?? '—' }}ms 后自动重试</span>
                      <span class="tline-attempt__dur mono">{{ fmtMs(a.durationMs) }}</span>
                    </div>
                    <div class="tline-attempt__meta mono">
                      <span>{{ a.provider || 'provider?' }}</span>
                      <span>{{ a.model || 'model?' }}</span>
                      <span v-if="a.statusCode">HTTP {{ a.statusCode }}</span>
                      <span v-if="a.promptTokens != null">P {{ a.promptTokens }} / C {{ a.completionTokens ?? 0 }}</span>
                      <span v-if="a.routeSource">路由 {{ a.routeSource }}</span>
                      <span v-if="a.endpointHost">{{ a.endpointHost }}</span>
                    </div>
                    <p v-if="a.errorMessage" class="tline-attempt__err">{{ a.errorCategory ? `[${a.errorCategory}] ` : '' }}{{ a.errorCode ? `${a.errorCode} · ` : '' }}{{ a.errorMessage }}</p>
                  </div>
                </div>
              </div>
              <div v-if="detailCache[log.id].error" class="tline__section">
                <span class="tline__label tline__label--err">错误</span>
                <pre>{{ detailCache[log.id].error }}</pre>
              </div>
              <div v-if="detailCache[log.id].input" class="tline__section">
                <span class="tline__label">输入</span>
                <pre>{{ detailCache[log.id].input }}</pre>
              </div>
              <div v-if="detailCache[log.id].output" class="tline__section">
                <span class="tline__label">输出</span>
                <pre>{{ detailCache[log.id].output }}</pre>
              </div>
              <p v-if="!detailCache[log.id].attempts.length && !detailCache[log.id].error && !detailCache[log.id].input && !detailCache[log.id].output" class="tline__none">无 payload 记录</p>
            </template>
            <p v-else class="tline__none">详情不可用</p>
          </template>
          <template v-else>
            <pre v-if="log.payload">{{ log.payload }}</pre>
            <p v-else class="tline__none">无 payload 记录</p>
          </template>
        </div>
      </div>
    </div>

    <div v-else class="mk-empty">
      <strong>{{ isFiltered ? '当前筛选无日志' : '暂无日志' }}</strong>
      <span>{{ isFiltered ? '放宽筛选条件。' : '有真实调用后出现在这里。' }}</span>
      <button v-if="isFiltered" type="button" class="mk-link" @click="clearFilter">清除筛选</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { spans, intent, openTrace, openSkillDrawer, clearInvestigation, dataSource } from './mockStore'
import { fetchLogDetail, reloadLiveSpans, type LogDetail } from './mockLive'

const openId = ref('')
const statusFilter = ref('')
const agentFilter = ref('')
const timeRange = ref<'today' | 'yesterday' | 'week' | 'month' | 'all'>('week')
const keyword = ref('')
const autoRefresh = ref(false)
const isLive = computed(() => dataSource.value === 'live')

/* live 模式：服务端筛选（时间范围/关键词） */
let querying = false
async function applyServerQuery() {
  if (!isLive.value || querying) return
  querying = true
  try {
    await reloadLiveSpans({
      timeRange: timeRange.value,
      keyword: keyword.value.trim() || undefined
    })
  } finally {
    querying = false
  }
}

/* 自动刷新：10s 间隔，离开页面清除 */
let autoTimer: ReturnType<typeof setInterval> | null = null
watch(autoRefresh, (on) => {
  if (autoTimer) {
    clearInterval(autoTimer)
    autoTimer = null
  }
  if (on && isLive.value) {
    autoTimer = setInterval(() => {
      if (document.hidden) return
      void applyServerQuery()
    }, 10000)
  }
})
onBeforeUnmount(() => {
  if (autoTimer) clearInterval(autoTimer)
})

/* 导出当前筛选结果为 JSON */
function exportJson() {
  const blob = new Blob([JSON.stringify(filtered.value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `execution-logs-${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
}

/* live 模式：展开行时拉真实 input/output + 重试时间线 */
const detailCache = ref<Record<string, LogDetail>>({})
const detailLoading = ref('')

watch(openId, async (id) => {
  if (!id || !isLive.value || detailCache.value[id]) return
  detailLoading.value = id
  try {
    const d = await fetchLogDetail(id)
    detailCache.value = { ...detailCache.value, [id]: d }
  } catch {
    detailCache.value = { ...detailCache.value, [id]: { attempts: [], attemptCount: 0, maxAttempts: 1 } }
  } finally {
    if (detailLoading.value === id) detailLoading.value = ''
  }
})

// 从排查意图进入时应用过滤
watch(
  () => [intent.agentFilter, intent.statusFilter],
  () => {
    agentFilter.value = intent.agentFilter
    statusFilter.value = intent.statusFilter
  },
  { immediate: true }
)

const logs = computed(() => spans.value)
const agentOptions = computed(() => [...new Set(spans.value.map((s) => s.agent))].sort())

const filtered = computed(() =>
  logs.value.filter((l) => {
    if (agentFilter.value && l.agent !== agentFilter.value) return false
    if (statusFilter.value && l.status !== statusFilter.value) return false
    return true
  })
)

const isFiltered = computed(() => !!(agentFilter.value || statusFilter.value))
const errCount = computed(() => logs.value.filter((l) => l.status === 'err').length)
const statusTone = computed(() => (!logs.value.length ? 'muted' : errCount.value ? 'bad' : 'ok'))
const statusTitle = computed(() => {
  if (!logs.value.length) return '暂无日志'
  if (errCount.value) return `执行日志 · ${errCount.value} 次失败`
  return '执行日志 · 运行平稳'
})

const statusPills = [
  { id: 'err', label: '失败' },
  { id: 'warn', label: '降级' },
  { id: 'ok', label: '成功' }
]

function clearFilter() {
  agentFilter.value = ''
  statusFilter.value = ''
  clearInvestigation()
}

const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`)
</script>

<style scoped>
.log-status {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-radius: 12px;
  border: 1px solid var(--mk-line);
  background: var(--mk-surface);
  flex-wrap: wrap;
}
.log-status__dot { width: 9px; height: 9px; border-radius: 50%; }
.log-status--ok .log-status__dot { background: var(--mk-green); }
.log-status--bad .log-status__dot { background: var(--mk-red); }
.log-status--muted .log-status__dot { background: var(--mk-faint); }
.log-status strong { font-size: 14px; }
.log-status__sep { width: 1px; height: 14px; background: var(--mk-line); }
.log-status__meta { color: var(--mk-muted); font-size: 12px; }
.mono { font-family: var(--mk-mono); }

.log-status__filter {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--mk-red-bg);
  color: var(--mk-red);
  font-size: 11.5px;
  font-weight: 700;
}
.log-status__clear {
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 13px;
  padding: 0 2px;
}

.log-status__filters {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}
.log-agent {
  padding: 6px 10px;
  border: 1px solid var(--mk-line);
  border-radius: 8px;
  background: var(--mk-surface);
  font-size: 11.5px;
  color: var(--mk-ink);
}
.log-keyword {
  padding: 6px 10px;
  border: 1px solid var(--mk-line);
  border-radius: 8px;
  background: var(--mk-surface);
  font: inherit;
  font-size: 11.5px;
  color: var(--mk-ink);
  width: 150px;
}
.log-auto {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  color: var(--mk-muted);
  cursor: pointer;
  white-space: nowrap;
}

.log-body {
  border: 1px solid var(--mk-line);
  border-radius: 12px;
  background: var(--mk-surface);
  overflow-y: auto;
  max-height: 72vh;
}

.tline { border-left: 3px solid transparent; border-bottom: 1px solid #f0f2f5; }
.tline:last-child { border-bottom: none; }
.tline--ok { border-left-color: var(--mk-green); }
.tline--err { border-left-color: var(--mk-red); background: rgba(220, 38, 38, 0.04); }
.tline--warn { border-left-color: var(--mk-amber); }

.tline__main {
  display: grid;
  grid-template-columns: 44px 176px minmax(0, 1fr) 64px 92px;
  gap: 10px;
  align-items: baseline;
  width: 100%;
  padding: 9px 14px;
  border: 0;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.tline__main:hover { background: #f6f9ff; }

.tline__kind {
  font-size: 10px;
  font-weight: 800;
  color: var(--mk-faint);
}
.tline__agent {
  font-size: 11px;
  color: var(--mk-blue);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tline__agent:hover { text-decoration: underline; }
.tline__msg {
  font-size: 12.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tline__msg em { font-style: normal; color: var(--mk-faint); margin-left: 8px; font-size: 11.5px; }
.tline__dur { font-size: 11px; color: var(--mk-muted); text-align: right; }
.tline__trace { font-size: 11px; color: #b45309; text-align: right; }
.tline__trace:hover { text-decoration: underline; }

.tline__payload { padding: 2px 14px 12px 68px; display: grid; gap: 8px; }
.tline__payload-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: var(--mk-faint);
  font-family: var(--mk-mono);
}
.tline__payload pre {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: #0d1420;
  color: #8ba3c7;
  font: 11px/1.6 'JetBrains Mono', monospace;
  overflow: auto;
  max-height: 240px;
  white-space: pre-wrap;
  word-break: break-all;
}
.tline__none { margin: 0; font-size: 11.5px; color: var(--mk-faint); }
.tline__section { display: grid; gap: 4px; }
.tline__label { font-size: 10.5px; font-weight: 800; letter-spacing: 0.06em; color: var(--mk-faint); }
.tline__label--err { color: var(--mk-red); }

/* 重试时间线 */
.tline-attempts { display: grid; gap: 6px; }
.tline-attempt {
  border: 1px solid var(--mk-line);
  border-left: 3px solid var(--mk-green);
  border-radius: 8px;
  padding: 8px 10px;
  display: grid;
  gap: 4px;
  background: #fff;
}
.tline-attempt--fail { border-left-color: var(--mk-red); background: #fffafa; }
.tline-attempt--retry { border-left-color: var(--mk-amber); }
.tline-attempt__head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.tline-attempt__no { font-family: var(--mk-mono); font-size: 10.5px; font-weight: 800; color: var(--mk-muted); }
.tline-attempt__retry { font-size: 10.5px; font-weight: 700; color: var(--mk-amber); }
.tline-attempt__dur { margin-left: auto; font-size: 10.5px; color: var(--mk-faint); }
.tline-attempt__meta { display: flex; gap: 10px; flex-wrap: wrap; font-size: 10px; color: var(--mk-faint); }
.tline-attempt__err { margin: 0; font-size: 11px; color: var(--mk-red); word-break: break-all; }
</style>
