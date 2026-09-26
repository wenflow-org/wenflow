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
  font-size: var(--mk-fs-micro);
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
  font-size: var(--mk-fs-micro);
  font-weight: 800;
  line-height: 1;
}
.rs-bar__label { font-weight: 600; color: var(--mk-faint-soft); }
.rs-bar__connector { width: 10px; height: 2px; background: var(--mk-line); border-radius: var(--mk-radius-xs); flex-shrink: 0; }

/* 节点状态着色 */
.rs-bar__node--done .rs-bar__dot { background: var(--mk-green); color: var(--mk-surface); }
.rs-bar__node--done .rs-bar__label { color: var(--mk-green); }
.rs-bar__node--doing .rs-bar__dot { background: var(--mk-blue); color: var(--mk-surface); animation: rsbar-pulse 1.4s infinite; }
.rs-bar__node--doing .rs-bar__label { color: var(--mk-blue); }
.rs-bar__node--todo .rs-bar__dot { background: var(--mk-surface-2); color: var(--mk-faint-soft); border: 1px solid var(--mk-line); }
.rs-bar__node--fail .rs-bar__dot { background: var(--mk-red-fill); color: var(--mk-surface); }
.rs-bar__node--fail .rs-bar__label { color: var(--mk-red); }
.rs-bar__node--skip .rs-bar__dot { background: var(--mk-surface-2); color: var(--mk-faint-soft); border: 1px dashed var(--mk-line); }
.rs-bar__node--skip .rs-bar__label { color: var(--mk-faint-soft); text-decoration: line-through; }

.rs-bar__connector--done { background: var(--mk-green); }
.rs-bar__task { margin-left: 4px; color: var(--mk-muted); font-weight: 600; font-size: var(--mk-fs-micro); }
.rs-bar__done { margin-left: 4px; color: var(--mk-green); font-weight: 700; }

@keyframes rsbar-pulse {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--mk-blue) 40%, transparent); }
  50% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--mk-blue) 0%, transparent); }
}

/* 紧凑模式 */
.rs-bar--compact .rs-bar__node { padding: 0 2px; }
.rs-bar--compact .rs-bar__dot { width: 12px; height: 12px; font-size: var(--mk-fs-micro); }
</style>
