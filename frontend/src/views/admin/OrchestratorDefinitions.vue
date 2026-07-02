<template>
  <div class="runtime-definitions-page">
    <div class="page-hero">
      <span class="pill">Platform</span>
      <h2 class="page-hero__title admin-page-title">平台 Agent 架构</h2>
      <p class="page-hero__subtitle">5 个核心 Agent 协同完成个性化学习全流程，每个 Agent 由多个 Skill 编排而成。</p>
    </div>

    <el-tabs v-model="selectedPhaseId" class="agent-tabs" @tab-click="handlePhaseTabChange">
      <el-tab-pane 
        v-for="phase in PHASES" 
        :key="phase.id"
        :name="phase.id"
      >
        <template #label>
          <span class="agent-tab-label">
            <span class="agent-tab-icon">{{ phase.icon }}</span>
            <span>{{ phase.shortName }}</span>
          </span>
        </template>
      </el-tab-pane>
    </el-tabs>

    <div v-if="currentPhase" class="definition-detail-grid">
      <section class="detail-hero-card">
        <div class="detail-hero-card__main">
          <div class="detail-hero-card__header">
            <span class="pill">{{ currentPhase.label }}</span>
          </div>
          <h3>{{ currentPhase.description }}</h3>
          <p v-if="currentOrchestrator">{{ currentOrchestrator.description || '当前阶段暂无补充说明。' }}</p>
          <p v-else>该阶段暂无编排器定义。</p>
          <div class="detail-hero-card__meta">
            <span>{{ currentPhase.agentId }}</span>
          </div>
        </div>
        <div class="detail-hero-card__stats">
          <div class="detail-stat-card">
            <span class="detail-stat-card__label">Skills 数量</span>
            <strong>{{ currentPhaseSkills.length }}</strong>
          </div>
          <div class="detail-stat-card" v-if="currentOrchestrator">
            <span class="detail-stat-card__label">编排步骤</span>
            <strong>{{ currentOrchestrator.steps?.length || 0 }}</strong>
          </div>
          <div class="detail-stat-card" v-if="currentOrchestrator">
            <span class="detail-stat-card__label">变量总数</span>
            <strong>{{ totalUniqueVariables }}</strong>
          </div>
        </div>
      </section>

      <el-card shadow="never" class="detail-card topology-card" v-if="currentOrchestrator">
        <template #header>
          <div class="section-card__header">
            <strong>编排器内部流程</strong>
            <span>{{ currentOrchestrator.steps?.length || 0 }} 个步骤</span>
          </div>
        </template>

        <div class="topology-canvas" v-if="flowElements.length">
          <VueFlow
            :model-value="flowElements"
            :nodes-draggable="true"
            :nodes-connectable="false"
            :elements-selectable="true"
            :pan-on-drag="true"
            :zoom-on-scroll="true"
            :min-zoom="0.5"
            :max-zoom="1.5"
            :default-viewport="{ x: 50, y: 50, zoom: 0.9 }"
            fit-view-on-init
            class="vf-canvas"
          >
            <Background pattern-color="#e5e7eb" :gap="16" />
            <Controls />

            <template #node-skill="{ data }">
              <div
                class="vf-step-node vf-step-node--skill"
                :class="{
                  'has-loop': data.loopOver,
                  'has-condition': data.condition
                }"
                @dblclick="goToAgentDefinition(data.agentId)"
              >
                <div class="vf-node-header">
                  <span class="vf-node-type">SKILL</span>
                  <span class="vf-node-step">步骤 {{ data.step }}</span>
                </div>
                <div class="vf-node-title">{{ data.displayName }}</div>
                <div class="vf-node-role">{{ data.roleLabel }}</div>
                <div class="vf-node-vars">
                  <div class="var-row">
                    <span class="var-icon">📥</span>
                    <div class="var-tags">
                      <el-tag v-for="v in data.consumes.slice(0, 3)" :key="v" size="small" effect="plain">{{ v }}</el-tag>
                      <span v-if="data.consumes.length > 3" class="var-more">+{{ data.consumes.length - 3 }}</span>
                      <span v-if="data.consumes.length === 0" class="var-empty">无</span>
                    </div>
                  </div>
                  <div class="var-row">
                    <span class="var-icon">📤</span>
                    <div class="var-tags">
                      <el-tag v-for="v in data.produces.slice(0, 3)" :key="v" size="small" type="success" effect="plain">{{ v }}</el-tag>
                      <span v-if="data.produces.length > 3" class="var-more">+{{ data.produces.length - 3 }}</span>
                      <span v-if="data.produces.length === 0" class="var-empty">无</span>
                    </div>
                  </div>
                </div>
                <div v-if="data.loopOver" class="vf-node-badge vf-node-badge--loop">🔁 {{ data.loopOver }}</div>
                <div v-if="data.condition" class="vf-node-badge vf-node-badge--condition">⚡ {{ data.condition }}</div>
              </div>
            </template>

            <template #node-agent="{ data }">
              <div
                class="vf-step-node vf-step-node--agent"
                @dblclick="selectOrchestrator(data.agentId)"
              >
                <div class="vf-node-header">
                  <span class="vf-node-type">AGENT</span>
                  <span class="vf-node-step">步骤 {{ data.step }}</span>
                </div>
                <div class="vf-node-title">{{ data.displayName }}</div>
                <div class="vf-node-role">{{ data.roleLabel }}</div>
                <div class="vf-node-info">包含 {{ data.subSteps || '?' }} 个子步骤</div>
                <div class="vf-node-hint">双击查看详情 →</div>
              </div>
            </template>

            <template #node-service="{ data }">
              <div
                class="vf-step-node vf-step-node--service"
                @dblclick="goToAgentDefinition(data.agentId)"
              >
                <div class="vf-node-header">
                  <span class="vf-node-type">SERVICE</span>
                  <span class="vf-node-step">步骤 {{ data.step }}</span>
                </div>
                <div class="vf-node-title">{{ data.displayName }}</div>
                <div class="vf-node-role">{{ data.roleLabel }}</div>
                <div class="vf-node-vars">
                  <div class="var-row">
                    <span class="var-icon">📤</span>
                    <div class="var-tags">
                      <el-tag v-for="v in data.produces.slice(0, 3)" :key="v" size="small" effect="plain">{{ v }}</el-tag>
                      <span v-if="data.produces.length > 3" class="var-more">+{{ data.produces.length - 3 }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </VueFlow>
        </div>
        <el-empty v-else description="暂无步骤定义" />
      </el-card>

      <!-- 无编排器时：展示 Skills 列表和跨阶段数据流向 -->
      <template v-else-if="currentPhaseSkills.length > 0">
        <!-- Skills 列表卡片 -->
        <el-card shadow="never" class="detail-card">
          <template #header>
            <div class="section-card__header">
              <strong>阶段 Skills</strong>
              <span>{{ currentPhaseSkills.length }} 个 Skill</span>
            </div>
          </template>
          
          <div class="skills-grid">
            <div v-for="skill in currentPhaseSkills" :key="skill.id" class="skill-card">
              <div class="skill-card__header">
                <h4>{{ skill.label }}</h4>
                <el-tag size="small" type="info">{{ skill.id }}</el-tag>
              </div>
              <p class="skill-card__desc">{{ skill.description || '暂无描述' }}</p>
              
              <!-- 统计数据 -->
              <div class="skill-card__stats" v-if="skill.stats">
                <span>📊 {{ skill.stats.totalCalls || 0 }} 次调用</span>
                <span v-if="skill.stats.successRate != null">✅ {{ skill.stats.successRate }}% 成功率</span>
                <span v-if="skill.stats.avgDuration">⏱️ {{ skill.stats.avgDuration }}ms</span>
              </div>
              
              <!-- Produces 字段 -->
              <div class="skill-card__produces" v-if="getSkillProduces(skill.id).length > 0">
                <strong>📤 输出字段：</strong>
                <div class="var-tags">
                  <el-tag 
                    v-for="v in getSkillProduces(skill.id).slice(0, 5)" 
                    :key="v" 
                    size="small" 
                    type="success" 
                    effect="plain"
                  >
                    {{ v }}
                  </el-tag>
                  <span v-if="getSkillProduces(skill.id).length > 5" class="var-more">
                    +{{ getSkillProduces(skill.id).length - 5 }}
                  </span>
                </div>
              </div>
              
              <el-button size="small" text type="primary" @click="goToSkillEditor(skill.id)">
                编辑 Skill →
              </el-button>
            </div>
          </div>
        </el-card>

        <!-- 跨阶段数据流向 -->
        <el-card shadow="never" class="detail-card" v-if="getNextPhase()">
          <template #header>
            <div class="section-card__header">
              <strong>跨阶段数据流向</strong>
              <span>{{ currentPhase.shortName }} → {{ getNextPhase()?.shortName }}</span>
            </div>
          </template>
          
          <div class="cross-agent-flow">
            <!-- 当前阶段 -->
            <div class="flow-section">
              <h5>{{ currentPhase.icon }} {{ currentPhase.label }}</h5>
              <div class="flow-skills">
                <div v-for="skill in currentPhaseSkills" :key="skill.id" class="flow-skill-node">
                  <div class="flow-skill-name">{{ skill.label }}</div>
                  <div class="flow-produces" v-if="getSkillProduces(skill.id).length > 0">
                    <el-tag 
                      v-for="v in getSkillProduces(skill.id).slice(0, 3)" 
                      :key="v" 
                      size="small"
                      effect="plain"
                    >
                      {{ v }}
                    </el-tag>
                    <span v-if="getSkillProduces(skill.id).length > 3" class="var-more">
                      +{{ getSkillProduces(skill.id).length - 3 }}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            
            <div class="flow-arrow">→</div>
            
            <!-- 下一阶段 -->
            <div class="flow-section">
              <h5>{{ getNextPhase()?.icon }} {{ getNextPhase()?.label }}</h5>
              <div class="flow-skills">
                <div 
                  v-for="consumer in getConsumersFromNextPhase()" 
                  :key="consumer.skillId" 
                  class="flow-skill-node flow-skill-node--consumer"
                >
                  <div class="flow-skill-name">{{ consumer.skillLabel }}</div>
                  <div class="flow-consumes" v-if="consumer.consumes.length > 0">
                    <el-tag 
                      v-for="v in consumer.consumes.slice(0, 3)" 
                      :key="v" 
                      size="small" 
                      type="info"
                      effect="plain"
                    >
                      {{ v }}
                    </el-tag>
                    <span v-if="consumer.consumes.length > 3" class="var-more">
                      +{{ consumer.consumes.length - 3 }}
                    </span>
                  </div>
                </div>
                <div v-if="getConsumersFromNextPhase().length === 0" class="flow-empty">
                  暂无直接消费关系
                </div>
              </div>
            </div>
          </div>
        </el-card>
      </template>

      <el-card shadow="never" class="detail-card" v-if="currentOrchestrator">
        <template #header>
          <div class="section-card__header">
            <strong>变量流向矩阵</strong>
            <span>步骤产出与消费关系</span>
          </div>
        </template>
        <el-table :data="variableFlowMatrix" border v-if="variableFlowMatrix.length">
          <el-table-column label="步骤" width="100">
            <template #default="{ row }">
              <strong>{{ row.stepLabel }}</strong>
            </template>
          </el-table-column>
          <el-table-column label="节点" min-width="180">
            <template #default="{ row }">{{ row.agentName }}</template>
          </el-table-column>
          <el-table-column label="产出变量" min-width="280">
            <template #default="{ row }">
              <div class="var-tags-inline">
                <el-tag v-for="v in row.produces" :key="v" size="small" type="success" effect="plain">{{ v }}</el-tag>
                <span v-if="row.produces.length === 0" class="var-empty">无显式产出</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="被消费于" min-width="180">
            <template #default="{ row }">
              <span v-if="row.consumedBy.length">{{ row.consumedBy.join(', ') }}</span>
              <span v-else class="var-empty">无</span>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-else description="暂无变量流向数据" />
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { VueFlow, Position, type Node, type Edge } from '@vue-flow/core';
import { Background } from '@vue-flow/background';
import { Controls } from '@vue-flow/controls';
import '@vue-flow/core/dist/style.css';
import '@vue-flow/core/dist/theme-default.css';
import '@vue-flow/controls/dist/style.css';
import { adminRuntimeDefinitionsApi, adminAgentTopologyApi } from '@/api/adminApi';
import { toast } from '@/utils/toast';

const router = useRouter();
const loading = ref(false);
const orchestrators = ref<any[]>([]);
const agentDefinitions = ref<any[]>([]);
const topologyData = ref<any>(null); // Agent Topology 数据
const selectedPhaseId = ref('goal');

// 当前选中阶段的配置
const currentPhase = computed(() => {
  return PHASES.find(p => p.id === selectedPhaseId.value);
});

// 当前阶段的编排器（如果有）
const currentOrchestrator = computed(() => {
  if (!currentPhase.value) return null;
  return orchestrators.value.find(o => o.id === currentPhase.value.agentId && o.category === 'agent');
});

// 当前阶段的 Skills（从 Agent Topology 数据中获取）
const currentPhaseSkills = computed(() => {
  if (!topologyData.value || !currentPhase.value) return [];
  const nodes = topologyData.value.nodes || [];
  return nodes.filter((n: any) => n.type === 'skill' && n.parentAgentId === currentPhase.value.agentId);
});

// 5 个业务阶段配置（对应 Agent Topology 中的 5 个 Agent）
const PHASES = [
  {
    id: 'goal',
    agentId: 'goal-agent',
    icon: '🎯',
    label: '① Goal 阶段',
    shortName: 'Goal',
    description: '目标澄清阶段',
    order: 1,
  },
  {
    id: 'path',
    agentId: 'path-agent',
    icon: '🗺️',
    label: '② Path 阶段',
    shortName: 'Path',
    description: '路径规划阶段',
    order: 2,
  },
  {
    id: 'teaching',
    agentId: 'teaching-agent',
    icon: '📚',
    label: '③ Teaching 阶段',
    shortName: 'Teaching',
    description: '主动学习阶段',
    order: 3,
  },
  {
    id: 'learner',
    agentId: 'learner-agent',
    icon: '👤',
    label: '④ Learner 阶段',
    shortName: 'Learner',
    description: '学习者建模阶段',
    order: 4,
  },
  {
    id: 'simulation',
    agentId: 'simulation-agent',
    icon: '🤖',
    label: '⑤ Simulation 阶段',
    shortName: 'Simulation',
    description: '仿真测试阶段',
    order: 5,
  },
];

// 处理阶段 Tab 切换
const handlePhaseTabChange = (tab: any) => {
  const phaseId = tab.props.name;
  selectedPhaseId.value = phaseId;
};

// 监听 selectedPhaseId 变化，更新 URL
watch(selectedPhaseId, (newPhaseId) => {
  router.push({ 
    path: '/admin/orchestrator-definitions',
    query: { phaseId: newPhaseId }
  });
});

// 获取阶段标签
const getPhaseLabel = (phaseId: string) => {
  const phase = PHASES.find(p => p.id === phaseId);
  return phase?.label || '未知阶段';
};

const agentDefinitionMap = computed(() => new Map(agentDefinitions.value.map((item) => [item.id, item])));

const roleLabelMap: Record<string, string> = {
  'goal-clarification': '澄清目标与真实问题',
  'input-normalization': '清洗输入并补节奏建议',
  'cognitive-core-and-milestones': '生成认知图景与主干阶段',
  'stage-task-expansion': '逐阶段展开 subtasks',
  'goal-conversation': '目标对话',
  'teaching-context-build': '教学上下文构建',
  'teaching-turn-generation': '教学回合生成',
  'peer-reinforcement': '伴学强化',
  'checkpoint-decision': '检查点决策',
  'session-wrapup': '课后产出',
  'replan-advisory': '重规划建议',
};

// 判断节点类型：skill / agent / service
function getNodeType(agentId: string): 'skill' | 'agent' | 'service' {
  if (agentId.startsWith('agent:')) return 'agent';
  if (agentId.startsWith('skill:')) return 'skill';
  return 'service'; // context-builder, checkpoint-engine 等
}

// ========== 无编排器阶段的辅助函数 ==========

// 获取 Skill 的 produces 字段
const getSkillProduces = (skillId: string): string[] => {
  const def = agentDefinitionMap.value.get(skillId);
  if (!def?.variableBindings?.produces) return [];
  return def.variableBindings.produces;
};

// 获取下一个阶段
const getNextPhase = () => {
  if (!currentPhase.value) return null;
  const currentIndex = PHASES.findIndex(p => p.id === selectedPhaseId.value);
  return PHASES[currentIndex + 1] || null;
};

// 获取下一阶段中消费当前阶段输出的 Skills
const getConsumersFromNextPhase = (): Array<{skillId: string, skillLabel: string, consumes: string[]}> => {
  const nextPhase = getNextPhase();
  if (!nextPhase || !topologyData.value) return [];
  
  // 获取当前阶段所有 Skills 的 produces
  const currentProduces = new Set<string>();
  currentPhaseSkills.value.forEach(skill => {
    getSkillProduces(skill.id).forEach(v => {
      currentProduces.add(v);
      // 也添加字段的前缀部分，用于匹配
      const parts = v.split('.');
      for (let i = 1; i < parts.length; i++) {
        currentProduces.add(parts.slice(0, i + 1).join('.'));
      }
    });
  });
  
  // 获取下一阶段的 Skills
  const nextPhaseSkills = (topologyData.value.nodes || [])
    .filter((n: any) => n.type === 'skill' && n.parentAgentId === nextPhase.agentId);
  
  // 找出消费了当前阶段输出的 Skills
  const consumers: Array<{skillId: string, skillLabel: string, consumes: string[]}> = [];
  nextPhaseSkills.forEach((skill: any) => {
    const def = agentDefinitionMap.value.get(skill.id);
    const consumes = def?.variableBindings?.consumes || [];
    
    // 检查是否消费了当前阶段的输出
    const matchedConsumes = consumes.filter((v: string) => {
      // 检查是否有前缀匹配
      return Array.from(currentProduces).some(p => {
        return v.startsWith(p) || p.startsWith(v) || 
               v.split('.').slice(0, 2).join('.') === p.split('.').slice(0, 2).join('.');
      });
    });
    
    if (matchedConsumes.length > 0) {
      consumers.push({
        skillId: skill.id,
        skillLabel: skill.label,
        consumes: matchedConsumes
      });
    }
  });
  
  return consumers;
};

// 跳转到 Skill 编辑器
const goToSkillEditor = (skillId: string) => {
  const cleanId = skillId.replace('skill:', '');
  router.push({ name: 'AdminAgentEditor', params: { agentId: cleanId } });
};

// ========== End 无编排器阶段的辅助函数 ==========

// 统计编排器中的唯一变量总数
const totalUniqueVariables = computed(() => {
  if (!currentOrchestrator.value?.steps) return 0;
  
  const allVariables = new Set<string>();
  
  currentOrchestrator.value.steps.forEach((step: any) => {
    const def = agentDefinitionMap.value.get(step.agentId);
    if (def?.variableBindings) {
      (def.variableBindings.consumes || []).forEach((v: string) => allVariables.add(v));
      (def.variableBindings.produces || []).forEach((v: string) => allVariables.add(v));
    }
  });
  
  return allVariables.size;
});

// 构建 VueFlow 的节点和边
const flowElements = computed<Array<Node | Edge>>(() => {
  if (!currentOrchestrator.value?.steps) return [];
  
  const steps = currentOrchestrator.value.steps;
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  
  const NODE_WIDTH = 280;
  const NODE_GAP_X = 320;
  
  // 创建节点
  steps.forEach((step: any, index: number) => {
    const def = agentDefinitionMap.value.get(step.agentId);
    const nodeType = getNodeType(step.agentId);
    
    nodes.push({
      id: `step-${step.step}`,
      type: nodeType,
      position: { x: index * NODE_GAP_X, y: 0 },
      data: {
        step: step.step,
        agentId: step.agentId,
        displayName: def?.displayName || step.agentId,
        role: step.role,
        roleLabel: roleLabelMap[step.role] || step.role || '未命名角色',
        consumes: def?.variableBindings?.consumes || [],
        produces: def?.variableBindings?.produces || [],
        loopOver: step.loopOver,
        condition: step.condition,
        subSteps: nodeType === 'agent' ? '?' : undefined,
      },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      style: { width: `${NODE_WIDTH}px` },
    } as Node);
  });
  
  // 创建边
  for (let i = 0; i < steps.length - 1; i++) {
    const currentStep = steps[i];
    const nextStep = steps[i + 1];
    
    const currentDef = agentDefinitionMap.value.get(currentStep.agentId);
    const nextDef = agentDefinitionMap.value.get(nextStep.agentId);
    
    const produces = currentDef?.variableBindings?.produces || [];
    const consumes = nextDef?.variableBindings?.consumes || [];
    const sharedVars = produces.filter((v: string) => consumes.includes(v));
    
    const hasCondition = !!nextStep.condition;
    const hasLoop = !!currentStep.loopOver;
    
    let edgeLabel = '';
    if (hasCondition) {
      edgeLabel = nextStep.condition;
    } else if (sharedVars.length > 0) {
      edgeLabel = sharedVars.length <= 3 
        ? sharedVars.join(', ') 
        : `${sharedVars.slice(0, 3).join(', ')} +${sharedVars.length - 3}`;
    }
    
    edges.push({
      id: `edge-${currentStep.step}-${nextStep.step}`,
      source: `step-${currentStep.step}`,
      target: `step-${nextStep.step}`,
      label: edgeLabel,
      type: hasCondition ? 'smoothstep' : 'default',
      style: {
        stroke: hasCondition ? '#f59e0b' : (sharedVars.length > 0 ? '#10b981' : '#94a3b8'),
        strokeWidth: 2,
        strokeDasharray: hasCondition ? '5,5' : undefined,
      },
      labelStyle: { 
        fontSize: 11, 
        fill: '#64748b',
        fontWeight: 500,
      },
      animated: hasLoop,
    } as Edge);
  }
  
  return [...nodes, ...edges];
});

// 变量流向矩阵
const variableFlowMatrix = computed(() => {
  if (!currentOrchestrator.value?.steps) return [];
  
  const steps = currentOrchestrator.value.steps;
  
  return steps.map((step: any, index: number) => {
    const def = agentDefinitionMap.value.get(step.agentId);
    const produces = def?.variableBindings?.produces || [];
    
    // 找出哪些后续步骤消费了这些变量
    const consumers: string[] = [];
    for (let j = index + 1; j < steps.length; j++) {
      const laterStep = steps[j];
      const laterDef = agentDefinitionMap.value.get(laterStep.agentId);
      const laterConsumes = laterDef?.variableBindings?.consumes || [];
      
      const hasShared = produces.some((v: string) => laterConsumes.includes(v));
      if (hasShared) {
        consumers.push(`步骤 ${laterStep.step}`);
      }
    }
    
    return {
      stepLabel: `步骤 ${step.step}`,
      agentName: def?.displayName || step.agentId,
      produces,
      consumedBy: consumers,
    };
  });
});


const goToAgentDefinition = (agentId: string) => {
  router.push({ path: '/admin/agent-registry', query: { agentId } });
};

const goToPromptLogs = (agentId: string) => {
  router.push({ path: '/admin/prompt-call-logs', query: { agentId } });
};

const loadOrchestrators = async () => {
  loading.value = true;
  try {
    const [orchestratorResponse, agentDefinitionResponse, topologyResponse] = await Promise.all([
      adminRuntimeDefinitionsApi.getOrchestratorDefinitions(),
      adminRuntimeDefinitionsApi.getAgentDefinitions(),
      adminAgentTopologyApi.getTopology('7d'),
    ]);
    orchestrators.value = orchestratorResponse.data.data || [];
    agentDefinitions.value = agentDefinitionResponse.data.data || [];
    topologyData.value = topologyResponse.data?.data || null;
    
    // 从 URL 读取 phaseId 参数
    const urlPhaseId = router.currentRoute.value.query.phaseId as string;
    
    // 优先使用 URL 参数，否则使用第一个阶段
    if (urlPhaseId && PHASES.some(p => p.id === urlPhaseId)) {
      selectedPhaseId.value = urlPhaseId;
    } else {
      selectedPhaseId.value = PHASES[0].id;
    }
  } catch (error: any) {
    toast.error(error.response?.data?.error?.message || '加载数据失败');
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  loadOrchestrators();
});
</script>

<style scoped>
.runtime-definitions-page {
  display: grid;
  gap: 20px;
}

.page-hero {
  padding: 24px 28px;
  border-radius: 24px;
  border: 1px solid rgba(205, 216, 238, 0.9);
  background: radial-gradient(circle at top right, rgba(52, 120, 246, 0.06), transparent 38%), linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(244, 247, 252, 0.94));
  box-shadow: 0 16px 42px rgba(42, 72, 128, 0.08);
}

.admin-page-title {
  margin: 8px 0 0;
  font-size: 1.6rem;
  font-weight: 700;
  color: #22344d;
  letter-spacing: -0.03em;
}

.page-hero__subtitle {
  margin: 6px 0 0;
  color: #62758f;
  font-size: 0.95rem;
  line-height: 1.7;
}

.pill {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  min-height: 26px;
  padding: 0 12px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.08);
  color: #2d6df2;
  font-size: 12px;
  font-weight: 700;
}

/* Agent Tabs */
.agent-tabs {
  margin-top: 20px;
}

.agent-tabs :deep(.el-tabs__header) {
  margin-bottom: 20px;
}

.agent-tabs :deep(.el-tabs__nav-wrap::after) {
  display: none;
}

.agent-tabs :deep(.el-tabs__item) {
  font-size: 15px;
  font-weight: 600;
  color: #64748b;
  padding: 0 24px;
  height: 48px;
  line-height: 48px;
}

.agent-tabs :deep(.el-tabs__item.is-active) {
  color: #3b82f6;
}

.agent-tabs :deep(.el-tabs__active-bar) {
  background-color: #3b82f6;
  height: 3px;
}

.agent-tab-label {
  display: flex;
  align-items: center;
  gap: 8px;
}

.agent-tab-icon {
  font-size: 18px;
  line-height: 1;
}

/* Agent Grid - 删除，不再需要 */

.summary-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.summary-card {
  border-radius: 18px;
  border: 1px solid rgba(205, 216, 238, 0.9);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(246, 249, 255, 0.96));
  box-shadow: 0 12px 28px rgba(42, 72, 128, 0.08);
}

.summary-card .label {
  font-size: 0.75rem;
  color: #7b8ba3;
  font-weight: 600;
}

.summary-card .value {
  font-size: 1.85rem;
  font-weight: 800;
  margin-top: 0.3rem;
  color: #22344d;
  line-height: 1;
}

.summary-card--blue .value { color: var(--color-primary); }
.summary-card--green .value { color: #16a34a; }
.summary-card--purple .value { color: #7c3aed; }

:deep(.summary-card .el-card__body) {
  padding: 16px 18px;
}

.filters {
  padding: 16px 18px;
  border: 1px solid rgba(205, 216, 238, 0.9);
  border-radius: 20px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(248, 250, 255, 0.92));
  box-shadow: 0 12px 28px rgba(42, 72, 128, 0.08);
}

.admin-list-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}

.admin-list-toolbar__group {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.search {
  width: 260px;
}

.admin-list-card {
  width: 100%;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(248, 250, 255, 0.94));
  border: 1px solid #d2dbf3;
  border-radius: 28px;
  padding: 0.8rem;
  box-shadow: 0 18px 40px rgba(42, 72, 128, 0.1);
}

.definition-btn,
.table-link-btn {
  border-radius: 14px;
  font-weight: 700;
}

.definition-btn--primary {
  color: #fff;
  border-color: transparent;
  background: linear-gradient(135deg, #3478f6, #3f86ff);
}

.table-link-btn {
  min-height: 30px;
  padding: 0 12px;
  color: var(--color-primary-dark, #1f57cc);
  border: 1px solid rgba(52, 120, 246, 0.16);
  background: rgba(244, 249, 255, 0.96);
}

.table-link-btn--primary {
  color: #fff;
  border-color: transparent;
  background: linear-gradient(135deg, #3478f6, #3f86ff);
}

.table-link-btn--sm {
  min-height: 28px;
  padding: 0 10px;
}

.definition-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.definition-cell__id {
  font-size: 12px;
  color: #6b7280;
}

.definition-cell__desc {
  font-size: 13px;
  color: #4b5563;
}

.definition-detail-grid {
  display: grid;
  gap: 16px;
}

.detail-hero-card {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(280px, 0.9fr);
  gap: 16px;
  padding: 20px 22px;
  border-radius: 24px;
  border: 1px solid rgba(205, 216, 238, 0.9);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(244, 248, 255, 0.95));
  box-shadow: 0 16px 38px rgba(42, 72, 128, 0.08);
}

.detail-hero-card__main h3 {
  margin: 10px 0 0;
  color: #22344d;
  font-size: 1.4rem;
}

.detail-hero-card__header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 4px;
}

.detail-hero-card__main p {
  margin: 10px 0 0;
  color: #7085a6;
  line-height: 1.7;
}

.detail-hero-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 18px;
  margin-top: 14px;
  color: #7085a6;
  font-size: 0.875rem;
}

.detail-hero-card__stats {
  display: grid;
  gap: 10px;
}

.detail-stat-card,
.detail-card {
  border: 1px solid rgba(205, 216, 238, 0.86);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(247, 250, 255, 0.95));
}

.detail-stat-card {
  border-radius: 18px;
  padding: 14px 16px;
  display: grid;
  gap: 4px;
}

.detail-stat-card__label {
  color: #7b8ba3;
  font-size: 12px;
  font-weight: 700;
}

.detail-stat-card strong {
  color: #22344d;
  font-size: 1.1rem;
}

.detail-card :deep(.el-card__body) {
  padding: 0 18px 18px;
}

.section-card__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  color: #7085a6;
  font-size: 13px;
}

.detail-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}


.step-agent-cell {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
}

.step-agent-cell__actions {
  display: inline-flex;
  gap: 8px;
}

/* VueFlow 拓扑图样式 */
.topology-card {
  min-height: 600px;
}

.topology-canvas {
  height: 600px;
  border-radius: 12px;
  background: #fafbfc;
  border: 1px solid #e5e7eb;
}

.vf-canvas {
  background: #fafbfc;
}

.vf-step-node {
  border-radius: 12px;
  padding: 14px;
  background: #fff;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  cursor: pointer;
  transition: all 0.2s;
  min-width: 260px;
}

.vf-step-node:hover {
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
  transform: translateY(-2px);
}

.vf-step-node--skill {
  border: 2px solid #3b82f6;
}

.vf-step-node--skill.has-loop {
  border-left: 4px solid #9333ea;
}

.vf-step-node--skill.has-condition {
  border-color: #f59e0b;
  border-style: dashed;
}

.vf-step-node--agent {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #fff;
  border: none;
}

.vf-step-node--agent .vf-node-header,
.vf-step-node--agent .vf-node-title,
.vf-step-node--agent .vf-node-role,
.vf-step-node--agent .vf-node-info,
.vf-step-node--agent .vf-node-hint {
  color: #fff;
}

.vf-step-node--service {
  background: #f9fafb;
  border: 2px dashed #94a3b8;
}

.vf-node-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.vf-node-type {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 4px;
  background: rgba(59, 130, 246, 0.1);
  color: #3b82f6;
}

.vf-step-node--agent .vf-node-type {
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
}

.vf-step-node--service .vf-node-type {
  background: rgba(148, 163, 184, 0.1);
  color: #64748b;
}

.vf-node-step {
  font-size: 11px;
  font-weight: 600;
  color: #64748b;
}

.vf-step-node--agent .vf-node-step {
  color: rgba(255, 255, 255, 0.9);
}

.vf-node-title {
  font-size: 14px;
  font-weight: 700;
  color: #1e293b;
  margin-bottom: 4px;
  line-height: 1.3;
}

.vf-node-role {
  font-size: 12px;
  color: #64748b;
  margin-bottom: 10px;
  line-height: 1.4;
}

.vf-node-info {
  font-size: 12px;
  color: #64748b;
  margin-top: 8px;
}

.vf-node-hint {
  font-size: 11px;
  color: #3b82f6;
  margin-top: 8px;
  text-align: center;
}

.vf-node-vars {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}

.var-row {
  display: flex;
  gap: 6px;
  align-items: flex-start;
}

.var-icon {
  font-size: 14px;
  line-height: 1.8;
  flex-shrink: 0;
}

.var-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  flex: 1;
}

.var-tags :deep(.el-tag) {
  font-size: 10px;
  height: 20px;
  line-height: 18px;
  padding: 0 6px;
}

.var-more {
  font-size: 10px;
  color: #94a3b8;
  font-weight: 600;
}

.var-empty {
  font-size: 10px;
  color: #cbd5e1;
}

.vf-node-badge {
  margin-top: 8px;
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 6px;
  font-weight: 600;
}

.vf-node-badge--loop {
  background: rgba(147, 51, 234, 0.1);
  color: #9333ea;
}

.vf-node-badge--condition {
  background: rgba(245, 158, 11, 0.1);
  color: #f59e0b;
}

.var-tags-inline {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.var-tags-inline .var-empty {
  font-size: 12px;
}

/* ========== 无编排器阶段：Skills 列表 ========== */
.skills-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.skill-card {
  padding: 16px;
  border-radius: 12px;
  border: 1px solid #e5e7eb;
  background: #ffffff;
  transition: all 0.2s;
}

.skill-card:hover {
  border-color: #3b82f6;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.1);
}

.skill-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.skill-card__header h4 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: #1f2937;
  flex: 1;
}

.skill-card__desc {
  margin: 0 0 12px;
  font-size: 13px;
  color: #6b7280;
  line-height: 1.5;
}

.skill-card__stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
  font-size: 12px;
  color: #6b7280;
}

.skill-card__stats span {
  padding: 4px 8px;
  border-radius: 6px;
  background: #f3f4f6;
}

.skill-card__produces {
  margin-bottom: 12px;
}

.skill-card__produces strong {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  color: #374151;
}

/* ========== 跨阶段数据流向 ========== */
.cross-agent-flow {
  display: flex;
  align-items: stretch;
  gap: 24px;
  min-height: 200px;
}

.flow-section {
  flex: 1;
  padding: 16px;
  border-radius: 12px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
}

.flow-section h5 {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 600;
  color: #374151;
}

.flow-skills {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.flow-skill-node {
  padding: 12px;
  border-radius: 8px;
  background: #ffffff;
  border: 1px solid #e5e7eb;
}

.flow-skill-node--consumer {
  border-color: #93c5fd;
  background: #eff6ff;
}

.flow-skill-name {
  font-size: 13px;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 6px;
}

.flow-produces,
.flow-consumes {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}

.flow-arrow {
  display: flex;
  align-items: center;
  font-size: 32px;
  color: #9ca3af;
  font-weight: bold;
}

.flow-empty {
  padding: 20px;
  text-align: center;
  color: #9ca3af;
  font-size: 13px;
}

@media (max-width: 960px) {
  .summary-grid,
  .detail-hero-card {
    grid-template-columns: minmax(0, 1fr);
  }

  .admin-list-toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .admin-list-toolbar__group {
    justify-content: space-between;
  }

  .search {
    width: 100%;
  }

  .skills-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .cross-agent-flow {
    flex-direction: column;
  }

  .flow-arrow {
    transform: rotate(90deg);
    font-size: 24px;
  }
}
</style>
