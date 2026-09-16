<template>
  <div class="cp-day-timeline">
    <div v-if="loading" class="dt-state">加载中…</div>
    <div v-else-if="error" class="dt-state dt-state--error">
      <span>{{ error }}</span>
      <button type="button" class="mk-link" @click="load">重试</button>
    </div>
    <div v-else-if="!clock" class="dt-state">无模拟时钟数据</div>

    <template v-else>
      <div class="dt-clock">
        <span class="dt-clock__badge" :class="clock.enabled ? 'is-on' : 'is-off'">
          {{ clock.enabled ? '日期模拟已开启' : '日期模拟未开启' }}
        </span>
        <span class="dt-clock__meta">起点 {{ clock.baseDate }}</span>
        <span class="dt-clock__meta">已推进 {{ clock.dayIndex }} 天 · 已过 {{ clock.elapsedDays }} / {{ clock.maxSimulatedDays }} 天</span>
        <span class="dt-clock__meta">{{ clock.timezone }}</span>
        <button type="button" class="mk-link" :disabled="resetting" title="重置推进进度（dayIndex=0、清空 history；不回改已写时间戳）" @click="resetClock">
          {{ resetting ? '重置中…' : '重置进度' }}
        </button>
      </div>

      <div class="dt-controls">
        <span class="dt-clock__meta">课表 {{ weekdaysLabel(clock.courseWeekdays) }} · 每天 {{ clock.lessonsPerDay }} 节</span>
        <button type="button" class="mk-link" :disabled="advancing || !clock.enabled" :title="clock.enabled ? '按课表推进 1 个上课日（跳过非上课日）' : '请先开启日期模拟'" @click="advance(1)">推进 1 天</button>
        <button type="button" class="mk-link" :disabled="advancing || !clock.enabled" :title="clock.enabled ? '按课表推进 5 个上课日' : '请先开启日期模拟'" @click="advance(5)">推进 5 天</button>
        <label class="dt-auto" :title="clock.enabled ? '开启后由后台按课表自动推进（仅时钟簿记；当天任务重放归系统层）' : '请先开启日期模拟'">
          <input
            type="checkbox"
            :checked="clock.autoAdvance"
            :disabled="advancing || !clock.enabled"
            @change="toggleAuto(($event.target as HTMLInputElement).checked)"
          />
          自动推进
        </label>
      </div>

      <p v-if="!clock.enabled" class="dt-hint">
        日期模拟默认关闭。下方按天读数是该会话既有历史的自然日聚合（以会话创建日为第 1 天），可直接用于负担/干预观测。
      </p>

      <div v-if="!days.length" class="dt-state">暂无按天数据</div>

      <div v-for="day in days" :key="day.dayIndex" class="dt-day">
        <div class="dt-day__head">
          <span class="dt-day__label">第 {{ day.dayIndex + 1 }} 天</span>
          <span class="dt-day__date">{{ day.simulatedDay }}</span>
          <span v-if="day.pacing" class="dt-chip" :class="`dt-chip--pace-${day.pacing}`">节奏 {{ pacingLabel(day.pacing) }}</span>
          <span v-for="signal in day.signals" :key="signal" class="dt-chip dt-chip--warn">{{ signalLabel(signal) }}</span>
        </div>

        <div class="dt-metrics">
          <span v-if="day.dayLoad" class="dt-metric">
            课量 <b>{{ day.dayLoad.lessons }}</b> 节 · <b>{{ day.dayLoad.minutes }}</b> 分钟
            <template v-if="day.dayLoad.fatigueBonus"> · 疲劳加成 <b>{{ day.dayLoad.fatigueBonus }}</b></template>
          </span>
          <span v-if="day.metrics" class="dt-metric">LSS {{ fmt(day.metrics.lss) }}</span>
          <span v-if="day.metrics" class="dt-metric">KTL {{ fmt(day.metrics.ktl) }}</span>
          <span v-if="day.metrics" class="dt-metric">LF {{ fmt(day.metrics.lf) }}</span>
          <span v-if="day.metrics" class="dt-metric">LSB {{ fmt(day.metrics.lsb) }}</span>
          <span v-if="day.reviewQuota.limitLoad" class="dt-metric">
            温故 {{ day.reviewQuota.usedLoad }} / {{ day.reviewQuota.limitLoad }}
          </span>
          <span v-if="day.memory.traceCount" class="dt-metric">
            记忆 {{ day.memory.traceCount }} 点
            <template v-if="day.memory.avgRetention !== null"> · 均保留率 {{ pct(day.memory.avgRetention) }}</template>
            <template v-if="day.memory.fragileCount"> · 脆弱 {{ day.memory.fragileCount }}</template>
          </span>
        </div>

        <div v-if="day.tasks.length" class="dt-tasks">
          <div v-for="task in day.tasks" :key="task.taskId" class="dt-task">
            <span class="dt-task__title" :title="task.title">{{ task.title || task.taskId }}</span>
            <span class="dt-task__meta">
              <template v-if="task.actualMinutes !== null">{{ task.actualMinutes }} 分钟</template>
              <template v-else-if="task.estimatedMinutes !== null">预计 {{ task.estimatedMinutes }} 分钟</template>
              <template v-if="task.cognitiveLoad"> · {{ task.cognitiveLoad }}</template>
            </span>
          </div>
        </div>

        <div v-if="day.difficultyAdjustments.length" class="dt-adjust">
          <span class="dt-adjust__label">难度调整</span>
          <span v-for="(adj, i) in day.difficultyAdjustments" :key="i" class="dt-adjust__item" :title="adj.reasons.join('、')">
            {{ adj.baseline }} → {{ adj.adjusted }}（{{ directionLabel(adj.direction) }}）
            <em v-if="adj.applied">已执行</em><em v-else>仅判定</em>
          </span>
        </div>

        <div v-if="day.perPath.length > 1" class="dt-paths">
          <span v-for="p in day.perPath" :key="p.pathId" class="dt-path" :title="p.pathId">
            路径 {{ p.pathId.slice(-6) }} · LF {{ fmt(p.lf) }}
          </span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { adminVirtualLearnersApi } from '@/api/adminApi'

interface SimulationClock {
  enabled: boolean
  status: string
  timezone: string
  baseDate: string
  dayIndex: number
  elapsedDays: number
  maxSimulatedDays: number
  autoAdvance: boolean
  courseWeekdays: number[]
  lessonsPerDay: number
}
interface DayEntry {
  dayIndex: number
  simulatedDay: string
  pacing: 'slow' | 'moderate' | 'fast' | null
  signals: string[]
  dayLoad: { lessons: number; minutes: number; fatigueBonus: number } | null
  metrics: { lss: number; ktl: number; lf: number; lsb: number } | null
  perPath: Array<{ pathId: string; lf: number }>
  tasks: Array<{ taskId: string; title: string; actualMinutes: number | null; estimatedMinutes: number | null; cognitiveLoad: string | null }>
  difficultyAdjustments: Array<{ baseline: number; adjusted: number; direction: string; reasons: string[]; applied: boolean }>
  reviewQuota: { limitLoad: number; usedLoad: number; remainingLoad: number; usedCount: number }
  memory: { traceCount: number; dueCount: number; fragileCount: number; stableCount: number; avgRetention: number | null }
}

const props = withDefaults(defineProps<{ sessionId: string; from?: number; to?: number }>(), {
  from: 0,
  to: 29,
})

const loading = ref(false)
const error = ref('')
const clock = ref<SimulationClock | null>(null)
const days = ref<DayEntry[]>([])
const resetting = ref(false)
const advancing = ref(false)

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']
function weekdaysLabel(weekdays: number[]): string {
  if (!weekdays || !weekdays.length) return '每天'
  return weekdays.map((d) => `周${WEEKDAY_LABELS[d] ?? d}`).join('、')
}
function pickErr(e: unknown, fallback: string): string {
  const anyErr = e as any
  return anyErr?.response?.data?.error || anyErr?.message || fallback
}

async function advance(days: number) {
  if (!props.sessionId) return
  advancing.value = true
  try {
    await adminVirtualLearnersApi.advanceVirtualSessionDay(props.sessionId, { days })
    await load()
  } catch (e) {
    error.value = pickErr(e, '推进失败')
  } finally {
    advancing.value = false
  }
}

async function toggleAuto(next: boolean) {
  if (!props.sessionId) return
  advancing.value = true
  try {
    await adminVirtualLearnersApi.updateSessionSimulationConfig(props.sessionId, { simulationClock: { autoAdvance: next } })
    await load()
  } catch (e) {
    error.value = pickErr(e, '切换自动推进失败')
  } finally {
    advancing.value = false
  }
}

async function resetClock() {
  if (!props.sessionId) return
  if (typeof window !== 'undefined' && !window.confirm('确定重置该会话的日期模拟推进进度？（dayIndex 归零、清空 history；不回改已写时间戳）')) return
  resetting.value = true
  try {
    await adminVirtualLearnersApi.resetVirtualSessionClock(props.sessionId)
    await load()
  } catch (e: any) {
    error.value = e?.response?.data?.error || e?.message || '重置失败'
  } finally {
    resetting.value = false
  }
}

function fmt(value: number | null | undefined): string {
  return typeof value === 'number' ? String(Math.round(value * 100) / 100) : '—'
}
function pct(value: number): string {
  return `${Math.round(value * 100)}%`
}
function pacingLabel(p: string): string {
  return { slow: '放缓', moderate: '常规', fast: '加速' }[p] || p
}
function signalLabel(s: string): string {
  return { fatigue_high: '疲劳偏高', lsb_negative: '负荷失衡' }[s] || s
}
function directionLabel(d: string): string {
  return { decrease: '降档', increase: '升档', keep: '不变' }[d] || d
}

async function load() {
  if (!props.sessionId) return
  loading.value = true
  error.value = ''
  try {
    const [clockRes, timelineRes] = await Promise.all([
      adminVirtualLearnersApi.getVirtualSessionSimulationClock(props.sessionId),
      adminVirtualLearnersApi.getVirtualSessionDayTimeline(props.sessionId, { from: props.from, to: props.to }),
    ])
    clock.value = clockRes.data?.data ?? clockRes.data ?? null
    const timeline = timelineRes.data?.data ?? timelineRes.data
    days.value = Array.isArray(timeline?.days) ? timeline.days : []
  } catch (e: any) {
    error.value = e?.response?.data?.error || e?.message || '加载日程失败'
    clock.value = null
    days.value = []
  } finally {
    loading.value = false
  }
}

watch(() => props.sessionId, load, { immediate: true })
</script>

<style scoped>
.cp-day-timeline { display: flex; flex-direction: column; gap: 12px; }
.dt-state { padding: 16px; color: var(--mk-text-muted, #888); font-size: 13px; }
.dt-state--error { color: var(--mk-danger, #d33); display: flex; gap: 8px; align-items: center; }
.dt-clock { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; font-size: 12px; }
.dt-clock__badge { padding: 2px 8px; border-radius: 999px; font-weight: 600; }
.dt-clock__badge.is-on { background: rgba(46, 160, 67, 0.12); color: #2ea043; }
.dt-clock__badge.is-off { background: rgba(140, 140, 140, 0.12); color: #888; }
.dt-clock__meta { color: var(--mk-text-muted, #888); }
.dt-controls { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; font-size: 12px; }
.dt-auto { display: flex; align-items: center; gap: 4px; font-size: 12px; cursor: pointer; }
.dt-hint { margin: 0; font-size: 12px; color: var(--mk-text-muted, #888); }
.dt-day { border: 1px solid var(--mk-border, #e5e5e5); border-radius: 8px; padding: 10px 12px; }
.dt-day__head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.dt-day__label { font-weight: 600; }
.dt-day__date { color: var(--mk-text-muted, #888); font-size: 12px; }
.dt-chip { font-size: 11px; padding: 1px 6px; border-radius: 4px; background: rgba(140, 140, 140, 0.12); }
.dt-chip--warn { background: rgba(210, 150, 0, 0.14); color: #a07000; }
.dt-chip--pace-slow { background: rgba(210, 90, 0, 0.14); color: #b35a00; }
.dt-chip--pace-fast { background: rgba(46, 120, 220, 0.14); color: #2e78dc; }
.dt-metrics { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 6px; font-size: 12px; color: var(--mk-text-muted, #888); }
.dt-metric b { color: var(--mk-text, #222); }
.dt-tasks { margin-top: 8px; display: flex; flex-direction: column; gap: 4px; }
.dt-task { display: flex; justify-content: space-between; gap: 12px; font-size: 12px; }
.dt-task__title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dt-task__meta { color: var(--mk-text-muted, #888); flex: 0 0 auto; }
.dt-adjust { margin-top: 8px; font-size: 12px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.dt-adjust__label { color: var(--mk-text-muted, #888); }
.dt-adjust__item { background: rgba(140, 140, 140, 0.1); padding: 1px 6px; border-radius: 4px; }
.dt-adjust__item em { font-style: normal; margin-left: 4px; color: var(--mk-text-muted, #888); }
.dt-paths { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 8px; font-size: 11px; color: var(--mk-text-muted, #888); }
</style>
