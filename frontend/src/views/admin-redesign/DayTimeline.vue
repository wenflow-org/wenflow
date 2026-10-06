<template>
  <div class="cp-day-timeline">
    <!-- 加载态：原型 .skelrow（539）+ .skel（537）语义 = 骨架行/格；视觉与暗色走全局 .mk-skeleton -->
    <div v-if="loading" class="dt-skel mk-skeleton-cards" aria-hidden="true">
      <span v-for="i in 6" :key="i" class="mk-skeleton dt-skel__cell"></span>
    </div>

    <!-- 整页失败：原型 .empty（287-289）语义 → MkEmptyState tone=error（错误态红系图标 + role=alert） -->
    <MkEmptyState
      v-else-if="error"
      compact
      tone="error"
      icon="!"
      :title="error"
      description="日期模拟数据加载失败，可重试。"
      action-text="重试"
      @action="load"
    />

    <MkEmptyState
      v-else-if="!clock"
      compact
      icon="◌"
      title="暂无模拟时钟数据"
      description="该会话尚未初始化日期模拟时钟。"
    />

    <template v-else>
      <!-- 时钟状态行：原型 .statusbar（219-229）= 状态点 + 标题 + meta + 右侧动作 -->
      <div class="dt-status">
        <span class="dt-status__dot" :class="clock.enabled ? 'is-on' : 'is-off'"></span>
        <strong class="dt-status__title">{{ clock.enabled ? '日期模拟已开启' : '日期模拟未开启' }}</strong>
        <span class="dt-status__meta">起点 {{ clock.baseDate }}</span>
        <span class="dt-status__meta">已推进 {{ clock.dayIndex }} / {{ clock.maxSimulatedDays }} 天</span>
        <span class="dt-status__meta">{{ clock.timezone }}</span>
        <span v-if="!readonly" class="dt-status__act">
          <button type="button" class="mk-link mk-link--danger" :disabled="resetting" title="重置推进进度（dayIndex=0、清空 history；不回改已写时间戳）" @click="resetClock">
            {{ resetting ? '重置中…' : '重置进度' }}
          </button>
        </span>
      </div>

      <!-- 按钮层级（原型 .btn 191-206）：推进 = 次级，推进并上课 = 主操作。
           readonly（#67）：嵌入只读视图（画像·日程 tab）时只留课表元信息，不渲染写操作 -->
      <div class="dt-controls">
        <span class="dt-status__meta">课表 {{ weekdaysLabel(clock.courseWeekdays) }} · 每天 {{ clock.lessonsPerDay }} 节</span>
        <button v-if="!readonly" type="button" class="mk-btn mk-btn--sm" :disabled="advancing || !clock.enabled" :title="clock.enabled ? '按课表推进 1 个上课日（跳过非上课日）' : '请先开启日期模拟'" @click="advance(1)">推进 1 天</button>
        <button v-if="!readonly" type="button" class="mk-btn mk-btn--sm" :disabled="advancing || !clock.enabled" :title="clock.enabled ? '按课表推进 5 个上课日' : '请先开启日期模拟'" @click="advance(5)">推进 5 天</button>
        <button v-if="!readonly" type="button" class="mk-btn mk-btn--sm mk-btn--primary" :disabled="advancing || !clock.enabled" :title="clock.enabled ? '推进 1 天并真实跑当天课程（业务时间戳落在模拟日；每节消耗 AI 调用）' : '请先开启日期模拟'" @click="advance(1, true)">推进并上课</button>
        <label v-if="!readonly" class="dt-auto" :title="clock.enabled ? '开启后由后台按课表自动推进（仅时钟簿记；当天任务重放归系统层）' : '请先开启日期模拟'">
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

      <!-- 操作类失败（推进/自动推进/重置）走行内 alert：error ref 只留给 load() 整页失败，
           操作失败不再把已渲染的整条时间线替换成错误态 -->
      <div v-if="actionError" class="mk-alert mk-alert--row" role="alert">
        <div class="mk-alert__msg">{{ actionError }}</div>
        <div class="mk-alert__act">
          <button type="button" class="mk-btn mk-btn--sm" @click="actionError = ''">知道了</button>
        </div>
      </div>

      <MkEmptyState
        v-if="!days.length"
        compact
        icon="◌"
        title="暂无按天数据"
        description="该会话在此时间窗口内没有可读的按天记录。"
      />

      <!-- 日程格：原型 .schgrid/.schcell（544-553）——day（天序）/ slot（mono 日期）/ scene（场景）/ meta（读数）
           + 四态 done/active/skip/idle -->
      <div v-else class="schgrid">
        <div
          v-for="day in days"
          :key="day.dayIndex"
          class="dt-cell schcell"
          :class="{
            'schcell--active': dayState(day) === 'active',
            'schcell--done': dayState(day) === 'done',
            'schcell--skip': dayState(day) === 'skip',
            'schcell--idle': dayState(day) === 'idle',
          }"
        >
          <div class="dt-cell__head">
            <span class="schcell__day">第 {{ day.dayIndex + 1 }} 天</span>
            <!-- 状态第二通道（审核 #183）：颜色之外给字，色弱/灰度可辨四态 -->
            <span v-if="dayStateLabel(day)" class="schcell__state" :class="`schcell__state--${dayState(day)}`">{{ dayStateLabel(day) }}</span>
            <span class="schcell__slot">{{ day.simulatedDay }}</span>
          </div>

          <span v-if="day.pacing || day.signals.length" class="schcell__scene">
            <span v-if="day.pacing" class="dt-chip" :class="`dt-chip--pace-${day.pacing}`">节奏 {{ pacingLabel(day.pacing) }}</span>
            <span v-for="signal in day.signals" :key="signal" class="dt-chip dt-chip--warn">{{ signalLabel(signal) }}</span>
          </span>

          <div class="dt-metrics schcell__meta">
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

          <!-- 明细（原型 schcell 之外的补充：任务/难度调整/分路径读数，保留全部既有数据） -->
          <div v-if="day.tasks.length || day.difficultyAdjustments.length || day.perPath.length > 1" class="dt-cell__detail">
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
        </div>
      </div>

      <!-- 长会话回看：30 天窗口之外按档翻页；到头隐藏对应按钮（窗口尚在数据范围内时即使本档无数据也可翻回） -->
      <div v-if="canPageOlder || canPageNewer" class="dt-pager">
        <button v-if="canPageOlder" type="button" class="mk-link" @click="pageWindow(-1)">更早 30 天</button>
        <button v-if="canPageNewer" type="button" class="mk-link" @click="pageWindow(1)">更近 30 天</button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { adminVirtualLearnersApi } from '@/api/adminApi'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import { errMsg } from './live'
import { askConfirm } from './useConfirm'

interface SimulationClock {
  enabled: boolean
  status: string
  timezone: string
  baseDate: string
  dayIndex: number
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

const props = withDefaults(defineProps<{
  sessionId: string
  from?: number
  to?: number
  /** 只读视图（#67）：嵌入声明为「只读」的 tab（画像·日程）时隐藏推进/自动推进/重置等写操作 */
  readonly?: boolean
}>(), {
  from: 0,
  to: 29,
  readonly: false,
})

/** 分页窗口：默认窗口只有 30 天，长会话更早的历史按 30 天一档翻页回看；load() 沿用这组 from/to 拉取参数 */
const PAGE_SPAN = 30
const windowFrom = ref(props.from)
const windowTo = ref(props.to)
/* 「更早」到头即第 0 天；「更近」的上界取 maxSimulatedDays（模拟日总档数）——
   时钟关闭时按天数据是会话创建以来的全部历史，不受已推进 dayIndex 约束，故不能用 dayIndex 判到头 */
const canPageOlder = computed(() => windowFrom.value > 0)
const canPageNewer = computed(() => !!clock.value && windowTo.value + 1 < clock.value.maxSimulatedDays)

function pageWindow(dir: -1 | 1) {
  windowFrom.value += dir * PAGE_SPAN
  windowTo.value += dir * PAGE_SPAN
  load()
}

const loading = ref(false)
const error = ref('')
/** 操作类失败（推进/自动推进/重置）的行内提示：不写 error（那是整页错误态，会顶掉整条时间线） */
const actionError = ref('')
const clock = ref<SimulationClock | null>(null)
const days = ref<DayEntry[]>([])
const resetting = ref(false)
const advancing = ref(false)

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']
function weekdaysLabel(weekdays: number[]): string {
  if (!weekdays || !weekdays.length) return '每天'
  return weekdays.map((d) => `周${WEEKDAY_LABELS[d] ?? d}`).join('、')
}
interface ApiErrorLike {
  response?: { data?: { error?: string } }
  message?: string
}
function pickErr(e: unknown, fallback: string): string {
  const err = e as ApiErrorLike
  return err?.response?.data?.error || err?.message || fallback
}

async function advance(days: number, runTasks = false) {
  if (!props.sessionId) return
  /* 审核 #180：「推进并上课」真实跑当天课程（业务时间戳落模拟日 + 每节消耗 AI 调用），
     是代价最高且不可撤销的动作，此前不经确认（同页成本更低、可反复的重置反而有确认框，
     危险分级与代价相反；成本说明只在 title，触屏/键盘读不到）。补确认框把代价显式化。 */
  if (runTasks) {
    const ok = await askConfirm({
      title: '推进并上课',
      message: `将真实跑 ${clock.value?.lessonsPerDay ?? 1} 节课程（业务时间戳落在模拟日），每节消耗对应 AI 调用；课程产出会写入学习者数据，不可撤销。`,
      confirmText: '推进并上课',
    })
    if (!ok) return
  }
  advancing.value = true
  actionError.value = ''
  try {
    await adminVirtualLearnersApi.advanceVirtualSessionDay(props.sessionId, { days, runTasks })
    await load()
  } catch (e) {
    // 操作失败只提示，不顶掉时间线（error ref 会触发 v-else-if 整页错误态）
    actionError.value = pickErr(e, '推进失败')
  } finally {
    advancing.value = false
  }
}

async function toggleAuto(next: boolean) {
  if (!props.sessionId) return
  advancing.value = true
  actionError.value = ''
  try {
    await adminVirtualLearnersApi.updateSessionSimulationConfig(props.sessionId, { simulationClock: { autoAdvance: next } })
    await load()
  } catch (e) {
    actionError.value = pickErr(e, '切换自动推进失败')
  } finally {
    advancing.value = false
  }
}

async function resetClock() {
  if (!props.sessionId) return
  /* 全站统一确认框（原原生 window.confirm 是最后一处离类：无 busy/焦点管理、样式断裂） */
  const ok = await askConfirm({
    title: '重置日期模拟进度',
    message: '确定重置该会话的日期模拟推进进度？dayIndex 归零、清空 history；不回改已写时间戳。',
    confirmText: '重置',
  })
  if (!ok) return
  resetting.value = true
  actionError.value = ''
  try {
    await adminVirtualLearnersApi.resetVirtualSessionClock(props.sessionId)
    await load()
  } catch (e) {
    // 同 advance/toggleAuto：重置是操作不是加载，失败走行内 alert 保留时间线
    actionError.value = errMsg(e)
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

/** 日程格四态（对齐原型 .schcell--done/active/skip/idle，546-549）：
 *  active = 当前模拟日（服务端 dayIndex，不在前端做时间换算）；
 *  done   = 当天已有完成任务（actualMinutes 落值）；
 *  skip   = 当天无课（课量为 0 的非上课日）；
 *  idle   = 其余（无课量读数/空档）。 */
function dayState(day: DayEntry): 'active' | 'done' | 'skip' | 'idle' {
  if (clock.value && day.dayIndex === clock.value.dayIndex) return 'active'
  if (day.tasks.some((t) => t.actualMinutes !== null)) return 'done'
  if (day.dayLoad && day.dayLoad.lessons === 0) return 'skip'
  return 'idle'
}

/** 状态词（审核 #183）：四态里 skip 与 idle 同底色、done 与 idle 只差一条 30% 绿描边，
    状态只靠颜色表达 → 色弱/灰度下分不出。给日程格补第二通道（格内状态字），
    idle 不加字（「未上课」是默认态，加了反而噪音）。 */
const DAY_STATE_LABEL: Record<'active' | 'done' | 'skip' | 'idle', string> = {
  active: '当前',
  done: '已完成',
  skip: '无课',
  idle: '',
}
function dayStateLabel(day: DayEntry) {
  return DAY_STATE_LABEL[dayState(day)]
}

async function load() {
  if (!props.sessionId) return
  loading.value = true
  error.value = ''
  try {
    const [clockRes, timelineRes] = await Promise.all([
      adminVirtualLearnersApi.getVirtualSessionSimulationClock(props.sessionId),
      adminVirtualLearnersApi.getVirtualSessionDayTimeline(props.sessionId, { from: windowFrom.value, to: windowTo.value }),
    ])
    clock.value = clockRes.data?.data ?? clockRes.data ?? null
    const timeline = timelineRes.data?.data ?? timelineRes.data
    days.value = Array.isArray(timeline?.days) ? timeline.days : []
  } catch (e) {
    error.value = errMsg(e)
    clock.value = null
    days.value = []
  } finally {
    loading.value = false
  }
}

watch(
  () => props.sessionId,
  () => {
    // 换会话回到默认窗口：上一会话的分页偏移不应带过去
    windowFrom.value = props.from
    windowTo.value = props.to
    load()
  },
  { immediate: true },
)
</script>

<style scoped>
.cp-day-timeline { display: flex; flex-direction: column; gap: 12px; }

/* 加载骨架格：原型 .skelrow（539）+ .skel（537）语义；视觉走全局 .mk-skeleton，
   本页只给形状（高度 + mk-skeleton-cards 的自适应列） */
.dt-skel__cell { height: 76px; }

/* 时钟状态行：原型 .statusbar（219-229）= 状态点 + b 标题 + meta + 右侧动作 */
.dt-status {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 9px 14px;
  min-height: 48px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-xl);
  background: var(--mk-surface);
  font-size: var(--mk-fs-micro);
}
.dt-status__dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
.dt-status__dot.is-on { background: var(--mk-green); }
.dt-status__dot.is-off { background: var(--mk-faint); }
.dt-status__title { font-size: var(--mk-fs-emphasis); color: var(--mk-ink); }
.dt-status__meta { color: var(--mk-muted); font-variant-numeric: tabular-nums; }
.dt-status__act { margin-left: auto; }

/* 控件行：次级按钮 + 主按钮（原型 .btn 191-206）的层级落在这里 */
.dt-controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: var(--mk-fs-micro); }
.dt-auto { display: flex; align-items: center; gap: 4px; font-size: var(--mk-fs-micro); cursor: pointer; }
.dt-hint { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-faint); }

/* ===== 日程格：原型 .schgrid/.schcell（544-553）=====
   原型 116px 是「一周仿真日程」的窄格；本页每格承载课量/读数/任务明细，
   故加宽 minmax 到 240px，其余（gap 10、padding 10/12、gap 4、四态底色）原样。 */
.schgrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 10px; }
.schcell {
  display: grid;
  gap: 4px;
  align-content: start;
  padding: 10px 12px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-lg);
  background: var(--mk-surface);
  /* LY8：网格项默认 min-width:auto 会被内部 nowrap 内容（任务 meta / 读数行）顶开，
     258px 的格宽下 345px 子内容溢出到右邻格。置 0 让子元素按格宽收缩。 */
  min-width: 0;
}
.schcell--done { border-color: color-mix(in srgb, var(--mk-green) 30%, var(--mk-line)); }
.schcell--active { border-color: var(--mk-blue); background: var(--mk-blue-bg); }
.schcell--skip,
.schcell--idle { background: var(--mk-surface-2); }
/* 状态字（审核 #183）：四态的颜色之外的第二通道。done 绿字、skip 弱灰字、active 蓝字，
   与格底色同族但更深（文字可读性优先）；尺寸取 micro，不抢「第 N 天」主标识。 */
.schcell__state {
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  padding: 0 6px;
  border-radius: 999px;
  border: 1px solid currentColor;
  opacity: 0.85;
}
.schcell__state--active { color: var(--mk-blue); }
.schcell__state--done { color: var(--mk-green); }
.schcell__state--skip { color: var(--mk-muted); }
.schcell__day { font-weight: 700; font-size: var(--mk-fs-micro); color: var(--mk-ink); }
.schcell__slot { font-family: var(--mk-mono); font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.schcell__scene { display: flex; flex-wrap: wrap; gap: 4px; font-size: var(--mk-fs-micro); }
.schcell__meta { font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.schcell--active .schcell__meta { color: var(--mk-blue); font-weight: 600; }

.dt-cell__head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; min-width: 0; }
.dt-cell__detail { display: grid; gap: 6px; margin-top: 4px; min-width: 0; }

/* 状态 chip（节奏/信号）：胶囊词汇，同原型 .pill（238-244） */
.dt-chip { font-size: var(--mk-fs-micro); padding: 1px 8px; border-radius: 999px; background: var(--mk-surface-3); color: var(--mk-muted); }
.dt-chip--warn { background: var(--mk-amber-bg); color: var(--mk-amber); }
.dt-chip--pace-slow { background: var(--mk-amber-bg); color: var(--mk-amber-fill); }
.dt-chip--pace-fast { background: var(--mk-blue-bg); color: var(--mk-blue); }

/* 读数行：等宽数字（原型 .meterrow / .kpi__value 的 tabular-nums 口径） */
.dt-metrics { display: flex; flex-wrap: wrap; gap: 12px; font-size: var(--mk-fs-micro); color: var(--mk-faint); font-variant-numeric: tabular-nums; min-width: 0; max-width: 100%; }
.dt-metric b { color: var(--mk-ink); }

.dt-tasks { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.dt-task { display: flex; justify-content: space-between; gap: 12px; font-size: var(--mk-fs-micro); min-width: 0; }
.dt-task__title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.dt-task__meta { color: var(--mk-faint); flex: 0 0 auto; font-variant-numeric: tabular-nums; }

.dt-adjust { font-size: var(--mk-fs-micro); display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.dt-adjust__label { color: var(--mk-faint); }
.dt-adjust__item { background: var(--mk-surface-3); padding: 1px 6px; border-radius: var(--mk-radius-xs); }
.dt-adjust__item em { font-style: normal; margin-left: 4px; color: var(--mk-faint); }

.dt-paths { display: flex; flex-wrap: wrap; gap: 8px; font-size: var(--mk-fs-micro); color: var(--mk-faint); }

.dt-pager { display: flex; justify-content: center; gap: 12px; font-size: var(--mk-fs-micro); }
</style>
