<template>
  <div class="mk-ge">
    <!-- 工具条：左统计、右筛选。统计口径与画布着色一致（未评估 / 脆弱 / 在学 / 已掌握） -->
    <div class="mk-ge__bar">
      <div class="mk-ge__stats">
        <span class="mk-ge__stat"><b>{{ levelNodes.length }}</b> 个概念</span>
        <span class="mk-ge__stat"><b>{{ levelEdges.length }}</b> 条关系</span>
        <span class="mk-ge__stat mk-ge__stat--ok"><i />已掌握 <b>{{ counts.stable }}</b></span>
        <span class="mk-ge__stat mk-ge__stat--mid"><i />在学 <b>{{ counts.learning }}</b></span>
        <span class="mk-ge__stat mk-ge__stat--weak"><i />脆弱 <b>{{ counts.fragile }}</b></span>
        <span class="mk-ge__stat mk-ge__stat--none"><i />未评估 <b>{{ counts.unknown }}</b></span>
      </div>
      <div class="mk-ge__controls">
        <label v-if="paths.length > 1" class="mk-ge__field">
          <span class="mk-ge__field-label">路径</span>
          <select class="mk-ge__select" :value="pathId ?? ''" @change="onPathChange">
            <option value="">全部路径（{{ paths.length }} 条）</option>
            <option v-for="p in paths" :key="p.id" :value="p.id">{{ p.title || p.id }}</option>
          </select>
        </label>
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
        <p v-if="error" class="mk-ge__msg mk-ge__msg--err">{{ error }}</p>
        <div v-else-if="loading" class="mk-ge__msg"><MkLoading inline min /></div>
        <p v-else-if="!nodes.length" class="mk-ge__msg">{{ emptyHint }}</p>
        <MkGraph
          v-else
          :nodes="levelNodes"
          :edges="levelEdges"
          :theme="theme"
          :height="height"
          :hide-isolated="hideIsolated"
          @select="selected = $event"
        />
        <!-- 图例走 DOM：画布内图例在 graph 系列里会误导（categories 是节点分组，不是关系） -->
        <div v-if="!error && !loading && nodes.length" class="mk-ge__legend">
          <span class="mk-ge__legend-group">
            <i class="mk-ge__dot mk-ge__dot--ok" />已掌握
            <i class="mk-ge__dot mk-ge__dot--mid" />在学
            <i class="mk-ge__dot mk-ge__dot--weak" />脆弱
            <i class="mk-ge__dot mk-ge__dot--none" />未评估
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
          <h4 class="mk-ge__side-title">{{ selected.label }}</h4>
          <!-- 字段分区（2026-09-27）：概览四格 + 关系分区（发丝线分隔），替代原来的平铺 kv 行 -->
          <dl class="mk-ge__kv">
            <div class="mk-ge__cell"><dt>层级</dt><dd>{{ selected.level === 'concept' ? '核心概念' : '知识组件' }}</dd></div>
            <div class="mk-ge__cell">
              <dt>掌握度</dt>
              <dd>
                <span v-if="selected.masteryScore === null || selected.masteryScore === undefined">未评估</span>
                <span v-else>{{ Math.round(selected.masteryScore * 100) }}%</span>
              </dd>
            </div>
            <div class="mk-ge__cell"><dt>稳定性</dt><dd>{{ selected.stability || '—' }}</dd></div>
            <div class="mk-ge__cell"><dt>提取次数</dt><dd>{{ selected.extractionCount ?? 0 }}</dd></div>
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

      <!-- 读屏等价清单（P2 收尾）：节点信息此前只存在于 canvas 点击/悬停里，键盘/读屏用户完全拿不到。
           刻意放在 aria-live 侧栏**外**：路径切换时整份清单会重渲染，
           若在 live 区域内会被当成「远端变更」整段播报（40 条），对读屏用户是灾难。
           视觉隐藏复用全局 .visually-hidden（main.css），不在本组件重复定义。
           条数上界：V2KnowledgeMap 的 AUTO_NARROW_CONNECTED_NODES=40 收窄护栏保证有界，无性能问题 -->
      <section
        v-if="!error && !loading && nodes.length"
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
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * MkGraphExplorer：知识点图的**统一外壳**（admin 学习者详情 / 用户侧知识图谱页共用）
 *
 * 为什么单独抽一层：两处需要同一套"统计 + 筛选 + 画布 + 详情"的信息架构，
 * 之前 admin 只有一个裸画布（167 个概念、29 条关系，看不出结构也切不了路径）。
 *
 * 分工：本组件只做展示与本地筛选（层级 / 孤立节点）；**路径筛选由父组件接管**——
 * 它要重新请求（后端按 pathId 收敛节点与边），不是纯前端过滤。
 */
import { computed, ref } from 'vue'
import MkGraph, { relationStyleOf } from './MkGraph.vue'
import type { MkGraphEdge, MkGraphNode } from './MkGraph.vue'
import MkLoading from './MkLoading.vue'

const props = withDefaults(
  defineProps<{
    nodes: MkGraphNode[]
    edges: MkGraphEdge[]
    /** 该学习者图涉及的路径（后端 meta.paths），用于路径下拉 */
    paths?: Array<{ id: string; title: string | null }>
    /** 当前路径筛选（空 = 全部路径）。由父组件负责重新请求 */
    pathId?: string | null
    theme?: 'light' | 'dark'
    height?: string
    loading?: boolean
    error?: string | null
    emptyHint?: string
  }>(),
  {
    paths: () => [],
    pathId: null,
    theme: 'light',
    height: '520px',
    loading: false,
    error: null,
    emptyHint: '还没有概念图数据——路径生成后 kc-mapper 会产出前置依赖，随概念身份注册表物化进图。',
  }
)

const emit = defineEmits<{
  (e: 'update:pathId', value: string | null): void
  (e: 'select', node: MkGraphNode | null): void
}>()

const LEVEL_OPTIONS = [
  { value: 'all' as const, label: '全部' },
  { value: 'concept' as const, label: '核心概念' },
  { value: 'kc' as const, label: '知识组件' },
]

const level = ref<'all' | 'concept' | 'kc'>('all')
const hideIsolated = ref(true)
const selected = ref<MkGraphNode | null>(null)

/** 层级筛选（本地）：节点筛掉后，两端不齐的边也一并筛掉 */
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

/** 统计口径与画布着色一致，避免"图上红一片、统计说都好" */
const counts = computed(() => {
  const out = { stable: 0, learning: 0, fragile: 0, unknown: 0 }
  for (const n of levelNodes.value) {
    if (n.masteryScore === null || n.masteryScore === undefined) out.unknown += 1
    else if (n.stability === 'fragile' || n.masteryScore < 0.45) out.fragile += 1
    else if (n.stability === 'stable' || n.masteryScore >= 0.8) out.stable += 1
    else out.learning += 1
  }
  return out
})

const labelById = computed(() => new Map(props.nodes.map((n) => [n.id, n.label])))

/** 图例线样式与画布边线同源（relationStyleOf 按 theme 出色）：此前图例写死 --mk-blue，
 *  画布实际是 #7a8ba6，图例教的颜色和图里画的不是同一个 */
const legendLines = computed(() => {
  const dark = props.theme === 'dark'
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

function focusNode(id: string) {
  const node = props.nodes.find((n) => n.id === id) ?? null
  selected.value = node
  emit('select', node)
}

function onPathChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  selected.value = null
  emit('update:pathId', value || null)
}

function onIsolatedChange(event: Event) {
  hideIsolated.value = !(event.target as HTMLInputElement).checked
}
</script>

<style scoped>
.mk-ge {
  display: flex;
  flex-direction: column;
  gap: var(--mk-space-3);
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
.mk-ge__field {
  display: inline-flex;
  align-items: center;
  gap: var(--mk-space-2);
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
}
input[type='checkbox'] { width: 18px; height: 18px; accent-color: var(--blue, #3478f6); }
.mk-ge__select {
  max-width: 220px;
  min-height: 44px;
  padding: 4px var(--mk-space-2);
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-sm);
  background: var(--mk-surface);
  color: inherit;
  font-size: var(--mk-fs-micro);
}
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
.mk-ge__msg {
  margin: 0;
  padding: var(--mk-space-5);
  border: 1px dashed var(--mk-line);
  border-radius: var(--mk-radius-md);
  font-size: var(--mk-fs-body);
  color: var(--mk-muted);
  text-align: center;
}
.mk-ge__msg--err {
  border-style: solid;
  color: var(--mk-red);
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
.mk-ge__side-hint {
  margin: 0;
  font-size: var(--mk-fs-micro);
  line-height: 1.6;
  color: var(--mk-muted);
}
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
/* 概览字段分区：2×2 条带格（dt 标签在上、值在下），和 badge 同用 surface-3 条带底，
   暗色比卡片亮一档（admin 表格体系同口径） */
.mk-ge__kv {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--mk-space-1);
  margin: 0;
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
}
</style>
