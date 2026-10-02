<script setup lang="ts">
/**
 * MessageActions — hover action menu for AI message bubbles.
 * Shows: 有用 / 不佳 (message feedback), 重新生成 (hidden during streaming), 复制
 * Positioned as an inline row BELOW the bubble（2026-09-27 用户反馈）：
 * 原绝对定位在气泡右上角，浮层压住正文末行；改为文档流内的独立小行，
 * hover 时在气泡下方展开，永不遮挡消息内容。
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
  <div class="msg-actions" :class="{ 'msg-actions--hidden': !visible }">
      <button
        type="button"
        class="msg-actions__btn"
        :class="{ 'msg-actions__btn--sent-up': feedbackSent === 'up' }"
        :title="feedbackSent === 'up' ? '已标记有用' : '这条回复有用'"
        :aria-label="feedbackSent === 'up' ? '已标记有用' : '标记这条回复有用'"
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
        :aria-label="feedbackSent === 'down' ? '已标记不佳' : '标记这条回复不佳'"
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
</template>

<style scoped>
.msg-actions {
  /* 气泡下方独立行（文档流内），不再是绝对定位浮层——浮层会遮住气泡正文末行。
     右对齐 = 气泡右下角（2026-09-27 用户反馈）：AI 气泡靠左，操作条收到右缘
     与 meta 行（左）形成对角平衡，也更贴近常见的聊天操作位 */
  display: flex;
  justify-content: flex-end;
  gap: 2px;
  padding: 2px 0;
  margin-top: -2px;
}
/* 占位隐藏：隐藏时仍撑住 meta 行高度，出现/消失时下方文字不上下跳动。
   用 opacity 而非 visibility:hidden——visibility 会把按钮移出 Tab 焦点序，
   键盘用户永远够不到操作（P2 a11y）；opacity 占位效果相同，按钮仍可聚焦，
   聚焦进入时经 :focus-within 显形（键盘可达 = 可见，鼠标 hover 逻辑不变） */
.msg-actions--hidden {
  opacity: 0;
  pointer-events: none;
}
.msg-actions--hidden:focus-within {
  opacity: 1;
  pointer-events: auto;
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
  background: color-mix(in srgb, var(--blue) 8%, transparent);
  color: var(--blue-deep, #1f57cc);
}
.msg-actions__btn:active {
  background: color-mix(in srgb, var(--blue) 14%, transparent);
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
</style>
