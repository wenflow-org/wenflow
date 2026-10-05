<template>
  <!-- 正在运行（2026-10-05 用户拍板「阶段聚合」）：不再穷举实例 chip（45 个平铺不可扫描，
       外部评审命中），汇总为阶段分布条（MkDistBand 家族标准件，段=教学流水线 Goal→Path→
       Learn→Wrapup）；点段/图例展开该阶段实例 chip（仍可跳会话座舱）。
       少量实例（≤FEW_LIMIT）直接全量平铺（免二次点击）；批量生成任务 chip 保持常驻 -->
  <div class="vl-running">
    <span class="vl-running__label">正在运行</span>
    <!-- 批量创建后台进度：创建秒回，AI 身份 + 故事后台推进 -->
    <button v-if="task?.active" type="button" class="vl-running__chip vl-running__chip--batch" :class="`is-${task.status}`" :title="batchTaskStatusTitle" @click="emit('toggleDetail')">
      <span class="vl-running__dot" aria-hidden="true"></span>
      <template v-if="task.status === 'done'">✓ 批量创建完成</template>
      <template v-else-if="task.status === 'error'">✕ 批量生成有失败</template>
      <template v-else>批量生成中</template>
      <template v-if="task.status === 'running'"> · 身份 {{ task.total - task.personaLeft }}/{{ task.total }}<template v-if="task.totalStories"> · 故事 {{ task.storiesDone }}/{{ task.totalStories }}</template></template>
    </button>
    <!-- 阶段分布（实例 > FEW_LIMIT 时启用）：分段 + 图例皆可点，选中段展开实例 chip -->
    <MkDistBand
      v-if="!fewMode && stageBins.length"
      class="vl-running__band"
      :bins="stageBins"
      :active-key="activeStage || null"
      unit="人"
      aria-label="按阶段查看运行中的虚拟学习者"
      @select="toggleStage"
    />
    <!-- 已暂停：autopilot 已停（会话保留），灰色 chip 点击进画像页（超 4 个截断，进列表「已暂停」筛选看全量） -->
    <button v-for="s in visiblePausedChips" :key="`p-${s.id}`" type="button" class="vl-running__chip vl-running__chip--paused" :title="`${s.pausedCount} 个会话已暂停自动驾驶（进度保留）；点击进入画像页`" @click="openSubPage('virtual', s.id)">
      <span class="vl-running__dot" aria-hidden="true"></span>
      {{ s.name }} · 已暂停{{ s.pausedCount > 1 ? ` ${s.pausedCount}` : '' }}
    </button>
    <span v-if="pausedSamples.length > PAUSED_CHIPS_LIMIT" class="vl-running__overflow" title="更多已暂停学习者请用列表卡头「已暂停」筛选查看">+{{ pausedSamples.length - PAUSED_CHIPS_LIMIT }} 已暂停</span>
    <!-- 实例 chip：少量实例全量平铺；聚合模式展示选中阶段的实例（点击跳会话座舱） -->
    <div v-if="activeChips.length" class="vl-running__chips">
      <button v-for="s in activeChips" :key="s.id" type="button" class="vl-running__chip" :title="chipTitle(s)" @click="openRunningSession(s)">
        <span class="vl-running__dot" aria-hidden="true"></span>
        {{ s.name }}<template v-if="fewMode"> · {{ stageLabel(s.currentStage) }}</template><template v-else-if="s.runningCount > 1"> · {{ s.runningCount }}</template>
      </button>
    </div>
    <!-- 批量生成详情行（点 chip 展开）：进度 + 重试 + 关闭 -->
    <div v-if="task?.active && task.expanded" class="mk-alert mk-alert--info vl-batch-detail" role="status">
      <span class="vl-batch-detail__text">
        <span class="mk-minibar vl-batch-detail__bar" aria-hidden="true"><i class="mk-minibar__fill" :style="{ width: batchPct + '%' }"></i></span>
        <span>
          创建 {{ task.created }}/{{ task.total }} 人
          <template v-if="task.personaLeft > 0"> · 生成身份 {{ task.total - task.personaLeft }}/{{ task.total }}</template>
          <template v-if="task.totalStories"> · 生成故事 {{ task.storiesDone }}/{{ task.totalStories }}</template>
          <template v-if="task.error"> · <span class="vl-batch-detail__err">{{ task.error }}</span></template>
        </span>
      </span>
      <button v-if="task.status === 'error'" type="button" class="mk-btn mk-btn--sm" @click="emit('retry')">重试失败</button>
      <button v-if="task.status === 'done' || task.status === 'error'" type="button" class="mk-link" @click="emit('dismiss')">✕ 关闭</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import MkDistBand from '@/components/mk/MkDistBand.vue'
import { openSubPage } from './store'
import type { BatchTask, VirtualLearnerRow as Sample } from './virtualLearnersTypes'

const props = defineProps<{
  runningSamples: Sample[]
  pausedSamples: Sample[]
  task: BatchTask | null
}>()
const emit = defineEmits<{
  (e: 'toggleDetail'): void
  (e: 'retry'): void
  (e: 'dismiss'): void
}>()

const batchTaskStatusTitle = computed(() => {
  const t = props.task
  if (!t) return ''
  if (t.status === 'done') return `批量创建完成：${t.created} 人${t.totalStories ? ` · ${t.storiesDone} 个故事` : ''}`
  if (t.status === 'error') return `批量生成有失败：${t.error}（点击展开可重试）`
  return `后台生成中：身份 ${t.total - t.personaLeft}/${t.total}${t.totalStories ? ` · 故事 ${t.storiesDone}/${t.totalStories}` : ''}（点击展开详情）`
})
/* 批量进度（批F）：三阶段（建人/身份/故事）加权折算百分比 */
const batchPct = computed(() => {
  const t = props.task
  if (!t || !t.total) return 0
  const stages = [t.created, t.total - (t.personaLeft || 0), t.totalStories ? t.storiesDone : null].filter((v): v is number => v != null)
  const done = stages.reduce((a, b) => a + b, 0)
  const sum = stages.length * t.total
  return Math.min(Math.round((done / Math.max(sum, 1)) * 100), 100)
})

/* ===== 阶段聚合（2026-10-05 用户拍板）===== */
const FEW_LIMIT = 4
const PAUSED_CHIPS_LIMIT = 4
/* 阶段序 = 教学流水线；色板用家族语义 token（Goal 紫 / Path 绿 / Learn 蓝 / Wrapup 琥珀），
   与编排图跨阶段/终点强调色同源（--mk-graph-accent-purple-ink 系），不私造色值 */
const STAGE_ORDER = ['Goal', 'Path', 'Learn', 'Wrapup'] as const
const STAGE_TONES: Record<string, string> = {
  Goal: 'var(--mk-purple)',
  Path: 'var(--mk-green)',
  Learn: 'var(--mk-blue)',
  Wrapup: 'var(--mk-amber)',
  Other: 'var(--mk-faint)',
}
/** 后端 currentStage 原文（goal/path/teaching/learn/wrapup 等）→ 中文阶段名 */
function stageLabel(stage: string | null | undefined): string {
  const s = String(stage || '').toLowerCase()
  if (s.includes('goal')) return 'Goal'
  if (s.includes('path')) return 'Path'
  if (s.includes('learn') || s.includes('teach')) return 'Learn'
  if (s.includes('wrap')) return 'Wrapup'
  return s || '—'
}
function stageKeyOf(s: Sample): string {
  const label = stageLabel(s.currentStage)
  return (STAGE_ORDER as readonly string[]).includes(label) ? label : 'Other'
}
const fewMode = computed(() => props.runningSamples.length + props.pausedSamples.length <= FEW_LIMIT)
const stageBins = computed(() => {
  const counts = new Map<string, number>()
  for (const s of props.runningSamples) counts.set(stageKeyOf(s), (counts.get(stageKeyOf(s)) || 0) + 1)
  return [...STAGE_ORDER, 'Other' as const]
    .map((key) => ({
      key,
      label: key === 'Other' ? '其它' : key,
      n: counts.get(key) || 0,
      tone: STAGE_TONES[key],
      hint: key === 'Other' ? '阶段字段缺失或无法识别的会话' : '',
    }))
    .filter((b) => b.n > 0)
})
const activeStage = ref('')
function toggleStage(key: string) {
  activeStage.value = activeStage.value === key ? '' : key
}
const activeChips = computed(() => {
  if (fewMode.value) return props.runningSamples
  if (!activeStage.value) return []
  return props.runningSamples.filter((s) => stageKeyOf(s) === activeStage.value)
})
function chipTitle(s: Sample): string {
  return `${s.runningCount} 个会话进行中 · 点击进入会话座舱`
}
const visiblePausedChips = computed(() => props.pausedSamples.slice(0, PAUSED_CHIPS_LIMIT))

/** 「进行中」列点击直达会话座舱（画像页入口保持：行点击/画像按钮） */
function openRunningSession(s: Sample) {
  const id = s.runningSessionIds[0]
  if (id) openSubPage('session', id)
}
</script>

<style scoped>
/* ===== 正在运行条：原型 .statusbar 词汇——中性壳（line 描边 + surface 底），
   活跃感只由绿点与 chip 色调承载。
   2026-10-05 二次重排：①阶段聚合——实例 chip 收敛为 MkDistBand 分布条（点段展开实例），
   横滚与大规模平铺都退役；②脉冲降噪——chip 绿点全改静态，脉冲只留条首大点与批量 chip；
   ③间距归页栈 --mk-stack-gap（原 margin:10px 与页栅格叠加成 22px 双重节拍） ===== */
.vl-running {
  padding: 5px 12px;
  border-radius: var(--mk-radius-xl);
  border: 1px solid var(--mk-line);
  background: var(--mk-surface);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  row-gap: 4px;
  min-width: 0;
}
/* 阶段分布条：吃条内剩余宽度（band+图例两行由 MkDistBand 自带栅格承载） */
.vl-running__band { flex: 1 1 260px; min-width: 0; }
/* 实例 chip 行（少量全量 / 选中阶段展开）：折行铺开，永不横滚 */
.vl-running__chips { flex-basis: 100%; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; }
.vl-running__overflow {
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  white-space: nowrap;
}
.vl-running__label {
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  color: var(--mk-ink);
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.vl-running__label::before {
  content: '';
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--mk-green);
  box-shadow: 0 0 0 0 color-mix(in srgb, var(--mk-green) 50%, transparent);
  animation: vl-pulse 1.6s infinite;
}

.vl-running__chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--mk-green) 35%, transparent);
  background: var(--mk-surface);
  color: var(--mk-green);
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  cursor: pointer;
  transition: background 0.12s ease;
  flex-shrink: 0;
  white-space: nowrap;
}
.vl-running__chip:hover { background: color-mix(in srgb, var(--mk-green) 10%, transparent); }
.vl-running__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--mk-green);
  flex-shrink: 0;
  /* 脉冲已撤（2026-10-05 降噪）：几十个 chip 每点都动画 = 绿光墙 + 无谓重绘；
     活感由条首 label 大点（仍在 vl-pulse）单源承载 */
}
@keyframes vl-pulse {
  0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--mk-green) 50%, transparent); }
  70% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--mk-green) 0%, transparent); }
  100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--mk-green) 0%, transparent); }
}

/* 批量生成 chip（并入「正在运行」区） */
.vl-running__chip--batch { border-color: color-mix(in srgb, var(--mk-blue) 40%, transparent); color: var(--mk-blue); }
.vl-running__chip--batch .vl-running__dot { background: var(--mk-blue); box-shadow: 0 0 0 0 color-mix(in srgb, var(--mk-blue) 50%, transparent); animation: vl-pulse 1.6s infinite; }
/* 已暂停自动驾驶：灰色静态（无脉冲），点击进画像页 */
.vl-running__chip--paused { border-color: color-mix(in srgb, var(--mk-faint-soft) 45%, transparent); color: var(--mk-muted); }
.vl-running__chip--paused .vl-running__dot { background: var(--mk-faint-soft); box-shadow: none; animation: none; }
.vl-running__chip--paused:hover { background: color-mix(in srgb, var(--mk-faint-soft) 12%, transparent); }
.vl-running__chip--batch.is-running { border-color: color-mix(in srgb, var(--mk-blue) 45%, transparent); }
.vl-running__chip--batch.is-done { border-color: color-mix(in srgb, var(--mk-green) 40%, transparent); color: var(--mk-green); }
.vl-running__chip--batch.is-done .vl-running__dot { background: var(--mk-green); animation: none; }
.vl-running__chip--batch.is-error { border-color: color-mix(in srgb, var(--mk-red-fill) 45%, transparent); color: var(--mk-red); }
.vl-running__chip--batch.is-error .vl-running__dot { background: var(--mk-red-fill); animation: none; }
/* 批量生成详情行（点 chip 展开）：mk-alert 形态，此处只留弹性布局 */
.vl-batch-detail { display: flex; align-items: center; gap: 12px; margin-top: 8px; flex-basis: 100%; }
.vl-batch-detail__bar { display: block; width: 120px; height: 5px; flex: none; }
.vl-batch-detail__text { display: flex; align-items: center; gap: 10px; color: var(--mk-muted, #5b6577); flex: 1; }
.vl-batch-detail__err { color: var(--mk-red, #dc2626); }
</style>
