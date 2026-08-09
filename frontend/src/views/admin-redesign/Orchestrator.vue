<template>
  <div class="mk-page">
    <div class="mk-status mk-status--ok">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">编排主链完整</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">{{ stages.length }} 阶段</span>
      <span class="mk-status__meta">{{ totalSkills }} Skills</span>
      <span class="mk-status__meta">接力 {{ Math.max(stages.length - 1, 0) }} 处</span>
      <span v-if="defsLoaded" class="mk-status__meta">定义源 {{ orchCount }} 编排 / {{ agentDefCount }} Agent</span>
      <button v-if="isLive" type="button" class="mk-status__action" :disabled="defsLoading" @click="loadDefinitions">
        {{ defsLoading ? '拉取中…' : '刷新定义' }}
      </button>
    </div>

    <section v-if="isLive && definitionNotes.length" class="mk-card orch-defs">
      <div class="mk-card__head">
        <h3 class="mk-card__title">运行时定义（API 真源）</h3>
        <span class="mk-card__meta">orchestrators + agents</span>
      </div>
      <ul class="orch-defs__list">
        <li v-for="(n, i) in definitionNotes" :key="i">{{ n }}</li>
      </ul>
    </section>

    <!-- 阶段流水线 -->
    <div class="orch-flow">
      <template v-for="(st, i) in stages" :key="st.id">
        <button
          type="button"
          class="orch-stage"
          :class="{ 'orch-stage--active': active === st.id }"
          @click="active = st.id"
        >
          <span class="orch-stage__order">{{ String(i + 1).padStart(2, '0') }}</span>
          <strong>{{ st.name }}</strong>
          <span class="orch-stage__meta">{{ st.skills.length }} Skills</span>
        </button>
        <span v-if="i < stages.length - 1" class="orch-link">
          <i></i><b>接力</b>
        </span>
      </template>
    </div>

    <!-- 当前阶段详情 -->
    <div class="mk-card">
      <div class="mk-card__head">
        <h3 class="mk-card__title">{{ current.name }}阶段 · 节点与配置</h3>
        <span class="mk-card__meta">节点 ID <span class="mono">{{ current.agentId }}</span></span>
      </div>

      <!-- tab 切换（定义 / 字段路由 / 沙盘 / 漂移与审计） -->
      <div class="orch-tabs">
        <button
          v-for="t in tabs"
          :key="t.id"
          type="button"
          class="orch-tab"
          :class="{ 'is-active': activeTab === t.id }"
          @click="activeTab = t.id"
        >{{ t.label }}</button>
      </div>

      <!-- Tab：定义（变量流 + 定义级步骤 + Skill 节点） -->
      <div v-if="activeTab === 'definition'" class="orch-detail">
        <!-- 变量流 -->
        <div class="orch-vars">
          <div class="orch-vars__group">
            <span class="orch-vars__label">输入</span>
            <span v-for="v in current.consumes" :key="v" class="orch-var orch-var--in">{{ v }}</span>
            <span v-if="!current.consumes.length" class="mk-na">—</span>
          </div>
          <span class="orch-vars__arrow">→</span>
          <div class="orch-vars__group">
            <span class="orch-vars__label">输出</span>
            <span v-for="v in current.produces" :key="v" class="orch-var orch-var--out">{{ v }}</span>
          </div>
        </div>

        <!-- 定义级步骤（编排定义实时编译） -->
        <div v-if="current.defSteps?.length" class="orch-defsteps">
          <span class="orch-defsteps__label">定义步骤（{{ current.defSteps.length }}）</span>
          <div
            v-for="step in current.defSteps"
            :key="step.step"
            class="orch-defstep"
            :class="{ 'orch-defstep--service': step.resolved?.nodeKind === 'service', 'orch-defstep--unresolved': step.resolved?.unresolved }"
          >
            <span class="orch-defstep__order">{{ step.step }}</span>
            <span class="orch-defstep__id mono">{{ step.agentId }}</span>
            <span class="orch-defstep__role">{{ step.role || '—' }}</span>
            <span v-if="step.condition" class="orch-defstep__cond">if {{ step.condition }}</span>
            <span v-if="step.loopOver" class="orch-defstep__cond">loop {{ step.loopOver }}</span>
            <span v-if="step.resolved?.nodeKind === 'service'" class="orch-defstep__badge">service</span>
            <span v-if="step.resolved?.unresolved" class="orch-defstep__badge orch-defstep__badge--warn">unresolved</span>
          </div>
        </div>

        <!-- Skill 节点 -->
        <div class="orch-skills">
          <div v-for="s in current.skills" :key="s.id" class="orch-skill" role="button" tabindex="0" @click="openSkillDrawer(s.id)" @keydown.enter="openSkillDrawer(s.id)">
            <span class="orch-skill__dot" :class="{ 'orch-skill__dot--idle': !s.calls }"></span>
            <div class="orch-skill__main">
              <strong>{{ s.name }}</strong>
              <span class="mono">{{ s.id }}</span>
            </div>
            <div class="orch-skill__vars">
              <span v-for="v in s.produces" :key="v" class="orch-var orch-var--out">{{ v }}</span>
            </div>
            <span class="mk-num">{{ s.calls || '—' }}</span>
          </div>
        </div>
      </div>

      <!-- Tab：字段路由（可写配置） -->
      <div v-else-if="activeTab === 'field-routings'" class="orch-tabpane">
        <FieldRoutingTable :stage="current.id" @changed="reloadDrift" />
      </div>

      <!-- Tab：沙盘契约视图 -->
      <div v-else-if="activeTab === 'sandbox'" class="orch-tabpane">
        <SandboxView />
      </div>

      <!-- Tab：漂移与审计 -->
      <div v-else-if="activeTab === 'drift'" class="orch-tabpane">
        <DriftAuditPanel ref="driftPanel" :stage="current.id" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { openSkillDrawer, dataSource, isLive } from './store'
import { liveTopoNodes, liveSkillCatalog, errMsg } from './live'
import { adminRuntimeDefinitionsApi, adminFieldRoutingsApi } from '@/api/adminApi'
import FieldRoutingTable from './FieldRoutingTable.vue'
import SandboxView from './SandboxView.vue'
import DriftAuditPanel from './DriftAuditPanel.vue'

defineProps<{ state: 'normal' }>()

const tabs = [
  { id: 'definition', label: '定义' },
  { id: 'field-routings', label: '字段路由' },
  { id: 'sandbox', label: '沙盘' },
  { id: 'drift', label: '漂移与审计' },
]
const activeTab = ref('definition')
const driftPanel = ref<InstanceType<typeof DriftAuditPanel> | null>(null)

// 字段路由写操作后联动刷新漂移报告。
// 说明：drift 与 field-routings 为互斥 tab（v-else-if 重建），每次进入 drift tab 时
// DriftAuditPanel 重新挂载并自动 loadDrift；此回调覆盖"drift tab 曾打开、ref 存活"的
// 边角场景，保持写后数据一致。
function reloadDrift() {
  void driftPanel.value?.reload()
}

const defsLoading = ref(false)
const defsLoaded = ref(false)
const orchCount = ref(0)
const agentDefCount = ref(0)
const definitionNotes = ref<string[]>([])
const orchDefs = ref<Array<Record<string, any>>>([])

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
    const agentItems = Array.isArray(agentBody) ? agentBody : agentBody.items || agentBody.agents || []
    orchCount.value = orchItems.length
    agentDefCount.value = agentItems.length
    orchDefs.value = orchItems
    definitionNotes.value = [
      ...orchItems.slice(0, 6).map((o: Record<string, unknown>) =>
        `编排 ${String(o.id || o.name || '—')} · ${String(o.title || o.label || o.description || '').slice(0, 48)}`
      ),
      ...agentItems.slice(0, 6).map((a: Record<string, unknown>) =>
        `Agent ${String(a.id || a.agentId || '—')} · ${String(a.name || a.title || '').slice(0, 40)}`
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
  if (isLive.value) void loadDefinitions()
  void loadStages()
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
const defById = computed(() => new Map(orchDefs.value.map((d) => [d.id, d])))
// 5 阶段统一后端源（A3）：GET /admin/field-routings/stages；demoStages 仅离线 fallback
const stageList = ref<Array<{ id: string; displayName: string }>>([])
const stageNames = computed(() => new Map(stageList.value.map((s) => [s.id, s.displayName])))

async function loadStages() {
  try {
    const res = await adminFieldRoutingsApi.getStages()
    const stages = (res.data?.data?.stages || []).filter((s: { id: string }) =>
      ['goal', 'path', 'teaching', 'profile', 'simulation'].includes(s.id)
    )
    if (stages.length) {
      stageList.value = stages
      if (!stages.some((s: { id: string }) => s.id === active.value)) {
        active.value = stages[0].id
      }
    }
  } catch {
    // 后端不可用时回退 demo 骨架（仅 name 来源）
    stageList.value = []
  }
}

const stages = computed<Stage[]>(() => {
  if (dataSource.value !== 'live' || !liveTopoNodes.value.length) return demoStages

  return demoStages.map((stage) => {
    const members = liveTopoNodes.value.filter(
      (n) => n.type === 'skill' && n.parentAgentId === stage.agentId
    )
    const demoById = new Map(stage.skills.map((skill) => [skill.id, skill]))
    // 真实变量流：来自 prompt-ops skill-catalog 的 input/output 字段
    const catalogAgent = liveSkillCatalog.value.find((a) => a.agentId === stage.agentId)
    const catalogById = new Map((catalogAgent?.skills || []).map((s) => [s.skillId, s]))
    const skills = members.map((node) => {
      const id = node.id.replace(/^skill:/, '')
      const fallback = demoById.get(id)
      const catalog = catalogById.get(id)
      return {
        id,
        name: node.label.replace(/ Skill$/, ''),
        calls: node.stats.totalCalls,
        produces: catalog?.outputFields.length ? catalog.outputFields : fallback?.produces || []
      }
    })
    // 阶段级变量：下辖 Skill 输入 = 消费，输出 = 产出（有真实字段时覆盖演示值）
    const allInputs = [...new Set(skills.flatMap((s) => catalogById.get(s.id)?.inputFields || []))]
    const allOutputs = [...new Set(skills.flatMap((s) => s.produces))]
    // 定义级步骤（编排定义实时编译，含 role/condition/loopOver/resolved）
    const def = defById.value.get(stage.agentId)
    const defSteps: DefStep[] = def?.steps || []
    return {
      ...stage,
      // 阶段名以后端 stages 源优先（A3 统一）
      name: stageNames.value.get(stage.id) || stage.name,
      consumes: allInputs.length ? allInputs.slice(0, 5) : stage.consumes,
      produces: allOutputs.length ? allOutputs.slice(0, 5) : stage.produces,
      skills,
      defSteps
    }
  })
})

const totalSkills = computed(() => stages.value.reduce((sum, stage) => sum + stage.skills.length, 0))
const current = computed(() => stages.value.find((s) => s.id === active.value) || stages.value[0])
</script>

<style scoped>
.orch-defs__list {
  margin: 0;
  padding: 0 16px 14px 32px;
  display: grid;
  gap: 6px;
  font-size: 12.5px;
  color: var(--mk-muted);
  line-height: 1.5;
}
.orch-tabs { display: flex; gap: 8px; padding: 0 16px; border-bottom: 1px solid var(--mk-line); }
.orch-tab { padding: 9px 14px; border: none; background: none; cursor: pointer; font-size: 13px; font-weight: 600; color: var(--mk-faint); border-bottom: 2px solid transparent; }
.orch-tab.is-active { color: var(--mk-blue); border-bottom-color: var(--mk-blue); }
.orch-tabpane { padding: 16px; }
.orch-flow {
  display: flex;
  align-items: center;
  gap: 0;
  overflow-x: auto;
  padding: 4px 2px;
}
.orch-stage {
  flex: 1 1 0;
  min-width: 130px;
  display: grid;
  gap: 3px;
  justify-items: center;
  padding: 12px 10px;
  border: 1px solid var(--mk-line);
  border-radius: 12px;
  background: var(--mk-surface);
  font: inherit;
  cursor: pointer;
  transition: 0.14s ease;
}
.orch-stage:hover { border-color: rgba(52, 120, 246, 0.35); }
.orch-stage--active {
  border-color: var(--mk-blue);
  background: #eef5ff;
  box-shadow: 0 0 0 1px var(--mk-blue) inset;
}
.orch-stage__order {
  font-size: 10.5px;
  font-weight: 800;
  color: var(--mk-faint);
  letter-spacing: 0.06em;
}
.orch-stage--active .orch-stage__order { color: var(--mk-blue); }
.orch-stage strong { font-size: 14px; }
.orch-stage__meta { font-size: 11px; color: var(--mk-faint); }

.orch-link {
  display: grid;
  justify-items: center;
  gap: 1px;
  min-width: 44px;
  color: var(--mk-faint);
}
.orch-link i { display: block; width: 100%; height: 2px; background: var(--mk-line); }
.orch-link b { font-size: 9.5px; font-weight: 700; letter-spacing: 0.08em; }
.orch-defsteps { display: grid; gap: 4px; margin-top: 10px; }
.orch-defsteps__label { font-size: 11px; color: var(--mk-faint); }
.orch-defstep { display: flex; gap: 8px; align-items: baseline; padding: 4px 8px; border: 1px solid var(--mk-line); border-radius: 6px; font-size: 12px; }
.orch-defstep--service { background: #f0f7ff; }
.orch-defstep--unresolved { border-color: #fca5a5; background: #fef2f2; }
.orch-defstep__order { font-size: 10px; color: var(--mk-faint); font-weight: 700; }
.orch-defstep__id { font-weight: 600; }
.orch-defstep__role { color: var(--mk-muted); }
.orch-defstep__cond { color: var(--mk-faint); font-size: 11px; }
.orch-defstep__badge { padding: 0 5px; border-radius: 4px; background: #e0e7ff; color: #3730a3; font-size: 10px; }
.orch-defstep__badge--warn { background: #fee2e2; color: #b91c1c; }

.orch-detail { display: grid; gap: 14px; padding: 16px; }
.orch-vars {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 14px;
  border-radius: 10px;
  background: #fafbfc;
  border: 1px dashed var(--mk-line);
}
.orch-vars__group { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.orch-vars__label { font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; color: var(--mk-faint); }
.orch-vars__arrow { color: var(--mk-faint); }
.orch-var {
  padding: 2px 8px;
  border-radius: 6px;
  font-family: var(--mk-mono);
  font-size: 11px;
  font-weight: 600;
}
.orch-var--in { background: #eef2fa; color: #5b6577; }
.orch-var--out { background: #ecfdf5; color: #15803d; }

.orch-skills { display: grid; gap: 6px; }
.orch-skill {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--mk-line);
  border-radius: 10px;
  background: var(--mk-surface);
  cursor: pointer;
  transition: border-color 0.14s ease;
}
.orch-skill:hover { border-color: rgba(52, 120, 246, 0.35); }
.orch-skill__dot { width: 8px; height: 8px; border-radius: 50%; background: var(--mk-green); flex-shrink: 0; }
.orch-skill__dot--idle { background: #c3cede; }
.orch-skill__main { display: grid; min-width: 160px; }
.orch-skill__main strong { font-size: 13px; }
.orch-skill__vars { display: flex; gap: 4px; flex-wrap: wrap; flex: 1; }
.mono { font-family: var(--mk-mono); font-size: 11px; color: var(--mk-faint); }

/* ========== 大屏/4K 适配（全站 mk 体系档位：≥2000px 字号放大；zoom 档 ≥2800px→1.15、≥3600px→1.3） ========== */
@media (min-width: 2000px) {
  .orch-defs__list { font-size: 14px; padding: 0 18px 16px 38px; }
  .orch-stage { min-width: 150px; padding: 14px 12px; border-radius: 14px; }
  .orch-stage__order { font-size: 12px; }
  .orch-stage strong { font-size: 15.5px; }
  .orch-stage__meta { font-size: 12.5px; }
  .orch-link { min-width: 52px; }
  .orch-link b { font-size: 11px; }
  .orch-detail { gap: 16px; padding: 18px; }
  .orch-vars { gap: 14px; padding: 14px 16px; }
  .orch-vars__label { font-size: 12px; }
  .orch-var { font-size: 12.5px; padding: 3px 10px; }
  .orch-skill { gap: 14px; padding: 12px 14px; }
  .orch-skill__main { min-width: 190px; }
  .orch-skill__main strong { font-size: 14.5px; }
  .mono { font-size: 12.5px; }
}
@media (min-width: 2800px) {
  /* zoom 1.15 档：字号继续放大 */
  .orch-defs__list { font-size: 15.5px; }
  .orch-stage { min-width: 175px; padding: 16px 14px; }
  .orch-stage__order { font-size: 13.5px; }
  .orch-stage strong { font-size: 17px; }
  .orch-stage__meta { font-size: 14px; }
  .orch-link { min-width: 62px; }
  .orch-link b { font-size: 12.5px; }
  .orch-detail { gap: 18px; padding: 22px; }
  .orch-vars { gap: 16px; padding: 16px 18px; }
  .orch-vars__label { font-size: 13.5px; }
  .orch-var { font-size: 14px; padding: 4px 12px; border-radius: 8px; }
  .orch-skill { gap: 16px; padding: 14px 16px; }
  .orch-skill__main { min-width: 220px; }
  .orch-skill__main strong { font-size: 16px; }
  .mono { font-size: 14px; }
}
@media (min-width: 3600px) {
  /* 4K（zoom 1.3 档）：字号继续放大，与页面基线对齐 */
  .orch-defs__list { font-size: 18px; }
  .orch-stage { min-width: 205px; padding: 18px 16px; }
  .orch-stage__order { font-size: 16px; }
  .orch-stage strong { font-size: 20px; }
  .orch-stage__meta { font-size: 16.5px; }
  .orch-link { min-width: 74px; }
  .orch-link b { font-size: 15px; }
  .orch-detail { gap: 22px; padding: 26px; }
  .orch-vars { gap: 18px; padding: 18px 22px; }
  .orch-vars__label { font-size: 16px; }
  .orch-var { font-size: 16.5px; padding: 5px 14px; }
  .orch-skill { gap: 18px; padding: 16px 18px; }
  .orch-skill__main { min-width: 260px; }
  .orch-skill__main strong { font-size: 18.5px; }
  .mono { font-size: 16.5px; }
}
</style>
