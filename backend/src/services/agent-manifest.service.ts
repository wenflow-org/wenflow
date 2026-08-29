/**
 * Agent Manifest - 真理源
 *
 * 架构：
 *   - 5 个顶层 Agent（kind=agent）：goal / path / teaching / learner / simulation
 *     - Agent 是"编排器"，不持有 system prompt，不直接调用 LLM
 *     - Agent 下辖一组 Skill（agentMembers，由 prompts/skills.yaml parentAgent 派生，P1）
 *   - N 个 Skill（kind=skill）：实际持有 prompt、调用 LLM 的执行单元
 *
 * 铁律（由 validateManifest 启动时强制）：
 *   - kind=agent: 不允许有 defaultModelConfig，agentMembers 必须非空
 *   - kind=skill: id 必须以 'skill:' 开头
 *   - alias: 仅用于旧 id 向新 id 的兼容映射
 *
 * agentMembers 派生（SKILLS_YAML_SPEC §2.3①）：
 *   - 数据源 = prompts/skills.yaml 条目 parentAgent 字段（唯一来源），本模块惰性加载
 *     （首次调用 getAgentMembersOfAgent 时 require skills-file，避免模块顶部静态 import
 *     造成循环依赖与启动顺序问题）。
 *   - 过渡回滚：SKILLS_FILE_DISABLED=1 时回退 LEGACY_AGENT_MEMBERS（旧手写值，见 §5.3）。
 */

export type AgentRuntimeKind = 'agent' | 'skill' | 'alias';

export type MonitoringGroupName =
  | 'Goal'
  | 'Path'
  | 'Teaching'
  | 'Profile'
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
    // Phase 3：裸名 goal-conversation 归 skill，不再作为 goal-agent 别名（避免与 skill 冲突）
    aliases: ['requirement-agent']
    // agentMembers 由 prompts/skills.yaml parentAgent 派生（P1，见 getAgentMembersOfAgent）
  },
  {
    id: 'path-agent',
    name: '路径 Agent',
    description: '规划学习路径与阶段拆分',
    category: 'agent',
    kind: 'agent',
    runtimeEnabled: true,
    userVisible: true,
    monitoringGroup: 'Path'
    // agentMembers 由 prompts/skills.yaml parentAgent 派生（P1）
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
    aliases: ['ai-teaching-agent', 'ai-teaching']
    // agentMembers 由 prompts/skills.yaml parentAgent 派生（P1）
  },
  {
    id: 'profile-agent',
    name: '学习者 Agent',
    description: '编排学习者画像、状态聚合、知识沉淀与 snapshot/projection 刷新',
    category: 'agent',
    kind: 'agent',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'Profile'
    // agentMembers 由 prompts/skills.yaml parentAgent 派生（P1）
  },
  {
    id: 'simulation-agent',
    name: '虚拟学习者 Agent',
    description: '编排虚拟学习者：正式黑盒按故事→Goal→Path 结果→Learn 运行；路径评估器仅用于辅助调试',
    category: 'agent',
    kind: 'agent',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'Simulation'
    // agentMembers 由 prompts/skills.yaml parentAgent 派生（P1）
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
    aliases: ['goal-conversation-agent', 'goal-conversation'],
    ioContractVersion: 'agent-output-v1',
    // 与 prompts/skill.goal-conversation.md 及 handler codeDefaults 对齐（仅展示/兜底，权威在 ACTIVE prompt）
    defaultModelConfig: { temperature: 0.7, maxTokens: 8000 }
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
    defaultModelConfig: { temperature: 0.2, maxTokens: 32000 }
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
    defaultModelConfig: { temperature: 0.3, maxTokens: 32000 }
  },

  // ============ Learning 下辖 Skills ============
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
    defaultModelConfig: { temperature: 0.7, maxTokens: 4000 }
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
    defaultModelConfig: { temperature: 0.7, maxTokens: 4000 }
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
    defaultModelConfig: { temperature: 0.7, maxTokens: 4000 }
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

  // ============ Profile 下辖 Skills ============
  {
    id: 'skill:learner-model',
    name: '学习者模型 Skill',
    description: '聚合学习者画像、状态与知识记忆（handler-only，无 LLM prompt）',
    category: 'profile',
    kind: 'skill',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'Profile',
    aliases: ['learner-model-agent'],
    noPromptFile: true,
    ioContractVersion: 'agent-output-v1',
    defaultModelConfig: { temperature: 0.3, maxTokens: 1000 }
  },
  {
    id: 'skill:lesson-knowledge-enricher',
    name: '课后知识增强 Skill',
    description: '课后单次调用：蒸馏知识台账增量并抽取隐性概念线索',
    category: 'profile',
    kind: 'skill',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'Profile',
    ioContractVersion: 'agent-output-v1',
    defaultModelConfig: { temperature: 0.4, maxTokens: 4000 }
  },
  {
    id: 'skill:learning-predictor',
    name: '学习表现预测 Skill',
    description: '任务开始前预测卡壳风险与建议深度，校准闭环验证',
    category: 'profile',
    kind: 'skill',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'Profile',
    ioContractVersion: 'agent-output-v1',
    defaultModelConfig: { temperature: 0.2, maxTokens: 1200 }
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
    defaultModelConfig: { temperature: 0.8, maxTokens: 8000 }
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
    defaultModelConfig: { temperature: 0.9, maxTokens: 8000 }
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
    defaultModelConfig: { temperature: 0.8, maxTokens: 8000 }
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
    defaultModelConfig: { temperature: 0.8, maxTokens: 8000 }
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
    defaultModelConfig: { temperature: 0.8, maxTokens: 8000 }
  },
  {
    id: 'skill:virtual-learner-referee',
    name: '平台体验裁判 Skill',
    description: '基于 Blackbox 公开轨迹、旁路诊断和控制回执生成独立实验裁判报告',
    category: 'simulation',
    kind: 'skill',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'Simulation',
    ioContractVersion: 'agent-output-v1',
    defaultModelConfig: { temperature: 0.2, maxTokens: 2400 }
  },
  {
    id: 'skill:virtual-learner-memory-curator',
    name: '虚拟学习者课后记忆提炼 Skill',
    description: '以虚拟学习者本人视角，从课堂回合中提炼"自己觉得学会了什么、卡在哪"，产出可沉淀的记忆增量',
    category: 'simulation',
    kind: 'skill',
    runtimeEnabled: true,
    userVisible: false,
    monitoringGroup: 'Simulation',
    ioContractVersion: 'agent-output-v1',
    defaultModelConfig: { temperature: 0.3, maxTokens: 2400 }
  },
  {
    id: 'skill:virtual-learner-actor-auditor',
    name: '角色保真审计 Skill',
    description: '基于画像、故事、摩擦预算、私有状态和公开行为评估合成学习者可信度',
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
    id: 'skill:mcp-tool',
    name: 'MCP 工具调用 Skill',
    description: '通过统一 Capability Runtime 调用用户或平台配置的 MCP 工具',
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

// ============================================================
// agentMembers 派生（P1，SKILLS_YAML_SPEC §2.3①）
// ============================================================

/**
 * 旧手写 agentMembers 过渡镜像（deprecated）：
 * - 用途 1：SKILLS_FILE_DISABLED=1 过渡回滚点（规格 §5.3，仅限一版发布窗口）；
 * - 用途 2：P1 验收"派生结果与手写逐项相等"的 diff 基准（check-skills-file.ts / 单测断言）。
 * 正常路径不读取本表；agentMembers 唯一来源 = prompts/skills.yaml parentAgent。
 */
export const LEGACY_AGENT_MEMBERS: Record<string, string[]> = {
  'goal-agent': ['skill:goal-conversation'],
  'path-agent': ['skill:path-planning', 'skill:stage-designer'],
  'teaching-agent': ['skill:teaching-turn', 'skill:peer-reinforcement', 'skill:session-wrapup', 'skill:adaptive-guidance-copy'],
  'profile-agent': ['skill:learner-model', 'skill:lesson-knowledge-enricher'],
  'simulation-agent': [
    'skill:virtual-learner-persona-designer',
    'skill:virtual-learner-scenario-designer',
    'skill:virtual-learner-goal-dialogue-simulator',
    'skill:virtual-learner-path-evaluator',
    'skill:virtual-learner-learn-turn-simulator',
    'skill:virtual-learner-referee',
    'skill:virtual-learner-memory-curator',
    'skill:virtual-learner-actor-auditor'
  ]
};

let derivedParentAgentMembers: Map<string, string[]> | null = null;

/**
 * 读取某顶层 Agent 下辖的成员 skill id 列表（含 skill: 前缀，顺序 = skills.yaml 文件顺序）。
 * 惰性加载：首次调用时 require skills-file（绝不在模块顶部静态 import，避免循环依赖），
 * 结果进程级缓存。SKILLS_FILE_DISABLED=1 时回退 LEGACY_AGENT_MEMBERS。
 */
export function getAgentMembersOfAgent(agentId: string): string[] {
  if (process.env.SKILLS_FILE_DISABLED === '1') {
    return [...(LEGACY_AGENT_MEMBERS[agentId] || [])];
  }
  if (!derivedParentAgentMembers) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const skillsFile = require('./skill-registry/skills-file');
    const book = skillsFile.loadSkillsBookRaw();
    const map = new Map<string, string[]>();
    for (const entry of book.skills) {
      if (!entry.parentAgent) continue;
      const members = map.get(entry.parentAgent) || [];
      members.push(`skill:${entry.skillId}`);
      map.set(entry.parentAgent, members);
    }
    derivedParentAgentMembers = map;
  }
  return [...(derivedParentAgentMembers.get(agentId) || [])];
}

/** 返回带派生 agentMembers 的条目副本（对外 API 形状不变，内容与手写时代一致） */
function withDerivedMembers(entry: AgentManifestEntry): AgentManifestEntry {
  const copy = { ...entry };
  if (copy.kind === 'agent') {
    copy.agentMembers = getAgentMembersOfAgent(copy.id);
  }
  return copy;
}

/**
 * 原始条目（不附加派生 agentMembers），供 skills-file 校验器（F12）与脚本对账使用。
 * 注意：不要在此处调用任何会触发 agentMembers 派生的函数（否则与 loadSkillsFile 互为递归）。
 */
export function listRawManifestEntries(): AgentManifestEntry[] {
  return AGENT_MANIFEST.map(item => ({ ...item }));
}

export function listAgentManifest(): AgentManifestEntry[] {
  return AGENT_MANIFEST.map(withDerivedMembers);
}

export function getAgentManifest(agentId: string): AgentManifestEntry | undefined {
  const canonical = getCanonicalAgentId(agentId);
  const entry = manifestMap.get(canonical);
  return entry ? withDerivedMembers(entry) : undefined;
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
  return AGENT_MANIFEST.filter(item => item.kind === 'agent').map(withDerivedMembers);
}

/**
 * 列出某 Agent 下辖的 Skill 详情
 */
export function listSkillsOfAgent(agentId: string): AgentManifestEntry[] {
  const canonical = getCanonicalAgentId(agentId);
  const agent = manifestMap.get(canonical);
  if (!agent || agent.kind !== 'agent') return [];
  return getAgentMembersOfAgent(canonical)
    .map(memberId => manifestMap.get(getCanonicalAgentId(memberId)))
    .filter((x): x is AgentManifestEntry => !!x);
}

/**
 * 反向查询：某 Skill 隶属于哪个 Agent
 */
export function getAgentOfSkill(skillId: string): AgentManifestEntry | undefined {
  const canonical = getCanonicalAgentId(skillId);
  for (const item of AGENT_MANIFEST) {
    if (item.kind !== 'agent') continue;
    if (getAgentMembersOfAgent(item.id).some(m => getCanonicalAgentId(m) === canonical)) {
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
    .filter(item => item.kind === 'agent')
    .filter(item => getAgentMembersOfAgent(item.id).length > 0)
    .map(item => ({
      agentId: item.id,
      group: item.monitoringGroup,
      members: getAgentMembersOfAgent(item.id)
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
 *   - kind=agent 必须有非空 agentMembers（派生自 skills.yaml parentAgent）
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
      const members = getAgentMembersOfAgent(item.id);
      if (members.length === 0) {
        errors.push(`[manifest] Agent "${item.id}" 必须有非空 agentMembers（派生自 skills.yaml parentAgent）`);
      } else {
        for (const memberId of members) {
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
