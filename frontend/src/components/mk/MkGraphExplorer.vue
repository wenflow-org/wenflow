<template>
  <div class="mk-ge">
    <!-- 整屏三态（原型知识图谱屏 wf-view--loading / --empty / --error）：状态视图整体替换
         「路径筛选轨 + 图卡」，结构与用户侧 V2ResultState 的整屏用法一致（组件本体不动）。
         动作按钮按宿主接线渲染：V2KnowledgeMap 传入文案并监听事件；admin 未接线 → 只读说明。 -->
    <div v-if="error" class="mk-ge__state">
      <V2ResultState
        tone="error"
        title="图谱加载失败"
        :description="error"
        :action-text="errorActionText"
        @action="onRetry"
      />
    </div>
    <!-- 骨架三段：短条 + 与画布同高的占位块 + 长条（原型 wf-skel 的 bar / bar--xl / bar--lg） -->
    <div v-else-if="loading" class="mk-ge__state" role="status">
      <p class="visually-hidden">图谱加载中…</p>
      <SkeletonLoader variant="lines" :count="1" />
      <div class="mk-ge__skel-graph" :style="{ height }" aria-hidden="true"></div>
      <SkeletonLoader variant="lines" :count="1" />
    </div>
    <div v-else-if="!nodes.length" class="mk-ge__state">
      <V2ResultState
        tone="empty"
        title="图谱还是空的"
        :description="emptyHint"
        :action-text="emptyActionText"
        @action="onEmptyAction"
      />
    </div>

    <template v-else>
      <!-- 图卡：卡壳（border / radius / padding 10px 10px 4px）由宿主出——
           页面走 .km__card :deep(.mk-ge__card)，admin 嵌在 .mk-card 里不再套一层 -->
      <div class="mk-ge__card">
        <!-- 工具条：左路径切换、中统计、右视图筛选。统计口径与画布着色一致，四档名见 utils/conceptBands。
             路径切换（§5 2026-11-06 定稿）：原先图卡上方独立的平铺胶囊轨 + 右侧「更多（N）」浮层
             （长标题一行只放得下 3 个，浮层还会盖住下方概览面板）整体撤除，收进**一个**路径选择
             下拉，并与统计筛选栏同栏左端整合——任何视口下都不再溢出、也不再需要第二套单选控件。
             下拉用 MkSelect（工具栏/表单下拉原语）：键盘 ↑↓ / Home / End / Enter 选中、Esc/点外部
             关闭、选中后焦点归还触发器，语义为 combobox + listbox（原 radiogroup 的能力不缩水）。 -->
        <div class="mk-ge__bar">
          <!-- 路径归属恒常驻（2026-11-07 用户走查 图4）：此前只在 `paths.length > 1` 时
               出下拉，只有 1 条路径的用户左上角什么都没有——看不出当前看的是哪条路径的图。
               现在：多条 → 下拉（可切「全部路径」）；恰好 1 条 → 静态标签直接写路径名
               （没有可切项，下拉是假控件）。两者占同一格、同一字号基线，切换路径条数不跳动。 -->
          <div v-if="showPathRail && paths.length > 1" ref="pathpickEl" class="mk-ge__pathpick">
            <MkSelect
              block
              :model-value="pathId ?? null"
              :options="pathOptions"
              placeholder="全部路径"
              aria-label="按学习路径筛选"
              @update:model-value="selectPath"
            />
          </div>
          <div v-else-if="showPathRail && paths.length === 1" class="mk-ge__pathonly">
            <span class="mk-ge__pathonly-label">当前路径</span>
            <strong :title="paths[0].title || '未命名路径'">{{ paths[0].title || '未命名路径' }}</strong>
          </div>
          <div class="mk-ge__stats">
            <!-- 2026-10-31 二轮评审 P2：隐藏孤立点时写明「显示 X / Y」，不再让 24 与图例加总对不上 -->
            <span class="mk-ge__stat" :title="levelNodes.length !== listNodes.length ? `另有 ${levelNodes.length - listNodes.length} 个未评估的孤立概念未画出` : undefined">
              <b>{{ levelNodes.length !== listNodes.length ? `${listNodes.length} / ${levelNodes.length}` : levelNodes.length }}</b> 个概念
            </span>
            <span class="mk-ge__stat"><b>{{ levelEdges.length }}</b> 条关系</span>
            <span class="mk-ge__stat mk-ge__stat--ok"><i />{{ CONCEPT_BAND_LABEL.stable }} <b>{{ counts.stable }}</b></span>
            <span class="mk-ge__stat mk-ge__stat--mid"><i />{{ CONCEPT_BAND_LABEL.learning }} <b>{{ counts.learning }}</b></span>
            <span class="mk-ge__stat mk-ge__stat--weak"><i />{{ CONCEPT_BAND_LABEL.fragile }} <b>{{ counts.fragile }}</b></span>
            <span class="mk-ge__stat mk-ge__stat--none"><i />{{ CONCEPT_BAND_LABEL.unknown }} <b>{{ counts.unknown }}</b></span>
          </div>
          <div class="mk-ge__controls">
            <div class="mk-ge__seg" role="group" aria-label="概念层级">
              <button
                v-for="opt in LEVEL_OPTIONS" :key="opt.value"
                type="button" class="mk-ge__seg-btn"
                :class="{ 'mk-ge__seg-btn--on': level === opt.value }"
                :aria-pressed="level === opt.value"
                @click="level = opt.value"
              >{{ opt.label }}</button>
            </div>
            <label class="mk-ge__check">
              <input type="checkbox" :checked="!hideIsolated" @change="onIsolatedChange" />
              显示无关系的概念
            </label>
          </div>
        </div>

        <div class="mk-ge__body" :class="{ 'mk-ge__body--full': !sideOpen }">
          <div class="mk-ge__canvas">
            <MkGraph
              ref="graphComp"
              :nodes="levelNodes"
              :edges="levelEdges"
              :theme="resolvedTheme"
              :height="height"
              :hide-isolated="hideIsolated"
              @select="onCanvasSelect"
            />
            <!-- 收起侧栏后的展开入口（sideOpen=false 时 aside 连同其上的开关一起消失） -->
            <button
              v-if="!sideOpen"
              type="button"
              class="mk-ge__side-reopen"
              aria-label="展开侧栏"
              title="展开侧栏"
              @click="sideOpen = true"
            >« 侧栏</button>
            <!-- 缩放控件（2026-11-06 走查）：滚轮/双指之外给一颗可点的入口——触屏用户
                 与不知道滚轮缩放的用户此前没有任何缩放手段。⟲ 回到 fitView 初始档。 -->
            <div class="mk-ge__zoom" role="group" aria-label="图谱缩放">
              <button type="button" class="mk-ge__zoom-btn" aria-label="放大" title="放大" @click="zoomBy(1.25)">
                <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path d="M10 4v12M4 10h12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
              </button>
              <button type="button" class="mk-ge__zoom-btn" aria-label="缩小" title="缩小" @click="zoomBy(0.8)">
                <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path d="M4 10h12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
              </button>
              <button type="button" class="mk-ge__zoom-btn" aria-label="适配居中" title="适配居中" @click="resetView">
                <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M6.5 3.5h-3v3M13.5 3.5h3v3M6.5 16.5h-3v-3M13.5 16.5h3v-3"/></svg>
              </button>
            </div>
            <!-- 图例走 DOM：画布内图例在 graph 系列里会误导（categories 是节点分组，不是关系）。
                 2026-11-05 PC 走查：四档状态点从底图例撤除——画布头统计行同屏已有同一套
                 「已掌握/进行中/记忆偏弱/待学习」计数（同一信息横竖各画一遍是重复），
                 底图例只留「连线语义 + 形状/操作提示」这两样头行没有的东西 -->
            <div class="mk-ge__legend">
              <span class="mk-ge__legend-group">
                <i
                  class="mk-ge__line"
                  :style="{ borderTop: `${legendLines.prereq.width}px ${legendLines.prereq.type} ${legendLines.prereq.color}` }"
                />前置依赖（先掌握左边）
                <i
                  class="mk-ge__line"
                  :style="{ borderTop: `${legendLines.part.width}px ${legendLines.part.type} ${legendLines.part.color}` }"
                />属于（知识组件 → 核心概念）
              </span>
              <span class="mk-ge__legend-group mk-ge__legend-hint">
                圆点=核心概念 · 方块=知识组件 ·
                <span class="mk-ge__legend-desktop">拖动/滚轮可缩放</span>
                <span class="mk-ge__legend-mobile">双指可缩放</span>
                <span class="mk-ge__legend-tap"> · 点节点看名称</span>
              </span>
            </div>
          </div>

          <!-- 侧栏详情随画布点选切换，对读屏是「远端变更」→ polite 播报摘要
               （画布的完整 AT 等价清单见下方 sr-only 概念清单——2026-09-27 a11y 走查，P2 收尾落地） -->
          <aside v-show="sideOpen" class="mk-ge__side" aria-live="polite">
            <!-- 标题行（2026-11-07 走查）：折叠钮原来 absolute 钉右上，16 字长标题第一行
                 正好钻到按钮底下被截断。标题与按钮改同一 flex 行：标题弹性占宽可折行，
                 按钮固定不缩。详情态/概览态共用这一行（按钮在两态都常驻右上）。 -->
            <div class="mk-ge__side-head">
              <h4 v-if="selected" class="mk-ge__side-title">{{ selected.label }}</h4>
              <h4 v-else class="mk-ge__side-title">图谱概览</h4>
              <button
                type="button"
                class="mk-ge__side-toggle"
                :aria-expanded="sideOpen"
                :title="sideOpen ? '收起侧栏' : '展开侧栏'"
                :aria-label="sideOpen ? '收起侧栏' : '展开侧栏'"
                @click="sideOpen = !sideOpen"
              >{{ sideOpen ? '»' : '«' }}</button>
            </div>
            <template v-if="selected">
              <!-- 状态徽章（原型抽屉：h + wf-badge） -->
              <div class="mk-ge__side-meta">
                <span class="mk-badge" :class="selectedStatus.badge">{{ selectedStatus.label }}</span>
                <span v-if="selected.taxonomy" class="mk-ge__side-sub">{{ selected.taxonomy }}</span>
              </div>

              <!-- 掌握程度（近 30 天）：原型 wf-reviewlist 卡 + 两条 wf-bar（6px 轨 / 蓝青渐变填充） -->
              <section class="mk-ge__mastery">
                <div class="mk-ge__mastery-head">
                  <strong>掌握程度</strong>
                  <span>近 30 天</span>
                </div>
                <ul class="mk-ge__mastery-list">
                  <li class="mk-ge__mastery-row">
                    <span class="mk-ge__mastery-name">记忆强度</span>
                    <div class="mk-ge__meter"><i :style="{ width: masteryWidth }" /></div>
                    <span class="mk-ge__mastery-pct">{{ masteryTextSelected }}</span>
                  </li>
                  <li class="mk-ge__mastery-row">
                    <span class="mk-ge__mastery-name">提取练习</span>
                    <div class="mk-ge__meter"><i :style="{ width: practiceWidth }" /></div>
                    <span class="mk-ge__mastery-pct">{{ practiceCount }} 次</span>
                  </li>
                </ul>
              </section>

              <!-- 到期复习说明：concept-graph 节点不带 dueAt，只按提取次数/最近练习说清节奏 -->
              <p class="mk-ge__review">{{ reviewNote }}</p>

              <!-- 主 CTA（原型 wf-drawer__acts 收敛，2026-10-09 用户反馈）：
                   仅在概念有可直达任务锚点时出现（practice.taskId 为 null 时原先会兜底跳
                   /dashboard，是语义断裂的"去练习"）；「先放着」删除——侧栏非模态，
                   点其他节点即切换内容，无需显式关闭按钮 -->
              <div v-if="practiceActionText && selected.practice?.taskId" class="mk-ge__acts">
                <button type="button" class="mk-ge__cta" @click="onPractice">{{ practiceActionText }}</button>
              </div>

              <!-- 字段分区（2026-09-27）：概览条带 + 关系分区（发丝线分隔）；掌握度/提取次数已由上方 bar 承载 -->
              <dl class="mk-ge__kv">
                <div class="mk-ge__cell"><dt>层级</dt><dd>{{ selected.level === 'concept' ? '核心概念' : '知识组件' }}</dd></div>
                <div class="mk-ge__cell"><dt>稳定性</dt><dd>{{ STABILITY_LABEL[String(selected.stability ?? '')] || '—' }}</dd></div>
                <!-- 概念台账事实（2026-10-20 从概览「概念掌握」卡的逐概念明细搬来）：
                     可迁移 / 误解风险 / 证据条数原本在概览卡里按概念平铺一遍，与这里的
                     记忆强度、提取练习是同一个概念的两种读数；合并到节点详情后
                     同一份概念事实只有一个落点（概览卡只留结论行） -->
                <template v-if="selectedFacts">
                  <div class="mk-ge__cell"><dt>迁移就绪</dt><dd>{{ selectedFacts.readiness }}</dd></div>
                  <div class="mk-ge__cell">
                    <dt>误解风险</dt>
                    <dd :class="`mk-ge__fact--${selectedFacts.riskTone}`">{{ selectedFacts.risk }}</dd>
                  </div>
                  <div class="mk-ge__cell"><dt>证据</dt><dd>{{ selectedFacts.evidenceCount }} 条</dd></div>
                </template>
              </dl>
              <div v-for="group in relationGroups" :key="group.label" class="mk-ge__rel">
                <p class="mk-ge__rel-label">{{ group.label }}<b>{{ group.items.length }}</b></p>
                <ul class="mk-ge__rel-list">
                  <li v-for="item in group.items" :key="item.id">
                    <button type="button" class="mk-ge__rel-item" @click="focusNode(item.id)">{{ item.label }}</button>
                  </li>
                </ul>
              </div>
            </template>
            <div v-else class="mk-ge__overview">
              <!-- 未选中时侧栏不能只剩一句提示、把 800px 高的右栏留空（2026-10-29
                   像素级走查）：给最多 5 个「最该先看」的概念，点名字等同点画布节点，
                   侧栏即刻切到详情。原来的 2×2 分布数字块删去（2026-11-03 真机走查）：
                   画布头图例同屏已有同一套「已掌握/进行中/记忆偏弱/待学习」计数，
                   同一信息两种呈现是重复；「点图中节点…」用法句也删——画布底图例
                   已有「点节点看名称」，同屏教两遍。 -->
              <template v-if="suggestedNodes.length">
                <p class="mk-ge__overview-label">建议先看</p>
                <ul class="mk-ge__overview-list">
                  <li v-for="n in suggestedNodes" :key="n.id">
                    <button type="button" class="mk-ge__overview-item" @click="focusNode(n.id)">
                      <span>{{ n.label }}</span>
                      <!-- 列表本身排除了已掌握；全列「待学习」时徽标列零信息，
                           只在行有别的状态原因（记忆偏弱/进行中）时才标 -->
                      <span v-if="statusKeyOf(n) !== 'unknown'" class="mk-badge" :class="STATUS_BADGE[statusKeyOf(n)]">{{ CONCEPT_BAND_LABEL[statusKeyOf(n)] }}</span>
                    </button>
                  </li>
                </ul>
              </template>
              <p v-else class="mk-ge__side-hint">这个图谱里的概念都已掌握。</p>
            </div>
          </aside>
        </div>
      </div>

      <!-- 读屏等价清单（P2 收尾）：节点信息此前只存在于 canvas 点击/悬停里，键盘/读屏用户完全拿不到。
           刻意放在 aria-live 侧栏**外**：路径切换时整份清单会重渲染，
           若在 live 区域内会被当成「远端变更」整段播报（40 条），对读屏用户是灾难。
           视觉隐藏复用全局 .visually-hidden（main.css），不在本组件重复定义。
           条数上界：V2KnowledgeMap 的 AUTO_NARROW_CONNECTED_NODES=40 收窄护栏保证有界，无性能问题 -->
      <section
        class="visually-hidden mk-ge__inventory"
        aria-labelledby="mk-ge-inventory-heading"
      >
        <h4 id="mk-ge-inventory-heading">当前图谱包含的概念</h4>
        <ul>
          <li v-for="n in listNodes" :key="n.id">
            {{ n.label }}（{{ n.level === 'concept' ? '核心概念' : '知识组件' }}，掌握度 {{ masteryText(n) }}）
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * MkGraphExplorer：知识点图的**统一外壳**（admin 学习者详情 / 用户侧知识图谱页共用）
 *
 * 为什么单独抽一层：两处需要同一套"统计 + 筛选 + 画布 + 详情"的信息架构，
 * 之前 admin 只有一个裸画布（167 个概念、29 条关系，看不出结构也切不了路径）。
 *
 * 分工：本组件做展示与本地筛选（层级 / 孤立节点）+ 三态整屏渲染；**路径切换由父组件接管**——
 * 它要重新请求（后端按 pathId 收敛节点与边），不是纯前端过滤。
 *
 * 2026-09-30 对齐原型（newui/用户侧 知识图谱屏）：
 *  ① 路径筛选从工具条里的原生 <select> 改为图卡上方独立的 chip 轨（wf-rail + wf-chip）；
 *     2026-11-06 §5 又收回到工具条里的单个下拉（chip 轨 + 「更多」浮层整体撤除，见模板注释）；
 *  ② 空/错/骨架三态改整屏形态（V2ResultState + SkeletonLoader，替换 rail 与图卡）；
 *  ③ 节点详情补原型抽屉的内容结构：状态徽章 / 掌握程度两条 bar / 复习说明 / 主 CTA + ghost。
 */
import { computed, nextTick, ref, watch } from 'vue'
import MkGraph, { relationStyleOf } from './MkGraph.vue'
import MkSelect from './MkSelect.vue'
import { useIsDark } from '@/composables/useIsDark'
import type { MkGraphConceptFacts, MkGraphEdge, MkGraphNode } from './MkGraph.vue'
import { CONCEPT_BAND_LABEL, type ConceptBandKey } from '@/utils/conceptBands'
import SkeletonLoader from '../ui/SkeletonLoader.vue'
import V2ResultState from '../ui/V2ResultState.vue'

const props = withDefaults(
  defineProps<{
    nodes: MkGraphNode[]
    edges: MkGraphEdge[]
    /** 该学习者图涉及的路径（后端 meta.paths），用于路径筛选轨 */
    paths?: Array<{ id: string; title: string | null }>
    /** 当前路径筛选（空 = 全部路径）。由父组件负责重新请求 */
    pathId?: string | null
    /** 是否渲染内置路径轨。false = 作用域已由父级（如学习者详情的页级「路径视角」）接管，
     *  此时仍可传 paths/pathId 控制取值，只是不再画一套同义控件 */
    showPathRail?: boolean
    /** 主题：不传则跟随 <html data-theme>（与 MkGraph/MkChart 同款） */
    theme?: 'light' | 'dark'
    height?: string
    loading?: boolean
    error?: string | null
    emptyHint?: string
    /** 整屏错误态的主动作文案；不传 = 只读说明（admin 未接线） */
    errorActionText?: string
    /** 整屏空态的主动作文案；不传 = 只读说明 */
    emptyActionText?: string
    /** 节点详情主 CTA 文案（原型「去练习这个知识点」）；不传 = 不渲染动作区 */
    practiceActionText?: string
    /** 概念台账事实（可迁移 / 误解风险 / 证据数），按概念名索引；不传 = 节点详情不渲染这组行
     *  （用户侧知识图谱没有学习者模型台账，保持原样） */
    conceptFacts?: Record<string, MkGraphConceptFacts>
  }>(),
  {
    paths: () => [],
    pathId: null,
    showPathRail: true,
    theme: undefined,
    height: '520px',
    loading: false,
    error: null,
    emptyHint: '还没有概念图数据——路径生成后 kc-mapper 会产出前置依赖，随概念身份注册表物化进图。',
    errorActionText: '',
    emptyActionText: '',
    practiceActionText: '',
    conceptFacts: () => ({}),
  }
)

const emit = defineEmits<{
  (e: 'update:pathId', value: string | null): void
  (e: 'select', node: MkGraphNode | null): void
  (e: 'retry'): void
  (e: 'empty-action'): void
  (e: 'practice', node: MkGraphNode): void
}>()

const LEVEL_OPTIONS = [
  { value: 'all' as const, label: '全部' },
  { value: 'concept' as const, label: '核心概念' },
  { value: 'kc' as const, label: '知识组件' },
]

const level = ref<'all' | 'concept' | 'kc'>('all')
const hideIsolated = ref(true)
const selected = ref<MkGraphNode | null>(null)
/** 侧栏收起态（2026-11-06 走查）：收起后画布吃满卡宽，全屏看图 */
const sideOpen = ref(true)
const graphComp = ref<{ zoomBy: (factor: number) => void; resetView: () => void } | null>(null)
function zoomBy(factor: number) { graphComp.value?.zoomBy(factor) }
function resetView() { graphComp.value?.resetView() }

/**
 * 画布点选 → 侧栏切换（2026-11-05 UX 审计 P2）：
 * - 再次点击已选节点 = 反选回「图谱概览」。详情卡此前没有任何关闭/收起控件（2026-10-09
 *   刻意决定「侧栏非模态、无需显式关闭」），但其前提不成立：概览/详情二选一渲染、
 *   点空白画布在部分触屏上点不中（审计实测 side-title 不变），概览一旦被详情替换，
 *   同路径内只能靠切走再切回路径 chip 找回——不可发现。反选不引入新控件，不违原决定。
 * - 点空白（node 为 null）维持原有回概览行为。
 */
function onCanvasSelect(node: MkGraphNode | null) {
  if (node && selected.value && node.id === selected.value.id) {
    selected.value = null
    return
  }
  selected.value = node
}

/* ---------- 路径切换（§5 2026-11-06 定稿：单个下拉，与统计栏同栏） ---------- */

type PathOption = { value: string | null; label: string }

/** 下拉恒定的第一项：全部路径（「看全貌」的出口） */
const allPathOption = computed<PathOption>(() => ({
  value: null,
  label: props.paths.length > 1 ? `全部路径（${props.paths.length} 条）` : '全部路径',
}))

/** 各条路径（value 必为 id），下拉里跟在「全部路径」之后 */
const pathOnlyOptions = computed<Array<{ value: string; label: string }>>(() => {
  // 无标题路径回落「未命名路径」而非裸 id（lp_1791… 对学习者无意义）；
  // 与列表页/学习台同款口径（V2LearningPaths / V2Dashboard 都是 `title || name || '未命名路径'`）
  const options = props.paths.map((p) => ({ value: p.id, label: p.title || '未命名路径' }))
  // 2026-11-04：同名项（实证=两条无标题路径同时回落「未命名路径」，lp_…oboui70 / lp_…zu7bhwj）
  // 在下拉里逐字相同、无法区分。对重名项按出现顺序补「1/2」序号；仅当同名 ≥2 条时补，
  // 唯一项仍保持原回落文案（单条无标题不能长出无意义的「1」）。
  const total = new Map<string, number>()
  for (const opt of options) total.set(opt.label, (total.get(opt.label) ?? 0) + 1)
  const seen = new Map<string, number>()
  return options.map((opt) => {
    if ((total.get(opt.label) ?? 0) < 2) return opt
    const n = (seen.get(opt.label) ?? 0) + 1
    seen.set(opt.label, n)
    return { ...opt, label: `${opt.label} ${n}` }
  })
})

/** 下拉的完整选项：全部路径 + 各条路径。
 *  路径再多也只是列表长一点（弹层自身可滚），不再有「轨上放不下」这回事，
 *  也就不需要「更多（N）」这种二级出口——旧轨的 RAIL_VISIBLE_PATHS / 溢出浮层随之删除。 */
const pathOptions = computed<PathOption[]>(() => [
  allPathOption.value,
  ...pathOnlyOptions.value,
])

function isActivePath(value: string | null): boolean {
  return (props.pathId ?? null) === value
}

const pathpickEl = ref<HTMLElement | null>(null)
/** 换路径会触发宿主重新请求（整屏切成骨架，下拉连同图卡一起卸载重建），
 *  所以「选中后焦点回到触发器」要等这次加载结束、控件重新挂上 DOM 再落——
 *  否则焦点掉回 body，键盘/读屏用户不知道自己换到了哪条路径。 */
const pendingPathFocus = ref(false)

/** 换路径：清空当前选中节点（旧节点可能不在这张图里），再让父组件重新请求。 */
function selectPath(value: string | null) {
  if (isActivePath(value)) return
  selected.value = null
  pendingPathFocus.value = true
  emit('update:pathId', value)
}

/** 加载结束（loading 落沿）后把焦点还回路径下拉；宿主不切加载态时不会误落焦点 */
watch(() => props.loading, (now, prev) => {
  if (now || !prev || !pendingPathFocus.value) return
  pendingPathFocus.value = false
  void nextTick(() => pathpickEl.value?.querySelector<HTMLElement>('[role="combobox"]')?.focus())
})

/* ---------- 层级筛选（本地）：节点筛掉后，两端不齐的边也一并筛掉 ---------- */

const levelNodes = computed(() =>
  level.value === 'all' ? props.nodes : props.nodes.filter((n) => (n.level ?? 'kc') === level.value)
)
const levelEdges = computed(() => {
  if (level.value === 'all') return props.edges
  const ids = new Set(levelNodes.value.map((n) => n.id))
  return props.edges.filter((e) => ids.has(e.fromConceptId) && ids.has(e.toConceptId))
})

/** 读屏清单与画布同口径：MkGraph 内部只裁「未评估的孤立点」（有掌握度读数的孤立
 *  概念会画出来，2026-10-31 二轮评审），清单复制同一条规则——「图上看不到的概念」
 *  不出现在读屏清单里，两套信息不互相矛盾 */
const listNodes = computed(() => {
  if (!hideIsolated.value) return levelNodes.value
  const connected = new Set<string>()
  for (const e of levelEdges.value) {
    connected.add(e.fromConceptId)
    connected.add(e.toConceptId)
  }
  const kept = levelNodes.value.filter(
    (n) => connected.has(n.id) || (n.masteryScore !== null && n.masteryScore !== undefined)
  )
  return kept.length > 0 ? kept : levelNodes.value
})

/** 掌握度读屏文案与侧栏同口径（百分比）：raw 0-1 小数直接念出来很难懂 */
function masteryText(n: MkGraphNode): string {
  return n.masteryScore === null || n.masteryScore === undefined
    ? '未知'
    : `${Math.round(n.masteryScore * 100)}%`
}

/* ---------- 掌握状态四档（统计 / 徽章 / 图例共用一个口径） ---------- */

/** 四档名走 utils/conceptBands 单源：管理台学习者的「概念信号」行读同一份，
 *  同一批概念不再一处叫「进行中」一处叫「挣扎」 */
type StatusKey = ConceptBandKey

/** 徽章色跟随画布着色（MkGraph.colorOf 同为绿/琥珀/红/中性灰）：图例教的色必须是图里画的色 */
const STATUS_BADGE: Record<StatusKey, string> = {
  stable: 'mk-badge--ok',
  learning: 'mk-badge--warn',
  fragile: 'mk-badge--bad',
  unknown: 'mk-badge--muted',
}

/** 与画布着色同一套阈值（四档名见 utils/conceptBands），避免"图上红一片、统计说都好" */
function statusKeyOf(node: MkGraphNode | null): StatusKey {
  if (!node || node.masteryScore === null || node.masteryScore === undefined) return 'unknown'
  if (node.stability === 'fragile' || node.masteryScore < 0.45) return 'fragile'
  if (node.stability === 'stable' || node.masteryScore >= 0.8) return 'stable'
  return 'learning'
}

/** 记忆强度枚举（后端 MemoryStability: unknown|fragile|developing|stable）→ 用户可读。
    2026-10-31 走查 P1-8：此前把 developing 原样渲染成英文小写，和旁边的中文「知识组件」并排。 */
const STABILITY_LABEL: Record<string, string> = {
  stable: '稳固',
  developing: '形成中',
  fragile: '较弱',
  unknown: '尚未形成',
}

/* 统计口径 = 画布可见节点（2026-10-31 外部评审 P2-4）：此前按全部概念计数，而孤立概念被
   「显示无关联的概念」默认过滤、画布上看不见——「🟡进行中 1」永远找不到黄点。改与画布
   同一可见集（listNodes 已实现 hideIsolated 同款规则），图例教的色就是图里画的色；
   「N 个概念」仍报全量，隐藏的孤立点由画布下方披露行说明。 */
const counts = computed(() => {
  const out = { stable: 0, learning: 0, fragile: 0, unknown: 0 }
  for (const n of listNodes.value) out[statusKeyOf(n)] += 1
  return out
})

/** 未选中节点时的侧栏建议：先弱后生，最多 5 个；已掌握的不再占位。
 *  同 counts 收窄到画布可见集——推荐一个画布上看不见、点了没反应的节点是死建议。 */
const suggestedNodes = computed(() =>
  [...listNodes.value]
    .filter((n) => statusKeyOf(n) !== 'stable')
    .sort((a, b) => (a.masteryScore ?? 0) - (b.masteryScore ?? 0))
    .slice(0, 5)
)

const selectedStatus = computed(() => {
  const key = statusKeyOf(selected.value)
  return { key, label: CONCEPT_BAND_LABEL[key], badge: STATUS_BADGE[key] }
})

/** 选中节点的概念台账事实：按概念名索引（台账 conceptKey 就是概念名），
 *  空名/缺索引一律返回 null —— 宁可不渲染这三行，也不拿别的概念的读数顶上 */
const selectedFacts = computed<MkGraphConceptFacts | null>(() => {
  const label = selected.value?.label?.trim()
  if (!label) return null
  return props.conceptFacts[label] ?? props.conceptFacts[label.replace(/\s+/g, ' ')] ?? null
})

/* ---------- 节点详情：掌握程度两条 bar + 到期复习说明 ---------- */

/**
 * 第二条 bar 的刻度：10 次提取视为练熟（展示用上限）。
 * concept-graph 节点只带 masteryScore / extractionCount / lastSeenAt，没有「练习正确率」字段，
 * 所以第二行走次数（label 显示「N 次」），不编造百分比。
 */
const PRACTICE_FULL_EXTRACTS = 10

const masteryPct = computed(() => {
  const score = selected.value?.masteryScore
  if (score === null || score === undefined) return null
  return Math.round(Math.min(1, Math.max(0, score)) * 100)
})
const masteryWidth = computed(() => (masteryPct.value === null ? '0%' : `${masteryPct.value}%`))
const masteryTextSelected = computed(() => (masteryPct.value === null ? '未评估' : `${masteryPct.value}%`))
const practiceCount = computed(() => selected.value?.extractionCount ?? 0)
const practiceWidth = computed(
  () => `${Math.round(Math.min(1, practiceCount.value / PRACTICE_FULL_EXTRACTS) * 100)}%`
)

/** 最近一次练习距今几天（无效日期返回 null） */
function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return null
  return Math.max(0, Math.floor((Date.now() - time) / 86400000))
}

/**
 * 到期复习说明（原型抽屉「出现在 N 节课里 · 下次到期复习在 2 天后」）：
 * 本接口不返回 dueAt/课程数，只按已有字段说清复习节奏，不编造到期日。
 */
const reviewNote = computed(() => {
  const node = selected.value
  if (!node) return ''
  const count = node.extractionCount ?? 0
  if (count === 0) return '还没有练习记录 · 学完一节课后会自动排入复习队列'
  const since = daysSince(node.lastSeenAt)
  const recent = since === null ? '' : since <= 0 ? ' · 最近一次在今天' : since === 1 ? ' · 最近一次在昨天' : ` · 最近一次在 ${since} 天前`
  return `已练习 ${count} 次${recent} · 复习按记忆节奏自动排期`
})

/* ---------- 图例线样式与画布边线同源 ---------- */

const labelById = computed(() => new Map(props.nodes.map((n) => [n.id, n.label])))

/** 图例线样式与画布边线同源（relationStyleOf 按 theme 出色）：此前图例写死 --mk-blue，
 *  画布实际是 #7a8ba6，图例教的颜色和图里画的不是同一个 */
/* 主题跟随（2026-10-06 审核）：默认原为写死 'light'，不跟随 <html data-theme>——
   图例线色（relationStyleOf 按 dark 出色）会与画布不一致。与 MkGraph/MkChart 同款。 */
const isDark = useIsDark()
const resolvedTheme = computed<'light' | 'dark'>(() => props.theme ?? (isDark.value ? 'dark' : 'light'))

const legendLines = computed(() => {
  const dark = resolvedTheme.value === 'dark'
  return {
    prereq: relationStyleOf('prerequisite', dark),
    part: relationStyleOf('part_of', dark)
  }
})

/**
 * 选中节点的关系分组。方向语义（实测标定）：
 * prerequisite 是 `from=前置 → to=后继`；part_of 是 `from=知识组件 → to=核心概念`。
 */
const relationGroups = computed(() => {
  const node = selected.value
  if (!node) return [] as Array<{ label: string; items: Array<{ id: string; label: string }> }>
  const incoming: Array<{ id: string; label: string }> = []
  const members: Array<{ id: string; label: string }> = []
  const successors: Array<{ id: string; label: string }> = []
  for (const edge of props.edges) {
    const other = edge.fromConceptId === node.id ? edge.toConceptId
      : edge.toConceptId === node.id ? edge.fromConceptId : null
    if (!other) continue
    const label = labelById.value.get(other) ?? other
    const isFrom = edge.fromConceptId === node.id
    if (edge.relation === 'prerequisite') {
      (isFrom ? successors : incoming).push({ id: other, label })
    } else {
      // part_of 两端一为知识组件、一为核心概念，无论方向都归到"所属/包含"
      members.push({ id: other, label })
    }
  }
  return [
    { label: '前置（需先掌握）', items: incoming },
    { label: '后继（以本概念为前置）', items: successors },
    { label: '所属/包含', items: members },
  ].filter((group) => group.items.length > 0)
})

/* ---------- 交互 ---------- */

function focusNode(id: string) {
  const node = props.nodes.find((n) => n.id === id) ?? null
  selected.value = node
  emit('select', node)
}

function onIsolatedChange(event: Event) {
  hideIsolated.value = !(event.target as HTMLInputElement).checked
}

function onRetry() {
  emit('retry')
}

function onEmptyAction() {
  emit('empty-action')
}

function onPractice() {
  if (selected.value) emit('practice', selected.value)
}
</script>

<style scoped>
.mk-ge {
  display: flex;
  flex-direction: column;
  gap: var(--mk-space-3);
}
/* 整屏三态容器：骨架三段纵向堆叠，空/错态由 V2ResultState 自带 46px 留白 */
.mk-ge__state {
  display: grid;
  gap: var(--mk-space-3);
}
/* 骨架中段占位块（原型 wf-skel__bar--xl 的画布块）：不做 shimmer，条形占位由 SkeletonLoader 承担 */
.mk-ge__skel-graph {
  border-radius: var(--mk-radius-modal);
  background: color-mix(in srgb, var(--line) 55%, var(--surface));
}
/* 路径切换：单个下拉（§5 2026-11-06 定稿），与统计、视图筛选同在 .mk-ge__bar 一栏左端。
   flex 基准 320px：路径名再长也只在触发器里省略；路径条数再多也只是列表长一点。
   平铺胶囊轨 / 「更多（N）」浮层 / 两端渐隐 / 横滚定位（scroll-margin）一套随之删除——
   同一件事（切换路径）在全站只留一个控件。 */
.mk-ge__pathpick {
  flex: 0 1 320px;
  min-width: 0;
  max-width: 100%;
}
/* 单路径时的静态归属标签（2026-11-07 走查 图4）：与下拉同一格、同一高度基线，
   但不是控件——没有可选项（1 条路径），做成下拉会是假控件。
   标题超长省略，不挤中间统计与右侧筛选。 */
.mk-ge__pathonly {
  flex: 0 1 320px;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 13px;
  line-height: 1.6;
}
.mk-ge__pathonly-label { flex: 0 0 auto; color: var(--faint); font-size: 12px; }
.mk-ge__pathonly strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ink);
  font-weight: 700;
}
/* 图卡内层：壳（border / radius / 10px 10px 4px padding）由宿主出，这里只排版 */
.mk-ge__card {
  display: flex;
  flex-direction: column;
  gap: var(--mk-space-3);
  min-width: 0;
}
.mk-ge__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--mk-space-3);
}
/* 窄屏（≤1100）：下拉整行铺开——390 档统计/视图筛选本来就会换行，
   下拉自己一行，不再被压成一条缝（旧轨在这里还会占 44px 高 + 横滚） */
@media (max-width: 1100px) {
  .mk-ge__pathpick { flex: 1 1 100%; }
  /* 单路径静态标签同样整行铺开，与下拉同一断点行为 */
  .mk-ge__pathonly { flex: 1 1 100%; }
}
.mk-ge__stats {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--mk-space-3);
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
}
.mk-ge__stat b {
  color: inherit;
  font-weight: 600;
}
.mk-ge__stat i {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: var(--mk-space-1);
  border-radius: var(--mk-radius-pill);
  vertical-align: middle;
}
.mk-ge__stat--ok i { background: var(--mk-green); }
.mk-ge__stat--mid i { background: var(--mk-amber); }
.mk-ge__stat--weak i { background: var(--mk-red); }
.mk-ge__stat--none i { background: var(--mk-line); }
.mk-ge__controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--mk-space-3);
}
input[type='checkbox'] { width: 18px; height: 18px; accent-color: var(--blue); }
.mk-ge__seg {
  display: inline-flex;
  overflow: hidden;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-sm);
}
.mk-ge__seg-btn {
  /* §1（2026-11-06）：卡内控件收敛到 32px 高（30~34 档），不再靠 4px 内衬凑出 27px 的矮条 */
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 0 var(--mk-space-3);
  border: 0;
  background: transparent;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
  cursor: pointer;
}
.mk-ge__seg-btn--on {
  background: var(--mk-surface-2);
  color: inherit;
  font-weight: 600;
}
.mk-ge__check {
  display: inline-flex;
  align-items: center;
  gap: var(--mk-space-1);
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
  cursor: pointer;
}
.mk-ge__body {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: var(--mk-space-4);
  /* 2026-11-05 PC 走查改回 stretch：用户点名概览卡「像块膏药」——短卡浮在画布右上，
     下面空一截。侧栏作为独立栏与画布等高（stretched），空白由栏内 flex 布局吸收；
     内容仍然顶对齐，不强行居中。 */
  align-items: stretch;
}
/* 收起侧栏（2026-11-06 走查）：单栏后画布吃满卡宽，100% 全屏看图 */
.mk-ge__body--full { grid-template-columns: minmax(0, 1fr); }
.mk-ge__body--full .mk-ge__side { display: none; }
.mk-ge__canvas {
  position: relative;
  min-width: 0;
}
.mk-ge__legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--mk-space-4);
  margin-top: var(--mk-space-2);
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
}
.mk-ge__legend-group {
  display: inline-flex;
  align-items: center;
  gap: var(--mk-space-1);
  /* 组内禁折行（2026-11-05 UX 审计）：402px 视口下「属于（知识组件 → 核心概念）」
     曾被拆成「核心概/念）」断在括号中间、符号悬在行首（截图实证）。外层 .mk-ge__legend
     已有 flex-wrap，整组放不下时作为整体换行，组内文字不再词中拆断 */
  white-space: nowrap;
}
/* .mk-ge__dot* 已删（2026-11-05 PC 走查）：四档状态点从底图例撤除后无引用，
   状态色点只剩画布头统计行自己的 <i>（.mk-ge__stat 系） */
.mk-ge__line {
  display: inline-block;
  width: 22px;
  height: 0;
  border-top-width: 2px;
}
/* 线色不再写死在 CSS：图例与画布同源取 relationStyleOf（见 script legendLines） */
.mk-ge__legend-hint {
  display: block;
  opacity: 0.8;
}
/* 窄屏密集图不常显标签（见 MkGraph labelWorthy），补一句操作提示，避免用户以为图没名字 */
.mk-ge__legend-tap { display: none; white-space: nowrap; }
.mk-ge__legend-mobile { display: none; }
@media (max-width: 900px) {
  .mk-ge__legend-desktop { display: none; }
  .mk-ge__legend-mobile { display: inline; }
  .mk-ge__legend-tap { display: inline; }
}
/* 画布角落缩放控件（+ / - / ⟲）：38px 方钮竖排贴右下角图例上方 */
.mk-ge__zoom {
  position: absolute;
  right: 10px;
  bottom: 40px;
  z-index: 5;
  display: grid;
  gap: 4px;
}
.mk-ge__zoom-btn {
  width: 32px; height: 32px;
  display: grid; place-items: center;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-sm);
  background: var(--mk-surface);
  color: var(--mk-muted);
  cursor: pointer;
  box-shadow: var(--mk-shadow-sm);
}
.mk-ge__zoom-btn:hover { color: var(--mk-ink); border-color: color-mix(in srgb, var(--mk-blue) 40%, var(--mk-line)); }
/* 收起态：画布右上角的展开钮 */
.mk-ge__side-reopen {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 5;
  min-height: 26px;
  padding: 2px 10px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-sm);
  background: var(--mk-surface);
  color: var(--mk-muted);
  font: inherit;
  font-size: var(--mk-fs-micro);
  cursor: pointer;
  box-shadow: var(--mk-shadow-sm);
}
.mk-ge__side-reopen:hover { color: var(--mk-ink); border-color: color-mix(in srgb, var(--mk-blue) 40%, var(--mk-line)); }
/* 侧栏标题行（2026-11-07 走查）：标题占弹性宽、按钮固定宽——长标题在自己的轨道里
   折行，不再钻到按钮底下。标题行下距由行容器统一出（原挂在 h4 上）。 */
.mk-ge__side-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: var(--mk-space-2);
}
.mk-ge__side-title {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: var(--mk-fs-body);
  line-height: 1.5;
  word-break: break-word;
}
/* 侧栏收起/展开开关：标题行右端，固定尺寸不随标题挤压 */
.mk-ge__side-toggle {
  flex: none;
  width: 26px; height: 26px;
  display: grid; place-items: center;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-sm);
  background: var(--mk-surface);
  color: var(--mk-muted);
  cursor: pointer;
  font-size: 13px; line-height: 1;
}
.mk-ge__side-toggle:hover { color: var(--mk-ink); border-color: color-mix(in srgb, var(--mk-blue) 40%, var(--mk-line)); }
.mk-ge__side {
  position: relative;
  padding: var(--mk-space-3);
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-md);
  background: var(--mk-surface);
  /* 2026-11-05 PC 走查：随 stretch 拉满画布行高（用户点名「与画布等高」），
     flex 列让详情态的内容自然从上往下排；概览态内容少时卡内留白交给栏本身，
     不再像短卡浮在画布旁。此前 height:100% 拔高的顾虑随「概览即首页」设计一并翻案。 */
  display: flex; flex-direction: column;
  min-height: 0;
  box-sizing: border-box;
}
/* 标题下的一行：状态徽章（原型 wf-badge）+ 分类副标题（原型 wf-drawer__sub 位） */
.mk-ge__side-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--mk-space-2);
  margin-bottom: var(--mk-space-3);
}
.mk-ge__side-sub {
  margin: 0;
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
}
/* 状态小签（§1 2026-11-06）：图谱里出现的状态标签（侧栏「进行中/记忆偏弱/…」、
   概览建议行的同款）是非点击类标签，不再用 .mk-badge 默认的 999px 大胶囊 + 2px 8px
   内衬。收敛为 20px 高小方签、1px 6px 内衬、4px 方角、无描边；底色仍走
   .mk-badge--ok/warn/bad/muted 的柔和半透明档（色语义不动）。
   注：这是本组件内的局部收敛（原语层 .mk-badge 归全局样式组，已在报告里提为全局项）。 */
.mk-ge .mk-badge {
  height: 20px;
  padding: 1px 6px;
  border: 0;
  border-radius: var(--mk-radius-xs);
  font-weight: 600;
}
.mk-ge__side-hint {
  margin: 0;
  font-size: var(--mk-fs-micro);
  line-height: 1.6;
  color: var(--mk-muted);
}
/* 未选中态的概览：建议入口清单（分布计数画布头图例已有，不再重复呈现） */
.mk-ge__overview {
  display: grid;
  /* minmax(0,1fr)：auto 轨会被 nowrap 概念名的 max-content 撑到卡外（2026-11-03 真机：
     24 字生成名把 254px 面板撑到 322px，里层的省略号永远轮不到生效），显式收窄轨道 */
  grid-template-columns: minmax(0, 1fr);
  gap: var(--mk-space-3);
  align-content: start;
}
.mk-ge__overview-label {
  margin: 0;
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  color: var(--mk-muted);
}
.mk-ge__overview-list {
  display: grid;
  /* 单列轨道按容器宽收窄：默认 auto 轨道 + li 的 min-width:auto 按 min-content 撑宽，
     长概念名与右侧 nowrap 徽章一起把整个行盒顶出侧栏，右端徽章正好落在卡片裁切边界上
     被切掉（2026-11-02 P2-6） */
  grid-template-columns: minmax(0, 1fr);
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}
/* li 自己也要 min-width:0：父级轨道收了，但 grid item 的 min-width:auto 仍会按内容
   把行盒撑回 min-content 宽（只把 min-width:0 加在下面那个标签 span 上约束不住它） */
.mk-ge__overview-list > li {
  min-width: 0;
}
.mk-ge__overview-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mk-space-2);
  width: 100%;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: var(--mk-radius-md);
  background: none;
  color: var(--mk-ink);
  font: inherit;
  font-size: var(--mk-fs-micro);
  text-align: left;
  cursor: pointer;
}
.mk-ge__overview-item:hover {
  border-color: var(--mk-line);
  background: var(--mk-surface-2);
}
.mk-ge__overview-item > span:first-child {
  min-width: 0;
  /* 换行代替省略号（2026-11-04 溢出走查）：25 字概念名（「结果义与过去事件义的区分决定
     完成时与过去时的取舍」）在 232px 窄栏里被 nowrap+ellipsis 截成「结果义与过去事件义
     的区分决定完成时…」，同一条在详情卡里是全名——列表是导航入口，截断后长名无从区分。
     min-width:0 保留：否则 flex item 按 min-content 撑宽，外层 minmax(0,1fr) 也压不住。 */
  overflow-wrap: anywhere;
}
/* 状态徽章是固定两字，不能被长概念名挤成「待学 / 习」 */
.mk-ge__overview-item > .mk-badge {
  flex: 0 0 auto;
  white-space: nowrap;
}
/* 掌握程度卡（原型 wf-card + wf-card__head：strong 标题 / 12px「近 30 天」meta） */
.mk-ge__mastery {
  padding: 12px 14px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-xl);
  background: var(--mk-surface-2);
}
.mk-ge__mastery-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--mk-space-2);
}
.mk-ge__mastery-head strong {
  font-size: var(--mk-fs-body);
  font-weight: 700;
}
.mk-ge__mastery-head span {
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
}
.mk-ge__mastery-list {
  display: grid;
  gap: var(--mk-space-2);
  margin: var(--mk-space-2) 0 0;
  padding: 0;
  list-style: none;
}
.mk-ge__fact--warn { color: var(--mk-amber); }
.mk-ge__fact--bad { color: var(--mk-red); }
.mk-ge__mastery-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--mk-space-2);
}
.mk-ge__mastery-name,
.mk-ge__mastery-pct {
  font-size: var(--mk-fs-micro);
}
.mk-ge__mastery-name { color: var(--mk-muted); }
.mk-ge__mastery-pct {
  color: var(--mk-ink);
  font-variant-numeric: tabular-nums;
}
/* 两条 bar 用原型 .wf-bar 语言：6px、轨道 = line 60%、填充 = 蓝→青渐变 */
.mk-ge__meter {
  height: 6px;
  overflow: hidden;
  border-radius: var(--mk-radius-pill);
  background: color-mix(in srgb, var(--line) 60%, transparent);
}
.mk-ge__meter i {
  display: block;
  height: 100%;
  border-radius: var(--mk-radius-pill);
  background: linear-gradient(90deg, var(--blue), var(--cyan));
  transition: width 0.3s ease;
}
.mk-ge__review {
  margin: var(--mk-space-3) 0 0;
  font-size: var(--mk-fs-micro);
  line-height: 1.6;
  color: var(--mk-faint);
}
/* 动作区（原型 wf-drawer__acts 收敛：ghost「先放着」已于 2026-10-09 删除，只剩主 CTA） */
.mk-ge__acts {
  display: grid;
  gap: var(--mk-space-2);
  margin-top: var(--mk-space-3);
}
.mk-ge__cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* §1（2026-11-06）卡内嵌按钮：高度收敛到 32px（30~34 档）、同心圆角 8px
     （旧为 44px 高 + 16px 圆角的大胶囊）、字号走 micro（12~13 档）。触屏档在
     ≤900 媒体块里单独抬回 36（mobile:spec 的 lt36 硬下沿）。 */
  min-height: 32px;
  padding: 0 14px;
  border-radius: var(--mk-radius-md);
  font: inherit;
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease, color 0.16s ease;
}
.mk-ge__cta {
  border: 1px solid transparent;
  /* 批次 D（2026-10-02）：135deg 渐变底 + 蓝色外发光 → 纯色友好蓝、无投影。
     规范：「主操作为纯色友好蓝 #2f6ae0，不再使用渐变」「禁止彩色光晕」。
     白字对 #2f6ae0 的对比度为 4.93:1，达 WCAG AA，故去掉深蓝端不损可读性。 */
  background: var(--blue);
  color: var(--mk-on-fill);
}
.mk-ge__cta:active { transform: scale(0.98); }
/* 读屏等价清单：整段钉在页面既有字号档（micro）上——h4/ul 的浏览器默认字号
   会给 mobile:spec 的 steps 档数 +1，而视觉隐藏的清单字号无视觉意义 */
.mk-ge__inventory {
  font-size: var(--mk-fs-micro);
}
.mk-ge__inventory h4,
.mk-ge__inventory ul,
.mk-ge__inventory li {
  margin: 0;
  padding: 0;
  font-size: var(--mk-fs-micro);
  list-style: none;
}
/* 概览字段分区：2 格条带（dt 标签在上、值在下），和 badge 同用 surface-3 条带底，
   暗色比卡片亮一档（admin 表格体系同口径） */
.mk-ge__kv {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--mk-space-1);
  margin: var(--mk-space-3) 0 0;
}
.mk-ge__cell {
  padding: 5px 9px 6px;
  border-radius: var(--mk-radius-sm, 8px);
  background: var(--mk-surface-3);
}
.mk-ge__cell dt {
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
}
.mk-ge__cell dd {
  margin: 1px 0 0;
  font-size: var(--mk-fs-body);
  font-weight: 700;
}
/* 关系分区：每组一条发丝线起头 + 组名加计数，三个组（前置/后继/所属）扫一眼可分 */
.mk-ge__rel {
  margin-top: var(--mk-space-3);
  padding-top: var(--mk-space-3);
  border-top: 1px solid var(--mk-line);
}
.mk-ge__rel-label {
  margin: 0 0 var(--mk-space-1);
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  color: var(--mk-muted);
}
.mk-ge__rel-label b {
  margin-left: 5px;
  font-weight: 600;
  color: var(--mk-blue);
}
.mk-ge__rel-list {
  margin: 0;
  padding: 0;
  list-style: none;
  /* 双列网格（2026-11-05 屏效比）：前置/后继各有 6 条时逐条整行拉成 12 行——
     概念名多为 6~9 字，两列并排高度直接减半；触控盒不变（item 仍 padding 10/7） */
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 6px;
}
.mk-ge__rel-item {
  display: block;
  width: 100%;
  /* 热区（2026-11-05 UX 审计 P1）：micro 字号 + 3px 上下距实测整行仅 24px，低于 36px
     触屏门禁；关联概念行是详情卡内唯一的继续导航（6 行实测），误触即跳错概念。
     上下 padding 抬到 10px → 命中高 ≈37px 达标，微字号视觉密度不变。 */
  padding: 10px 7px;
  border: 0;
  border-radius: var(--mk-radius-sm, 8px);
  background: transparent;
  color: inherit;
  font-size: var(--mk-fs-micro);
  line-height: 1.5;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.mk-ge__rel-item:hover {
  background: var(--mk-surface-3);
  color: var(--mk-blue);
}
@media (max-width: 900px) {
  .mk-ge__body {
    grid-template-columns: minmax(0, 1fr);
  }
  /* 图例后多留 32px：首屏底边原先正好切在「图谱概览」标题腰部，只露出半截字。
     把下一张卡整体推到首屏之外，避免假半截卡；滚动后卡片完整出现。 */
  .mk-ge__canvas { padding-bottom: calc(var(--mk-space-2) + 24px); }
  /* 窄屏原本在此把 .mk-ge__side 的 height 覆回 auto（对抗桌面 100%）；桌面 100% 已删
     （2026-11-04），此覆写失去对象，一并删去。 */
  /* 视图分段控件（全部/核心概念/知识组件）桌面 32px，触屏抬到 36（mobile:spec lt36） */
  .mk-ge__seg-btn {
    min-height: 36px;
    display: inline-flex;
    align-items: center;
    padding: 0 var(--mk-space-3);
  }
  /* 「显示无关系的概念」是一行 label + 原生 18px checkbox：点 label 任意处都能切换，
     所以手势目标是 label 本身——它原来只有 ~19px 高，补齐到 36（mobile:spec 按 label 量） */
  .mk-ge__check { min-height: 36px; }
  /* 节点详情主 CTA 桌面 32px（§1 卡内按钮档），触屏抬回 36（mobile:spec lt36 硬下沿） */
  .mk-ge__cta { min-height: 36px; }
}
</style>
