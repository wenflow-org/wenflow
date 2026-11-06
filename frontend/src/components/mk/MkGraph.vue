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
/**
 * 概念台账事实（宿主可选，按概念名索引）：图上没有这些字段，由父级把学习者模型里的
 * 概念台账映射进来，随节点详情一起展示（可迁移 / 误解风险 / 证据条数）。
 * 2026-10-20：原概览「概念掌握」卡里的逐概念明细并入图谱侧栏，本类型是同一次搬家的契约。
 */
export interface MkGraphConceptFacts {
  readiness: string
  risk: string
  riskTone: 'ok' | 'warn' | 'bad'
  evidenceCount: number
}

/**
 * 密集图判据：超过这个节点数就只标「值得标注」的节点（枢纽 + 薄弱），其余靠悬停。
 *
 * 阈值必须按**画布面积**给，不能只认节点数（2026-10-05 实测）：同一个 18 概念的单路径图，
 * 桌面 823×620 画布上标签互不打扰，390 视口挤进 345×392（面积 0.27 倍）就字压字——
 * 而 18 恰好不满足宽画布的 `> 18`，全量标签照画。
 *
 * 8 是折算值：画布面积 0.27 倍，窄屏标签盒又更小（10px/7 字 vs 11px/9 字，面积 0.65 倍），
 * 18 × 0.27 / 0.65 ≈ 8。注：窄屏判据**只影响标签集合**——斥力/边长/重力三处都以 narrow
 * 优先（见 setup 里 force 段），所以收紧这里不会把力导向参数带跑。
 */
export const DENSE_LABEL_NODES = 18
export const DENSE_LABEL_NODES_NARROW = 8

export function isDenseLabelGraph(nodeCount: number, narrow: boolean): boolean {
  return nodeCount > (narrow ? DENSE_LABEL_NODES_NARROW : DENSE_LABEL_NODES)
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
import { wrapGraphLabel } from '@/utils/graphLabel'
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
    /** 需要常显标签并描边高亮的节点 id（课堂知识点浮窗：本节正在学的 1–2 个概念） */
    highlightIds?: string[]
  }>(),
  { height: '520px', theme: undefined, hideIsolated: true, highlightIds: () => [] }
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
/** 已点选的节点：右栏/底部详情接管信息，画布 tooltip 不再重复弹出；
 *  2026-11-05 用户定稿：点击选中后画布把无关节点压暗到 0.35（ref 化以便进 buildOption） */
const selectedIdRef = ref<string | null>(null)
/** 最近一次 buildOption 烘焙的「值得标注」节点集（批次四：graphRoam 缩放档回填标签用） */
let lastLabelWorthy = new Set<string>()
/** 缩放低于该值视为「看不清标签」档：全量收标（hover/emphasis 仍出词），放大恢复 */
const ZOOM_LABEL_OFF = 0.85
let labelsHiddenByZoom = false

/**
 * 节点点击热区半径（§5 2026-11-06 用户定稿：r >= 20px）。
 *
 * 为什么不直接放大 symbolSize：ECharts 的 graph 符号只有一个 symbolSize，它同时决定
 * 视觉大小与命中范围，没有「透明扩大命中框」参数——把 12~15px 的节点抬到 40px 会让
 * 24 概念图糊成一团（标签互压）。所以热区在事件层实现：点在空白处时按屏幕像素距离
 * （≤ 20px）取最近的节点，等价于给每颗节点套了一个不可见的 r=20 圆。
 * 文字标签本身挂在节点符号上（zrender 的 __hostTarget 链），点标签即点节点，无需另做。
 */
const NODE_HIT_RADIUS = 20

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

/** 可见节点（2026-10-31 二轮评审 P2 修订）：hideIsolated 只裁「未评估的孤立点」——
 *  已有掌握度读数的孤立概念（进行中/记忆偏弱/已掌握）是真实学习状态，藏掉会让
 *  「概览页说在学、图谱页说没有」；纯待学习的孤立点继续藏（前置还没生成，画布无意义）。 */
const visibleNodes = computed<MkGraphNode[]>(() => {
  if (!props.hideIsolated) return props.nodes
  const connected = new Set<string>()
  for (const e of props.edges) {
    connected.add(e.fromConceptId)
    connected.add(e.toConceptId)
  }
  const kept = props.nodes.filter(
    (n) => connected.has(n.id) || (n.masteryScore !== null && n.masteryScore !== undefined)
  )
  return kept.length > 0 ? kept : props.nodes
})
const isolatedCount = computed(() => props.nodes.length - visibleNodes.value.length)

/** 掌握度 → 语义色（亮/暗各一套；未评估走中性灰）。
 *  2026-10-31 外部评审 P2-4：原实现漏了「进行中」的琥珀分支——在学节点落到末行橄榄灰，
 *  读成灰/待学习，图例却承诺黄色（🟡进行中 1 画布上永远找不到黄点）。补琥珀档，
 *  色值与图例 --mk-amber 同族（亮 #b45309 系 / 暗 #fbbf24 系，做柔化与红/绿拉开）。 */
function colorOf(node: MkGraphNode, dark: boolean): string {
  if (node.masteryScore === null || node.masteryScore === undefined) return dark ? '#5b5f66' : '#a8adb7'
  if (node.stability === 'fragile' || node.masteryScore < 0.45) return dark ? '#c2726a' : '#b4544a'
  if (node.stability === 'stable' || node.masteryScore >= 0.8) return dark ? '#6f8f86' : '#4f7d70'
  return dark ? '#d09a3e' : '#b08020'
}

/**
 * 折行（最多 2 行，超出加省略号）。具体规则见 utils/graphLabel.ts：
 * 英文单词/标识符整体换行，第一行不提前加省略号。
 */

/**
 * 画布上标签的底衬色 = 卡片表面色（`--mk-surface`）随主题切换。
 *
 * 病根（2026-10-08 手机走查 #24，用户在手机图区放大 3 倍能看到「定唯」压在一个节点方块上）：
 * ECharts 的 `labelLayout.hideOverlap` 只比较「标签↔标签」，看不到**节点圆/方块**。
 * 密集图里某个节点的两行标签会落在相邻节点的符号上，判定为「值得常显」的枢纽标签
 * 因此互相压字，且省略号截断后没法点（移动端没有 hover）。
 * 给标签铺一层与画布同色的底衬（= 把压住的节点「镂空」），文字即清晰；底衬色与画布同色，
 * 不新增视觉元素。色值取运行时 token（不新增硬编码），取不到时回退本文件已用的表面近似值。
 */
function labelSurface(dark: boolean): string {
  if (typeof window !== 'undefined' && typeof getComputedStyle === 'function') {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--mk-surface').trim()
    if (v) return v
  }
  return dark ? '#2a2c30' : '#ffffff'
}

/** tooltip formatter 输出的是 HTML：label 来自概念名（课程/用户数据），
 *  不转义会把名字里的 & <> 直接吃进标记——既毁排版也是注入面 */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch
  ))
}

/** ECharts 实例的私有取模型面（类型层未公开，运行时稳定）：力导向节点布局的唯一来源。
 *  getLayout 的返回值按 unknown 收——实测是数组 `[x, y]`（见 layoutPoint），不是对象。 */
type GraphModel = {
  getModel: () => {
    getSeriesByIndex: (i: number) => {
      getGraph: () => { eachNode: (cb: (n: { id: string | number; getLayout: () => unknown }) => void) => void }
    }
  }
  getOption: () => { series?: Array<{ zoom?: number; center?: [number | string, number | string] }> }
}

/**
 * 力导向节点布局 → {x, y}。
 *
 * 形状实测（2026-11-06，node + jsdom + SVG renderer 探针打 echarts 6.1.0）：graph 的
 * `getLayout()` 返回**数组** `[x, y]`（data/Graph.js:462 的 getLayout → data.getItemLayout；
 * circular/force/simple 三个布局助手都用 `setLayout([x, y])`）。旧代码按 `l.x` 取值，
 * `typeof l.x` 恒为 undefined，点击热区与「重建抄坐标」整段失效——所以这里两种形状都收，
 * 数组为主、对象只为兼容将来/第三方的 layout 写法。
 */
function layoutPoint(l: unknown): { x: number; y: number } | null {
  if (Array.isArray(l)) {
    const [x, y] = l as [unknown, unknown]
    return typeof x === 'number' && typeof y === 'number' ? { x, y } : null
  }
  if (l && typeof l === 'object') {
    const p = l as { x?: unknown; y?: unknown }
    return typeof p.x === 'number' && typeof p.y === 'number' ? { x: p.x, y: p.y } : null
  }
  return null
}

/**
 * 重建前抄下当前缩放与视图中心。
 *
 * 只抄这两项、**不抄节点坐标**：graph 的 view 坐标系用 data 的 x/y 算包围盒
 * （chart/graph/createView.js 的 `data.mapArray([+x, +y])`），把上一轮布局坐标当 x/y 回填
 * 会让整张图按新包围盒重新投影——8 节点探针实测位移 ~207px。而力导向重建本身是确定性的
 * （同一 option 连续两次 `setOption(notMerge)` 像素级 0px 差），点击选中本来就不会重排，
 * 所以不需要喂坐标；不抄 zoom/center 则视图会跳回 0.9 / 居中（探针实测：带上读到的
 * zoom/center 重建位移 0px）。
 */
function readGraphViewport(): { zoom?: number; center?: [number | string, number | string] } | null {
  if (!chart) return null
  try {
    const opt = (chart as unknown as GraphModel).getOption()
    return { zoom: opt.series?.[0]?.zoom, center: opt.series?.[0]?.center }
  } catch {
    return null
  }
}

/**
 * click 热区命中（§5：r >= 20px）：给定屏幕像素点，返回半径内最近的节点。
 *
 * 坐标链：节点布局由布局助手写在 layout（graph 的 view 坐标系，未含 roam 的缩放/平移），
 * `convertToPixel` 按 seriesIndex 取同一坐标系把布局点换算成画布像素（roam 的 zoom/center
 * 已在内），所以拖拽/缩放之后热区仍然贴着节点。探针实测：[389.9, 317.3] → [390.0, 315.6]。
 * 取最近的一颗：热圈重叠时选择「更近」的那个，不会随遍历顺序跳变。
 */
function nodeNearPixel(x: number, y: number, radius: number): MkGraphNode | null {
  if (!chart) return null
  try {
    const model = chart as unknown as GraphModel
    const byId = new Map(visibleNodes.value.map((n) => [n.id, n]))
    let best: MkGraphNode | null = null
    let bestDist = Infinity
    model.getModel().getSeriesByIndex(0).getGraph().eachNode((n) => {
      const p = layoutPoint(n.getLayout())
      if (!p) return
      const px = chart!.convertToPixel({ seriesIndex: 0 }, [p.x, p.y]) as number[] | null
      if (!Array.isArray(px)) return
      const dist = Math.hypot(px[0] - x, px[1] - y)
      if (dist > radius || dist >= bestDist) return
      const found = byId.get(String(n.id))
      if (found) {
        best = found
        bestDist = dist
      }
    })
    return best
  } catch {
    return null
  }
}

function buildOption(viewState?: { zoom?: number; center?: [number | string, number | string] } | null): EChartsCoreOption {
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
  // 密集阈值按画布面积给（窄屏更早进密集档），理由与折算见 isDenseLabelGraph 的注释。
  const narrow = isNarrow.value
  const denseGraph = isDenseLabelGraph(nodes.length, narrow)
  const highlightSet = new Set(props.highlightIds)
  // 力导向总跨度 ≈ 边长·√n；斥力/边长的原值按 ~40 节点校准，故以 40 为基准反比收缩
  const shrink = Math.sqrt(40 / Math.max(1, nodes.length))
  // 每行字数与字号配套：字号提到 12（仓库文本下限）后单字更宽，每行相应收一个字，
  // 两行折行后的整体标签宽度基本不变，不会因放大而把画布挤得更糊。
  const perLine = narrow ? 6 : 8
  const labelWorthy = new Set<string>()
  if (!denseGraph) {
    for (const node of nodes) labelWorthy.add(node.id)
  } else if (!narrow) {
    // 桌面密集图：枢纽 6 + 薄弱/脆弱全标
    const hubCount = 6
    const byDegree = [...nodes]
      .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))
      .slice(0, hubCount)
    for (const node of byDegree) labelWorthy.add(node.id)
    for (const node of nodes) {
      const weak = node.stability === 'fragile' || (node.masteryScore !== null && node.masteryScore !== undefined && node.masteryScore < 0.45)
      if (weak) labelWorthy.add(node.id)
    }
  }
  // 窄屏密集图刻意一个常显标签都不放：320–370px 宽放 20+ 节点时，任何 7–10 个
  // 标签都会互相压字，最右一列还会被 canvas 裁掉。点按/悬停节点仍有 tooltip 与
  // 下方详情（MkGraphExplorer 侧栏 / 课堂知识点浮窗的选中行）。
  // 例外：课堂浮窗传入的本节 1–2 个概念必须常显并高亮，否则迷你图没有教学锚点。
  for (const id of highlightSet) labelWorthy.add(id)
  // 孤立可见节点一律常显名字（2026-10-31 三轮评审）：它没有任何邻边、悬停兜底也指不出
  // 「正在学的是什么」，且四周全空不存在压字；不标名就成了一颗无名的点。
  for (const node of nodes) {
    if (!degree.get(node.id)) labelWorthy.add(node.id)
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
        // 点选后详情已由右栏/底部面板承载，画布上不再重复弹卡遮挡邻接节点
        if (selectedIdRef.value && String(node.id) === selectedIdRef.value) return ''
        const mastery = node.masteryScore === null || node.masteryScore === undefined
          ? '未评估'
          : `${Math.round(node.masteryScore * 100)}%`
        return [
          `<b>${escapeHtml(node.label)}</b>`,
          `${node.level === 'concept' ? '核心概念' : '知识组件'}`,
          `掌握度：${mastery}`,
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
        // 约 8% 的留白：力导向只按节点符号收敛，标签（尤其右侧长概念名）会伸出画布。
        // 缩小 viewport 让最外圈节点离边留出标签宽度，避免被 canvas 裁掉。
        // 课堂浮窗有高亮节点时整体左移 4%：本节知识点标签在右侧，避免贴边被裁。
        zoom: viewState?.zoom ?? (narrow ? 1 : 0.9),
        center: viewState?.center ?? [highlightSet.size ? '46%' : '50%', '50%'],
        // 布局盒留边：四边都要给节点半径 + 底部标签留空间，否则力导向收边时
        // 最外圈节点会贴住画布边缘，底部标签被 canvas 的 overflow:clip 切掉。
        // 2026-11-05 知识图谱页走查（P2）：narrow 档余量不够两行标签——12px 字号 ×
        // lineHeight 16 的两行标签 ≈37px 高（distance 5 + 32 文字），bottom 36 仍把
        // 「第二个动词的角色判定」第二行拦腰截断；left 28 放不下以节点为中心的
        // 6 字行半宽（36px），首字左半被裁。抬到 top 44 / bottom 46 / left 44。
        top: narrow ? 44 : 40,
        bottom: narrow ? 46 : 48,
        left: narrow ? 44 : 48,
        right: narrow ? 56 : 96,
        scaleLimit: { min: 0.3, max: 4 },
        label: {
          show: false,
          position: 'bottom',
          distance: 5,
          color: textColor,
          // 画布内文字统一 12px（仓库文本下限）；窄画布不再靠缩字号塞标签，
          // 密集图直接不常显标签（见下方 labelWorthy 分支）。
          fontSize: 12,
          lineHeight: 16,
          // 与画布同色的底衬（见 labelSurface 注释）：hideOverlap 看不见节点符号，
          // 密集区枢纽标签会压在邻节点上，铺底衬后文字不再被节点色块吃掉。
          backgroundColor: labelSurface(dark),
          padding: [2, 3],
          borderRadius: 2,
          formatter: (params: { name?: string }) => wrapGraphLabel(params?.name ?? '', perLine)
        },
        // hideOverlap 只比较「标签↔标签」，管不到节点符号（评审建议的 forceLayout 键在
        // ECharts 6.1 的 labelLayout 里并不存在，只有 hideOverlap / moveOverlap）；压在
        // 节点上的情况交给上面的同色底衬。moveOverlap 是一维推移，会为了不同行的标签把
        // 标签整体推离自己的节点，故不启用。
        // hideOverlap 常开（2026-11-05 课堂走查）：旧版在「有高亮」时整体关闭——课堂浮窗
        // 两个本节知识点标签若互相重叠会被当“重叠”吞掉后者。现在改为多高亮时标签上下
        // 交错（见下方 data.label.position），两枚高亮标签不再互压，hideOverlap 得以
        // 常开：课堂上“判断动作性质”橙字直接叠在连线/非高亮标签上的压字被正常收掉。
        labelLayout: { hideOverlap: true },
        // 2026-11-05 用户定稿（图谱交互三刀之一）：hover 不再压暗全图——
        // focus:'adjacency' 会在鼠标划过任意节点时把无关节点瞬变半透明，
        // 找节点的沿途扫过十几个点、全图忽明忽暗（"高亮透明闪烁"的病根）。
        // hover 只放大当前节点 1.25 倍 + 蓝描边 + 邻接线加粗；压暗留给点击选中。
        emphasis: {
          focus: 'none',
          scale: 1.25,
          label: { show: true, fontWeight: 'bold' },
          itemStyle: { borderColor: '#2563eb', borderWidth: 3 },
          lineStyle: { width: 3 }
        },
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
          // 力导向的总跨度 ≈ 边长·√n；上面的 480 / 110-220 是按 ~40 节点校准的。
          // 2026-10-29：桌面降高后 24 节点仍会顶满 650px 画布，底部标签被裁；
          // 密集档收紧斥力上限与边长，让最外圈节点离边留出标签高度（n≤40 时 shrink=1）。
          repulsion: narrow ? 110 : (denseGraph ? Math.min(520, Math.round(480 * shrink * shrink)) : 240),
          edgeLength: narrow
            ? [36, 80]
            : (denseGraph ? [Math.round(90 * shrink), Math.round(170 * shrink)] : [80, 160]),
          gravity: narrow ? 0.13 : (denseGraph ? 0.06 : 0.08),
          friction: 0.82,
          // 2026-11-04：关掉力导向动画。开动画时 ECharts 只在初始（节点尚未散开、大量重叠）
          // 的位置跑一次 labelLayout.hideOverlap，节点随后动画收敛到新位置却不再重算标签 →
          // 中文概念名压在相邻节点/标签上、末尾被吞（1920/2560 复现）。关动画后力导向在渲染
          // 前同步收敛，hideOverlap 拿最终位置判定，重叠标签被正常收掉。
          layoutAnimation: false
        },
        data: nodes.map((node) => {
          const highlighted = highlightSet.has(node.id)
          // 选中压暗（2026-11-05 用户定稿）：点击锁定目标后无关节点 0.35（点击比 hover 的
          // 0.15 留更多上下文）；课堂浮窗高亮维持原 0.48 档
          const dimmedByHighlight = highlightSet.size > 0 && !highlighted
          const dimmedBySelect = !!selectedIdRef.value && node.id !== selectedIdRef.value
          const dimmed = dimmedByHighlight ? 'highlight' : dimmedBySelect ? 'select' : null
          const baseSize = Math.min(narrow ? 34 : 44, (narrow ? 12 : 15) + (degree.get(node.id) ?? 0) * 4)
          // 多个高亮时标签上下交错：第 1 枚在节点下方、第 2 枚起在上方——hideOverlap
          // 常开后（见上方 labelLayout 注释），交错保证两枚高亮标签不因互相重叠被吞
          const highlightIndex = props.highlightIds.indexOf(node.id)
          // 刻意不回填 x/y：graph 的 view 坐标系用 data 的 x/y 算包围盒，回填上一轮布局
          // 坐标会把整张图重投影（探针实测位移 ~207px）；力导向重建本身确定性（0px），
          // 所以点击选中不会重排，见 readGraphViewport。
          return {
            id: node.id,
            name: node.label,
            // 手势光标分离（2026-11-05 用户定稿）：节点/标签才是 pointer，
            // 空白画布由 bindZrInteractions 在 zrender 的 viewport 元素上给 grab/grabbing
            cursor: 'pointer',
            symbolSize: Math.min(narrow ? 38 : 48, baseSize + (highlighted ? 4 : 0)),
            itemStyle: {
              color: colorOf(node, dark),
              borderColor: highlighted ? (dark ? '#f6c453' : '#b45309') : (dark ? '#2a2c30' : '#ffffff'),
              borderWidth: highlighted ? 2.5 : 1.5,
              opacity: dimmed === 'highlight' ? 0.48 : dimmed === 'select' ? 0.35 : 1
            },
            // 层级：coreConcept 用圆、KC 用圆角方块，一眼区分粒度
            symbol: node.level === 'concept' ? 'circle' : 'roundRect',
            label: {
              show: labelWorthy.has(node.id) || node.id === selectedIdRef.value,
              fontWeight: highlighted ? 'bold' : 'normal',
              color: highlighted ? (dark ? '#ffe08a' : '#8a4b00') : textColor,
              position: highlighted && highlightIndex > 0 ? 'top' : 'bottom'
            },
            raw: node
          }
        }),
        // 前置边后画（覆盖在"属于"虚线之上），让主结构更清楚
        links: [...edges]
          .sort((a, b) => (a.relation === 'prerequisite' ? 1 : 0) - (b.relation === 'prerequisite' ? 1 : 0))
          .map((edge) => {
            // 选中压暗：与选中节点无关的连线一起退到 0.25，选中节点的邻接结构才突得出来
            const touchesSelected =
              !selectedIdRef.value ||
              edge.fromConceptId === selectedIdRef.value ||
              edge.toConceptId === selectedIdRef.value
            return {
              source: edge.fromConceptId,
              target: edge.toConceptId,
              relation: edge.relation,
              // 与 DOM 图例同源（见文件头 relationStyleOf 注释）
              lineStyle: {
                ...relationStyleOf(edge.relation, dark),
                opacity: touchesSelected ? 1 : 0.25
              }
            }
          })
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
      if (params?.dataType !== 'node') {
        selectedIdRef.value = null
        chart?.dispatchAction({ type: 'hideTip' })
        emit('select', null)
        render()
        return
      }
      const data = params.data as { raw?: MkGraphNode } | undefined
      selectedIdRef.value = data?.raw?.id ? String(data.raw.id) : null
      chart?.dispatchAction({ type: 'hideTip' })
      emit('select', data?.raw ?? null)
      // 选中/取消都要重建 option 把无关节点压暗；render() 会抄走当前坐标与缩放，
      // 力导向从原位续跑，不发生"点一下重排一次"
      render()
    })
    // 批次四 P2：缩放跨档收/放节点标签（setOption(notMerge) 重建会重置缩放档标志）
    chart.on('graphRoam', () => applyZoomLabels())
    bindZrInteractions(chart)
  }
  chart.setOption(buildOption(readGraphViewport()), true)
  labelsHiddenByZoom = false
}

let lastNarrow = false

/**
 * 画布交互（§5 2026-11-05/11-06 用户定稿）：手势光标 + 点击热区。
 *
 * 为什么绑在实例创建处而不是 onMounted：切主题会 dispose 重建实例（见 render 顶部），
 * 新的 zrender 实例不会继承旧监听——放在这里，每次重建后手势与热区都还在。
 */
function bindZrInteractions(instance: echarts.ECharts) {
  const zrender = instance.getZr()
  // 手势光标分离：空白画布=抓手、按住拖动=紧握、节点/标签=小手。
  // ⚠ 光标必须写在 **zrender 自己的 viewport 元素** 上：Handler.mousemove 每次都会
  // HandlerProxy.setCursor → 往 painter.getViewportRoot()（canvas/Painter.js:121 新建并
  // append 到本组件 div 的子 div）写 inline 'default'，子 div 的 inline 值会盖掉外层
  // .mk-graph 的 cursor: grab——写在外层组件 div 上等于没写（2026-11-06 复核实证）。
  // 分工：拖动中 → grabbing（优先，哪怕正划过节点）；空白 → grab（覆盖 zrender 的
  // default）；有 target（节点/文字标签）→ 不插手，保留 zrender 按 data cursor 写的 pointer。
  const cursorTarget: HTMLElement | null = zrender.painter.getViewportRoot() || el.value
  let roaming = false
  zrender.on('mousemove', (e: { target?: unknown }) => {
    if (!cursorTarget) return
    if (roaming) {
      cursorTarget.style.cursor = 'grabbing'
      return
    }
    if (e.target) return
    cursorTarget.style.cursor = 'grab'
  })
  zrender.on('mousedown', (e: { target?: unknown }) => {
    if (!cursorTarget) return
    if (!e.target) {
      roaming = true
      cursorTarget.style.cursor = 'grabbing'
    }
  })
  // 拖拽结束：拖动期间 grabbing 一直压着 zrender 的 pointer，这里按鼠标下的元素恢复
  zrender.on('mouseup', (e: { target?: unknown }) => {
    if (!cursorTarget || !roaming) return
    roaming = false
    const target = e.target as { cursor?: string } | undefined
    cursorTarget.style.cursor = target ? target.cursor || 'pointer' : 'grab'
  })
  zrender.on('globalout', () => {
    roaming = false
    if (cursorTarget) cursorTarget.style.cursor = ''
  })

  // 点击热区（§5：r >= 20px）+ 空白点击回概览。
  // 节点/文字标签/连线的点击有 target，由 ECharts 自己的 click 处理（标签经 __hostTarget
  // 归属到节点符号，点文字即点节点）；这里只接「点在空白处」这一档：先按 20px 找最近节点
  // （热区命中就当选中它），半径内没有节点才取消选中。空白的 chart click 不会触发
  // （ECharts 对无 target 的点击不派发事件），所以回概览也必须在这里落地。
  zrender.on('click', (e: { target?: unknown; offsetX?: number; offsetY?: number }) => {
    if (e.target) return
    const x = Number(e.offsetX)
    const y = Number(e.offsetY)
    const hot = Number.isFinite(x) && Number.isFinite(y) ? nodeNearPixel(x, y, NODE_HIT_RADIUS) : null
    if (hot) {
      selectedIdRef.value = hot.id
      instance.dispatchAction({ type: 'hideTip' })
      emit('select', hot)
      render()
      return
    }
    if (!selectedIdRef.value) return
    selectedIdRef.value = null
    emit('select', null)
    render()
  })
}

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
  /* 手势光标基线（2026-11-05 用户定稿）：空白画布是抓手，节点悬浮由 data cursor 接管
     （小手）、拖拽中由 bindZrInteractions 切成紧握。注意运行时真正生效的 inline 值写在
     zrender 的 viewport 子 div 上（它继承本行的 grab 作为首帧基线），见 bindZrInteractions */
  cursor: grab;
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
    /* 原先是「砍半」，24 概念的全景图只剩 260px 高，节点和标签挤成一团；
       0.7 倍并保底 280px，课堂 320px 小图也不会小到看不清。 */
    height: max(260px, calc(var(--mkg-h, 520px) * 0.6));
  }
}
.mk-graph__note {
  margin: 6px 0 0;
  font-size: var(--mk-fs-micro);
  line-height: 1.5;
  opacity: 0.65;
}
</style>
