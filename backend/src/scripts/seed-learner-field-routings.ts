/**
 * 画像阶段字段路由 seed（skill 粒度）
 *
 * 契约（按调用关系）：
 *   - skill:lesson-knowledge-enricher：蒸馏会话知识背景（conceptLedger）
 *   - profile-agent：聚合，刷新 snapshot / projection
 *
 * 字段命名 = 各 skill normalizeOutput 白名单实际输出字段（camelCase）。
 * 注意：session-knowledge-distiller / dialogue-concept-extractor / label-generator
 * 已于 2026-07 退役（合并入 lesson-knowledge-enricher），此处不再声明；
 * goal-profile-inference / learning-pattern-distiller 已于 2026-08 退役
 * （画像叙述改由 profile-aggregator 的确定性 buildNarrativeInsights 产出）。
 *
 * 注：profile 阶段字段全部为编排器内部沉淀（写入 learnerModel），
 *    所以 render 默认 hidden, accumulate=true, internal 多为 false
 *    （因为 snapshot/projection 会读，不是 skill 私有）
 */

import { randomUUID } from 'crypto';
import type { PrismaClient } from '../generated/system-client';
import { deriveContract } from './seed-contract-helper';

type PromptRole = 'hard-required' | 'soft-info' | 'hidden-inference' | 'public-reply' | 'proposal-output' | 'derived-presentation' | 'control-signal';
type RenderValue = 'visible' | 'hidden';

interface SeedField { fieldId: string; promptRole: PromptRole; valueType: string; snakeName?: string; camelName?: string; pathInRawOutput?: string; description: string; enumValues?: string[]; systemLocked?: boolean; structureLocked?: boolean; bindings?: Record<string, unknown>; }
interface SeedContract { agentId: string; displayName: string; description: string; }
interface SeedRouting { agentId: string; fieldId: string; render: RenderValue; handoff: string[]; internal: boolean; accumulate: boolean; visibilityPreset?: string; notes?: string; }

const STAGE = 'profile';

export const PROFILE_FIELD_ROUTING_CONTRACTS: SeedContract[] = [
  deriveContract('skill:lesson-knowledge-enricher'),
  deriveContract('skill:learner-model'),
  deriveContract('profile-agent'),
];

export const PROFILE_FIELD_ROUTING_FIELDS: SeedField[] = [
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
  ...['conceptLedger', 'reusableFoundations', 'blockedFoundations',
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
