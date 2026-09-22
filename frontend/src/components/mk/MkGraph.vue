<template>
  <div ref="el" class="mk-graph" :style="{ height }"></div>
</template>

<script setup lang="ts">
/**
 * MkGraph：ECharts **graph 系列**轻封装（知识点图画布）
 *
 * 为什么不复用 MkChart：MkChart 只注册了 LineChart/BarChart，把 GraphChart 加进去会让
 * 所有 MkChart 使用方的 chunk 一并带上图渲染。本组件按需只注册 GraphChart + 用到的组件。
 *
 * 主题：亮/暗两套配色都走语义 token 的同族色值（与 admin 视觉层一致），
 * 节点按掌握度着色（未掌握=暖色警示、已掌握=冷色安定、未评估=中性灰）。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts/core'
import { GraphChart } from 'echarts/charts'
import { TooltipComponent, LegendComponent, TitleComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsCoreOption } from 'echarts/core'

echarts.use([GraphChart, TooltipComponent, LegendComponent, TitleComponent, CanvasRenderer])

export interface MkGraphNode {
  id: string
  label: string
  /** 概念层级：concept（coreConcept）/ kc（知识组件） */
  level?: string
  taxonomy?: string | null
  masteryScore?: number | null
  stability?: string | null
  extractionCount?: number
  lastSeenAt?: string | null
}
export interface MkGraphEdge {
  fromConceptId: string
  toConceptId: string
  relation: string
}

const props = withDefaults(
  defineProps<{
    nodes: MkGraphNode[]
    edges: MkGraphEdge[]
    height?: string
    theme?: 'light' | 'dark'
  }>(),
  { height: '520px', theme: 'light' }
)

const emit = defineEmits<{ (e: 'select', node: MkGraphNode | null): void }>()

/** ECharts 回调入参（只声明用到的字段，避免 any） */
interface GraphCallbackParams {
  dataType?: string
  data?: { raw?: MkGraphNode; relation?: string }
}

const el = ref<HTMLElement | null>(null)
let chart: echarts.ECharts | null = null
let ro: ResizeObserver | null = null

/** 掌握度 → 语义色（亮/暗各一套；未评估走中性灰） */
function colorOf(node: MkGraphNode, dark: boolean): string {
  if (node.masteryScore === null || node.masteryScore === undefined) return dark ? '#5b5f66' : '#a8adb7'
  if (node.stability === 'fragile' || node.masteryScore < 0.45) return dark ? '#c2726a' : '#b4544a'
  if (node.stability === 'stable' || node.masteryScore >= 0.8) return dark ? '#6f8f86' : '#4f7d70'
  return dark ? '#8a8f7a' : '#7d8470'
}

const RELATION_STYLE: Record<string, { color: string; width: number; type: 'solid' | 'dashed' }> = {
  prerequisite: { color: '#7a8ba6', width: 1.6, type: 'solid' },
  part_of: { color: '#b9bec7', width: 1, type: 'dashed' }
}

function buildOption(): EChartsCoreOption {
  const dark = props.theme === 'dark'
  const nodeIds = new Set(props.nodes.map((n) => n.id))
  const edges = props.edges.filter((e) => nodeIds.has(e.fromConceptId) && nodeIds.has(e.toConceptId))
  const degree = new Map<string, number>()
  for (const edge of edges) {
    degree.set(edge.fromConceptId, (degree.get(edge.fromConceptId) ?? 0) + 1)
    degree.set(edge.toConceptId, (degree.get(edge.toConceptId) ?? 0) + 1)
  }
  const textColor = dark ? '#c9ccd1' : '#3b3f46'
  const relationKeys = Array.from(new Set(edges.map((e) => e.relation)))
  const RELATION_LABEL: Record<string, string> = { prerequisite: '前置依赖', part_of: '属于' }

  return {
    backgroundColor: 'transparent',
    tooltip: {
      confine: true,
      formatter: (params: GraphCallbackParams) => {
        if (params?.dataType === 'edge') return RELATION_LABEL[params.data?.relation ?? ''] ?? params.data?.relation ?? ''
        const node = params?.data?.raw
        if (!node) return ''
        const mastery = node.masteryScore === null || node.masteryScore === undefined
          ? '未评估'
          : `${Math.round(node.masteryScore * 100)}%`
        return [
          `<b>${node.label}</b>`,
          `掌握度：${mastery}${node.stability ? ` · ${node.stability}` : ''}`,
          `提取次数：${node.extractionCount ?? 0}`
        ].join('<br/>')
      }
    },
    legend: relationKeys.length
      ? [{ data: relationKeys.map((k) => RELATION_LABEL[k] ?? k), bottom: 0, textStyle: { color: textColor } }]
      : undefined,
    series: [
      {
        type: 'graph',
        layout: 'force',
        roam: true,
        draggable: true,
        label: { show: true, color: textColor, fontSize: 11, formatter: '{b}' },
        force: { repulsion: 220, edgeLength: [70, 150], gravity: 0.08 },
        emphasis: { focus: 'adjacency', label: { fontWeight: 'bold' } },
        lineStyle: { curveness: 0.08 },
        categories: relationKeys.map((k) => ({ name: RELATION_LABEL[k] ?? k })),
        data: props.nodes.map((node) => ({
          id: node.id,
          name: node.label,
          symbolSize: Math.min(46, 16 + (degree.get(node.id) ?? 0) * 4),
          itemStyle: { color: colorOf(node, dark), borderColor: dark ? '#2a2c30' : '#ffffff', borderWidth: 1 },
          // 层级：coreConcept 用圆、KC 用圆角方块，一眼区分粒度
          symbol: node.level === 'concept' ? 'circle' : 'roundRect',
          raw: node
        })),
        links: edges.map((edge) => ({
          source: edge.fromConceptId,
          target: edge.toConceptId,
          relation: edge.relation,
          lineStyle: RELATION_STYLE[edge.relation] ?? { color: '#b9bec7', width: 1, type: 'solid' }
        }))
      }
    ]
  }
}

function render() {
  if (!el.value) return
  if (!chart) {
    chart = echarts.init(el.value, props.theme)
    // 不注解入参（交给 ECharts 的 ECElementEvent），内部按图节点形状取值——避免 any
    chart.on('click', (params) => {
      if (params?.dataType !== 'node') { emit('select', null); return }
      const data = params.data as { raw?: MkGraphNode } | undefined
      emit('select', data?.raw ?? null)
    })
  }
  chart.setOption(buildOption(), true)
}

onMounted(() => {
  render()
  ro = new ResizeObserver(() => chart?.resize())
  if (el.value) ro.observe(el.value)
})

watch(() => [props.nodes, props.edges, props.theme], () => render(), { deep: true })

onBeforeUnmount(() => {
  ro?.disconnect()
  ro = null
  chart?.dispose()
  chart = null
})
</script>

<style scoped>
.mk-graph {
  width: 100%;
}
</style>
