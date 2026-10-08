<script setup lang="ts">
/**
 * MessageActions — hover action menu for AI message bubbles.
 * Shows: 有用 / 不佳 (message feedback), 重新生成 (hidden during streaming), 复制
 * Positioned as an inline row BELOW the bubble（2026-09-27 用户反馈）：
 * 原绝对定位在气泡右上角，浮层压住正文末行；改为文档流内的独立小行，
 * hover 时在气泡下方展开，永不遮挡消息内容。
 *
 * 2026-10-08：四枚按钮统一为纯图标（「重新生成」「复制」的文字去掉）。
 * 页脚是「meta 左 / 操作条右」同行布局，窄屏消息列只有 ~266px，带文字时四枚
 * 合计 224px + nowrap 的「问流导师 · 时间」，把时间压成 51px 宽并与按钮叠在一起。
 * 去文字后合计 ~166px，一行放得下；语义改由 title（悬停提示）+ aria-label（读屏）承载。
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
        aria-label="重新生成"
        @click.stop="emit('regenerate')"
      >
        <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
      </button>
      <button
        type="button"
        class="msg-actions__btn"
        :title="copied ? '已复制' : '复制'"
        :aria-label="copied ? '已复制' : '复制'"
        @click.stop="handleCopy"
      >
        <svg v-if="!copied" viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"/></svg>
        <svg v-else viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>
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
  /* 36px 方盒之间留一点缝，避免相邻图标误点（原 2px 过挤） */
  gap: 4px;
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
  justify-content: center;
  gap: 4px;
  padding: 4px 8px;
  /* 桌面 hover 档也抬到 36×36 点击盒（图标仍 13px，视觉不变）：
     原 4px 8px + 12px 微字实测只有 29×21px，是屏幕上最小的可点元素，
     低于项目 36px 口径与 WCAG 2.5.8 的 24px 目标下限（2026-10-08 走查 #63）。 */
  min-width: 36px;
  min-height: 36px;
  border-radius: var(--mk-radius-sm);
  /* 字号下限 12px（§9 偏离 1） */
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  color: var(--muted);
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}
.msg-actions__btn:hover {
  background: color-mix(in srgb, var(--blue) 8%, transparent);
  color: var(--blue-deep);
}
.msg-actions__btn:active {
  background: color-mix(in srgb, var(--blue) 14%, transparent);
}
.msg-actions__btn:disabled {
  cursor: default;
}
.msg-actions__btn--sent-up {
  color: var(--green);
  background: var(--color-success-bg);
}
.msg-actions__btn--sent-down {
  /* #c0454a 无对应令牌（--mk-red/#c81e1e 更深），保留登记 */
  color: #c0454a;
  background: var(--wf-color-danger-bg);
}

/* 触屏设备（无 hover）：操作按钮常显，避免「看不到操作」；
   位置改到气泡下方，避免遮挡消息内容 */
@media (hover: none) {
  .msg-actions {
    position: static;
    justify-content: flex-end;
    margin-top: 4px;
    /* 纯图标后按钮之间不再需要缝：40px 方盒里图标居中，横向已留足视觉间距。
       这一行要和「问流导师 · 时间」同处 266px（375 档）的页脚行，省下的每一像素都算数。 */
    gap: 0;
    box-shadow: none;
    background: transparent;
    backdrop-filter: none;
    padding: 0;
  }
  /* EG6/EG20（2026-10-05 复测）：触屏下消息操作按钮实测 29×26（图标钮）/ 81×26（文字钮），
     低于移动端触控目标下限（EG20 <36 / EG6 <40）。触屏档统一抬到 40×40 且图标居中；
     2026-10-08：四枚按钮去掉文字后合计 4×40=160px，与元信息同行放得下（不再需要拆两行），
     40×40 的触控尺寸保持不变。桌面 hover 档现已同样抬到 36×36（见上），此处只加码到 40。 */
  .msg-actions__btn {
    min-width: 40px;
    min-height: 40px;
    justify-content: center;
  }
}

/* Transition */
</style>
