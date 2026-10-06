<script setup lang="ts">
/**
 * 生命周期状态徽章（轴 A）
 * 双轴分离：本组件只表达「会话生命周期」，阶段进度见 RunStageBar。
 * 视觉：颜色 + 图标 + 文案三件套（色弱友好双通道）。
 */
import { computed } from 'vue'
import { runStateTone, runStateIcon, statusText, type RunStateTone } from './statusText'

const props = withDefaults(defineProps<{
  /** 生命周期状态：created/queued/running/paused/pausing/resuming/failed/completed/abandoned… */
  status?: string | null
  /** 附加说明（hover tooltip 用） */
  hint?: string
  /** 是否显示脉冲动画（running/queued 默认开启） */
  pulse?: boolean
  /** 紧凑模式（只显示点+图标，不显示文字） */
  compact?: boolean
  /** 挂点击语义（进会话座舱等）：根元素输出 role=button + tabindex=0，
      并监听 Enter/Space 激活（审核 #60：裸 span 挂点击键盘不可达） */
  clickable?: boolean
}>(), {
  status: null,
  hint: '',
  pulse: true,
  compact: false,
  clickable: false,
})

const tone = computed<RunStateTone>(() => runStateTone(props.status))
const icon = computed(() => runStateIcon(props.status))
const text = computed(() => statusText(props.status))
const isRunning = computed(() => props.status === 'running' || props.status === 'active')
const isQueued = computed(() => props.status === 'queued')
const animated = computed(() => props.pulse && (isRunning.value || isQueued.value))

/** 键盘激活：把 Enter/Space 转成一次真实 click（父级 @click 处理器照常生效） */
function onActivate(e: KeyboardEvent) {
  if (!props.clickable) return
  e.preventDefault()
  ;(e.currentTarget as HTMLElement | null)?.click()
}
</script>

<template>
  <span
    class="rs-badge"
    :class="[`rs-badge--${tone}`, { 'rs-badge--compact': compact, 'rs-badge--anim': animated, 'rs-badge--clickable': clickable }]"
    :title="hint || text"
    :role="clickable ? 'button' : undefined"
    :tabindex="clickable ? 0 : undefined"
    @keydown.enter="onActivate"
    @keydown.space="onActivate"
  >
    <span class="rs-badge__icon" aria-hidden="true">{{ icon }}</span>
    <span v-if="!compact" class="rs-badge__text">{{ text }}</span>
  </span>
</template>

<style scoped>
.rs-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  line-height: 1.5;
  white-space: nowrap;
  border: 1px solid transparent;
  cursor: default;
}
/* 可点击档（#60）：鼠标可点 + 键盘焦点环，与同页名称格 vl-cell--click 同款 */
.rs-badge--clickable { cursor: pointer; }
.rs-badge--clickable:hover { border-color: color-mix(in srgb, currentColor 45%, transparent); }
.rs-badge--clickable:focus-visible { outline: 2px solid var(--mk-blue); outline-offset: 1px; }
.rs-badge__icon { font-size: var(--mk-fs-micro); line-height: 1; flex-shrink: 0; }
.rs-badge--compact { padding: 2px 6px; }

/* 色板：Prefect 风格（颜色 + 形状双通道） */
.rs-badge--ok { background: rgba(42, 199, 105, 0.14); color: #0e8a4d; border-color: rgba(42, 199, 105, 0.35); }
.rs-badge--bad { background: rgba(251, 78, 78, 0.12); color: #d92d20; border-color: rgba(251, 78, 78, 0.35); }
.rs-badge--warn { background: rgba(252, 209, 78, 0.18); color: #8a6d00; border-color: rgba(252, 209, 78, 0.45); }
.rs-badge--info { background: rgba(24, 96, 242, 0.1); color: #1d4ed8; border-color: rgba(24, 96, 242, 0.3); }
.rs-badge--muted { background: rgba(100, 116, 139, 0.12); color: #64748b; border-color: rgba(100, 116, 139, 0.3); }
.rs-badge--running { background: rgba(24, 96, 242, 0.12); color: var(--mk-accent-deep); border-color: rgba(24, 96, 242, 0.4); }
.rs-badge--queued { background: #ede7f6; color: #4527a0; border-color: #b39ddb; }
.rs-badge--paused { background: rgba(100, 116, 139, 0.14); color: #64748b; border-color: rgba(100, 116, 139, 0.4); }

/* 脉冲动画：running/queued 常态可用 */
@keyframes rs-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(24, 96, 242, 0.35); }
  50% { box-shadow: 0 0 0 4px rgba(24, 96, 242, 0); }
}
.rs-badge--anim .rs-badge__icon { animation: rs-pulse 1.6s infinite; }

/* 暗色模式：深底上原配色（深绿/深蓝/深紫）对比不足，换暗色 token 等阶（对齐全站状态色） */
html[data-theme='dark'] .rs-badge--ok { background: rgba(74, 222, 128, 0.14); color: #4ade80; border-color: rgba(74, 222, 128, 0.35); }
html[data-theme='dark'] .rs-badge--bad { background: rgba(248, 113, 113, 0.14); color: #f87171; border-color: rgba(248, 113, 113, 0.35); }
html[data-theme='dark'] .rs-badge--warn { background: rgba(251, 191, 36, 0.14); color: #fbbf24; border-color: rgba(251, 191, 36, 0.45); }
html[data-theme='dark'] .rs-badge--info { background: color-mix(in srgb, var(--wf-color-primary) 16%, transparent); color: var(--wf-color-primary-light); border-color: color-mix(in srgb, var(--wf-color-primary) 40%, transparent); }
html[data-theme='dark'] .rs-badge--muted { background: #2d2d2f; color: var(--mk-muted); border-color: #393a3c; }
html[data-theme='dark'] .rs-badge--running { background: color-mix(in srgb, var(--wf-color-primary) 18%, transparent); color: var(--wf-color-primary-light); border-color: color-mix(in srgb, var(--wf-color-primary) 45%, transparent); }
html[data-theme='dark'] .rs-badge--queued { background: color-mix(in srgb, var(--mk-purple) 16%, transparent); color: var(--wf-color-accent-light); border-color: color-mix(in srgb, var(--mk-purple) 45%, transparent); }
html[data-theme='dark'] .rs-badge--paused { background: #2d2d2f; color: var(--mk-muted); border-color: #393a3c; }
@keyframes rs-pulse-dark {
  0%, 100% { box-shadow: 0 0 0 0 rgba(91, 141, 239, 0.4); }
  50% { box-shadow: 0 0 0 4px rgba(91, 141, 239, 0); }
}
html[data-theme='dark'] .rs-badge--anim .rs-badge__icon { animation-name: rs-pulse-dark; }
</style>
