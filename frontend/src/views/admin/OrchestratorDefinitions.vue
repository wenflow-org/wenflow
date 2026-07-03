<template>
  <div class="admin-page orchestrator-definitions-page">
    <AdminPageHeader
      title="平台 Agent 架构"
      :icon="Connection"
    >
      <template #actions>
        <el-button :icon="Refresh" :loading="loading" @click="loadOrchestrators">刷新</el-button>
      </template>
    </AdminPageHeader>

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
      <!-- 统计卡片网格 -->
      <section class="admin-summary-grid">
        <article class="admin-summary-card admin-summary-card--blue">
          <div class="admin-summary-card__label">Skills</div>
          <strong class="admin-summary-card__value">{{ currentPhaseSkills.length }}</strong>
          <div class="admin-summary-meta">Skills 数量</div>
        </article>
        <article class="admin-summary-card admin-summary-card--green">
          <div class="admin-summary-card__label">步骤</div>
          <strong class="admin-summary-card__value">{{ currentOrchestrator?.steps?.length || 0 }}</strong>
          <div class="admin-summary-meta">编排步骤</div>
        </article>
        <article class="admin-summary-card admin-summary-card--purple">
          <div class="admin-summary-card__label">变量</div>
          <strong class="admin-summary-card__value">{{ totalUniqueVariables }}</strong>
          <div class="admin-summary-meta">流转变量</div>
        </article>
        <article class="admin-summary-card admin-summary-card--orange">
          <div class="admin-summary-card__label">阶段</div>
          <strong class="admin-summary-card__value">{{ currentPhase.order }}</strong>
          <div class="admin-summary-meta">/ 5 学习阶段</div>
        </article>
      </section>

      <!-- 阶段描述区域 -->
      <section class="admin-filter-panel">
        <div class="admin-section-head">
          <div class="admin-section-head__copy">
            <h3 class="admin-section-head__title">{{ currentPhase.icon }} {{ currentPhase.label }}</h3>
            <p class="admin-section-head__desc">{{ currentOrchestrator?.description || currentPhase.description }}</p>
          </div>
        </div>
      </section>

      <!-- 内部流程图 -->
      <section class="admin-list-card" v-if="currentOrchestrator">
        <div class="admin-section-head">
          <div class="admin-section-head__copy">
            <h3 class="admin-section-head__title">内部流程</h3>
          </div>
          <div class="admin-section-head__meta">
            <span>{{ currentOrchestrator.steps?.length || 0 }} 步</span>
          </div>
        </div>

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
      </section>

      <!-- 无编排器时：展示 Skills 列表 -->
      <section class="admin-list-card" v-else-if="currentPhaseSkills.length > 0">
        <div class="admin-section-head">
          <div class="admin-section-head__copy">
            <h3 class="admin-section-head__title">阶段 Skills</h3>
          </div>
          <div class="admin-section-head__meta">
            <span>{{ currentPhaseSkills.length }} 个</span>
          </div>
        </div>
        
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
      </section>

      <!-- 跨阶段数据流向 -->
      <section class="admin-list-card" v-if="getNextPhase() && currentPhaseSkills.length > 0">
        <div class="admin-section-head">
          <div class="admin-section-head__copy">
            <h3 class="admin-section-head__title">阶段间传递</h3>
            <p class="admin-section-head__desc">{{ currentPhase.shortName }} → {{ getNextPhase()?.shortName }}</p>
          </div>
        </div>
        
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
      </section>

      <!-- 变量流向 -->
      <section class="admin-list-card" v-if="currentOrchestrator">
        <div class="admin-section-head">
          <div class="admin-section-head__copy">
            <h3 class="admin-section-head__title">变量流向</h3>
          </div>
        </div>
        
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
      </section>
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
import AdminPageHeader from './components/AdminPageHeader.vue';
import { Connection, Refresh } from '@element-plus/icons-vue';

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
/* ========== 页面容器 ========== */
.orchestrator-definitions-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* ========== 统计卡片补充样式 ========== */
.admin-summary-meta {
  font-size: 13px;
  color: #94a3b8;
  margin-top: 6px;
  font-weight: 500;
}

/* 覆盖平台统计卡片样式，增大字号 */
.admin-summary-card__label {
  font-size: 14px !important;
  font-weight: 600 !important;
  color: #64748b !important;
  margin-bottom: 8px !important;
}

.admin-summary-card__value {
  font-size: 2.5rem !important;
  font-weight: 700 !important;
  line-height: 1 !important;
}

/* ========== Agent Tabs ========== */
.agent-tabs {
  margin-top: 24px;
  margin-bottom: 8px;
}

.agent-tabs :deep(.el-tabs__header) {
  margin-bottom: 24px;
  border-bottom: 2px solid #e2e8f0;
}

.agent-tabs :deep(.el-tabs__nav-wrap::after) {
  display: none;
}

.agent-tabs :deep(.el-tabs__item) {
  font-size: 15px;
  font-weight: 600;
  color: #64748b;
  padding: 0 28px;
  height: 52px;
  line-height: 52px;
  transition: all 0.2s ease;
}

.agent-tabs :deep(.el-tabs__item:hover) {
  color: #3b82f6;
}

.agent-tabs :deep(.el-tabs__item.is-active) {
  color: #3478f6;
  font-weight: 700;
}

.agent-tabs :deep(.el-tabs__active-bar) {
  background: linear-gradient(90deg, #3478f6, #60a5fa);
  height: 3px;
  border-radius: 3px 3px 0 0;
}

.agent-tab-label {
  display: flex;
  align-items: center;
  gap: 10px;
}

.agent-tab-icon {
  font-size: 20px;
  line-height: 1;
}

.definition-detail-grid {
  display: grid;
  gap: 24px;
  margin-top: 8px;
}

/* ========== 阶段描述区域优化 ========== */
.admin-filter-panel {
  padding: 20px 24px !important;
}

.admin-filter-panel .admin-section-head__title {
  font-size: 20px !important;
  font-weight: 700 !important;
  color: #1e293b !important;
  letter-spacing: -0.01em;
}

.admin-filter-panel .admin-section-head__desc {
  font-size: 14px !important;
  color: #64748b !important;
  margin-top: 6px !important;
  line-height: 1.6 !important;
}

/* ========== VueFlow 拓扑图样式 ========== */
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
