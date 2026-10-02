<template>
  <div class="mk-subtabs" role="tablist">
    <button
      v-for="t in tabs"
      :key="t.key"
      type="button"
      role="tab"
      class="mk-subtab"
      :aria-selected="t.key === modelValue"
      @click="$emit('update:modelValue', t.key)"
    >
      {{ t.label }}<span v-if="t.count !== undefined" class="mk-subtab__count">{{ t.count }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * 详情页二级页签（newui/admin 原型 subtabs 形态）：下划线式，置于详情 hero 之下，
 * 把详情页的并列分区（会话/目标/许可…）收成分区页签。内容区用 v-show 保持已加载状态。
 * count：可选角标（如 VirtualProfile「数量即 tab 角标」决策），faint 微字不抢层级。
 */
defineProps<{ tabs: Array<{ key: string; label: string; count?: number }>; modelValue: string }>();
defineEmits<{ (e: 'update:modelValue', key: string): void }>();
</script>

<style scoped>
.mk-subtabs {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  border-bottom: 1px solid var(--mk-line, #e6ebf4);
  /* 勿用 overflow-x:auto 横滚：定高 grid 页（.mk-page）的 auto 行轨按「最小贡献」收缩，
     overflow 非 visible 会把贡献清零 → 组件被压成 1px、页签被裁剪到点不到
     （LearnerDetail 实测，min-height:max-content 也救不回）。窄屏放不下时换行。 */
}
.mk-subtab {
  border: 0;
  background: transparent;
  color: var(--mk-muted, #5b6577);
  padding: 9px 12px;
  cursor: pointer;
  font: inherit;
  font-weight: 600;
  font-size: var(--mk-fs-micro, 12px);
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  white-space: nowrap;
  transition: color 0.14s ease, border-color 0.14s ease;
}
.mk-subtab:hover { color: var(--mk-ink); }
.mk-subtab[aria-selected='true'] {
  color: var(--mk-blue, #2f6ae0);
  border-bottom-color: var(--mk-blue, #2f6ae0);
}
.mk-subtab:focus-visible { outline: 2px solid color-mix(in srgb, var(--mk-blue, #2f6ae0) 85%, transparent); outline-offset: -2px; }
.mk-subtab__count { margin-left: 5px; color: var(--mk-faint, #8a93a6); font-weight: 600; }
.mk-subtab[aria-selected='true'] .mk-subtab__count { color: inherit; opacity: 0.72; }
</style>
