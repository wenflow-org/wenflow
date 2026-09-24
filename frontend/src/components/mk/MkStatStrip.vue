<template>
  <div class="mk-stat-strip">
    <!-- 分格指标条：标签在上、数值在下，格子间 1px 竖分隔；窄屏自动换行。
         用于页头「多组指标平铺成一句话」的场景（虚拟学习者等），提供标签/数值层级与可点击筛选。 -->
    <template v-for="(item, i) in items" :key="item.key ?? i">
      <button
        v-if="item.clickable"
        type="button"
        class="mk-stat mk-stat--clickable"
        :class="[item.tone ? `mk-stat--${item.tone}` : '', { 'mk-stat--on': item.active }]"
        :title="item.title || undefined"
        :aria-pressed="item.active ? 'true' : 'false'"
        @click="$emit('select', item.key)"
      >
        <span class="mk-stat__label">{{ item.label }}</span> <span class="mk-stat__value">{{ item.value }}</span>
      </button>
      <div
        v-else
        class="mk-stat"
        :class="item.tone ? `mk-stat--${item.tone}` : ''"
        :title="item.title || undefined"
      >
        <span class="mk-stat__label">{{ item.label }}</span> <span class="mk-stat__value">{{ item.value }}</span>
      </div>
    </template>
  </div>
</template>

<script lang="ts">
export interface MkStatItem {
  /** 点击回传的标识（clickable 时必填） */
  key?: string
  label: string
  value: string | number
  /** 数值着色：ok 绿 / warn 琥珀 / bad 红（含失败告警态） */
  tone?: 'ok' | 'warn' | 'bad' | ''
  /** 悬停说明（完整口径/术语） */
  title?: string
  /** 可点击（筛选锚点） */
  clickable?: boolean
  /** 筛选激活态 */
  active?: boolean
}
</script>

<script setup lang="ts">
withDefaults(defineProps<{ items: MkStatItem[] }>(), { items: () => [] })

defineEmits<{ select: [key: string | undefined] }>()
</script>

<style scoped>
.mk-stat-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  min-width: 0;
}
/* KPI 层级(2026-09-22 重设计):数值是主角(18px/700),标签是注脚(11px/faint);
   旧版数值 13px 与标签几乎同大,主次颠倒且拥挤 */
.mk-stat {
  display: grid;
  gap: 4px;
  align-content: center;
  min-width: 0;
  padding: 4px 16px;
  border-left: 1px solid var(--mk-line);
}
.mk-stat:first-child { border-left: 0; padding-left: 0; }
.mk-stat__label {
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  letter-spacing: 0.03em;
  color: var(--mk-faint);
  line-height: 1.3;
  white-space: nowrap;
}
.mk-stat__value {
  font-size: 18px;
  font-weight: 700;
  color: var(--mk-ink);
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
  white-space: nowrap;
}
.mk-stat--ok .mk-stat__value { color: var(--mk-green); }
.mk-stat--warn .mk-stat__value { color: var(--mk-amber); }
.mk-stat--bad .mk-stat__value { color: var(--mk-red, #dc2626); }

/* 可点击项（页头计数筛选锚点）：默认与普通格子同构，hover/激活高亮 */
.mk-stat--clickable {
  border-top: 0;
  border-right: 0;
  border-bottom: 0;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
  border-radius: 6px;
  transition: color 0.12s ease, background 0.12s ease;
}
.mk-stat--clickable:hover { background: rgba(44, 99, 208, 0.08); }
.mk-stat--clickable:hover .mk-stat__label,
.mk-stat--clickable:hover .mk-stat__value { color: var(--mk-blue); }
.mk-stat--on { background: rgba(44, 99, 208, 0.12); }
.mk-stat--on .mk-stat__label,
.mk-stat--on .mk-stat__value { color: var(--mk-blue); }

/* 4K 档对齐全站字号阶梯 */
@media (min-width: 2000px) {
  .mk-stat__label { font-size: var(--mk-fs-micro); }
  .mk-stat__value { font-size: 20px; }
}
@media (min-width: 2800px) {
  .mk-stat__label { font-size: var(--mk-fs-micro); }
  .mk-stat__value { font-size: var(--mk-fs-emphasis); }
}
@media (min-width: 3600px) {
  .mk-stat__label { font-size: var(--mk-fs-micro); }
  .mk-stat__value { font-size: 24px; }
}
</style>
