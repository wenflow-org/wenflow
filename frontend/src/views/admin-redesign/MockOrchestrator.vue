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
        <h3 class="mk-card__title">{{ current.name }}阶段 · 节点与变量</h3>
        <span class="mk-card__meta">节点 ID <span class="mono">{{ current.agentId }}</span></span>
      </div>
      <div class="orch-detail">
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
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { openSkillDrawer, dataSource } from './mockStore'
import { liveTopoNodes, liveSkillCatalog, errMsg } from './mockLive'
import { adminRuntimeDefinitionsApi } from '@/api/adminApi'

defineProps<{ state: 'normal' }>()

const isLive = computed(() => dataSource.value === 'live')
const defsLoading = ref(false)
const defsLoaded = ref(false)
const orchCount = ref(0)
const agentDefCount = ref(0)
const definitionNotes = ref<string[]>([])

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
})

interface SkillNode { id: string; name: string; calls: number; produces: string[] }
interface Stage {
  id: string
  name: string
  agentId: string
  consumes: string[]
  produces: string[]
  skills: SkillNode[]
}

const demoStages: Stage[] = [
  {
    id: 'goal',
    name: '澄清',
    agentId: 'goal-agent',
    consumes: ['user_message'],
    produces: ['goal_understanding', 'learner_profile'],
    skills: [
      { id: 'goal-conversation', name: '目标对话', calls: 1284, produces: ['dialogue_concepts'] },
      { id: 'goal-profile-inference', name: '画像推断', calls: 856, produces: ['learner_profile'] },
      { id: 'goal-understanding-composer', name: '理解合成', calls: 640, produces: ['goal_understanding'] }
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
      { id: 'path-scene-framing', name: '场景定帧', calls: 512, produces: ['path_scene'] },
      { id: 'stage-designer', name: '阶段设计', calls: 498, produces: ['milestones'] }
    ]
  },
  {
    id: 'learning',
    name: '学习',
    agentId: 'learning-agent',
    consumes: ['learning_path', 'milestones'],
    produces: ['teaching_session', 'mastery_delta'],
    skills: [
      { id: 'learning-turn', name: '教学回合', calls: 2210, produces: ['round_output'] },
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
      { id: 'learning-pattern-distiller', name: '快照刷新', calls: 1204, produces: ['risk_signals'] },
      { id: 'lesson-knowledge-enricher', name: '知识沉淀', calls: 260, produces: ['concept_map'] }
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
    return {
      ...stage,
      consumes: allInputs.length ? allInputs.slice(0, 5) : stage.consumes,
      produces: allOutputs.length ? allOutputs.slice(0, 5) : stage.produces,
      skills
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
</style>
