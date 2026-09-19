<template>
  <div class="mk-kpi" :class="[tone ? `mk-kpi--${tone}` : '', { 'mk-kpi--clickable': clickable, 'mk-kpi--compact': compact }]">
    <span class="mk-kpi__label">{{ label }} </span>
    <strong class="mk-kpi__num">{{ value }}</strong>
    <span v-if="hint && !compact" class="mk-kpi__hint">{{ hint }}</span>
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    label: string
    value: string | number
    hint?: string
    /** 数字着色：ok 绿 / warn 琥珀 / bad 红（含失败告警态） */
    tone?: 'ok' | 'warn' | 'bad' | ''
    /** 可点击（总览 KPI 等跳转入口）：hover 高亮 */
    clickable?: boolean
    /** 紧凑模式（列表页顶部 KPI）：减内边距/字号、隐藏 hint，压缩垂直空间 */
    compact?: boolean
  }>(),
  { hint: '', tone: '', clickable: false, compact: false }
)
</script>

<style scoped>
.mk-kpi {
  display: grid;
  gap: 3px;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid #e8edf6;
  background: #fafbfe;
}
.mk-kpi__label { font-size: var(--mk-fs-12); font-weight: 700; letter-spacing: 0.04em; color: var(--mk-faint); }
.mk-kpi__num {
  font-size: var(--mk-fs-20);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: var(--mk-ink);
  line-height: 1.25;
}
.mk-kpi__hint { font-size: var(--mk-fs-12); color: var(--mk-faint); }
.mk-kpi--bad .mk-kpi__num { color: var(--mk-red); }
.mk-kpi--warn .mk-kpi__num { color: var(--mk-amber); }
.mk-kpi--ok .mk-kpi__num { color: var(--mk-green); }
.mk-kpi--clickable { cursor: pointer; transition: border-color 0.12s ease, transform 0.12s ease; }
.mk-kpi--clickable:hover { border-color: rgba(44, 99, 208, 0.5); transform: translateY(-1px); }
/* 筛选联动激活态（P0-4）：KPI 作为筛选锚点，激活时高亮边框 */
.mk-kpi--linked-on { border-color: var(--mk-blue); box-shadow: 0 0 0 2px rgba(44, 99, 208, 0.18); }

/* 紧凑模式（列表页顶部 KPI）：压高度 */
.mk-kpi--compact { padding: 6px 10px; gap: 1px; border-radius: 8px; }
.mk-kpi--compact .mk-kpi__label { font-size: var(--mk-fs-11); }
.mk-kpi--compact .mk-kpi__num { font-size: var(--mk-fs-16); line-height: 1.2; }

/* 横向紧凑形态（低分辨率区间媒体查询触发）：
   label+hint 左侧、数字右侧单行排布，高度 ≈56px（TailAdmin stat card 形态） */
.mk-kpi--row {
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-rows: auto auto;
  column-gap: 8px;
  align-items: baseline;
  padding: 8px 12px;
  gap: 1px 8px;
  border-radius: 10px;
}
.mk-kpi--row .mk-kpi__label { grid-column: 1; grid-row: 1; font-size: var(--mk-fs-11); }
.mk-kpi--row .mk-kpi__num { grid-column: 2; grid-row: 1 / span 2; font-size: 19px; text-align: right; }
.mk-kpi--row .mk-kpi__hint { grid-column: 1; grid-row: 2; font-size: var(--mk-fs-11); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* 暗色模式（D1） */
html[data-theme='dark'] .mk-kpi { background: #141c2b; border-color: #232f45; }

/* 1440px 中间档 */
@media (min-width: 1440px) {
  .mk-kpi { padding: 13px 16px; }
  .mk-kpi__label { font-size: 12.5px; }
  .mk-kpi__num { font-size: 22px; }
  .mk-kpi__hint { font-size: 12.5px; }
}

/* 1920px 档（最低标准 1080p 全屏） */
@media (min-width: 1920px) {
  .mk-kpi { padding: 14px 17px; }
  .mk-kpi__num { font-size: 23px; }
}

/* 4K 三档（对齐全站 mk 体系） */
@media (min-width: 2000px) {
  .mk-kpi { padding: 15px 18px; border-radius: 14px; gap: 4px; }
  .mk-kpi__label { font-size: 12.5px; }
  .mk-kpi__num { font-size: 24px; }
  .mk-kpi__hint { font-size: 12.5px; }
}
@media (min-width: 2800px) {
  .mk-kpi { padding: 18px 22px; gap: 5px; }
  .mk-kpi__label { font-size: 15px; }
  .mk-kpi__num { font-size: 29px; }
  .mk-kpi__hint { font-size: 15px; }
}
@media (min-width: 3600px) {
  .mk-kpi__label { font-size: 17.5px; }
  .mk-kpi__num { font-size: 34px; }
  .mk-kpi__hint { font-size: 17.5px; }
}
</style>