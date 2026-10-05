<template>
  <div
    class="mk-stat-strip"
    :class="`mk-stat-strip--${layout}`"
    :role="layout === 'grid' ? 'list' : undefined"
    :aria-label="layout === 'grid' ? (ariaLabel || undefined) : undefined"
  >
    <!-- 分格指标条：标签在上、数值在下，格子间 1px 竖分隔；窄屏自动换行。
         inline（默认）：用于页头「多组指标平铺成一句话」的场景（虚拟学习者等），
                         提供标签/数值层级与可点击筛选。
         grid：实体页头「一行四格读数条」（原型 statstrip，hero 与二级页签之间）。 -->
    <template v-for="(item, i) in items" :key="item.key ?? i">
      <button
        v-if="item.clickable"
        type="button"
        class="mk-stat mk-stat--clickable"
        :class="[item.tone ? `mk-stat--${item.tone}` : '', { 'mk-stat--on': item.active }]"
        :title="item.title || undefined"
        :aria-pressed="item.active ? 'true' : 'false'"
        :role="layout === 'grid' ? 'listitem' : undefined"
        @click="$emit('select', item.key)"
      >
        <span class="mk-stat__label">{{ item.label }}</span> <span class="mk-stat__value">{{ item.value }}</span>
      </button>
      <div
        v-else
        class="mk-stat"
        :class="item.tone ? `mk-stat--${item.tone}` : ''"
        :title="item.title || undefined"
        :role="layout === 'grid' ? 'listitem' : undefined"
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
withDefaults(defineProps<{ items: MkStatItem[]; layout?: 'inline' | 'grid'; ariaLabel?: string }>(), {
  items: () => [],
  layout: 'inline',
  ariaLabel: ''
})

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
.mk-stat--bad .mk-stat__value { color: var(--mk-red); }

/* 可点击项（页头计数筛选锚点）：默认与普通格子同构，hover/激活高亮 */
.mk-stat--clickable {
  border-top: 0;
  border-right: 0;
  border-bottom: 0;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
  border-radius: var(--mk-radius-sm);
  transition: color 0.12s ease, background 0.12s ease;
}
.mk-stat--clickable:hover { background: color-mix(in srgb, var(--mk-blue) 8%, transparent); }
.mk-stat--clickable:hover .mk-stat__label,
.mk-stat--clickable:hover .mk-stat__value { color: var(--mk-blue); }
.mk-stat--on { background: color-mix(in srgb, var(--mk-blue) 12%, transparent); }
.mk-stat--on .mk-stat__label,
.mk-stat--on .mk-stat__value { color: var(--mk-blue); }

/* 布局变体 grid：实体页头「一行四格读数条」（原型 .statstrip）。label 在上、数值在下，
   格子等宽 auto-fit、竖分隔在右（与 inline 的分隔在左互不干扰）。数值固定 18px 展示档
   （与页内正文分离，是页级读数档；不随 4K 字号阶梯放大，保持四页一致）。
   收敛 LearnerDetail / UserAccountPane / VirtualProfile / SessionCockpit 四处私有 .statstrip 复刻。 */
.mk-stat-strip--grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
}
.mk-stat-strip--grid .mk-stat {
  display: grid;
  gap: 6px;
  align-content: start;
  padding: 12px 16px;
  border-left: 0;
  border-right: 1px solid var(--mk-line);
}
.mk-stat-strip--grid .mk-stat:first-child { padding-left: 16px; border-left: 0; }
.mk-stat-strip--grid .mk-stat:last-child { border-right: 0; }
.mk-stat-strip--grid .mk-stat__value {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  color: var(--mk-ink);
  /* 长文本格（当前阶段/当前任务）不 nowrap 截断丢字：最多两行，全文留在 title */
  white-space: normal;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}

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
