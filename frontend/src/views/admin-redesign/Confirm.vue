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
          <button type="button" class="mk-btn" :disabled="confirmState.busy" @click="settleConfirm(false)">取消</button>
          <button
            type="button"
            class="mk-btn"
            :class="confirmState.danger ? 'mk-confirm__danger' : 'mk-btn--primary'"
            :disabled="confirmState.busy"
            @click="confirm"
          >
            {{ confirmState.busy ? '处理中…' : confirmState.confirmText }}
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
useMaskClose(maskRef, () => { if (!confirmState.busy) settleConfirm(false) })
useEscape(() => confirmState.open, () => { if (!confirmState.busy) settleConfirm(false) })

function confirm() {
  if (confirmState.busy) return
  if (confirmState.input) {
    settleConfirm(confirmState.inputValue.trim() || null)
  } else if (confirmState.busyMode) {
    // busy 模式：确认后不立即关闭，进入 busy 态由业务 done()/failConfirm() 关闭
    confirmState.busy = true
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
  box-shadow: var(--mk-shadow-modal);
  display: grid;
  gap: 12px;
}
.mk-confirm__title { margin: 0; font-size: var(--mk-fs-15); font-weight: 700; }
.mk-confirm__msg {
  margin: 0;
  font-size: var(--mk-fs-13);
  line-height: 1.7;
  color: var(--mk-muted);
  white-space: pre-wrap;
}
.mk-confirm__input { display: grid; gap: 6px; }
.mk-confirm__input span { font-size: var(--mk-fs-12); font-weight: 700; color: var(--mk-muted); }
.mk-confirm__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 4px;
}

/* ========== 大屏/4K 适配（全站 mk 体系档位：≥2000px 字号放大；zoom 档 ≥2800px→1.15、≥3600px→1.3） ========== */
@media (min-width: 2000px) {
  .mk-confirm { width: min(500px, 100%); padding: 22px 24px 20px; }
  .mk-confirm__title { font-size: 17px; }
  .mk-confirm__msg { font-size: 15px; }
  .mk-confirm__input span { font-size: 14px; }
}
@media (min-width: 2800px) {
  .mk-confirm { width: min(600px, 100%); }
  .mk-confirm__title { font-size: 19.5px; }
  .mk-confirm__msg { font-size: 17.5px; }
  .mk-confirm__input span { font-size: 16px; }
}
@media (min-width: 3600px) {
  /* 4K（确认框 Teleport 到 body，无 zoom）：加宽 + 字号继续放大 */
  .mk-confirm { width: min(700px, 100%); }
  .mk-confirm__title { font-size: 23px; }
  .mk-confirm__msg { font-size: 20px; }
  .mk-confirm__input span { font-size: 18.5px; }
}
</style>

<style>
/* 非 scoped（Teleport 到 body，且与 admin shared.css 同源同值）：
   遮罩 + 按钮基础样式自包含，保证未加载 admin shared.css 的 v2 用户页/学习页
   弹窗仍居中、按钮与全站 mk 体系一致。admin 页两处同值不冲突。 */
.mk-modal {
  position: fixed;
  inset: 0;
  z-index: var(--mk-z-modal, 300);
  background: rgba(15, 23, 42, 0.36);
  display: grid;
  place-items: center;
  padding: 20px;
}
.mk-btn {
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid var(--mk-line, #e1e8f2);
  background: var(--mk-surface, #fff);
  color: var(--mk-ink, #1a2a44);
  font: inherit;
  font-size: var(--mk-fs-13, 13px);
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s ease;
}
.mk-btn:hover { background: #f6f9ff; }
.mk-btn:disabled { opacity: 0.6; cursor: default; }
.mk-btn--primary {
  background: var(--mk-blue, #2c63d0);
  border-color: var(--mk-blue, #2c63d0);
  color: #fff;
}
.mk-btn--primary:hover { background: #2b64d8; }
.mk-confirm__danger {
  border: 1px solid var(--mk-red);
  background: var(--mk-red);
  color: #fff;
}
.mk-confirm__danger:hover { background: #b91c1c; }
/* 暗色覆写：与 shared.css 同源同值（Confirm 独立承载，不依赖 admin shared.css 加载） */
html[data-theme='dark'] .mk-btn:hover { background: #1b2740; }
html[data-theme='dark'] .mk-btn--primary:hover { background: #6a9cf3; }
html[data-theme='dark'] .mk-confirm__danger:hover { background: var(--mk-red-strong, #ef4444); }
</style>
