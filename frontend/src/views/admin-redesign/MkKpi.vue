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

/* 紧凑模式（列表页顶部 KPI）：压高度 */
.mk-kpi--compact { padding: 6px 10px; gap: 1px; border-radius: 8px; }
.mk-kpi--compact .mk-kpi__label { font-size: 10.5px; }
.mk-kpi--compact .mk-kpi__num { font-size: 16px; line-height: 1.2; }

/* 暗色模式（D1） */
html[data-theme='dark'] .mk-kpi { background: #141c2b; border-color: #232f45; }

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