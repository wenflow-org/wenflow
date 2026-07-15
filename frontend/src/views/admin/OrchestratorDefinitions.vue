<template>
  <div class="admin-page orchestrator-definitions-page">
    <AdminPageHeader
      title="编排结构"
      :icon="Connection"
      :highlights="pageHighlights"
    >
      <template #actions>
        <el-button :icon="Refresh" :loading="loading" @click="loadOrchestrators">刷新</el-button>
      </template>
    </AdminPageHeader>

    <nav class="stage-nav" aria-label="编排阶段">
      <button
        v-for="phase in phaseCards"
        :key="phase.id"
        type="button"
        class="stage-nav__item"
        :class="{ 'is-active': phase.id === selectedPhaseId }"
        @click="selectPhase(phase.id)"
      >
        <span class="stage-nav__order">{{ String(phase.order).padStart(2, '0') }}</span>
        <span class="stage-nav__label">{{ phase.shortName }}</span>
        <span class="stage-nav__meta">{{ phase.stepCount }} 步</span>
        <span class="stage-nav__meta">{{ phase.skillCount }} Skills</span>
      </button>
    </nav>

    <section v-if="currentPhase" class="admin-list-card blueprint-shell">
      <div class="blueprint-shell__head">
        <div class="blueprint-shell__title-row">
          <span class="blueprint-shell__order">{{ String(currentPhase.order).padStart(2, '0') }}</span>
          <h3 class="blueprint-shell__title">{{ currentPhase.label }}</h3>
          <span class="admin-meta-chip">
            <span class="admin-meta-chip__key">mode</span>
            <span class="admin-meta-chip__value">{{ currentOrchestrator ? '主编排' : '成员视图' }}</span>
          </span>
          <span class="admin-meta-chip">
            <span class="admin-meta-chip__key">agent</span>
            <span class="admin-meta-chip__value">{{ currentPhase.agentId }}</span>
          </span>
          <span v-if="nextPhase" class="admin-meta-chip">
            <span class="admin-meta-chip__key">next</span>
            <span class="admin-meta-chip__value">{{ nextPhase.shortName }}</span>
          </span>
        </div>

        <div class="blueprint-shell__metrics">
          <div v-for="metric in currentPhaseMetrics" :key="metric.label" class="blueprint-shell__metric">
            <span>{{ metric.label }}</span>
            <strong>{{ metric.value }}</strong>
          </div>
        </div>
      </div>

      <div v-if="phaseVariablePreview.length" class="blueprint-shell__variables">
        <div class="blueprint-shell__variables-tags">
          <el-tag
            v-for="variable in phaseVariablePreview"
            :key="variable"
            size="small"
            effect="plain"
          >
            {{ variable }}
          </el-tag>
          <span v-if="totalPhaseVariables > phaseVariablePreview.length" class="blueprint-shell__variables-more">
            +{{ totalPhaseVariables - phaseVariablePreview.length }}
          </span>
        </div>
      </div>

      <div class="blueprint-shell__body">
        <section class="directory-strip">
          <div class="blueprint-section-head">
            <strong>{{ currentOrchestrator ? '索引' : '成员' }}</strong>
            <span>{{ currentOrchestrator ? `${currentOrchestrator.steps?.length || 0} 步` : `${currentPhaseSkills.length} 个` }}</span>
          </div>

          <div v-if="phaseDirectoryItems.length" class="phase-directory-list">
            <div v-for="item in phaseDirectoryItems" :key="item.key" class="phase-directory-item">
              <div class="phase-directory-item__main">
                <div class="phase-directory-item__title-row">
                  <span class="phase-directory-item__step">{{ item.stepLabel }}</span>
                  <span class="phase-directory-item__kind">{{ item.kindLabel }}</span>
                </div>
                <strong class="phase-directory-item__title">{{ item.displayName }}</strong>
                <p class="phase-directory-item__desc">{{ item.description }}</p>
                <div class="phase-directory-item__meta">
                  <span>IN {{ item.consumes.length }}</span>
                  <span>OUT {{ item.produces.length }}</span>
                  <span v-if="item.loopOver">循环 {{ item.loopOver }}</span>
                  <span v-else-if="item.condition">条件分支</span>
                </div>
              </div>

              <div class="phase-directory-item__actions">
                <el-button
                  v-if="item.action === 'skill'"
                  type="primary"
                  link
                  size="small"
                  @click="goToSkillEditor(item.agentId)"
                >
                  查看
                </el-button>
                <el-button
                  v-else-if="item.action === 'phase'"
                  type="primary"
                  link
                  size="small"
                  @click="switchToPhaseByAgentId(item.agentId)"
                >
                  切换
                </el-button>
                <el-button
                  v-else-if="item.action === 'logs'"
                  type="primary"
                  link
                  size="small"
                  @click="goToPromptLogs(item.agentId)"
                >
                  日志
                </el-button>
                <span v-else class="phase-directory-item__hint">内置</span>
              </div>
            </div>
          </div>

          <el-empty v-else description="暂无阶段成员数据" />
        </section>

        <div class="flow-pane">
          <div class="blueprint-section-head">
            <strong>{{ currentOrchestrator ? '流程' : 'Skills' }}</strong>
            <div class="flow-pane__head-actions">
              <el-button
                v-if="currentOrchestrator"
                type="primary"
                link
                size="small"
                @click="goToPromptLogs(currentPhase.agentId)"
              >
                日志
              </el-button>
              <span>{{ currentOrchestrator ? `${currentOrchestrator.steps?.length || 0} 步` : `${currentPhaseSkills.length} 个 Skills` }}</span>
            </div>
          </div>

          <template v-if="currentOrchestrator">
            <div class="flow-pane__legend">
              <span class="flow-pane__legend-item">
                <span class="flow-pane__legend-dot flow-pane__legend-dot--skill"></span>
                Skill
              </span>
              <span class="flow-pane__legend-item">
                <span class="flow-pane__legend-dot flow-pane__legend-dot--agent"></span>
                编排器
              </span>
              <span class="flow-pane__legend-item">
                <span class="flow-pane__legend-dot flow-pane__legend-dot--service"></span>
                服务
              </span>
            </div>

            <div class="topology-canvas" v-loading="loading">
              <VueFlow
                v-if="flowElements.length"
                :model-value="flowElements"
                :nodes-draggable="false"
                :nodes-connectable="false"
                :elements-selectable="true"
                :pan-on-drag="true"
                :zoom-on-scroll="true"
                :min-zoom="0.55"
                :max-zoom="1.5"
                :default-viewport="flowViewport"
                :fit-view-on-init="flowShouldFitView"
                class="vf-canvas"
              >
                <Background pattern-color="#d8e0ed" :gap="18" />
                <Controls />

                <template #node-skill="{ data }">
                  <div
                    class="vf-step-node vf-step-node--skill"
                    :class="{
                      'has-loop': data.loopOver,
                      'has-condition': data.condition
                    }"
                    @dblclick="handleFlowNodeOpen(data.agentId)"
                  >
                    <div class="vf-node-header">
                      <span class="vf-node-type">SKILL</span>
                      <span class="vf-node-step">步骤 {{ data.step }}</span>
                    </div>
                    <div class="vf-node-title">{{ data.displayName }}</div>
                    <div class="vf-node-role">{{ data.roleLabel }}</div>
                    <div class="vf-node-vars">
                      <div class="var-row">
                        <span class="var-icon var-icon--in">IN</span>
                        <div class="var-tags">
                          <el-tag v-for="v in data.consumes.slice(0, 3)" :key="v" size="small" effect="plain">{{ v }}</el-tag>
                          <span v-if="data.consumes.length > 3" class="var-more">+{{ data.consumes.length - 3 }}</span>
                          <span v-if="data.consumes.length === 0" class="var-empty">无</span>
                        </div>
                      </div>
                      <div class="var-row">
                        <span class="var-icon var-icon--out">OUT</span>
                        <div class="var-tags">
                          <el-tag
                            v-for="v in data.produces.slice(0, 3)"
                            :key="v"
                            size="small"
                            type="success"
                            effect="plain"
                          >
                            {{ v }}
                          </el-tag>
                          <span v-if="data.produces.length > 3" class="var-more">+{{ data.produces.length - 3 }}</span>
                          <span v-if="data.produces.length === 0" class="var-empty">无</span>
                        </div>
                      </div>
                    </div>
                    <div v-if="data.loopOver" class="vf-node-badge vf-node-badge--loop">循环 {{ data.loopOver }}</div>
                    <div v-if="data.condition" class="vf-node-badge vf-node-badge--condition">条件 {{ data.condition }}</div>
                  </div>
                </template>

                <template #node-agent="{ data }">
                  <div class="vf-step-node vf-step-node--agent" @dblclick="handleFlowNodeOpen(data.agentId)">
                    <div class="vf-node-header">
                      <span class="vf-node-type">AGENT</span>
                      <span class="vf-node-step">步骤 {{ data.step }}</span>
                    </div>
                    <div class="vf-node-title">{{ data.displayName }}</div>
                    <div class="vf-node-role">{{ data.roleLabel }}</div>
                    <div class="vf-node-info">内部编排 {{ data.subSteps || '?' }} 个子步骤</div>
                  </div>
                </template>

                <template #node-service="{ data }">
                  <div class="vf-step-node vf-step-node--service" @dblclick="handleFlowNodeOpen(data.agentId)">
                    <div class="vf-node-header">
                      <span class="vf-node-type">SERVICE</span>
                      <span class="vf-node-step">步骤 {{ data.step }}</span>
                    </div>
                    <div class="vf-node-title">{{ data.displayName }}</div>
                    <div class="vf-node-role">{{ data.roleLabel }}</div>
                    <div class="vf-node-vars">
                      <div class="var-row">
                        <span class="var-icon var-icon--out">OUT</span>
                        <div class="var-tags">
                          <el-tag v-for="v in data.produces.slice(0, 3)" :key="v" size="small" effect="plain">{{ v }}</el-tag>
                          <span v-if="data.produces.length > 3" class="var-more">+{{ data.produces.length - 3 }}</span>
                          <span v-if="data.produces.length === 0" class="var-empty">无</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </template>
              </VueFlow>

              <el-empty v-else-if="!loading" description="当前阶段暂无流程数据" />
            </div>
          </template>

          <div v-else class="phase-skill-list">
            <div v-if="currentPhaseSkills.length" class="phase-skill-list__rows">
              <div v-for="skill in currentPhaseSkills" :key="skill.id" class="phase-skill-row">
                <div class="phase-skill-row__main">
                  <div class="phase-skill-row__title-row">
                    <strong>{{ skill.label }}</strong>
                    <el-tag size="small" effect="plain">{{ skill.id }}</el-tag>
                  </div>
                  <p class="phase-skill-row__desc">{{ getDescription(skill.id) }}</p>
                  <div class="phase-skill-row__meta">
                    <span>OUT {{ getVariableBindings(skill.id).produces.length }}</span>
                    <span>IN {{ getVariableBindings(skill.id).consumes.length }}</span>
                    <span v-if="skill.stats?.totalCalls">{{ skill.stats.totalCalls }} 次调用</span>
                  </div>
                </div>
                <el-button type="primary" link size="small" @click="goToSkillEditor(skill.id)">查看 Skill</el-button>
              </div>
            </div>
            <el-empty v-else description="当前阶段暂无成员 Skill" />
          </div>
        </div>
      </div>

      <div v-if="showCrossPhasePanel || currentOrchestrator" class="blueprint-shell__analysis">
        <section v-if="showCrossPhasePanel" class="analysis-pane">
          <div class="blueprint-section-head">
            <strong>接力</strong>
            <span>{{ currentPhase.shortName }} → {{ nextPhase?.shortName }}</span>
          </div>

          <div class="handoff-grid">
            <div class="handoff-grid__lane">
              <div class="handoff-grid__lane-head">
                <strong>{{ currentPhase.shortName }}</strong>
                <span>{{ currentPhaseProducedVariables.length }} 个输出</span>
              </div>
              <div v-if="currentPhaseProducedVariables.length" class="handoff-grid__tags">
                <el-tag
                  v-for="variable in currentPhaseProducedVariables.slice(0, 12)"
                  :key="variable"
                  size="small"
                  effect="plain"
                >
                  {{ variable }}
                </el-tag>
                <span v-if="currentPhaseProducedVariables.length > 12" class="handoff-grid__more">
                  +{{ currentPhaseProducedVariables.length - 12 }}
                </span>
              </div>
              <div v-else class="handoff-grid__empty">暂无显式输出</div>
            </div>

            <div class="handoff-grid__lane">
              <div class="handoff-grid__lane-head">
                <strong>{{ nextPhase?.shortName }}</strong>
                <span>{{ nextPhaseConsumers.length }} 个直接消费者</span>
              </div>
              <div v-if="nextPhaseConsumers.length" class="handoff-consumer-list">
                <div v-for="consumer in nextPhaseConsumers" :key="consumer.skillId" class="handoff-consumer-row">
                  <div class="handoff-consumer-row__main">
                    <strong>{{ consumer.skillLabel }}</strong>
                    <div class="handoff-consumer-row__tags">
                      <el-tag
                        v-for="variable in consumer.consumes.slice(0, 4)"
                        :key="variable"
                        size="small"
                        type="info"
                        effect="plain"
                      >
                        {{ variable }}
                      </el-tag>
                      <span v-if="consumer.consumes.length > 4" class="handoff-grid__more">
                        +{{ consumer.consumes.length - 4 }}
                      </span>
                    </div>
                  </div>
                  <el-button type="primary" link size="small" @click="goToSkillEditor(consumer.skillId)">查看</el-button>
                </div>
              </div>
              <div v-else class="handoff-grid__empty">下一阶段暂无直接消费关系</div>
            </div>
          </div>
        </section>

        <section v-if="currentOrchestrator" class="analysis-pane analysis-pane--table">
          <div class="blueprint-section-head">
            <strong>变量</strong>
            <span>{{ variableFlowMatrix.length }} 行</span>
          </div>

          <el-table :data="variableFlowMatrix" border>
            <el-table-column label="步骤" width="110">
              <template #default="{ row }">
                <strong>{{ row.stepLabel }}</strong>
              </template>
            </el-table-column>
            <el-table-column label="节点" min-width="200">
              <template #default="{ row }">{{ row.agentName }}</template>
            </el-table-column>
            <el-table-column label="产出变量" min-width="300">
              <template #default="{ row }">
                <div class="var-tags-inline">
                  <el-tag v-for="v in row.produces" :key="v" size="small" type="success" effect="plain">{{ v }}</el-tag>
                  <span v-if="row.produces.length === 0" class="var-empty">无显式产出</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="被消费于" min-width="220">
              <template #default="{ row }">
                <span v-if="row.consumedBy.length">{{ row.consumedBy.join('，') }}</span>
                <span v-else class="var-empty">无</span>
              </template>
            </el-table-column>
          </el-table>
        </section>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { VueFlow, Position, type Edge, type Node } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import { Connection, Refresh } from '@element-plus/icons-vue'
import { adminAgentTopologyApi, adminRuntimeDefinitionsApi } from '@/api/adminApi'
import AdminPageHeader from './components/AdminPageHeader.vue'
import { toast } from '@/utils/toast'

interface RuntimeDefinition {
  id: string
  displayName?: string
  description?: string
  category?: string
  variableBindings?: {
    consumes?: string[]
    produces?: string[]
  } | null
}

interface OrchestratorStep {
  step: number
  agentId: string
  role?: string
  loopOver?: string
  condition?: string
}

interface OrchestratorDefinition {
  id: string
  displayName?: string
  description?: string
  category?: string
  steps?: OrchestratorStep[]
}

interface TopologyNodeItem {
  id: string
  type: string
  label: string
  parentAgentId?: string
  stats?: {
    totalCalls?: number
    successRate?: number
    avgDuration?: number
  }
}

interface PhaseSpec {
  id: string
  agentId: string
  label: string
  shortName: string
  description: string
  order: number
}

interface PhaseDirectoryItem {
  key: string
  stepLabel: string
  displayName: string
  description: string
  kindLabel: string
  action: 'skill' | 'phase' | 'logs' | 'none'
  agentId: string
  consumes: string[]
  produces: string[]
  loopOver?: string
  condition?: string
}

const router = useRouter()
const route = useRoute()

const loading = ref(false)
const orchestrators = ref<OrchestratorDefinition[]>([])
const agentDefinitions = ref<RuntimeDefinition[]>([])
const topologyData = ref<{ nodes?: TopologyNodeItem[] } | null>(null)
const selectedPhaseId = ref('goal')

const PHASES: PhaseSpec[] = [
  {
    id: 'goal',
    agentId: 'goal-agent',
    label: 'Goal 阶段',
    shortName: 'Goal',
    description: '目标收集、意图澄清与进入 Path 前的统一主输入整理。',
    order: 1
  },
  {
    id: 'path',
    agentId: 'path-agent',
    label: 'Path 阶段',
    shortName: 'Path',
    description: '路径生成、里程碑拆解与阶段任务扩展，是主规划链路。',
    order: 2
  },
  {
    id: 'teaching',
    agentId: 'teaching-agent',
    label: 'Teaching 阶段',
    shortName: 'Teaching',
    description: '课堂上下文构建、单轮教学、伴学强化与 wrapup 的执行层。',
    order: 3
  },
  {
    id: 'learner',
    agentId: 'learner-agent',
    label: 'Learner 阶段',
    shortName: 'Learner',
    description: '学习者画像、知识沉淀、动态投影与 learner 状态刷新。',
    order: 4
  },
  {
    id: 'simulation',
    agentId: 'simulation-agent',
    label: 'Simulation 阶段',
    shortName: 'Simulation',
    description: '虚拟学习者实验链路，串联 Goal、Path、Learn 的回放与评估。',
    order: 5
  }
]

const roleLabelMap: Record<string, string> = {
  'goal-clarification': '澄清目标与真实问题',
  'input-normalization': '清洗输入并补节奏建议',
  'cognitive-core-and-milestones': '生成认知图景与主干阶段',
  'stage-task-expansion': '逐阶段展开 subtasks',
  'teaching-context-build': '教学上下文构建',
  'teaching-turn-generation': '教学回合生成',
  'peer-reinforcement': '伴学强化',
  'checkpoint-decision': '检查点决策',
  'session-wrapup': '课后产出',
  'replan-advisory': '重规划建议',
  'goal-and-learning-signal-ingestion': '学习者相关事件摄入',
  'goal-profile-enrichment': '目标画像补充',
  'learning-pattern-enrichment': '学习模式补充',
  'session-background-distillation': '课堂背景蒸馏',
  'dialogue-concept-extraction': '对话概念抽取',
  'learner-snapshot-refresh': '学习者快照刷新',
  'goal-stage-learner-turn-simulation': 'Goal 阶段学习者模拟',
  'goal-clarification-and-convergence': 'Goal 对话收敛',
  'learning-path-generation': '学习路径生成',
  'path-review-reaction': '路径评估反应',
  'learn-stage-learner-turn-simulation': 'Learn 阶段学习者模拟',
  'learning-session-execution': '学习会话执行',
  'experiment-referee-evaluation': '实验终局旁路裁判'
}

const currentPhase = computed(() => PHASES.find((phase) => phase.id === selectedPhaseId.value) || null)

const orchestratorMap = computed(() => new Map(orchestrators.value.map((item) => [item.id, item])))
const definitionMap = computed(() => new Map(agentDefinitions.value.map((item) => [item.id, item])))
const topologyNodeMap = computed(() => new Map((topologyData.value?.nodes || []).map((item) => [item.id, item])))

const currentOrchestrator = computed(() => {
  if (!currentPhase.value) return null
  return orchestratorMap.value.get(currentPhase.value.agentId) || null
})

const nextPhase = computed(() => {
  if (!currentPhase.value) return null
  return PHASES.find((phase) => phase.order === currentPhase.value!.order + 1) || null
})

const currentPhaseSkills = computed<TopologyNodeItem[]>(() => {
  if (!currentPhase.value || !topologyData.value?.nodes?.length) return []
  return topologyData.value.nodes.filter((node) => node.type === 'skill' && node.parentAgentId === currentPhase.value!.agentId)
})

const pageHighlights = computed(() => {
  if (!currentPhase.value) return []

  return [
    { label: `${currentPhase.value.shortName}`, tone: 'neutral' as const },
    {
      label: currentOrchestrator.value ? `${currentOrchestrator.value.steps?.length || 0} 步主编排` : '仅成员视图',
      tone: 'neutral' as const
    },
    { label: `${currentPhaseSkills.value.length} 个 Skills`, tone: 'neutral' as const },
    { label: `${totalPhaseVariables.value} 个变量接力`, tone: 'neutral' as const }
  ]
})

const phaseCards = computed(() => {
  return PHASES.map((phase) => {
    const orchestrator = orchestratorMap.value.get(phase.agentId)
    const skillCount = (topologyData.value?.nodes || []).filter(
      (node) => node.type === 'skill' && node.parentAgentId === phase.agentId
    ).length

    return {
      ...phase,
      hasOrchestrator: !!orchestrator,
      stepCount: orchestrator?.steps?.length || 0,
      skillCount
    }
  })
})

const currentPhaseMetrics = computed(() => {
  const handoffTarget = nextPhaseConsumers.value.length

  return [
    {
      label: '模式',
      value: currentOrchestrator.value ? '主编排' : '成员视图'
    },
    {
      label: '节点数',
      value: String(currentOrchestrator.value?.steps?.length || currentPhaseSkills.value.length)
    },
    {
      label: '变量数',
      value: String(totalPhaseVariables.value)
    },
    {
      label: '下游接力',
      value: String(handoffTarget)
    }
  ]
})

const phaseVariablePreview = computed(() => currentPhaseVariables.value.slice(0, 8))
const totalPhaseVariables = computed(() => currentPhaseVariables.value.length)

const phaseDirectoryItems = computed<PhaseDirectoryItem[]>(() => {
  if (currentOrchestrator.value?.steps?.length) {
    return currentOrchestrator.value.steps.map((step) => {
      const bindings = getVariableBindings(step.agentId)
      const kind = getNodeType(step.agentId)

      return {
        key: `step-${step.step}-${step.agentId}`,
        stepLabel: `步骤 ${step.step}`,
        displayName: getDisplayName(step.agentId),
        description: roleLabelMap[step.role || ''] || getDescription(step.agentId),
        kindLabel: getKindLabel(kind),
        action: getNodeAction(step.agentId, kind),
        agentId: step.agentId,
        consumes: bindings.consumes,
        produces: bindings.produces,
        loopOver: step.loopOver,
        condition: step.condition
      }
    })
  }

  return currentPhaseSkills.value.map((skill, index) => {
    const bindings = getVariableBindings(skill.id)

    return {
      key: `${skill.id}-${index}`,
      stepLabel: `成员 ${String(index + 1).padStart(2, '0')}`,
      displayName: getDisplayName(skill.id),
      description: getDescription(skill.id),
      kindLabel: 'Skill',
      action: 'skill',
      agentId: skill.id,
      consumes: bindings.consumes,
      produces: bindings.produces
    }
  })
})

const currentPhaseProducedVariables = computed(() => {
  const produced = new Set<string>()

  for (const item of phaseDirectoryItems.value) {
    for (const variable of item.produces) {
      produced.add(variable)
    }
  }

  return Array.from(produced)
})

const currentPhaseVariables = computed(() => {
  const values = new Set<string>()

  for (const item of phaseDirectoryItems.value) {
    for (const variable of item.consumes) values.add(variable)
    for (const variable of item.produces) values.add(variable)
  }

  return Array.from(values)
})

const nextPhaseConsumers = computed(() => {
  if (!nextPhase.value || !topologyData.value?.nodes?.length) return []

  const currentProduces = new Set<string>()
  for (const variable of currentPhaseProducedVariables.value) {
    currentProduces.add(variable)
    const parts = variable.split('.')
    for (let index = 1; index < parts.length; index += 1) {
      currentProduces.add(parts.slice(0, index + 1).join('.'))
    }
  }

  const nextSkills = topologyData.value.nodes.filter(
    (node) => node.type === 'skill' && node.parentAgentId === nextPhase.value!.agentId
  )

  return nextSkills
    .map((skill) => {
      const consumes = getVariableBindings(skill.id).consumes.filter((variable) => {
        return Array.from(currentProduces).some((candidate) => {
          return (
            variable.startsWith(candidate) ||
            candidate.startsWith(variable) ||
            variable.split('.').slice(0, 2).join('.') === candidate.split('.').slice(0, 2).join('.')
          )
        })
      })

      return {
        skillId: skill.id,
        skillLabel: getDisplayName(skill.id),
        consumes
      }
    })
    .filter((item) => item.consumes.length > 0)
})

const showCrossPhasePanel = computed(() => !!nextPhase.value && currentPhaseProducedVariables.value.length > 0)

const flowShouldFitView = computed(() => (currentOrchestrator.value?.steps?.length || 0) > 1)

const flowViewport = computed(() => {
  if ((currentOrchestrator.value?.steps?.length || 0) <= 1) {
    return { x: 220, y: 28, zoom: 1 }
  }

  return { x: 36, y: 24, zoom: 0.92 }
})

const flowElements = computed<Array<Node | Edge>>(() => {
  if (!currentOrchestrator.value?.steps?.length) return []

  const nodes: Node[] = []
  const edges: Edge[] = []
  const steps = currentOrchestrator.value.steps
  const isSingleStep = steps.length === 1
  const nodeWidth = isSingleStep ? 380 : 320
  const gapX = isSingleStep ? 0 : 364

  steps.forEach((step, index) => {
    const kind = getNodeType(step.agentId)
    const bindings = getVariableBindings(step.agentId)

    nodes.push({
      id: `step-${step.step}`,
      type: kind,
      position: { x: index * gapX, y: 0 },
      data: {
        step: step.step,
        agentId: step.agentId,
        displayName: getDisplayName(step.agentId),
        roleLabel: roleLabelMap[step.role || ''] || step.role || '未命名角色',
        consumes: bindings.consumes,
        produces: bindings.produces,
        loopOver: step.loopOver,
        condition: step.condition,
        subSteps: orchestratorMap.value.get(step.agentId)?.steps?.length
      },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      style: { width: `${nodeWidth}px` }
    } as Node)
  })

  for (let index = 0; index < steps.length - 1; index += 1) {
    const currentStep = steps[index]
    const nextStep = steps[index + 1]
    const currentProduces = getVariableBindings(currentStep.agentId).produces
    const nextConsumes = getVariableBindings(nextStep.agentId).consumes
    const sharedVariables = currentProduces.filter((variable) => nextConsumes.includes(variable))
    const hasCondition = !!nextStep.condition
    const hasLoop = !!currentStep.loopOver

    let edgeLabel = ''
    if (hasCondition) {
      edgeLabel = nextStep.condition || ''
    } else if (sharedVariables.length) {
      edgeLabel = sharedVariables.length <= 3
        ? sharedVariables.join(', ')
        : `${sharedVariables.slice(0, 3).join(', ')} +${sharedVariables.length - 3}`
    }

    edges.push({
      id: `edge-${currentStep.step}-${nextStep.step}`,
      source: `step-${currentStep.step}`,
      target: `step-${nextStep.step}`,
      label: edgeLabel,
      type: hasCondition ? 'smoothstep' : 'default',
      animated: hasLoop,
      style: {
        stroke: hasCondition
          ? '#d97706'
          : sharedVariables.length
            ? '#3478f6'
            : '#94a3b8',
        strokeWidth: 1.8,
        strokeDasharray: hasCondition ? '6 5' : undefined
      },
      labelStyle: {
        fontSize: 11,
        fill: '#5f718e',
        fontWeight: 600
      }
    } as Edge)
  }

  return [...nodes, ...edges]
})

const variableFlowMatrix = computed(() => {
  if (!currentOrchestrator.value?.steps?.length) return []

  return currentOrchestrator.value.steps.map((step, index, steps) => {
    const produces = getVariableBindings(step.agentId).produces
    const consumedBy: string[] = []

    for (let nextIndex = index + 1; nextIndex < steps.length; nextIndex += 1) {
      const laterStep = steps[nextIndex]
      const laterConsumes = getVariableBindings(laterStep.agentId).consumes
      if (produces.some((variable) => laterConsumes.includes(variable))) {
        consumedBy.push(`步骤 ${laterStep.step}`)
      }
    }

    return {
      stepLabel: `步骤 ${step.step}`,
      agentName: getDisplayName(step.agentId),
      produces,
      consumedBy
    }
  })
})

const selectPhase = (phaseId: string) => {
  selectedPhaseId.value = phaseId
}

const stripSkillPrefix = (agentId: string) => agentId.replace(/^skill:/, '')

const findPhaseByAgentId = (agentId: string) => PHASES.find((phase) => phase.agentId === agentId) || null

const resolveDefinition = (agentId: string) => {
  const direct = definitionMap.value.get(agentId)
  if (direct) return direct

  if (!agentId.startsWith('skill:')) {
    const prefixed = definitionMap.value.get(`skill:${agentId}`)
    if (prefixed) return prefixed
  }

  return definitionMap.value.get(stripSkillPrefix(agentId)) || null
}

const getDisplayName = (agentId: string) => {
  const definition = resolveDefinition(agentId)
  if (definition?.displayName) return definition.displayName

  const orchestrator = orchestratorMap.value.get(agentId)
  if (orchestrator?.displayName) return orchestrator.displayName

  const topologyNode = topologyNodeMap.value.get(agentId)
  if (topologyNode?.label) return topologyNode.label

  const phase = findPhaseByAgentId(agentId)
  if (phase) return phase.label

  return stripSkillPrefix(agentId)
}

const getDescription = (agentId: string) => {
  const definition = resolveDefinition(agentId)
  if (definition?.description) return definition.description

  const orchestrator = orchestratorMap.value.get(agentId)
  if (orchestrator?.description) return orchestrator.description

  const phase = findPhaseByAgentId(agentId)
  if (phase) return phase.description

  return '暂无说明'
}

const getVariableBindings = (agentId: string) => {
  const definition = resolveDefinition(agentId)
  return {
    consumes: definition?.variableBindings?.consumes || [],
    produces: definition?.variableBindings?.produces || []
  }
}

function getNodeType(agentId: string): 'skill' | 'agent' | 'service' {
  if (agentId.startsWith('skill:')) return 'skill'
  if (findPhaseByAgentId(agentId)) return 'agent'
  if (orchestratorMap.value.has(agentId)) return 'agent'
  return 'service'
}

const getKindLabel = (kind: 'skill' | 'agent' | 'service') => {
  if (kind === 'skill') return 'Skill'
  if (kind === 'agent') return '编排器'
  return '服务'
}

const getNodeAction = (agentId: string, kind: 'skill' | 'agent' | 'service') => {
  if (kind === 'skill') return 'skill' as const
  if (kind === 'agent' && findPhaseByAgentId(agentId)) return 'phase' as const
  if (resolveDefinition(agentId) || orchestratorMap.value.has(agentId)) return 'logs' as const
  return 'none' as const
}

const switchToPhaseByAgentId = (agentId: string) => {
  const phase = findPhaseByAgentId(agentId)
  if (!phase) return
  selectedPhaseId.value = phase.id
}

const goToSkillEditor = (skillId: string) => {
  router.push({ name: 'AdminAgentEditor', params: { agentId: stripSkillPrefix(skillId) } })
}

const goToPromptLogs = (agentId: string) => {
  if (!agentId) return
  router.push({ path: '/admin/prompt-call-logs', query: { agentId } })
}

const handleFlowNodeOpen = (agentId: string) => {
  const kind = getNodeType(agentId)

  if (kind === 'skill') {
    goToSkillEditor(agentId)
    return
  }

  if (kind === 'agent') {
    const phase = findPhaseByAgentId(agentId)
    if (phase) {
      selectedPhaseId.value = phase.id
      return
    }

    goToPromptLogs(agentId)
    return
  }

  if (resolveDefinition(agentId)) {
    goToPromptLogs(agentId)
    return
  }

  toast.info('该节点是平台内置服务，请结合执行日志查看运行详情')
}

const syncPhaseFromRoute = () => {
  const phaseId = typeof route.query.phaseId === 'string' ? route.query.phaseId : ''
  if (phaseId && PHASES.some((phase) => phase.id === phaseId) && phaseId !== selectedPhaseId.value) {
    selectedPhaseId.value = phaseId
  }
}

const loadOrchestrators = async () => {
  loading.value = true
  try {
    const [orchestratorResponse, definitionResponse, topologyResponse]: any[] = await Promise.all([
      adminRuntimeDefinitionsApi.getOrchestratorDefinitions(),
      adminRuntimeDefinitionsApi.getAgentDefinitions(),
      adminAgentTopologyApi.getTopology('7d')
    ])

    orchestrators.value = orchestratorResponse.data?.data || []
    agentDefinitions.value = definitionResponse.data?.data || []
    topologyData.value = topologyResponse.data?.data || null

    const phaseId = typeof route.query.phaseId === 'string' ? route.query.phaseId : ''
    selectedPhaseId.value = PHASES.some((phase) => phase.id === phaseId) ? phaseId : PHASES[0].id
  } catch (error: any) {
    toast.error(error.response?.data?.error?.message || '加载编排结构失败')
  } finally {
    loading.value = false
  }
}

watch(selectedPhaseId, (phaseId) => {
  if (route.query.phaseId === phaseId) return
  router.replace({
    path: route.path,
    query: {
      ...route.query,
      phaseId
    }
  })
})

watch(() => route.query.phaseId, () => {
  syncPhaseFromRoute()
})

onMounted(() => {
  syncPhaseFromRoute()
  loadOrchestrators()
})
</script>

<style scoped>
.orchestrator-definitions-page {
  gap: 16px;
}

.stage-nav {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
}

.stage-nav__item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 54px;
  padding: 0 14px;
  border: var(--admin-border-subtle);
  border-radius: var(--admin-radius-md);
  background: var(--admin-bg-surface);
  color: inherit;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.18s ease, background 0.18s ease, transform 0.18s ease;
}

.stage-nav__item:hover {
  border-color: rgba(52, 120, 246, 0.16);
  transform: none;
}

.stage-nav__item.is-active {
  border-color: rgba(52, 120, 246, 0.18);
  background: rgba(52, 120, 246, 0.02);
}

.stage-nav__order {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 30px;
  height: 30px;
  border-radius: 9px;
  background: var(--admin-bg-surface-alt);
  color: #5f718e;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.04em;
}

.stage-nav__label {
  min-width: 0;
  font-size: 14px;
  font-weight: 700;
  color: var(--admin-text-primary);
}

.stage-nav__meta {
  color: var(--admin-text-muted);
  font-size: 11px;
  font-weight: 600;
}

.stage-nav__item.is-active .stage-nav__order {
  background: rgba(52, 120, 246, 0.06);
  color: var(--admin-text-brand);
}

.blueprint-shell {
  padding: 18px 20px;
}

.blueprint-shell__head {
  display: grid;
  gap: 14px;
  padding-bottom: 14px;
  border-bottom: var(--admin-border-subtle);
}

.blueprint-shell__title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.blueprint-shell__order {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 40px;
  height: 40px;
  border-radius: 12px;
  background: rgba(52, 120, 246, 0.08);
  color: var(--admin-text-brand);
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.04em;
}

.blueprint-shell__title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--admin-text-primary);
}

.blueprint-shell__metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.blueprint-shell__metric {
  display: grid;
  gap: 2px;
}

.blueprint-shell__metric span {
  font-size: 12px;
  font-weight: 600;
  color: var(--admin-text-muted);
}

.blueprint-shell__metric strong {
  font-size: 1rem;
  font-weight: 800;
  color: var(--admin-text-primary);
}

.blueprint-shell__variables {
  display: grid;
  gap: 10px;
  padding: 14px 0;
  border-bottom: var(--admin-border-subtle);
}

.blueprint-shell__variables-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--admin-text-secondary);
}

.blueprint-shell__variables-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.blueprint-shell__variables-more {
  color: var(--admin-text-muted);
  font-size: 11px;
  font-weight: 600;
}

.blueprint-shell__body {
  display: grid;
  gap: 18px;
  padding-top: 16px;
}

.blueprint-shell__analysis {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 20px;
  padding-top: 16px;
  border-top: var(--admin-border-subtle);
  margin-top: 16px;
}

.directory-strip,
.flow-pane,
.analysis-pane {
  min-width: 0;
}

.directory-strip {
  display: grid;
  gap: 12px;
}

.blueprint-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  color: var(--admin-text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.blueprint-section-head strong {
  color: var(--admin-text-primary);
  font-size: 14px;
}

.flow-pane__head-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.phase-directory-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 0 18px;
}

.phase-directory-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 0;
  border-top: var(--admin-border-subtle);
}

.phase-directory-item:first-child,
.phase-directory-item:nth-child(2) {
  padding-top: 0;
  border-top: none;
}

.phase-directory-item__main {
  min-width: 0;
  display: grid;
  gap: 6px;
}

.phase-directory-item__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.phase-directory-item__step {
  color: #5f718e;
  font-size: 11px;
  font-weight: 700;
}

.phase-directory-item__kind {
  color: var(--admin-text-muted);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.phase-directory-item__title {
  font-size: 14px;
  line-height: 1.5;
  color: var(--admin-text-primary);
}

.phase-directory-item__desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--admin-text-secondary);
}

.phase-directory-item__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 11px;
  color: var(--admin-text-muted);
}

.phase-directory-item__actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  min-height: 22px;
}

.phase-directory-item__hint {
  font-size: 11px;
  color: var(--admin-text-muted);
}

.flow-pane__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-bottom: 12px;
  color: var(--admin-text-muted);
  font-size: 11px;
  font-weight: 600;
}

.flow-pane__legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.flow-pane__legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
}

.flow-pane__legend-dot--skill {
  background: var(--admin-text-brand);
}

.flow-pane__legend-dot--agent {
  background: #2f5dac;
}

.flow-pane__legend-dot--service {
  background: var(--admin-color-warning);
}

.topology-canvas {
  min-height: 560px;
  border: var(--admin-border-subtle);
  border-radius: 16px;
  background: linear-gradient(180deg, #fcfdff, #f6f8fc);
  overflow: hidden;
}

.vf-canvas {
  width: 100%;
  height: 560px;
}

.vf-step-node {
  width: 100%;
  min-width: 0;
  border-radius: 14px;
  background: var(--admin-bg-surface);
  border: 1px solid rgba(205, 216, 238, 0.95);
  box-shadow: 0 8px 24px rgba(46, 86, 148, 0.08);
  padding: 14px;
  display: grid;
  gap: 8px;
  cursor: pointer;
  transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
}

.vf-step-node:hover {
  transform: none;
  border-color: rgba(52, 120, 246, 0.26);
  box-shadow: 0 10px 22px rgba(46, 86, 148, 0.1);
}

.vf-step-node--skill {
  border-color: rgba(52, 120, 246, 0.18);
}

.vf-step-node--skill.has-loop {
  box-shadow: inset 0 0 0 1px rgba(111, 66, 193, 0.14), 0 8px 24px rgba(46, 86, 148, 0.08);
}

.vf-step-node--skill.has-condition {
  border-style: dashed;
  border-color: rgba(217, 119, 6, 0.4);
}

.vf-step-node--agent {
  background: linear-gradient(180deg, #f7faff, #eef4ff);
  border-color: rgba(52, 120, 246, 0.28);
}

.vf-step-node--service {
  background: var(--admin-bg-surface-alt);
  border-style: dashed;
  border-color: rgba(148, 163, 184, 0.5);
}

.vf-node-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.vf-node-type {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.08);
  color: var(--admin-text-brand);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.vf-step-node--service .vf-node-type {
  background: rgba(148, 163, 184, 0.14);
  color: #64748b;
}

.vf-node-step {
  color: var(--admin-text-muted);
  font-size: 11px;
  font-weight: 700;
}

.vf-node-title {
  color: var(--admin-text-primary);
  font-size: 14px;
  font-weight: 700;
  line-height: 1.45;
}

.vf-node-role,
.vf-node-info {
  color: var(--admin-text-secondary);
  font-size: 12px;
  line-height: 1.55;
}

.vf-node-vars {
  display: grid;
  gap: 8px;
}

.var-row {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.var-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  height: 22px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.05em;
  flex-shrink: 0;
}

.var-icon--in {
  background: rgba(100, 116, 139, 0.12);
  color: #5b6b84;
}

.var-icon--out {
  background: rgba(16, 185, 129, 0.12);
  color: #0f8a63;
}

.var-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  min-width: 0;
}

.var-tags :deep(.el-tag) {
  height: 22px;
  line-height: 20px;
  padding: 0 6px;
  font-size: 10px;
}

.var-more,
.var-empty {
  color: var(--admin-text-muted);
  font-size: 10px;
  font-weight: 600;
}

.vf-node-badge {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  min-height: 24px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
}

.vf-node-badge--loop {
  background: rgba(111, 66, 193, 0.1);
  color: #6f42c1;
}

.vf-node-badge--condition {
  background: rgba(217, 119, 6, 0.1);
  color: var(--admin-color-warning);
}

.phase-skill-list__rows {
  display: grid;
}

.phase-skill-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 0;
  border-top: var(--admin-border-subtle);
}

.phase-skill-row:first-child {
  padding-top: 0;
  border-top: none;
}

.phase-skill-row__main {
  min-width: 0;
  display: grid;
  gap: 6px;
}

.phase-skill-row__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.phase-skill-row__title-row strong {
  color: var(--admin-text-primary);
  font-size: 14px;
}

.phase-skill-row__desc {
  margin: 0;
  font-size: 12px;
  color: var(--admin-text-secondary);
  line-height: 1.6;
}

.phase-skill-row__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  color: var(--admin-text-muted);
  font-size: 11px;
}

.handoff-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
  gap: 18px;
}

.handoff-grid__lane {
  display: grid;
  gap: 12px;
}

.handoff-grid__lane-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--admin-text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.handoff-grid__lane-head strong {
  color: var(--admin-text-primary);
  font-size: 14px;
}

.handoff-grid__tags,
.handoff-consumer-row__tags,
.var-tags-inline {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.handoff-panel__consumer-list {
  display: grid;
}

.handoff-consumer-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 0;
  border-top: var(--admin-border-subtle);
}

.handoff-consumer-row:first-child {
  padding-top: 0;
  border-top: none;
}

.handoff-consumer-row__main {
  min-width: 0;
  display: grid;
  gap: 8px;
}

.handoff-consumer-row__main strong {
  color: var(--admin-text-primary);
  font-size: 13px;
}

.handoff-grid__empty,
.handoff-grid__more {
  color: var(--admin-text-muted);
  font-size: 11px;
  font-weight: 600;
}

.analysis-pane--table :deep(.el-table) {
  --el-table-border-color: rgba(52, 120, 246, 0.06);
  background: transparent;
}

.analysis-pane--table :deep(.el-table th.el-table__cell) {
  background: rgba(52, 120, 246, 0.03);
  color: #7085a6;
  font-weight: 700;
  font-size: 0.8125rem;
}

.analysis-pane--table :deep(.el-table td.el-table__cell) {
  border-bottom-color: rgba(52, 120, 246, 0.04);
}

.analysis-pane--table :deep(.el-table .el-table__row:hover > td.el-table__cell) {
  background: rgba(52, 120, 246, 0.028);
}

.analysis-pane--table :deep(.el-table) {
  width: 100%;
}

.flow-pane :deep(.vue-flow__controls) {
  border-radius: 12px;
  border: 1px solid rgba(205, 216, 238, 0.95);
  overflow: hidden;
}

.flow-pane :deep(.vue-flow__edge-textbg) {
  fill: rgba(255, 255, 255, 0.9);
}

.flow-pane :deep(.vue-flow__attribution) {
  display: none;
}

@media (max-width: 1280px) {
  .stage-nav {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .blueprint-shell__metrics,
  .blueprint-shell__analysis {
    grid-template-columns: minmax(0, 1fr);
  }

  .phase-directory-list,
  .handoff-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 1080px) {
  .topology-canvas,
  .vf-canvas {
    min-height: 540px;
    height: 540px;
  }
}

@media (max-width: 768px) {
  .stage-nav {
    grid-template-columns: minmax(0, 1fr);
  }

  .blueprint-shell__title-row,
  .phase-directory-item,
  .phase-skill-row,
  .handoff-consumer-row {
    flex-direction: column;
  }

  .blueprint-shell {
    padding: 16px;
  }

  .blueprint-shell__metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .phase-directory-list {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
