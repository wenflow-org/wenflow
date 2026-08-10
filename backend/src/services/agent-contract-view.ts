/**
 * AgentContractView：沙盘契约视图（P-A）
 *
 * 给定 agent，输出其"沙盘结构"——该 agent 的输入通道与输出字段，
 * 供写 Prompt 的人查阅（自文档化）与 sandbox: ref 对账（路径注册表）。
 *
 * 数据源：
 * - routings 表（field-dispatcher 缓存）：字段归属 + handoff + pathInRawOutput
 * - core fields（skill-output-validator 缓存）：字段类型
 *
 * 沙盘路径注册表：sandbox: 前缀 ref 的合法路径集合。
 * 命名规范：sandbox:<agentId>.<key>，key 对齐该 agent 的登记通道/状态池。
 */

import { getAgentRoutings, type FieldRoutingRow } from './field-dispatcher';
import { listTopLevelAgents } from './agent-manifest.service';
import { loadCoreFieldDeclarations } from './skill-output-validator';

export interface SandboxChannel {
  /** 沙盘路径：sandbox:<agentId>.<key> */
  path: string;
  key: string;
  fieldId: string;
  type: string;
  source: 'routing-channel' | 'routing-output';
  pathInRawOutput?: string | null;
  description?: string;
}

export interface AgentSandboxView {
  agentId: string;
  agentName: string;
  /** 该 agent 的输入通道（编排注入/交付给其 skill 的字段） */
  inputChannels: SandboxChannel[];
  /** 该 agent 名下的输出字段（含其 skill 名下的产出行） */
  outputFields: Array<{ fieldId: string; type: string; handoff: string[] }>;
}

const TOP_LEVEL_AGENT_IDS = ['goal-agent', 'path-agent', 'teaching-agent', 'profile-agent', 'simulation-agent'] as const;

/** sandbox ref 的 agent 标识：简名 → canonical agentId（写 Prompt 友好 + 规范一致） */
const SANDBOX_AGENT_ALIASES: Record<string, string> = {
  goal: 'goal-agent',
  path: 'path-agent',
  teaching: 'teaching-agent',
  profile: 'profile-agent',
  simulation: 'simulation-agent',
};

/**
 * 静态补充沙盘键：编排状态池中未登记 routings 行的合法键
 * （collectedData / teachingState / snapshot 等由 agent 编排代码维护的状态）。
 * 键以 `<agentId>.<key>` 表达，与 routings 推导键同一命名空间。
 */
export const SANDBOX_EXTRA_KEYS: Record<string, string[]> = {
  'goal-agent': [
    'collectedData.state',
    'collectedData.history',
    'collectedData.latestMessage',
    'collectedData.understanding',
    'collectedData.confirmedProposal',
  ],
  'path-agent': [
    'normalizedInput',
    'normalizedInput.problemSpace.realProblem',
    'normalizedInput.learnerProfile.surfaceGoal',
    'normalizedInput.confirmedProposal',
    'previousMilestone',
    'milestones',
    'cognitiveCore',
    'planningHints',
    'replan',
  ],
  'teaching-agent': [
    'session.messages',
    'session.knowledgeState',
    'session.mode',
    'session.topic',
    'session.info',
    'session.evidence',
    'session.wrapup',
    'learningState',
    'scenario',
    'scenario.interactionProfile',
    'teachingState.classroomContext',
    'teachingState.teachingControlContext',
    'teachingState.classroomEventHistory',
    'learner.learnerProjection',
    'knowledge.state',
    'controls.teachingControlContext',
    'classroomContext',
    'visibleDialogueContext',
  ],
  'profile-agent': [
    'snapshot.dynamicState',
    'snapshot.learningControlState',
    'snapshot.replanSignal',
    'snapshot.teachingHints',
    'snapshot.knowledgeMemory.currentPath',
    'snapshot.knowledgeMemory.globalSignals',
    'profile.narrativeInsights',
    'profile.curriculumControls',
  ],
  'simulation-agent': [
    'learner',
    'story',
    'visibleContext',
    'currentPhase',
    'previousLearnerState',
    'task',
    'pathProposal',
    'goalState',
    'previousReaction',
    'learnerState',
    'currentTask',
    'knowledgeSnapshot',
    'publicTrace',
    'refereeTrace',
    'control',
    'experimentSummary',
    'storyMeta',
    'metricCompleteness',
    'actorProfile',
    'frictionBudget',
    'learnerPrivateState',
    'preferredLevels',
    'candidatePersonas',
    'recentPersonaHints',
    'existingPersonaSeed',
    'preferredDomains',
    'preferredGoalTypes',
    'preferredMotivations',
    'avoidDomains',
    'candidateDomains',
    'recentScenarioHints',
  ],
};

/**
 * 沙盘路径注册表：该 agent 下所有合法 sandbox 键。
 * 键来源：
 * 1) routings 行中 handoff 指向其成员 skill 的字段（输入通道）；
 * 2) 该 agent 名下的全部输出字段（交付声明）。
 */
export async function buildAgentSandboxView(agentId: string): Promise<AgentSandboxView> {
  const agents = listTopLevelAgents();
  const agent = agents.find((item) => item.id === agentId);
  const agentName = agent?.name || agentId;
  const memberSkills = agent?.agentMembers || [];

  const routings = await getAgentRoutings(agentId);
  const skillRoutings = (await Promise.all(
    memberSkills.map((skillId) => getAgentRoutings(skillId).catch(() => []))
  )).flat() as FieldRoutingRow[];

  // 输入通道：agent 名下 handoff 指向成员 skill 的行（编排注入）+ 成员 skill 名下 handoff 含本 agent 的行（交付）
  const inputRows = [
    ...routings.filter((row) => row.handoff.some((target) => memberSkills.includes(target))),
    ...skillRoutings.filter((row) => row.handoff.includes(agentId)),
  ];
  const seenInputs = new Set<string>();
  const inputChannels: SandboxChannel[] = [];
  for (const row of inputRows) {
    if (seenInputs.has(row.fieldId)) continue;
    seenInputs.add(row.fieldId);
    const fieldType = await resolveFieldType(row);
    inputChannels.push({
      path: `sandbox:${agentId}.${row.fieldId}`,
      key: row.fieldId,
      fieldId: row.fieldId,
      type: fieldType,
      source: row.agentId === agentId ? 'routing-channel' : 'routing-output',
      pathInRawOutput: row.pathInRawOutput,
      description: row.notes || undefined,
    });
  }

  // 输出字段：agent 名下 + 成员 skill 名下的全部行
  const outputRows = [...routings, ...skillRoutings];
  const seenOutputs = new Set<string>();
  const outputFields: AgentSandboxView['outputFields'] = [];
  for (const row of outputRows) {
    if (seenOutputs.has(row.fieldId)) continue;
    seenOutputs.add(row.fieldId);
    outputFields.push({
      fieldId: row.fieldId,
      type: await resolveFieldType(row),
      handoff: row.handoff,
    });
  }

  return { agentId, agentName, inputChannels, outputFields };
}

async function resolveFieldType(row: FieldRoutingRow): Promise<string> {
  try {
    const fieldId = row.fieldId;
    const root = fieldId.split('.')[0];
    const core = await loadCoreFieldDeclarations(root);
    if (core) {
      const declared = core.find((f) => f.name === fieldId || fieldId.startsWith(`${f.name}.`));
      if (declared) return declared.type;
    }
  } catch {
    // 忽略，回退 valueType
  }
  return row.valueType || 'unknown';
}

/**
 * 全 agent 沙盘视图（说明书生成与注册表查询共用）
 */
export async function buildAllAgentSandboxViews(): Promise<AgentSandboxView[]> {
  const views: AgentSandboxView[] = [];
  for (const agentId of TOP_LEVEL_AGENT_IDS) {
    views.push(await buildAgentSandboxView(agentId));
  }
  return views;
}

/**
 * sandbox: ref 对账：检查沙盘路径是否注册。
 * 返回 null = 已注册；否则返回缺路径描述。
 */
export async function validateSandboxPath(refPath: string): Promise<string | null> {
  // refPath 形如 goal.collectedData.state（不含 sandbox: 前缀）；agent 标识支持简名与 canonical
  const [rawAgentId, ...rest] = refPath.split('.');
  if (!rawAgentId) {
    return `sandbox 路径 ${refPath} 缺少 agent 标识`;
  }
  const agentId = SANDBOX_AGENT_ALIASES[rawAgentId] || rawAgentId;
  if (!TOP_LEVEL_AGENT_IDS.includes(agentId as any)) {
    return `sandbox 路径 ${refPath} 的 agent 不在顶层 5 agent 中`;
  }
  const key = rest.join('.');
  if (!key) {
    return `sandbox 路径 ${refPath} 缺少沙盘键`;
  }
  const view = await buildAgentSandboxView(agentId);
  const channel = view.inputChannels.find((c) => c.key === key);
  const output = view.outputFields.find((f) => f.fieldId === key);
  const extra = (SANDBOX_EXTRA_KEYS[agentId] || []).includes(key);
  if (channel || output || extra) return null;
  return `sandbox 路径 ${refPath} 未注册（合法键见 prompts/agent-snapshots.md）`;
}

/** 导出顶层 agent id 列表（供对账/文档） */
export const SANDBOX_AGENT_IDS = TOP_LEVEL_AGENT_IDS;
