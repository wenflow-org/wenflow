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
      <!-- 路径筛选：原型 wf-rail + wf-chip，独立一行落在图卡上方（与 .wf-graph 兄弟，不在工具条里）。
           role="radiogroup" + roving tabindex：Tab 只落当前选中项，方向键/Home/End 在轨道内换选。
           轨道**有界**（见 RAIL_VISIBLE_PATHS）：路径多了收进右侧「更多（N）」浮层，
           「更多」在轨外不参与横滚，永远停在最右可达。 -->
      <div v-if="paths.length > 1" class="mk-ge__railrow">
        <div
          ref="railEl"
          class="mk-ge__rail"
          :class="{ 'mk-ge__rail--fade-l': railFadeLeft, 'mk-ge__rail--fade-r': railFadeRight }"
          role="radiogroup"
          aria-label="按学习路径筛选"
          @scroll.passive="syncRail"
        >
          <button
            v-for="opt in railOptions"
            :key="opt.value ?? 'all'"
            type="button"
            role="radio"
            class="mk-ge__chip"
            :class="{ 'mk-ge__chip--on': isActivePath(opt.value) }"
            :aria-checked="isActivePath(opt.value)"
            :tabindex="isActivePath(opt.value) ? 0 : -1"
            @click="selectPath(opt.value)"
            @keydown="onRailKeydown($event, opt.value)"
          >{{ opt.label }}</button>
        </div>

        <!-- 「更多」：轨外的出口，收当前轨上放不下的路径。role=menu + menuitemradio：
             与轨上 chip 同为单选语义，只是换了个容器。 -->
        <div v-if="overflowPathOptions.length" ref="moreWrapEl" class="mk-ge__more">
          <button
            ref="moreTriggerEl"
            type="button"
            class="mk-ge__chip mk-ge__chip--more"
            :class="{ 'mk-ge__chip--on': moreOpen }"
            :aria-expanded="moreOpen"
            aria-haspopup="menu"
            @click.stop="toggleMore"
          >
            更多（{{ overflowPathOptions.length }}）<ChevronDown :size="14" aria-hidden="true" />
          </button>
          <div
            v-if="moreOpen"
            ref="morePanelEl"
            class="mk-ge__more-panel"
            role="menu"
            aria-label="其余学习路径"
            @keydown="onMorePanelKeydown"
          >
            <button
              v-for="opt in overflowPathOptions"
              :key="opt.value"
              type="button"
              role="menuitemradio"
              class="mk-ge__more-item"
              :class="{ 'mk-ge__more-item--on': isActivePath(opt.value) }"
              :aria-checked="isActivePath(opt.value)"
              :tabindex="isActivePath(opt.value) ? 0 : -1"
              @click="pickOverflow(opt.value)"
            >{{ opt.label }}</button>
          </div>
        </div>
      </div>

      <!-- 图卡：卡壳（border / radius / padding 10px 10px 4px）由宿主出——
           页面走 .km__card :deep(.mk-ge__card)，admin 嵌在 .mk-card 里不再套一层 -->
      <div class="mk-ge__card">
        <!-- 工具条：左统计、右视图筛选。统计口径与画布着色一致（待学习 / 记忆偏弱 / 进行中 / 已掌握） -->
        <div class="mk-ge__bar">
          <div class="mk-ge__stats">
            <span class="mk-ge__stat"><b>{{ levelNodes.length }}</b> 个概念</span>
            <span class="mk-ge__stat"><b>{{ levelEdges.length }}</b> 条关系</span>
            <span class="mk-ge__stat mk-ge__stat--ok"><i />已掌握 <b>{{ counts.stable }}</b></span>
            <span class="mk-ge__stat mk-ge__stat--mid"><i />进行中 <b>{{ counts.learning }}</b></span>
            <span class="mk-ge__stat mk-ge__stat--weak"><i />记忆偏弱 <b>{{ counts.fragile }}</b></span>
            <span class="mk-ge__stat mk-ge__stat--none"><i />待学习 <b>{{ counts.unknown }}</b></span>
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

        <div class="mk-ge__body">
          <div class="mk-ge__canvas">
            <MkGraph
              :nodes="levelNodes"
              :edges="levelEdges"
              :theme="resolvedTheme"
              :height="height"
              :hide-isolated="hideIsolated"
              @select="selected = $event"
            />
            <!-- 图例走 DOM：画布内图例在 graph 系列里会误导（categories 是节点分组，不是关系） -->
            <div class="mk-ge__legend">
              <span class="mk-ge__legend-group">
                <i class="mk-ge__dot mk-ge__dot--ok" />已掌握
                <i class="mk-ge__dot mk-ge__dot--mid" />进行中
                <i class="mk-ge__dot mk-ge__dot--weak" />记忆偏弱
                <i class="mk-ge__dot mk-ge__dot--none" />待学习
              </span>
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
              <span class="mk-ge__legend-group mk-ge__legend-hint">圆点=核心概念 · 方块=知识组件 · 拖动/滚轮可缩放</span>
            </div>
          </div>

          <!-- 侧栏详情随画布点选切换，对读屏是「远端变更」→ polite 播报摘要
               （画布的完整 AT 等价清单见下方 sr-only 概念清单——2026-09-27 a11y 走查，P2 收尾落地） -->
          <aside class="mk-ge__side" aria-live="polite">
            <template v-if="selected">
              <!-- 标题 + 状态徽章（原型抽屉：h + wf-badge） -->
              <h4 class="mk-ge__side-title">{{ selected.label }}</h4>
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

              <!-- 主 CTA + ghost（原型 wf-drawer__acts：去练习这个知识点 / 先放着） -->
              <div v-if="practiceActionText" class="mk-ge__acts">
                <button type="button" class="mk-ge__cta" @click="onPractice">{{ practiceActionText }}</button>
                <button type="button" class="mk-ge__ghost" @click="dismissSelected">先放着</button>
              </div>

              <!-- 字段分区（2026-09-27）：概览条带 + 关系分区（发丝线分隔）；掌握度/提取次数已由上方 bar 承载 -->
              <dl class="mk-ge__kv">
                <div class="mk-ge__cell"><dt>层级</dt><dd>{{ selected.level === 'concept' ? '核心概念' : '知识组件' }}</dd></div>
                <div class="mk-ge__cell"><dt>稳定性</dt><dd>{{ selected.stability || '—' }}</dd></div>
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
            <p v-else class="mk-ge__side-hint">点图中任意节点，这里显示它的掌握度与前后关系。</p>
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
 *  ② 空/错/骨架三态改整屏形态（V2ResultState + SkeletonLoader，替换 rail 与图卡）；
 *  ③ 节点详情补原型抽屉的内容结构：状态徽章 / 掌握程度两条 bar / 复习说明 / 主 CTA + ghost。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ChevronDown } from 'lucide-vue-next'
import MkGraph, { relationStyleOf } from './MkGraph.vue'
import { useIsDark } from '@/composables/useIsDark'
import type { MkGraphEdge, MkGraphNode } from './MkGraph.vue'
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
  }>(),
  {
    paths: () => [],
    pathId: null,
    theme: undefined,
    height: '520px',
    loading: false,
    error: null,
    emptyHint: '还没有概念图数据——路径生成后 kc-mapper 会产出前置依赖，随概念身份注册表物化进图。',
    errorActionText: '',
    emptyActionText: '',
    practiceActionText: '',
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

/* ---------- 路径筛选轨（原型 wf-rail + wf-chip） ---------- */

/**
 * 轨上最多并排几条路径 chip（不含「全部路径」与「更多」）。
 *
 * 为什么要有上限（2026-10-05 实测，wfprobe1 账号 10 条路径，1440 视口）：
 * 轨道可视宽 1140px、内容宽 2390px（溢出 2.1 倍），11 枚 chip 里只有 5 枚完整可见，
 * 最后一枚右缘 2538px 而轨道右缘 1290px —— 1248px 的内容在屏幕外。而轨道
 * `scrollbar-width: none` + `::-webkit-scrollbar{display:none}` 把滚动条显式抹掉了，
 * 也没有渐隐/箭头，鼠标用户根本看不出后面还有 5 条路径。路径数只会涨（每生成一条
 * 新目标就多一条），所以轨必须有界，不能靠「反正能横滚」兜着。
 *
 * 为什么是 3（实测布局值，注意 v2 页在 ≥1600 有 zoom 档，量宽要在同一坐标系里比）：
 * 桌面轨布局宽恒为 1024px（`.km__main` 封顶 1180 − 卡内边距 −「更多」108 − 间隙 8），
 * chip 上限 260px、实测「全部路径（10 条）」140px。最坏情况（标题全部顶到上限）
 * 3 枚 = 140 + 3×260 + 3×8 + 4 = 948 ≤ 1024，留 76px 余量；**4 枚最坏 1216 > 1024**，
 * 必然横滚——实测 10 条路径时铺 4 枚正是溢出 33px、第 4 枚被裁一半。
 */
const RAIL_VISIBLE_PATHS = 3
/** 溢出到「更多」的路径少于 2 条时不值得开浮层：多铺一枚 chip 比多一次点击便宜 */
const RAIL_MIN_OVERFLOW = 2

type PathOption = { value: string | null; label: string }
/** 路径条目（value 必为 id）：可见集合与「更多」浮层都只装路径，不含「全部路径」 */
type PathFilterOption = { value: string; label: string }

/** 轨上恒定的第一枚：全部路径（它是「看全貌」的出口，不参与收纳） */
const allPathOption = computed<PathOption>(() => ({
  value: null,
  label: props.paths.length > 1 ? `全部路径（${props.paths.length} 条）` : '全部路径',
}))

const pathOnlyOptions = computed<PathFilterOption[]>(() =>
  props.paths.map((p) => ({ value: p.id, label: p.title || p.id }))
)

/** 路径多到轨上放不下（且溢出值得开浮层）时收「更多」 */
const railBounded = computed(
  () => pathOnlyOptions.value.length - RAIL_VISIBLE_PATHS >= RAIL_MIN_OVERFLOW
)

/** 当前选中路径在列表里的下标（-1 = 选的是「全部路径」，或选中项不在列表里） */
const activePathIndex = computed(() =>
  pathOnlyOptions.value.findIndex((opt) => isActivePath(opt.value))
)

/**
 * 轨上真正铺开的路径。有界时取前 N 条；**若当前选中项不在这 N 条里，用它顶掉第 N 条**——
 * 否则选中态会掉进「更多」，轨上没有任何 chip 是选中态，用户看不出自己在哪条路径上。
 */
const visiblePathOptions = computed<PathFilterOption[]>(() => {
  const all = pathOnlyOptions.value
  if (!railBounded.value) return all
  const index = activePathIndex.value
  if (index < RAIL_VISIBLE_PATHS) return all.slice(0, RAIL_VISIBLE_PATHS)
  return [...all.slice(0, RAIL_VISIBLE_PATHS - 1), all[index]]
})

/** 收进「更多」浮层的路径（保持原顺序，与轨上可见集合互补） */
const overflowPathOptions = computed<PathFilterOption[]>(() => {
  if (!railBounded.value) return []
  const shown = new Set(visiblePathOptions.value.map((opt) => opt.value))
  return pathOnlyOptions.value.filter((opt) => !shown.has(opt.value))
})

/** 轨上渲染的完整选项：全部路径 + 可见路径 */
const railOptions = computed<PathOption[]>(() => [
  allPathOption.value,
  ...visiblePathOptions.value,
])

function isActivePath(value: string | null): boolean {
  return (props.pathId ?? null) === value
}

/** 换路径：清空当前选中节点（旧节点可能不在这张图里），再让父组件重新请求 */
function selectPath(value: string | null) {
  if (isActivePath(value)) return
  selected.value = null
  emit('update:pathId', value)
}

/**
 * 换路径 + 把焦点落到新的选中 chip 上。键盘换选（方向键/Home/End）与「更多」浮层选路径
 * 都走这里；鼠标点 chip 不需要（焦点本就在被点的元素上）。
 * 落焦点的时机见 pendingFocusPathId：等父组件把 pathId 同步回来，而不是当场 focus。
 */
function selectPathKeepingFocus(value: string | null) {
  if (isActivePath(value)) return
  selectPath(value)
  pendingFocusPathId.value = value
}

const railEl = ref<HTMLElement | null>(null)

/** radiogroup 的 roving tabindex：方向键 / Home / End 在轨道内移动并选中，焦点跟随选中项 */
function onRailKeydown(event: KeyboardEvent, value: string | null) {
  const options = railOptions.value
  const index = options.findIndex((opt) => opt.value === value)
  if (index < 0) return
  let next = index
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % options.length
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + options.length) % options.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = options.length - 1
  else return
  event.preventDefault()
  selectPathKeepingFocus(options[next].value)
}

/* ---------- 「更多」浮层 ---------- */

const moreOpen = ref(false)
const moreWrapEl = ref<HTMLElement | null>(null)
const moreTriggerEl = ref<HTMLButtonElement | null>(null)
const morePanelEl = ref<HTMLElement | null>(null)

function closeMore(restoreFocus = false) {
  if (!moreOpen.value) return
  moreOpen.value = false
  if (restoreFocus) void nextTick(() => moreTriggerEl.value?.focus())
}

function toggleMore() {
  moreOpen.value = !moreOpen.value
  if (!moreOpen.value) return
  // 键盘打开时焦点必须进浮层，否则 Tab 会从触发钮直接跳走、浮层成了不可达的死内容
  void nextTick(() => {
    const panel = morePanelEl.value
    ;(panel?.querySelector<HTMLElement>('[aria-checked="true"]')
      ?? panel?.querySelector<HTMLElement>('[role="menuitemradio"]'))?.focus()
  })
}

/**
 * 待落焦点的目标路径值（undefined = 无待办）。
 *
 * 为什么要延迟落焦点：父组件收到 update:pathId 会把整屏切成加载态（三态骨架顶掉轨道），
 * 轨道连同 chip 一起卸载重建——此刻同步 focus 是徒劳的，节点已不在 DOM，焦点掉回 body，
 * 键盘与读屏用户无从知道选中落到了哪条路径（2026-10-05 实测方向键换选后 activeElement
 * 变成 body）。所以记下「请求切到哪条」，等父组件把 pathId 同步回来（= 确认生效）再落焦点。
 *
 * 为什么用值配对而不是布尔标记：布尔标记在「父组件还没来得及更新 props」的那一帧就会
 * 误判为「轨道还在、当场落焦点」，结果把焦点交给**旧**的选中 chip（实测如此）。
 * 值配对只在父组件确实切到这条路径时才落焦点，忽略请求的父组件不会触发任何误跳。
 */
const pendingFocusPathId = ref<string | null | undefined>(undefined)

/** 从浮层里选路径：选中项会被钉进轨上，焦点随后落在那枚 chip 上 */
function pickOverflow(value: string | null) {
  selectPathKeepingFocus(value)
  closeMore()
}

/** 浮层内方向键换焦点（与轨上 roving tabindex 同款；Home/End 到两端） */
function onMorePanelKeydown(event: KeyboardEvent) {
  const items = Array.from(
    morePanelEl.value?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []
  )
  if (items.length === 0) return
  const index = items.indexOf(document.activeElement as HTMLElement)
  let next: number | null = null
  if (event.key === 'ArrowDown') next = (index + 1 + items.length) % items.length
  else if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = items.length - 1
  if (next === null) return
  event.preventDefault()
  items[next].focus()
}

/** 点击浮层外 / Esc：关闭（与列表页 pcard 菜单同款 dismiss 口径） */
function onMoreDocClick(event: MouseEvent) {
  if (!moreOpen.value) return
  const target = event.target
  // target 未必是 Node（事件直接派发到 window 时是 window 本身），先判类型再 contains
  if (target instanceof Node && moreWrapEl.value?.contains(target)) return
  closeMore()
}
function onMoreDocKey(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !moreOpen.value) return
  event.preventDefault()
  closeMore(true)
}

/** 轨道是否已挂在 DOM：三态整屏（加载/错误/空态）替换掉 rail 与图卡，此时无 chip 可滚 */
const railVisible = computed(
  () => !props.loading && !props.error && props.nodes.length > 0 && props.paths.length > 1
)

/**
 * 选中 chip 滚到轨道可视区中央（P2-24 2026-10-04 全站评审 adjusted）：
 * 轨道 overflow-x:auto 但 scrollbar-width:none，组件此前没有任何滚动定位——
 * 程序化选中末枚 chip 后 scrollLeft 恒 0，「轨上还有 N 条路径」零 affordance。
 * 初始加载（rail 刚挂载，nextTick 等 DOM 就绪）与 pathId 变化（selectPath/键盘换选/
 * 宿主程序化切路径后 props 同步）统一走这里；block:'nearest' 只做横向滚动，
 * 不纵向拽动页面，避免「选个 chip 页面跳一下」。
 *
 * 有界轨道（2026-10-05）之后这条规则通常无事可做（选中项已被钉进可见集合，轨上放得下），
 * 保留是为了两个残留场景：① 路径数刚好卡在阈值边缘、② 窄视口下「全部 + 3 条」也放不下
 * （390 视口轨仅 250px 宽，实测仍要横滚 571px）。它同时兼作「轨上还有内容」的兜底定位。
 */
function scrollSelectedChip() {
  void nextTick(() => {
    const chip = railEl.value?.querySelector<HTMLElement>('[aria-checked="true"]')
    chip?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
    // 键盘换选/浮层选路径的落焦点时机到了（父组件已把 pathId 同步过来）
    if (pendingFocusPathId.value !== undefined && (props.pathId ?? null) === pendingFocusPathId.value) {
      pendingFocusPathId.value = undefined
      chip?.focus()
    }
    syncRail()
  })
}

/* ---------- 轨两端渐隐：溢出侧才亮 ----------
   轨道滚动条被显式抹掉（scrollbar-width:none），渐隐是唯一「还有内容」的静态提示。
   不溢出的一侧不亮，否则静止轨道两侧糊一层白，看着像渲染坏了。 */

const railFadeLeft = ref(false)
const railFadeRight = ref(false)

function syncRail() {
  const el = railEl.value
  if (!el) {
    railFadeLeft.value = false
    railFadeRight.value = false
    return
  }
  const max = el.scrollWidth - el.clientWidth
  railFadeLeft.value = el.scrollLeft > 1
  railFadeRight.value = max > 1 && el.scrollLeft < max - 1
}

/** 路径集合变化会改变轨宽（如切到「全部路径」后 chip 文案变长）→ 重新判断两端 */
watch([railOptions, railVisible], () => void nextTick(syncRail))
/** 视口变化：阈值以内不换集合，但轨宽变了，渐隐要跟着重算 */
function onRailResize() {
  syncRail()
}

watch([railVisible, () => props.pathId], ([ready]) => {
  if (ready) scrollSelectedChip()
})

onMounted(() => {
  window.addEventListener('click', onMoreDocClick)
  window.addEventListener('keydown', onMoreDocKey)
  window.addEventListener('resize', onRailResize, { passive: true })
})
onBeforeUnmount(() => {
  window.removeEventListener('click', onMoreDocClick)
  window.removeEventListener('keydown', onMoreDocKey)
  window.removeEventListener('resize', onRailResize)
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

/** 读屏清单与画布同口径：MkGraph 内部会按 hideIsolated 滤掉孤立节点（其 visibleNodes 逻辑）。
 *  清单若不复制这条规则，「图上看不到的概念」会出现在读屏清单里，两套信息互相矛盾 */
const listNodes = computed(() => {
  if (!hideIsolated.value) return levelNodes.value
  const connected = new Set<string>()
  for (const e of levelEdges.value) {
    connected.add(e.fromConceptId)
    connected.add(e.toConceptId)
  }
  const kept = levelNodes.value.filter((n) => connected.has(n.id))
  return kept.length > 0 ? kept : levelNodes.value
})

/** 掌握度读屏文案与侧栏同口径（百分比）：raw 0-1 小数直接念出来很难懂 */
function masteryText(n: MkGraphNode): string {
  return n.masteryScore === null || n.masteryScore === undefined
    ? '未知'
    : `${Math.round(n.masteryScore * 100)}%`
}

/* ---------- 掌握状态四档（统计 / 徽章 / 图例共用一个口径） ---------- */

type StatusKey = 'stable' | 'learning' | 'fragile' | 'unknown'

/** 文案对齐原型四色口径：已掌握 / 进行中 / 记忆偏弱 / 待学习 */
const STATUS_LABEL: Record<StatusKey, string> = {
  stable: '已掌握',
  learning: '进行中',
  fragile: '记忆偏弱',
  unknown: '待学习',
}
/** 徽章色跟随画布着色（MkGraph.colorOf 同为绿/琥珀/红/中性灰）：图例教的色必须是图里画的色 */
const STATUS_BADGE: Record<StatusKey, string> = {
  stable: 'mk-badge--ok',
  learning: 'mk-badge--warn',
  fragile: 'mk-badge--bad',
  unknown: 'mk-badge--muted',
}

/** 与画布着色同一套阈值（未评估 / 脆弱 / 已掌握 / 其余在学），避免"图上红一片、统计说都好" */
function statusKeyOf(node: MkGraphNode | null): StatusKey {
  if (!node || node.masteryScore === null || node.masteryScore === undefined) return 'unknown'
  if (node.stability === 'fragile' || node.masteryScore < 0.45) return 'fragile'
  if (node.stability === 'stable' || node.masteryScore >= 0.8) return 'stable'
  return 'learning'
}

/** 统计口径与画布着色一致 */
const counts = computed(() => {
  const out = { stable: 0, learning: 0, fragile: 0, unknown: 0 }
  for (const n of levelNodes.value) out[statusKeyOf(n)] += 1
  return out
})

const selectedStatus = computed(() => {
  const key = statusKeyOf(selected.value)
  return { key, label: STATUS_LABEL[key], badge: STATUS_BADGE[key] }
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

/** 原型 ghost「先放着」：关闭当前详情，回到提示态 */
function dismissSelected() {
  selected.value = null
  emit('select', null)
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
/* 路径筛选行：轨 + 轨外的「更多」出口 */
.mk-ge__railrow {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
/* 路径筛选轨（原型 .wf-rail：横滚、无滚动条、与图卡同列）。
   flex:1 + min-width:0：轨吃满「更多」之外的宽度，且允许收缩到触发横滚 —— 不给
   min-width:0 时 flex 子项按内容最小宽撑开，整行会被推宽（列表页 .pcard 同款教训） */
.mk-ge__rail {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  gap: 8px;
  /* 两端各留 2px：轨是横滚容器，首尾 chip 贴边时描边/焦点环会被裁掉半像素 */
  padding: 4px 2px;
  overflow-x: auto;
  scrollbar-width: none;
}
.mk-ge__rail::-webkit-scrollbar {
  display: none;
}
/* 两端渐隐：滚动条已抹掉，这是「轨上还有内容」的唯一静态提示（有界轨道 + 窄视口下仍需）。
   遮罩用 black 关键字而非 hex：mask 的色停只吃 alpha（与 Overview 的纵向渐隐同款），
   写 hex 会被 design:check 记成硬编码配色，读起来也像调色板里的颜色。 */
.mk-ge__rail--fade-r {
  mask-image: linear-gradient(to right, black calc(100% - 26px), transparent 100%);
  -webkit-mask-image: linear-gradient(to right, black calc(100% - 26px), transparent 100%);
}
.mk-ge__rail--fade-l {
  mask-image: linear-gradient(to right, transparent 0, black 26px);
  -webkit-mask-image: linear-gradient(to right, transparent 0, black 26px);
}
.mk-ge__rail--fade-l.mk-ge__rail--fade-r {
  mask-image: linear-gradient(to right, transparent 0, black 26px, black calc(100% - 26px), transparent 100%);
  -webkit-mask-image: linear-gradient(to right, transparent 0, black 26px, black calc(100% - 26px), transparent 100%);
}
/* 路径 chip（原型 .wf-chip：38px 高胶囊；选中态 = 蓝 14% 底 + 蓝描边）。
   P2-24（2026-10-04 评审）：路径标题整句直出，390 视口选中 chip（19 字实测
   scrollWidth=275）溢出 42px 尾部被裁、后续 chip 排到 right=1763 且轨道无滚动定位。
   chip 收敛为单行省略（完整标题由选中说明与详情承载）；选中 chip 由 script 的
   scrollSelectedChip 居中，兼作「轨上还有其他路径」的滚动 affordance。 */
.mk-ge__chip {
  flex: none;
  min-height: 38px;
  max-width: 260px;
  padding: 8px 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border: 1px solid var(--line);
  border-radius: var(--mk-radius-pill);
  background: var(--surface);
  color: var(--muted);
  font: inherit;
  /* --mk-fs-13 是档外字面量 token（1440 档三档为 12.5/14.5/15.5），
     用角色 token 取代，避免同屏第 4 个文本档（2026-10-06 审核 §主题 6）。 */
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  cursor: pointer;
  transition: background 0.14s ease, border-color 0.14s ease, color 0.14s ease;
}
.mk-ge__chip:hover {
  background: color-mix(in srgb, var(--blue) 12%, transparent);
}
.mk-ge__chip--on,
.mk-ge__chip--on:hover {
  background: color-mix(in srgb, var(--blue) 14%, transparent);
  border-color: var(--blue);
  color: var(--blue-deep);
}
.mk-ge__chip:focus-visible {
  outline: none;
  box-shadow: var(--mk-focus-ring);
}
/* ---------- 「更多」（轨外的路径出口） ----------
   有界轨道的逃生口：路径数一涨，轨上只留「全部路径 + 3 条 + 更多（N）」，其余进浮层。
   放在轨外（.mk-ge__railrow 的 flex:none 子项）而不是轨尾 —— 轨尾的 chip 会随横滚
   跑出视口，「出口」本身就不该需要滚动才能找到。 */
.mk-ge__more {
  position: relative;
  flex: none;
}
.mk-ge__chip--more {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: none;
}
.mk-ge__more-panel {
  /* 与触发钮隔 6px：指尖停在「更多」上时不在任何菜单项里（列表页 pcard 菜单同款防误触口径） */
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 10;
  display: grid;
  gap: 2px;
  min-width: 236px;
  max-width: min(360px, calc(100vw - 32px));
  max-height: min(60vh, 360px);
  overflow-y: auto;
  padding: 6px;
  border: 1px solid var(--line);
  border-radius: var(--mk-radius-xl);
  background: var(--surface);
  box-shadow: var(--shadow-md);
}
.mk-ge__more-item {
  min-height: 40px;
  padding: 9px 11px;
  border: 0;
  border-radius: var(--mk-radius-md);
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: var(--mk-fs-13);
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}
.mk-ge__more-item:hover {
  background: color-mix(in srgb, var(--surface) 96%, var(--ink));
  color: var(--ink);
}
.mk-ge__more-item--on,
.mk-ge__more-item--on:hover {
  background: color-mix(in srgb, var(--blue) 12%, transparent);
  color: var(--blue-deep);
}
.mk-ge__more-item:focus-visible {
  outline: none;
  box-shadow: var(--mk-focus-ring);
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
  padding: 4px var(--mk-space-3);
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
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: var(--mk-space-4);
  align-items: start;
}
.mk-ge__canvas {
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
}
.mk-ge__dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: var(--mk-radius-pill);
}
.mk-ge__dot--ok { background: var(--mk-green); }
.mk-ge__dot--mid { background: var(--mk-amber); }
.mk-ge__dot--weak { background: var(--mk-red); }
.mk-ge__dot--none { background: var(--mk-line); }
.mk-ge__line {
  display: inline-block;
  width: 22px;
  height: 0;
  border-top-width: 2px;
}
/* 线色不再写死在 CSS：图例与画布同源取 relationStyleOf（见 script legendLines） */
.mk-ge__legend-hint {
  opacity: 0.8;
}
.mk-ge__side {
  padding: var(--mk-space-3);
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-md);
  background: var(--mk-surface);
}
.mk-ge__side-title {
  margin: 0 0 var(--mk-space-2);
  font-size: var(--mk-fs-body);
  line-height: 1.5;
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
.mk-ge__side-hint {
  margin: 0;
  font-size: var(--mk-fs-micro);
  line-height: 1.6;
  color: var(--mk-muted);
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
/* 动作区（原型 wf-drawer__acts：主 CTA + ghost，两枚通栏 44px） */
.mk-ge__acts {
  display: grid;
  gap: var(--mk-space-2);
  margin-top: var(--mk-space-3);
}
.mk-ge__cta,
.mk-ge__ghost {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 18px;
  border-radius: var(--mk-radius-xl);
  font: inherit;
  font-size: var(--mk-fs-body);
  font-weight: 700;
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
.mk-ge__ghost {
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--muted);
}
.mk-ge__ghost:hover {
  border-color: color-mix(in srgb, var(--blue) 35%, transparent);
  color: var(--blue-deep);
}
.mk-ge__ghost:active { transform: scale(0.98); }
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
}
.mk-ge__rel-item {
  display: block;
  width: 100%;
  padding: 3px 7px;
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
  /* 视图分段控件（全部/核心概念/知识组件）只有 27px 高，触屏上它是最常用的过滤器 */
  .mk-ge__seg-btn {
    min-height: 36px;
    display: inline-flex;
    align-items: center;
    padding: 0 var(--mk-space-3);
  }
  /* 「显示无关系的概念」是一行 label + 原生 18px checkbox：点 label 任意处都能切换，
     所以手势目标是 label 本身——它原来只有 ~19px 高，补齐到 36（mobile:spec 按 label 量） */
  .mk-ge__check { min-height: 36px; }
  /* 路径 chip 桌面 38px（原型档）；触屏抬到 44 —— 轨道里 chip 数量 = 路径数 +1，
     每个 <44 都吃 mobile:spec 的 lt44 预算（kmap 页预算 7，旧 select 是 44 不占额度） */
  .mk-ge__chip { min-height: 44px; }
}
</style>
