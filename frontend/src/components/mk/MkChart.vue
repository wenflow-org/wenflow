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
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
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

echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent, TitleComponent, CanvasRenderer])

const props = withDefaults(
  defineProps<{
    option: EChartsCoreOption
    height?: string
    theme?: 'light' | 'dark'
  }>(),
  { height: '240px', theme: 'light' }
)

const el = ref<HTMLElement | null>(null)
let chart: echarts.ECharts | null = null
let ro: ResizeObserver | null = null

function render() {
  if (!el.value) return
  if (!chart) chart = echarts.init(el.value, props.theme)
  chart.setOption(props.option)
}

onMounted(() => {
  render()
  ro = new ResizeObserver(() => chart?.resize())
  if (el.value) ro.observe(el.value)
})

watch(
  () => props.option,
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
