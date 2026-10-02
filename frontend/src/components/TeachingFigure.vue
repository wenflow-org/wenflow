<template>
  <figure class="teaching-figure">
    <button
      type="button"
      class="teaching-figure__canvas"
      aria-label="放大查看位置线图"
      @click="zoomed = true"
    >
      <svg :viewBox="`0 0 ${W} ${height}`" :width="W" :height="height" role="img" :aria-label="ariaLabel">
        <!-- 单位（左上角，避免与参考线标签抢位） -->
        <text v-if="unit" class="tf-unit" x="10" :y="20">{{ `单位：${unit}` }}</text>

        <!-- 参考线（追及点/相遇点/分界）：虚线 + 顶部标签 -->
        <g v-for="(g, gi) in guideRows" :key="`g${gi}`">
          <line class="tf-guide" :x1="g.x" :y1="28" :x2="g.x" :y2="axisY + spanBlock" />
          <text v-if="g.label" class="tf-guide-label" :x="g.x" :y="18" text-anchor="middle">{{ g.label }}</text>
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
          <text v-if="t.label" class="tf-tick-label" :x="t.x" :y="axisY + 23" text-anchor="middle">{{ t.label }}</text>
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
          <text class="tf-mark-label" :x="m.x" :y="m.labelY" text-anchor="middle">{{ m.label }}</text>
        </g>

        <!-- 区间标注（距离/差）：端线 + 尺寸线 + 标签 -->
        <g v-for="(s, si) in spanRows" :key="`s${si}`">
          <line class="tf-span-end" :x1="s.x1" :y1="s.y - 7" :x2="s.x1" :y2="s.y + 7" />
          <line class="tf-span-end" :x1="s.x2" :y1="s.y - 7" :x2="s.x2" :y2="s.y + 7" />
          <line class="tf-span" :x1="s.x1" :y1="s.y" :x2="s.x2" :y2="s.y" />
          <text class="tf-span-label" :x="(s.x1 + s.x2) / 2" :y="s.y - 9" text-anchor="middle">{{ s.label }}</text>
        </g>
      </svg>
    </button>
    <span class="teaching-figure__hint" aria-hidden="true">点击放大</span>
    <figcaption v-if="caption">{{ caption }}</figcaption>
    <!-- 放大层：窄卡里位置线按比例缩小后标签会挤，点开满屏按 1:1 看 -->
    <Teleport to="body">
      <div v-if="zoomed" class="figure-zoom" role="dialog" aria-modal="true" aria-label="位置线图放大" @click="zoomed = false">
        <div class="figure-zoom__canvas" @click.stop>
          <svg :viewBox="`0 0 ${W} ${height}`" :width="W" :height="height" role="img" :aria-label="ariaLabel">
            <text v-if="unit" class="tf-unit" x="10" :y="20">{{ `单位：${unit}` }}</text>
            <g v-for="(g, gi) in guideRows" :key="`zg${gi}`">
              <line class="tf-guide" :x1="g.x" :y1="28" :x2="g.x" :y2="axisY + spanBlock" />
              <text v-if="g.label" class="tf-guide-label" :x="g.x" :y="18" text-anchor="middle">{{ g.label }}</text>
            </g>
            <line class="tf-axis" :x1="padX" :y1="axisY" :x2="W - padX" :y2="axisY" />
            <polygon class="tf-axis-head" :points="`${W - padX},${axisY} ${W - padX - 10},${axisY - 5} ${W - padX - 10},${axisY + 5}`" />
            <g v-for="(t, ti) in tickRows" :key="`zt${ti}`">
              <line class="tf-tick" :x1="t.x" :y1="axisY" :x2="t.x" :y2="axisY + 7" />
              <text v-if="t.label" class="tf-tick-label" :x="t.x" :y="axisY + 23" text-anchor="middle">{{ t.label }}</text>
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
              <text class="tf-mark-label" :x="m.x" :y="m.labelY" text-anchor="middle">{{ m.label }}</text>
            </g>
            <g v-for="(s, si) in spanRows" :key="`zs${si}`">
              <line class="tf-span-end" :x1="s.x1" :y1="s.y - 7" :x2="s.x1" :y2="s.y + 7" />
              <line class="tf-span-end" :x1="s.x2" :y1="s.y - 7" :x2="s.x2" :y2="s.y + 7" />
              <line class="tf-span" :x1="s.x1" :y1="s.y" :x2="s.x2" :y2="s.y" />
              <text class="tf-span-label" :x="(s.x1 + s.x2) / 2" :y="s.y - 9" text-anchor="middle">{{ s.label }}</text>
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

const props = defineProps<{ figure: TeachingFigure }>();

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
const spanBlock = computed(() => (spans.value.length ? spans.value.length * 36 + 12 : 0));
const height = computed(() => axisY + 34 + spanBlock.value + 16);

const guideRows = computed(() => guides.value.map((g) => ({ x: toX(g.at), label: g.label || null })));
const tickRows = computed(() => (props.figure?.axis?.ticks || []).map((t) => ({ x: toX(t.at), label: t.label || null })));

/**
 * 对象标签行：贪心避让——同一行的相邻标签估算宽度重叠时，后来的上移一行。
 * （标签是教学信息，宁可分两行也不能叠在一起看不清。）
 */
const markRows = computed(() => {
  const marks = props.figure?.marks || [];
  const rows: Array<{ x: number; label: string; dir: 'right' | 'left' | 'none'; labelY: number }> = [];
  // 三行足够（marks ≤ 6，且后端已按 at 升序去重）；行内右边界用于判断重叠
  const rowRight = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const mark of marks) {
    const x = toX(mark.at);
    const halfWidth = (mark.label.length * 15 + 14) / 2;
    const rowIndex = rowRight.findIndex((right) => x - halfWidth >= right);
    const row = rowIndex === -1 ? rowRight.length - 1 : rowIndex;
    rowRight[row] = x + halfWidth;
    rows.push({ x, label: mark.label, dir: mark.dir || 'none', labelY: axisY - 26 - row * 24 });
  }
  return rows;
});

const spanRows = computed(() =>
  spans.value.map((s, i) => ({
    x1: toX(s.from),
    x2: toX(s.to),
    label: s.label,
    y: axisY + 46 + i * 36,
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
  stroke: #334155;
  stroke-width: 1.6;
}
.tf-axis-head {
  fill: #334155;
}
.tf-tick {
  stroke: #94a3b8;
  stroke-width: 1.2;
}
.tf-tick-label {
  font-size: 13px;
  fill: #64748b;
}
.tf-mark {
  fill: #1e293b;
}
.tf-mark-arrow {
  stroke: #1e293b;
  stroke-width: 1.6;
}
.tf-mark-head {
  fill: #1e293b;
}
.tf-mark-label {
  font-size: 15px;
  font-weight: 600;
  fill: #0f172a;
}
.tf-span,
.tf-span-end {
  stroke: #2563eb;
  stroke-width: 1.3;
}
.tf-span-label {
  font-size: 13px;
  fill: #1d4ed8;
}
.tf-guide {
  stroke: #94a3b8;
  stroke-width: 1.2;
  stroke-dasharray: 5 4;
}
.tf-guide-label {
  font-size: 13px;
  fill: #64748b;
}
.tf-unit {
  font-size: 13px;
  fill: #94a3b8;
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
