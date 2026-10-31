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
/** 已点选的节点：右栏/底部详情接管信息，画布 tooltip 不再重复弹出 */
let selectedId: string | null = null
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
        if (selectedId && String(node.id) === selectedId) return ''
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
        // 约 8% 的留白：力导向只按节点符号收敛，标签（尤其右侧长概念名）会伸出画布。
        // 缩小 viewport 让最外圈节点离边留出标签宽度，避免被 canvas 裁掉。
        // 课堂浮窗有高亮节点时整体左移 4%：本节知识点标签在右侧，避免贴边被裁。
        zoom: narrow ? 1 : 0.9,
        center: [highlightSet.size ? '46%' : '50%', '50%'],
        // 布局盒留边：四边都要给节点半径 + 底部标签留空间，否则力导向收边时
        // 最外圈节点会贴住画布边缘，底部标签被 canvas 的 overflow:clip 切掉。
        top: narrow ? 22 : 40,
        bottom: narrow ? 36 : 48,
        left: narrow ? 28 : 48,
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
        // 课堂浮窗只亮 2 个本节知识点；hideOverlap 会把后一个标签当“重叠”直接吞掉。
        // 有高亮时放开，保证两个黄色标签都出现（普通图仍保留防叠字）。
        labelLayout: { hideOverlap: highlightSet.size === 0 },
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
          // 力导向的总跨度 ≈ 边长·√n；上面的 480 / 110-220 是按 ~40 节点校准的。
          // 2026-10-29：桌面降高后 24 节点仍会顶满 650px 画布，底部标签被裁；
          // 密集档收紧斥力上限与边长，让最外圈节点离边留出标签高度（n≤40 时 shrink=1）。
          repulsion: narrow ? 110 : (denseGraph ? Math.min(520, Math.round(480 * shrink * shrink)) : 240),
          edgeLength: narrow
            ? [36, 80]
            : (denseGraph ? [Math.round(90 * shrink), Math.round(170 * shrink)] : [80, 160]),
          gravity: narrow ? 0.13 : (denseGraph ? 0.06 : 0.08),
          friction: 0.82,
          layoutAnimation: true
        },
        data: nodes.map((node) => {
          const highlighted = highlightSet.has(node.id)
          const dimmed = highlightSet.size > 0 && !highlighted
          const baseSize = Math.min(narrow ? 34 : 44, (narrow ? 12 : 15) + (degree.get(node.id) ?? 0) * 4)
          return {
            id: node.id,
            name: node.label,
            symbolSize: Math.min(narrow ? 38 : 48, baseSize + (highlighted ? 4 : 0)),
            itemStyle: {
              color: colorOf(node, dark),
              borderColor: highlighted ? (dark ? '#f6c453' : '#b45309') : (dark ? '#2a2c30' : '#ffffff'),
              borderWidth: highlighted ? 2.5 : 1.5,
              opacity: dimmed ? 0.48 : 1
            },
            // 层级：coreConcept 用圆、KC 用圆角方块，一眼区分粒度
            symbol: node.level === 'concept' ? 'circle' : 'roundRect',
            label: {
              show: labelWorthy.has(node.id),
              fontWeight: highlighted ? 'bold' : 'normal',
              color: highlighted ? (dark ? '#ffe08a' : '#8a4b00') : textColor
            },
            raw: node
          }
        }),
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
      if (params?.dataType !== 'node') {
        selectedId = null
        chart?.dispatchAction({ type: 'hideTip' })
        emit('select', null)
        return
      }
      const data = params.data as { raw?: MkGraphNode } | undefined
      selectedId = data?.raw?.id ? String(data.raw.id) : null
      chart?.dispatchAction({ type: 'hideTip' })
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
