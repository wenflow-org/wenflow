<template>
  <Teleport to="body">
    <div class="toast-host" role="status" aria-live="polite">
      <TransitionGroup name="toast-slide">
        <div
          v-for="item in toast.toasts"
          :key="item.id"
          class="toast-item"
          :class="`toast-item--${item.type}`"
          :role="item.type === 'error' ? 'alert' : 'status'"
          :aria-live="item.type === 'error' ? 'assertive' : 'polite'"
          aria-atomic="true"
          @mouseenter="pauseToast(item)"
          @mouseleave="resumeToast(item)"
        >
          <span class="toast-icon" :class="`toast-icon--${item.type}`" aria-hidden="true">
            <template v-if="item.type === 'success'">&#10003;</template>
            <template v-else-if="item.type === 'error'">&#10007;</template>
            <template v-else-if="item.type === 'warning'">&#9888;</template>
            <template v-else>&#8505;</template>
          </span>
          <p class="toast-message">{{ item.message }}</p>
          <button
            type="button"
            class="toast-close"
            aria-label="关闭通知"
            @click="dismissToast(item)"
          >&times;</button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { toast, type ToastItem } from '../../utils/toast';

const pauseToast = (item: ToastItem) => {
  toast.pause(item.id);
};

const resumeToast = (item: ToastItem) => {
  toast.resume(item.id);
};

const dismissToast = (item: ToastItem) => {
  toast.close(item.id);
};
</script>

<style scoped>
/* 原型 .wf-toasts（newui/用户侧/index.html）：底部居中浮层，深底白字胶囊。
   注意：本组件 Teleport 到 body，脱离 .v2-page 作用域，所以只引 --mk-* / --wf-* 全局 token
   （勿用 v2 的 --surface/--line/--ink 别名层：别名层一旦按需加载/移除，暗色下会白底 toast）；
   focus 环用全站唯一一圈 --mk-focus-ring。 */
.toast-host {
  position: fixed;
  left: 50%;
  bottom: 26px;
  transform: translateX(-50%);
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 10px;
  /* 原型：width: min(92vw, 430px)（原为右上 340px 定宽） */
  width: min(92vw, 430px);
  pointer-events: none;
  max-height: calc(100vh - 52px);
  overflow: hidden;
}

.toast-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 12px 14px;
  /* toast = 弹层 → 卡片·弹层档 16（§0.5） */
  border-radius: var(--mk-radius-xl);
  background: var(--mk-ink);
  color: var(--wf-text-inverse);
  font-size: 13.5px;
  line-height: 1.5;
  /* toast → 模态阴影档（§0.5 阴影表：模态/抽屉/toast/登录壳） */
  box-shadow: var(--mk-shadow-modal);
  pointer-events: auto;
}

.toast-item--error {
  /* 原型字面值（.wf-toast--err）：固定深红，暗色下同样成立（无对应令牌，保留登记） */
  background: #8f2233;
}

/* 「友好而平」：hover 不抬升不加投影，悬停反馈只走背景/文字（§0.5 阴影） */

.toast-icon {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  line-height: 1;
  font-weight: 700;
}

/* 深底上的图标：原型只着色不铺底（成功 #5fe0a0 / 错误 #ffc2cb —— 原型字面值，无对应令牌，保留登记） */
.toast-icon--success {
  color: #5fe0a0;
}

.toast-icon--error {
  color: #ffc2cb;
}

.toast-icon--warning {
  color: color-mix(in srgb, var(--mk-amber) 45%, #ffffff);
}

.toast-icon--info {
  color: color-mix(in srgb, var(--mk-blue) 55%, #ffffff);
}

.toast-message {
  flex: 1;
  margin: 0;
  font-size: 13.5px;
  font-weight: 500;
  line-height: 1.5;
  color: var(--wf-text-inverse);
  word-break: break-word;
}

.toast-close {
  flex-shrink: 0;
  width: 24px;  /* 20→24：WCAG 2.5.8 目标尺寸下限 */
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: color-mix(in srgb, var(--wf-text-inverse) 72%, transparent);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  border-radius: var(--mk-radius-xs);
  transition: color 0.15s ease, background 0.15s ease;
}

.toast-close:hover {
  color: var(--wf-text-inverse);
  background: color-mix(in srgb, var(--wf-text-inverse) 12%, transparent);
}

.toast-close:focus-visible {
  outline: none;
  box-shadow: var(--mk-focus-ring);
}

/* 底部浮层：入场上推、离场下沉（原型 wf-toast-in/out，.22s --mk-ease-out） */
.toast-slide-enter-active {
  transition: opacity 0.22s var(--mk-ease-out, cubic-bezier(0.16, 1, 0.3, 1)),
    transform 0.22s var(--mk-ease-out, cubic-bezier(0.16, 1, 0.3, 1));
}

.toast-slide-leave-active {
  transition: opacity 0.2s var(--mk-ease-out, cubic-bezier(0.16, 1, 0.3, 1)),
    transform 0.2s var(--mk-ease-out, cubic-bezier(0.16, 1, 0.3, 1));
}

.toast-slide-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.toast-slide-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

.toast-slide-move {
  transition: transform 0.2s var(--mk-ease-out, cubic-bezier(0.16, 1, 0.3, 1));
}

/* ≤1023（底部 dock 出现的档位）：抬到 84px 让开底部导航（原型同款断点） */
@media (max-width: 1023.98px) {
  .toast-host {
    bottom: 84px;
    max-height: calc(100vh - 110px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .toast-item,
  .toast-close,
  .toast-slide-enter-active,
  .toast-slide-leave-active,
  .toast-slide-move {
    transition: none;
  }

  .toast-slide-enter-from,
  .toast-slide-leave-to {
    opacity: 1;
    transform: none;
  }
}
</style>
