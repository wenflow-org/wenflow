<template>
  <div class="mk-page">
    <!-- 状态条：当前选中的链路 -->
    <div class="mk-status" :class="statusTone">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title wf-title" :title="activeTrace">{{ statusTitle }}</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">{{ spansOfTrace.length }} 个 span</span>
      <span class="mk-status__meta">总耗时 {{ totalDuration }}</span>
      <span class="mk-status__meta">失败 {{ errorCount }}</span>
      <div class="wf-tracepick">
        <span class="wf-tracepick__count">{{ traceIds.length }} 条链路</span>
        <select class="wf-tracepick__select mono" v-model="activeTrace" aria-label="选择链路">
          <option v-for="t in traceIds" :key="t" :value="t">
            {{ traceLabel(t) }}
          </option>
        </select>
      </div>
    </div>

    <div v-if="spansOfTrace.length" class="wf">
      <!-- 时间刻度 -->
      <div class="wf-ruler">
        <span class="wf-ruler__label">阶段 / span</span>
        <div class="wf-ruler__track">
          <span v-for="tick in ticks" :key="tick" class="wf-ruler__tick" :style="{ left: tickLeft(tick) }">
            {{ tick >= 1000 ? `${tick / 1000}s` : `${tick}ms` }}
          </span>
        </div>
      </div>

      <!-- 瀑布行 -->
      <div
        v-for="span in spansOfTrace"
        :key="span.id"
        class="wf-row"
        :class="{ 'wf-row--open': openSpanId === span.id }"
      >
        <button type="button" class="wf-row__main" @click="openSpanId = openSpanId === span.id ? '' : span.id">
          <span class="wf-row__stage">
            <span class="wf-row__kind" :class="`wf-row__kind--${span.kind}`">{{ span.kind === 'flow' ? '流程' : '调用' }}</span>
            <span class="wf-row__stage-name">{{ span.stage }}</span>
          </span>
          <span class="wf-row__agent" @click.stop="openSkillDrawer(span.agent)">{{ span.agent }}</span>
          <span class="wf-row__track">
            <span
              class="wf-row__bar"
              :class="`wf-row__bar--${span.status}`"
              :style="{ left: barLeft(span), width: barWidth(span) }"
            >
              <span v-if="span.durationMs >= 1200" class="wf-row__bar-text">{{ fmtMs(span.durationMs) }}</span>
            </span>
          </span>
          <span class="wf-row__dur mono">{{ fmtMs(span.durationMs) }}</span>
        </button>
        <div v-if="openSpanId === span.id" class="wf-row__detail">
          <div class="wf-row__detail-grid">
            <div>
              <span class="wf-detail-label">标题</span>
              <strong>{{ span.title }}</strong>
            </div>
            <div>
              <span class="wf-detail-label">摘要</span>
              <span>{{ span.detail }}</span>
            </div>
            <div>
              <span class="wf-detail-label">状态</span>
              <span class="mk-badge" :class="badgeOf(span.status)">{{ statusText(span.status) }}</span>
            </div>
          </div>
          <pre v-if="span.payload" class="wf-payload">{{ span.payload }}</pre>
          <div class="wf-row__detail-actions">
            <button type="button" class="mk-link" @click.stop="openSkillDrawer(span.agent)">查看 Skill →</button>
          </div>
        </div>
      </div>

      <!-- 因果摘要：失败链 -->
      <div v-if="errorCount > 0" class="wf-verdict">
        <strong>结论</strong>
        <p>{{ verdictText }}</p>
      </div>
    </div>

    <div v-else class="mk-empty">
      <strong>暂无链路数据</strong>
      <span>有真实调用发生后，这里按 Trace 展开完整瀑布。</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { spans, intent, openSkillDrawer, type TraceSpan } from './mockStore'

const activeTrace = ref('')
const openSpanId = ref('')

// intent.traceId 驱动（从日志/总览跳进来时预填）
watch(
  () => intent.traceId,
  (t) => {
    if (t) activeTrace.value = t
  },
  { immediate: true }
)

const traceIds = computed(() => [...new Set(spans.value.map((s) => s.traceId))])
watch(
  traceIds,
  (ids) => {
    if (!ids.includes(activeTrace.value)) activeTrace.value = intent.traceId && ids.includes(intent.traceId) ? intent.traceId : ids[0] || ''
  },
  { immediate: true }
)

const spansOfTrace = computed(() =>
  spans.value
    .filter((s) => s.traceId === activeTrace.value)
    .sort((a, b) => a.startMs - b.startMs)
)

const maxEnd = computed(() => Math.max(1, ...spansOfTrace.value.map((s) => s.startMs + s.durationMs)))
const errorCount = computed(() => spansOfTrace.value.filter((s) => s.status === 'err').length)
const totalDuration = computed(() => fmtMs(maxEnd.value))

const statusTone = computed(() => (!spansOfTrace.value.length ? 'mk-status--muted' : errorCount.value ? 'mk-status--bad' : 'mk-status--ok'))
const statusTitle = computed(() => {
  if (!spansOfTrace.value.length) return '暂无链路数据'
  return errorCount.value ? `链路 ${activeTrace.value} 存在失败` : `链路 ${activeTrace.value} 执行成功`
})

// 刻度：按总量程取 4-5 档
const ticks = computed(() => {
  const end = maxEnd.value
  const step = end > 20000 ? 10000 : end > 8000 ? 4000 : end > 3000 ? 1000 : 500
  const out: number[] = []
  for (let t = 0; t <= end; t += step) out.push(t)
  return out
})

const tickLeft = (t: number) => `${(t / maxEnd.value) * 100}%`
const barLeft = (s: TraceSpan) => `${(s.startMs / maxEnd.value) * 100}%`
const barWidth = (s: TraceSpan) => `${Math.max((s.durationMs / maxEnd.value) * 100, 1.2)}%`

const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`)
const badgeOf = (s: string) => (s === 'err' ? 'mk-badge--bad' : s === 'warn' ? 'mk-badge--warn' : 'mk-badge--ok')
const statusText = (s: string) => (s === 'err' ? '失败' : s === 'warn' ? '降级' : '成功')

/* 长 trace ID 在下拉与标题中截断显示 */
const shortTrace = (t: string) => (t.length > 20 ? `…${t.slice(-16)}` : t)
function traceLabel(t: string) {
  const mine = spans.value.filter((s) => s.traceId === t)
  const errs = mine.filter((s) => s.status === 'err').length
  const total = mine.reduce((a, s) => Math.max(a, s.startMs + s.durationMs), 0)
  return `${shortTrace(t)} · ${mine.length} span · ${fmtMs(total)}${errs ? ` · ${errs} 失败` : ''}`
}

/* 结论完全由当前链路数据推导，不带预设立场 */
const verdictText = computed(() => {
  const errs = spansOfTrace.value.filter((s) => s.status === 'err')
  if (!errs.length) return ''
  const first = errs[0]
  const agents = [...new Set(errs.map((s) => s.agent))]
  const slowest = spansOfTrace.value.reduce((a, s) => (s.durationMs > (a?.durationMs || 0) ? s : a), errs[0])
  const parts = [
    `首次失败出现在 ${first.agent}（${first.title}，耗时 ${fmtMs(first.durationMs)}）。`,
    `本链路共 ${errs.length} 次失败，涉及 ${agents.length} 个节点：${agents.join('、')}。`,
    `最慢节点为 ${slowest.agent}（${fmtMs(slowest.durationMs)}）。`
  ]
  if (first.payload) parts.push(`首个错误：${first.payload.slice(0, 120)}`)
  return parts.join('')
})
</script>

<style scoped>
.wf {
  border: 1px solid var(--mk-line);
  border-radius: 12px;
  background: var(--mk-surface);
  overflow: hidden;
}

/* 链路选择器：替代 pills，避免长 trace ID 挤爆状态条 */
.wf-title {
  max-width: 380px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wf-tracepick {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.wf-tracepick__count { font-size: 11.5px; color: var(--mk-faint); white-space: nowrap; }
.wf-tracepick__select {
  max-width: 320px;
  padding: 6px 10px;
  border: 1px solid var(--mk-line);
  border-radius: 8px;
  background: var(--mk-surface);
  font-size: 11.5px;
  color: var(--mk-ink);
}

.wf-ruler {
  display: grid;
  grid-template-columns: 280px 1fr;
  align-items: center;
  border-bottom: 1px solid var(--mk-line);
  background: #fafbfc;
}
.wf-ruler__label {
  padding: 8px 14px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mk-faint);
}
.wf-ruler__track { position: relative; height: 26px; margin-right: 74px; }
.wf-ruler__tick {
  position: absolute;
  top: 4px;
  font-size: 10px;
  color: var(--mk-faint);
  font-family: var(--mk-mono);
  transform: translateX(-50%);
}
.wf-ruler__tick::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 12px;
  width: 1px;
  height: 6px;
  background: var(--mk-line);
}

.wf-row { border-bottom: 1px solid #f0f2f5; }
.wf-row:last-of-type { border-bottom: none; }
.wf-row--open { background: #fafbff; }
.wf-row__main {
  display: grid;
  grid-template-columns: 120px 150px 1fr 64px;
  gap: 10px;
  align-items: center;
  width: 100%;
  padding: 9px 14px;
  border: 0;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.wf-row__main:hover { background: #f6f9ff; }

.wf-row__stage {
  font-size: 12px;
  font-weight: 600;
  color: var(--mk-muted);
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.wf-row__stage-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.wf-row__kind {
  padding: 1px 6px;
  border-radius: 5px;
  font-size: 10px;
  font-weight: 700;
}
.wf-row__kind--flow { background: #eff6ff; color: var(--mk-blue); }
.wf-row__kind--call { background: #f0f2f5; color: var(--mk-muted); }

.wf-row__agent {
  font-family: var(--mk-mono);
  font-size: 11px;
  color: var(--mk-blue);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wf-row__agent:hover { text-decoration: underline; }

.wf-row__track {
  position: relative;
  height: 20px;
  background: #f3f5fa;
  border-radius: 5px;
  overflow: hidden;
}
.wf-row__bar {
  position: absolute;
  top: 3px;
  bottom: 3px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  padding: 0 6px;
  min-width: 4px;
}
.wf-row__bar--ok { background: linear-gradient(90deg, #6aa0ff, #3d7cff); }
.wf-row__bar--warn { background: linear-gradient(90deg, #fcd34d, #f59e0b); }
.wf-row__bar--err { background: linear-gradient(90deg, #f87171, #dc2626); }
.wf-row__bar-text { font-size: 10px; font-weight: 700; color: #fff; }

.wf-row__dur { font-size: 11px; color: var(--mk-muted); text-align: right; }
.mono { font-family: var(--mk-mono); }

.wf-row__detail { padding: 4px 14px 12px 14px; display: grid; gap: 10px; }
.wf-row__detail-grid {
  display: grid;
  grid-template-columns: 1fr 1.4fr auto;
  gap: 12px;
  align-items: start;
}
.wf-detail-label {
  display: block;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: var(--mk-faint);
  margin-bottom: 3px;
}
.wf-payload {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: #0d1420;
  color: #8ba3c7;
  font: 11px/1.6 'JetBrains Mono', monospace;
  overflow: auto;
  max-height: 200px;
  white-space: pre-wrap;
  word-break: break-all;
}
.wf-row__detail-actions { display: flex; justify-content: flex-end; }

.wf-verdict {
  margin: 12px 14px 14px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid rgba(220, 38, 38, 0.2);
  background: #fef8f8;
  display: grid;
  gap: 4px;
}
.wf-verdict strong { font-size: 12px; color: var(--mk-red); }
.wf-verdict p { margin: 0; font-size: 12.5px; color: var(--mk-muted); line-height: 1.6; }
</style>
