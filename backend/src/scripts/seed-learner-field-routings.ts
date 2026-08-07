/**
 * 画像阶段字段路由 seed（skill 粒度）
 *
 * 契约（按调用关系）：
 *   - skill:goal-profile-inference：从 Goal 输出推断长期画像叙述
 *   - skill:learning-pattern-distiller：蒸馏学习模式叙述
 *   - skill:lesson-knowledge-enricher：蒸馏会话知识背景（conceptLedger）
 *   - profile-agent：聚合，刷新 snapshot / projection
 *
 * 字段命名 = 各 skill normalizeOutput 白名单实际输出字段（camelCase）。
 * 注意：session-knowledge-distiller / dialogue-concept-extractor / label-generator
 * 已于 2026-07 退役（合并入 lesson-knowledge-enricher），此处不再声明。
 *
 * 注：profile 阶段字段全部为编排器内部沉淀（写入 learnerModel），
 *    所以 render 默认 hidden, accumulate=true, internal 多为 false
 *    （因为 snapshot/projection 会读，不是 skill 私有）
 */

import { randomUUID } from 'crypto';
import type { PrismaClient } from '../generated/system-client';

type PromptRole = 'hard-required' | 'soft-info' | 'hidden-inference' | 'public-reply' | 'proposal-output' | 'derived-presentation' | 'control-signal';
type RenderValue = 'visible' | 'hidden';

interface SeedField { fieldId: string; promptRole: PromptRole; valueType: string; snakeName?: string; camelName?: string; pathInRawOutput?: string; description: string; enumValues?: string[]; systemLocked?: boolean; structureLocked?: boolean; bindings?: Record<string, unknown>; }
interface SeedContract { agentId: string; displayName: string; description: string; }
interface SeedRouting { agentId: string; fieldId: string; render: RenderValue; handoff: string[]; internal: boolean; accumulate: boolean; visibilityPreset?: string; notes?: string; }

const STAGE = 'profile';

export const PROFILE_FIELD_ROUTING_CONTRACTS: SeedContract[] = [
  { agentId: 'skill:goal-profile-inference', displayName: '目标画像推断 Skill', description: '从 Goal 输出推断长期学习者画像叙述' },
  { agentId: 'skill:learning-pattern-distiller', displayName: '学习模式蒸馏 Skill', description: '从历史学习行为蒸馏稳定模式叙述' },
  { agentId: 'skill:lesson-knowledge-enricher', displayName: '会话知识蒸馏 Skill', description: '从教学会话蒸馏 conceptLedger / 基础概念（承接已退役的 session-knowledge-distiller 与 dialogue-concept-extractor）' },
  { agentId: 'skill:learner-model', displayName: '学习者聚合 Skill', description: '画像聚合（确定性）：叙述/控制/动态态/知识记忆 → snapshot/projection' },
  { agentId: 'profile-agent', displayName: '学习者 Agent', description: '学习者画像编排，聚合所有 distiller 输出并刷新 snapshot / projection' },
];

export const PROFILE_FIELD_ROUTING_FIELDS: SeedField[] = [
  // === skill:goal-profile-inference 产出 ===
  { fieldId: 'goalNarrative', promptRole: 'hidden-inference', valueType: 'string', description: '学习目标叙述（长期画像）' },
  { fieldId: 'backgroundContextNote', promptRole: 'hidden-inference', valueType: 'string', description: '学习背景叙述（长期画像）' },
  { fieldId: 'motivationNarrative', promptRole: 'hidden-inference', valueType: 'string', description: '学习动机叙述（长期画像）' },
  { fieldId: 'timeConstraintNote', promptRole: 'hidden-inference', valueType: 'string', description: '时间约束叙述（长期画像）' },
  { fieldId: 'selfAssessmentNote', promptRole: 'hidden-inference', valueType: 'string', description: '自评基线叙述（长期画像）' },

  // === skill:learning-pattern-distiller 产出 ===
  { fieldId: 'contentReceptionPattern', promptRole: 'hidden-inference', valueType: 'string', description: '内容接收模式叙述' },
  { fieldId: 'practicePreferenceNote', promptRole: 'hidden-inference', valueType: 'string', description: '练习偏好叙述' },
  { fieldId: 'frictionPatternNote', promptRole: 'hidden-inference', valueType: 'string', description: '卡点模式叙述' },
  { fieldId: 'effectiveTeachingPattern', promptRole: 'hidden-inference', valueType: 'string', description: '有效教学模式叙述' },
  { fieldId: 'supportStyleNote', promptRole: 'hidden-inference', valueType: 'string', description: '支持风格叙述' },
  { fieldId: 'taskGranularityNote', promptRole: 'hidden-inference', valueType: 'string', description: '任务粒度叙述' },

  // === skill:lesson-knowledge-enricher 产出（承接已退役 distiller） ===
  { fieldId: 'conceptLedger', promptRole: 'derived-presentation', valueType: 'array<object>', description: '概念账本（key/label/familiarity/transferReadiness/...）' },
  { fieldId: 'reusableFoundations', promptRole: 'derived-presentation', valueType: 'array<string>', description: '可复用的基础知识 key 列表' },
  { fieldId: 'blockedFoundations', promptRole: 'derived-presentation', valueType: 'array<string>', description: '阻碍后续学习的基础知识 key 列表' },
  { fieldId: 'transferSignals', promptRole: 'derived-presentation', valueType: 'array<object>', description: '可迁移信号（conceptKey/label/readiness/confidence）' },
  { fieldId: 'recurringConfusions', promptRole: 'hidden-inference', valueType: 'array<object>', description: '反复出现的困惑点（concept/evidence/confidence）' },

  // === skill:learner-model 聚合产出（确定性 snapshot 结构） ===
  { fieldId: 'snapshot.dynamicState', promptRole: 'derived-presentation', valueType: 'object', description: '动态学习状态（metrics/趋势/推荐节奏）' },
  { fieldId: 'snapshot.learningControlState', promptRole: 'derived-presentation', valueType: 'object', description: '学习控制态（paceMode/conceptLoad/reviewPriority/...）' },
  { fieldId: 'snapshot.replanSignal', promptRole: 'derived-presentation', valueType: 'object', description: '重调信号（shouldSuggest/priority/recommendation）' },
  { fieldId: 'snapshot.teachingHints', promptRole: 'derived-presentation', valueType: 'object', description: '教学提示（teaching 直接消费）' },
  { fieldId: 'snapshot.knowledgeMemory.currentPath', promptRole: 'derived-presentation', valueType: 'object', description: '路径级知识记忆（progress/taskMastery/conceptStates）' },
  { fieldId: 'snapshot.knowledgeMemory.globalSignals', promptRole: 'derived-presentation', valueType: 'object', description: '全局知识信号（mastered/fragile/struggling 概念）' },
  { fieldId: 'profile.curriculumControls', promptRole: 'derived-presentation', valueType: 'object', description: '课程控制（taskGranularity/conceptDensity/reviewFrequency）' },
];

export const PROFILE_FIELD_ROUTINGS: SeedRouting[] = [
  // goal-profile-inference → profile-agent
  ...['goalNarrative', 'backgroundContextNote', 'motivationNarrative',
      'timeConstraintNote', 'selfAssessmentNote'].map(fieldId => ({
    agentId: 'skill:goal-profile-inference' as const, fieldId,
    render: 'hidden' as RenderValue, handoff: ['profile-agent'],
    internal: false, accumulate: true,
    visibilityPreset: 'agent-internal' as const
  })),

  // learning-pattern-distiller → profile-agent
  ...['contentReceptionPattern', 'practicePreferenceNote', 'frictionPatternNote',
      'effectiveTeachingPattern', 'supportStyleNote', 'taskGranularityNote'].map(fieldId => ({
    agentId: 'skill:learning-pattern-distiller' as const, fieldId,
    render: 'hidden' as RenderValue, handoff: ['profile-agent'],
    internal: false, accumulate: true,
    visibilityPreset: 'agent-internal' as const
  })),

  // lesson-knowledge-enricher → profile-agent（knowledgeBackground 聚合）
  ...['conceptLedger', 'reusableFoundations', 'blockedFoundations', 'transferSignals', 'recurringConfusions'].map(fieldId => ({
    agentId: 'skill:lesson-knowledge-enricher' as const, fieldId,
    render: 'hidden' as RenderValue, handoff: ['profile-agent'],
    internal: false, accumulate: true,
    visibilityPreset: 'agent-internal' as const
  })),

  // learner-model → profile-agent（聚合产出，终点消费）
  ...['snapshot.dynamicState', 'snapshot.learningControlState', 'snapshot.replanSignal',
      'snapshot.teachingHints', 'snapshot.knowledgeMemory.currentPath',
      'snapshot.knowledgeMemory.globalSignals', 'profile.curriculumControls'].map(fieldId => ({
    agentId: 'skill:learner-model' as const, fieldId,
    render: 'hidden' as RenderValue, handoff: ['profile-agent'],
    internal: false, accumulate: true,
    visibilityPreset: 'agent-internal' as const,
    notes: '确定性聚合产出（ProfileAggregator/snapshot 装配），非 LLM 输出'
  })),

  // profile-agent 聚合（不再 handoff，是终点；触发 snapshot/projection 刷新）
  ...['goalNarrative', 'backgroundContextNote', 'motivationNarrative',
      'timeConstraintNote', 'selfAssessmentNote',
      'contentReceptionPattern', 'practicePreferenceNote', 'frictionPatternNote',
      'effectiveTeachingPattern', 'supportStyleNote', 'taskGranularityNote',
      'conceptLedger', 'reusableFoundations', 'blockedFoundations',
      'transferSignals', 'recurringConfusions',
      'snapshot.dynamicState', 'snapshot.learningControlState', 'snapshot.replanSignal',
      'snapshot.teachingHints', 'snapshot.knowledgeMemory.currentPath',
      'snapshot.knowledgeMemory.globalSignals', 'profile.curriculumControls'].map(fieldId => ({
    agentId: 'profile-agent' as const, fieldId,
    render: 'hidden' as RenderValue, handoff: [],
    internal: true, accumulate: true,
    visibilityPreset: 'agent-internal' as const,
    notes: 'learner 画像终点，写入 snapshot 与 projection'
  })),
];

export interface FieldRoutingBootstrapResult {
  fieldsCreated: number; fieldsSkipped: number;
  contractsCreated: number; contractsSkipped: number;
  routingsCreated: number; routingsSkipped: number;
}

export async function ensureProfileFieldRoutings(systemPrisma: PrismaClient): Promise<FieldRoutingBootstrapResult> {
  const result: FieldRoutingBootstrapResult = { fieldsCreated: 0, fieldsSkipped: 0, contractsCreated: 0, contractsSkipped: 0, routingsCreated: 0, routingsSkipped: 0 };

  for (const c of PROFILE_FIELD_ROUTING_CONTRACTS) {
    const exists = await systemPrisma.agent_contracts.findUnique({ where: { agentId: c.agentId } });
    await systemPrisma.agent_contracts.upsert({ where: { agentId: c.agentId }, update: {}, create: { id: randomUUID(), agentId: c.agentId, stage: STAGE, displayName: c.displayName, description: c.description, schemaVersion: 'v3', source: 'code', managedByCode: true } });
    exists ? result.contractsSkipped++ : result.contractsCreated++;
  }

  for (const f of PROFILE_FIELD_ROUTING_FIELDS) {
    const exists = await systemPrisma.field_definitions.findUnique({ where: { fieldId: f.fieldId } });
    await systemPrisma.field_definitions.upsert({ where: { fieldId: f.fieldId }, update: {}, create: { id: randomUUID(), fieldId: f.fieldId, stage: STAGE, promptRole: f.promptRole, valueType: f.valueType, snakeName: f.snakeName ?? null, camelName: f.camelName ?? null, pathInRawOutput: f.pathInRawOutput ?? null, description: f.description, enumValues: f.enumValues ? JSON.stringify(f.enumValues) : null, systemLocked: f.systemLocked ?? false, structureLocked: f.structureLocked ?? false, bindings: f.bindings ? JSON.stringify(f.bindings) : null } });
    exists ? result.fieldsSkipped++ : result.fieldsCreated++;
  }

  for (const r of PROFILE_FIELD_ROUTINGS) {
    const exists = await systemPrisma.agent_field_routings.findUnique({ where: { agentId_fieldId: { agentId: r.agentId, fieldId: r.fieldId } } });
    await systemPrisma.agent_field_routings.upsert({ where: { agentId_fieldId: { agentId: r.agentId, fieldId: r.fieldId } }, update: {}, create: { id: randomUUID(), agentId: r.agentId, fieldId: r.fieldId, render: r.render, handoff: (r.handoff && r.handoff.length) ? JSON.stringify(r.handoff) : null, internalFlag: r.internal, accumulate: r.accumulate, visibilityPreset: r.visibilityPreset ?? null, notes: r.notes ?? null, source: 'code', managedByCode: true } });
    exists ? result.routingsSkipped++ : result.routingsCreated++;
  }

  return result;
}
