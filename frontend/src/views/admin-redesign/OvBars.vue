<template>
  <!-- 稀疏形态：只有一列有值时，一行读数代替 7 列满高（空列撑满卡高会读成「其余六天全崩」）。
       selectable 时每列是按钮，可键盘聚焦与回车下钻。 -->
  <div
    v-if="sparseActive"
    class="ovbars ovbars--sparse"
    :role="selectable ? 'group' : 'img'"
    :aria-label="ariaLabel ?? colsSummary"
  >
    <component
      :is="selectable ? 'button' : 'div'"
      :type="selectable ? 'button' : undefined"
      class="ovbars__sparse"
      @click="selectable && emit('select', sparseActive.key)"
    >
      <b class="ovbars__sparse-num">{{ sparseActive.num }}</b>
      <span class="ovbars__sparse-label">{{ sparseActive.label }}</span>
      <span class="ovbars__sparse-note">{{ sparseNote }}</span>
    </component>
  </div>
  <div
    v-else
    class="ovbars"
    :class="{ 'ovbars--nums': showNums }"
    :role="selectable ? 'group' : 'img'"
    :aria-label="ariaLabel ?? colsSummary"
    :style="{ '--ovbars-cols': String(cols.length), '--ovbars-min': `${minBarsHeight}px` }"
  >
    <component
      :is="selectable ? 'button' : 'div'"
      v-for="(c, i) in cols"
      :key="c.key"
      class="ovbars__col"
      :class="{ 'ovbars__col--today': c.today, 'ovbars__col--selectable': selectable }"
      :type="selectable ? 'button' : undefined"
      :title="c.title"
      @click="selectable && emit('select', c.key)"
    >
      <div class="ovbars__bars">
        <i
          v-for="(b, bi) in c.bars"
          :key="bi"
          class="ovbars__bar"
          :class="`ovbars__bar--${b.tone}`"
          :style="{ height: b.pct, width: `${barWidth}px` }"
        ></i>
        <!-- 数值层：贴柱顶（绝对定位于柱区内容框内，bottom 由柱高内联给）。
             零值渲染「·」而非「0」：大面积零日打一排 0 是视觉噪声。 -->
        <span v-if="showNums" class="ovbars__marker">
          <span
            class="ovbars__num"
            :class="{ 'ovbars__num--zero': !c.num || c.num === '0' }"
            :style="{ bottom: `calc(${c.bars[0]?.pct ?? '0%'} + 4px)` }"
          >{{ c.num && c.num !== '0' ? c.num : '·' }}</span>
        </span>
      </div>
      <span class="ovbars__label" :class="{ 'ovbars__label--today': c.today }">{{ labelShown(i) ? c.label : '\u00A0' }}</span>
    </component>
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
  /** 单柱宽度（px）：默认 9（半宽卡）；全宽卡传更宽的值 */
  barWidth?: number;
  /** 可访问名：调用方给整图语义（如「近 7 天每日活跃人数」） */
  ariaLabel?: string;
  /** 列级点击：每列变按钮（可 Tab 聚焦 + 回车），点/回车发 select(列 key) */
  selectable?: boolean;
  /** 稀疏形态：只有一列有值时改一行读数，不画满列空柱 */
  sparse?: boolean;
  /** 稀疏行末的口径说明（如「近 7 天仅此日有数据」） */
  sparseNote?: string;
}>(), {
  showNums: true,
  labelEvery: 1,
  minBarsHeight: 64,
  barWidth: 9,
  selectable: false,
  sparse: false,
  sparseNote: ''
});

const emit = defineEmits<{ (e: 'select', key: string): void }>();

const labelShown = computed(() => (i: number) => i % props.labelEvery === 0 || i === props.cols.length - 1);

/* 有值的列：num 非空且非零。sparse 开启且恰好一列有值时走一行读数形态。 */
const sparseActive = computed<OvBarsCol | null>(() => {
  if (!props.sparse) return null
  const active = props.cols.filter((c) => c.num != null && c.num !== '' && c.num !== '0')
  return active.length === 1 ? active[0]! : null
})

/* 可访问名兜底：根节点把一串纯数字列收成一句整图语义；ariaLabel 未传时由 cols 逐列拼
   「标签 数值」（稀显藏掉的标签此处仍读全），有今日列时补「截至现在」。 */
const colsSummary = computed(() => {
  const parts = props.cols.map((c) => `${c.label} ${c.num && c.num !== '' ? c.num : '0'}`);
  return `柱状图：${parts.join('、')}${props.cols.some((c) => c.today) ? '（今日为截至现在）' : ''}`;
});
</script>

<style scoped>
/* 每列结构：柱区（flex 撑满、底对齐）+ 标签行（锁高），任何一列文字折行都不会把柱子基线顶乱。 */
.ovbars {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(var(--ovbars-cols), minmax(0, 1fr));
  gap: 8px;
  align-items: stretch;
  /* 顶部数值带（只有 showNums 时生效）：24 ≥ 数值 18 + 与柱顶 4px 间隙 + 2px 余量 */
  --ovbars-num-band: 24px;
}
.ovbars__col {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  min-width: 0;
  border-radius: var(--mk-radius-sm);
  border: 0;
  background: transparent;
  padding: 0;
  font: inherit;
  color: inherit;
}
/* 可点列：只给焦点环与 hover 底色，不改变柱形与基线 */
.ovbars__col--selectable { cursor: pointer; }
.ovbars__col--selectable:hover { background: var(--mk-hover-surface); }
.ovbars__col--selectable:focus-visible { outline: 2px solid var(--mk-blue); outline-offset: 2px; }
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
/* 数值：贴柱顶（绝对定位于数值层内，bottom 由模板按柱高内联给） */
.ovbars__num {
  position: absolute;
  left: 0;
  right: 0;
  align-items: flex-end;
  color: var(--mk-muted);
  font-weight: 700;
}
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
  position: relative;
  /* 柱区基线：每列一段底线，列间 gap 自然断开成刻度节奏，零值日也能读出「这里有一条轴」 */
  border-bottom: 1px solid var(--mk-line);
}
/* 顶部预留带：柱高百分比按柱区内容框解析，内容框顶 = 预留带下沿 */
.ovbars--nums .ovbars__bars {
  padding-top: var(--ovbars-num-band);
  min-height: calc(var(--ovbars-min) + var(--ovbars-num-band));
}
/* 数值定位层：精确覆盖柱区内容框（与柱高同一基），自身不参与 flex 排布 */
.ovbars__marker {
  position: absolute;
  inset: var(--ovbars-num-band) 0 0;
  pointer-events: none;
}
.ovbars__bar {
  border-radius: var(--mk-radius-xs) var(--mk-radius-xs) 0 0;
  background: linear-gradient(180deg, color-mix(in srgb, var(--mk-blue) 72%, white), var(--mk-blue));
  opacity: 0.85;
}
.ovbars__bar--green { background: linear-gradient(180deg, color-mix(in srgb, var(--mk-green) 72%, white), var(--mk-green)); opacity: 1; }
.ovbars__bar--amber { background: linear-gradient(180deg, color-mix(in srgb, var(--mk-amber) 72%, white), var(--mk-amber)); }
.ovbars__bar--red { background: linear-gradient(180deg, color-mix(in srgb, var(--mk-red) 72%, white), var(--mk-red)); opacity: 0.9; }

/* 稀疏形态：一行读数（数值 + 标签 + 口径），不撑满卡高 */
.ovbars--sparse { display: block; }
.ovbars__sparse {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  padding: 8px 0;
  border: 0;
  background: transparent;
  font: inherit;
  color: inherit;
  text-align: left;
}
button.ovbars__sparse { cursor: pointer; }
button.ovbars__sparse:hover { background: var(--mk-hover-surface); }
button.ovbars__sparse:focus-visible { outline: 2px solid var(--mk-blue); outline-offset: 2px; }
.ovbars__sparse-num {
  font-size: var(--mk-fs-emphasis);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: var(--mk-ink);
}
.ovbars__sparse-label { font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-muted); }
.ovbars__sparse-note { font-size: var(--mk-fs-micro); color: var(--mk-faint); }
</style>
