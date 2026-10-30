<template>
  <figure class="teaching-figure" :class="{ 'teaching-figure--spec': !isPositionLine }" :style="cardStyle">
    <button
      v-if="isPositionLine"
      type="button"
      class="teaching-figure__canvas"
      aria-label="放大查看位置线图"
      @click="zoomed = true"
    >
      <svg :viewBox="`0 0 ${W} ${height}`" :width="W" :height="height" role="img" :aria-label="ariaLabel" :style="tfVars">
        <!-- 单位（左上角，避免与参考线标签抢位） -->
        <text v-if="unit" class="tf-unit" x="10" :y="20">{{ `单位：${unit}` }}</text>

        <!-- 参考线（追及点/相遇点/分界）：虚线 + 顶部标签 -->
        <g v-for="(g, gi) in guideRows" :key="`g${gi}`">
          <line class="tf-guide" :x1="g.x" :y1="g.labelY + 10" :x2="g.x" :y2="axisY + spanBlock" />
          <text v-if="g.label" class="tf-guide-label" :x="g.x" :y="g.labelY" :text-anchor="g.anchor">{{ g.label }}</text>
        </g>

        <!-- 轴：位置线本体，右端箭头表示正方向 -->
        <line class="tf-axis" :x1="padX" :y1="axisY" :x2="W - padX" :y2="axisY" />
        <polygon
          class="tf-axis-head"
          :points="`${W - padX},${axisY} ${W - padX - 10},${axisY - 5} ${W - padX - 10},${axisY + 5}`"
        />

        <!-- 刻度 -->
        <g v-for="(t, ti) in tickRows" :key="`t${ti}`">
          <line class="tf-tick" :x1="t.x" :y1="axisY" :x2="t.x" :y2="axisY + 7" />
          <text v-if="t.label" class="tf-tick-label" :x="t.x" :y="t.y" text-anchor="middle">{{ t.label }}</text>
        </g>

        <!-- 对象（人物/物/点）：圆点 + 朝向箭头 + 标签 -->
        <g v-for="(m, mi) in markRows" :key="`m${mi}`">
          <circle class="tf-mark" :cx="m.x" :cy="axisY" r="5.5" />
          <g v-if="m.dir !== 'none'">
            <line
              class="tf-mark-arrow"
              :x1="m.x + (m.dir === 'right' ? 10 : -10)"
              :y1="axisY"
              :x2="m.x + (m.dir === 'right' ? 44 : -44)"
              :y2="axisY"
            />
            <polygon
              class="tf-mark-head"
              :points="
                m.dir === 'right'
                  ? `${m.x + 46},${axisY} ${m.x + 36},${axisY - 5} ${m.x + 36},${axisY + 5}`
                  : `${m.x - 46},${axisY} ${m.x - 36},${axisY - 5} ${m.x - 36},${axisY + 5}`
              "
            />
          </g>
          <text class="tf-mark-label" :x="m.labelX" :y="m.labelY" text-anchor="middle">{{ m.label }}</text>
        </g>

        <!-- 区间标注（距离/差）：端线 + 尺寸线 + 标签 -->
        <g v-for="(s, si) in spanRows" :key="`s${si}`">
          <line class="tf-span-end" :x1="s.x1" :y1="s.y - 7" :x2="s.x1" :y2="s.y + 7" />
          <line class="tf-span-end" :x1="s.x2" :y1="s.y - 7" :x2="s.x2" :y2="s.y + 7" />
          <line class="tf-span" :x1="s.x1" :y1="s.y" :x2="s.x2" :y2="s.y" />
          <text class="tf-span-label" :x="(s.x1 + s.x2) / 2" :y="s.y - 9" text-anchor="middle">{{ s.label }}</text>
        </g>
        <!-- 归类括号：这几个点是同一类，不是「从 A 到 B 的距离」 -->
        <g v-if="groupRow">
          <path class="tf-group-brace" :d="groupRow.d" />
          <text class="tf-group-label" :x="groupRow.mid" :y="groupRow.y + 30" text-anchor="middle">{{ groupRow.label }}</text>
        </g>
      </svg>
    </button>
    <!-- 二维图型（grid/matrix/compare/quadrant/bipartite/board）：确定性渲染器直接产出 SVG 字符串。
         所有文字都已转义、颜色/虚线都过白名单（后端 + 渲染器两道），可以安全内联。 -->
    <button
      v-else-if="specRendered"
      type="button"
      class="teaching-figure__canvas"
      aria-label="放大查看教学图"
      @click="zoomed = true"
      v-html="specRendered.svg"
    />
    <figcaption v-if="caption">{{ caption }}</figcaption>
    <span class="teaching-figure__hint" aria-hidden="true">点击放大</span>
    <!-- 放大层：窄卡里位置线按比例缩小后标签会挤，点开满屏按 1:1 看 -->
    <Teleport to="body">
      <div v-if="zoomed" class="figure-zoom" role="dialog" aria-modal="true" aria-label="教学图放大" @click="zoomed = false">
        <div v-if="!isPositionLine && specRendered" class="figure-zoom__canvas" @click.stop v-html="specRendered.svg" />
        <div v-else class="figure-zoom__canvas" @click.stop>
          <svg :viewBox="`0 0 ${W} ${height}`" :width="W" :height="height" role="img" :aria-label="ariaLabel" :style="tfVars">
            <text v-if="unit" class="tf-unit" x="10" :y="20">{{ `单位：${unit}` }}</text>
            <g v-for="(g, gi) in guideRows" :key="`zg${gi}`">
              <line class="tf-guide" :x1="g.x" :y1="g.labelY + 10" :x2="g.x" :y2="axisY + spanBlock" />
              <text v-if="g.label" class="tf-guide-label" :x="g.x" :y="18" :text-anchor="g.anchor">{{ g.label }}</text>
            </g>
            <line class="tf-axis" :x1="padX" :y1="axisY" :x2="W - padX" :y2="axisY" />
            <polygon class="tf-axis-head" :points="`${W - padX},${axisY} ${W - padX - 10},${axisY - 5} ${W - padX - 10},${axisY + 5}`" />
            <g v-for="(t, ti) in tickRows" :key="`zt${ti}`">
              <line class="tf-tick" :x1="t.x" :y1="axisY" :x2="t.x" :y2="axisY + 7" />
              <text v-if="t.label" class="tf-tick-label" :x="t.x" :y="t.y" text-anchor="middle">{{ t.label }}</text>
            </g>
            <g v-for="(m, mi) in markRows" :key="`zm${mi}`">
              <circle class="tf-mark" :cx="m.x" :cy="axisY" r="5.5" />
              <g v-if="m.dir !== 'none'">
                <line
                  class="tf-mark-arrow"
                  :x1="m.x + (m.dir === 'right' ? 10 : -10)"
                  :y1="axisY"
                  :x2="m.x + (m.dir === 'right' ? 44 : -44)"
                  :y2="axisY"
                />
                <polygon
                  class="tf-mark-head"
                  :points="
                    m.dir === 'right'
                      ? `${m.x + 46},${axisY} ${m.x + 36},${axisY - 5} ${m.x + 36},${axisY + 5}`
                      : `${m.x - 46},${axisY} ${m.x - 36},${axisY - 5} ${m.x - 36},${axisY + 5}`
                  "
                />
              </g>
              <text class="tf-mark-label" :x="m.labelX" :y="m.labelY" text-anchor="middle">{{ m.label }}</text>
            </g>
            <g v-for="(s, si) in spanRows" :key="`zs${si}`">
              <line class="tf-span-end" :x1="s.x1" :y1="s.y - 7" :x2="s.x1" :y2="s.y + 7" />
              <line class="tf-span-end" :x1="s.x2" :y1="s.y - 7" :x2="s.x2" :y2="s.y + 7" />
              <line class="tf-span" :x1="s.x1" :y1="s.y" :x2="s.x2" :y2="s.y" />
              <text class="tf-span-label" :x="(s.x1 + s.x2) / 2" :y="s.y - 9" text-anchor="middle">{{ s.label }}</text>
            </g>
            <!-- 归类括号：这几个点是同一类，不是「从 A 到 B 的距离」 -->
            <g v-if="groupRow">
              <path class="tf-group-brace" :d="groupRow.d" />
              <text class="tf-group-label" :x="groupRow.mid" :y="groupRow.y + 30" text-anchor="middle">{{ groupRow.label }}</text>
            </g>
          </svg>
        </div>
        <button type="button" class="figure-zoom__btn" @click="zoomed = false">关闭</button>
      </div>
    </Teleport>
  </figure>
</template>

<script setup lang="ts">
/**
 * 位置线图（2026-09-27 双通道重构 Scope B）——空间位置关系的确定性渲染。
 *
 * 为什么单开一条通道：真实语料实证（小学追及题「把小明在前、小红在后摆成一条线」）
 * 的学习对象本身就是位置线，mermaid 的节点-边表达不了自由定位。这里只有一组最底层原语
 * （轴/刻度/对象/朝向箭头/区间标注/参考线），全部由数值域线性映射而来——
 * 渲染是纯函数：同一份 spec 永远画出同一张图，无生成、无联网、零乱码。
 *
 * 数值域由后端归一化保证覆盖所有取值（见 skill normalizeFigure），前端不裁剪、不改数。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { TeachingFigure } from '@/views/v2/learningChat';
import { renderSpecFigure } from './teaching-figure/render';
import { materialForPalette, resolveTheme } from './teaching-figure/style';

const props = defineProps<{ figure: TeachingFigure }>();

/**
 * 图型分派：`position-line` 走本文件的 Vue 模板（既有契约，标签避让更精细）；
 * 其余图型（grid/matrix/compare/quadrant/bipartite/board）走确定性渲染器产出的 SVG 字符串。
 * 旧消息没有 kind/spec → 一律按位置线处理（向后兼容）。
 */
const isPositionLine = computed(() => (props.figure?.kind || 'position-line') === 'position-line');
const specRendered = computed(() => {
  if (isPositionLine.value) return null;
  return renderSpecFigure(props.figure?.kind || '', props.figure?.spec, {
    palette: props.figure?.palette as never,
  });
});

/**
 * 位置线通道也要吃学科配色（2026-10-19）：它是手写模板，不走 `renderSpecFigure`，
 * 不注入令牌就会出现「纸纹暖色的 bins + 冷灰的位置线」并排在一节课里。
 * 只换色，不动几何与字号。
 */
const theme = computed(() => resolveTheme(props.figure?.palette as never));
const tfVars = computed(() => {
  // 老消息没有 palette：不注入任何变量（CSS 的 var 回落值就是改动前的颜色，画面零变化）
  if (!props.figure?.palette) return {};
  return {
    '--tf-ink': theme.value.ink,
    '--tf-line': theme.value.line,
    '--tf-line-strong': theme.value.lineStrong,
    '--tf-muted': theme.value.muted,
    '--tf-faint': theme.value.faint,
    '--tf-accent': theme.value.accent,
    '--tf-accent-ink': theme.value.accentInk,
  };
});
const cardStyle = computed(() =>
  materialForPalette(props.figure?.palette as never) === 'paper' ? { background: theme.value.surface } : {},
);

/** 画布固定宽（自然尺寸出图，窄卡内横向滚动；放大层按 1:1 显示） */
const W = 760;
const padX = 46;
const axisY = 118;

const zoomed = ref(false);
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && zoomed.value) zoomed.value = false;
}
onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));

const domain = computed(() => {
  const min = props.figure?.axis?.min ?? 0;
  const max = props.figure?.axis?.max ?? 1;
  return max > min ? { min, max } : { min: 0, max: 1 };
});
const unit = computed(() => props.figure?.axis?.unit || null);
const caption = computed(() => props.figure?.caption || null);

const plotW = W - padX * 2;
function toX(at: number): number {
  const { min, max } = domain.value;
  const ratio = (at - min) / (max - min);
  return padX + Math.min(Math.max(ratio, 0), 1) * plotW;
}

const guides = computed(() => props.figure?.guides || []);
const spans = computed(() => props.figure?.spans || []);

/** 参考线占用的底部高度（区间标注逐行下移，避免与参考线交叠） */
/**
 * 刻度标签行：同一行的相邻标签估算宽度重叠时，后来的下移一行。
 * 真实课文实测：40% 与 45% 两个时刻各带一条六个字的中文标签，居中画会叠成一团黑字。
 */
const tickRows = computed(() => {
  const ticks = props.figure?.axis?.ticks || [];
  const marks = props.figure?.marks || [];
  const rows: Array<{ x: number; label: string | null; y: number }> = [];
  const rowRight = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  let maxRow = 0;
  for (const t of ticks) {
    const x = toX(t.at);
    const label = t.label || null;
    // 同一位置的对象标签已经写着同一句话时，刻度不再复述一遍——
    // 否则「最低那天」会在线上下各出现一次（2026-10-21 目检 #17）。
    const dup = label && marks.some((m) => Math.abs(toX(m.at) - x) < 1 && m.label === label);
    if (!label || dup) {
      rows.push({ x, label: dup ? null : label, y: axisY + 23 });
      continue;
    }
    const half = (label.length * 12.5) / 2;
    const fit = rowRight.findIndex((right) => x - half >= right + 4);
    const row = fit === -1 ? rowRight.length - 1 : fit;
    rowRight[row] = Math.max(rowRight[row], x + half);
    maxRow = Math.max(maxRow, row);
    rows.push({ x, label, y: axisY + 23 + row * 16 });
  }
  return rows;
});
/** 刻度标签多占的行高：下面的区间标注与画布高度都要跟着下移 */
const tickExtra = computed(() => Math.max(0, ...tickRows.value.map((t) => t.y - (axisY + 23))));

const spanBlock = computed(
  () => tickExtra.value + (spans.value.length ? spans.value.length * 36 + 30 : 0) + (props.figure?.group ? 46 : 0),
);
const height = computed(() => axisY + 34 + spanBlock.value + 16);

/**
 * 参考线只画有名字的那几条：没有标签的竖虚线在图上找不到指称对象，
 * 读者只能读成「凭空一条线」（2026-10-21 真实课文实测，模型给了 at:2500 / label:null）。
 * 标签靠边时改用内侧对齐：居中会把长标签顶出画布（同一批实测 #11「最后写视图…北京」）。
 */
/**
 * 单位标签占住左上角；左端的参考线标签必须下移一行，否则「单位：相对位置」与「起点」叠在一起
 * （2026-10-22 夜间跑批 #216：两行 bbox 重叠 26×13）。
 */
const unitRight = computed(() => (unit.value ? 10 + String(`单位：${unit.value}`).length * 12.5 : 0));
const guideRows = computed(() =>
  guides.value
    .filter((g) => !!g.label)
    .map((g) => {
      const x = toX(g.at);
      const half = (String(g.label).length * 12.5) / 2;
      const anchor = x - half < 8 ? 'start' : x + half > W - 8 ? 'end' : 'middle';
      // 标签左缘落在单位标签的横向范围内 → 让到单位下面一行
      const labelY = unit.value && x - half < unitRight.value + 6 ? 38 : 18;
      return { x, label: g.label, anchor, labelY };
    }),
);
/**
 * 对象标签行：贪心避让——同一行的相邻标签估算宽度重叠时，后来的上移一行。
 * （标签是教学信息，宁可分两行也不能叠在一起看不清。）
 */
const markRows = computed(() => {
  const marks = props.figure?.marks || [];
  const rows: Array<{ x: number; label: string; dir: 'right' | 'left' | 'none'; labelY: number; labelX: number }> = [];
  // 三行足够（marks ≤ 6，且后端已按 at 升序去重）；行内右边界用于判断重叠
  const rowRight = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const mark of marks) {
    const x = toX(mark.at);
    const halfWidth = (mark.label.length * 15 + 14) / 2;
    const rowIndex = rowRight.findIndex((right) => x - halfWidth >= right);
    const row = rowIndex === -1 ? rowRight.length - 1 : rowIndex;
    rowRight[row] = x + halfWidth;
    // 轴端点的标签居中后会探出画布（#202 左边被裁 4px）：把文字中心收回画布内，圆点仍钉在原位
    const labelX = Math.min(Math.max(x, 8 + halfWidth - 7), W - 8 - halfWidth + 7);
    rows.push({ x, label: mark.label, dir: mark.dir || 'none', labelY: axisY - 26 - row * 24, labelX });
  }
  return rows;
});

/**
 * 归类括号（group）：花括号的语义是「这几个归在一起」，与 spans（跨度/距离）刻意区分。
 * 2026-10-20 两轮外部视觉审校：用区间线说「同一性」会被读成跨度，用重复标签会被读成重复的题。
 */
const groupRow = computed(() => {
  const g = props.figure?.group;
  if (!g || typeof g.from !== 'number' || typeof g.to !== 'number' || !g.label) return null;
  const x1 = toX(Math.min(g.from, g.to));
  const x2 = toX(Math.max(g.from, g.to));
  const y = axisY + 40;
  const mid = (x1 + x2) / 2;
  return {
    x1, x2, mid, y,
    label: g.label,
    d: `M ${x1} ${y} L ${x1} ${y + 5} L ${mid - 8} ${y + 5} L ${mid} ${y + 13} L ${mid + 8} ${y + 5} L ${x2} ${y + 5} L ${x2} ${y}`,
  };
});
const spanRows = computed(() =>
  spans.value.map((s, i) => ({
    x1: toX(s.from),
    x2: toX(s.to),
    label: s.label,
    // 上移 18px：区间标注原来紧贴刻度标签（「第二道」与区间说明撞在同一行位置）
    y: axisY + 64 + tickExtra.value + i * 36,
  }))
);

/** 读屏描述：位置线图对无障碍用户必须能用一句话说清（图本身是给视觉的） */
const ariaLabel = computed(() => {
  const marks = (props.figure?.marks || [])
    .map((m) => `${m.label}在${m.at}${unit.value || ''}${m.dir === 'right' ? '向右' : m.dir === 'left' ? '向左' : ''}`)
    .join('，');
  const spansText = spans.value.map((s) => `${s.label}（${s.from}到${s.to}）`).join('，');
  return ['位置线图', marks, spansText].filter(Boolean).join('；');
});
</script>

<style scoped>
.teaching-figure {
  position: relative;
  margin: 10px 0 0;
  padding: 12px 12px 8px;
  /* 与结构图同一张"教具纸"：白底、细边、圆角（课堂暗色主题下也按纸呈现）。
     #ffffff 为有意的固定纸面（暗色下不翻转）——无对应令牌，保留登记。 */
  background: #ffffff;
  border: 1px solid var(--mk-line);
  /* 嵌入式图面 = 次级面板档 12 */
  border-radius: var(--mk-radius-lg);
  overflow-x: auto;
}
.teaching-figure__canvas {
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  background: none;
  text-align: left;
  cursor: zoom-in;
}
.teaching-figure__hint {
  position: absolute;
  top: 8px;
  right: 10px;
  padding: 1px 8px;
  border-radius: var(--mk-radius-pill);
  background: rgba(15, 23, 42, 0.06);
  color: #6b7280;
  font-size: var(--mk-fs-micro);
  pointer-events: none;
}
/* 二维图型：SVG 自带标题/页脚，绝对定位的角标会压住正文——改为图下方一行右对齐提示 */
.teaching-figure--spec .teaching-figure__hint {
  position: static;
  display: block;
  margin-top: 2px;
  padding: 0;
  background: none;
  text-align: right;
}
.teaching-figure figcaption {
  margin-top: 6px;
  font-size: var(--mk-fs-micro);
  color: var(--text-secondary);
  text-align: center;
}
.teaching-figure__canvas svg {
  display: block;
  /* 自然尺寸出图：全局 svg{max-width:100%} 会把 760 宽的位置线缩到卡宽（标签跟着缩到看不清），
     这里显式放开，宽图由卡片横向滚动承接（与结构图通道同一口径） */
  max-width: none;
  height: auto;
}
/* 图元样式（SVG 内，纯视觉；文字一律 ≥12px 保证可读） */
.tf-axis {
  stroke: var(--tf-line-strong, #334155);
  stroke-width: 1.6;
}
.tf-axis-head {
  fill: var(--tf-line-strong, #334155);
}
.tf-tick {
  stroke: var(--tf-line, #94a3b8);
  stroke-width: 1.2;
}
.tf-tick-label {
  font-size: 13px;
  fill: var(--tf-muted, #64748b);
}
.tf-mark {
  fill: var(--tf-ink, #1e293b);
}
.tf-mark-arrow {
  stroke: var(--tf-ink, #1e293b);
  stroke-width: 1.6;
}
.tf-mark-head {
  fill: var(--tf-ink, #1e293b);
}
.tf-mark-label {
  font-size: 15px;
  font-weight: 600;
  fill: var(--tf-ink, #0f172a);
}

/* 归类括号（不是区间线）：花括号=「归在一起」，直连杆+端线=跨度 */
.tf-group-brace {
  fill: none;
  stroke: var(--tf-accent, #4f46e5);
  stroke-width: 1.4;
  stroke-linecap: round;
}
.tf-group-label {
  font-size: 12.5px;
  font-weight: 600;
  fill: var(--tf-accent-ink, #4338ca);
}
.tf-span,
.tf-span-end {
  stroke: var(--tf-accent, #2563eb);
  stroke-width: 1.3;
}
.tf-span-label {
  font-size: 13px;
  fill: var(--tf-accent-ink, #1d4ed8);
}
.tf-guide {
  stroke: var(--tf-line, #94a3b8);
  stroke-width: 1.2;
  stroke-dasharray: 5 4;
}
.tf-guide-label {
  font-size: 13px;
  fill: var(--tf-muted, #64748b);
}
.tf-unit {
  font-size: 13px;
  fill: var(--tf-faint, #94a3b8);
}
/* 放大层 */
.figure-zoom {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.72);
  cursor: zoom-out;
}
.figure-zoom__canvas {
  max-width: 96vw;
  max-height: 86vh;
  padding: 16px;
  overflow: auto;
  /* 放大层 = 模态弹层 → 卡片·弹层档 16；纸面 #ffffff 同上（教具纸，保留登记） */
  background: #ffffff;
  border-radius: var(--mk-radius-xl);
  cursor: default;
}
.figure-zoom__canvas svg {
  display: block;
  max-width: none;
}
.figure-zoom__btn {
  position: absolute;
  top: 16px;
  right: 20px;
  padding: 6px 14px;
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: var(--mk-radius-pill);
  background: rgba(15, 23, 42, 0.6);
  color: #fff;
  font-size: 13px;
  cursor: pointer;
}
</style>
