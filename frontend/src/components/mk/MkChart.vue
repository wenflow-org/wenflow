<template>
  <div ref="el" class="mk-chart" :style="{ height }"></div>
</template>

<script setup lang="ts">
/**
 * MkChart：ECharts 轻封装（B 组图表升级）
 * - 按需引入（echarts/core + 仅注册用到的图表/组件），避免全量包把路由 chunk 撑到 1MB+
 * - 自动初始化/销毁/尺寸自适应（ResizeObserver + 组件卸载清理）
 * - option 变化时 setOption（notMerge 默认 false，增量合并保留动画）
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts/core'
import { LineChart, BarChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsCoreOption } from 'echarts/core'
import { useIsDark } from '@/composables/useIsDark'
import { resolveVisualScale } from '@/utils/zoom'
import { MK_CHART_PALETTES, MK_CHART_THEME, type MkChartPalette } from './chartPalette'

echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent, TitleComponent, CanvasRenderer])

/* 注册 admin 图表默认主题：轴/系列未显式指定颜色时落到 palette（chartPalette.ts），
   三页散写的 #8492ab 轴色、#3d7cff 系列色由此收敛为单一来源。 */
let themesRegistered = false
function ensureThemes() {
  if (themesRegistered) return
  themesRegistered = true
  for (const mode of ['light', 'dark'] as const) {
    const p: MkChartPalette = MK_CHART_PALETTES[mode]
    echarts.registerTheme(MK_CHART_THEME[mode], {
      color: [p.primaryBright, p.warn, p.danger, p.primary, p.neutral],
      xAxis: {
        axisLine: { lineStyle: { color: p.axisLine } },
        axisTick: { show: false },
        axisLabel: { color: p.neutral },
      },
      yAxis: {
        splitLine: { lineStyle: { color: p.splitLine } },
        axisLabel: { color: p.neutral },
      },
    })
  }
}
ensureThemes()

const props = withDefaults(
  defineProps<{
    option: EChartsCoreOption
    height?: string
    /** 显式指定主题；不传时跟随 <html data-theme> */
    theme?: 'light' | 'dark'
  }>(),
  { height: '240px' }
)

const el = ref<HTMLElement | null>(null)
let chart: echarts.ECharts | null = null
let ro: ResizeObserver | null = null
let appliedTheme: 'light' | 'dark' | null = null
let appliedDpr = 0
let unbindZrZoom: (() => void) | null = null

const isDark = useIsDark()
const resolvedTheme = computed<'light' | 'dark'>(() => props.theme ?? (isDark.value ? 'dark' : 'light'))

/**
 * CSS zoom 补偿（与 MkGraph.vue:851-868 同源）。
 *
 * `.ac` 在 2000px+ 带 zoom 1.15、3600px+ 带 1.3；zrender 的事件管线只认 `offsetX`
 * （视觉 px），而 canvas 坐标系是 `chart.getWidth()` 的逻辑 px。不折回时 axisPointer /
 * tooltip / hover 会按 (zoom-1)×距离 向右下偏移（2560 实测逻辑 844 → 收到 971）。
 * 系数用「容器视觉宽 ÷ 图表逻辑宽」，不依赖 zoom 具体配置，浏览器缩放也自洽。
 */
function zrScale(instance: echarts.ECharts, root: HTMLElement): number {
  const logicalW = instance.getWidth() || 0
  if (!logicalW) return 1
  const scale = root.getBoundingClientRect().width / logicalW
  return Number.isFinite(scale) && scale > 0 ? scale : 1
}

const ZR_POINTER_EVENTS = [
  'mousedown', 'mousemove', 'mouseup', 'click', 'dblclick', 'contextmenu',
  'mousewheel', 'wheel', 'touchstart', 'touchmove', 'touchend'
] as const

/** 捕获阶段把视觉坐标折回逻辑 px 写进 zrX/zrY：zrender 看到现成坐标就直接采用。 */
function bindZrZoom(instance: echarts.ECharts): () => void {
  const root = instance.getZr().painter.getViewportRoot() as HTMLElement | null
  if (!root) return () => undefined
  type ZrStamped = Event & {
    zrX?: number; zrY?: number; zrDelta?: number; which?: number
    wheelDelta?: number; detail?: number; button?: number
  }
  const stamp = (ev: Event) => {
    const scale = zrScale(instance, root)
    if (Math.abs(scale - 1) < 1e-3) return
    const target = ev as ZrStamped
    if (target.zrX != null) return
    const touch = (ev as TouchEvent).changedTouches?.[0] ?? (ev as TouchEvent).touches?.[0]
    const clientX = touch ? touch.clientX : (ev as MouseEvent).clientX
    const clientY = touch ? touch.clientY : (ev as MouseEvent).clientY
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return
    const rect = root.getBoundingClientRect()
    target.zrX = (clientX - rect.left) / scale
    target.zrY = (clientY - rect.top) / scale
    /* 预置 zrX/zrY 会让 normalizeEvent 早退，必须补齐它原本要算的滚轮方向与按键号。 */
    if (target.zrDelta == null && (ev.type === 'wheel' || ev.type === 'mousewheel')) {
      const raw = target.wheelDelta
      let delta = raw
      if (!delta) {
        const dx = (ev as WheelEvent).deltaX
        const dy = (ev as WheelEvent).deltaY
        if (dx != null && dy != null) {
          const magnitude = dy !== 0 ? Math.abs(dy) : Math.abs(dx)
          const sign = dy > 0 ? -1 : dy < 0 ? 1 : dx > 0 ? -1 : 1
          delta = 3 * magnitude * sign
        }
      }
      target.zrDelta = delta ? delta / 120 : -(target.detail || 0) / 3
    }
    if (
      target.which == null
      && target.button !== undefined
      && /^(?:mouse|pointer|contextmenu|drag|drop)|click/.test(ev.type)
    ) {
      const button = target.button
      target.which = button & 1 ? 1 : button & 2 ? 3 : button & 4 ? 2 : 0
    }
  }
  for (const type of ZR_POINTER_EVENTS) root.addEventListener(type, stamp, true)
  return () => {
    for (const type of ZR_POINTER_EVENTS) root.removeEventListener(type, stamp, true)
  }
}

/** 位图分辨率要同时吃「屏幕 DPR」与「页面 zoom」，否则 2K/4K 下 canvas 被纯拉伸发糊。 */
function chartDpr(): number {
  const zoom = resolveVisualScale(el.value)
  const dpr = (window.devicePixelRatio || 1) * (Number.isFinite(zoom) && zoom > 0 ? zoom : 1)
  return Math.min(4, Math.round(dpr * 100) / 100)
}

/* 主题只能在 init 时传入：切换主题需 dispose 重建（ECharts 无运行时换主题 API）。
   DPR 同样在 init 时固化，zoom 换档 / 换显示器后也需要重建。 */
function render() {
  if (!el.value) return
  const nextTheme = resolvedTheme.value
  const nextDpr = chartDpr()
  if (!chart || appliedTheme !== nextTheme || Math.abs(nextDpr - appliedDpr) > 0.01) {
    unbindZrZoom?.()
    unbindZrZoom = null
    chart?.dispose()
    chart = echarts.init(el.value, MK_CHART_THEME[nextTheme], { devicePixelRatio: nextDpr })
    appliedTheme = nextTheme
    appliedDpr = nextDpr
    unbindZrZoom = bindZrZoom(chart)
  }
  chart.setOption(props.option)
}

/* zoom 断点变化不改变元素布局宽（clientWidth 不变），ResizeObserver 可能不触发；
   单独听 window/visualViewport 的尺寸变化，DPR 变了就重建。 */
function syncZoom() {
  if (!chart) return
  if (Math.abs(chartDpr() - appliedDpr) > 0.01) render()
}

onMounted(() => {
  render()
  ro = new ResizeObserver(() => chart?.resize())
  if (el.value) ro.observe(el.value)
  window.addEventListener('resize', syncZoom)
  window.visualViewport?.addEventListener('resize', syncZoom)
})

watch(
  [() => props.option, resolvedTheme],
  () => render(),
  { deep: true }
)

onBeforeUnmount(() => {
  ro?.disconnect()
  ro = null
  window.removeEventListener('resize', syncZoom)
  window.visualViewport?.removeEventListener('resize', syncZoom)
  unbindZrZoom?.()
  unbindZrZoom = null
  chart?.dispose()
  chart = null
})
</script>

<style scoped>
.mk-chart {
  width: 100%;
  min-height: 120px;
}
</style>
