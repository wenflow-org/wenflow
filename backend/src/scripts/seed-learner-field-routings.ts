/**
 * Learner 阶段字段路由 seed（skill 粒度）
 *
 * 契约（按调用关系）：
 *   - skill:goal-profile-inference：从 Goal 输出推断长期画像叙述
 *   - skill:learning-pattern-distiller：蒸馏学习模式叙述
 *   - skill:session-knowledge-distiller：蒸馏会话知识背景（conceptLedger）
 *   - skill:dialogue-concept-extractor：抽取对话中的概念信号
 *   - skill:label-generator：生成画像短标签
 *   - learner-agent：聚合，刷新 snapshot / projection
 *
 * 字段命名 = 各 skill prompt `## 输出规格` 的 camelCase
 *
 * 注：learner 阶段字段全部为编排器内部沉淀（写入 learnerModel），
 *    所以 render 默认 hidden, accumulate=true, internal 多为 false
 *    （因为 snapshot/projection 会读，不是 skill 私有）
 */

import { randomUUID } from 'crypto';
import type { PrismaClient } from '../generated/system-client';

type PromptRole = 'hard-required' | 'soft-info' | 'hidden-inference' | 'public-reply' | 'proposal-output' | 'derived-presentation' | 'control-signal';
type RenderValue = 'visible' | 'hidden';

interface SeedField { fieldId: string; promptRole: PromptRole; valueType: string; snakeName?: string; camelName?: string; description: string; enumValues?: string[]; systemLocked?: boolean; structureLocked?: boolean; bindings?: Record<string, unknown>; }
interface SeedContract { agentId: string; displayName: string; description: string; }
interface SeedRouting { agentId: string; fieldId: string; render: RenderValue; handoff: string[]; internal: boolean; accumulate: boolean; visibilityPreset?: string; notes?: string; }

const STAGE = 'learner';

const CONTRACTS: SeedContract[] = [
  { agentId: 'skill:goal-profile-inference', displayName: '目标画像推断 Skill', description: '从 Goal 输出推断长期学习者画像叙述' },
  { agentId: 'skill:learning-pattern-distiller', displayName: '学习模式蒸馏 Skill', description: '从历史学习行为蒸馏稳定模式叙述' },
  { agentId: 'skill:session-knowledge-distiller', displayName: '会话知识蒸馏 Skill', description: '从单次教学会话蒸馏 conceptLedger / 基础概念' },
  { agentId: 'skill:dialogue-concept-extractor', displayName: '对话概念抽取 Skill', description: '从对话中抽取反复出现的概念信号' },
  { agentId: 'skill:label-generator', displayName: '画像标签生成 Skill', description: '为学习者画像生成展示用短标签' },
  { agentId: 'learner-agent', displayName: '学习者 Agent', description: '学习者画像编排，聚合所有 distiller 输出并刷新 snapshot / projection' },
];

const FIELDS: SeedField[] = [
  // === skill:goal-profile-inference 产出 ===
  { fieldId: 'goalNarrative', promptRole: 'hidden-inference', valueType: 'string', description: '学习目标叙述（长期画像）' },
  { fieldId: 'backgroundNarrative', promptRole: 'hidden-inference', valueType: 'string', description: '学习背景叙述（长期画像）' },
  { fieldId: 'motivationNarrative', promptRole: 'hidden-inference', valueType: 'string', description: '学习动机叙述（长期画像）' },
  { fieldId: 'baselineNarrative', promptRole: 'hidden-inference', valueType: 'string', description: '当前基线叙述（长期画像）' },
  { fieldId: 'learningContextNarrative', promptRole: 'hidden-inference', valueType: 'string', description: '学习上下文叙述（长期画像）' },

  // === skill:learning-pattern-distiller 产出 ===
  { fieldId: 'learningPreferenceNarrative', promptRole: 'hidden-inference', valueType: 'string', description: '学习偏好叙述' },
  { fieldId: 'teachingModeNarrative', promptRole: 'hidden-inference', valueType: 'string', description: '有效教学模式叙述' },
  { fieldId: 'cognitiveStyleNarrative', promptRole: 'hidden-inference', valueType: 'string', description: '认知风格叙述' },
  { fieldId: 'pacingNarrative', promptRole: 'hidden-inference', valueType: 'string', description: '节奏偏好叙述' },
  { fieldId: 'motivationLeverNarrative', promptRole: 'hidden-inference', valueType: 'string', description: '动机抓手叙述' },

  // === skill:session-knowledge-distiller 产出 ===
  { fieldId: 'conceptLedger', promptRole: 'derived-presentation', valueType: 'array<object>', description: '概念账本（key/label/familiarity/transferReadiness/...）' },
  { fieldId: 'reusableFoundations', promptRole: 'derived-presentation', valueType: 'array<string>', description: '可复用的基础知识 key 列表' },
  { fieldId: 'blockedFoundations', promptRole: 'derived-presentation', valueType: 'array<string>', description: '阻碍后续学习的基础知识 key 列表' },
  { fieldId: 'transferSignals', promptRole: 'derived-presentation', valueType: 'array<object>', description: '可迁移信号（conceptKey/label/readiness/confidence）' },

  // === skill:dialogue-concept-extractor 产出 ===
  { fieldId: 'recurringConfusions', promptRole: 'hidden-inference', valueType: 'array<object>', description: '反复出现的困惑点（concept/evidence/confidence）' },
  { fieldId: 'extractorTransferSignals', promptRole: 'hidden-inference', valueType: 'array<object>', description: '抽取的迁移信号', snakeName: 'transferSignals_extractor', camelName: 'extractorTransferSignals' },

  // === skill:label-generator 产出 ===
  { fieldId: 'displayLabel', promptRole: 'public-reply', valueType: 'string', description: '画像展示标签（完整）' },
  { fieldId: 'shortLabel', promptRole: 'public-reply', valueType: 'string', description: '画像短标签' },
  { fieldId: 'labelIcon', promptRole: 'derived-presentation', valueType: 'string', description: '标签图标', snakeName: 'icon', camelName: 'icon' },
  { fieldId: 'labelColor', promptRole: 'derived-presentation', valueType: 'string', description: '标签颜色', snakeName: 'color', camelName: 'color' },
];

const ROUTINGS: SeedRouting[] = [
  // goal-profile-inference → learner-agent
  ...['goalNarrative', 'backgroundNarrative', 'motivationNarrative',
      'baselineNarrative', 'learningContextNarrative'].map(fieldId => ({
    agentId: 'skill:goal-profile-inference' as const, fieldId,
    render: 'hidden' as RenderValue, handoff: ['learner-agent'],
    internal: false, accumulate: true,
    visibilityPreset: 'agent-internal' as const
  })),

  // learning-pattern-distiller → learner-agent
  ...['learningPreferenceNarrative', 'teachingModeNarrative', 'cognitiveStyleNarrative',
      'pacingNarrative', 'motivationLeverNarrative'].map(fieldId => ({
    agentId: 'skill:learning-pattern-distiller' as const, fieldId,
    render: 'hidden' as RenderValue, handoff: ['learner-agent'],
    internal: false, accumulate: true,
    visibilityPreset: 'agent-internal' as const
  })),

  // session-knowledge-distiller → learner-agent
  ...['conceptLedger', 'reusableFoundations', 'blockedFoundations', 'transferSignals'].map(fieldId => ({
    agentId: 'skill:session-knowledge-distiller' as const, fieldId,
    render: 'hidden' as RenderValue, handoff: ['learner-agent'],
    internal: false, accumulate: true,
    visibilityPreset: 'agent-internal' as const
  })),

  // dialogue-concept-extractor → learner-agent
  ...['recurringConfusions', 'extractorTransferSignals'].map(fieldId => ({
    agentId: 'skill:dialogue-concept-extractor' as const, fieldId,
    render: 'hidden' as RenderValue, handoff: ['learner-agent'],
    internal: false, accumulate: true,
    visibilityPreset: 'agent-internal' as const
  })),

  // label-generator → learner-agent（标签可见，因为是画像 UI 用）
  { agentId: 'skill:label-generator', fieldId: 'displayLabel', render: 'visible', handoff: ['learner-agent'], internal: false, accumulate: true },
  { agentId: 'skill:label-generator', fieldId: 'shortLabel', render: 'visible', handoff: ['learner-agent'], internal: false, accumulate: true },
  { agentId: 'skill:label-generator', fieldId: 'labelIcon', render: 'visible', handoff: ['learner-agent'], internal: false, accumulate: true },
  { agentId: 'skill:label-generator', fieldId: 'labelColor', render: 'visible', handoff: ['learner-agent'], internal: false, accumulate: true },

  // learner-agent 聚合（不再 handoff，是终点；触发 snapshot/projection 刷新）
  ...['goalNarrative', 'learningPreferenceNarrative', 'conceptLedger',
      'reusableFoundations', 'blockedFoundations',
      'displayLabel', 'shortLabel'].map(fieldId => ({
    agentId: 'learner-agent' as const, fieldId,
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

export async function ensureLearnerFieldRoutings(systemPrisma: PrismaClient): Promise<FieldRoutingBootstrapResult> {
  const result: FieldRoutingBootstrapResult = { fieldsCreated: 0, fieldsSkipped: 0, contractsCreated: 0, contractsSkipped: 0, routingsCreated: 0, routingsSkipped: 0 };

  for (const c of CONTRACTS) {
    const exists = await systemPrisma.agent_contracts.findUnique({ where: { agentId: c.agentId } });
    if (exists) { result.contractsSkipped++; continue; }
    await systemPrisma.agent_contracts.create({ data: { id: randomUUID(), agentId: c.agentId, stage: STAGE, displayName: c.displayName, description: c.description, schemaVersion: 'v3', source: 'code', managedByCode: true } });
    result.contractsCreated++;
  }

  for (const f of FIELDS) {
    const exists = await systemPrisma.field_definitions.findUnique({ where: { fieldId: f.fieldId } });
    if (exists) { result.fieldsSkipped++; continue; }
    await systemPrisma.field_definitions.create({ data: { id: randomUUID(), fieldId: f.fieldId, stage: STAGE, promptRole: f.promptRole, valueType: f.valueType, snakeName: f.snakeName ?? null, camelName: f.camelName ?? null, description: f.description, enumValues: f.enumValues ?? null, systemLocked: f.systemLocked ?? false, structureLocked: f.structureLocked ?? false, bindings: f.bindings ? JSON.stringify(f.bindings) : null } });
    result.fieldsCreated++;
  }

  for (const r of ROUTINGS) {
    const exists = await systemPrisma.agent_field_routings.findUnique({ where: { agentId_fieldId: { agentId: r.agentId, fieldId: r.fieldId } } });
    if (exists) { result.routingsSkipped++; continue; }
    await systemPrisma.agent_field_routings.create({ data: { id: randomUUID(), agentId: r.agentId, fieldId: r.fieldId, render: r.render, handoff: (r.handoff && r.handoff.length) ? JSON.stringify(r.handoff) : null, internalFlag: r.internal, accumulate: r.accumulate, visibilityPreset: r.visibilityPreset ?? null, notes: r.notes ?? null, source: 'code', managedByCode: true } });
    result.routingsCreated++;
  }

  return result;
}