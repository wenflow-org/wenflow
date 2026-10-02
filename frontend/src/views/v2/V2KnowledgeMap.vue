<template>
  <div class="km v2-page">
    <V2Nav />

    <main class="km__main">
      <div class="km__hero">
        <div>
          <h1>知识图谱</h1>
          <p>把你所有学习路径里的概念汇成一张图，颜色是掌握程度。</p>
          <!-- 「怎么看这张图」折叠图例已删（2026-09-27）：图谱卡底部的 mk-ge__legend
               常驻覆盖同一套语义（线型/颜色/形状），顶部那份是重复教学 -->
          <!-- hero 里的「查看学习状态」文字链已下移（2026-09-30 对齐原型）：改图卡下方通栏 ghost -->
        </div>
      </div>

      <p v-if="narrowedNote" class="km__note">{{ narrowedNote }}</p>

      <!-- 卡壳（border / radius / padding 10px 10px 4px）落在内部 .mk-ge__card 上：
           原型里 wf-rail 与 .wf-graph 是兄弟，路径 chip 要露在图卡**外面**，
           所以本节点只当 :deep 锚点，不再自己套一层卡（否则会卡中卡） -->
      <section class="km__card">
        <MkGraphExplorer
          :nodes="nodes"
          :edges="edges"
          :paths="paths"
          :path-id="pathId"
          :theme="theme"
          :loading="loading"
          :error="error"
          height="560px"
          empty-hint="还没有可展示的概念图。学完一节课、或生成一条学习路径后，概念与关系会自动出现在这里。"
          error-action-text="重试"
          empty-action-text="开始学习"
          practice-action-text="去练习这个知识点"
          @update:path-id="onPathChange"
          @retry="onRetry"
          @empty-action="onEmptyAction"
          @practice="onPractice"
        />
      </section>
      <!-- 查看学习状态：图卡下方通栏 ghost（原型态）。图在加载/出错/为空时不占位 -->
      <router-link
        v-if="!loading && !error && nodes.length"
        to="/learning-state"
        class="btn-ghost km__state-link"
      >查看学习状态</router-link>
    </main>
  </div>
</template>

<script setup lang="ts">
/**
 * 用户侧「知识图谱」聚合页
 *
 * 与学习页「本节知识点 → 图谱」的区别：那里只看**当前这节课所属路径**，本页默认看
 * **全部路径的聚合图**（`GET /api/learning/concept-graph` 不传 pathId 即用户级），
 * 并可按路径筛选。接口是 self-scoped：只读自己的数据，不接 userId 参数（防越权）。
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import V2Nav from './V2Nav.vue'
import MkGraphExplorer from '@/components/mk/MkGraphExplorer.vue'
import type { MkGraphEdge, MkGraphNode } from '@/components/mk/MkGraph.vue'
import { learningAPI } from '@/api/learning'
import { useIsDark } from '@/composables/useIsDark'

const router = useRouter()
const isDark = useIsDark()
const theme = computed<'light' | 'dark'>(() => (isDark.value ? 'dark' : 'light'))

const nodes = ref<MkGraphNode[]>([])
const edges = ref<MkGraphEdge[]>([])
const paths = ref<Array<{ id: string; title: string | null }>>([])
const pathId = ref<string | null>(null)
const loading = ref(false)
const error = ref('')

/**
 * 「全部路径」的图超过这个规模就自动收窄到单条路径。
 *
 * 为什么是 40：`MkGraph` 的力导向斥力/边长是按 ~40 节点校准的（该文件注释记录了这次校准），
 * 超过之后云团会撑出画布——实测某学习者 5 条路径并集有 76 个有边节点，802×560 的画布上
 * 只能看见边缘碎片。这里按"有边相连的节点数"判断，与画布实际渲染的规模一致
 * （孤立节点默认不显示）。
 */
const AUTO_NARROW_CONNECTED_NODES = 40
const narrowedNote = ref('')

/** 有边相连的节点数（= 画布实际会渲染的规模） */
function connectedCount(ns: MkGraphNode[], es: MkGraphEdge[]): number {
  const used = new Set<string>()
  for (const e of es) { used.add(e.fromConceptId); used.add(e.toConceptId) }
  return ns.filter((n) => used.has(n.id)).length
}

async function load(nextPathId: string | null = pathId.value) {
  loading.value = true
  error.value = ''
  try {
    const data = (await learningAPI.getConceptGraph(nextPathId ? { pathId: nextPathId } : undefined)) as {
      nodes?: MkGraphNode[]
      edges?: MkGraphEdge[]
      meta?: { paths?: Array<{ id: string; title: string | null }> }
    } | null
    nodes.value = Array.isArray(data?.nodes) ? data!.nodes! : []
    edges.value = Array.isArray(data?.edges) ? data!.edges! : []
    paths.value = Array.isArray(data?.meta?.paths) ? data!.meta!.paths! : []
  } catch (e) {
    error.value = `知识图谱加载失败：${e instanceof Error ? e.message : String(e)}`
    nodes.value = []
    edges.value = []
    paths.value = []
  } finally {
    loading.value = false
  }
}

/** 程序化换路径（保留说明文案） */
async function applyPath(value: string | null) {
  pathId.value = value
  await load(value)
}

/** 用户主动换路径：说明文案随之作废 */
function onPathChange(value: string | null) {
  narrowedNote.value = ''
  void applyPath(value)
}

/* ---------- 三态主动作（原型 data-retry / data-new-goal） ----------
   错误与空态现在由 MkGraphExplorer 整屏渲染（见其 V2ResultState 用法），
   动作文案从这里传入、事件在这里落地，组件保持「宿主未接线就不渲染按钮」的只读能力。 */

/** 整屏错误态「重试」：原地重拉当前路径，不必整页刷新 */
function onRetry() {
  void load()
}

/** 整屏空态「开始学习」→ 原型 data-new-goal：去发起/继续目标对话 */
function onEmptyAction() {
  void router.push('/goal-conversation')
}

/** 节点详情「去练习这个知识点」→ 没有按概念直达的练习路由，落到主链路下一步动作页 */
function onPractice() {
  void router.push('/dashboard')
}

onMounted(async () => {
  await load(null)
  // 首次进来若「全部路径」过大，先落到最近一条路径并说明原因（用户可切回全部）
  const first = paths.value[0]
  if (pathId.value !== null || paths.value.length < 2 || !first) return
  const connected = connectedCount(nodes.value, edges.value)
  if (connected <= AUTO_NARROW_CONNECTED_NODES) return
  narrowedNote.value = `你有 ${paths.value.length} 条学习路径，合起来有 ${connected} 个概念节点，一张图放不下，先只展示「${first.title ?? '最近一条路径'}」。想看全貌可以切回「全部路径」。`
  await applyPath(first.id)
})
</script>

<style scoped>
.km__main {
  max-width: 1180px;
  margin: 0 auto;
  padding: var(--mk-space-6) var(--mk-space-5) var(--mk-space-8);
}
.km__hero {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--mk-space-4);
  margin-bottom: var(--mk-space-5);
}
.km__hero h1 {
  margin: 0 0 var(--mk-space-2);
  /* 原型 .wf-km__hero h1 = 21px（全站 h1 档随原型走；移动端仍落 18px 全站约定） */
  font-size: 21px;
}
.km__hero p {
  /* 原型 .wf-km__hero p：12.5px + max-width 32ch（一行不超过 32 字，说明不再铺满 640px） */
  max-width: 32ch;
  margin: 0;
  font-size: var(--mk-fs-12_5);
  line-height: 1.7;
  color: var(--mk-muted);
}
.km__note {
  margin: 0 0 var(--mk-space-4);
  padding: var(--mk-space-3) var(--mk-space-4);
  border: 1px solid var(--mk-line);
  border-left: 3px solid var(--mk-blue);
  border-radius: var(--mk-radius-md);
  background: var(--mk-surface-2);
  font-size: var(--mk-fs-12_5);
  line-height: 1.6;
  color: var(--mk-muted);
}
.km__card {
  min-width: 0;
}
/* 图卡外壳落在组件的结构层 .mk-ge__card 上（原型 .wf-graph：surface 底 + 1px 线 +
   radius-modal + shadow-sm + padding 10px 10px 4px）。本节点只当 :deep 锚点：
   路径 chip 轨要露在图卡外面（原型 wf-rail 与 .wf-graph 是兄弟），所以卡壳不能套在最外层。 */
.km__card :deep(.mk-ge__card) {
  padding: 10px 10px 4px;
  border: 1px solid var(--line);
  border-radius: var(--mk-radius-modal);
  box-shadow: var(--mk-shadow-sm);
  background: var(--surface);
}
/* 「查看学习状态」：hero 右上文字链 → 图卡下方通栏 ghost（原型 .wf-btn--ghost 通栏）。
   高度靠 .btn-ghost 自带档（移动端 v2.css 抬到 44px），这里只补齐通栏与链接去下划线。 */
.km__state-link {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 44px;
  margin-top: var(--mk-space-3);
  text-decoration: none;
}

/* ===== 移动端密度（2026-09-24 / 2026-09-30 对齐原型后复核）=====
   判据：整页上下留白 ≤40px。本页通篇用 --mk-space-* token，这里继续用 token。
   实测 390 下：.km__main 24/20/48（叠加 v2.css 给底部导航留的 72px 后，页尾合计 120px）。
   图卡内边距不再按断点改：卡壳已移到 .mk-ge__card，两端统一吃原型固定档 10px 10px 4px。 */
@media (max-width: 1100px) {
  .km__main {
    padding: var(--mk-space-4) var(--mk-space-3) var(--mk-space-6);
  }
  /* 页面 h1 移动端全站 18px，只有这页漏了（桌面 21px 一直漏到手机上） */
  .km__hero h1 {
    font-size: var(--mk-fs-18);
  }
}
</style>
