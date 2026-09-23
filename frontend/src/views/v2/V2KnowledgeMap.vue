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

function onPathChange(value: string | null) {
  pathId.value = value
  void load(value)
}

onMounted(() => { void load(null) })
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
.km__card {
  padding: var(--mk-space-5);
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-lg);
  background: var(--mk-surface);
}
</style>
