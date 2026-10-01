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
</script>

<template>
  <span class="rs-bar" :class="{ 'rs-bar--compact': compact }" role="img" :aria-label="'阶段进度'">
    <template v-for="(name, i) in RUN_STAGE_ORDER" :key="name">
      <span
        class="rs-bar__node"
        :class="`rs-bar__node--${states[name]}`"
        :title="`${LABEL[name]}：${states[name] === 'done' ? '已完成' : states[name] === 'doing' ? '进行中' : states[name] === 'fail' ? '失败' : states[name] === 'skip' ? '跳过' : '待执行'}${name === 'learn' && taskText ? `（${taskText}）` : ''}`"
      >
        <!-- 节点圆点：原型 .stagedots > i（7px，done=品牌实心 / cur=品牌+品牌底环 /
             alert=琥珀+琥珀底环 / bad=红+红底环）；状态文字由 title 承载，不再用 ✓/✕ 字形
             （7px 圆点容不下字形，且原型圆点本身不带头字形）。-->
        <span class="rs-bar__dot" :class="`rs-bar__dot--${states[name]}`" aria-hidden="true"></span>
        <span v-if="!compact" class="rs-bar__label">{{ LABEL[name] }}</span>
      </span>
      <span v-if="i < RUN_STAGE_ORDER.length - 1" class="rs-bar__connector" :class="{ 'rs-bar__connector--done': states[RUN_STAGE_ORDER[i]] === 'done' }" aria-hidden="true"></span>
    </template>
    <span v-if="taskText && !compact" class="rs-bar__task">{{ taskText }}</span>
    <!-- 原条件里的 DONE_TEXT && 恒真（非空常量对象），仅保留真实条件：紧凑模式下节点绿✓过小，补一个「已跑完」尾标 -->
    <span v-if="status === 'completed' && compact" class="rs-bar__done">已跑完</span>
  </span>
</template>

<style scoped>
/* 阶段条（原型语言：.stageband 557-558 的 12px 高圆角条 + .stagedots 565-570 的 7px 圆点）。
   语义是「流程节点」而非筛选，保持 stepper 形态（原型 dot 顺排 + 节点名），只统一 token 与尺寸。 */
.rs-bar {
  display: inline-flex;
  align-items: center;
  /* gap 3px = 原型 .stagedots（565） */
  gap: 3px;
  font-size: var(--mk-fs-micro);
  white-space: nowrap;
}
.rs-bar__node {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 4px;
  border-radius: var(--mk-radius-xs);
  cursor: default;
}
/* 圆点 7px = 原型 .stagedots > i（566）；四态色见下，基础态 = 原型未命名的 surface-3 */
.rs-bar__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--mk-surface-3);
  flex: none;
}
.rs-bar__label { font-weight: 600; color: var(--mk-faint-soft); }
/* 连接段 = 原型 .stageband 的 12px 高圆角条：未到达走凹槽底，已完成走品牌色 */
.rs-bar__connector {
  width: 14px;
  height: 12px;
  background: var(--mk-surface-3);
  border-radius: 999px;
  flex-shrink: 0;
}

/* 节点状态着色（原型 .stagedots：done/cur/alert/bad 四态 + 基础态）
   done → 原型 .done（品牌实心）；doing → 原型 .cur（品牌实心 + 品牌底环 + 脉冲）；
   fail → 原型 .bad（红 + 红底环）；skip → 原型 .alert（琥珀 + 琥珀底环）。 */
.rs-bar__dot--done { background: var(--mk-blue); }
.rs-bar__dot--doing {
  background: var(--mk-blue);
  animation: rsbar-pulse 1.4s infinite;
}
.rs-bar__dot--todo { background: var(--mk-surface-3); }
.rs-bar__dot--fail { background: var(--mk-red); box-shadow: 0 0 0 3px var(--mk-red-bg); }
.rs-bar__dot--skip { background: var(--mk-amber); box-shadow: 0 0 0 3px var(--mk-amber-bg); }
.rs-bar__node--done .rs-bar__label { color: var(--mk-blue); }
.rs-bar__node--doing .rs-bar__label { color: var(--mk-blue); }
.rs-bar__node--fail .rs-bar__label { color: var(--mk-red); }
.rs-bar__node--skip .rs-bar__label { color: var(--mk-amber); }

.rs-bar__connector--done { background: var(--mk-blue); }
.rs-bar__task { margin-left: 4px; color: var(--mk-muted); font-weight: 600; font-size: var(--mk-fs-micro); }
.rs-bar__done { margin-left: 4px; color: var(--mk-blue); font-weight: 700; }

/* 进行中脉冲：品牌底环由 3px 扩散回 0（环本身随 .rs-bar__dot--doing 的 box-shadow 给出） */
@keyframes rsbar-pulse {
  0%, 100% { box-shadow: 0 0 0 3px var(--mk-blue-bg); }
  50% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--mk-blue) 0%, transparent); }
}

/* 紧凑模式：仅节点留白收紧，圆点保持 7px 原型尺寸 */
.rs-bar--compact .rs-bar__node { padding: 0 2px; }
</style>
