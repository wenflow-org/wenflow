<template>
  <div class="mk-page">
    <!-- 状态条：标题 + 全局关键指标（紧凑单行） -->
    <div class="mk-status" :class="`mk-status--${statusTone}`">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">编排结构</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">{{ stages.length }} 阶段 · {{ totalSkills }} 个 Skill</span>
      <span class="mk-status__meta">总调用 {{ totalCalls }}</span>
      <span v-if="unresolvedCount > 0" class="mk-status__meta mk-status__meta--bad">未解析 {{ unresolvedCount }}</span>
      <span v-if="w4Drifted.length" class="mk-status__meta mk-status__meta--bad">哈希漂移 {{ w4Drifted.length }}</span>
      <span class="mk-status__actions">
        <button type="button" class="mk-status__action" :disabled="defsLoading" @click="loadDefinitions">刷新</button>
      </span>
    </div>

    <!-- 阶段导航：五个 tab = 五个阶段（浏览 + 编辑 + 治理都在阶段工作区内） -->
    <div class="orch-stage-tabs" role="tablist">
      <button
        v-for="s in stages"
        :key="s.id"
        type="button"
        class="orch-stage-tab"
        :class="{ 'is-active': viewMode === 'stage' && active === s.id }"
        @click="selectStage(s.id)"
      >
        <span class="orch-stage-tab__name">{{ s.name.replace(/阶段$/, '') }}</span>
        <span class="orch-stage-tab__meta">{{ s.skills.length }} Skill · {{ stageCalls(s) }} 调用</span>
      </button>
    </div>

    <!-- 沙盘：深链 ?tab=sandbox / 次要入口（契约对照，独立工作流） -->
    <div v-if="viewMode === 'sandbox'" class="orch-tabpane">
      <div class="orch-pane-head">
        <strong class="orch-pane-title">沙盘契约</strong>
        <span class="orch-pane-hint">Agent 输入通道 / 输出字段对照（仿真调试参考）</span>
        <span class="orch-pane-spacer"></span>
        <button type="button" class="orch-pane-back" @click="viewMode = 'stage'">返回阶段</button>
      </div>
      <SandboxView />
    </div>

    <!-- 阶段工作区：流转图（浏览）+ 字段路由（编辑，默认收起）+ 治理（查证） -->
    <template v-else-if="current">
      <FieldFlowGraph
        :key="flowKey"
        :stage="active"
        @changed="onRoutingChanged"
        @stage="onStageChange"
      />
      <details class="orch-fold">
        <summary class="orch-fold__summary">
          字段路由与编排文件
          <span class="orch-fold__meta">{{ current.skills.length }} Skill · 点开批量查阅 / 编辑编排 YAML</span>
        </summary>
        <div class="orch-fold__body">
          <FieldRoutingTable :stage="active" @changed="onRoutingChanged" />
        </div>
      </details>
      <details class="orch-fold" :open="governOpen">
        <summary class="orch-fold__summary">
          治理：漂移报告 + 变更审计
          <span class="orch-fold__meta">编辑后核对文件与库一致</span>
        </summary>
        <div class="orch-fold__body">
          <DriftAuditPanel :stage="active" />
        </div>
      </details>
    </template>
    <div v-else class="orch-tabpane"><p class="mk-empty">暂无编排阶段数据</p></div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { dataSource } from './store'
import { liveTopoNodes, liveSkillCatalog, errMsg } from './live'
import { adminRuntimeDefinitionsApi, adminFieldRoutingsApi, adminSkillsApi, type SkillReconciliationReport } from '@/api/adminApi'
import FieldRoutingTable from './FieldRoutingTable.vue'
import FieldFlowGraph from './FieldFlowGraph.vue'
import SandboxView from './SandboxView.vue'
import DriftAuditPanel from './DriftAuditPanel.vue'

const viewMode = ref<'stage' | 'sandbox'>('stage')
/** 编辑页内治理折叠区（漂移/审计）：?tab=drift 深链时自动展开 */
const governOpen = ref(false)

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

/** ?stage=&tab= 直达（Skill 设计页字段路由 tab → 编排结构页跳转闭环；旧 /admin/topology 重定向落位阶段视图） */
function applyStageQuery() {
  const qStage = typeof route.query.stage === 'string' && route.query.stage.trim() ? route.query.stage.trim() : ''
  const qTab = typeof route.query.tab === 'string' ? route.query.tab : ''
  if (qStage) active.value = qStage
  // 阶段工作区模式：浏览/编辑/治理都在阶段内；仅沙盘保留独立 pane
  if (qTab === 'sandbox') viewMode.value = 'sandbox'
  else if (qTab === 'drift') governOpen.value = true
  // topology / field-routings / routing / workbench 深链 → 落阶段视图（阶段内含图+表+治理）
}

function selectStage(id: string) {
  active.value = id
  viewMode.value = 'stage'
  flowKey.value++
}

const defsLoading = ref(false)
const defsLoaded = ref(false)
const orchCount = ref(0)
const skillDefCount = ref(0)
const definitionNotes = ref<string[]>([])
const orchDefs = ref<Array<Record<string, any>>>([])
// selectStage 由阶段泳道快捷入口调用（保留语义：切阶段 + 回主视图）
void selectStage

/* ================= 完成度对账（reconciliation + readiness W4，live-only） ================= */
const recReport = ref<SkillReconciliationReport | null>(null)
const w4Drifted = ref<string[]>([])

async function loadReconciliation() {
  const [rec, read] = await Promise.all([
    adminSkillsApi.getReconciliation().catch(() => null),
    adminSkillsApi.getReadiness(false).catch(() => null),
  ])
  recReport.value = rec?.data?.data ?? null
  const checks = (read?.data?.data as { checks?: { W4?: { drifted?: string[] } } } | undefined)?.checks
  w4Drifted.value = checks?.W4?.drifted || []
}

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

interface SkillNode { id: string; name: string; calls: number; produces: string[] }
interface DefStep { step: number; role?: string; condition?: string; loopOver?: string; agentId?: string; resolved?: { displayName?: string; kind?: string; nodeKind?: string; unresolved?: boolean } }
interface Stage {
  id: string
  name: string
  agentId: string
  consumes: string[]
  produces: string[]
  skills: SkillNode[]
  defSteps?: DefStep[]
}

const active = ref('goal')
applyStageQuery()
watch(() => route.query, applyStageQuery)
const defById = computed(() => new Map(orchDefs.value.map((d) => [d.id, d])))// 阶段清单统一后端源：GET /admin/field-routings/stages（派生自编排文件），
// 全量消费、不过滤后端结果
const stageList = ref<Array<{ id: string; displayName: string }>>([])

async function loadStages() {
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
        calls: node.stats.totalCalls,
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
      consumes: allInputs.slice(0, 5),
      produces: allOutputs.slice(0, 5),
      skills,
      defSteps: def?.steps || []
    }
  })
})

const totalSkills = computed(() => stages.value.reduce((sum, stage) => sum + stage.skills.length, 0))
const totalCalls = computed(() => stages.value.reduce((sum, st) => sum + stageCalls(st), 0))
const unresolvedCount = computed(() =>
  stages.value.reduce(
    (sum, st) => sum + (st.defSteps || []).filter((d) => d.resolved?.unresolved).length,
    0
  )
)
// 空拓扑时 current 为 undefined，模板由 v-if="current" 保护
const current = computed<Stage | undefined>(() => stages.value.find((s) => s.id === active.value) || stages.value[0])
const stageCalls = (st: Stage) => st.skills.reduce((sum, s) => sum + (s.calls || 0), 0)
// 概览卡结论点色/标题（唯一动态状态载体；状态条只剩身份 + 数量）
const statusTone = computed(() => {
  if (!stages.value.length) return 'muted'
  const unresolved = stages.value.some((s) => s.defSteps?.some((d) => d.resolved?.unresolved))
  return unresolved ? 'warn' : 'ok'
})
// 后端阶段名已含"阶段"（如"Goal 阶段"），避免重复拼接
const stageTitle = computed(() => {
  const name = current.value?.name || ''
  return name.endsWith('阶段') ? name : `${name}阶段`
})
void stageTitle.value
</script><style scoped>
/* 阶段导航：五个 tab = 五个阶段（大分段卡，每卡含阶段名 + Skill/调用概要） */
.orch-stage-tabs {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 6px;
  margin: 10px 0 12px;
}
.orch-stage-tab {
  display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
  padding: 9px 14px;
  border: 1px solid var(--mk-line); border-radius: 10px;
  background: var(--mk-surface); font: inherit; text-align: left;
  cursor: pointer;
  transition: border-color 0.12s ease, box-shadow 0.12s ease, background 0.12s ease;
}
.orch-stage-tab:hover { border-color: color-mix(in srgb, var(--mk-blue) 45%, var(--mk-line)); }
.orch-stage-tab.is-active {
  border-color: var(--mk-blue);
  background: rgba(44, 99, 208, 0.08);
  box-shadow: 0 2px 8px rgba(44, 99, 208, 0.12);
}
.orch-stage-tab__name { font-size: 13px; font-weight: 800; color: var(--mk-ink); }
.orch-stage-tab.is-active .orch-stage-tab__name { color: var(--mk-blue); }
.orch-stage-tab__meta { font-size: 10.5px; font-weight: 600; color: var(--mk-faint); font-variant-numeric: tabular-nums; }

/* 折叠层（字段路由 / 治理）：阶段工作区的查阅层，默认收起 */
.orch-fold {
  margin-top: 12px;
  border: 1px solid var(--mk-line); border-radius: 10px;
  background: var(--mk-surface);
}
.orch-fold__summary {
  padding: 10px 14px;
  display: flex; align-items: center; gap: 10px;
  font-size: 12px; font-weight: 800; color: var(--mk-muted);
  cursor: pointer; user-select: none;
  list-style: none;
}
.orch-fold__summary::-webkit-details-marker { display: none; }
.orch-fold__summary::before { content: '▸ '; color: var(--mk-blue); }
details[open].orch-fold .orch-fold__summary::before { content: '▾ '; }
.orch-fold__summary:hover { color: var(--mk-blue); }
.orch-fold__meta { font-size: 11px; font-weight: 600; color: var(--mk-faint); }
.orch-fold__body { padding: 0 14px 14px; }

/* 沙盘（深链次要入口）顶部条 */
.orch-pane-head {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; margin-bottom: 10px;
  background: var(--mk-surface); border: 1px solid var(--mk-line); border-radius: 10px;
}
.orch-pane-title { font-size: 13px; font-weight: 800; color: var(--mk-ink); }
.orch-pane-hint { font-size: 11.5px; color: var(--mk-faint); }
.orch-pane-spacer { flex: 1; }
.orch-pane-back {
  padding: 5px 12px; border: 1px solid var(--mk-line); border-radius: 8px;
  background: var(--mk-surface); font: inherit; font-size: 11.5px; font-weight: 700;
  color: var(--mk-muted); cursor: pointer;
}
.orch-pane-back:hover { color: var(--mk-blue); border-color: var(--mk-blue); }

/* 4K：阶段导航与折叠层跟随全站节奏 */
@media (min-width: 2000px) {
  .orch-stage-tab { padding: 11px 16px; }
  .orch-stage-tab__name { font-size: 14.5px; }
  .orch-stage-tab__meta { font-size: 12px; }
  .orch-fold__summary { padding: 12px 16px; font-size: 13.5px; }
  .orch-fold__meta { font-size: 12.5px; }
  .orch-fold__body { padding: 0 16px 16px; }
  .orch-pane-head { padding: 12px 16px; }
  .orch-pane-title { font-size: 14.5px; }
  .orch-pane-hint { font-size: 13px; }
  .orch-pane-back { font-size: 13px; padding: 6px 14px; }
}
@media (min-width: 2800px) {
  .orch-stage-tab { padding: 13px 19px; }
  .orch-stage-tab__name { font-size: 17px; }
  .orch-stage-tab__meta { font-size: 14px; }
  .orch-fold__summary { padding: 14px 19px; font-size: 16px; }
  .orch-fold__meta { font-size: 14.5px; }
  .orch-fold__body { padding: 0 19px 19px; }
  .orch-pane-head { padding: 14px 19px; }
  .orch-pane-title { font-size: 17px; }
  .orch-pane-hint { font-size: 15px; }
  .orch-pane-back { font-size: 15.5px; padding: 7px 17px; }
}
@media (min-width: 3600px) {
  .orch-stage-tab { padding: 15px 22px; }
  .orch-stage-tab__name { font-size: 20px; }
  .orch-stage-tab__meta { font-size: 16.5px; }
  .orch-fold__summary { padding: 16px 22px; font-size: 18.5px; }
  .orch-fold__meta { font-size: 17px; }
  .orch-fold__body { padding: 0 22px 22px; }
  .orch-pane-head { padding: 16px 22px; }
  .orch-pane-title { font-size: 20px; }
  .orch-pane-hint { font-size: 17.5px; }
  .orch-pane-back { font-size: 18px; padding: 8px 20px; }
}

/* ================= 暗色模式（D1 补完）：编排结构 ================= */
html[data-theme='dark'] {

  /* 阶段 tab 大分段卡 */
  .orch-stage-tab { background: #141c2b; border-color: #232f45; }
  .orch-stage-tab:hover { border-color: color-mix(in srgb, var(--mk-blue) 45%, #2a3850); }
  .orch-stage-tab.is-active {
    background: rgba(91, 141, 239, 0.16);
    border-color: var(--mk-blue);
    box-shadow: 0 2px 8px rgba(44, 99, 208, 0.22);
  }

  /* 折叠层（字段路由 / 治理） */
  .orch-fold { background: #141c2b; border-color: #232f45; }
  .orch-fold__summary { color: #9fb0c8; }
  .orch-fold__summary:hover { color: var(--mk-blue); }

  /* 沙盘顶部条返回按钮 */
  .orch-pane-back { background: #17202f; border-color: #232f45; color: #9fb0c8; }
  .orch-pane-back:hover { color: var(--mk-blue); border-color: var(--mk-blue); }
}
</style>
