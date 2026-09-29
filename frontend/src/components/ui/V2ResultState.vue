<template>
  <div class="v2result" :class="`v2result--${tone}`" role="status">
    <div class="v2result__art" aria-hidden="true">
      <slot name="icon">
        <CloudOff v-if="tone === 'error'" :size="30" :stroke-width="1.5" />
        <Inbox v-else :size="30" :stroke-width="1.5" />
      </slot>
    </div>
    <h3 class="v2result__title">{{ title }}</h3>
    <p v-if="description" class="v2result__desc">{{ description }}</p>
    <button v-if="actionText" type="button" class="v2result__action" :disabled="busy" @click="$emit('action')">
      {{ busy ? '处理中…' : actionText }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { Inbox, CloudOff } from 'lucide-vue-next';

/**
 * 用户侧整页级「空态 / 失败态」统一组件（newui/home 原型 wf-empty / wf-error 形态）：
 * 居中 66px 圆角图标盘 + 标题 + 说明 + 可选主动作。
 * 只用于「整页/整块」的终态；卡片内的局部提示（chart__empty 一族）保持页内轻量形态。
 * loading 态不走这里——骨架统一用 SkeletonLoader（形状按页选择 variant）。
 */
withDefaults(
  defineProps<{
    tone?: 'empty' | 'error';
    title: string;
    description?: string;
    actionText?: string;
    busy?: boolean;
  }>(),
  { tone: 'empty', description: '', actionText: '', busy: false },
);
defineEmits<{ (e: 'action'): void }>();
</script>

<style scoped>
.v2result {
  text-align: center;
  padding: 46px 20px;
}
.v2result__art {
  width: 66px;
  height: 66px;
  margin: 0 auto 14px;
  border-radius: 20px;
  display: grid;
  place-items: center;
  background: var(--mk-surface-2, #eef2fa);
  color: var(--blue);
}
.v2result--error .v2result__art {
  color: var(--red);
  background: color-mix(in srgb, var(--red) 10%, var(--surface));
}
.v2result__title {
  margin: 0 0 6px;
  font-size: 16px;
  font-weight: 800;
  color: var(--ink);
}
.v2result__desc {
  margin: 0 auto 16px;
  max-width: 36ch;
  font-size: 13.5px;
  line-height: 1.65;
  color: var(--muted);
}
.v2result__action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  padding: 0 18px;
  border: 0;
  border-radius: var(--mk-radius-pill);
  background: linear-gradient(135deg, var(--blue), var(--blue-deep));
  color: #fff;
  font: inherit;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  box-shadow: 0 6px 14px color-mix(in srgb, var(--blue) 26%, transparent);
  transition: transform 0.18s ease, box-shadow 0.18s ease, opacity 0.15s ease;
}
.v2result__action:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 9px 18px color-mix(in srgb, var(--blue) 32%, transparent);
}
.v2result__action:disabled { opacity: 0.6; cursor: default; }
</style>
