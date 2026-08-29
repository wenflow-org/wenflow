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
.toast-host {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 10px;
  pointer-events: none;
  max-height: calc(100vh - 40px);
  overflow: hidden;
}

.toast-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 340px;
  padding: 12px 14px;
  border-radius: 6px;
  background: var(--surface, #ffffff);
  border: 1px solid var(--line, rgba(0, 0, 0, 0.06));
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);
  pointer-events: auto;
  transition: box-shadow 0.2s ease;
}

.toast-item--error {
  border-color: rgba(220, 38, 38, 0.22);
}

.toast-item:hover {
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.1);
}

.toast-icon {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  line-height: 1;
  border-radius: 50%;
  font-weight: 700;
}

.toast-icon--success {
  color: #166534;
  background: rgba(22, 163, 74, 0.1);
}

.toast-icon--error {
  color: #991b1b;
  background: rgba(220, 38, 38, 0.1);
}

.toast-icon--warning {
  color: #92400e;
  background: rgba(217, 119, 6, 0.1);
}

.toast-icon--info {
  color: #1e40af;
  background: rgba(37, 99, 235, 0.1);
}

.toast-message {
  flex: 1;
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.55;
  color: var(--ink, #333333);
  word-break: break-word;
}

.toast-close {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--faint, #999999);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  border-radius: 4px;
  transition: color 0.15s ease, background 0.15s ease;
}

.toast-close:hover {
  color: var(--muted, #555555);
  background: rgba(0, 0, 0, 0.04);
}

.toast-close:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
}

/* Transition */
.toast-slide-enter-active {
  transition: all 220ms ease-out;
}

.toast-slide-leave-active {
  transition: all 220ms ease-in;
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
  transition: transform 200ms ease;
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
