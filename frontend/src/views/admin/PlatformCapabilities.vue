<template>
  <div class="platform-capabilities-page">
    <div class="bg-layer" aria-hidden="true">
      <div class="bg-orb bg-orb--1"></div>
      <div class="bg-orb bg-orb--2"></div>
      <div class="bg-orb bg-orb--3"></div>
    </div>

    <div class="page-hero">
      <span class="pill">Platform</span>
      <h2 class="page-hero__title admin-page-title">
        <el-icon class="admin-page-title__icon"><Grid /></el-icon>
        平台能力管理
      </h2>
      <p class="page-hero__subtitle">按平台能力查看主入口、编排链与挂载组件，减少 Agent / Skill 术语混用带来的理解成本。</p>
    </div>

    <div class="summary-grid" v-if="summary">
      <el-card class="summary-card summary-card--blue" shadow="hover">
        <div class="label">平台能力</div>
        <div class="value">{{ summary.capabilityCount }}</div>
      </el-card>
      <el-card class="summary-card summary-card--green" shadow="hover">
        <div class="label">主运行节点</div>
        <div class="value">{{ summary.runtimeCount }}</div>
      </el-card>
      <el-card class="summary-card summary-card--purple" shadow="hover">
        <div class="label">挂载能力成员</div>
        <div class="value">{{ summary.memberCount }}</div>
      </el-card>
      <el-card class="summary-card summary-card--orange" shadow="hover">
        <div class="label">关联编排能力</div>
        <div class="value">{{ summary.activeCount }}</div>
      </el-card>
    </div>

    <div class="admin-list-toolbar">
      <div class="admin-list-toolbar__group">
        <el-input v-model="keyword" placeholder="搜索能力 / 运行节点 / 成员" clearable class="search" />
      </div>
      <div class="admin-list-toolbar__group">
        <el-button type="primary" :loading="loading" @click="loadData">
          <el-icon><Refresh /></el-icon>
          刷新
        </el-button>
      </div>
    </div>

    <div class="capability-grid" v-loading="loading">
      <article v-for="item in filteredCapabilities" :key="item.id" class="capability-card">
        <div class="capability-card__head">
          <div>
            <span class="capability-card__eyebrow">{{ item.eyebrow }}</span>
            <h3>{{ item.name }}</h3>
            <p>{{ item.description }}</p>
          </div>
          <div class="capability-card__meta">
            <span>{{ item.runtimes.length }} 个主节点</span>
            <span v-if="item.orchestrators.length">{{ item.orchestrators.length }} 条编排链</span>
            <span>{{ item.members.length }} 个挂载成员</span>
          </div>
        </div>

        <div class="capability-section">
          <span class="capability-section__label">主运行节点</span>
          <div class="chip-list">
            <div v-for="runtime in item.runtimes" :key="runtime.agentId" class="runtime-chip">
              <strong>{{ runtime.name }}</strong>
              <span>{{ runtime.agentId }}</span>
              <em>{{ runtime.kindLabel }} · {{ runtime.callCount }} 调用</em>
            </div>
          </div>
        </div>

        <div class="capability-section" v-if="item.orchestrators.length">
          <span class="capability-section__label">关联编排器</span>
          <div class="chip-list chip-list--compact">
            <span v-for="orchestrator in item.orchestrators" :key="orchestrator.agentId" class="member-chip member-chip--orchestrator">
              {{ orchestrator.name }}
            </span>
          </div>
        </div>

        <div class="capability-section">
          <span class="capability-section__label">挂载成员</span>
          <div class="chip-list chip-list--compact">
            <span v-for="member in item.members.slice(0, 6)" :key="member" class="member-chip">{{ member }}</span>
            <span v-if="item.members.length > 6" class="member-chip member-chip--count">+{{ item.members.length - 6 }}</span>
          </div>
        </div>

        <div class="capability-footer">
          <router-link :to="item.primaryRoute" class="capability-link">查看主节点详情</router-link>
          <router-link v-if="item.definitionRoute" :to="item.definitionRoute" class="capability-link capability-link--ghost">查看编排结构</router-link>
          <router-link v-if="item.monitorRoute" :to="item.monitorRoute" class="capability-link capability-link--ghost">查看编排监控</router-link>
        </div>
      </article>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Grid, Refresh } from '@element-plus/icons-vue'
import { adminAgentsApi, adminSkillsApi, type AdminRegistryAgent, type OrchestratorRelationItem } from '@/api/adminApi'
import { toast } from '@/utils/toast'

interface SkillModelConfigRow {
  skillId: string;
  displayName?: string;
  status?: 'working' | 'placeholder' | 'simplified' | 'mock';
  lastCalledAt?: string | null;
  tier: string;
  model?: string;
  enabled: boolean;
}

interface CapabilityCard {
  id: string;
  name: string;
  eyebrow: string;
  description: string;
  runtimes: AdminRegistryAgent[];
  orchestrators: AdminRegistryAgent[];
  members: string[];
  primaryRoute: string;
  definitionRoute?: string;
  monitorRoute?: string;
}

const loading = ref(false)
const keyword = ref('')
const registryAgents = ref<AdminRegistryAgent[]>([])
const orchestratorRelations = ref<OrchestratorRelationItem[]>([])
const skillConfigs = ref<SkillModelConfigRow[]>([])

const SKILL_CN_NAMES: Record<string, string> = {
  'path-scene-framing': '路径场景构图',
  'stage-designer': '阶段任务设计器',
  'peer-reinforcement': '同伴强化',
  'virtual-learner-persona-designer': '虚拟学习者身份设计器',
  'virtual-learner-scenario-designer': '虚拟学习者故事设计器',
  'virtual-learner-goal-dialogue-simulator': '虚拟学习者 Goal 对话模拟器',
  'virtual-learner-path-evaluator': '虚拟学习者路径评估器',
  'virtual-learner-learn-turn-simulator': '虚拟学习者 Learn 回合模拟器',
  'goal-profile-inference': '目标阶段画像推断器',
  'learning-pattern-distiller': '学习模式蒸馏器',
  'session-knowledge-distiller': '课堂知识蒸馏器',
  'dialogue-concept-extractor': '对话概念抽取器',
}

const CAPABILITY_SPECS = [
  {
    id: 'requirement-collection',
    name: '目标采集与需求理解',
    eyebrow: 'Goal Capability',
    description: '围绕学习目标、背景约束与问题定义形成可进入 Path 的统一主输入。',
    runtimeIds: ['goal-conversation-agent', 'requirement-orchestrator'],
    memberSkillIds: [],
    primaryRoute: '/admin/agent-registry',
    definitionRoute: '/admin/orchestrator-definitions',
    monitorRoute: '/admin/orchestrators',
  },
  {
    id: 'path-planning',
    name: '路径规划能力',
    eyebrow: 'Path Capability',
    description: '负责路径生成、阶段拆解与任务扩展，是当前学习路径主链的规划中心。',
    runtimeIds: ['path-agent', 'path-orchestrator'],
    memberSkillIds: ['path-scene-framing', 'stage-designer'],
    primaryRoute: '/admin/agent-registry',
    definitionRoute: '/admin/orchestrator-definitions',
    monitorRoute: '/admin/orchestrators',
  },
  {
    id: 'learner-center',
    name: '学习者画像与状态中心',
    eyebrow: 'Learner Capability',
    description: '聚合学习者画像、知识沉淀、replan 信号与教学控制态，向 Goal / Path / Learn 输出统一 learner 视角。',
    runtimeIds: ['learner-model-agent', 'learner-orchestrator'],
    memberSkillIds: ['goal-profile-inference', 'learning-pattern-distiller', 'session-knowledge-distiller', 'dialogue-concept-extractor'],
    primaryRoute: '/admin/learner-models',
    definitionRoute: '/admin/orchestrator-definitions',
    monitorRoute: '/admin/orchestrators',
  },
  {
    id: 'ai-teaching',
    name: 'AI 教学能力',
    eyebrow: 'Teaching Capability',
    description: '负责课堂编排、单轮教学、伴学补强与课后总结，是 Learn 主体验的核心执行层。',
    runtimeIds: ['ai-teaching-agent', 'teaching-turn-agent', 'session-wrapup-agent'],
    memberSkillIds: ['peer-reinforcement'],
    primaryRoute: '/admin/agent-registry',
    definitionRoute: '/admin/orchestrator-definitions',
    monitorRoute: '/admin/orchestrators',
  },
  {
    id: 'simulation-lab',
    name: '虚拟学习者仿真能力',
    eyebrow: 'Simulation Capability',
    description: '支撑虚拟学习者故事、身份、Goal / Path / Learn 回放与评估，是实验与回归验证能力。',
    runtimeIds: ['simulation-orchestrator'],
    memberSkillIds: [
      'virtual-learner-persona-designer',
      'virtual-learner-scenario-designer',
      'virtual-learner-goal-dialogue-simulator',
      'virtual-learner-path-evaluator',
      'virtual-learner-learn-turn-simulator',
    ],
    primaryRoute: '/admin/virtual-learners',
    definitionRoute: '/admin/orchestrator-definitions',
    monitorRoute: '/admin/orchestrators',
  },
] as const

const skillNameMap = computed(() => {
  const map = new Map<string, string>()
  for (const item of skillConfigs.value) {
    map.set(item.skillId, item.displayName || SKILL_CN_NAMES[item.skillId] || item.skillId)
  }
  return map
})

const capabilityCards = computed<CapabilityCard[]>(() => {
  return CAPABILITY_SPECS.map((spec) => {
    const runtimes = spec.runtimeIds
      .map((id) => registryAgents.value.find((item) => item.agentId === id))
      .filter((item): item is AdminRegistryAgent => !!item)
    const orchestrators = runtimes.filter((item) => item.kind === 'orchestrator')
    const memberSet = new Set<string>()

    for (const skillId of spec.memberSkillIds) {
      memberSet.add(skillNameMap.value.get(skillId) || SKILL_CN_NAMES[skillId] || skillId)
    }

    for (const relation of orchestratorRelations.value) {
      if (!spec.runtimeIds.includes(relation.orchestratorId)) continue
      for (const member of relation.members) {
        if (!spec.runtimeIds.includes(member.agentId)) {
          memberSet.add(member.name)
        }
      }
    }

    return {
      id: spec.id,
      name: spec.name,
      eyebrow: spec.eyebrow,
      description: spec.description,
      runtimes,
      orchestrators,
      members: Array.from(memberSet),
      primaryRoute: spec.primaryRoute,
      definitionRoute: spec.definitionRoute,
      monitorRoute: spec.monitorRoute,
    }
  })
})

const filteredCapabilities = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  if (!q) return capabilityCards.value

  return capabilityCards.value.filter((item) => {
    const haystack = [
      item.name,
      item.description,
      ...item.runtimes.map((runtime) => `${runtime.name} ${runtime.agentId}`),
      ...item.members,
    ].join(' ').toLowerCase()
    return haystack.includes(q)
  })
})

const summary = computed(() => ({
  capabilityCount: capabilityCards.value.length,
  runtimeCount: capabilityCards.value.reduce((sum, item) => sum + item.runtimes.length, 0),
  memberCount: capabilityCards.value.reduce((sum, item) => sum + item.members.length, 0),
  activeCount: capabilityCards.value.filter((item) => item.orchestrators.length > 0).length,
}))

const getKindLabel = (kind?: AdminRegistryAgent['kind']) => {
  if (kind === 'orchestrator') return '编排器'
  if (kind === 'skill') return '能力成员'
  return '主节点'
}

const loadData = async () => {
  loading.value = true
  try {
    const [registryRes, relationRes, skillRes] = await Promise.all([
      adminAgentsApi.getRegistry(),
      adminAgentsApi.getOrchestratorRelations(),
      adminSkillsApi.getSkillModelConfigs(),
    ])

    registryAgents.value = registryRes.data?.data?.agents || []
    orchestratorRelations.value = relationRes.data?.data?.orchestrators || []
    skillConfigs.value = skillRes.data?.data || []
  } catch {
    toast.error('加载平台能力数据失败')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadData()
})
</script>

<style scoped>
.platform-capabilities-page {
  padding: 1.25rem;
}

.bg-layer { position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; }
.bg-orb { position: absolute; border-radius: 50%; filter: blur(110px); opacity: 0.16; }
.bg-orb--1 { width: 460px; height: 460px; top: -180px; right: -120px; background: radial-gradient(circle, rgba(52, 120, 246, 0.28), transparent 70%); }
.bg-orb--2 { width: 380px; height: 380px; left: -100px; bottom: 120px; background: radial-gradient(circle, rgba(141, 107, 255, 0.2), transparent 70%); }
.bg-orb--3 { width: 320px; height: 320px; right: 20%; bottom: 40px; background: radial-gradient(circle, rgba(16, 185, 129, 0.16), transparent 70%); }

.page-hero { position: relative; z-index: 1; padding: 24px 28px; border-radius: 20px; border: 1px solid rgba(52, 120, 246, 0.08); background: radial-gradient(circle at top right, rgba(52, 120, 246, 0.06), transparent 38%), linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(244, 247, 252, 0.92)); backdrop-filter: blur(16px); margin-bottom: 1.5rem; }
.page-hero__title.admin-page-title { margin: 8px 0 0; font-size: 1.6rem; font-weight: 700; color: #22344d; letter-spacing: -0.03em; display: flex; align-items: center; gap: 8px; }
.admin-page-title__icon { font-size: 1.25rem; color: var(--color-primary); }
.page-hero__subtitle { margin: 4px 0 0; color: var(--text-secondary); font-size: 0.9375rem; }
.pill { display: inline-flex; align-items: center; width: fit-content; min-height: 26px; padding: 0 12px; border-radius: 999px; background: color-mix(in srgb, var(--color-primary) 10%, white); color: var(--color-primary-dark, #1f57cc); font-size: 12px; font-weight: 700; }

.summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 16px; position: relative; z-index: 1; }
.summary-card { border-radius: var(--radius-lg); border: 1px solid var(--border-default); background: var(--glass-bg-light); }
.summary-card .label { font-size: 0.75rem; color: var(--text-muted); font-weight: 600; }
.summary-card .value { font-size: 1.75rem; font-weight: 800; margin-top: 0.25rem; }
.summary-card--blue .value { color: var(--color-primary); }
.summary-card--green .value { color: #16a34a; }
.summary-card--purple .value { color: #7c3aed; }
.summary-card--orange .value { color: #ea580c; }

.admin-list-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin-bottom: 1rem; flex-wrap: wrap; position: relative; z-index: 1; }
.admin-list-toolbar__group { display: flex; align-items: center; gap: 0.5rem; }
.admin-list-toolbar .search { width: 260px; }

.capability-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
  position: relative;
  z-index: 1;
}

.capability-card {
  border: 1px solid #d2dbf3;
  border-radius: 28px;
  padding: 1.1rem;
  background: color-mix(in srgb, #ffffff 90%, white);
  backdrop-filter: blur(20px);
  box-shadow: 0 30px 90px rgba(58, 101, 197, 0.14);
  display: grid;
  gap: 1rem;
}

.capability-card__head {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
}

.capability-card__eyebrow {
  display: inline-flex;
  font-size: 0.75rem;
  font-weight: 700;
  color: #2d6df2;
  margin-bottom: 0.35rem;
}

.capability-card h3 {
  margin: 0;
  font-size: 1.125rem;
  color: var(--text-primary);
}

.capability-card p {
  margin: 0.35rem 0 0;
  color: var(--text-secondary);
  line-height: 1.6;
  font-size: 0.875rem;
}

.capability-card__meta {
  display: grid;
  justify-items: end;
  gap: 0.35rem;
  color: var(--text-secondary);
  font-size: 0.75rem;
}

.capability-section {
  display: grid;
  gap: 0.6rem;
}

.capability-section__label {
  font-size: 0.75rem;
  font-weight: 700;
  color: #7085a6;
  letter-spacing: 0.02em;
}

.chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
}

.chip-list--compact {
  gap: 0.5rem;
}

.runtime-chip {
  display: grid;
  gap: 0.15rem;
  padding: 0.75rem 0.85rem;
  border-radius: 18px;
  background: rgba(244, 249, 255, 0.96);
  border: 1px solid rgba(52, 120, 246, 0.14);
  min-width: 180px;
}

.runtime-chip strong {
  color: var(--text-primary);
  font-size: 0.875rem;
}

.runtime-chip span,
.runtime-chip em {
  font-size: 0.75rem;
  color: var(--text-secondary);
  font-style: normal;
}

.member-chip {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  background: rgba(247, 250, 255, 0.98);
  border: 1px solid rgba(216, 224, 238, 0.95);
  color: #44556c;
  font-size: 0.8125rem;
  font-weight: 600;
}

.member-chip--orchestrator {
  border-color: rgba(124, 58, 237, 0.18);
  background: rgba(248, 244, 255, 0.95);
  color: #6d28d9;
}

.member-chip--count {
  color: #7085a6;
}

.capability-footer {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.capability-link {
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  padding: 0 14px;
  border-radius: 14px;
  text-decoration: none;
  color: #1f57cc;
  border: 1px solid rgba(52, 120, 246, 0.18);
  background: rgba(244, 249, 255, 0.96);
  font-weight: 700;
}

.capability-link--ghost {
  color: #5f7187;
  background: rgba(255, 255, 255, 0.9);
  border-color: rgba(216, 224, 238, 0.9);
}

@media (max-width: 1100px) {
  .capability-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .platform-capabilities-page {
    padding: 1rem;
  }

  .summary-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .admin-list-toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .admin-list-toolbar__group {
    justify-content: space-between;
  }

  .capability-card__head {
    grid-template-columns: 1fr;
    display: grid;
  }

  .capability-card__meta {
    justify-items: start;
  }
}
</style>
