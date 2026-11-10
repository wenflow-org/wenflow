<template>
  <div class="km v2-page">
    <V2Nav />

    <main class="km__main">
      <!-- 顶部标题行恢复（2026-11-07 二次走查）：此前只有 visually-hidden 的 h1，
           理由是同页已有顶部导航高亮、再印一行是复读。但实测 5 个主 Tab 来回切时，
           只有本页顶部没有标题行（学习台/学习路径/学习状态都有 h1 + 副标题），
           卡片上边缘比其他页高出一行，切换时整屏重心跳动。
           现在按「学习状态」模板恢复同一结构：左对齐 h1 + 副标题，
           左右内边距与下方卡片同档，卡边与邻页严格同一条竖线。 -->
      <header class="km__head">
        <div>
          <h1>知识图谱</h1>
          <p>核心概念、知识组件与前置依赖关系</p>
        </div>
      </header>

      <!-- 说明框已撤（2026-11-05 屏效比）：蓝边通栏 66px 只讲「共 N 条路径、N 个节点、
           当前展示哪条」——图卡统计行（mk-ge__stats）与路径轨已各自常驻同一组数字，
           本行是同屏第三份。当前路径由轨道上高亮芯片 + 图卡标题承担 -->
      <p v-if="narrowedNote" class="km__note visually-hidden">{{ narrowedNote }}</p>

      <!-- 卡壳（border / radius / padding 10px 10px 4px）落在内部 .mk-ge__card 上：
           2026-11-06 起路径切换收进图卡内的统计栏（单个下拉，见 MkGraphExplorer），
           卡外不再有 wf-rail 式的独立控件行；本节点只当 :deep 锚点，不再自己套一层卡
           （否则会卡中卡） -->
      <section class="km__card">
        <MkGraphExplorer
          :nodes="nodes"
          :edges="edges"
          :paths="paths"
          :path-id="pathId"
          :theme="theme"
          :loading="loading"
          :error="error"
          height="100%"
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
    // 原始报错只进控制台；对外给固定人话（AP7：不把实现细节漏给用户）
    console.error('[knowledge-map] 概念图加载失败', e instanceof Error ? e.message : e)
    error.value = '知识图谱加载失败，请稍后重试。'
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

/** 节点详情「去练习这个知识点」→ 有锚点直达该概念所属里程碑的首个未完成任务；
 * 无锚点（里程碑未挂概念/全部完成）落主链路下一步动作页（原兜底行为保留） */
function onPractice(node?: MkGraphNode | null) {
  const taskId = node?.practice?.taskId
  if (taskId) {
    void router.push(`/learn/${taskId}`)
    return
  }
  void router.push('/dashboard')
}

onMounted(async () => {
  await load(null)
  // 首次进来若「全部路径」过大，先落到最近一条路径并说明原因（用户可切回全部）
  const first = paths.value[0]
  if (pathId.value !== null || paths.value.length < 2 || !first) return
  const connected = connectedCount(nodes.value, edges.value)
  if (connected <= AUTO_NARROW_CONNECTED_NODES) return
  // 教句「想看全貌可切回全部路径」删去（2026-11-03 真机走查）：全部路径 pill 就在下面一排
  narrowedNote.value = `共 ${paths.value.length} 条学习路径、${connected} 个概念节点。当前展示「${first.title ?? '最近一条路径'}」。`
  await applyPath(first.id)
})
</script>

<style scoped>
/* 容器与「学习状态」严格同档（2026-11-07 三次走查，用户裁决
   「以学习状态为全站标准模板」）：上一版试过全幅工作台（width:100% 无帽）被判
   「满屏太难看」，随即退回「组件内 880 + ≥1680 拓 1360」的老阶梯——那套在
   1280/1536 下只有 54~89%，与邻页不齐。
   现在本页不再自钉任何宽度：≥1024 由共享 v2.css 的 min(92vw, 1360px) 统一给出，
   901~1023 走共享的 720 列，≤900 与其余页面一样满宽。 */
.km__main {
  width: 100%;
  margin: 0 auto;
  padding: 24px 28px 48px;
}

/* 顶部标题行（2026-11-07 走查恢复）：与 .state__head 同一解剖——22px/800 主标题 +
   13px 副标题，左对齐、贴卡片上沿 2px。
   h1 必须是文档里**可见**的一级标题（此前为 visually-hidden），否则 5 个主导航 Tab
   切换时本页顶部比其他页矮一行，重心跳动。 */
.km__head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 2px;
}
.km__head h1 { margin: 0; font-size: 22px; font-weight: 800; color: var(--ink); }
.km__head p { margin: 3px 0 0; font-size: 13px; color: var(--muted); }

/* 说明框视觉已撤（2026-11-05 屏效比）：内容仅留给读屏（visually-hidden 全局类），
   不再占 66px 视觉高度——同屏第三份数字（图卡统计行 + 路径轨已各有） */
.km__note {
  margin: 0;
}
/* 图卡自适应（2026-11-10 用户裁决「改成自适应」）：
   整页「导航 + 主区」两段式弹性布局，图卡直接吃掉剩余高度，不再按 DPI 推固定像素
   （100dvh − 282 这类会在 4K 缩放下差几十像素）。
   链路：.km(flex column, height=视口/zoom) → .km__main(flex:1) → .km__card(flex:1)
   → .mk-ge(flex:1) → .mk-ge__card(flex:1) → .mk-ge__body(flex:1 + 单行 1fr 网格)
   → .mk-ge__canvas(网格项拉伸出确定高度) → .mk-graph(height:100%)。
   ⚠ 只在 ≥721px 生效：≤720px 的画布走组件自带的窄屏档（像素高度），
   手机上是「图 + 概览上下堆叠」的纵向流，不该被限制成一屏。 */
@media (min-width: 721px) {
  /* App.vue 的 #app / #app-main 是 flex 壳，本页默认被当成弹性项、高度由父级分配
     （height 被忽略、内容再多也不改变分配）。钉成 0 0 auto 才能让下面那条 height 生效。
     ⚠ 不要动 align-self：父级是纵向 flex，交叉轴是宽度——flex-start 会让整页缩成内容宽、
     不再居中。只作用于 ≥721：手机保持纵向流（画布固定像素高、页面可滚动）。 */
  .km {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    /* ⚠ 必须除以 --vp-zoom：v2.css 在 ≥1600 视口给 .v2-page 加 zoom（1.08 / 1.15 / 1.3），
       zoom 会把 100dvh 一起放大——直接写 100dvh 渲染出来是「1.08 个视口高」，卡片被顶出折线
       （用户 4K 缩放实测的「还是不行」）。口径与 V2LearningPage 的 .learn 一致。
       用 height 而非 min-height：只有确定高度，整条 flex 链才会按剩余空间分配。 */
    height: calc(100dvh / var(--vp-zoom, 1));
    min-height: 0;
  }
  .km__main {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .km__card {
    min-width: 0;
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
  }
  .km__card :deep(.mk-ge) {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  /* 单行 1fr：行高由 .mk-ge__body 的定高决定，画布的 height:100% 才有参照物，
     不会退化成「按内容算 → 内容按父高算」的循环 */
  .km__card :deep(.mk-ge__body) {
    flex: 1 1 auto;
    min-height: 0;
    grid-template-rows: minmax(0, 1fr);
  }
  .km__card :deep(.mk-ge__canvas) {
    height: 100%;
    min-height: 0;
  }
  /* MkGraph 的根是 .mk-graph-wrap（内层才是 .mk-graph），中间这层不给高度的话
     画布的 height:100% 会落到 auto 上变成 0 */
  .km__card :deep(.mk-graph-wrap) {
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .km__card :deep(.mk-ge__card) {
    flex: 1 1 auto;
    min-height: 0;
  }
  /* 加载骨架没有真实画布可参照，给个下限，避免 100% 撑成 0 */
  .km__card :deep(.mk-ge__skel-graph) {
    min-height: 360px;
  }
}
/* ≤720px：画布回到组件窄屏档该有的像素高度——prop 是 100%，而手机上是纵向流，
   100% 没有参照物会塌成一条（实测 94px）。 */
@media (max-width: 720px) {
  .km__card :deep(.mk-graph) {
    height: 312px;
  }
}
/* 图卡外壳落在组件的结构层 .mk-ge__card 上（原型 .wf-graph：surface 底 + 1px 线 +
   radius-modal + shadow-sm + padding 10px 10px 4px）。本节点只当 :deep 锚点：
   路径切换已收进图卡内的统计栏（单个下拉），卡外没有独立控件行，卡壳仍由组件结构层出，
   页面这边不再重复套一层。 */
.km__card :deep(.mk-ge__card) {
  padding: 10px 10px 4px;
  border: 1px solid var(--line);
  border-radius: var(--mk-radius-modal);
  box-shadow: var(--mk-shadow-sm);
  background: var(--surface);
}
/* 「查看学习状态」通栏 ghost 已删（2026-10-09）：入口由顶导航/底部 dock 承担。
   画布高度走 `height="100%"` + 上面那条 flex 链（2026-11-10 用户裁决「改成自适应」）：
   卡片高度 = 视口 − 导航 − 标题行 − 页脚留白，由浏览器自己算，任何缩放/DPI 都不会差几个像素。
   移动端 ≤720px 档 MkGraph 仍按 0.6 倍收（媒体查询在组件里，对 100% 同样生效）。 */

/* ===== 移动端密度（2026-09-24 / 2026-09-30 对齐原型后复核）=====
   判据：整页上下留白 ≤40px。本页通篇用 --mk-space-* token，这里继续用 token。
   实测 390 下：.km__main 24/20/48（叠加 v2.css 给底部导航留的 72px 后，页尾合计 120px）。
   图卡内边距不再按断点改：卡壳已移到 .mk-ge__card，两端统一吃原型固定档 10px 10px 4px。 */
@media (max-width: 1100px) {
  .km__main {
    padding: var(--mk-space-2) var(--mk-space-3) var(--mk-space-4);
  }
}
</style>
