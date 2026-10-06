<template>
  <div
    class="ovbars"
    role="img"
    :aria-label="ariaLabel ?? colsSummary"
    :style="{ '--ovbars-cols': String(cols.length), '--ovbars-min': `${minBarsHeight}px` }"
  >
    <div
      v-for="(c, i) in cols"
      :key="c.key"
      class="ovbars__col"
      :class="{ 'ovbars__col--today': c.today }"
      :title="c.title"
    >
      <span v-if="showNums" class="ovbars__num" :class="{ 'ovbars__num--zero': !c.num || c.num === '0' }">{{ c.num || '·' }}</span>
      <div class="ovbars__bars">
        <i
          v-for="(b, bi) in c.bars"
          :key="bi"
          class="ovbars__bar"
          :class="`ovbars__bar--${b.tone}`"
          :style="{ height: b.pct, width: `${barWidth}px` }"
        ></i>
      </div>
      <span class="ovbars__label" :class="{ 'ovbars__label--today': c.today }">{{ labelShown(i) ? c.label : '\u00A0' }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

interface OvBarsCol {
  key: string;
  /** 底部标签（labelEvery 稀显时，隐藏位以不换行空格占位保持基线） */
  label: string;
  today?: boolean;
  title?: string;
  /** 柱顶数字（主序列值）；showNums=false 时不渲染 */
  num?: string;
  /** 每根柱：pct 为相对该组最大值的高度（含 %），tone 决定颜色 */
  bars: Array<{ pct: string; tone: 'blue' | 'green' | 'amber' | 'red' }>;
}

const props = withDefaults(defineProps<{
  cols: OvBarsCol[];
  /** 柱顶数字：7 列卡显示，24 列（脉搏）太密不显示 */
  showNums?: boolean;
  /** 底部标签稀显间隔：1 = 全显（7 天卡），4 = 每 4 列一个（24h 卡，末列恒显） */
  labelEvery?: number;
  /** 柱区最小高度（px）：等高卡片里保证柱子有可读高度 */
  minBarsHeight?: number;
  /** 单柱宽度（px）：默认 9（半宽卡）；全宽卡（如成本页趋势）传更宽的值，
      否则 7 列铺满 1600px 时柱子细成发丝 */
  barWidth?: number;
  /** 可访问名：调用方给整图语义（如「近 7 天每日活跃人数」）；
      缺省时由 cols 逐列拼「标签 数值」兜底，见 colsSummary */
  ariaLabel?: string;
}>(), { showNums: true, labelEvery: 1, minBarsHeight: 64, barWidth: 9 });

const labelShown = computed(() => (i: number) => i % props.labelEvery === 0 || i === props.cols.length - 1);

/* 可访问名（审核 #3）：根节点 role="img" 把一串纯数字列收成一句整图语义，
   否则读屏只念出一串数字、不知每根柱是什么。ariaLabel 未传时由 cols 逐列拼
   「标签 数值」兜底（稀显藏掉的标签此处仍读全）；有今日列时补「截至现在」，
   与列 title 的进行中口径一致。两调用方（Overview 活跃图 / TokenCost 用量图）
   共用本兜底——补语义化前缀应由调用方传 ariaLabel。 */
const colsSummary = computed(() => {
  const parts = props.cols.map((c) => `${c.label} ${c.num && c.num !== '' ? c.num : '0'}`);
  return `柱状图：${parts.join('、')}${props.cols.some((c) => c.today) ? '（今日为截至现在）' : ''}`;
});
</script>

<style scoped>
/* 总览统一柱状图语言（2026-09-27 走查「四个柱状图两种款式」收敛：
   脉搏/调用趋势原来是 ECharts、用户增长/目标对话是手写 DOM，视觉两套）。
   每列三行结构：数字行(锁高) + 柱区(flex 撑满、底对齐) + 标签行(锁高)，
   任何一列文字折行都不会把柱子基线顶乱。 */
.ovbars {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(var(--ovbars-cols), minmax(0, 1fr));
  gap: 8px;
  align-items: stretch;
}
.ovbars__col {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  min-width: 0;
  border-radius: var(--mk-radius-sm);
}
.ovbars__col--today { background: color-mix(in srgb, var(--mk-blue) 6%, var(--mk-surface)); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--mk-blue) 25%, transparent); }
.ovbars__num,
.ovbars__label {
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
  font-size: var(--mk-fs-micro);
  font-variant-numeric: tabular-nums;
}
.ovbars__num { align-items: flex-end; color: var(--mk-muted); font-weight: 700; }
.ovbars__num--zero { color: var(--mk-faint); font-weight: 600; }
.ovbars__label { color: var(--mk-faint); }
.ovbars__label--today { color: var(--mk-blue); font-weight: 800; }
.ovbars__bars {
  flex: 1;
  min-height: var(--ovbars-min);
  width: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 3px;
}
.ovbars__bar {
  /* width 由 barWidth prop 内联给（半宽卡 9px / 全宽卡更宽） */
  border-radius: var(--mk-radius-xs) var(--mk-radius-xs) 0 0;
  background: linear-gradient(180deg, color-mix(in srgb, var(--mk-blue) 72%, white), var(--mk-blue));
  opacity: 0.85;
}
.ovbars__bar--green { background: linear-gradient(180deg, color-mix(in srgb, var(--mk-green) 72%, white), var(--mk-green)); opacity: 1; }
.ovbars__bar--amber { background: linear-gradient(180deg, color-mix(in srgb, var(--mk-amber) 72%, white), var(--mk-amber)); }
.ovbars__bar--red { background: linear-gradient(180deg, color-mix(in srgb, var(--mk-red) 72%, white), var(--mk-red)); opacity: 0.9; }
</style>
