<template>
  <!-- role=status + aria-live：骨架屏是全站启动占位与异步页面 loading，读屏需要「正在加载」 -->
  <div
    ref="rootEl"
    :class="flat ? 'skl-list' : 'mk-card skl-card'"
    :style="{ '--skl-cols': cols }"
    role="status"
    aria-live="polite"
    aria-busy="true"
    aria-label="内容加载中"
  >
    <div v-for="i in rowCount" :key="i" class="skl">
      <span
        v-for="j in cols"
        :key="j"
        class="mk-skeleton skl__bar"
        :style="{ width: barWidth(i, j), maxWidth: '100%' }"
      ></span>
    </div>
  </div>
</template>

<script setup lang="ts">
/** 表格骨架屏：live 数据加载时的占位，替代「加载中…」空态。
 *
 * flat：不渲染 .mk-card 外壳，供卡内嵌用（避免卡中卡）。
 * rows 省略：按宿主高度算行数（每行 39px，2~24 行），随容器尺寸变化重算。 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const props = withDefaults(defineProps<{ rows?: number; cols?: number; flat?: boolean }>(), {
  rows: undefined,
  cols: 5,
  flat: false
})

const ROW_HEIGHT = 39
/** 未传 rows 且宿主没有给出可测高度时的行数：与既有 20 处调用的观感一致 */
const DEFAULT_ROWS = 5
const MIN_ROWS = 2
const MAX_ROWS = 24

const rootEl = ref<HTMLElement | null>(null)
const measuredRows = ref(0)
let observer: ResizeObserver | null = null

function measure() {
  const h = rootEl.value?.clientHeight ?? 0
  measuredRows.value = h > 0
    ? Math.min(MAX_ROWS, Math.max(MIN_ROWS, Math.round(h / ROW_HEIGHT)))
    : 0
}

onMounted(() => {
  if (props.rows !== undefined) return
  measure()
  if (typeof ResizeObserver === 'undefined' || !rootEl.value) return
  observer = new ResizeObserver(measure)
  observer.observe(rootEl.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
})

const rowCount = computed(() => props.rows ?? (measuredRows.value || DEFAULT_ROWS))

function barWidth(i: number, j: number) {
  // 伪随机宽度：首列稍宽、末列窄，接近真实表格形态
  const base = j === 0 ? 58 : j === props.cols - 1 ? 18 : 34 + ((i * 17 + j * 29) % 40)
  return `${base}%`
}
</script>

<style scoped>
.skl-card { overflow: hidden; }
/* flat：无卡片外壳时由宿主负责底色/裁切；自身只在有高度时按可用空间铺行 */
.skl-list { display: block; overflow: hidden; }
.skl {
  display: grid;
  grid-template-columns: repeat(var(--skl-cols, 5), 1fr);
  gap: 14px;
  align-items: center;
  padding: 13px 14px;
  border-bottom: 1px solid var(--mk-line, #e6ebf4);
}
.skl:last-child { border-bottom: none; }
/* shimmer 视觉统一走 .mk-skeleton（shared.css，含暗色与 prefers-reduced-motion）；本类只管形状 */
.skl__bar { height: 12px; }

/* 暗色模式 */
html[data-theme='dark'] .skl { border-bottom-color: var(--wf-border-light); }
</style>
