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
/* 通知悬浮层：右上角浅底卡片 + 语义色圆底图标（2026-10-08 用户侧：「以前右上角彩色那版
   我更习惯」）。历史：25112eb6 按 newui/用户侧 原型 .wf-toasts 改成「底部居中深底胶囊」，
   本次按用户明确偏好改回右上角形态 —— 「彩色」的识别点就是这四枚圆底图标（绿/红/琥珀/蓝），
   所以底色回到 --mk-surface 卡片、图标加回 50% 圆底与语义色 tint。
   注意：本组件 Teleport 到 body，脱离 .v2-page 作用域，所以只引全局 --mk-* token
   （勿用 v2 的 --surface/--line/--ink 别名层：别名层一旦按需加载/移除，暗色下会白底 toast）；
   focus 环用全站唯一一圈 --mk-focus-ring。 */
.toast-host {
  position: fixed;
  /* + env(safe-area-inset-top)：刘海机动效区不吃掉卡片上沿；无名机型该值为 0 */
  top: calc(20px + env(safe-area-inset-top, 0px));
  right: 20px;
  /* 层级走全站 token（2026-10-06 审核）：原为硬编码 9999，脱离 --mk-z-* 词汇表；
     toast 应压在所有业务覆盖层之上、critical 兜底层之下。 */
  z-index: var(--mk-z-toast, 450);
  display: flex;
  flex-direction: column;
  /* 贴右缘：多张卡片向左伸展，右边缘始终对齐 20px 锚点 */
  align-items: flex-end;
  gap: 10px;
  max-height: calc(100vh - 40px);
  overflow: hidden;
  pointer-events: none;
}

.toast-item {
  display: flex;
  align-items: center;
  gap: 10px;
  /* 右上角锚点：100vw-40px 保证 ≤360px 窄屏不被裁切（原固定 340 会溢出） */
  width: min(340px, calc(100vw - 40px));
  padding: 12px 14px;
  /* toast = 弹层 → 卡片·弹层档 16（§0.5 圆角阶梯） */
  border-radius: var(--mk-radius-xl);
  /* 浅底卡片：底色/描边/文字走 --mk-* 成对 token，暗色主题随 token 一起翻转
     （底部深底胶囊那版的 --mk-toast-bg/-fg 成对口径随之退役） */
  background: var(--mk-surface);
  border: 1px solid var(--mk-line);
  color: var(--mk-ink);
  font-size: 13.5px;
  line-height: 1.5;
  /* toast → 模态阴影档（§0.5 阴影表：模态/抽屉/toast/登录壳） */
  box-shadow: var(--mk-shadow-modal);
  pointer-events: auto;
}

/* 错误档：浅底上只把描边点红（深红实底是底部胶囊那版的口径，浅底卡片上不成立） */
.toast-item--error {
  border-color: color-mix(in srgb, var(--mk-red) 34%, var(--mk-line));
}

/* 「友好而平」：hover 不抬升不加投影，悬停反馈只走背景/文字（§0.5 阴影） */

/* 语义色圆底图标：底=同色轻铺，字形=深色语义色（暗色档 token 自带提亮） */
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
  border-radius: 50%;
}

.toast-icon--success {
  color: var(--mk-green);
  background: color-mix(in srgb, var(--mk-green) 14%, transparent);
}

.toast-icon--error {
  color: var(--mk-red);
  background: color-mix(in srgb, var(--mk-red) 14%, transparent);
}

.toast-icon--warning {
  color: var(--mk-amber);
  background: color-mix(in srgb, var(--mk-amber) 16%, transparent);
}

.toast-icon--info {
  color: var(--mk-blue);
  background: color-mix(in srgb, var(--mk-blue) 14%, transparent);
}

.toast-message {
  flex: 1;
  margin: 0;
  font-size: 13.5px;
  font-weight: 500;
  line-height: 1.5;
  /* 继承卡片文字色（--mk-ink，暗色随 token 翻转） */
  color: inherit;
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
  color: var(--mk-faint);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  border-radius: var(--mk-radius-xs);
  transition: color 0.15s ease, background 0.15s ease;
}

.toast-close:hover {
  color: var(--mk-muted);
  background: color-mix(in srgb, var(--mk-ink) 6%, transparent);
}

.toast-close:focus-visible {
  outline: none;
  box-shadow: var(--mk-focus-ring);
}

/* 右上角浮层：入场上滑 + 自右，离场上滑淡出（.22s --mk-ease-out） */
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
  transform: translateY(-12px) translateX(8px);
}

.toast-slide-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

.toast-slide-move {
  transition: transform 0.2s var(--mk-ease-out, cubic-bezier(0.16, 1, 0.3, 1));
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
