<template>
  <!-- Prompt 评估（2026-10-25 用户「拆成单页，把这个 tab 撤掉，放到组里」）：
       2026-10-04 曾由独立场景折入 skills 宿主页签，本次拆回独立页并归入侧栏 Skill 组。
       理由：评估与运行是两条不同的动线——运行看「谁在跑、跑得怎么样」，评估管「用例集 +
       历史运行」，二者没有共享筛选/读数/操作，共处一页只是多一次页签点击；拆开后本页
       自成入口，Skill 页只留目录。
       旧深链 /admin/skills?tab=prompt-eval 由 Skills 页改投到本页（?peTab= 一并带走）。 -->
  <div class="mk-page mk-page--fill">
    <MkPageHead title="Prompt 评估" sub="提示词质量评测 · 用例集与历史运行">
      <template #actions>
        <!-- running：批量/试跑期间互斥禁用，防止并发多批真实 LLM 调用重复烧 token -->
        <button
          type="button"
          class="mk-btn mk-btn--primary"
          :disabled="!panel?.canRunBatch || panel?.running"
          @click="panel?.runBatch()"
        >{{ panel?.running ? '评估运行中…' : '批量跑评估' }}</button>
      </template>
    </MkPageHead>

    <!-- 读数带槽位：页头之下、面板（内含用例/历史页签）之上——与全站同一形态
         （判例 ExecLogs 带在页签之上、HealthCenter MkKpi 在页签之上）。
         面板为异步组件，chunk 未就绪时按 live 三态纪律显「…」，不落定 0。 -->
    <section class="mk-kpi-grid" aria-label="Prompt 评估统计">
      <MkKpi
        label="最近评测通过率"
        :value="panel?.kpiView?.passRateText ?? '…'"
        :tone="panel?.kpiView?.passRateTone ?? ''"
        :hint="panel?.kpiView?.passRateHint"
        :title="panel?.kpiView?.passRateTitle"
      />
      <MkKpi
        label="评估用例"
        :value="panel?.kpiView?.caseCount ?? '…'"
        :hint="panel?.kpiView?.casesHint"
        :title="panel?.kpiView?.casesTitle"
      />
      <MkKpi
        label="启用用例"
        :value="panel?.kpiView?.enabledCaseCount ?? '…'"
        :title="`启用中的评估用例数。停用用例仍保留但不参与批量评测${panel?.kpiView?.disabledCaseCount != null ? ` · 当前停用 ${panel?.kpiView?.disabledCaseCount} 个` : ''}`"
      />
      <MkKpi
        label="评估历史"
        :value="panel?.kpiView?.runCount ?? '…'"
        :hint="panel?.kpiView?.runsHint"
        :title="panel?.kpiView?.runsTitle"
      />
    </section>

    <PromptEvalPanel ref="panel" />
  </div>
</template>

<script setup lang="ts">
import { defineAsyncComponent, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import MkKpi from '@/components/mk/MkKpi.vue'

/* 面板动作面（defineExpose）：页头「批量跑评估」的禁用态与点击、读数带取值经模板 ref 驱动。
   与折叠进 Skills 宿主时的契约一致（面板自身不再渲染读数带，避免两条带同屏）。 */
interface PromptEvalPanelExpose {
  running: boolean
  canRunBatch: boolean
  runBatch: () => Promise<void>
  kpiView: {
    passRateText: string
    passRateTone: 'ok' | 'warn' | 'bad' | 'muted' | ''
    passRateHint: string
    passRateTitle: string
    caseCount: number | string
    casesHint: string
    casesTitle: string
    enabledCaseCount: number | string
    disabledCaseCount: number | string
    runCount: number | string
    runsHint: string
    runsTitle: string
  }
}
const panel = ref<PromptEvalPanelExpose | null>(null)
const PromptEvalPanel = defineAsyncComponent(() => import('./PromptEvalPanel.vue'))

/* 旧页内键兼容（2026-10-25 拆页）：原独立页用 ?tab=cases|runs 寻址，2026-10-04 折入 skills 时
   改名为 ?peTab=。拆回独立页后两种写法都可能出现在旧书签里，统一收敛到 ?peTab=——
   本页 ?tab= 不再有含义，留着会与宿主键混淆。 */
const route = useRoute()
const router = useRouter()
onMounted(() => {
  const legacy = typeof route.query.tab === 'string' ? route.query.tab : ''
  if (legacy !== 'cases' && legacy !== 'runs') return
  const rest = { ...(route.query as Record<string, string>) }
  delete rest.tab
  void router.replace({ path: '/admin/prompt-eval', query: { ...rest, peTab: legacy } })
})
</script>
