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
  background: var(--blue);   /* 批次 D：135deg 渐变 → 纯色友好蓝（规范禁渐变） */
  color: #fff;
  font: inherit;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  /* 批次 D（2026-10-02）：蓝色外发光（静态 26% + hover 32%）已删。
     规范「禁止彩色光晕」；按钮不叠滚动内容，投影不表达层级。
     悬停反馈改为背景色变化（规范允许 hover 变背景，且这是规范钦定的
     hover 档 primary-dark），不再靠加深投影——那正是被判死的光晕递增。 */
  transition: transform 0.18s ease, background 0.18s ease, opacity 0.15s ease;
}
.v2result__action:hover:not(:disabled) {
  background: var(--blue-deep);
}
.v2result__action:active:not(:disabled) {
  transform: scale(0.98);
}
.v2result__action:disabled { opacity: 0.6; cursor: default; }
</style>
