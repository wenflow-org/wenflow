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
          <pre v-if="log.payload">{{ log.payload }}</pre>
          <p v-else class="tline__none">无 payload 记录</p>
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
import { computed, ref, watch } from 'vue'
import { spans, intent, openTrace, openSkillDrawer, clearInvestigation } from './mockStore'

const openId = ref('')
const statusFilter = ref('')
const agentFilter = ref('')

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

.log-body {
  border: 1px solid var(--mk-line);
  border-radius: 12px;
  background: var(--mk-surface);
  overflow: hidden;
}

.tline { border-left: 3px solid transparent; border-bottom: 1px solid #f0f2f5; }
.tline:last-child { border-bottom: none; }
.tline--ok { border-left-color: var(--mk-green); }
.tline--err { border-left-color: var(--mk-red); background: rgba(220, 38, 38, 0.04); }
.tline--warn { border-left-color: var(--mk-amber); }

.tline__main {
  display: grid;
  grid-template-columns: 44px 150px minmax(0, 1fr) 64px 92px;
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
  overflow-x: auto;
}
.tline__none { margin: 0; font-size: 11.5px; color: var(--mk-faint); }
</style>
