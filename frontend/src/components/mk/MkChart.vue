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

const isDark = useIsDark()
const resolvedTheme = computed<'light' | 'dark'>(() => props.theme ?? (isDark.value ? 'dark' : 'light'))

/* 主题只能在 init 时传入：切换主题需 dispose 重建（ECharts 无运行时换主题 API） */
function render() {
  if (!el.value) return
  if (!chart || appliedTheme !== resolvedTheme.value) {
    chart?.dispose()
    chart = echarts.init(el.value, MK_CHART_THEME[resolvedTheme.value])
    appliedTheme = resolvedTheme.value
  }
  chart.setOption(props.option)
}

onMounted(() => {
  render()
  ro = new ResizeObserver(() => chart?.resize())
  if (el.value) ro.observe(el.value)
})

watch(
  [() => props.option, resolvedTheme],
  () => render(),
  { deep: true }
)

onBeforeUnmount(() => {
  ro?.disconnect()
  ro = null
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
