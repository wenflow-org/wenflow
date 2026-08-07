/**
 * Goal 阶段字段路由 seed（skill 粒度）
 *
 * 契约列表（按产生字段的顺序）：
 *   - skill:goal-conversation：与用户对话，收集目标与背景
 *   - goal-agent：桥接聚合，把字段 handoff 到 path 阶段
 *
 * 字段命名 = prompt `## 输出规格` 声明（camelCase）
 * 路由规则：
 *   - hard-required / soft-info → 默认 visible，handoff 到 goal-agent
 *   - hidden-inference → 默认 hidden，handoff 到 goal-agent
 *   - public-reply → visible，不 handoff（仅在当前 agent 内用）
 *   - control-signal → visible，不 handoff（内部信令）
 *   - accumulate 标记 → 需累积到学习者画像
 */

import { randomUUID } from 'crypto';
import type { PrismaClient } from '../generated/system-client';

type PromptRole =
  | 'hard-required' | 'soft-info' | 'hidden-inference'
  | 'public-reply' | 'proposal-output' | 'derived-presentation' | 'control-signal';

type RenderValue = 'visible' | 'hidden';

interface SeedField {
  fieldId: string;
  promptRole: PromptRole;
  valueType: string;
  snakeName?: string;
  camelName?: string;
  pathInRawOutput?: string;
  description: string;
  enumValues?: string[];
  notes?: string;
  systemLocked?: boolean;
  structureLocked?: boolean;
  bindings?: Record<string, unknown>;
}

interface SeedContract {
  agentId: string;
  displayName: string;
  description: string;
}

interface SeedRouting {
  agentId: string;
  fieldId: string;
  render: RenderValue;
  handoff: string[];
  internal: boolean;
  accumulate: boolean;
  visibilityPreset?: string;
  notes?: string;
}

const STAGE = 'goal';

export const GOAL_FIELD_ROUTING_CONTRACTS: SeedContract[] = [
  {
    agentId: 'skill:goal-conversation',
    displayName: '目标对话 Skill',
    description: '与用户多轮对话，收集学习目标与上下文信号',
  },
  {
    agentId: 'goal-agent',
    displayName: '目标 Agent',
    description: 'Goal 阶段汇总编排，将字段 handoff 到 Path 阶段',
  },
];

// 字段定义 = prompt 输出规格 + 人工补充的桥接字段
export const GOAL_FIELD_ROUTING_FIELDS: SeedField[] = [
  // === skill:goal-conversation 产出 ===
  // hard-required
  { fieldId: 'understanding.surface_goal', pathInRawOutput: 'internal.ext.goalConversation.understanding.surface_goal', promptRole: 'hard-required', valueType: 'string', description: '用户最初表述的"想学什么"原话', systemLocked: true, snakeName: 'surface_goal', camelName: 'surfaceGoal' },
  { fieldId: 'understanding.real_problem', pathInRawOutput: 'internal.ext.goalConversation.understanding.real_problem', promptRole: 'hard-required', valueType: 'string', description: '深层真实问题（回溯后收敛）', systemLocked: true },
  { fieldId: 'understanding.available_resources.time_budget', pathInRawOutput: 'internal.ext.goalConversation.understanding.available_resources.time_budget', promptRole: 'hard-required', valueType: 'string', description: '时间预算（几周/几月）', systemLocked: true },
  { fieldId: 'understanding.available_resources.time_horizon', pathInRawOutput: 'internal.ext.goalConversation.understanding.available_resources.time_horizon', promptRole: 'soft-info', valueType: 'string', description: '时间视角（紧迫 vs 从容）' },
  { fieldId: 'understanding.success_criteria.observable_result', pathInRawOutput: 'internal.ext.goalConversation.understanding.success_criteria.observable_result', promptRole: 'hard-required', valueType: 'string', description: '学习成功的可观察结果', systemLocked: true },

  // soft-info
  { fieldId: 'understanding.current_baseline.level', pathInRawOutput: 'internal.ext.goalConversation.understanding.current_baseline.level', promptRole: 'soft-info', valueType: 'string', description: '当前水平评估' },
  { fieldId: 'understanding.current_baseline.evidence', pathInRawOutput: 'internal.ext.goalConversation.understanding.current_baseline.evidence', promptRole: 'soft-info', valueType: 'string', description: '当前水平的证据' },
  { fieldId: 'understanding.success_criteria.acceptance_check', pathInRawOutput: 'internal.ext.goalConversation.understanding.success_criteria.acceptance_check', promptRole: 'soft-info', valueType: 'string', description: '验收检查方法' },
  { fieldId: 'understanding.available_resources.time_per_session', pathInRawOutput: 'internal.ext.goalConversation.understanding.available_resources.time_per_session', promptRole: 'soft-info', valueType: 'string', description: '每次学习时长' },
  { fieldId: 'understanding.constraints_and_boundaries', pathInRawOutput: 'internal.ext.goalConversation.understanding.constraints_and_boundaries', promptRole: 'soft-info', valueType: 'string', description: '约束与边界', bindings: { accumulate: true } },
  { fieldId: 'understanding.pain_points', pathInRawOutput: 'internal.ext.goalConversation.understanding.pain_points', promptRole: 'soft-info', valueType: 'string', description: '当前痛点' },
  { fieldId: 'understanding.motivation', pathInRawOutput: 'internal.ext.goalConversation.understanding.motivation', promptRole: 'soft-info', valueType: 'string', description: '学习动机' },
  { fieldId: 'understanding.urgency', pathInRawOutput: 'internal.ext.goalConversation.understanding.urgency', promptRole: 'soft-info', valueType: 'string', description: '紧急程度' },
  { fieldId: 'understanding.scenario', pathInRawOutput: 'internal.ext.goalConversation.understanding.scenario', promptRole: 'soft-info', valueType: 'string', description: '学习场景' },
  { fieldId: 'understanding.deadline_text', pathInRawOutput: 'internal.ext.goalConversation.understanding.deadline_text', promptRole: 'soft-info', valueType: 'string', description: '截止日期文本' },

  // hidden-inference
  { fieldId: 'understanding.background_experience', pathInRawOutput: 'internal.ext.goalConversation.understanding.background_experience', promptRole: 'hidden-inference', valueType: 'string', description: '背景经验推断（prompt 明确不展示给前端）' },
  { fieldId: 'understanding.learning_signal', pathInRawOutput: 'internal.ext.goalConversation.understanding.learning_signal', promptRole: 'hidden-inference', valueType: 'string', description: '学习信号（隐式推断）' },

  // proposal-output
  { fieldId: 'confirmedProposal.learning_direction', pathInRawOutput: 'internal.ext.goalConversation.confirmedProposal.learning_direction', promptRole: 'proposal-output', valueType: 'string', description: '确认的学习方向' },
  { fieldId: 'confirmedProposal.first_deliverable', pathInRawOutput: 'internal.ext.goalConversation.confirmedProposal.first_deliverable', promptRole: 'proposal-output', valueType: 'string', description: '第一个交付物' },
  { fieldId: 'confirmedProposal.key_stages', pathInRawOutput: 'internal.ext.goalConversation.confirmedProposal.key_stages', promptRole: 'proposal-output', valueType: 'string', description: '关键阶段' },
  { fieldId: 'confirmedProposal.out_of_scope', pathInRawOutput: 'internal.ext.goalConversation.confirmedProposal.out_of_scope', promptRole: 'proposal-output', valueType: 'string', description: '不在此次学习的范围' },

  // public-reply（对话 UI 相关）
  { fieldId: 'userVisible', pathInRawOutput: 'userVisible', promptRole: 'public-reply', valueType: 'string', description: '给用户看的内容（适合 LLM 聊天 UI）' },
  { fieldId: 'goalConversation.nextQuestions', pathInRawOutput: 'internal.ext.goalConversation.nextQuestions', promptRole: 'public-reply', valueType: 'array<string>', description: '下一轮建议问题' },
  { fieldId: 'goalConversation.quickReplies', pathInRawOutput: 'internal.ext.goalConversation.quickReplies', promptRole: 'public-reply', valueType: 'array<string>', description: '快捷回复选项' },

  // control-signal
  { fieldId: 'core.conversationId', pathInRawOutput: 'internal.core.conversationId', promptRole: 'control-signal', valueType: 'string', description: '对话 ID' },
  { fieldId: 'core.stage', pathInRawOutput: 'internal.core.stage', promptRole: 'control-signal', valueType: 'string', description: '对话阶段' },
  { fieldId: 'core.confidence', pathInRawOutput: 'internal.core.confidence', promptRole: 'control-signal', valueType: 'number', description: '收敛置信度', notes: 'internal — 仅作 UI 进度条' },
  { fieldId: 'core.isCompleted', pathInRawOutput: 'internal.core.isCompleted', promptRole: 'control-signal', valueType: 'boolean', description: '对话是否完成' },
];

// 路由：每个字段的 agent→handoff 映射
export const GOAL_FIELD_ROUTINGS: SeedRouting[] = [
  // === skill:goal-conversation 产出的字段 ===
  // hard-required: visible, handoff to goal-agent
  ...['understanding.surface_goal', 'understanding.real_problem',
     'understanding.available_resources.time_budget',
     'understanding.success_criteria.observable_result'].map(fieldId => ({
    agentId: 'skill:goal-conversation' as const, fieldId,
    render: 'visible' as RenderValue, handoff: ['goal-agent'],
    internal: false, accumulate: ['understanding.surface_goal', 'understanding.real_problem'].includes(fieldId),
    visibilityPreset: 'user-clarification' as const
  })),
  // soft-info: visible or hidden based on sensitivity
  ...['understanding.available_resources.time_horizon',
     'understanding.current_baseline.level', 'understanding.current_baseline.evidence',
     'understanding.success_criteria.acceptance_check',
     'understanding.available_resources.time_per_session',
     'understanding.constraints_and_boundaries', 'understanding.pain_points',
     'understanding.motivation', 'understanding.urgency', 'understanding.scenario',
     'understanding.deadline_text'].map(fieldId => ({
    agentId: 'skill:goal-conversation' as const, fieldId,
    render: 'visible' as RenderValue, handoff: ['goal-agent'],
    internal: false,
    accumulate: ['understanding.constraints_and_boundaries', 'understanding.pain_points',
                 'understanding.motivation', 'understanding.current_baseline.level',
                 'understanding.current_baseline.evidence'].includes(fieldId),
  })),
  // hidden-inference: hidden, handoff to goal-agent, accumulate to learner model
  { agentId: 'skill:goal-conversation', fieldId: 'understanding.background_experience', render: 'hidden', handoff: ['goal-agent'], internal: false, accumulate: true, visibilityPreset: 'agent-internal' },
  { agentId: 'skill:goal-conversation', fieldId: 'understanding.learning_signal', render: 'hidden', handoff: ['goal-agent'], internal: false, accumulate: true, visibilityPreset: 'agent-internal' },
  // proposal-output: visible, handoff to goal-agent
  ...['confirmedProposal.learning_direction', 'confirmedProposal.first_deliverable',
     'confirmedProposal.key_stages', 'confirmedProposal.out_of_scope'].map(fieldId => ({
    agentId: 'skill:goal-conversation' as const, fieldId,
    render: 'visible' as RenderValue, handoff: ['goal-agent'],
    internal: false, accumulate: false,
  })),
  // public-reply: visible, no handoff (stays in goal conversation)
  { agentId: 'skill:goal-conversation', fieldId: 'userVisible', render: 'visible', handoff: [], internal: false, accumulate: false },
  { agentId: 'skill:goal-conversation', fieldId: 'goalConversation.nextQuestions', render: 'visible', handoff: [], internal: false, accumulate: false },
  { agentId: 'skill:goal-conversation', fieldId: 'goalConversation.quickReplies', render: 'visible', handoff: [], internal: false, accumulate: false },
  // control-signal: visible, no handoff or internal
  { agentId: 'skill:goal-conversation', fieldId: 'core.conversationId', render: 'visible', handoff: ['goal-agent'], internal: false, accumulate: false },
  { agentId: 'skill:goal-conversation', fieldId: 'core.stage', render: 'visible', handoff: ['goal-agent'], internal: false, accumulate: false },
  { agentId: 'skill:goal-conversation', fieldId: 'core.confidence', render: 'visible', handoff: [], internal: true, accumulate: false, notes: 'internal — 仅作 UI 进度条' },
  { agentId: 'skill:goal-conversation', fieldId: 'core.isCompleted', render: 'visible', handoff: ['goal-agent'], internal: false, accumulate: false },

  // === goal-agent 桥接路由：接收并转交到 path ===
  // 交付行覆盖 path 实际消费的全部 goal 字段（V3 设计 §7.3；2026-08 P1 补全）
  ...['understanding.surface_goal', 'understanding.real_problem',
     'understanding.background_experience', 'understanding.learning_signal',
     'understanding.constraints_and_boundaries', 'understanding.pain_points',
     'understanding.motivation', 'understanding.urgency',
     'understanding.scenario', 'understanding.deadline_text',
     'understanding.current_baseline.level', 'understanding.current_baseline.evidence',
     'understanding.success_criteria.observable_result', 'understanding.success_criteria.acceptance_check',
     'understanding.available_resources.time_budget', 'understanding.available_resources.time_horizon',
     'understanding.available_resources.time_per_session',
     'confirmedProposal.learning_direction', 'confirmedProposal.first_deliverable',
     'confirmedProposal.key_stages', 'confirmedProposal.out_of_scope'].map(fieldId => ({
    agentId: 'goal-agent' as const, fieldId,
    render: (fieldId === 'understanding.background_experience' || fieldId === 'understanding.learning_signal')
      ? 'hidden' as RenderValue : 'visible' as RenderValue,
    handoff: ['path'],
    internal: false, accumulate: false,
    ...(fieldId === 'understanding.background_experience' || fieldId === 'understanding.learning_signal'
      ? { visibilityPreset: 'agent-internal' as const } : {}),
    ...(fieldId === 'understanding.real_problem' ? { notes: 'path description 的最终兜底' } : {}),
  })),
];

export interface FieldRoutingBootstrapResult {
  fieldsCreated: number; fieldsSkipped: number;
  contractsCreated: number; contractsSkipped: number;
  routingsCreated: number; routingsSkipped: number;
}

export async function ensureGoalFieldRoutings(systemPrisma: PrismaClient): Promise<FieldRoutingBootstrapResult> {
  const result: FieldRoutingBootstrapResult = { fieldsCreated: 0, fieldsSkipped: 0, contractsCreated: 0, contractsSkipped: 0, routingsCreated: 0, routingsSkipped: 0 };

  for (const c of GOAL_FIELD_ROUTING_CONTRACTS) {
    const exists = await systemPrisma.agent_contracts.findUnique({ where: { agentId: c.agentId } });
    await systemPrisma.agent_contracts.upsert({ where: { agentId: c.agentId }, update: {}, create: { id: randomUUID(), agentId: c.agentId, stage: STAGE, displayName: c.displayName, description: c.description, schemaVersion: 'v3', source: 'code', managedByCode: true } });
    exists ? result.contractsSkipped++ : result.contractsCreated++;
  }

  for (const f of GOAL_FIELD_ROUTING_FIELDS) {
    const exists = await systemPrisma.field_definitions.findUnique({ where: { fieldId: f.fieldId } });
    await systemPrisma.field_definitions.upsert({ where: { fieldId: f.fieldId }, update: {}, create: { id: randomUUID(), fieldId: f.fieldId, stage: STAGE, promptRole: f.promptRole, valueType: f.valueType, snakeName: f.snakeName ?? null, camelName: f.camelName ?? null, pathInRawOutput: f.pathInRawOutput ?? null, description: f.description, enumValues: f.enumValues ? JSON.stringify(f.enumValues) : null, systemLocked: f.systemLocked ?? false, structureLocked: f.structureLocked ?? false, bindings: f.bindings ? JSON.stringify(f.bindings) : null } });
    exists ? result.fieldsSkipped++ : result.fieldsCreated++;
  }

  for (const r of GOAL_FIELD_ROUTINGS) {
    const exists = await systemPrisma.agent_field_routings.findUnique({ where: { agentId_fieldId: { agentId: r.agentId, fieldId: r.fieldId } } });
    await systemPrisma.agent_field_routings.upsert({ where: { agentId_fieldId: { agentId: r.agentId, fieldId: r.fieldId } }, update: {}, create: { id: randomUUID(), agentId: r.agentId, fieldId: r.fieldId, render: r.render, handoff: (r.handoff && r.handoff.length) ? JSON.stringify(r.handoff) : null, internalFlag: r.internal, accumulate: r.accumulate, visibilityPreset: r.visibilityPreset ?? null, notes: r.notes ?? null, source: 'code', managedByCode: true } });
    exists ? result.routingsSkipped++ : result.routingsCreated++;
  }

  return result;
}
