<template>
  <div class="mk-page">
    <!-- 状态条：标题固定「编排结构」+ 共 N + 刷新（视图切换下沉到 tab 条） -->
    <div class="mk-status" :class="`mk-status--${statusTone}`">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">编排结构</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">{{ stages.length }} 阶段 · {{ totalSkills }} 个 Skill</span>
      <span v-if="isLive && w4Drifted.length" class="mk-status__meta mk-status__meta--bad">哈希漂移 {{ w4Drifted.length }}</span>
      <span class="mk-status__spacer"></span>
      <button v-if="isLive" type="button" class="mk-status__action" :disabled="defsLoading" @click="loadDefinitions">刷新</button>
    </div>

    <!-- 编排概览（共享 MkOverview：结论头 + KPI + 阶段调用分布；动态结论只在这里） -->
    <MkOverview :tone="statusTone" :title="statusTitle" :subline="`${stages.length} 阶段 · ${totalSkills} 个 Skill`" :has-data="stages.length > 0">
      <template #kpis>
        <MkKpi label="阶段" :value="stages.length" hint="编排全链路" :title="'编排文件中的阶段数（含无拓扑产物的阶段）'" />
        <MkKpi label="Skill 节点" :value="totalSkills" :hint="`总调用 ${totalCalls}`" :title="'全部阶段的 Skill 节点数'" />
        <MkKpi label="总调用" :value="totalCalls" :hint="'实时拓扑口径'" :title="'全部阶段 Skill 调用之和（来自拓扑节点统计）'" />
        <MkKpi label="未解析" :value="unresolvedCount" :tone="unresolvedCount > 0 ? 'bad' : ''" :hint="unresolvedCount ? '定义步骤 unresolved' : '定义步骤全部解析'" :title="'编排定义中未解析的定义步骤数'" />
      </template>
      <template #detail>
        <span v-for="st in stages" :key="st.id" :title="`${st.name} · ${stageCalls(st)} 次调用`">{{ st.name.replace(/阶段$/, '') }} {{ stageCalls(st) }}</span>
      </template>
    </MkOverview>

    <!-- 页面级视图 tab：字段流转（主视图）/ 工作台 / 拓扑 / 字段路由（阶段级子视图留在展开区快捷入口） -->
    <div class="orch-tabs" role="tablist">
      <button type="button" class="orch-tab" :class="{ 'is-active': viewMode === 'main' }" @click="viewMode = 'main'">字段流转</button>
      <button type="button" class="orch-tab" :class="{ 'is-active': viewMode === 'topology' }" @click="viewMode = 'topology'">拓扑</button>
      <button type="button" class="orch-tab" :class="{ 'is-active': viewMode === 'field-routings' }" @click="viewMode = 'field-routings'">字段路由</button>
      <button type="button" class="orch-tab" :class="{ 'is-active': viewMode === 'workbench' }" @click="viewMode = 'workbench'">工作台</button>
      <button type="button" class="orch-tab" :class="{ 'is-active': viewMode === 'sandbox' }" @click="viewMode = 'sandbox'">沙盘</button>
      <button type="button" class="orch-tab" :class="{ 'is-active': viewMode === 'drift' }" @click="viewMode = 'drift'">漂移</button>
    </div>

    <div v-if="viewMode === 'workbench'" class="orch-tabpane"><PromptWorkbench embedded /></div>
    <div v-else-if="viewMode === 'topology'" class="orch-tabpane"><Topology /></div>
    <div v-else-if="viewMode === 'field-routings'" class="orch-tabpane"><FieldRoutingTable :stage="current?.id || ''" @changed="onRoutingChanged" /></div>
    <div v-else-if="viewMode === 'sandbox'" class="orch-tabpane"><SandboxView /></div>
    <div v-else-if="viewMode === 'drift'" class="orch-tabpane"><DriftAuditPanel :stage="current?.id || ''" /></div>

    <template v-else>
      <!-- 主视图 = 字段流转图：泳道（阶段）→ 字段分组 → handoff 边；字段即节点，点开看含义与编辑 -->
      <FieldFlowGraph :key="flowKey" :stage="active" @changed="onRoutingChanged" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { dataSource, isLive } from './store'
import { liveTopoNodes, liveSkillCatalog, errMsg } from './live'
import { adminRuntimeDefinitionsApi, adminFieldRoutingsApi, adminSkillsApi, type SkillReconciliationReport } from '@/api/adminApi'
import FieldRoutingTable from './FieldRoutingTable.vue'
import FieldFlowGraph from './FieldFlowGraph.vue'
import SandboxView from './SandboxView.vue'
import DriftAuditPanel from './DriftAuditPanel.vue'
import Topology from './Topology.vue'
import PromptWorkbench from './PromptWorkbench.vue'
import MkOverview from './MkOverview.vue'
import MkKpi from './MkKpi.vue'

const viewMode = ref<'main' | 'workbench' | 'topology' | 'field-routings' | 'sandbox' | 'drift'>('main')

/** 字段流转图数据版本：行级编辑/字段路由变更后 +1 触发重挂载刷新 */
const flowKey = ref(0)
function onRoutingChanged() {
  flowKey.value++
}

const route = useRoute()

/** ?stage=&tab= 直达（Skill 设计页字段路由 tab → 编排结构页跳转闭环；旧 /admin/topology 重定向落位拓扑 tab） */
function applyStageQuery() {
  const qStage = typeof route.query.stage === 'string' && route.query.stage.trim() ? route.query.stage.trim() : ''
  const qTab = typeof route.query.tab === 'string' ? route.query.tab : ''
  if (qStage) active.value = qStage
  const tabAlias = qTab === 'routing' ? 'field-routings' : qTab
  if (tabAlias === 'field-routings' || tabAlias === 'sandbox' || tabAlias === 'drift' || tabAlias === 'topology') {
    viewMode.value = tabAlias as typeof viewMode.value
  }
}

function selectStage(id: string) {
  active.value = id
  viewMode.value = 'main'
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
  if (!isLive.value) return
  const [rec, read] = await Promise.all([
    adminSkillsApi.getReconciliation().catch(() => null),
    adminSkillsApi.getReadiness(false).catch(() => null),
  ])
  recReport.value = rec?.data?.data ?? null
  const checks = (read?.data?.data as { checks?: { W4?: { drifted?: string[] } } } | undefined)?.checks
  w4Drifted.value = checks?.W4?.drifted || []
}

async function loadDefinitions() {
  if (!isLive.value) return
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
  if (isLive.value) {
    void loadDefinitions()
    void loadReconciliation()
  }
  void loadStages()
})
// demo → live 切换后：阶段清单与运行时定义需要按真实源重拉（初始 onMounted 时可能尚未切到 live）
watch(dataSource, () => {
  if (dataSource.value === 'live') {
    void loadStages()
    if (!defsLoaded.value) void loadDefinitions()
    if (!recReport.value) void loadReconciliation()
  }
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

// demo-only：离线/演示模式的阶段骨架与调用数（假数据仅 demo 模式可见）。
// live 模式（下方 stages computed 的 live 分支）完全由 API 驱动：
//   GET stages（编排文件派生）+ 拓扑节点 + skill-catalog + 编排定义，
//   不再以本清单为骨架，避免 demo 阶段/假调用数污染真实展示。
const demoStages: Stage[] = [
  {
    id: 'goal',
    name: '澄清',
    agentId: 'goal-agent',
    consumes: ['user_message'],
    produces: ['goal_understanding', 'learner_profile'],
    skills: [
      { id: 'goal-conversation', name: '目标对话', calls: 1284, produces: ['dialogue_concepts'] }
    ]
  },
  {
    id: 'path',
    name: '规划',
    agentId: 'path-agent',
    consumes: ['goal_understanding'],
    produces: ['learning_path', 'milestones'],
    skills: [
      { id: 'path-planning', name: '路径规划', calls: 640, produces: ['learning_path'] },
      { id: 'stage-designer', name: '阶段设计', calls: 498, produces: ['milestones'] }
    ]
  },
  {
    id: 'teaching',
    name: '教学',
    agentId: 'teaching-agent',
    consumes: ['learning_path', 'milestones'],
    produces: ['teaching_session', 'mastery_delta'],
    skills: [
      { id: 'teaching-turn', name: '教学回合', calls: 2210, produces: ['round_output'] },
      { id: 'peer-reinforcement', name: '伴学补强', calls: 388, produces: ['boost_note'] },
      { id: 'session-wrapup', name: '课后产出', calls: 415, produces: ['wrapup_notes'] }
    ]
  },
  {
    id: 'profile',
    name: '画像',
    agentId: 'profile-agent',
    consumes: ['mastery_delta'],
    produces: ['learner_snapshot', 'risk_signals'],
    skills: [
      { id: 'learner-model', name: '状态聚合', calls: 930, produces: ['learner_snapshot'] },
      { id: 'lesson-knowledge-enricher', name: '知识蒸馏', calls: 260, produces: ['concept_map'] }
    ]
  },
  {
    id: 'simulation',
    name: '仿真',
    agentId: 'simulation-agent',
    consumes: ['learner_snapshot'],
    produces: ['simulation_report'],
    skills: [
      { id: 'virtual-learner-learn-turn-simulator', name: '回合模拟', calls: 320, produces: ['sim_turns'] },
      { id: 'virtual-learner-path-evaluator', name: '路径评估', calls: 96, produces: ['simulation_report'] }
    ]
  }
]

const active = ref('goal')
applyStageQuery()
watch(() => route.query, applyStageQuery)
const defById = computed(() => new Map(orchDefs.value.map((d) => [d.id, d])))// 阶段清单统一后端源：GET /admin/field-routings/stages（派生自编排文件），
// 全量消费、不过滤后端结果；demo 模式回退 demoStages 骨架
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
    // 端点不可用：stageList 置空（live 下由拓扑 Agent 节点派生，仍为真实数据；demo 下走演示骨架）
    stageList.value = []
  }
}

const stages = computed<Stage[]>(() => {
  // demo-only：演示/离线模式回退演示骨架；live 模式永不返回 demoStages
  if (dataSource.value !== 'live') return demoStages

  // live：拓扑未就绪（为空/拉取失败）时返回空数组，渲染空态
  if (!liveTopoNodes.value.length) return []

  // live：阶段清单以 GET stages（编排文件派生）为准，无白名单过滤；
  // 该端点失败时退化为拓扑 Agent 节点派生（仍为真实数据，无 demo 兜底）。
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
    // 真实变量流：来自 prompt-ops skill-catalog 的 input/output 字段（无 demo 兜底）
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
const statusTitle = computed(() => {
  if (!stages.value.length) return '暂无编排阶段数据'
  const unresolved = stages.value.some((s) => s.defSteps?.some((d) => d.resolved?.unresolved))
  if (unresolved) return '编排存在未解析节点'
  return '编排主链完整'
})
// 后端阶段名已含"阶段"（如"Goal 阶段"），demo 名无后缀，避免重复拼接
const stageTitle = computed(() => {
  const name = current.value?.name || ''
  return name.endsWith('阶段') ? name : `${name}阶段`
})
void stageTitle.value
</script><style scoped>
/* 视图 tab：字段流转 / 拓扑 / 字段路由 / 工作台 / 沙盘 / 漂移（页面级切换，浅底分段条） */
.orch-tabs { display: flex; gap: 4px; padding: 3px; width: fit-content; background: #f1f5f9; border-radius: 10px; }
.orch-tab {
  padding: 6px 14px; border: 0; border-radius: 8px; background: transparent;
  font: inherit; font-size: 12px; font-weight: 700; color: var(--mk-muted); cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}
.orch-tab:hover { color: var(--mk-ink); }
.orch-tab.is-active { background: #fff; color: var(--mk-ink); box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08); }
.orch-tabpane { margin-top: 0; }

.mk-status__meta--bad { color: var(--mk-red, #dc2626); font-weight: 700; }

/* 4K：字段流转 tab 条跟随全站节奏 */
@media (min-width: 2000px) {
  .orch-tab { font-size: 13px; padding: 7px 16px; }
}
</style>