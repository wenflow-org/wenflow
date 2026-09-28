<template>
  <div class="mk-page mk-page--fill">
    <!-- 状态条：标题 + 全局关键指标（紧凑单行）——chrome 固定 -->
    <div class="mk-status" :class="`mk-status--${statusTone}`">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">编排图</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">{{ pageLoading ? '—' : stages.length }} 阶段 · {{ pageLoading ? '—' : totalSkills }} 个 Skill</span>
      <span v-if="unresolvedCount > 0" class="mk-status__meta mk-status__meta--bad">未解析 {{ unresolvedCount }}</span>
      <span v-if="w4Drifted.length" class="mk-status__meta mk-status__meta--bad">{{ TERMS.driftHashQualified }} {{ w4Drifted.length }}</span>
      <span class="mk-status__actions">
        <!-- 刷新此前只重拉 definitions， stages / 对账仍是旧值（治理面板数字对不上）→ 三个域全拉 -->
        <button type="button" class="mk-status__action" :disabled="refreshing" @click="refreshAll">{{ refreshing ? '刷新中…' : '刷新' }}</button>
      </span>
    </div>

    <!-- 阶段导航：五个 tab = 五个阶段（浏览 + 编辑 + 治理都在阶段工作区内）——chrome 固定 -->
    <div class="orch-stage-tabs" role="tablist">
      <button
        v-for="s in stages"
        :key="s.id"
        type="button"
        class="orch-stage-tab"
        :class="{ 'is-active': pane !== 'sandbox' && active === s.id }"
        :title="stageTabTitle(s)"
        @click="selectStage(s.id)"
      >
        <span class="orch-stage-tab__name">{{ s.name.replace(/阶段$/, '') }}</span>
        <span class="orch-stage-tab__meta">{{ s.skills.length }} Skill</span>
      </button>
    </div>

    <!-- 子面板 pills：四个面板统一可达（此前非沙盘视图不显示沙盘 pill，只能深链进入）——chrome 固定 -->
    <div class="mk-pills orch-pane-tabs" role="tablist">
      <button v-for="pt in ORCH_PANES" :key="pt.id" type="button" role="tab"
        class="mk-pill" :class="{ 'mk-pill--active': pane === pt.id }"
        :aria-selected="pane === pt.id" @click="pane = pt.id">{{ pt.label }}</button>
    </div>

    <!-- 阶段工作区：占满剩余视高（fill 布局，底部不再有空白）。
         旅程图 = 卡内画布滚动（工具条/旅程条吸顶）；路由/治理/沙盘 = 面板内滚；页面本身不滚 -->
    <DataFlowGraph
      v-if="current && pane === 'journey'"
      class="orch-pane orch-pane--journey"
      :key="`${active}-${flowKey}`"
      :stage="active"
      @changed="onRoutingChanged"
      @stage="onStageChange"
    />
    <section v-else-if="current && pane === 'routing'" class="mk-card mk-card--fill orch-pane orch-routing">
      <div class="mk-card__head">
        <h3 class="mk-card__title">字段路由与编排文件</h3>
        <!-- 阶段级变量流：截断只显示前 5 项，必须把总数说出来（此前静默 slice） -->
        <span class="mk-card__meta" :title="ioContractTitle(current)">
          {{ current.skills.length }} Skill · 输入 {{ current.consumes.length }}/{{ current.consumesTotal }} 字段 · 输出 {{ current.produces.length }}/{{ current.producesTotal }} 字段
        </span>
      </div>
      <FieldRoutingTable :stage="active" @changed="onRoutingChanged" />
    </section>
    <section v-else-if="current && pane === 'governance'" class="mk-card mk-card--fill orch-pane orch-pane--scroll">
      <div class="mk-card__head">
        <h3 class="mk-card__title">治理：{{ TERMS.driftContract }}报告 + 变更审计</h3>
        <!-- 运行时定义与对账口径落到治理面板：orchCount/skillDefCount/recReport 此前只写不读 -->
        <span class="mk-card__meta" :title="govMetaTitle">
          编辑后核对文件与库一致 · 编排定义 {{ orchCount }} · Skill 定义 {{ skillDefCount }}<template v-if="recReport"> · 对账已上线 {{ recLiveCount }}/{{ recTotalCount }}</template>
        </span>
      </div>
      <!-- 定义明细（definitionNotes 此前只写不读，两个定义接口等于白拉） -->
      <ul v-if="definitionNotes.length" class="orch-gov-defs">
        <li v-for="(n, i) in definitionNotes" :key="i" class="orch-gov-defs__item">{{ n }}</li>
      </ul>
      <DriftAuditPanel :stage="active" />
    </section>
    <div v-else-if="pane === 'sandbox'" class="orch-pane orch-pane--scroll">
      <SandboxView />
    </div>
    <div v-else class="orch-pane orch-pane--center">
      <!-- 首屏骨架：此前是居中小 spinner，4K 下整页空白只挂一行字 -->
      <template v-if="pageLoading">
        <MockSkeletonTable :cols="6" :rows="8" />
        <MkLoading text="编排数据加载中…" />
      </template>
      <!-- 接口失败 ≠ 没有数据：此前拓扑/阶段拉取失败也落「暂无编排阶段数据」，
           管理员无从判断是该重试还是后端本就为空 -->
      <MkEmptyState
        v-else-if="topoFailure"
        tone="error"
        icon="⚠"
        title="编排阶段数据加载失败"
        :description="topoFailure"
        action-text="重试"
        @action="retryStages"
      />
      <MkEmptyState
        v-else
        title="暂无编排阶段数据"
        description="后端未登记任何阶段：编排文件与拓扑 Agent 均为空。"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { dataSource } from './store'
import { liveTopoNodes, liveSkillCatalog, liveLoading, liveFailures, errMsg, reloadLiveTopology } from './live'
import { TERMS } from './terms'
import { adminRuntimeDefinitionsApi, adminFieldRoutingsApi, adminSkillsApi, type SkillReconciliationReport } from '@/api/adminApi'
import FieldRoutingTable from './FieldRoutingTable.vue'
import DataFlowGraph from './DataFlowGraph.vue'
import SandboxView from './SandboxView.vue'
import DriftAuditPanel from './DriftAuditPanel.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkLoading from '@/components/mk/MkLoading.vue'
import MockSkeletonTable from './SkeletonTable.vue'

/** 阶段工作区子面板:字段旅程(默认)/字段路由/治理;沙盘为顶层独立面板(深链 ?tab=sandbox 兼容) */
type OrchPane = 'journey' | 'routing' | 'governance' | 'sandbox'
const ORCH_PANES: Array<{ id: OrchPane; label: string }> = [
  { id: 'journey', label: '字段旅程' },
  { id: 'routing', label: '字段路由' },
  { id: 'governance', label: '治理' },
  { id: 'sandbox', label: '沙盘契约' },
]
const pane = ref<OrchPane>('journey')

/** 字段流转图数据版本：行级编辑/字段路由变更后 +1 触发重挂载刷新 */
const flowKey = ref(0)
function onRoutingChanged() {
  flowKey.value++
}
/** 图内锚点跳转切阶段：同步 active（tab 高亮跟随） */
function onStageChange(s: string) {
  active.value = s
}

const route = useRoute()
const router = useRouter()

/** ?stage=&tab= 直达（Skill 设计页字段路由 tab → 编排图页跳转闭环；旧 /admin/topology 重定向落位阶段视图） */
function applyStageQuery() {
  const qStage = typeof route.query.stage === 'string' && route.query.stage.trim() ? route.query.stage.trim() : ''
  const qTab = typeof route.query.tab === 'string' ? route.query.tab : ''
  if (qStage) active.value = qStage
  // ?tab= 语义:journey(缺省)/routing/governance/sandbox;legacy:drift→治理,topology→旅程
  if (qTab === 'sandbox') pane.value = 'sandbox'
  else if (qTab === 'routing') pane.value = 'routing'
  else if (qTab === 'governance' || qTab === 'drift') pane.value = 'governance'
  else if (qTab === 'journey' || qTab === 'topology') pane.value = 'journey'

}

function selectStage(id: string) {
  active.value = id
  if (pane.value === 'sandbox') pane.value = 'journey'
  flowKey.value++
}

const defsLoading = ref(false)
const defsLoaded = ref(false)
/** 阶段清单端点拉取中（与 defsLoading / recLoading 共同驱动状态条「刷新」忙碌态） */
const stagesLoading = ref(false)
const orchCount = ref(0)
const skillDefCount = ref(0)
const definitionNotes = ref<string[]>([])
const orchDefs = ref<Array<Record<string, any>>>([])

/* ================= 完成度对账（reconciliation + readiness W4，live-only） ================= */
const recReport = ref<SkillReconciliationReport | null>(null)
const w4Drifted = ref<string[]>([])
/** 对账拉取中（供「刷新」按钮统一忙碌态） */
const recLoading = ref(false)

async function loadReconciliation() {
  recLoading.value = true
  try {
    const [rec, read] = await Promise.all([
      adminSkillsApi.getReconciliation().catch(() => null),
      adminSkillsApi.getReadiness(false).catch(() => null),
    ])
    recReport.value = rec?.data?.data ?? null
    const checks = (read?.data?.data as { checks?: { W4?: { drifted?: string[] } } } | undefined)?.checks
    w4Drifted.value = checks?.W4?.drifted || []
  } finally {
    recLoading.value = false
  }
}

/** 对账口径（治理面板）：已上线 = status=live 的行数 / 登记总数 */
const recLiveCount = computed(() => recReport.value?.summary.byStatus?.live ?? 0)
const recTotalCount = computed(() => recReport.value?.summary.total ?? 0)

async function loadDefinitions() {
  defsLoading.value = true
  try {
    const [orchRes, agentRes] = await Promise.all([
      adminRuntimeDefinitionsApi.getOrchestratorDefinitions(),
      adminRuntimeDefinitionsApi.getAgentDefinitions()
    ])
    const orchBody = orchRes.data?.data ?? orchRes.data ?? []
    const agentBody = agentRes.data?.data ?? agentRes.data ?? []
    const orchItems = Array.isArray(orchBody) ? orchBody : orchBody.items || orchBody.orchestrators || []
    // 后端 getAgentDefinitions 返回的是 skill 条目（含 agent 归属），计数口径为 Skill 定义数
    const skillItems = Array.isArray(agentBody) ? agentBody : agentBody.items || agentBody.agents || []
    orchCount.value = orchItems.length
    skillDefCount.value = skillItems.length
    orchDefs.value = orchItems
    definitionNotes.value = [
      ...orchItems.slice(0, 6).map((o: Record<string, unknown>) =>
        `编排 ${String(o.id || o.name || '—')} · ${String(o.title || o.label || o.description || '').slice(0, 48)}`
      ),
      ...skillItems.slice(0, 6).map((a: Record<string, unknown>) =>
        `Skill ${String(a.id || a.skillId || '—')} · ${String(a.name || a.title || '').slice(0, 40)}`
      )
    ]
    defsLoaded.value = true
  } catch (e) {
    definitionNotes.value = [`定义拉取失败：${errMsg(e)}`]
  } finally {
    defsLoading.value = false
  }
}

onMounted(() => {
  void loadDefinitions()
  void loadReconciliation()
  void loadStages()
})
// 阶段清单与运行时定义按真实源拉取（初始 onMounted 时后端可能尚未就绪，切换后重试）
watch(dataSource, () => {
  void loadStages()
  if (!defsLoaded.value) void loadDefinitions()
  if (!recReport.value) void loadReconciliation()
})

/** 状态条「刷新」：三个域（阶段清单 / 运行时定义 / 对账）全拉，避免只刷一半 */
const refreshing = computed(() => defsLoading.value || stagesLoading.value || recLoading.value)
async function refreshAll() {
  if (refreshing.value) return
  await Promise.all([loadDefinitions(), loadStages(), loadReconciliation()])
}

interface SkillNode { id: string; name: string; produces: string[] }
interface DefStep { step: number; role?: string; condition?: string; loopOver?: string; agentId?: string; resolved?: { displayName?: string; kind?: string; nodeKind?: string; unresolved?: boolean } }
interface Stage {
  id: string
  name: string
  agentId: string
  consumes: string[]
  produces: string[]
  /** 阶段级变量流总数（consumes/produces 本身最多显示前 5 项） */
  consumesTotal: number
  producesTotal: number
  skills: SkillNode[]
  defSteps?: DefStep[]
}

const active = ref('goal')
/* 阶段/子面板变化回写 ?stage=&tab=(对齐全站"切换可寻址"约定;此前只读深链,
   刷新丢失所在阶段与子面板)。journey 为缺省档,不占 URL。 */
watch([active, pane], ([s, p]) => {
  const curStage = typeof route.query.stage === 'string' ? route.query.stage : ''
  const curTab = typeof route.query.tab === 'string' ? route.query.tab : ''
  const wantTab = p !== 'journey' ? p : ''
  if (s === curStage && curTab === wantTab) return
  const q: Record<string, string> = { ...(route.query as Record<string, string>), stage: s }
  if (wantTab) q.tab = wantTab
  void router.replace({ query: q })
})
applyStageQuery()
watch(() => route.query, applyStageQuery)
const defById = computed(() => new Map(orchDefs.value.map((d) => [d.id, d])))// 阶段清单统一后端源：GET /admin/field-routings/stages（派生自编排文件），
// 全量消费、不过滤后端结果
const stageList = ref<Array<{ id: string; displayName: string }>>([])

async function loadStages() {
  stagesLoading.value = true
  try {
    const res = await adminFieldRoutingsApi.getStages()
    const stages = res.data?.data?.stages || []
    if (stages.length) {
      stageList.value = stages
      if (!stages.some((s: { id: string }) => s.id === active.value)) {
        active.value = stages[0].id
      }
    }
  } catch {
    // 端点不可用：stageList 置空（由拓扑 Agent 节点派生，仍为真实数据）
    stageList.value = []
  } finally {
    stagesLoading.value = false
  }
}

const stages = computed<Stage[]>(() => {
  // 拓扑未就绪（为空/拉取失败）时返回空数组，渲染空态
  if (!liveTopoNodes.value.length) return []

  // 阶段清单以 GET stages（编排文件派生）为准，无白名单过滤；
  // 该端点失败时退化为拓扑 Agent 节点派生（仍为真实数据）。
  // stage → 顶层 Agent 的约定映射 <stage>-agent 与后端 STAGE_AGENT_MAP 同源
  // （每个编排文件 contracts 中 manifest kind=agent 者均为 <stage>-agent）；
  // 拓扑中查不到 Agent 的阶段仍展示（真实字段路由 tab 可用），成员列表为空。
  const list = stageList.value.length
    ? stageList.value
    : liveTopoNodes.value
        .filter((n) => n.type === 'agent')
        .map((n) => ({ id: n.id.replace(/-agent$/, ''), displayName: n.label }))
  return list.map((s) => {
    const agentId = `${s.id}-agent`
    const members = liveTopoNodes.value.filter(
      (n) => n.type === 'skill' && n.parentAgentId === agentId
    )
    // 真实变量流：来自 prompt-ops skill-catalog 的 input/output 字段
    const catalogAgent = liveSkillCatalog.value.find((a) => a.agentId === agentId)
    const catalogById = new Map((catalogAgent?.skills || []).map((c) => [c.skillId, c]))
    const skills = members.map((node) => {
      const id = node.id.replace(/^skill:/, '')
      const catalog = catalogById.get(id)
      return {
        id,
        name: node.label.replace(/ Skill$/, ''),
        produces: catalog?.outputFields || []
      }
    })
    // 阶段级变量：下辖 Skill 输入 = 消费，输出 = 产出
    const allInputs = [...new Set(skills.flatMap((skill) => catalogById.get(skill.id)?.inputFields || []))]
    const allOutputs = [...new Set(skills.flatMap((skill) => skill.produces))]
    // 定义级步骤（编排定义实时编译，含 role/condition/loopOver/resolved）
    const def = defById.value.get(agentId)
    return {
      id: s.id,
      name: s.displayName,
      agentId,
      // 截断到前 5 项，但总数随数据带出（面板/ tooltip 报「共 N 项」）
      consumes: allInputs.slice(0, 5),
      produces: allOutputs.slice(0, 5),
      consumesTotal: allInputs.length,
      producesTotal: allOutputs.length,
      skills,
      defSteps: def?.steps || []
    }
  })
})

const totalSkills = computed(() => stages.value.reduce((sum, stage) => sum + stage.skills.length, 0))
const unresolvedCount = computed(() =>
  stages.value.reduce(
    (sum, st) => sum + (st.defSteps || []).filter((d) => d.resolved?.unresolved).length,
    0
  )
)
// 空拓扑时 current 为 undefined，模板由 v-if="current" 保护
const current = computed<Stage | undefined>(() => stages.value.find((s) => s.id === active.value) || stages.value[0])
// 首屏加载中（live boot 未完成且尚无阶段数据）：用于抑制「0 阶段 / 暂无数据」的假空态
const pageLoading = computed(() => liveLoading.value && !stages.value.length)
// 概览卡结论点色/标题（唯一动态状态载体；状态条只剩身份 + 数量）
const statusTone = computed(() => {
  if (!stages.value.length) return 'muted'
  const unresolved = stages.value.some((s) => s.defSteps?.some((d) => d.resolved?.unresolved))
  return unresolved ? 'warn' : 'ok'
})

/* ================= 失败态：接口失败 ≠ 没有数据 =================
   阶段清单依赖 live boot 的 topology 域（liveFailures.topology）。
   该域失败时 liveTopoNodes 为空 → stages 为空，此前与「后端本就没数据」
   同落「暂无编排阶段数据」，把接口失败伪装成空态；这里区分并给重试。 */
const topoFailure = computed(() => liveFailures.value.topology || '')

async function retryStages() {
  await Promise.all([
    loadStages(),
    reloadLiveTopology()
      .then(() => { delete liveFailures.value.topology })
      // 仍失败：保留 liveFailures.topology，错误态继续给原因 + 可再次重试
      .catch(() => undefined)
  ])
}

/** 阶段 tab tooltip：skills=0 时说明去向（此前 tab 只显示「0 Skill」，无从判断是真空还是没拉到） */
function stageTabTitle(s: Stage): string {
  if (!s.skills.length) return '该阶段下辖 0 个 Skill：可能调度树未登记，或拓扑 / 目录尚未拉取成功'
  return `${s.name}：${s.skills.length} 个 Skill`
}

/** 字段路由卡头 tooltip：阶段级变量流总量（截断前口径） */
function ioContractTitle(s: Stage): string {
  return `阶段级变量流来自下辖 Skill 的输入/输出字段（去重）；输入、输出各最多显示前 5 项，共 ${s.consumesTotal} 输入 / ${s.producesTotal} 输出`
}

/** 治理卡头 tooltip：定义与对账口径说明 */
const govMetaTitle = computed(() =>
  [
    '运行时定义：GET /admin/runtime-definitions（orchestrator / agent 两类）',
    recReport.value ? `对账：已上线 ${recLiveCount.value} / 登记 ${recTotalCount.value}（口径含外挂能力）` : '对账报告不可用'
  ].join('；')
)
</script><style scoped>
/* 治理面板：运行时定义明细（definitionNotes，micro 列表，不抢漂移报告的视觉重心） */
.orch-gov-defs {
  margin: 0 0 10px;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 3px;
}
.orch-gov-defs__item {
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
  line-height: 1.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 阶段导航：五个 tab = 五个阶段（大分段卡，每卡含阶段名 + Skill/调用概要） */
.orch-pane-tabs { margin-bottom: 2px; }
/* ===== 阶段工作区（fill 布局：占满剩余视高，底部不再留空白；面板各自内滚，页面不滚） ===== */
.orch-pane { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.orch-pane--scroll { overflow-y: auto; }
.orch-pane--center { justify-content: center; }
/* 字段路由：卡头 + 工具条吸顶，仅表格区内滚（.frt__scroll 自带 .mk-table-scroll 横向滚动） */
.orch-routing .frt { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow-y: auto; }
.orch-routing .frt__scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
/* fill 布局下阶段导航的外边距由页面 gap（12px）接管 */
.mk-page--fill .orch-stage-tabs { margin: 0; }

.orch-stage-tabs {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 6px;
  margin: 10px 0 12px;
}
.orch-stage-tab {
  display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
  padding: 9px 14px;
  border: 1px solid var(--mk-line); border-radius: var(--mk-radius-xl);
  background: var(--mk-surface); font: inherit; text-align: left;
  cursor: pointer;
  transition: border-color 0.12s ease, box-shadow 0.12s ease, background 0.12s ease;
}
.orch-stage-tab:hover { border-color: color-mix(in srgb, var(--mk-blue) 45%, var(--mk-line)); }
.orch-stage-tab.is-active {
  border-color: var(--mk-blue);
  background: rgba(44, 99, 208, 0.08);
  box-shadow: inset 0 0 0 1px var(--mk-blue);
}
.orch-stage-tab__name { font-size: var(--mk-fs-body); font-weight: 800; color: var(--mk-ink); }
.orch-stage-tab.is-active .orch-stage-tab__name { color: var(--mk-blue); }
.orch-stage-tab__meta { font-size: var(--mk-fs-micro); font-weight: 600; color: var(--mk-faint); font-variant-numeric: tabular-nums; }

/* 折叠层（字段路由 / 治理）：阶段工作区的查阅层，默认收起 */
/* 折叠头走 .mk-section__summary（shared.css） */

/* 沙盘（深链次要入口）顶部条 */

/* 4K：阶段导航与折叠层跟随全站节奏 */
@media (min-width: 2000px) {
  .orch-stage-tab { padding: 11px 16px; }
  .orch-stage-tab__name { font-size: var(--mk-fs-body); }
  .orch-stage-tab__meta { font-size: var(--mk-fs-micro); }
}
@media (min-width: 2800px) {
  .orch-stage-tab { padding: 13px 19px; }
  .orch-stage-tab__name { font-size: var(--mk-fs-body); }
  .orch-stage-tab__meta { font-size: var(--mk-fs-micro); }
}
@media (min-width: 3600px) {
  .orch-stage-tab { padding: 15px 22px; }
  .orch-stage-tab__name { font-size: var(--mk-fs-emphasis); }
  .orch-stage-tab__meta { font-size: var(--mk-fs-body); }
}

/* ================= 暗色模式（D1 补完）：编排图 ================= */
html[data-theme='dark'] {

  /* 阶段 tab 大分段卡 */
  .orch-stage-tab { background: #19191a; border-color: #2a2b2d; }
  .orch-stage-tab:hover { border-color: color-mix(in srgb, var(--mk-blue) 45%, #313235); }
  .orch-stage-tab.is-active {
    background: rgba(91, 141, 239, 0.16);
    border-color: var(--mk-blue);
    
  }

  /* 折叠层（字段路由 / 治理） */
  /* 折叠头基调由 .mk-section__summary--muted / :hover 提供（原 #afb1b6 即 --mk-muted 暗色值） */

  /* 沙盘顶部条返回按钮 */
}
</style>
