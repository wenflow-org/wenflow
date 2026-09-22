<template>
  <div class="mk-graph-wrap">
    <div ref="el" class="mk-graph" :style="{ height }"></div>
    <p v-if="isolatedCount > 0" class="mk-graph__note">
      另有 {{ isolatedCount }} 个概念暂无前置/归属关系，未在图中显示
    </p>
  </div>
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
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
    /** 是否隐藏"无任何关系"的孤立节点（默认隐藏：实测它们只是散在四周造成噪声） */
    hideIsolated?: boolean
  }>(),
  { height: '520px', theme: 'light', hideIsolated: true }
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

/**
 * 容器宽度（视觉验证实测）：学习页知识点面板只有 ~320px 宽，默认参数会让标签溢出面板、
 * 图例压在图区上。故按宽度自适应（窄栏收紧字号/标签截断/斥力，并隐藏图例）。
 */
const width = ref(0)
const isNarrow = computed(() => width.value > 0 && width.value < 420)

/** 只保留有边相连的节点（若全无连接则原样保留，避免空图） */
const visibleNodes = computed<MkGraphNode[]>(() => {
  if (!props.hideIsolated) return props.nodes
  const connected = new Set<string>()
  for (const e of props.edges) {
    connected.add(e.fromConceptId)
    connected.add(e.toConceptId)
  }
  const kept = props.nodes.filter((n) => connected.has(n.id))
  return kept.length > 0 ? kept : props.nodes
})
const isolatedCount = computed(() => props.nodes.length - visibleNodes.value.length)

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
  const nodes = visibleNodes.value
  const nodeIds = new Set(nodes.map((n) => n.id))
  const edges = props.edges.filter((e) => nodeIds.has(e.fromConceptId) && nodeIds.has(e.toConceptId))
  const degree = new Map<string, number>()
  for (const edge of edges) {
    degree.set(edge.fromConceptId, (degree.get(edge.fromConceptId) ?? 0) + 1)
    degree.set(edge.toConceptId, (degree.get(edge.toConceptId) ?? 0) + 1)
  }
  const textColor = dark ? '#c9ccd1' : '#3b3f46'
  const relationKeys = Array.from(new Set(edges.map((e) => e.relation)))
  const RELATION_LABEL: Record<string, string> = { prerequisite: '前置依赖', part_of: '属于' }
  // 可读性（视觉验证实测）：节点一多，常显全部标签会让中心区糊成一团（41 节点时完全不可读）；
  // 但全都不显示又只剩点。故密集图只给"值得标注"的节点显示标签：
  // ① 连接度最高的若干（结构枢纽）② 薄弱/脆弱节点（诊断最关心）。其余靠悬停。
  const denseGraph = nodes.length > 18
  const narrow = isNarrow.value
  const labelWorthy = new Set<string>()
  if (!denseGraph) {
    for (const node of nodes) labelWorthy.add(node.id)
  } else {
    const byDegree = [...nodes]
      .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))
      .slice(0, 10)
    for (const node of byDegree) labelWorthy.add(node.id)
    for (const node of nodes) {
      const weak = node.stability === 'fragile' || (node.masteryScore !== null && node.masteryScore !== undefined && node.masteryScore < 0.45)
      if (weak) labelWorthy.add(node.id)
    }
  }

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
    legend: relationKeys.length && !narrow
      ? [{ data: relationKeys.map((k) => RELATION_LABEL[k] ?? k), bottom: 0, textStyle: { color: textColor } }]
      : undefined,
    series: [
      {
        type: 'graph',
        layout: 'force',
        roam: true,
        draggable: true,
        // 布局盒留边：窄栏不留图例位（图例已隐藏），宽栏底部留 24px 给图例
        top: 8,
        bottom: narrow ? 8 : 26,
        left: 8,
        right: 8,
        // 缩放/平移范围：给密集图留出"拉开来读"的余地
        scaleLimit: { min: 0.3, max: 4 },
        label: {
          show: false,
          color: textColor,
          fontSize: narrow ? 10 : 11,
          formatter: '{b}',
          overflow: 'truncate',
          width: narrow ? 64 : 120
        },
        labelLayout: { hideOverlap: true },
        emphasis: { focus: 'adjacency', label: { show: true, fontWeight: 'bold' } },
        select: { label: { show: true }, itemStyle: { borderWidth: 2 } },
        lineStyle: { curveness: 0.08 },
        categories: relationKeys.map((k) => ({ name: RELATION_LABEL[k] ?? k })),
        force: {
          // 斥力随节点数缓增，别把图推出画布（实测 420 会让节点大量溢出）；
          // 窄栏再收紧一档，否则节点会散到面板外。
          repulsion: narrow ? 150 : (denseGraph ? 300 : 220),
          edgeLength: narrow ? [45, 100] : (denseGraph ? [80, 170] : [70, 150]),
          gravity: narrow ? 0.12 : 0.08,
          layoutAnimation: true
        },
        data: nodes.map((node) => ({
          id: node.id,
          name: node.label,
          symbolSize: Math.min(narrow ? 34 : 46, (narrow ? 12 : 16) + (degree.get(node.id) ?? 0) * 4),
          itemStyle: { color: colorOf(node, dark), borderColor: dark ? '#2a2c30' : '#ffffff', borderWidth: 1 },
          // 层级：coreConcept 用圆、KC 用圆角方块，一眼区分粒度
          symbol: node.level === 'concept' ? 'circle' : 'roundRect',
          label: { show: labelWorthy.has(node.id) },
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
  width.value = el.value?.clientWidth ?? 0
  render()
  ro = new ResizeObserver(() => {
    width.value = el.value?.clientWidth ?? 0
    chart?.resize()
    render()
  })
  if (el.value) ro.observe(el.value)
})

watch(() => [props.nodes, props.edges, props.theme, props.hideIsolated, isNarrow.value], () => render(), { deep: true })

onBeforeUnmount(() => {
  ro?.disconnect()
  ro = null
  chart?.dispose()
  chart = null
})
</script>

<style scoped>
.mk-graph-wrap {
  width: 100%;
}
.mk-graph {
  width: 100%;
}
.mk-graph__note {
  margin: 6px 0 0;
  font-size: var(--mk-fs-11);
  line-height: 1.5;
  opacity: 0.65;
}
</style>
