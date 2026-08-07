/**
 * Path 阶段字段路由 seed（skill 粒度）
 *
 * 契约（按执行顺序）：
 *   - skill:path-planning：认知图景 + milestone 骨架
 *   - skill:stage-designer：milestone → subtasks
 *   - path-agent：聚合输出，handoff 到 execution 阶段
 *
 * normalizedInput.* 由编排层确定性定帧（buildFramedNormalizedInput，
 * 原 skill:path-scene-framing 已移除），挂 path-agent 名下。
 *
 * 字段命名 = 各 skill prompt `## 输出规格` 的 camelCase
 */

import { randomUUID } from 'crypto';
import type { PrismaClient } from '../generated/system-client';

type PromptRole = 'hard-required' | 'soft-info' | 'hidden-inference' | 'public-reply' | 'proposal-output' | 'derived-presentation' | 'control-signal';
type RenderValue = 'visible' | 'hidden';

interface SeedField { fieldId: string; promptRole: PromptRole; valueType: string; snakeName?: string; camelName?: string; pathInRawOutput?: string; description: string; enumValues?: string[]; systemLocked?: boolean; structureLocked?: boolean; bindings?: Record<string, unknown>; }
interface SeedContract { agentId: string; displayName: string; description: string; }
interface SeedRouting { agentId: string; fieldId: string; render: RenderValue; handoff: string[]; internal: boolean; accumulate: boolean; visibilityPreset?: string; notes?: string; }

const STAGE = 'path';

export const PATH_FIELD_ROUTING_CONTRACTS: SeedContract[] = [
  { agentId: 'skill:path-planning', displayName: '路径规划 Skill', description: '认知图景 + 学习路径的 milestone 骨架' },
  { agentId: 'skill:stage-designer', displayName: '阶段设计 Skill', description: 'milestone → subtasks 的任务展开' },
  { agentId: 'path-agent', displayName: '路径 Agent', description: '路径阶段聚合编排（含 normalizedInput 确定性定帧），handoff 到 execution 阶段' },
];

export const PATH_FIELD_ROUTING_FIELDS: SeedField[] = [
  // === path-agent 确定性定帧产出 normalizedInput.*（原 skill:path-scene-framing） ===
  { fieldId: 'normalizedInput.learnerProfile.backgroundExperience', promptRole: 'soft-info', valueType: 'string', description: '学习者背景经验（清洗）' },
  { fieldId: 'normalizedInput.learnerProfile.constraintsAndBoundaries', promptRole: 'soft-info', valueType: 'string', description: '学习者约束与边界（清洗）' },
  { fieldId: 'normalizedInput.problemSpace.realProblem', promptRole: 'hard-required', valueType: 'string', description: '真实问题（清洗）', systemLocked: true },
  { fieldId: 'normalizedInput.problemSpace.scenario', promptRole: 'soft-info', valueType: 'string', description: '学习场景（清洗）' },
  { fieldId: 'normalizedInput.problemSpace.currentPainPoint', promptRole: 'soft-info', valueType: 'string', description: '当前痛点（清洗）' },
  { fieldId: 'normalizedInput.resources.timeBudget', promptRole: 'hard-required', valueType: 'string', description: '时间预算', systemLocked: true },
  { fieldId: 'normalizedInput.resources.timeBudgetCadence', promptRole: 'soft-info', valueType: 'string', description: '时间预算节奏' },
  { fieldId: 'normalizedInput.successCriteria.observableResult', promptRole: 'hard-required', valueType: 'string', description: '可观察结果', systemLocked: true },
  { fieldId: 'normalizedInput.confirmedProposal.firstDeliverable', promptRole: 'proposal-output', valueType: 'string', description: '确认的第一交付物' },
  { fieldId: 'normalizedInput.confirmedProposal.keyStages', promptRole: 'proposal-output', valueType: 'string', description: '确认的关键阶段' },
  { fieldId: 'normalizedInput.planningHints.paceSignal', promptRole: 'hidden-inference', valueType: 'string', description: '推断的学习节奏信号' },
  { fieldId: 'normalizedInput.planningHints.milestoneRange', promptRole: 'hidden-inference', valueType: 'string', description: '推断的 milestone 数量范围' },
  { fieldId: 'normalizedInput.planningHints.conceptRange', promptRole: 'hidden-inference', valueType: 'string', description: '推断的 concept 数量范围' },
  { fieldId: 'normalizedInput.planningHints.subtasksPerStageRange', promptRole: 'hidden-inference', valueType: 'string', description: '推断的每阶段 subtask 数量范围' },
  { fieldId: 'normalizedInput.planningHints.subtaskMinutesRange', promptRole: 'hidden-inference', valueType: 'string', description: '推断的 subtask 分钟数范围' },
  { fieldId: 'normalizedInput.planningHints.maxWeeks', promptRole: 'hidden-inference', valueType: 'number', description: '推断的最大周数' },
  // === path-agent 编排注入（loopOver 上下文，非 LLM 产出） ===
  { fieldId: 'previousMilestone', promptRole: 'derived-presentation', valueType: 'object', pathInRawOutput: 'previousMilestone', description: '前一里程碑上下文（title/coreConcept），consolidate 回捞输入；首阶段不注入' },

  // === skill:path-planning 产出 ===
  { fieldId: 'path.id', promptRole: 'control-signal', valueType: 'string', description: '路径 ID', systemLocked: true },
  { fieldId: 'path.name', promptRole: 'public-reply', valueType: 'string', description: '路径名称' },
  { fieldId: 'path.summary', promptRole: 'public-reply', valueType: 'string', description: '路径摘要' },
  { fieldId: 'path.totalMilestones', promptRole: 'derived-presentation', valueType: 'number', description: 'milestone 总数' },
  { fieldId: 'cognitiveCore.cognitiveDomain', promptRole: 'soft-info', valueType: 'string', description: '认知领域归类' },
  { fieldId: 'cognitiveCore.coreConcepts', promptRole: 'soft-info', valueType: 'array<object>', description: '核心概念列表' },
  { fieldId: 'milestones.stageNumber', promptRole: 'hard-required', valueType: 'number', description: '阶段编号', systemLocked: true },
  { fieldId: 'milestones.title', promptRole: 'hard-required', valueType: 'string', description: '阶段标题', systemLocked: true },
  { fieldId: 'milestones.coreConcept', promptRole: 'soft-info', valueType: 'string', description: '阶段核心概念' },
  { fieldId: 'milestones.goal', promptRole: 'hard-required', valueType: 'string', description: '阶段目标' },
  { fieldId: 'milestones.estimatedHours', promptRole: 'soft-info', valueType: 'number', description: '阶段估时（小时）' },

  // === skill:stage-designer 产出 ===
  { fieldId: 'subtasks.title', promptRole: 'hard-required', valueType: 'string', description: '子任务标题', systemLocked: true },
  { fieldId: 'subtasks.type', promptRole: 'soft-info', valueType: 'string', description: '子任务类型（learn / practice / verify）' },
  { fieldId: 'subtasks.estimatedMinutes', promptRole: 'soft-info', valueType: 'number', description: '子任务估时（分钟）' },
  { fieldId: 'subtasks.acceptanceCriteria', promptRole: 'soft-info', valueType: 'string', description: '验收标准' },
  { fieldId: 'subtasks.linkedConcept', promptRole: 'soft-info', valueType: 'string', description: '关联的认知概念' },
  { fieldId: 'subtasks.knowledgeType', promptRole: 'soft-info', valueType: 'string', description: '知识类型（factual / conceptual / procedural / metacognitive）' },
  { fieldId: 'subtasks.cognitiveLevel', promptRole: 'soft-info', valueType: 'string', description: '认知层次（Bloom 等级）' },
  { fieldId: 'subtasks.transferable', promptRole: 'soft-info', valueType: 'boolean', description: '是否可迁移' },
];

export const PATH_FIELD_ROUTINGS: SeedRouting[] = [
  // path-agent（确定性定帧）→ path-planning + stage-designer
  ...['normalizedInput.learnerProfile.backgroundExperience', 'normalizedInput.learnerProfile.constraintsAndBoundaries',
      'normalizedInput.problemSpace.realProblem', 'normalizedInput.problemSpace.scenario', 'normalizedInput.problemSpace.currentPainPoint',
      'normalizedInput.resources.timeBudget', 'normalizedInput.resources.timeBudgetCadence',
      'normalizedInput.successCriteria.observableResult',
      'normalizedInput.confirmedProposal.firstDeliverable', 'normalizedInput.confirmedProposal.keyStages',
      'normalizedInput.planningHints.paceSignal', 'normalizedInput.planningHints.milestoneRange',
      'normalizedInput.planningHints.conceptRange', 'normalizedInput.planningHints.subtasksPerStageRange',
      'normalizedInput.planningHints.subtaskMinutesRange', 'normalizedInput.planningHints.maxWeeks'].map(fieldId => ({
    agentId: 'path-agent' as const, fieldId,
    // normalizedInput 同时供 stage-designer（learning.service stageDesignerBaseInput）
    render: 'hidden' as RenderValue, handoff: ['skill:path-planning', 'skill:stage-designer'],
    internal: true, accumulate: false,
    visibilityPreset: 'agent-internal',
    notes: '确定性定帧产出（buildFramedNormalizedInput），非 LLM 输出'
  })),
  { agentId: 'path-agent', fieldId: 'previousMilestone', render: 'hidden', handoff: ['skill:stage-designer'], internal: true, accumulate: false, visibilityPreset: 'agent-internal', notes: 'loopOver 编排注入（前一 milestone 上下文），非 LLM 输出' },

  // path-planning → stage-designer + path-agent
  { agentId: 'skill:path-planning', fieldId: 'path.id', render: 'visible', handoff: ['path-agent'], internal: false, accumulate: false },
  { agentId: 'skill:path-planning', fieldId: 'path.name', render: 'visible', handoff: ['path-agent'], internal: false, accumulate: false },
  { agentId: 'skill:path-planning', fieldId: 'path.summary', render: 'visible', handoff: ['path-agent'], internal: false, accumulate: false },
  { agentId: 'skill:path-planning', fieldId: 'path.totalMilestones', render: 'visible', handoff: ['path-agent'], internal: false, accumulate: false },
  // cognitiveCore 同时供 stage-designer（learning.service stageDesignerBaseInput）
  { agentId: 'skill:path-planning', fieldId: 'cognitiveCore.cognitiveDomain', render: 'visible', handoff: ['path-agent', 'skill:stage-designer'], internal: false, accumulate: true },
  { agentId: 'skill:path-planning', fieldId: 'cognitiveCore.coreConcepts', render: 'visible', handoff: ['path-agent', 'skill:stage-designer'], internal: false, accumulate: true },
  ...['milestones.stageNumber', 'milestones.title', 'milestones.coreConcept',
      'milestones.goal', 'milestones.estimatedHours'].map(fieldId => ({
    agentId: 'skill:path-planning' as const, fieldId,
    render: 'visible' as RenderValue, handoff: ['skill:stage-designer', 'path-agent'],
    internal: false, accumulate: false,
  })),

  // stage-designer → path-agent
  ...['subtasks.title', 'subtasks.type', 'subtasks.estimatedMinutes',
      'subtasks.acceptanceCriteria', 'subtasks.linkedConcept',
      'subtasks.knowledgeType', 'subtasks.cognitiveLevel', 'subtasks.transferable'].map(fieldId => ({
    agentId: 'skill:stage-designer' as const, fieldId,
    render: 'visible' as RenderValue, handoff: ['path-agent'],
    internal: false, accumulate: false,
  })),

  // path-agent → learning（聚合 handoff）
  ...['path.name', 'path.summary', 'milestones.title', 'milestones.goal', 'subtasks.title', 'subtasks.acceptanceCriteria'].map(fieldId => ({
    agentId: 'path-agent' as const, fieldId,
    render: 'visible' as RenderValue, handoff: ['teaching'],
    internal: false, accumulate: false,
  })),
];

export interface FieldRoutingBootstrapResult {
  fieldsCreated: number; fieldsSkipped: number;
  contractsCreated: number; contractsSkipped: number;
  routingsCreated: number; routingsSkipped: number;
}

export async function ensurePathFieldRoutings(systemPrisma: PrismaClient): Promise<FieldRoutingBootstrapResult> {
  const result: FieldRoutingBootstrapResult = { fieldsCreated: 0, fieldsSkipped: 0, contractsCreated: 0, contractsSkipped: 0, routingsCreated: 0, routingsSkipped: 0 };

  for (const c of PATH_FIELD_ROUTING_CONTRACTS) {
    const exists = await systemPrisma.agent_contracts.findUnique({ where: { agentId: c.agentId } });
    await systemPrisma.agent_contracts.upsert({ where: { agentId: c.agentId }, update: {}, create: { id: randomUUID(), agentId: c.agentId, stage: STAGE, displayName: c.displayName, description: c.description, schemaVersion: 'v3', source: 'code', managedByCode: true } });
    exists ? result.contractsSkipped++ : result.contractsCreated++;
  }

  for (const f of PATH_FIELD_ROUTING_FIELDS) {
    const exists = await systemPrisma.field_definitions.findUnique({ where: { fieldId: f.fieldId } });
    await systemPrisma.field_definitions.upsert({ where: { fieldId: f.fieldId }, update: {}, create: { id: randomUUID(), fieldId: f.fieldId, stage: STAGE, promptRole: f.promptRole, valueType: f.valueType, snakeName: f.snakeName ?? null, camelName: f.camelName ?? null, pathInRawOutput: f.pathInRawOutput ?? null, description: f.description, enumValues: f.enumValues ? JSON.stringify(f.enumValues) : null, systemLocked: f.systemLocked ?? false, structureLocked: f.structureLocked ?? false, bindings: f.bindings ? JSON.stringify(f.bindings) : null } });
    exists ? result.fieldsSkipped++ : result.fieldsCreated++;
  }

  for (const r of PATH_FIELD_ROUTINGS) {
    const exists = await systemPrisma.agent_field_routings.findUnique({ where: { agentId_fieldId: { agentId: r.agentId, fieldId: r.fieldId } } });
    await systemPrisma.agent_field_routings.upsert({ where: { agentId_fieldId: { agentId: r.agentId, fieldId: r.fieldId } }, update: {}, create: { id: randomUUID(), agentId: r.agentId, fieldId: r.fieldId, render: r.render, handoff: (r.handoff && r.handoff.length) ? JSON.stringify(r.handoff) : null, internalFlag: r.internal, accumulate: r.accumulate, visibilityPreset: r.visibilityPreset ?? null, notes: r.notes ?? null, source: 'code', managedByCode: true } });
    exists ? result.routingsSkipped++ : result.routingsCreated++;
  }

  return result;
}
