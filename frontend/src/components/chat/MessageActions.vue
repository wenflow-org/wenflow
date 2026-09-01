<script setup lang="ts">
/**
 * MessageActions — hover action menu for AI message bubbles.
 * Shows: 有用 / 不佳 (message feedback), 重新生成 (hidden during streaming), 复制
 * Positioned top-right of the message bubble using CSS.
 */
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';

const props = defineProps<{
  show?: boolean;
  streaming?: boolean;
}>();

const emit = defineEmits<{
  regenerate: [];
  copy: [];
  feedback: [thumbsUp: boolean];
}>();

const copied = ref(false);
const feedbackSent = ref<'up' | 'down' | null>(null);

/** 触屏设备（无 hover）：操作常显，不依赖 hover 状态 */
const touchMode = ref(false);
let mq: MediaQueryList | null = null;
function syncTouchMode() {
  touchMode.value = mq?.matches === true;
}
onMounted(() => {
  if (typeof window !== 'undefined' && window.matchMedia) {
    mq = window.matchMedia('(hover: none)');
    syncTouchMode();
    mq.addEventListener('change', syncTouchMode);
  }
});
onBeforeUnmount(() => {
  mq?.removeEventListener('change', syncTouchMode);
});

/** 最终显示：触屏常显；桌面 hover 驱动 */
const visible = computed(() => touchMode.value || props.show === true);

async function handleCopy() {
  emit('copy');
  copied.value = true;
  setTimeout(() => { copied.value = false; }, 1500);
}

function handleFeedback(thumbsUp: boolean) {
  // 防重复：同一气泡已点过则忽略（或允许切换？点过即锁定，简单可靠）
  if (feedbackSent.value) return;
  feedbackSent.value = thumbsUp ? 'up' : 'down';
  emit('feedback', thumbsUp);
}
</script>

<template>
  <Transition name="actions-pop">
    <div v-show="visible" class="msg-actions">
      <button
        type="button"
        class="msg-actions__btn"
        :class="{ 'msg-actions__btn--sent-up': feedbackSent === 'up' }"
        :title="feedbackSent === 'up' ? '已标记有用' : '这条回复有用'"
        :disabled="!!feedbackSent"
        @click.stop="handleFeedback(true)"
      >
        <svg v-if="feedbackSent === 'up'" viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M1 21h4V9H1v12zM23 10a2 2 0 0 0-2-2h-6.31l.95-4.57.03-.32a1.5 1.5 0 0 0-.44-1.06L14.17 1 7.59 7.59A2 2 0 0 0 7 9v10a2 2 0 0 0 2 2h9a2 2 0 0 0 1.84-1.22l3.02-7.05A2 2 0 0 0 23 12v-2z"/></svg>
        <svg v-else viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M1 21h4V9H1v12zM23 10a2 2 0 0 0-2-2h-6.31l.95-4.57.03-.32a1.5 1.5 0 0 0-.44-1.06L14.17 1 7.59 7.59A2 2 0 0 0 7 9v10a2 2 0 0 0 2 2h9a2 2 0 0 0 1.84-1.22l3.02-7.05A2 2 0 0 0 23 12v-2z" opacity=".75"/></svg>
      </button>
      <button
        type="button"
        class="msg-actions__btn"
        :class="{ 'msg-actions__btn--sent-down': feedbackSent === 'down' }"
        :title="feedbackSent === 'down' ? '已标记不佳' : '这条回复不佳'"
        :disabled="!!feedbackSent"
        @click.stop="handleFeedback(false)"
      >
        <svg v-if="feedbackSent === 'down'" viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M15 3H6a2 2 0 0 0-1.84 1.22L2.14 11.27A2 2 0 0 0 2 12v2a2 2 0 0 0 2 2h6.31l-.95 4.57-.03.32a1.5 1.5 0 0 0 .44 1.06L11.83 23l6.58-6.59A2 2 0 0 0 19 15V5a2 2 0 0 0-2-2h-2z"/></svg>
        <svg v-else viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M15 3H6a2 2 0 0 0-1.84 1.22L2.14 11.27A2 2 0 0 0 2 12v2a2 2 0 0 0 2 2h6.31l-.95 4.57-.03.32a1.5 1.5 0 0 0 .44 1.06L11.83 23l6.58-6.59A2 2 0 0 0 19 15V5a2 2 0 0 0-2-2h-2z" opacity=".75"/></svg>
      </button>
      <button
        v-if="!streaming"
        type="button"
        class="msg-actions__btn"
        title="重新生成"
        @click.stop="emit('regenerate')"
      >
        <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
        <span>重新生成</span>
      </button>
      <button
        type="button"
        class="msg-actions__btn"
        :title="copied ? '已复制' : '复制'"
        @click.stop="handleCopy"
      >
        <svg v-if="!copied" viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"/></svg>
        <svg v-else viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>
        <span>{{ copied ? '已复制' : '复制' }}</span>
      </button>
    </div>
  </Transition>
</template>

<style scoped>
.msg-actions {
  position: absolute;
  top: 6px;
  right: 6px;
  display: flex;
  gap: 2px;
  padding: 3px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface, #fff) 92%, transparent);
  backdrop-filter: blur(8px);
  box-shadow: 0 2px 8px rgba(23, 32, 51, 0.1);
  z-index: 2;
}
.msg-actions__btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--muted, #5b6577);
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}
.msg-actions__btn:hover {
  background: rgba(52, 120, 246, 0.08);
  color: var(--blue-deep, #1f57cc);
}
.msg-actions__btn:active {
  background: rgba(52, 120, 246, 0.14);
}
.msg-actions__btn:disabled {
  cursor: default;
}
.msg-actions__btn--sent-up {
  color: var(--green, #1e9e58);
  background: rgba(49, 177, 111, 0.1);
}
.msg-actions__btn--sent-down {
  color: #c0454a;
  background: rgba(239, 117, 120, 0.1);
}

/* 触屏设备（无 hover）：操作按钮常显，避免「看不到操作」；
   位置改到气泡下方，避免遮挡消息内容 */
@media (hover: none) {
  .msg-actions {
    position: static;
    justify-content: flex-end;
    margin-top: 4px;
    box-shadow: none;
    background: transparent;
    backdrop-filter: none;
    padding: 0;
  }
}

/* Transition */
.actions-pop-enter-active { transition: opacity 0.15s ease, transform 0.15s cubic-bezier(0.16, 1, 0.3, 1); }
.actions-pop-leave-active { transition: opacity 0.1s ease, transform 0.1s ease; }
.actions-pop-enter-from { opacity: 0; transform: scale(0.95) translateY(-2px); }
.actions-pop-leave-to { opacity: 0; transform: scale(0.97); }
</style>
