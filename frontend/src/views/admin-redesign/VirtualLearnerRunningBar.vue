<template>
  <!-- 正在运行：列出有活跃会话的虚拟学习者（折叠：默认前 RUN_CHIPS_LIMIT 个，展开看全部）；批量生成也在此显示 -->
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
    <!-- 进行中（前 RUN_CHIPS_LIMIT 个，超出折叠） -->
    <button v-for="s in visibleRunChips" :key="s.id" type="button" class="vl-running__chip" :title="`${s.runningCount} 个会话进行中 · 点击进入会话座舱`" @click="openRunningSession(s)">
      <span class="vl-running__dot" aria-hidden="true"></span>
      {{ s.name }}<template v-if="s.currentStage"> · {{ stageLabel(s.currentStage) }}</template>
    </button>
    <!-- 已暂停：autopilot 已停（会话保留），灰色 chip 点击进画像页 -->
    <button v-for="s in visiblePausedChips" :key="`p-${s.id}`" type="button" class="vl-running__chip vl-running__chip--paused" :title="`${s.pausedCount} 个会话已暂停自动驾驶（进度保留）；点击进入画像页`" @click="openSubPage('virtual', s.id)">
      <span class="vl-running__dot" aria-hidden="true"></span>
      {{ s.name }} · 已暂停{{ s.pausedCount > 1 ? ` ${s.pausedCount}` : '' }}
    </button>
    <!-- 折叠展开/收起 -->
    <button v-if="runChipTotal > RUN_CHIPS_LIMIT" type="button" class="vl-running__more" @click="runChipsExpanded = !runChipsExpanded">
      {{ runChipsExpanded ? '收起' : `还有 ${runChipTotal - RUN_CHIPS_LIMIT} 个` }} ▾
    </button>
    <!-- 批量生成详情行（点 chip 展开）：进度 + 重试 + 关闭 -->
    <div v-if="task?.active && task.expanded" class="mk-alert mk-alert--info vl-batch-detail" role="status">
      <span class="vl-batch-detail__text">
        创建 {{ task.created }}/{{ task.total }} 人
        <template v-if="task.personaLeft > 0"> · 生成身份 {{ task.total - task.personaLeft }}/{{ task.total }}</template>
        <template v-if="task.totalStories"> · 生成故事 {{ task.storiesDone }}/{{ task.totalStories }}</template>
        <template v-if="task.error"> · <span class="vl-batch-detail__err">{{ task.error }}</span></template>
      </span>
      <button v-if="task.status === 'error'" type="button" class="mk-btn mk-btn--sm" @click="emit('retry')">重试失败</button>
      <button v-if="task.status === 'done' || task.status === 'error'" type="button" class="mk-link" @click="emit('dismiss')">✕ 关闭</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
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

/* 「正在运行」区折叠：默认显示前 RUN_CHIPS_LIMIT 个 chip，超出折叠（压缩顶部高度，表格尽早露出） */
const RUN_CHIPS_LIMIT = 4
const runChipsExpanded = ref(false)
const runChipTotal = computed(() => props.runningSamples.length + props.pausedSamples.length)
const visibleRunChips = computed(() => {
  const list = props.runningSamples
  if (runChipsExpanded.value) return list
  return list.slice(0, RUN_CHIPS_LIMIT)
})
const visiblePausedChips = computed(() => {
  const list = props.pausedSamples
  if (runChipsExpanded.value) return list
  const runningShown = visibleRunChips.value.length
  return list.slice(0, Math.max(0, RUN_CHIPS_LIMIT - runningShown))
})

/** 「进行中」列点击直达会话座舱（画像页入口保持：行点击/画像按钮） */
function openRunningSession(s: Sample) {
  const id = s.runningSessionIds[0]
  if (id) openSubPage('session', id)
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
</script>

<style scoped>
/* 「正在运行」折叠展开按钮 */
.vl-running__more {
  border: 1px dashed #cbd5e1;
  background: #fff;
  color: #64748b;
  font-size: var(--mk-fs-12);
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 999px;
  cursor: pointer;
  transition: background 0.12s ease;
  flex-shrink: 0;
}
.vl-running__more:hover { background: rgba(100, 116, 139, 0.08); }

/* 批量生成 chip（并入「正在运行」区） */
.vl-running__chip--batch { border-color: rgba(59, 130, 246, 0.4); color: #1d4ed8; }
.vl-running__chip--batch .vl-running__dot { background: #3b82f6; box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.5); animation: vl-pulse 1.6s infinite; }
/* 已暂停自动驾驶：灰色静态（无脉冲），点击进画像页 */
.vl-running__chip--paused { border-color: rgba(148, 163, 184, 0.45); color: #64748b; }
.vl-running__chip--paused .vl-running__dot { background: #94a3b8; box-shadow: none; animation: none; }
.vl-running__chip--paused:hover { background: rgba(148, 163, 184, 0.12); }
.vl-running__chip--batch.is-running { border-color: rgba(59, 130, 246, 0.45); }
.vl-running__chip--batch.is-done { border-color: rgba(16, 185, 129, 0.4); color: #065f46; }
.vl-running__chip--batch.is-done .vl-running__dot { background: #10b981; animation: none; }
.vl-running__chip--batch.is-error { border-color: rgba(239, 68, 68, 0.45); color: #dc2626; }
.vl-running__chip--batch.is-error .vl-running__dot { background: #ef4444; animation: none; }
@keyframes vl-pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.4); } 50% { box-shadow: 0 0 0 5px rgba(59, 130, 246, 0); } }
/* 批量生成详情行（点 chip 展开）：mk-alert 形态，此处只留弹性布局 */
.vl-batch-detail { display: flex; align-items: center; gap: 12px; margin-top: 8px; flex-basis: 100%; }
.vl-batch-detail__text { color: var(--mk-muted, #5b6577); flex: 1; }
.vl-batch-detail__err { color: var(--mk-red, #dc2626); }

/* ===== 正在运行条：直接列名当前活跃虚拟学习者（绿点呼吸动画） ===== */
.vl-running {
  margin: 10px 0 0;
  padding: 5px 12px;
  border-radius: 10px;
  border: 1px solid rgba(16, 185, 129, 0.3);
  background: rgba(16, 185, 129, 0.06);
  display: flex;
  align-items: center;
  gap: 6px;
  /* 单行 + 横向滚动：chips 再多也不换行撑高，保持顶部紧凑 */
  flex-wrap: nowrap;
  overflow-x: auto;
  scrollbar-width: thin;
}
.vl-running::-webkit-scrollbar { height: 4px; }
.vl-running::-webkit-scrollbar-thumb { background: rgba(16, 185, 129, 0.3); border-radius: 2px; }
.vl-running__label {
  font-size: var(--mk-fs-12);
  font-weight: 800;
  color: #047857;
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
  background: #10b981;
  box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.5);
  animation: vl-pulse 1.6s infinite;
}

.vl-running__chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px;
  border-radius: 999px;
  border: 1px solid rgba(16, 185, 129, 0.35);
  background: #fff;
  color: #065f46;
  font-size: var(--mk-fs-12);
  font-weight: 700;
  cursor: pointer;
  transition: background 0.12s ease;
  flex-shrink: 0;
  white-space: nowrap;
}
.vl-running__chip:hover { background: rgba(16, 185, 129, 0.1); }
.vl-running__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #10b981;
  box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.5);
  animation: vl-pulse 1.6s infinite;
  flex-shrink: 0;
}
@keyframes vl-pulse {
  0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.5); }
  70% { box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); }
  100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
}

/* 暗色模式：正在运行条 */
html[data-theme='dark'] {
  .vl-running__chip { background: #141c2b; border-color: #232f45; color: #4ade80; }
  .vl-running__chip--paused { color: #8fa3bd; }
  .vl-running__chip--batch { color: #7aa2ff; }
  .vl-running__chip--batch.is-done { color: #4ade80; }
  .vl-running__chip--batch.is-error { color: #f87171; }
  .vl-running__label { color: #4ade80; }
  .vl-running__more { background: #141c2b; border-color: #2a3850; color: #8fa3bd; }
}
</style>
