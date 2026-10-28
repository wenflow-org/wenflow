<template>
  <!-- 正在运行（2026-10-05 用户拍板「阶段聚合」）：不再穷举实例 chip（45 个平铺不可扫描，
       外部评审命中），汇总为阶段分布条（MkDistBand 家族标准件，段=教学流水线 Goal→Path→
       Learn→Wrapup）；点段/图例展开该阶段实例 chip（仍可跳会话座舱）。
       少量实例（≤FEW_LIMIT）直接全量平铺（免二次点击）。
       2026-10-25：批量创建任务 chip 随「不播种、都派生」退役——建号只在卡库派生，
       本页不再有后台批量生成任务，这条只留运行阶段分布。 -->
  <div class="vl-running">
    <span class="vl-running__label">正在运行</span>
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
    <!-- 2026-10-21：已暂停 chip 退役——它把「谁停着」又列了一遍，列表状态列已经回答；
         这条只保留阶段分布（跑到哪个阶段是列里读不到的）。 -->
    <!-- 实例 chip：少量实例全量平铺；聚合模式展示选中阶段的实例（点击跳会话座舱） -->
    <div v-if="activeChips.length" class="vl-running__chips">
      <button v-for="s in activeChips" :key="s.id" type="button" class="vl-running__chip" :title="chipTitle(s)" @click="openRunningSession(s)">
        <span class="vl-running__dot" aria-hidden="true"></span>
        {{ s.name }}<template v-if="fewMode"> · {{ stageLabel(s.currentStage) }}</template><template v-else-if="s.runningCount > 1"> · {{ s.runningCount }}</template>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import MkDistBand from '@/components/mk/MkDistBand.vue'
import { openSubPage } from './store'
import type { VirtualLearnerRow as Sample } from './virtualLearnersTypes'

const props = defineProps<{
  runningSamples: Sample[]
}>()

/* ===== 阶段聚合（2026-10-05 用户拍板）===== */
const FEW_LIMIT = 4
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
/** 后端 currentStage 原文（goal/path/teaching/learn/wrapup 等）→ 阶段键（内部键，供分桶/色板） */
function stageKey(stage: string | null | undefined): string {
  const s = String(stage || '').toLowerCase()
  if (s.includes('goal')) return 'Goal'
  if (s.includes('path')) return 'Path'
  if (s.includes('learn') || s.includes('teach')) return 'Learn'
  if (s.includes('wrap')) return 'Wrapup'
  return s || '—'
}
/* 显示名与座舱 stageLabel 同词表（2026-10-14 统一：同一条流水线不两套名字） */
const STAGE_DISPLAY: Record<string, string> = { Goal: '目标', Path: '路径', Learn: '学习', Wrapup: '总结' }
function stageLabel(stage: string | null | undefined): string {
  const key = stageKey(stage)
  return STAGE_DISPLAY[key] || key
}
function stageKeyOf(s: Sample): string {
  const key = stageKey(s.currentStage)
  return (STAGE_ORDER as readonly string[]).includes(key) ? key : 'Other'
}
const fewMode = computed(() => props.runningSamples.length <= FEW_LIMIT)
const stageBins = computed(() => {
  const counts = new Map<string, number>()
  for (const s of props.runningSamples) counts.set(stageKeyOf(s), (counts.get(stageKeyOf(s)) || 0) + 1)
  return [...STAGE_ORDER, 'Other' as const]
    .map((key) => ({
      key,
      label: key === 'Other' ? '其它' : STAGE_DISPLAY[key] || key,
      n: counts.get(key) || 0,
      tone: STAGE_TONES[key],
      hint: key === 'Other' ? '阶段信息缺失或无法识别的会话' : '',
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
  return `${s.runningCount} 个会话进行中`
}

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
</style>
