<template>
  <div class="live-log">
    <div class="live-log__head">
      <span class="live-log__title">实时日志</span>
      <span class="live-log__count">{{ entries.length }}</span>
    </div>
    <div class="live-log__list" ref="listRef" @scroll="handleScroll">
      <div v-if="entries.length === 0" class="live-log__empty">暂无日志</div>
      <div
        v-for="(entry, idx) in entries"
        :key="entry.id ?? idx"
        class="log-entry"
        :class="`log-entry--${entry.phase || 'info'}`"
        :title="entry.message"
      >
        <span class="log-entry__time">{{ formatTime(entry.timestamp) }}</span>
        <span class="log-entry__phase">{{ entry.phase || 'info' }}</span>
        <span class="log-entry__msg">{{ entry.message }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

export interface LogEntry {
  id?: string
  timestamp?: string
  phase?: string
  message: string
}

const props = defineProps<{
  entries: LogEntry[]
  pollingDisabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'poll'): void
}>()

const listRef = ref<HTMLElement | null>(null)
let pollTimer: ReturnType<typeof setInterval> | null = null

// 仅当用户停留在底部附近时才自动跟随滚动，避免打断用户回看历史日志
const BOTTOM_FOLLOW_THRESHOLD_PX = 48
let stickToBottom = true

const isNearBottom = () => {
  const el = listRef.value
  if (!el) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_FOLLOW_THRESHOLD_PX
}

const handleScroll = () => {
  stickToBottom = isNearBottom()
}

const formatTime = (time?: string) => {
  if (!time) return '--:--'
  const d = new Date(time)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

const handleVisibilityChange = () => {
  if (document.hidden) {
    stopPolling()
  } else {
    startPolling()
  }
}

const startPolling = () => {
  stopPolling()
  if (document.hidden || props.pollingDisabled) return
  pollTimer = setInterval(() => {
    if (!document.hidden) emit('poll')
  }, 3000)
}

const stopPolling = () => {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

watch(() => props.entries.length, async () => {
  if (!stickToBottom) return
  // 等 DOM 更新后再滚到真正的底部
  await nextTick()
  const el = listRef.value
  if (el) {
    el.scrollTop = el.scrollHeight
  }
})

watch(() => props.pollingDisabled, (disabled) => {
  if (disabled) stopPolling()
  else startPolling()
})

onMounted(() => {
  startPolling()
  document.addEventListener('visibilitychange', handleVisibilityChange)
})

onUnmounted(() => {
  stopPolling()
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})

</script>

<style scoped>
.live-log {
  display: grid;
  gap: 10px;
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 0;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.live-log__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 10px;
  border-bottom: 1px solid #e1e8f2;
}

.live-log__title {
  font-size: 13px;
  font-weight: 800;
  color: #1a2a44;
  letter-spacing: 0.5px;
}

.live-log__count {
  font-size: 11px;
  font-weight: 800;
  color: #5b6577;
  background: #eef2f7;
  padding: 1px 8px;
  border-radius: 999px;
}

.live-log__list {
  overflow-y: auto;
  max-height: 340px;
  display: grid;
  gap: 4px;
  font-size: 11px;
  font-family: 'Cascadia Code', 'JetBrains Mono', 'Fira Code', Consolas, monospace;
}

.live-log__empty {
  color: #94a3b8;
  text-align: center;
  padding: 16px;
}

.log-entry {
  display: grid;
  grid-template-columns: 52px 72px 1fr;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 4px;
  align-items: baseline;
  line-height: 1.45;
}

.log-entry--goal { background: #f0f5ff; }
.log-entry--goal-response { background: #eef3fd; }
.log-entry--path { background: #f0fdf4; }
.log-entry--learning { background: #fefce8; }
.log-entry--learning-response { background: #fef9c3; }
.log-entry--error { background: #fef2f2; color: #dc2626; }
.log-entry--stage { background: #faf5ff; }
.log-entry--info { background: #fafbfc; }

.log-entry__time {
  color: #94a3b8;
  white-space: nowrap;
}

.log-entry__phase {
  color: #5b6577;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.log-entry__msg {
  color: #1a2a44;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
