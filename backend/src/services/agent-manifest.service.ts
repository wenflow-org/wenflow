export type AgentRuntimeKind = 'agent' | 'skill' | 'orchestrator' | 'alias';

export type MonitoringGroupName =
  | 'RequirementCollection'
  | 'PathPlanning'
  | 'LearnerOrchestration'
  | 'Teaching'
  | 'TeachingOrchestration'
  | 'LearningCompanion'
  | 'SessionWrapup'
  | 'SimulationOrchestration'
  | 'Simulation';

export interface AgentManifestEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  kind: AgentRuntimeKind;
  runtimeEnabled: boolean;
  userVisible: boolean;
  monitoringGroup?: MonitoringGroupName;
  aliases?: string[];
  orchestratorMembers?: string[];
  defaultModelConfig?: {
    temperature: number;
    maxTokens: number;
  };
  ioContractVersion?: 'legacy' | 'agent-output-v1';
}

const AGENT_MANIFEST: AgentManifestEntry[] = [
  {
    id: 'goal-conversation-agent',
    name: '目标对话 Agent',
    description: '收集学习目标与上下文',
    category: 'learning',
    kind: 'agent',
    runtimeEnabled: true,
    userVisible: true,
    monitoringGroup: 'RequirementCollection',
    aliases: ['goal-conversation'],
    ioContractVersion: 'agent-output-v1',
    defaultModelConfig: {
      temperature: 0.7,
      maxTokens: 1800
    }
  },
  {
    id: 'path-agent',
    name: '学习路径规划 Agent',
    description: '规划学习路径',
    category: 'learning',
    kind: 'agent',
    runtimeEnabled: true,
    userVisible: true,
    monitoringGroup: 'PathPlanning',
    ioContractVersion: 'agent-output-v1',
    defaultModelConfig: {
      temperature: 0.4,
      maxTokens: 32000
    }
  },
  {
    id: 'learner-model-agent',
    name: '学习者模型 Agent',
    description: '聚合学习者画像、状态与知识记忆',
    category: 'analysis',
    kind: 'agent',
    runtimeEnabled: true,
    userVisible: true,
    ioContractVersion: 'agent-output-v1',
    defaultModelConfig: {
      temperature: 0.3,
      maxTokens: 1000
    }
  },
  {
    id: 'learner-orchestrator',
    name: '学习者编排器',
    description: '统一编排学习者画像增强、背景知识沉淀与 snapshot/projection 刷新链路',
    category: 'orchestration',
    kind: 'orchestrator',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'LearnerOrchestration',
    orchestratorMembers: [
      'learner-orchestrator',
      'learner-model-agent',
      'skill:goal-profile-inference',
      'skill:learning-pattern-distiller',
      'skill:session-knowledge-distiller',
      'skill:dialogue-concept-extractor'
    ]
  },
  {
    id: 'skill:peer-reinforcement',
    name: '伴学 Skill',
    description: '同伴式引导讨论与理解补强能力',
    category: 'teaching',
    kind: 'skill',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'LearningCompanion',
    aliases: ['peer-agent'],
    ioContractVersion: 'agent-output-v1',
    defaultModelConfig: {
      temperature: 0.8,
      maxTokens: 1000
    }
  },
  {
    id: 'teaching-turn-agent',
    name: '教学回合 Agent',
    description: '生成课堂单轮教学回复与结构化教学状态',
    category: 'teaching',
    kind: 'agent',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'Teaching',
    ioContractVersion: 'agent-output-v1',
    defaultModelConfig: {
      temperature: 0.5,
      maxTokens: 2200
    }
  },
  {
    id: 'session-wrapup-agent',
    name: '课后产出 Agent',
    description: '统一生成课后总结与评估',
    category: 'evaluation',
    kind: 'agent',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'SessionWrapup',
    ioContractVersion: 'agent-output-v1',
    defaultModelConfig: {
      temperature: 0.2,
      maxTokens: 2200
    }
  },
  {
    id: 'simulation-orchestrator',
    name: '虚拟学习者编排器',
    description: '编排虚拟学习者从故事进入 Goal、Path 接受评估与 Learn 阶段的完整实验链路',
    category: 'simulation',
    kind: 'orchestrator',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'SimulationOrchestration',
    orchestratorMembers: [
      'simulation-orchestrator',
      'virtual-learner-goal-dialogue-simulator',
      'goal-conversation-agent',
      'path-orchestrator',
      'virtual-learner-path-evaluator',
      'virtual-learner-learn-turn-simulator',
      'ai-teaching-agent'
    ]
  },
  {
    id: 'requirement-orchestrator',
    name: '需求编排器',
    description: '需求收集阶段编排器',
    category: 'orchestration',
    kind: 'orchestrator',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'RequirementCollection',
    orchestratorMembers: ['goal-conversation-agent', 'requirement-orchestrator']
  },
  {
    id: 'path-orchestrator',
    name: '路径编排器',
    description: '路径生成阶段编排器',
    category: 'orchestration',
    kind: 'orchestrator',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'PathPlanning',
    orchestratorMembers: ['path-agent', 'path-orchestrator']
  },
  {
    id: 'ai-teaching-agent',
    name: '教学编排器',
    description: 'AI 教学会话编排器',
    category: 'teaching',
    kind: 'orchestrator',
    runtimeEnabled: true,
    userVisible: true,
    monitoringGroup: 'TeachingOrchestration',
    aliases: ['ai-teaching'],
    orchestratorMembers: ['ai-teaching-agent', 'teaching-turn-agent', 'skill:peer-reinforcement', 'session-wrapup-agent']
  }
];

const manifestMap = new Map(AGENT_MANIFEST.map(item => [item.id, item]));
const aliasToCanonical = new Map<string, string>();

for (const item of AGENT_MANIFEST) {
  for (const alias of item.aliases || []) {
    aliasToCanonical.set(alias, item.id);
  }
}

export function listAgentManifest(): AgentManifestEntry[] {
  return AGENT_MANIFEST.map(item => ({ ...item }));
}

export function getAgentManifest(agentId: string): AgentManifestEntry | undefined {
  const canonical = getCanonicalAgentId(agentId);
  const entry = manifestMap.get(canonical);
  return entry ? { ...entry } : undefined;
}

export function getCanonicalAgentId(agentId: string): string {
  return aliasToCanonical.get(agentId) || agentId;
}

export function isManifestOrchestrator(agentId: string): boolean {
  const entry = getAgentManifest(agentId);
  return entry?.kind === 'orchestrator';
}

export function getOfficialAgentDefinitionsForUsers() {
  return AGENT_MANIFEST
    .filter(item => item.userVisible && item.kind !== 'alias')
    .map(item => ({
      id: item.id,
      name: item.name,
      description: item.description,
      category: item.category
    }));
}

export function getMonitoringGroupMappings() {
  const groupToIds: Record<string, string[]> = {};

  for (const item of AGENT_MANIFEST) {
    if (!item.monitoringGroup || item.kind === 'alias') {
      continue;
    }

    if (!groupToIds[item.monitoringGroup]) {
      groupToIds[item.monitoringGroup] = [];
    }

    groupToIds[item.monitoringGroup].push(item.id);
    for (const alias of item.aliases || []) {
      groupToIds[item.monitoringGroup].push(alias);
    }
  }

  return groupToIds;
}

export function getOrchestratorRelations() {
  return AGENT_MANIFEST
    .filter(item => item.kind === 'orchestrator')
    .map(item => ({
      orchestratorId: item.id,
      group: item.monitoringGroup,
      members: item.orchestratorMembers || [item.id]
    }));
}

export function getDefaultAgentModelConfigs() {
  return AGENT_MANIFEST
    .filter(item => item.defaultModelConfig)
    .map(item => ({
      agentId: item.id,
      tier: 'chat',
      temperature: item.defaultModelConfig!.temperature,
      maxTokens: item.defaultModelConfig!.maxTokens
    }));
}
