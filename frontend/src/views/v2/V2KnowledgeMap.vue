<template>
  <div class="km v2-page">
    <V2Nav />

    <main class="km__main">
      <div class="km__hero">
        <div>
          <h1>知识图谱</h1>
          <p>
            把你所有学习路径里的概念汇成一张图：<strong>实线</strong>是前置依赖（先掌握左边才能学右边），
            <strong>虚线</strong>是归属（知识组件属于哪个核心概念）；颜色是掌握度。
          </p>
        </div>
        <router-link to="/learning-state" class="km__link">查看学习状态</router-link>
      </div>

      <p v-if="narrowedNote" class="km__note">{{ narrowedNote }}</p>

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
          @update:path-id="onPathChange"
        />
      </section>
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
import V2Nav from './V2Nav.vue'
import MkGraphExplorer from '@/components/mk/MkGraphExplorer.vue'
import type { MkGraphEdge, MkGraphNode } from '@/components/mk/MkGraph.vue'
import { learningAPI } from '@/api/learning'
import { useIsDark } from '@/composables/useIsDark'

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
  font-size: var(--mk-fs-20);
}
.km__hero p {
  max-width: 640px;
  margin: 0;
  font-size: var(--mk-fs-13);
  line-height: 1.7;
  color: var(--mk-muted);
}
.km__link {
  flex: none;
  font-size: var(--mk-fs-13);
  color: var(--mk-muted);
  text-decoration: none;
}
.km__link:hover {
  color: var(--mk-blue);
}
/* 触屏：「查看学习状态」这类文字链接只有 20px 高，加纵向内边距抬到 34px（配色不变） */
@media (max-width: 900px) {
  .km__link { padding: 7px 0; }
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
  padding: var(--mk-space-5);
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-lg);
  background: var(--mk-surface);
}

/* ===== 移动端密度（2026-09-24）=====
   判据：卡片内边距 12–16px、整页上下留白 ≤40px。本页通篇用 --mk-space-* token，这里继续用 token。
   实测 390 下：.km__main 24/20/48（叠加 v2.css 给底部导航留的 72px 后，页尾合计 120px）、
   .km__card 20px。放在文件末尾：同权重下后出现者胜（中间那个 ≤900 块在 .km__card 之前）。 */
@media (max-width: 900px) {
  .km__main {
    padding: var(--mk-space-4) var(--mk-space-3) var(--mk-space-6);
  }
  .km__card {
    padding: var(--mk-space-4);
  }
}
</style>
