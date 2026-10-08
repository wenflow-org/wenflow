<script lang="ts">
/**
 * 关系线样式（按主题出色）：画布 links 与 MkGraphExplorer 的 DOM 图例必须同源
 * （此前图例画 --mk-blue、图里实际是 #7a8ba6，两处各自为政）。改色只改这一处。
 * 放普通 <script> 块是因为 <script setup> 不允许值导出（type 导出可以）。
 */
export interface RelationStyle {
  color: string
  width: number
  type: 'solid' | 'dashed'
}
export function relationStyleOf(relation: string, dark: boolean): RelationStyle {
  if (relation === 'prerequisite') return { color: dark ? '#8ea6c8' : '#7a8ba6', width: 1.6, type: 'solid' }
  if (relation === 'part_of') return { color: dark ? '#7c828c' : '#b9bec7', width: 1, type: 'dashed' }
  // 未知关系沿用"属于"的灰色，但保持实线（与旧版兜底一致）
  return { color: dark ? '#7c828c' : '#b9bec7', width: 1, type: 'solid' }
}
// 节点/边的类型导出放普通 <script> 块：<script setup> 与普通块并存时，
// setup 内的 type 导出不再出现在模块导出面（vue-tsc 实测），消费方的 import type 会断
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
  /** 去练习直达锚点（收尾批 C11：所属里程碑下首个未完成任务；null=无可直达任务，宿主走兜底） */
  practice?: {
    taskId: string
    pathId: string
    taskTitle: string
    milestoneTitle: string
    taskStatus: string
  } | null
}
export interface MkGraphEdge {
  fromConceptId: string
  toConceptId: string
  relation: string
}
</script>

<template>
  <div class="mk-graph-wrap">
    <!-- 高度走 CSS 变量：窄屏要在样式层按 ≤720px 档位减半，内联 height 会压过媒体查询 -->
    <div ref="el" class="mk-graph" :style="{ '--mkg-h': height }"></div>
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
import { useIsDark } from '@/composables/useIsDark'
import * as echarts from 'echarts/core'
import { GraphChart } from 'echarts/charts'
import { TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsCoreOption } from 'echarts/core'

echarts.use([GraphChart, TooltipComponent, CanvasRenderer])

// MkGraphNode / MkGraphEdge 类型导出移至顶部普通 <script> 块（与普通块并存时 setup 内 type 导出不可见）

const props = withDefaults(
  defineProps<{
    nodes: MkGraphNode[]
    edges: MkGraphEdge[]
    height?: string
    /** 主题：不传则跟随 <html data-theme>（与 MkChart 同款）。显式传值可覆盖。 */
    theme?: 'light' | 'dark'
    /** 是否隐藏"无任何关系"的孤立节点（默认隐藏：实测它们只是散在四周造成噪声） */
    hideIsolated?: boolean
  }>(),
  { height: '520px', theme: undefined, hideIsolated: true }
)

/* 主题跟随（2026-10-06 审核）：默认原为写死 'light'，不跟随 <html data-theme>——
   新增消费方漏传 theme 时，暗色页面会渲染亮色节点/标签与轴文字。MkChart 同族已用
   本模式（props.theme ?? useIsDark()），此处对齐。 */
const isDark = useIsDark()
const resolvedTheme = computed<'light' | 'dark'>(() => props.theme ?? (isDark.value ? 'dark' : 'light'))

const emit = defineEmits<{ (e: 'select', node: MkGraphNode | null): void }>()

/** ECharts 回调入参（只声明用到的字段，避免 any） */
interface GraphCallbackParams {
  dataType?: string
  data?: { raw?: MkGraphNode; relation?: string }
}

const el = ref<HTMLElement | null>(null)
let chart: echarts.ECharts | null = null
/** 最近一次 buildOption 烘焙的「值得标注」节点集（批次四：graphRoam 缩放档回填标签用） */
let lastLabelWorthy = new Set<string>()
/** 缩放低于该值视为「看不清标签」档：全量收标（hover/emphasis 仍出词），放大恢复 */
const ZOOM_LABEL_OFF = 0.85
let labelsHiddenByZoom = false

/** graphRoam 缩放跨档时翻转节点标签：低于阈值全收（密集区字压字不可读），回升恢复 labelWorthy 常显集合 */
function applyZoomLabels() {
  if (!chart) return
  const opt = chart.getOption() as { series?: Array<{ zoom?: number; data?: Array<{ id?: string; label?: { show?: boolean } }> }> }
  const zoom = opt.series?.[0]?.zoom
  const hide = typeof zoom === 'number' && zoom < ZOOM_LABEL_OFF
  if (hide === labelsHiddenByZoom) return
  labelsHiddenByZoom = hide
  const data = opt.series?.[0]?.data
  if (!Array.isArray(data)) return
  chart.setOption({
    series: [{
      data: data.map((d) => ({
        ...d,
        label: { ...d.label, show: !hide && lastLabelWorthy.has(String(d.id ?? '')) }
      }))
    }]
  })
}
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

/** tooltip formatter 输出的是 HTML：label 来自概念名（课程/用户数据），
 *  不转义会把名字里的 & <> 直接吃进标记——既毁排版也是注入面 */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch
  ))
}

function buildOption(): EChartsCoreOption {
  const dark = resolvedTheme.value === 'dark'
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
    // 批次四 P2（2026-10-04 全站评审）：枢纽标注 10→6——默认视图密集区标签字压字，
    // 收紧常显集合让标签碰撞可辨；弱势/脆弱节点仍全标（教学信号优先）
    const byDegree = [...nodes]
      .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))
      .slice(0, 6)
    for (const node of byDegree) labelWorthy.add(node.id)
    for (const node of nodes) {
      const weak = node.stability === 'fragile' || (node.masteryScore !== null && node.masteryScore !== undefined && node.masteryScore < 0.45)
      if (weak) labelWorthy.add(node.id)
    }
  }
  // 供 graphRoam 缩放档回填 label.show 用（buildOption 每次重算，roam 不触发它）
  lastLabelWorthy = labelWorthy

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
          `<b>${escapeHtml(node.label)}</b>`,
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
            // 与 DOM 图例同源（见文件头 relationStyleOf 注释）
            lineStyle: relationStyleOf(edge.relation, dark)
          }))
      }
    ]
  }
}

let chartTheme: 'light' | 'dark' | null = null

function render() {
  if (!el.value) return
  // 主题是 echarts.init 时烘进实例的（tooltip 底色/文字色跟着主题走），setOption 换不掉：
  // 运行时切主题必须 dispose 重建，否则暗色页面里还弹亮底 tooltip。
  if (chart && chartTheme !== resolvedTheme.value) {
    chart.dispose()
    chart = null
  }
  if (!chart) {
    chart = echarts.init(el.value, resolvedTheme.value)
    chartTheme = resolvedTheme.value
    // 不注解入参（交给 ECharts 的 ECElementEvent），内部按图节点形状取值——避免 any
    chart.on('click', (params) => {
      if (params?.dataType !== 'node') { emit('select', null); return }
      const data = params.data as { raw?: MkGraphNode } | undefined
      emit('select', data?.raw ?? null)
    })
    // 批次四 P2：缩放跨档收/放节点标签（setOption(notMerge) 重建会重置缩放档标志）
    chart.on('graphRoam', () => applyZoomLabels())
  }
  chart.setOption(buildOption(), true)
  labelsHiddenByZoom = false
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

watch(() => [props.nodes, props.edges, resolvedTheme.value, props.hideIsolated], () => render(), { deep: true })

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
  height: var(--mkg-h, 520px);
  /* roam:true 会接管画布手势，单指竖向拖动把页面滚动一起吞掉。pan-y 只把「竖向滑动」
     还给浏览器（页面照常滚，zrender 收 pointercancel 自然收手）；双指捏合不属于 pan-y，
     触摸事件照常到达 zrender，缩放不受影响。
     （已核 zrender 6.1：自身不写 touch-action、不对 touchmove preventDefault，纯 CSS 即生效） */
  touch-action: pan-y;
}
/* 窄屏画布降档（≤720px 减半）：竖屏手机上 560px 高的力导向图大半是空云团，
   砍半档露出核心结构，也少吞一屏滚动距离 */
@media (max-width: 720px) {
  .mk-graph {
    height: calc(var(--mkg-h, 520px) / 2);
  }
}
.mk-graph__note {
  margin: 6px 0 0;
  font-size: var(--mk-fs-micro);
  line-height: 1.5;
  opacity: 0.65;
}
</style>
