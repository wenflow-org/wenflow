/**
 * Agent Manifest - 真理源
 *
 * 架构：
 *   - 5 个顶层 Agent（kind=agent）：goal / path / teaching / learner / simulation
 *     - Agent 是"编排器"，不持有 system prompt，不直接调用 LLM
 *     - Agent 下辖一组 Skill（agentMembers）
 *   - N 个 Skill（kind=skill）：实际持有 prompt、调用 LLM 的执行单元
 *
 * 铁律（由 validateManifest 启动时强制）：
 *   - kind=agent: 不允许有 defaultModelConfig，agentMembers 必须非空
 *   - kind=skill: id 必须以 'skill:' 开头
 *   - alias: 仅用于旧 id 向新 id 的兼容映射
 */

export type AgentRuntimeKind = 'agent' | 'skill' | 'alias';

export type MonitoringGroupName =
  | 'Goal'
  | 'Path'
  | 'Teaching'
  | 'Learner'
  | 'Simulation'
  | 'Tool'
  // 兼容旧值（不再新增）
  | 'RequirementCollection'
  | 'PathPlanning'
  | 'LearnerOrchestration'
  | 'TeachingOrchestration'
  | 'LearningCompanion'
  | 'SessionWrapup'
  | 'SimulationOrchestration';

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
  agentMembers?: string[];
  defaultModelConfig?: {
    temperature: number;
    maxTokens: number;
  };
  ioContractVersion?: 'legacy' | 'agent-output-v1';
  /** kind=skill 时若该 skill 仅是聚合/handler-only、确无 prompt，可设此标志跳过 prompt 文件校验 */
  noPromptFile?: boolean;
}

const AGENT_MANIFEST: AgentManifestEntry[] = [
  // ============ 5 顶层 Agent（编排器，无 prompt） ============
  {
    id: 'goal-agent',
    name: '目标 Agent',
    description: '收集学习目标与上下文，输出 Goal Understanding',
    category: 'agent',
    kind: 'agent',
    runtimeEnabled: true,
    userVisible: true,
    monitoringGroup: 'Goal',
    aliases: ['requirement-agent', 'goal-conversation'],
    agentMembers: [
      'skill:goal-conversation',
      'skill:goal-profile-inference',
      'skill:goal-understanding-composer',
      'skill:dialogue-concept-extractor'
    ]
  },
  {
    id: 'path-agent',
    name: '路径 Agent',
    description: '规划学习路径与阶段拆分',
    category: 'agent',
    kind: 'agent',
    runtimeEnabled: true,
    userVisible: true,
    monitoringGroup: 'Path',
    agentMembers: [
      'skill:path-planning',
      'skill:path-scene-framing',
      'skill:stage-designer'
    ]
  },
  {
    id: 'teaching-agent',
    name: '教学 Agent',
    description: 'AI 教学会话编排：单轮教学、伴学补强、课后产出',
    category: 'agent',
    kind: 'agent',
    runtimeEnabled: true,
    userVisible: true,
    monitoringGroup: 'Teaching',
    aliases: ['ai-teaching-agent', 'ai-teaching'],
    agentMembers: [
      'skill:teaching-turn',
      'skill:peer-reinforcement',
      'skill:session-wrapup',
      'skill:teaching-strategy-selector',
      'skill:adaptive-guidance-copy',
      'skill:acceptance-evidence-evaluator'
    ]
  },
  {
    id: 'learner-agent',
    name: '学习者 Agent',
    description: '编排学习者画像、状态聚合、知识沉淀与 snapshot/projection 刷新',
    category: 'agent',
    kind: 'agent',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'Learner',
    agentMembers: [
      'skill:learner-model',
      'skill:learning-pattern-distiller',
      'skill:session-knowledge-distiller',
      'skill:label-generator'
    ]
  },
  {
    id: 'simulation-agent',
    name: '虚拟学习者 Agent',
    description: '编排虚拟学习者：正式黑盒按故事→Goal→Path 结果→Learn 运行；路径评估器仅用于辅助调试',
    category: 'agent',
    kind: 'agent',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'Simulation',
    agentMembers: [
      'skill:virtual-learner-persona-designer',
      'skill:virtual-learner-scenario-designer',
      'skill:virtual-learner-goal-dialogue-simulator',
      'skill:virtual-learner-path-evaluator',
      'skill:virtual-learner-learn-turn-simulator',
      'skill:virtual-learner-referee'
    ]
  },

  // ============ Goal 下辖 Skills ============
  {
    id: 'skill:goal-conversation',
    name: '目标对话 Skill',
    description: '与学习者多轮对话，收集学习目标',
    category: 'goal',
    kind: 'skill',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'Goal',
    aliases: ['goal-conversation-agent'],
    ioContractVersion: 'agent-output-v1',
    defaultModelConfig: { temperature: 0.7, maxTokens: 1800 }
  },
  {
    id: 'skill:goal-profile-inference',
    name: '目标画像推断 Skill',
    description: '从目标对话推断学习者背景与画像信号',
    category: 'goal',
    kind: 'skill',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'Goal',
    ioContractVersion: 'agent-output-v1',
    defaultModelConfig: { temperature: 0.3, maxTokens: 1200 }
  },
  {
    id: 'skill:goal-understanding-composer',
    name: '目标理解合成 Skill',
    description: '将对话与推断结果合成结构化 Goal Understanding',
    category: 'goal',
    kind: 'skill',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'Goal',
    ioContractVersion: 'agent-output-v1',
    defaultModelConfig: { temperature: 0.3, maxTokens: 2000 }
  },
  {
    id: 'skill:dialogue-concept-extractor',
    name: '对话概念抽取 Skill',
    description: '从目标对话中抽取关键概念实体',
    category: 'goal',
    kind: 'skill',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'Goal',
    ioContractVersion: 'agent-output-v1',
    defaultModelConfig: { temperature: 0.2, maxTokens: 1000 }
  },

  // ============ Path 下辖 Skills ============
  {
    id: 'skill:path-planning',
    name: '路径规划 Skill',
    description: '生成学习路径主结构',
    category: 'path',
    kind: 'skill',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'Path',
    ioContractVersion: 'agent-output-v1',
    defaultModelConfig: { temperature: 0.4, maxTokens: 32000 }
  },
  {
    id: 'skill:path-scene-framing',
    name: '路径场景定帧 Skill',
    description: '为路径阶段设计具体学习场景与情境',
    category: 'path',
    kind: 'skill',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'Path',
    ioContractVersion: 'agent-output-v1',
    defaultModelConfig: { temperature: 0.6, maxTokens: 2000 }
  },
  {
    id: 'skill:stage-designer',
    name: '阶段设计 Skill',
    description: '细化阶段内的任务与验收点',
    category: 'path',
    kind: 'skill',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'Path',
    ioContractVersion: 'agent-output-v1',
    defaultModelConfig: { temperature: 0.4, maxTokens: 4000 }
  },

  // ============ Teaching 下辖 Skills ============
  {
    id: 'skill:teaching-turn',
    name: '教学回合 Skill',
    description: '生成单轮教学回复与结构化教学状态',
    category: 'teaching',
    kind: 'skill',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'Teaching',
    aliases: ['teaching-turn-agent'],
    ioContractVersion: 'agent-output-v1',
    defaultModelConfig: { temperature: 0.5, maxTokens: 2200 }
  },
  {
    id: 'skill:peer-reinforcement',
    name: '伴学补强 Skill',
    description: '同伴式引导讨论与理解补强',
    category: 'teaching',
    kind: 'skill',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'Teaching',
    aliases: ['peer-agent'],
    ioContractVersion: 'agent-output-v1',
    defaultModelConfig: { temperature: 0.8, maxTokens: 1000 }
  },
  {
    id: 'skill:session-wrapup',
    name: '课后产出 Skill',
    description: '生成课后总结与评估',
    category: 'teaching',
    kind: 'skill',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'Teaching',
    aliases: ['session-wrapup-agent'],
    ioContractVersion: 'agent-output-v1',
    defaultModelConfig: { temperature: 0.2, maxTokens: 2200 }
  },
  {
    id: 'skill:teaching-strategy-selector',
    name: '教学策略选择 Skill',
    description: '基于学习者状态选择教学策略',
    category: 'teaching',
    kind: 'skill',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'Teaching',
    ioContractVersion: 'agent-output-v1',
    defaultModelConfig: { temperature: 0.3, maxTokens: 800 }
  },
  {
    id: 'skill:adaptive-guidance-copy',
    name: '自适应引导文案 Skill',
    description: '根据情境生成自适应引导话术',
    category: 'teaching',
    kind: 'skill',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'Teaching',
    ioContractVersion: 'agent-output-v1',
    defaultModelConfig: { temperature: 0.7, maxTokens: 800 }
  },
  {
    id: 'skill:acceptance-evidence-evaluator',
    name: '验收证据评估 Skill',
    description: '评估学习者输出是否满足验收点',
    category: 'teaching',
    kind: 'skill',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'Teaching',
    ioContractVersion: 'agent-output-v1',
    defaultModelConfig: { temperature: 0.2, maxTokens: 1200 }
  },

  // ============ Learner 下辖 Skills ============
  {
    id: 'skill:learner-model',
    name: '学习者模型 Skill',
    description: '聚合学习者画像、状态与知识记忆（handler-only，无 LLM prompt）',
    category: 'learner',
    kind: 'skill',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'Learner',
    aliases: ['learner-model-agent'],
    noPromptFile: true,
    ioContractVersion: 'agent-output-v1',
    defaultModelConfig: { temperature: 0.3, maxTokens: 1000 }
  },
  {
    id: 'skill:learning-pattern-distiller',
    name: '学习模式蒸馏 Skill',
    description: '从历史学习行为蒸馏稳定模式',
    category: 'learner',
    kind: 'skill',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'Learner',
    ioContractVersion: 'agent-output-v1',
    defaultModelConfig: { temperature: 0.3, maxTokens: 1500 }
  },
  {
    id: 'skill:session-knowledge-distiller',
    name: '会话知识蒸馏 Skill',
    description: '从单次教学会话蒸馏知识点掌握情况',
    category: 'learner',
    kind: 'skill',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'Learner',
    ioContractVersion: 'agent-output-v1',
    defaultModelConfig: { temperature: 0.3, maxTokens: 1500 }
  },
  {
    id: 'skill:label-generator',
    name: '画像标签生成 Skill',
    description: '生成学习者画像短标签',
    category: 'learner',
    kind: 'skill',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'Learner',
    ioContractVersion: 'agent-output-v1',
    defaultModelConfig: { temperature: 0.5, maxTokens: 600 }
  },

  // ============ Simulation 下辖 Skills ============
  {
    id: 'skill:virtual-learner-persona-designer',
    name: '虚拟学习者人格设计 Skill',
    description: '为虚拟学习者生成稳定人格设定',
    category: 'simulation',
    kind: 'skill',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'Simulation',
    ioContractVersion: 'agent-output-v1',
    defaultModelConfig: { temperature: 0.8, maxTokens: 1500 }
  },
  {
    id: 'skill:virtual-learner-scenario-designer',
    name: '虚拟学习者场景设计 Skill',
    description: '设计虚拟学习者的学习目标场景',
    category: 'simulation',
    kind: 'skill',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'Simulation',
    ioContractVersion: 'agent-output-v1',
    defaultModelConfig: { temperature: 0.7, maxTokens: 1500 }
  },
  {
    id: 'skill:virtual-learner-goal-dialogue-simulator',
    name: '虚拟学习者目标对话模拟 Skill',
    description: '模拟虚拟学习者在 Goal 阶段的回复',
    category: 'simulation',
    kind: 'skill',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'Simulation',
    ioContractVersion: 'agent-output-v1',
    defaultModelConfig: { temperature: 0.8, maxTokens: 1200 }
  },
  {
    id: 'skill:virtual-learner-path-evaluator',
    name: '虚拟学习者路径评估 Skill',
    description: '模拟虚拟学习者对 Path 的反馈与评估',
    category: 'simulation',
    kind: 'skill',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'Simulation',
    ioContractVersion: 'agent-output-v1',
    defaultModelConfig: { temperature: 0.6, maxTokens: 1500 }
  },
  {
    id: 'skill:virtual-learner-learn-turn-simulator',
    name: '虚拟学习者教学回合模拟 Skill',
    description: '模拟虚拟学习者在 Learn 阶段的单轮回复',
    category: 'simulation',
    kind: 'skill',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'Simulation',
    ioContractVersion: 'agent-output-v1',
    defaultModelConfig: { temperature: 0.8, maxTokens: 1200 }
  },
  {
    id: 'skill:virtual-learner-referee',
    name: '虚拟学习者实验裁判 Skill',
    description: '基于 Blackbox 公开轨迹、旁路诊断和控制回执生成独立实验裁判报告',
    category: 'simulation',
    kind: 'skill',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'Simulation',
    ioContractVersion: 'agent-output-v1',
    defaultModelConfig: { temperature: 0.2, maxTokens: 2400 }
  },
  // ============ Tool Skills（工具类，无 LLM prompt） ============
  {
    id: 'skill:text-structure-analyzer',
    name: '文本结构分析器 Skill',
    description: '分析文本结构，提取大纲、章节、关键词等',
    category: 'tool',
    kind: 'skill',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'Tool',
    noPromptFile: true
  },
  {
    id: 'skill:retrieval',
    name: '内容检索器 Skill',
    description: '从提供的资料中检索相关内容',
    category: 'tool',
    kind: 'skill',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'Tool',
    noPromptFile: true
  },
  {
    id: 'skill:web-extractor',
    name: '网页内容提取器 Skill',
    description: '从网页URL提取结构化学习内容，包括标题、大纲、代码块、表格等',
    category: 'tool',
    kind: 'skill',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'Tool',
    noPromptFile: true
  },
  {
    id: 'skill:image-analyzer',
    name: '图片分析器 Skill',
    description: '分析图片内容，支持代码截图识别、报错分析、架构图解析、OCR文字提取等',
    category: 'tool',
    kind: 'skill',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'Tool',
    noPromptFile: true
  },
  {
    id: 'skill:memory-search',
    name: '学习记忆搜索器 Skill',
    description: '检索用户学习历史、对话记录、成就、进度等记忆数据，支持智能分析和洞察生成',
    category: 'tool',
    kind: 'skill',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'Tool',
    noPromptFile: true
  },
  {
    id: 'skill:smart-search',
    name: '智能搜索器 Skill',
    description: '智能搜索技能，支持语义搜索、关键词匹配、多源聚合和智能排序',
    category: 'tool',
    kind: 'skill',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'Tool',
    noPromptFile: true
  },
  {
    id: 'skill:structured-output-parser',
    name: '结构化输出解析器 Skill',
    description: '从 LLM 原始响应中提取 JSON 对象，处理 markdown 代码块、裸 JSON、多段落等场景',
    category: 'tool',
    kind: 'skill',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'Tool',
    noPromptFile: true
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
  // 1) 命中 alias
  const fromAlias = aliasToCanonical.get(agentId);
  if (fromAlias) return fromAlias;
  // 2) 已是 manifest id（带前缀如 skill:xxx / agent:xxx）
  if (manifestMap.has(agentId)) return agentId;
  // 3) 短 id 自动补 skill: / agent: 前缀
  if (!agentId.includes(':')) {
    if (manifestMap.has(`skill:${agentId}`)) return `skill:${agentId}`;
    if (manifestMap.has(`agent:${agentId}`)) return `agent:${agentId}`;
  }
  return agentId;
}

export function isManifestAgent(agentId: string): boolean {
  const entry = getAgentManifest(agentId);
  return entry?.kind === 'agent';
}

export function isManifestSkill(agentId: string): boolean {
  const entry = getAgentManifest(agentId);
  return entry?.kind === 'skill';
}

/**
 * 列出顶层 Agent（kind=agent），用于 Agent 拓扑视图
 */
export function listTopLevelAgents(): AgentManifestEntry[] {
  return AGENT_MANIFEST.filter(item => item.kind === 'agent').map(item => ({ ...item }));
}

/**
 * 列出某 Agent 下辖的 Skill 详情
 */
export function listSkillsOfAgent(agentId: string): AgentManifestEntry[] {
  const canonical = getCanonicalAgentId(agentId);
  const agent = manifestMap.get(canonical);
  if (!agent || agent.kind !== 'agent' || !agent.agentMembers) return [];
  return agent.agentMembers
    .map(memberId => manifestMap.get(getCanonicalAgentId(memberId)))
    .filter((x): x is AgentManifestEntry => !!x);
}

/**
 * 反向查询：某 Skill 隶属于哪个 Agent
 */
export function getAgentOfSkill(skillId: string): AgentManifestEntry | undefined {
  const canonical = getCanonicalAgentId(skillId);
  for (const item of AGENT_MANIFEST) {
    if (item.kind !== 'agent' || !item.agentMembers) continue;
    if (item.agentMembers.some(m => getCanonicalAgentId(m) === canonical)) {
      return { ...item };
    }
  }
  return undefined;
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

export function getAgentRelations() {
  return AGENT_MANIFEST
    .filter(item => item.kind === 'agent' && item.agentMembers)
    .map(item => ({
      agentId: item.id,
      group: item.monitoringGroup,
      members: item.agentMembers || [item.id]
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

/**
 * 启动校验：违反则抛错（fatal）
 *
 * 规则：
 *   - kind=agent 不允许有 defaultModelConfig
 *   - kind=agent 必须有非空 agentMembers
 *   - kind=skill id 必须以 'skill:' 开头
 *   - kind=skill 必须有 defaultModelConfig（否则无法运行）
 *   - kind=skill 引用的 Agent.agentMembers 必须能在 manifest 中找到
 *   - alias 不能与 canonical id 冲突
 */
export function validateManifest(): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const ids = new Set(AGENT_MANIFEST.map(item => item.id));

  for (const item of AGENT_MANIFEST) {
    if (item.kind === 'agent') {
      if (item.defaultModelConfig) {
        errors.push(`[manifest] Agent "${item.id}" 不应有 defaultModelConfig（Agent 是编排器，无 prompt 无 LLM 调用）`);
      }
      if (!item.agentMembers || item.agentMembers.length === 0) {
        errors.push(`[manifest] Agent "${item.id}" 必须有非空 agentMembers`);
      } else {
        for (const memberId of item.agentMembers) {
          const canonical = aliasToCanonical.get(memberId) || memberId;
          if (!ids.has(canonical)) {
            errors.push(`[manifest] Agent "${item.id}" 引用的成员 "${memberId}" 在 manifest 中找不到`);
          }
        }
      }
    } else if (item.kind === 'skill') {
      if (!item.id.startsWith('skill:')) {
        errors.push(`[manifest] Skill "${item.id}" 必须以 "skill:" 开头`);
      }
      if (!item.defaultModelConfig && !item.noPromptFile) {
        errors.push(`[manifest] Skill "${item.id}" 必须有 defaultModelConfig（除非 noPromptFile=true）`);
      }
    }

    for (const alias of item.aliases || []) {
      if (ids.has(alias)) {
        errors.push(`[manifest] alias "${alias}" 与 canonical id 冲突`);
      }
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
