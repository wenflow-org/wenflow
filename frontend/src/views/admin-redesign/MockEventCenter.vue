<template>
  <div class="mk-page">
    <div class="mk-status" :class="events.length ? 'mk-status--ok' : 'mk-status--muted'">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">{{ events.length ? '事件流正常' : '暂无事件' }}</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">流程 {{ flowCount }}</span>
      <span class="mk-status__meta">调用 {{ callCount }}</span>
      <input class="mk-filter__input" style="margin-left:auto" v-model="trace" placeholder="粘贴 Trace ID 跨两类事件联查" />
    </div>

    <!-- 事件类型 tab -->
    <div class="ec-tabs">
      <button
        type="button"
        class="ec-tab"
        :class="{ 'ec-tab--active': tab === 'flow' }"
        @click="tab = 'flow'"
      >
        流程事件 <b>{{ flowCount }}</b>
      </button>
      <button
        type="button"
        class="ec-tab"
        :class="{ 'ec-tab--active': tab === 'call' }"
        @click="tab = 'call'"
      >
        Prompt 调用 <b>{{ callCount }}</b>
      </button>
    </div>

    <div v-if="filtered.length" class="ec-timeline">
      <div v-for="(e, i) in filtered" :key="i" class="ec-row" :class="{ 'ec-row--hit': trace && e.trace.includes(trace) }">
        <span class="ec-row__dot" :class="`ec-row__dot--${e.tone}`"></span>
        <span class="ec-row__time mono">{{ e.time }}</span>
        <span class="ec-row__stage">{{ e.stage }}</span>
        <div class="ec-row__main">
          <strong>{{ e.title }}</strong>
          <span>{{ e.detail }}</span>
        </div>
        <span class="mk-badge" :class="e.statusCls">{{ e.status }}</span>
        <span class="ec-row__trace mono">{{ e.trace }}</span>
      </div>
    </div>

    <div v-else class="mk-empty">
      <strong>{{ trace ? `Trace ${trace} 没有匹配事件` : '暂无事件' }}</strong>
      <span>{{ trace ? '检查 ID 是否完整，或清除后浏览全部。' : '路径生成与 Prompt 调用发生后出现在这里。' }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = defineProps<{ state: 'normal' | 'empty' }>()

interface Ev {
  kind: 'flow' | 'call'
  time: string
  stage: string
  title: string
  detail: string
  status: string
  statusCls: string
  trace: string
  tone: 'ok' | 'warn' | 'bad'
}

const all: Ev[] = [
  { kind: 'flow', time: '16:42:07', stage: '阶段任务设计', title: '路径生成完成', detail: '4 阶段 · 18 任务 · 用时 42s', status: '成功', statusCls: 'mk-badge--ok', trace: 'tr:8f31a2', tone: 'ok' },
  { kind: 'call', time: '16:41:58', stage: 'stage-designer', title: 'Prompt 调用', detail: 'deepseek-v4-pro · 3.2s · P 1180 / C 642', status: '成功', statusCls: 'mk-badge--ok', trace: 'tr:8f31a2', tone: 'ok' },
  { kind: 'flow', time: '16:41:31', stage: '核心路径生成', title: '路径草稿就绪', detail: '学习者基础：零基础 · 每周 4 小时', status: '成功', statusCls: 'mk-badge--ok', trace: 'tr:8f31a2', tone: 'ok' },
  { kind: 'call', time: '16:40:55', stage: 'generic-planner', title: 'Prompt 调用', detail: 'deepseek-v4-pro · 5.1s · P 2040 / C 1130', status: '成功', statusCls: 'mk-badge--ok', trace: 'tr:8f31a2', tone: 'ok' },
  { kind: 'call', time: '16:38:12', stage: 'teaching-round', title: 'Prompt 调用', detail: 'deepseek-v4-flash · 1.1s · P 860 / C 204', status: '漂移', statusCls: 'mk-badge--warn', trace: 'tr:8f319b', tone: 'warn' },
  { kind: 'flow', time: '16:35:40', stage: '核心路径生成', title: '路径生成失败', detail: '上游超时 30s · 已回退重试', status: '失败', statusCls: 'mk-badge--bad', trace: 'tr:8f318f', tone: 'bad' },
  { kind: 'call', time: '16:35:10', stage: 'generic-planner', title: 'Prompt 调用', detail: 'deepseek-v4-pro · 30.0s · 超时', status: '失败', statusCls: 'mk-badge--bad', trace: 'tr:8f318f', tone: 'bad' }
]

const events = ref<Ev[]>([])
watch(
  () => props.state,
  (s) => {
    events.value = s === 'empty' ? [] : all
  },
  { immediate: true }
)

const tab = ref<'flow' | 'call'>('flow')
const trace = ref('')

const flowCount = computed(() => events.value.filter((e) => e.kind === 'flow').length)
const callCount = computed(() => events.value.filter((e) => e.kind === 'call').length)

const filtered = computed(() =>
  events.value.filter((e) => {
    if (e.kind !== tab.value) return false
    if (trace.value && !e.trace.includes(trace.value.trim())) return false
    return true
  })
)
</script>

<style scoped>
.ec-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--mk-line); }
.ec-tab {
  border: 0;
  background: transparent;
  padding: 9px 14px;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  color: var(--mk-muted);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.ec-tab b { font-variant-numeric: tabular-nums; margin-left: 4px; }
.ec-tab--active { color: var(--mk-ink); border-bottom-color: var(--mk-blue); }

.ec-timeline { display: grid; }
.ec-row {
  display: grid;
  grid-template-columns: 10px 62px 108px minmax(0, 1fr) auto 84px;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid #f0f2f5;
}
.ec-row--hit { background: #fffbeb; }
.ec-row__dot { width: 8px; height: 8px; border-radius: 50%; }
.ec-row__dot--ok { background: var(--mk-green); }
.ec-row__dot--warn { background: var(--mk-amber); }
.ec-row__dot--bad { background: var(--mk-red); }
.ec-row__time { color: var(--mk-faint); font-size: 11.5px; }
.ec-row__stage { font-size: 12px; color: var(--mk-muted); font-weight: 600; white-space: nowrap; }
.ec-row__main { display: grid; min-width: 0; }
.ec-row__main strong { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ec-row__main span { font-size: 11.5px; color: var(--mk-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ec-row__trace { color: #b45309; font-size: 11px; text-align: right; }
.mono { font-family: var(--mk-mono); }
</style>
