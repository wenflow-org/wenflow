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
}>(), {
  status: null,
  hint: '',
  pulse: true,
  compact: false,
})

const tone = computed<RunStateTone>(() => runStateTone(props.status))
const icon = computed(() => runStateIcon(props.status))
const text = computed(() => statusText(props.status))
const isRunning = computed(() => props.status === 'running' || props.status === 'active')
const isQueued = computed(() => props.status === 'queued')
const animated = computed(() => props.pulse && (isRunning.value || isQueued.value))
</script>

<template>
  <span
    class="rs-badge"
    :class="[`rs-badge--${tone}`, { 'rs-badge--compact': compact, 'rs-badge--anim': animated }]"
    :title="hint || text"
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
  font-size: 11px;
  font-weight: 700;
  line-height: 1.5;
  white-space: nowrap;
  border: 1px solid transparent;
  cursor: default;
}
.rs-badge__icon { font-size: 10px; line-height: 1; flex-shrink: 0; }
.rs-badge--compact { padding: 2px 6px; }

/* 色板：Prefect 风格（颜色 + 形状双通道） */
.rs-badge--ok { background: rgba(42, 199, 105, 0.14); color: #0e8a4d; border-color: rgba(42, 199, 105, 0.35); }
.rs-badge--bad { background: rgba(251, 78, 78, 0.12); color: #d92d20; border-color: rgba(251, 78, 78, 0.35); }
.rs-badge--warn { background: rgba(252, 209, 78, 0.18); color: #8a6d00; border-color: rgba(252, 209, 78, 0.45); }
.rs-badge--info { background: rgba(24, 96, 242, 0.1); color: #1d4ed8; border-color: rgba(24, 96, 242, 0.3); }
.rs-badge--muted { background: rgba(100, 116, 139, 0.12); color: #64748b; border-color: rgba(100, 116, 139, 0.3); }
.rs-badge--running { background: rgba(24, 96, 242, 0.12); color: #1860f2; border-color: rgba(24, 96, 242, 0.4); }
.rs-badge--queued { background: #ede7f6; color: #4527a0; border-color: #b39ddb; }
.rs-badge--paused { background: rgba(100, 116, 139, 0.14); color: #64748b; border-color: rgba(100, 116, 139, 0.4); }

/* 脉冲动画：running/queued 常态可用 */
@keyframes rs-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(24, 96, 242, 0.35); }
  50% { box-shadow: 0 0 0 4px rgba(24, 96, 242, 0); }
}
.rs-badge--anim .rs-badge__icon { animation: rs-pulse 1.6s infinite; }
</style>
