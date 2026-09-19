<template>
  <!-- 骨架屏版式（形状层）。视觉（shimmer / 暗色 / reduced-motion）由 shared.css 的
       .mk-skeleton 提供；本组件只负责把占位块排成可辨认的形状，替代各页自写的
       .ud-skel / .tc-skel / .sk-rec__skeleton / .cp-*-skel 布局类。

       五种版式（研究现有页面后归纳）：
         block    单块（默认）—— 万能原子，w/h/radius/circle 自定
         rows     N 条等高横条 —— 行列表 / 日志流
         cards    N 个块，自动填列或固定列数 —— 指标格 / 卡片网格
         identity 头像 + 两行文字 —— 详情页身份行
         bars     N 根错落竖条 —— 图表区
  -->
  <div v-if="variant === 'rows'" class="mk-skeleton-rows" aria-hidden="true">
    <span
      v-for="i in count"
      :key="i"
      class="mk-skeleton"
      :style="{
        height: px(resolvedH),
        width: jitter ? jitterWidth(i) : undefined,
        maxWidth: '100%',
        borderRadius: px(radius)
      }"
    />
  </div>

  <div
    v-else-if="variant === 'cards'"
    class="mk-skeleton-cards"
    :class="{ 'mk-skeleton-cards--fixed': !!cols }"
    :style="cardsStyle"
    aria-hidden="true"
  >
    <span
      v-for="i in count"
      :key="i"
      class="mk-skeleton"
      :style="{ height: px(resolvedH), borderRadius: px(radius) }"
    />
  </div>

  <div v-else-if="variant === 'identity'" class="mk-skeleton-identity" aria-hidden="true">
    <span class="mk-skeleton" :style="{ width: px(avatar), height: px(avatar), borderRadius: px(radius || 12) }" />
    <div class="mk-skeleton-identity__lines">
      <span class="mk-skeleton" :style="{ height: px(18), width: '55%' }" />
      <span class="mk-skeleton" :style="{ height: px(12), width: '80%' }" />
    </div>
  </div>

  <div v-else-if="variant === 'bars'" class="mk-skeleton-bars" :style="{ height: px(resolvedH) }" aria-hidden="true">
    <span v-for="i in count" :key="i" class="mk-skeleton" :style="{ borderRadius: px(radius) }" />
  </div>

  <span
    v-else
    class="mk-skeleton"
    :class="{ 'mk-skeleton--circle': circle, 'mk-skeleton--block': block }"
    :style="{
      width: w === '' ? undefined : px(w),
      height: px(resolvedH),
      borderRadius: radius === '' ? undefined : px(radius)
    }"
    aria-hidden="true"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 版式：block 单块 | rows 行列表 | cards 卡片网格 | identity 身份行 | bars 柱状图 */
    variant?: 'block' | 'rows' | 'cards' | 'identity' | 'bars'
    /** block：宽（数字按 px，或 CSS 长度串如 '60%'） */
    w?: number | string
    /** 块高；rows/cards/bars 下为每项高度，未传时按版式取默认 */
    h?: number | string
    /** 圆角（数字按 px）；identity 下用于头像（默认 12） */
    radius?: number | string
    /** block：圆形（头像占位） */
    circle?: boolean
    /** block：大圆角块（卡片占位） */
    block?: boolean
    /** rows/cards/bars：项数 */
    count?: number
    /** rows：宽度抖动，让占位更像真实文本（首条偏宽、末条偏窄） */
    jitter?: boolean
    /** cards：固定列数（与真实布局逐列对齐）；不传则按 min 自动填列 */
    cols?: number
    /** cards：自动填列时的最小列宽 */
    min?: number
    /** identity：头像边长 */
    avatar?: number
  }>(),
  {
    variant: 'block',
    w: '',
    h: undefined,
    radius: '',
    circle: false,
    block: false,
    count: 3,
    jitter: false,
    cols: 0,
    min: 150,
    avatar: 48
  }
)

const px = (v: number | string | undefined) => (v === undefined ? undefined : typeof v === 'number' ? `${v}px` : v)

/** 各版式的默认项高（未显式传 h 时） */
const DEFAULT_H: Record<string, number> = { block: 12, rows: 14, cards: 64, identity: 12, bars: 150 }
const resolvedH = computed(() => props.h ?? DEFAULT_H[props.variant] ?? 12)

const cardsStyle = computed(() => {
  const s: Record<string, string> = {}
  if (props.cols) s['--mk-skel-cols'] = String(props.cols)
  else s['--mk-skel-card-min'] = `${props.min}px`
  return s
})

/** 与 SkeletonTable 的伪随机宽度同思路：稳定、无明显周期、首宽末窄 */
function jitterWidth(i: number) {
  const last = props.count
  if (i === 1) return '58%'
  if (i === last) return '24%'
  return `${34 + ((i * 17) % 40)}%`
}
</script>
