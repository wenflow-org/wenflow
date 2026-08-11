<template>
  <div v-if="state.visible" class="uc-dialog-mask" @click.self="cancel">
    <div class="uc-dialog" role="dialog" aria-modal="true" :aria-label="state.title">
      <div class="uc-dialog__head">
        <h3>{{ state.title }}</h3>
        <button type="button" class="uc-dialog__close" aria-label="关闭" @click="cancel">✕</button>
      </div>
      <div class="uc-dialog__body">
        <p class="uc-confirm-desc">{{ state.message }}</p>
      </div>
      <div class="uc-dialog__foot">
        <button type="button" class="uc-btn" :disabled="state.busy" @click="cancel">取消</button>
        <button type="button" class="uc-btn" :class="{ 'uc-btn--danger': state.danger }" :disabled="state.busy" @click="confirm">
          {{ state.busy ? '处理中…' : state.confirmText }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ConfirmState } from './useUcConfirm'

const props = defineProps<{ state: ConfirmState }>()

function cancel() {
  props.state.cancel()
}

function confirm() {
  props.state.confirm()
}
</script>

<style scoped>
.uc-confirm-desc {
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
  color: var(--ink, #172033);
}
</style>
