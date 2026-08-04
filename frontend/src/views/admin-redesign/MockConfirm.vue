<template>
  <Teleport to="body">
    <div v-if="confirmState.open" ref="maskRef" class="mk-modal">
      <div ref="panelRef" class="mk-confirm" role="alertdialog" aria-modal="true" aria-label="确认操作">
        <h3 class="mk-confirm__title">{{ confirmState.title }}</h3>
        <p class="mk-confirm__msg">{{ confirmState.message }}</p>
        <label v-if="confirmState.input" class="mk-confirm__input">
          <span>{{ confirmState.input.label }}</span>
          <input
            v-model="confirmState.inputValue"
            type="text"
            class="mk-field__input"
            :placeholder="confirmState.input.placeholder || ''"
            @keydown.enter="confirm()"
          />
        </label>
        <div class="mk-confirm__actions">
          <button type="button" class="mk-btn" @click="settleConfirm(false)">取消</button>
          <button
            type="button"
            class="mk-btn"
            :class="confirmState.danger ? 'mk-confirm__danger' : 'mk-btn--primary'"
            @click="confirm"
          >
            {{ confirmState.confirmText }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { confirmState, settleConfirm } from './useConfirm'
import { useOverlay, useMaskClose } from './useOverlay'
import { useEscape } from './useEscape'

/** 全局确认对话框（单例）：替换 window.confirm / prompt，接入焦点管理/滚动锁定/Esc */
const panelRef = ref<HTMLElement | null>(null)
const maskRef = ref<HTMLElement | null>(null)
useOverlay(computed(() => confirmState.open), panelRef)
useMaskClose(maskRef, () => settleConfirm(false))
useEscape(() => confirmState.open, () => settleConfirm(false))

function confirm() {
  if (confirmState.input) {
    settleConfirm(confirmState.inputValue.trim() || null)
  } else {
    settleConfirm(true)
  }
}
</script>

<style scoped>
.mk-confirm {
  width: min(420px, 100%);
  padding: 18px 20px 16px;
  border-radius: 16px;
  background: var(--mk-surface);
  box-shadow: 0 24px 64px rgba(15, 23, 42, 0.22);
  display: grid;
  gap: 12px;
}
.mk-confirm__title { margin: 0; font-size: 15px; font-weight: 700; }
.mk-confirm__msg {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--mk-muted);
  white-space: pre-wrap;
}
.mk-confirm__input { display: grid; gap: 6px; }
.mk-confirm__input span { font-size: 12px; font-weight: 700; color: var(--mk-muted); }
.mk-confirm__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 4px;
}
.mk-confirm__danger {
  border: 1px solid var(--mk-red);
  background: var(--mk-red);
  color: #fff;
}
.mk-confirm__danger:hover { background: #b91c1c; }
</style>
