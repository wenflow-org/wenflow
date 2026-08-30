<template>
  <section class="mk-overview">
    <header class="mk-overview__head" :class="`mk-overview__head--${tone}`">
      <span class="mk-overview__dot" aria-hidden="true"></span>
      <strong class="mk-overview__title">{{ title }}</strong>
      <span v-if="subline" class="mk-overview__sub">{{ subline }}</span>
      <span v-if="window" class="mk-overview__window">{{ window }}</span>
    </header>
    <!-- 可选前置区（如目标对话的状态堆叠条） -->
    <slot name="pre" />
    <div v-if="hasData" class="mk-overview__kpis">
      <slot name="kpis" />
    </div>
    <div v-if="hasData && $slots.detail" class="mk-overview__detail">
      <slot name="detail" />
    </div>
  </section>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    /** 结论点色：ok 绿 / warn 琥珀 / bad 红 / muted 灰 */
    tone: 'ok' | 'warn' | 'bad' | 'muted'
    title: string
    subline?: string
    /** 右上角窗口/范围标签（如「近 7 天」「最近 100 条」） */
    window?: string
    /** 无数据门控：false 时 KPI 与详情行不渲染，只留结论头 */
    hasData: boolean
  }>(),
  { subline: '', window: '' }
)
</script>

<style scoped>
/* 概览卡（dashboard 形态统一件：虚拟学习者 / Skill 运行 / 教学会话 / 目标对话 共用）
   结构：结论头（dot+标题+副文案+窗口）→ KPI 行 → 虚线详情行 */
.mk-overview {
  display: grid;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid var(--mk-line);
  border-radius: 12px;
  background: var(--mk-surface);
}
html[data-theme='dark'] .mk-overview { background: #141c2b; }
.mk-overview__head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}
.mk-overview__dot { width: 9px; height: 9px; border-radius: 50%; align-self: center; background: var(--mk-faint); }
.mk-overview__head--ok .mk-overview__dot { background: var(--mk-green); }
.mk-overview__head--warn .mk-overview__dot { background: var(--mk-amber); }
.mk-overview__head--bad .mk-overview__dot { background: var(--mk-red); box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.12); }
.mk-overview__head--muted .mk-overview__dot { background: var(--mk-faint); }
.mk-overview__title { font-size: var(--mk-fs-15); font-weight: 800; color: var(--mk-ink); }
.mk-overview__sub { font-size: var(--mk-fs-12_5); color: var(--mk-muted); }
.mk-overview__window { margin-left: auto; font-size: var(--mk-fs-12); font-weight: 700; color: var(--mk-faint); letter-spacing: 0.03em; white-space: nowrap; }
.mk-overview__kpis {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}
.mk-overview__detail {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 16px;
  padding-top: 10px;
  border-top: 1px dashed var(--mk-line);
  font-size: var(--mk-fs-12);
  color: var(--mk-muted);
}
.mk-overview__detail span { white-space: nowrap; }
@media (max-width: 1280px) and (min-width: 1001px) {
  .mk-overview__kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 1000px) {
  .mk-overview__kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

/* 4K 三档（对齐全站 mk 体系：2000 ≈×1.15，2800 = 显式档 × 壳层 zoom 1.15，3600 为镜像） */
@media (min-width: 2000px) {
  .mk-overview { padding: 18px 22px; border-radius: 14px; gap: 14px; }
  .mk-overview__title { font-size: 16.5px; }
  .mk-overview__sub { font-size: 13.5px; }
  .mk-overview__window { font-size: 12.5px; }
  .mk-overview__detail { font-size: 13px; }
}
@media (min-width: 2800px) {
  .mk-overview { padding: 22px 28px; gap: 16px; }
  .mk-overview__title { font-size: 19px; }
  .mk-overview__sub { font-size: 16px; }
  .mk-overview__window { font-size: 15px; }
  .mk-overview__detail { font-size: 15.5px; }
}
@media (min-width: 3600px) {
  .mk-overview__title { font-size: 22px; }
  .mk-overview__sub { font-size: 18.5px; }
  .mk-overview__window { font-size: 17.5px; }
  .mk-overview__detail { font-size: 18px; }
}
</style>