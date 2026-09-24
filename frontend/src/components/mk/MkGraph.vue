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
 *
 * 2026-09-23 重设计（视觉走查实测的三个问题）：
 *  ① **布局被反复重置**：ResizeObserver 每 tick 都 `setOption(..., true)`（notMerge）会把
 *    力导向布局一次次打回起点，图永远不收敛、还偏到画布一侧 → 现在 resize 只 `chart.resize()`，
 *     只有数据/主题变化才重建 option。
 *  ② **标签被截断成"…"**：`overflow:'truncate'` + `width:120` 把中文长标签全切了 →
 *     改为显式两行折行（`\n`）并放在节点下方，不再截断。
 *  ③ **图例是假的**：`categories` 列的是"关系"，而节点没有 `category` 字段，
 *     点图例会把整张图隐藏 → 去掉画布内图例，图例改由外层容器用 DOM 呈现。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts/core'
import { GraphChart } from 'echarts/charts'
import { TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsCoreOption } from 'echarts/core'

echarts.use([GraphChart, TooltipComponent, CanvasRenderer])

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
 * 容器宽度（视觉验证实测）：学习页知识点面板只有 ~320px 宽，默认参数会让标签溢出面板。
 * 故按宽度自适应（窄栏收紧字号/折行宽度/斥力）。
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

/**
 * 折行（最多 2 行，超出加省略号）。中文概念名普遍 10-20 字，
 * 单行会横跨整张图并互相压；两行折行后长度可控、也不再被截成"…"。
 */
function wrapLabel(text: string, perLine: number): string {
  const value = String(text ?? '')
  if (value.length <= perLine) return value
  const first = value.slice(0, perLine)
  const rest = value.slice(perLine)
  if (rest.length <= perLine) return `${first}\n${rest}`
  return `${first}\n${rest.slice(0, perLine - 1)}…`
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
  const RELATION_LABEL: Record<string, string> = { prerequisite: '前置依赖', part_of: '属于' }
  // 可读性（视觉验证实测）：节点一多，常显全部标签会让中心区糊成一团；但全都不显示又只剩点。
  // 故密集图只给"值得标注"的节点显示标签：① 连接度最高的若干（结构枢纽）② 薄弱/脆弱节点。其余靠悬停。
  const denseGraph = nodes.length > 18
  // 力导向总跨度 ≈ 边长·√n；斥力/边长的原值按 ~40 节点校准，故以 40 为基准反比收缩
  const shrink = Math.sqrt(40 / Math.max(1, nodes.length))
  const narrow = isNarrow.value
  const perLine = narrow ? 7 : 9
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
          `${node.level === 'concept' ? '核心概念' : '知识组件'}`,
          `掌握度：${mastery}${node.stability ? ` · ${node.stability}` : ''}`,
          `提取次数：${node.extractionCount ?? 0}`
        ].join('<br/>')
      }
    },
    series: [
      {
        type: 'graph',
        layout: 'force',
        roam: true,
        draggable: true,
        // 布局盒留边（画布内图例已移除，四边等距）
        top: 16,
        bottom: 16,
        left: 16,
        right: 16,
        scaleLimit: { min: 0.3, max: 4 },
        label: {
          show: false,
          position: 'bottom',
          distance: 5,
          color: textColor,
          fontSize: narrow ? 10 : 11,
          lineHeight: narrow ? 12 : 13,
          formatter: (params: { name?: string }) => wrapLabel(params?.name ?? '', perLine)
        },
        labelLayout: { hideOverlap: true },
        emphasis: { focus: 'adjacency', label: { show: true, fontWeight: 'bold' } },
        select: { label: { show: true }, itemStyle: { borderWidth: 2 } },
        lineStyle: { curveness: 0.08 },
        force: {
          // `initLayout: circular` 给一个铺开的初值，否则力导向从随机点起步、
          // 实测容易收敛到画布一侧或缩成一小团。
          initLayout: 'circular',
          // 斥力/边长随节点数收缩。原值（480 / 110-220）是按 ~40 节点校准的
          // （实测 300/0.08 时 40 个节点会缩在画布中间一小团里，故上调到 480），
          // 但力导向的总跨度 ≈ 边长·√n，节点再多就撑出画布——实测某学习者 5 条路径的
          // 并集（76 个有边节点）在 802×560 画布上只看得见边缘碎片。
          // 故按 √n 反比收缩，使总跨度近似不随 n 增长；n≤40 时 shrink=1，校准点行为不变。
          repulsion: narrow ? 150 : (denseGraph ? Math.round(480 * shrink * shrink) : 240),
          edgeLength: narrow
            ? [45, 100]
            : (denseGraph ? [Math.round(110 * shrink), Math.round(220 * shrink)] : [80, 160]),
          gravity: narrow ? 0.12 : (denseGraph ? 0.04 : 0.08),
          friction: 0.82,
          layoutAnimation: true
        },
        data: nodes.map((node) => ({
          id: node.id,
          name: node.label,
          symbolSize: Math.min(narrow ? 34 : 44, (narrow ? 12 : 15) + (degree.get(node.id) ?? 0) * 4),
          itemStyle: { color: colorOf(node, dark), borderColor: dark ? '#2a2c30' : '#ffffff', borderWidth: 1.5 },
          // 层级：coreConcept 用圆、KC 用圆角方块，一眼区分粒度
          symbol: node.level === 'concept' ? 'circle' : 'roundRect',
          label: { show: labelWorthy.has(node.id) },
          raw: node
        })),
        // 前置边后画（覆盖在"属于"虚线之上），让主结构更清楚
        links: [...edges]
          .sort((a, b) => (a.relation === 'prerequisite' ? 1 : 0) - (b.relation === 'prerequisite' ? 1 : 0))
          .map((edge) => ({
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

let lastNarrow = false

onMounted(() => {
  width.value = el.value?.clientWidth ?? 0
  lastNarrow = isNarrow.value
  render()
  ro = new ResizeObserver(() => {
    const next = el.value?.clientWidth ?? 0
    if (next === width.value) return
    width.value = next
    chart?.resize()
    // 只有"窄/宽档位"翻转才重建 option（字号/折行宽度/斥力不同）。
    // 单纯变宽变窄**不重建**：setOption(notMerge) 会把力导向布局打回起点，
    // 图永远不收敛——这正是改造前"图偏在画布一侧"的根因。
    if (isNarrow.value !== lastNarrow) {
      lastNarrow = isNarrow.value
      render()
    }
  })
  if (el.value) ro.observe(el.value)
})

watch(() => [props.nodes, props.edges, props.theme, props.hideIsolated], () => render(), { deep: true })

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
  font-size: var(--mk-fs-micro);
  line-height: 1.5;
  opacity: 0.65;
}
</style>
