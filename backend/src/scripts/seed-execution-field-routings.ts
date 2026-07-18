/**
 * Execution（Learn）阶段字段路由 seed（skill 粒度）
 *
 * 契约（按执行顺序）：
 *   - skill:teaching-turn：单轮教学回复 + 结构化教学状态
 *   - skill:peer-reinforcement：同伴式强化讨论
 *   - skill:session-wrapup：课后总结与评估
 *   - skill:adaptive-guidance-copy：自适应引导文案
 *   - teaching-agent：聚合编排，handoff 到 learner 阶段（累积画像）
 *
 * 字段命名 = 各 skill prompt `## 输出规格` 的 camelCase
 */

import { randomUUID } from 'crypto';
import type { PrismaClient } from '../generated/system-client';

type PromptRole = 'hard-required' | 'soft-info' | 'hidden-inference' | 'public-reply' | 'proposal-output' | 'derived-presentation' | 'control-signal';
type RenderValue = 'visible' | 'hidden';

interface SeedField { fieldId: string; promptRole: PromptRole; valueType: string; snakeName?: string; camelName?: string; description: string; enumValues?: string[]; systemLocked?: boolean; structureLocked?: boolean; bindings?: Record<string, unknown>; }
interface SeedContract { agentId: string; displayName: string; description: string; }
interface SeedRouting { agentId: string; fieldId: string; render: RenderValue; handoff: string[]; internal: boolean; accumulate: boolean; visibilityPreset?: string; notes?: string; }

const STAGE = 'execution';

export const EXECUTION_FIELD_ROUTING_CONTRACTS: SeedContract[] = [
  { agentId: 'skill:teaching-turn', displayName: '教学回合 Skill', description: '生成单轮教学回复，输出 reply + analysis + knowledge + control' },
  { agentId: 'skill:peer-reinforcement', displayName: '伴学补强 Skill', description: '同伴式引导讨论与理解补强' },
  { agentId: 'skill:session-wrapup', displayName: '课后产出 Skill', description: '生成课后总结、评估、知识点结晶' },
  { agentId: 'skill:adaptive-guidance-copy', displayName: '自适应引导文案 Skill', description: '根据情境生成自适应引导话术' },
  { agentId: 'teaching-agent', displayName: '教学 Agent', description: '教学阶段聚合编排，handoff 到 learner 累积画像' },
];

export const EXECUTION_FIELD_ROUTING_FIELDS: SeedField[] = [
  // === skill:teaching-turn 产出 ===
  { fieldId: 'reply', promptRole: 'public-reply', valueType: 'string', description: '教学回合的对话回复', systemLocked: true },
  { fieldId: 'analysis.cognitiveLevel', promptRole: 'hidden-inference', valueType: 'string', description: '学习者认知层级（Bloom 等级）' },
  { fieldId: 'analysis.levelScore', promptRole: 'hidden-inference', valueType: 'number', description: '认知层级量化分数' },
  { fieldId: 'analysis.understanding', promptRole: 'hidden-inference', valueType: 'number', description: '本轮理解程度 0-1' },
  { fieldId: 'analysis.confusionPoints', promptRole: 'hidden-inference', valueType: 'array<string>', description: '本轮检测到的困惑点' },
  { fieldId: 'analysis.engagement', promptRole: 'hidden-inference', valueType: 'number', description: '本轮参与度 0-1' },
  { fieldId: 'analysis.emotionalState', promptRole: 'hidden-inference', valueType: 'string', description: '情绪状态推断' },
  { fieldId: 'knowledge.currentPoint', promptRole: 'derived-presentation', valueType: 'string', description: '当前知识点' },
  { fieldId: 'knowledge.points', promptRole: 'derived-presentation', valueType: 'array<object>', description: '本轮涉及的知识点状态列表' },
  { fieldId: 'pedagogy.strategies', promptRole: 'hidden-inference', valueType: 'array<string>', description: '使用的教学策略' },
  { fieldId: 'control.isCompletionCandidate', promptRole: 'control-signal', valueType: 'boolean', description: '是否触发 task 完成判定' },
  { fieldId: 'control.shouldTriggerPeer', promptRole: 'control-signal', valueType: 'boolean', description: '是否触发伴学回合' },

  // === skill:peer-reinforcement 产出 ===
  { fieldId: 'peer.message', promptRole: 'public-reply', valueType: 'string', description: '伴学补强的对话回复' },
  { fieldId: 'peer.followUpQuestions', promptRole: 'public-reply', valueType: 'array<string>', description: '伴学后续追问' },

  // === skill:session-wrapup 产出 ===
  { fieldId: 'wrapup.summary.topicSummary', promptRole: 'public-reply', valueType: 'string', description: '本次会话主题总结' },
  { fieldId: 'wrapup.summary.knowledgeSummary', promptRole: 'public-reply', valueType: 'string', description: '本次会话知识点总结' },
  { fieldId: 'wrapup.summary.knowledgeItems', promptRole: 'derived-presentation', valueType: 'array<object>', description: '本次会话知识点列表（name/status/progress/evidence）' },
  { fieldId: 'wrapup.summary.learningEvaluation', promptRole: 'public-reply', valueType: 'string', description: '学习评估文本' },
  { fieldId: 'wrapup.summary.practiceAdvice', promptRole: 'public-reply', valueType: 'string', description: '练习建议' },
  { fieldId: 'wrapup.evaluation.sessionLss', promptRole: 'hidden-inference', valueType: 'number', description: '本次会话 LSS（学习状态评分）' },
  { fieldId: 'wrapup.evaluation.sessionKtl', promptRole: 'hidden-inference', valueType: 'number', description: '本次会话 KTL（知识转移负荷）' },
  { fieldId: 'wrapup.evaluation.sessionLf', promptRole: 'hidden-inference', valueType: 'number', description: '本次会话 LF（学习疲劳）' },
  { fieldId: 'wrapup.evaluation.confidence', promptRole: 'hidden-inference', valueType: 'number', description: '本次评估的置信度' },

  // === skill:adaptive-guidance-copy 产出 ===
  { fieldId: 'guidance.headline', promptRole: 'public-reply', valueType: 'string', description: '引导文案主标题' },
  { fieldId: 'guidance.subtitle', promptRole: 'public-reply', valueType: 'string', description: '引导文案副标题' },
  { fieldId: 'guidance.todayActions', promptRole: 'public-reply', valueType: 'array<object>', description: '今日行动列表（label/to）' },
  { fieldId: 'guidance.nextStep', promptRole: 'public-reply', valueType: 'string', description: '下一步建议' },
];

export const EXECUTION_FIELD_ROUTINGS: SeedRouting[] = [
  // teaching-turn 输出
  { agentId: 'skill:teaching-turn', fieldId: 'reply', render: 'visible', handoff: ['teaching-agent'], internal: false, accumulate: false },
  ...['analysis.cognitiveLevel', 'analysis.levelScore', 'analysis.understanding', 'analysis.confusionPoints',
      'analysis.engagement', 'analysis.emotionalState'].map(fieldId => ({
    agentId: 'skill:teaching-turn' as const, fieldId,
    render: 'hidden' as RenderValue, handoff: ['teaching-agent'],
    internal: false, accumulate: true,
    visibilityPreset: 'agent-internal' as const
  })),
  { agentId: 'skill:teaching-turn', fieldId: 'knowledge.currentPoint', render: 'visible', handoff: ['teaching-agent'], internal: false, accumulate: false },
  { agentId: 'skill:teaching-turn', fieldId: 'knowledge.points', render: 'visible', handoff: ['teaching-agent'], internal: false, accumulate: true },
  { agentId: 'skill:teaching-turn', fieldId: 'pedagogy.strategies', render: 'hidden', handoff: ['teaching-agent'], internal: false, accumulate: true, visibilityPreset: 'agent-internal' },
  { agentId: 'skill:teaching-turn', fieldId: 'control.isCompletionCandidate', render: 'visible', handoff: ['teaching-agent'], internal: false, accumulate: false },
  { agentId: 'skill:teaching-turn', fieldId: 'control.shouldTriggerPeer', render: 'visible', handoff: ['skill:peer-reinforcement', 'teaching-agent'], internal: false, accumulate: false, notes: '触发 peer 流程的信号' },

  // peer-reinforcement 输出
  { agentId: 'skill:peer-reinforcement', fieldId: 'peer.message', render: 'visible', handoff: ['teaching-agent'], internal: false, accumulate: false },
  { agentId: 'skill:peer-reinforcement', fieldId: 'peer.followUpQuestions', render: 'visible', handoff: ['teaching-agent'], internal: false, accumulate: false },

  // session-wrapup 输出
  ...['wrapup.summary.topicSummary', 'wrapup.summary.knowledgeSummary',
      'wrapup.summary.knowledgeItems', 'wrapup.summary.learningEvaluation',
      'wrapup.summary.practiceAdvice'].map(fieldId => ({
    agentId: 'skill:session-wrapup' as const, fieldId,
    render: 'visible' as RenderValue, handoff: ['teaching-agent'],
    internal: false, accumulate: true,
  })),
  ...['wrapup.evaluation.sessionLss', 'wrapup.evaluation.sessionKtl',
      'wrapup.evaluation.sessionLf', 'wrapup.evaluation.confidence'].map(fieldId => ({
    agentId: 'skill:session-wrapup' as const, fieldId,
    render: 'hidden' as RenderValue, handoff: ['teaching-agent'],
    internal: false, accumulate: true,
    visibilityPreset: 'agent-internal' as const
  })),

  // adaptive-guidance-copy 输出
  ...['guidance.headline', 'guidance.subtitle', 'guidance.todayActions', 'guidance.nextStep'].map(fieldId => ({
    agentId: 'skill:adaptive-guidance-copy' as const, fieldId,
    render: 'visible' as RenderValue, handoff: ['teaching-agent'],
    internal: false, accumulate: false,
  })),

  // teaching-agent → learner（累积画像）
  ...['analysis.understanding', 'analysis.confusionPoints', 'knowledge.points',
      'pedagogy.strategies', 'wrapup.summary.knowledgeItems',
      'wrapup.evaluation.sessionLss', 'wrapup.evaluation.sessionKtl', 'wrapup.evaluation.sessionLf'].map(fieldId => ({
    agentId: 'teaching-agent' as const, fieldId,
    render: 'hidden' as RenderValue, handoff: ['learner'],
    internal: false, accumulate: true,
    visibilityPreset: 'agent-internal' as const
  })),
];

export interface FieldRoutingBootstrapResult {
  fieldsCreated: number; fieldsSkipped: number;
  contractsCreated: number; contractsSkipped: number;
  routingsCreated: number; routingsSkipped: number;
}

export async function ensureExecutionFieldRoutings(systemPrisma: PrismaClient): Promise<FieldRoutingBootstrapResult> {
  const result: FieldRoutingBootstrapResult = { fieldsCreated: 0, fieldsSkipped: 0, contractsCreated: 0, contractsSkipped: 0, routingsCreated: 0, routingsSkipped: 0 };

  for (const c of EXECUTION_FIELD_ROUTING_CONTRACTS) {
    const exists = await systemPrisma.agent_contracts.findUnique({ where: { agentId: c.agentId } });
    await systemPrisma.agent_contracts.upsert({ where: { agentId: c.agentId }, update: {}, create: { id: randomUUID(), agentId: c.agentId, stage: STAGE, displayName: c.displayName, description: c.description, schemaVersion: 'v3', source: 'code', managedByCode: true } });
    exists ? result.contractsSkipped++ : result.contractsCreated++;
  }

  for (const f of EXECUTION_FIELD_ROUTING_FIELDS) {
    const exists = await systemPrisma.field_definitions.findUnique({ where: { fieldId: f.fieldId } });
    await systemPrisma.field_definitions.upsert({ where: { fieldId: f.fieldId }, update: {}, create: { id: randomUUID(), fieldId: f.fieldId, stage: STAGE, promptRole: f.promptRole, valueType: f.valueType, snakeName: f.snakeName ?? null, camelName: f.camelName ?? null, description: f.description, enumValues: f.enumValues ? JSON.stringify(f.enumValues) : null, systemLocked: f.systemLocked ?? false, structureLocked: f.structureLocked ?? false, bindings: f.bindings ? JSON.stringify(f.bindings) : null } });
    exists ? result.fieldsSkipped++ : result.fieldsCreated++;
  }

  for (const r of EXECUTION_FIELD_ROUTINGS) {
    const exists = await systemPrisma.agent_field_routings.findUnique({ where: { agentId_fieldId: { agentId: r.agentId, fieldId: r.fieldId } } });
    await systemPrisma.agent_field_routings.upsert({ where: { agentId_fieldId: { agentId: r.agentId, fieldId: r.fieldId } }, update: {}, create: { id: randomUUID(), agentId: r.agentId, fieldId: r.fieldId, render: r.render, handoff: (r.handoff && r.handoff.length) ? JSON.stringify(r.handoff) : null, internalFlag: r.internal, accumulate: r.accumulate, visibilityPreset: r.visibilityPreset ?? null, notes: r.notes ?? null, source: 'code', managedByCode: true } });
    exists ? result.routingsSkipped++ : result.routingsCreated++;
  }

  return result;
}
