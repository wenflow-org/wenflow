<script setup lang="ts">
/**
 * 自动驾驶阶段进度条（轴 B）：Goal → Path → Learn
 * 双轴分离：本组件只表达「阶段进度」，生命周期见 RunStateBadge。
 * 节点独立着色：完成绿✓ / 进行中蓝脉冲 / 待执行灰○ / 失败红 / 跳过灰暗。
 */
import { computed } from 'vue'
import { runStageStates, RUN_STAGE_ORDER, runTaskProgressText, type RunStageName, type RunStageState } from './statusText'

const props = withDefaults(defineProps<{
  stage?: string | null
  status?: string | null
  taskProgress?: { done: number; total: number } | null
  /** 是否显示任务进度文本（learn 阶段） */
  showTaskText?: boolean
  /** 紧凑：无文字标签，只显示节点点 */
  compact?: boolean
}>(), {
  stage: null,
  status: null,
  taskProgress: null,
  showTaskText: true,
  compact: false,
})

const states = computed<Record<RunStageName, RunStageState>>(() =>
  runStageStates({ stage: props.stage, status: props.status, taskProgress: props.taskProgress })
)
const taskText = computed(() => (props.showTaskText ? runTaskProgressText(props.taskProgress) : ''))

const LABEL: Record<RunStageName, string> = { goal: 'Goal', path: 'Path', learn: 'Learn' }
const DONE_TEXT: Record<RunStageName, string> = { goal: '目标', path: '路径', learn: '学习' }
</script>

<template>
  <span class="rs-bar" :class="{ 'rs-bar--compact': compact }" role="img" :aria-label="'阶段进度'">
    <template v-for="(name, i) in RUN_STAGE_ORDER" :key="name">
      <span
        class="rs-bar__node"
        :class="`rs-bar__node--${states[name]}`"
        :title="`${LABEL[name]}：${states[name] === 'done' ? '已完成' : states[name] === 'doing' ? '进行中' : states[name] === 'fail' ? '失败' : states[name] === 'skip' ? '跳过' : '待执行'}${name === 'learn' && taskText ? `（${taskText}）` : ''}`"
      >
        <span class="rs-bar__dot" aria-hidden="true">
          {{ states[name] === 'done' ? '✓' : states[name] === 'fail' ? '✕' : '' }}
        </span>
        <span v-if="!compact" class="rs-bar__label">{{ LABEL[name] }}</span>
      </span>
      <span v-if="i < RUN_STAGE_ORDER.length - 1" class="rs-bar__connector" :class="{ 'rs-bar__connector--done': states[RUN_STAGE_ORDER[i]] === 'done' }" aria-hidden="true"></span>
    </template>
    <span v-if="taskText && !compact" class="rs-bar__task">{{ taskText }}</span>
    <span v-if="DONE_TEXT && status === 'completed' && compact" class="rs-bar__done">已跑完</span>
  </span>
</template>

<style scoped>
.rs-bar {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: var(--mk-fs-11);
  white-space: nowrap;
}
.rs-bar__node {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 4px;
  border-radius: 4px;
  cursor: default;
}
.rs-bar__dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  font-weight: 800;
  line-height: 1;
}
.rs-bar__label { font-weight: 600; color: #94a3b8; }
.rs-bar__connector { width: 10px; height: 2px; background: #e2e8f0; border-radius: 1px; flex-shrink: 0; }

/* 节点状态着色 */
.rs-bar__node--done .rs-bar__dot { background: #2ac769; color: #fff; }
.rs-bar__node--done .rs-bar__label { color: #0e8a4d; }
.rs-bar__node--doing .rs-bar__dot { background: #1860f2; color: #fff; animation: rsbar-pulse 1.4s infinite; }
.rs-bar__node--doing .rs-bar__label { color: #1860f2; }
.rs-bar__node--todo .rs-bar__dot { background: #f1f5f9; color: #94a3b8; border: 1px solid #cbd5e1; }
.rs-bar__node--fail .rs-bar__dot { background: #fb4e4e; color: #fff; }
.rs-bar__node--fail .rs-bar__label { color: #d92d20; }
.rs-bar__node--skip .rs-bar__dot { background: #f8fafc; color: #cbd5e1; border: 1px dashed #e2e8f0; }
.rs-bar__node--skip .rs-bar__label { color: #cbd5e1; text-decoration: line-through; }

.rs-bar__connector--done { background: #2ac769; }
.rs-bar__task { margin-left: 4px; color: #64748b; font-weight: 600; font-size: var(--mk-fs-11); }
.rs-bar__done { margin-left: 4px; color: #0e8a4d; font-weight: 700; }

@keyframes rsbar-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(24, 96, 242, 0.4); }
  50% { box-shadow: 0 0 0 3px rgba(24, 96, 242, 0); }
}

/* 紧凑模式 */
.rs-bar--compact .rs-bar__node { padding: 0 2px; }
.rs-bar--compact .rs-bar__dot { width: 12px; height: 12px; font-size: 8px; }

/* ================= 暗色模式（D1 补完）：阶段进度条 ================= */
html[data-theme='dark'] {
  .rs-bar__connector { background: #2a3850; }
  .rs-bar__node--todo .rs-bar__dot { background: #1d2739; color: #64748b; border-color: #33415c; }
  .rs-bar__node--skip .rs-bar__dot { background: #1d2739; color: #3d4c66; border-color: #2a3850; }
}
</style>
