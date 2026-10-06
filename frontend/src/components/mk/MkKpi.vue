<template>
  <!-- 可点 KPI 渲染真 <button>（2026-10-06 审核修复）：此前根恒为 div，clickable 只加类，
       键盘用户 Enter/Space 都无法激活（调用方也没人补 keydown）。用原生 button 一处收口，
       全站 clickable KPI 同时拿到 Enter/Space/焦点环。 -->
  <component
    :is="clickable ? 'button' : 'div'"
    :type="clickable ? 'button' : undefined"
    class="mk-kpi"
    :class="[tone ? `mk-kpi--${tone}` : '', { 'mk-kpi--clickable': clickable, 'mk-kpi--compact': compact }]"
  >
    <span class="mk-kpi__label">{{ label }} </span>
    <strong class="mk-kpi__num">{{ value }}</strong>
    <span v-if="hint && !compact" class="mk-kpi__hint">{{ hint }}</span>
    <!-- 默认 slot（2026-10-05）：卡内附挂位（VL 判例 = .mk-minibar 进度槽）。空 slot 渲染零节点，
         既有用法无感；附挂物走卡面原语（mk-minibar），不在页面发明新卡内词汇 -->
    <slot></slot>
  </component>
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
/* 规格对齐 newui「UI-分支优化设计」原型 .card + .kpi：白面卡片（不是蓝灰底）、
   16px 内边距、数字 28px/700 —— KPI 是页面的标题数字，不是页内小指标。
   蓝灰底（--mk-surface-2）留给卡内次级指标（MkStatStrip）。 */
.mk-kpi {
  display: grid;
  gap: 6px;
  padding: 16px;
  /* KPI 瓦片 = 卡片·弹层档 16（§0.5；批次 C 抬 xl 时此字面量漏改） */
  border-radius: var(--mk-radius-xl);
  border: 1px solid var(--mk-line);
  background: var(--mk-surface);
}
.mk-kpi__label { font-size: var(--mk-fs-micro); font-weight: 400; color: var(--mk-muted); }
.mk-kpi__num {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  color: var(--mk-ink);
  line-height: 1.25;
}
.mk-kpi__hint { font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.mk-kpi--bad .mk-kpi__num { color: var(--mk-red); }
.mk-kpi--warn .mk-kpi__num { color: var(--mk-amber); }
.mk-kpi--ok .mk-kpi__num { color: var(--mk-green); }
/* 可点击态的悬停反馈：只换描边色，不做位移（批次 D，2026-10-02）。
   原为 translateY(-1px) + transition 里带 transform。KPI 卡是网格排布的，
   抬 1px 会让相邻卡片在鼠标经过时保持原位、只有当前卡浮起，读作「错位」
   而不是「可点」。规范：悬停只允许变背景/边框/文字色，位移只留给
   :active 的 scale(0.98)。transform 已从 transition 移除——无变化可过渡。 */
.mk-kpi--clickable { cursor: pointer; transition: border-color 0.12s var(--mk-ease-out); }
.mk-kpi--clickable:hover { border-color: color-mix(in srgb, var(--mk-blue) 50%, transparent); }
.mk-kpi--clickable:active { transform: scale(0.98); }
/* 根为 <button> 时抹掉 UA 默认（字体/对齐/宽度），保证与 div 版渲染一致 */
button.mk-kpi {
  font: inherit;
  color: inherit;
  text-align: left;
  width: 100%;
  appearance: none;
}
button.mk-kpi:focus-visible { outline: none; box-shadow: var(--mk-focus-ring); }
/* 已删除死样式 .mk-kpi--linked-on（P3）：组件模板从未输出该类，全仓也无调用方传入，
   「筛选联动激活态」需求未接线——如需启用应加 prop（如 linkedOn）而不是保留不可达样式 */

/* 紧凑模式（列表页顶部 KPI）：压高度 */
.mk-kpi--compact { padding: 6px 10px; gap: 1px; border-radius: var(--mk-radius-sm); }
.mk-kpi--compact .mk-kpi__label { font-size: var(--mk-fs-micro); }
.mk-kpi--compact .mk-kpi__num { font-size: var(--mk-fs-emphasis); line-height: 1.2; }

/* 横向紧凑形态（低分辨率区间媒体查询触发）：
   label+hint 左侧、数字右侧单行排布，高度 ≈56px（TailAdmin stat card 形态） */
.mk-kpi--row {
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-rows: auto auto;
  column-gap: 8px;
  align-items: baseline;
  padding: 8px 12px;
  gap: 1px 8px;
  border-radius: var(--mk-radius-xl);
}
.mk-kpi--row .mk-kpi__label { grid-column: 1; grid-row: 1; font-size: var(--mk-fs-micro); }
.mk-kpi--row .mk-kpi__num { grid-column: 2; grid-row: 1 / span 2; font-size: 19px; text-align: right; }
.mk-kpi--row .mk-kpi__hint { grid-column: 1; grid-row: 2; font-size: var(--mk-fs-micro); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* 暗色模式（D1）：底色已与普通卡片同档（--mk-surface），无需覆写 */
html[data-theme='dark'] .mk-kpi { border-color: var(--mk-line); }

/* 1440px 中间档（档位只放大数字，不再回到蓝灰底） */
@media (min-width: 1440px) {
  .mk-kpi { padding: 16px 17px; }
  .mk-kpi__label { font-size: var(--mk-fs-micro); }
  .mk-kpi__num { font-size: 29px; }
  .mk-kpi__hint { font-size: var(--mk-fs-micro); }
}

/* 1920px 档（最低标准 1080p 全屏） */
@media (min-width: 1920px) {
  .mk-kpi { padding: 17px 18px; }
  .mk-kpi__num { font-size: 30px; }
}

/* 4K 三档（对齐全站 mk 体系） */
@media (min-width: 2000px) {
  .mk-kpi { padding: 18px 20px; border-radius: var(--mk-radius-xl); gap: 6px; }
  .mk-kpi__label { font-size: var(--mk-fs-micro); }
  .mk-kpi__num { font-size: 31px; }
  .mk-kpi__hint { font-size: var(--mk-fs-micro); }
}
@media (min-width: 2800px) {
  .mk-kpi { padding: 20px 22px; gap: 7px; }
  .mk-kpi__label { font-size: var(--mk-fs-micro); }
  .mk-kpi__num { font-size: 34px; }
  .mk-kpi__hint { font-size: var(--mk-fs-micro); }
}
@media (min-width: 3600px) {
  .mk-kpi__label { font-size: var(--mk-fs-body); }
  .mk-kpi__num { font-size: 38px; }
  .mk-kpi__hint { font-size: var(--mk-fs-body); }
}
</style>