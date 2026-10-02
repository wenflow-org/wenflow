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
 * 类型 number | string（2026-10-02）：UserDetail 会话角标需「最近 5 / 共 40」口径文案——
 * 裸数字角标曾把 limit 窗口条数冒充总数（P1#14）；既有数字调用方不受影响。
 */
defineProps<{ tabs: Array<{ key: string; label: string; count?: number | string }>; modelValue: string }>();
defineEmits<{ (e: 'update:modelValue', key: string): void }>();
</script>

<style scoped>
.mk-subtabs {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  border-bottom: 1px solid var(--mk-line);
  /* 勿用 overflow-x:auto 横滚：定高 grid 页（.mk-page）的 auto 行轨按「最小贡献」收缩，
     overflow 非 visible 会把贡献清零 → 组件被压成 1px、页签被裁剪到点不到
     （LearnerDetail 实测，min-height:max-content 也救不回）。窄屏放不下时换行。 */
}
.mk-subtab {
  border: 0;
  background: transparent;
  color: var(--mk-muted);
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
  color: var(--mk-blue);
  border-bottom-color: var(--mk-blue);
}
.mk-subtab:focus-visible { outline: none; box-shadow: var(--mk-focus-ring); }
.mk-subtab__count { margin-left: 5px; color: var(--mk-faint); font-weight: 600; }
.mk-subtab[aria-selected='true'] .mk-subtab__count { color: inherit; opacity: 0.72; }
</style>
