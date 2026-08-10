<template>
  <div class="mk-page">
    <div class="mk-status" :class="`mk-status--${statusTone}`">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">{{ statusTitle }}</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">{{ stages.length }} 阶段</span>
      <span class="mk-status__meta">{{ totalSkills }} Skills</span>
      <span class="mk-status__meta">接力 {{ Math.max(stages.length - 1, 0) }} 处</span>
      <span v-if="defsLoaded" class="mk-status__meta">定义源 {{ orchCount }} 编排 / {{ skillDefCount }} Skill</span>
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
        <li v-for="(n, i) in definitionNotes" :key="i" class="orch-defs__item">
          <span
            class="orch-defs__tag"
            :class="n.startsWith('编排') ? 'orch-defs__tag--orch' : 'orch-defs__tag--skill'"
          >{{ n.startsWith('编排') ? '编排' : 'Skill' }}</span>
          <span class="orch-defs__text">{{ n.replace(/^(编排|Agent)\s+/, '') }}</span>
        </li>
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
          <span class="orch-stage__bar"></span>
          <span class="orch-stage__num">{{ String(i + 1).padStart(2, '0') }}</span>
          <span class="orch-stage__body">
            <strong class="orch-stage__name">{{ st.name }}</strong>
            <span class="orch-stage__meta">{{ st.skills.length }} Skills · {{ stageCalls(st) }} 次调用</span>
          </span>
        </button>
        <span v-if="i < stages.length - 1" class="orch-link" :class="{ 'orch-link--on': i >= activeIdx }">
          <i></i><b>接力</b>
        </span>
      </template>
    </div>

    <!-- 当前阶段详情 -->
    <div v-if="current" class="mk-card">
      <div class="mk-card__head">
        <h3 class="mk-card__title">{{ stageTitle }} · 节点与配置</h3>
        <span class="mk-card__meta">节点 ID <span class="mono">{{ current?.agentId }}</span></span>
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
            <span class="orch-vars__label orch-vars__label--in">输入</span>
            <span v-for="v in current.consumes" :key="v" class="orch-var orch-var--in">{{ v }}</span>
            <span v-if="!current.consumes.length" class="mk-na">—</span>
          </div>
          <span class="orch-vars__arrow" aria-hidden="true">→</span>
          <div class="orch-vars__group">
            <span class="orch-vars__label orch-vars__label--out">输出</span>
            <span v-for="v in current.produces" :key="v" class="orch-var orch-var--out">{{ v }}</span>
          </div>
        </div>

        <!-- 定义级步骤（编排定义实时编译） -->
        <div v-if="current.defSteps?.length" class="orch-defsteps">
          <span class="orch-defsteps__label">定义步骤（{{ current.defSteps.length }}）</span>
          <div class="orch-defsteps__rail">
            <div
              v-for="step in current.defSteps"
              :key="step.step"
              class="orch-defstep"
              :class="{ 'orch-defstep--service': step.resolved?.nodeKind === 'service', 'orch-defstep--unresolved': step.resolved?.unresolved }"
            >
              <span class="orch-defstep__dot"></span>
              <div class="orch-defstep__main">
                <span class="orch-defstep__head">
                  <span class="orch-defstep__id mono">{{ step.agentId }}</span>
                  <span class="orch-defstep__role">{{ step.role || '—' }}</span>
                  <span v-if="step.resolved?.nodeKind === 'service'" class="orch-defstep__badge">service</span>
                  <span v-if="step.resolved?.unresolved" class="orch-defstep__badge orch-defstep__badge--warn">unresolved</span>
                </span>
                <span v-if="step.condition || step.loopOver" class="orch-defstep__conds">
                  <span v-if="step.condition" class="orch-defstep__cond">if {{ step.condition }}</span>
                  <span v-if="step.loopOver" class="orch-defstep__cond">loop {{ step.loopOver }}</span>
                </span>
              </div>
            </div>
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
            <span class="mk-num orch-skill__calls">{{ s.calls || '—' }}</span>
          </div>
        </div>
      </div>

      <!-- Tab：字段路由（可写配置） -->
      <div v-else-if="activeTab === 'field-routings'" class="orch-tabpane">
        <FieldRoutingTable :stage="current.id" />
      </div>

      <!-- Tab：沙盘契约视图 -->
      <div v-else-if="activeTab === 'sandbox'" class="orch-tabpane">
        <SandboxView />
      </div>

      <!-- Tab：漂移与审计 -->
      <div v-else-if="activeTab === 'drift'" class="orch-tabpane">
        <DriftAuditPanel :stage="current.id" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { openSkillDrawer, dataSource, isLive } from './store'
import { liveTopoNodes, liveSkillCatalog, errMsg } from './live'
import { adminRuntimeDefinitionsApi, adminFieldRoutingsApi } from '@/api/adminApi'
import FieldRoutingTable from './FieldRoutingTable.vue'
import SandboxView from './SandboxView.vue'
import DriftAuditPanel from './DriftAuditPanel.vue'

const tabs = [
  { id: 'definition', label: '定义' },
  { id: 'field-routings', label: '字段路由' },
  { id: 'sandbox', label: '沙盘' },
  { id: 'drift', label: '漂移与审计' },
]
const activeTab = ref('definition')

const defsLoading = ref(false)
const defsLoaded = ref(false)
const orchCount = ref(0)
const skillDefCount = ref(0)
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
  if (isLive.value) void loadDefinitions()
  void loadStages()
})
// demo → live 切换后：阶段清单与运行时定义需要按真实源重拉（初始 onMounted 时可能尚未切到 live）
watch(dataSource, () => {
  if (dataSource.value === 'live') {
    void loadStages()
    if (!defsLoaded.value) void loadDefinitions()
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
const defById = computed(() => new Map(orchDefs.value.map((d) => [d.id, d])))
// 阶段清单统一后端源：GET /admin/field-routings/stages（派生自编排文件），
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
// 空拓扑时 current 为 undefined，模板由 v-if="current" 保护
const current = computed<Stage | undefined>(() => stages.value.find((s) => s.id === active.value) || stages.value[0])
const activeIdx = computed(() => stages.value.findIndex((s) => s.id === active.value))
const stageCalls = (st: Stage) => st.skills.reduce((sum, s) => sum + (s.calls || 0), 0)
// 状态条按实际数据着色/文案：空拓扑 → muted；存在未解析的定义节点 → warn；否则 ok
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
</script>

<style scoped>
/* ========== 运行时定义 ========== */
.orch-defs__list {
  margin: 0;
  padding: 12px 14px 14px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 8px;
  list-style: none;
}
.orch-defs__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border: 1px solid var(--mk-line);
  border-radius: 9px;
  background: #fafbfd;
  font-size: 12px;
  line-height: 1.45;
  min-width: 0;
}
.orch-defs__tag {
  flex-shrink: 0;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.04em;
}
.orch-defs__tag--orch { background: #e5f0ff; color: #2563eb; }
.orch-defs__tag--skill { background: #e8f7ef; color: #15803d; }
.orch-defs__text {
  color: var(--mk-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ========== 阶段流水线 ========== */
.orch-flow {
  display: flex;
  align-items: stretch;
  gap: 0;
  overflow-x: auto;
  padding: 4px 2px;
}
.orch-stage {
  flex: 1 1 0;
  min-width: 148px;
  position: relative;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 10px;
  align-items: center;
  padding: 12px 14px;
  border: 1px solid var(--mk-line);
  border-radius: 12px;
  background: var(--mk-surface);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.16s ease, box-shadow 0.16s ease, transform 0.16s ease;
}
.orch-stage__bar {
  position: absolute;
  left: 0;
  top: 0;
  height: 3px;
  width: 100%;
  border-radius: 3px 3px 0 0;
  background: transparent;
  transition: background 0.16s ease;
}
.orch-stage:hover { border-color: rgba(52, 120, 246, 0.35); transform: translateY(-1px); }
.orch-stage--active {
  border-color: var(--mk-blue);
  box-shadow: 0 0 0 1px rgba(52, 120, 246, 0.25), 0 6px 18px rgba(52, 120, 246, 0.1);
  transform: translateY(-1px);
}
.orch-stage--active .orch-stage__bar { background: var(--mk-blue); }
.orch-stage__num {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border-radius: 9px;
  background: #eef2fa;
  color: var(--mk-faint);
  font-family: var(--mk-mono);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.02em;
  transition: background 0.16s ease, color 0.16s ease;
}
.orch-stage--active .orch-stage__num { background: var(--mk-blue); color: #fff; }
.orch-stage__body { display: grid; gap: 2px; min-width: 0; }
.orch-stage__name {
  font-size: 13.5px;
  color: var(--mk-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.orch-stage__meta {
  font-size: 11px;
  color: var(--mk-faint);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* 接力连接器：后续链路点亮 */
.orch-link {
  display: grid;
  justify-items: center;
  align-self: center;
  gap: 1px;
  min-width: 48px;
  color: var(--mk-faint);
}
.orch-link i {
  display: block;
  width: 100%;
  height: 2px;
  background: var(--mk-line);
  border-radius: 2px;
  transition: background 0.16s ease;
}
.orch-link--on i { background: linear-gradient(90deg, rgba(52, 120, 246, 0.9), rgba(52, 120, 246, 0.55)); }
.orch-link b { font-size: 9.5px; font-weight: 700; letter-spacing: 0.08em; }
.orch-link--on b { color: var(--mk-blue); }

/* ========== tab（胶囊 segment） ========== */
.orch-tabs {
  display: flex;
  gap: 4px;
  padding: 10px 14px 0;
}
.orch-tab {
  padding: 6px 16px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--mk-muted);
  transition: background 0.14s ease, color 0.14s ease, border-color 0.14s ease;
}
.orch-tab:hover { background: #f0f5ff; color: var(--mk-ink); }
.orch-tab.is-active {
  background: var(--mk-blue);
  border-color: var(--mk-blue);
  color: #fff;
  box-shadow: 0 2px 8px rgba(52, 120, 246, 0.3);
}
.orch-tabpane { padding: 14px 16px 16px; }

/* ========== 定义 tab ========== */
.orch-detail { display: grid; gap: 14px; padding: 14px 16px 16px; }

/* 变量流 */
.orch-vars {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  padding: 12px 14px;
  border-radius: 11px;
  background: linear-gradient(180deg, #fbfcfe, #f7f9fc);
  border: 1px solid var(--mk-line);
}
.orch-vars__group { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.orch-vars__label {
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.06em;
}
.orch-vars__label--in { background: #e8edf7; color: #4a5568; }
.orch-vars__label--out { background: #e0f6ec; color: #15803d; }
.orch-vars__arrow {
  font-family: var(--mk-mono);
  font-weight: 800;
  color: var(--mk-blue);
  font-size: 15px;
}
.orch-var {
  padding: 2px 8px;
  border-radius: 6px;
  font-family: var(--mk-mono);
  font-size: 11px;
  font-weight: 600;
}
.orch-var--in { background: #eef2fa; color: #5b6577; }
.orch-var--out { background: #ecfdf5; color: #15803d; }

/* 定义步骤（时间线） */
.orch-defsteps { display: grid; gap: 8px; }
.orch-defsteps__label { font-size: 11px; font-weight: 700; letter-spacing: 0.05em; color: var(--mk-faint); }
.orch-defsteps__rail { display: grid; gap: 4px; padding-left: 0; }
.orch-defstep {
  position: relative;
  display: grid;
  grid-template-columns: 14px 1fr;
  gap: 10px;
  padding: 8px 12px 8px 0;
}
.orch-defstep:not(:last-child)::before {
  content: '';
  position: absolute;
  left: 6px;
  top: 26px;
  bottom: -4px;
  width: 2px;
  background: var(--mk-line);
  border-radius: 2px;
}
.orch-defstep__dot {
  width: 14px;
  height: 14px;
  margin-top: 3px;
  border-radius: 50%;
  background: #dbe4f2;
  border: 3px solid #fff;
  box-shadow: 0 0 0 1px var(--mk-line);
  justify-self: start;
}
.orch-defstep--service .orch-defstep__dot { background: var(--mk-blue); }
.orch-defstep--unresolved .orch-defstep__dot { background: var(--mk-red); }
.orch-defstep__main { display: grid; gap: 3px; min-width: 0; }
.orch-defstep__head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.orch-defstep__id { font-weight: 600; font-size: 12.5px; color: var(--mk-ink); }
.orch-defstep__role { font-size: 11.5px; color: var(--mk-muted); }
.orch-defstep__conds { display: flex; gap: 6px; flex-wrap: wrap; }
.orch-defstep__cond {
  padding: 1px 8px;
  border-radius: 999px;
  background: #f3f5f9;
  color: var(--mk-faint);
  font-family: var(--mk-mono);
  font-size: 10.5px;
  font-weight: 700;
}
.orch-defstep__badge {
  padding: 1px 7px;
  border-radius: 5px;
  background: #e0e7ff;
  color: #3730a3;
  font-size: 10px;
  font-weight: 800;
}
.orch-defstep__badge--warn { background: #fee2e2; color: #b91c1c; }

/* Skill 节点（网格卡片） */
.orch-skills {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 8px;
}
.orch-skill {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 11px 12px;
  border: 1px solid var(--mk-line);
  border-radius: 11px;
  background: var(--mk-surface);
  cursor: pointer;
  transition: border-color 0.14s ease, box-shadow 0.14s ease, transform 0.14s ease;
}
.orch-skill:hover {
  border-color: rgba(52, 120, 246, 0.4);
  box-shadow: 0 4px 14px rgba(52, 120, 246, 0.08);
  transform: translateY(-1px);
}
.orch-skill__dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--mk-green);
  box-shadow: 0 0 0 3px var(--mk-green-bg);
  flex-shrink: 0;
}
.orch-skill__dot--idle { background: #c3cede; box-shadow: 0 0 0 3px #f0f2f5; }
.orch-skill__main { display: grid; gap: 1px; min-width: 0; }
.orch-skill__main strong { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.orch-skill__vars { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; max-width: 180px; }
.orch-skill__calls { font-size: 12px; color: var(--mk-faint); min-width: 34px; }
.mono { font-family: var(--mk-mono); font-size: 11px; color: var(--mk-faint); }

/* ========== 大屏/4K 适配（全站 mk 体系档位：≥2000px 字号放大；zoom 档 ≥2800px→1.15、≥3600px→1.3） ========== */
@media (min-width: 2000px) {
  .orch-defs__list { font-size: 14px; padding: 14px 16px 16px; gap: 10px; }
  .orch-defs__tag { font-size: 12px; padding: 2px 10px; }
  .orch-stage { min-width: 170px; padding: 14px 16px; border-radius: 14px; }
  .orch-stage__num { width: 34px; height: 34px; font-size: 13.5px; border-radius: 10px; }
  .orch-stage__name { font-size: 15px; }
  .orch-stage__meta { font-size: 12.5px; }
  .orch-link { min-width: 56px; }
  .orch-link b { font-size: 11px; }
  .orch-tab { font-size: 14px; padding: 7px 18px; }
  .orch-detail { gap: 16px; padding: 16px 18px 18px; }
  .orch-vars { gap: 16px; padding: 14px 16px; }
  .orch-vars__label { font-size: 12px; }
  .orch-var { font-size: 12.5px; padding: 3px 10px; }
  .orch-defstep__id { font-size: 14px; }
  .orch-defstep__role { font-size: 13px; }
  .orch-skill { gap: 12px; padding: 13px 14px; }
  .orch-skill__main strong { font-size: 14.5px; }
  .orch-skill__calls { font-size: 13.5px; }
  .mono { font-size: 12.5px; }
}
@media (min-width: 2800px) {
  /* zoom 1.15 档：字号继续放大 */
  .orch-defs__list { font-size: 15.5px; }
  .orch-defs__tag { font-size: 13.5px; }
  .orch-stage { min-width: 200px; padding: 16px 18px; }
  .orch-stage__num { width: 40px; height: 40px; font-size: 15.5px; border-radius: 12px; }
  .orch-stage__name { font-size: 17px; }
  .orch-stage__meta { font-size: 14.5px; }
  .orch-link { min-width: 66px; }
  .orch-link b { font-size: 12.5px; }
  .orch-tab { font-size: 16px; padding: 8px 22px; }
  .orch-detail { gap: 18px; padding: 20px 22px 22px; }
  .orch-vars { gap: 18px; padding: 16px 18px; }
  .orch-vars__label { font-size: 13.5px; }
  .orch-var { font-size: 14px; padding: 4px 12px; border-radius: 8px; }
  .orch-defstep__id { font-size: 16px; }
  .orch-defstep__role { font-size: 15px; }
  .orch-skill { gap: 14px; padding: 15px 16px; }
  .orch-skill__main strong { font-size: 16px; }
  .orch-skill__calls { font-size: 15.5px; }
  .mono { font-size: 14px; }
}
@media (min-width: 3600px) {
  /* 4K（zoom 1.3 档）：字号继续放大，与页面基线对齐 */
  .orch-defs__list { font-size: 18px; }
  .orch-defs__tag { font-size: 15.5px; }
  .orch-stage { min-width: 235px; padding: 18px 22px; }
  .orch-stage__num { width: 46px; height: 46px; font-size: 18px; border-radius: 14px; }
  .orch-stage__name { font-size: 20px; }
  .orch-stage__meta { font-size: 17px; }
  .orch-link { min-width: 78px; }
  .orch-link b { font-size: 15px; }
  .orch-tab { font-size: 19px; padding: 9px 26px; }
  .orch-detail { gap: 22px; padding: 24px 26px 26px; }
  .orch-vars { gap: 22px; padding: 18px 22px; }
  .orch-vars__label { font-size: 16px; }
  .orch-var { font-size: 16.5px; padding: 5px 14px; }
  .orch-defstep__id { font-size: 19px; }
  .orch-defstep__role { font-size: 17px; }
  .orch-skill { gap: 16px; padding: 17px 20px; }
  .orch-skill__main strong { font-size: 18.5px; }
  .orch-skill__calls { font-size: 18px; }
  .mono { font-size: 16.5px; }
}
</style>
