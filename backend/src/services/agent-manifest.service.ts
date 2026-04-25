export type AgentRuntimeKind = 'agent' | 'orchestrator' | 'alias';

export type MonitoringGroupName =
  | 'RequirementCollection'
  | 'PathPlanning'
  | 'Teaching'
  | 'TeachingOrchestration'
  | 'LearningCompanion'
  | 'SessionEvaluation'
  | 'Summary';

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
      maxTokens: 10000
    }
  },
  {
    id: 'progress-agent',
    name: '进度追踪 Agent',
    description: '追踪学习进度',
    category: 'tracking',
    kind: 'agent',
    runtimeEnabled: true,
    userVisible: true,
    ioContractVersion: 'agent-output-v1',
    defaultModelConfig: {
      temperature: 0.4,
      maxTokens: 600
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
    id: 'peer-agent',
    name: '伴学 Agent',
    description: '同伴式引导讨论',
    category: 'teaching',
    kind: 'agent',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'LearningCompanion',
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
    id: 'summary-agent',
    name: '总结 Agent',
    description: '课后总结生成',
    category: 'evaluation',
    kind: 'agent',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'Summary',
    ioContractVersion: 'agent-output-v1',
    defaultModelConfig: {
      temperature: 0.3,
      maxTokens: 1800
    }
  },
  {
    id: 'session-evaluation-agent',
    name: '会话评估 Agent',
    description: '学习会话质量评估',
    category: 'evaluation',
    kind: 'agent',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'SessionEvaluation',
    ioContractVersion: 'agent-output-v1',
    defaultModelConfig: {
      temperature: 0.2,
      maxTokens: 1000
    }
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
    orchestratorMembers: ['ai-teaching-agent', 'teaching-turn-agent', 'peer-agent', 'summary-agent', 'session-evaluation-agent']
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
