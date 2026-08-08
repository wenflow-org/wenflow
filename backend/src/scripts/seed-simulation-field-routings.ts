/**
 * Simulation 阶段字段路由 seed（skill 粒度）
 *
 * 契约列表：
 *   - skill:virtual-learner-persona-designer / -scenario-designer：样本设计
 *   - skill:virtual-learner-goal-dialogue-simulator / -path-evaluator / -learn-turn-simulator：主链模拟器
 *   - skill:virtual-learner-referee / -actor-auditor：旁路审计
 *   - simulation-agent：仿真编排层（blackbox-runner / simulation 协调器，服务端注入输入、组装输出）
 *
 * 路由规则（与 goal/path/teaching 不同：仿真无阶段间 handoff）：
 *   - 输入通道全部为服务端注入（见 agent-contract-view SANDBOX_EXTRA_KEYS['simulation-agent']），不建输入行
 *   - 输出字段登记交付声明：展示类（黑盒会话 UI 可见）→ visible；调试类 → hidden + internal
 *   - handoff 统一指向 simulation-agent（交付给仿真编排层组装；旁路审计链由 blackbox-runner 运行时拼接）
 */

import { randomUUID } from 'crypto';
import type { PrismaClient } from '../generated/system-client';
import { deriveContract } from './seed-contract-helper';

type PromptRole =
  | 'hard-required' | 'soft-info' | 'hidden-inference'
  | 'public-reply' | 'proposal-output' | 'derived-presentation' | 'control-signal';

type RenderValue = 'visible' | 'hidden';

interface SeedField {
  fieldId: string;
  promptRole: PromptRole;
  valueType: string;
  description: string;
  snakeName?: string;
  camelName?: string;
  pathInRawOutput?: string;
  enumValues?: string[];
  systemLocked?: boolean;
  structureLocked?: boolean;
  bindings?: Record<string, unknown>;
  notes?: string;
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
  internal?: boolean;
  accumulate?: boolean;
  visibilityPreset?: string;
  notes?: string;
}

const STAGE = 'simulation';

export const SIMULATION_FIELD_ROUTING_CONTRACTS: SeedContract[] = [
  deriveContract('skill:virtual-learner-persona-designer'),
  deriveContract('skill:virtual-learner-scenario-designer'),
  deriveContract('skill:virtual-learner-goal-dialogue-simulator'),
  deriveContract('skill:virtual-learner-path-evaluator'),
  deriveContract('skill:virtual-learner-learn-turn-simulator'),
  deriveContract('skill:virtual-learner-referee'),
  deriveContract('skill:virtual-learner-actor-auditor'),
  deriveContract('simulation-agent'),
];

export const SIMULATION_FIELD_ROUTING_FIELDS: SeedField[] = [
  // === persona-designer 输出 ===
  { fieldId: 'personaSeed', promptRole: 'proposal-output', valueType: 'object', description: '稳定人物画像（occupation/corePersonality/helpSeekingPattern 等）' },
  { fieldId: 'personaDebug', promptRole: 'hidden-inference', valueType: 'object', description: '画像生成调试信息', notes: 'internal — 仅调试' },

  // === scenario-designer 输出 ===
  { fieldId: 'goalSeed', promptRole: 'proposal-output', valueType: 'object', description: '主故事目标种子（surfaceGoal/realProblem 基准）' },
  { fieldId: 'situationSeed', promptRole: 'proposal-output', valueType: 'object', description: '情境种子（场景切片基准）' },
  { fieldId: 'stories', promptRole: 'proposal-output', valueType: 'array', description: '一对多故事场景列表' },
  { fieldId: 'consistencyNotes', promptRole: 'proposal-output', valueType: 'array', description: '故事与 persona 的一致性校验说明' },

  // === goal-dialogue / learn-turn 共享输出 ===
  { fieldId: 'learnerReply', promptRole: 'public-reply', valueType: 'string', description: '学习者自然回应文本' },
  { fieldId: 'learnerEmotion', promptRole: 'public-reply', valueType: 'string', description: '学习者当前情绪' },
  { fieldId: 'learnerState', promptRole: 'proposal-output', valueType: 'object', description: '学习者主观状态（阶段相关）' },
  { fieldId: 'learnerDebug', promptRole: 'hidden-inference', valueType: 'object', description: '模拟器调试信息', notes: 'internal — 仅调试' },

  // === learn-turn 独有输出 ===
  { fieldId: 'learnerFeedback', promptRole: 'public-reply', valueType: 'object', description: '学习者对当前 task 是否学完的自我反馈' },

  // === path-evaluator 输出 ===
  { fieldId: 'pathReaction', promptRole: 'public-reply', valueType: 'string', description: '学习者对路径的自然反应（accept/modify/reject）' },
  { fieldId: 'visibleRequestedChanges', promptRole: 'proposal-output', valueType: 'array', description: '学习者明确提出的可见修改项' },
  { fieldId: 'pathDebug', promptRole: 'hidden-inference', valueType: 'object', description: '路径评估调试信息', notes: 'internal — 仅调试' },

  // === referee 输出 ===
  { fieldId: 'verdict', promptRole: 'public-reply', valueType: 'string', description: '实验裁判结论：pass|pass_with_concerns|fail|inconclusive' },
  { fieldId: 'scores', promptRole: 'proposal-output', valueType: 'object', description: '各维度 0-100 分（goalExperience/goalUnderstanding/pathExperience/teachingExperience/controlConsistency/boundaryIntegrity/evidenceSufficiency）' },
  { fieldId: 'findings', promptRole: 'proposal-output', valueType: 'array', description: '带证据引用的问题发现' },
  { fieldId: 'recommendations', promptRole: 'proposal-output', valueType: 'array', description: '面向实验维护者的改进建议' },
  { fieldId: 'evidence', promptRole: 'proposal-output', valueType: 'array', description: '可定位到输入轨迹的证据' },

  // === actor-auditor 输出（与 referee 区分命名） ===
  { fieldId: 'actorVerdict', promptRole: 'public-reply', valueType: 'string', description: '角色保真结论：credible|credible_with_concerns|invalid|inconclusive' },
  { fieldId: 'actorScores', promptRole: 'proposal-output', valueType: 'object', description: '角色保真度各维度 0-100 分' },
  { fieldId: 'actorFindings', promptRole: 'proposal-output', valueType: 'array', description: '带证据引用的保真度问题' },
  { fieldId: 'actorRecommendations', promptRole: 'proposal-output', valueType: 'array', description: '面向模拟器维护者的改进建议' },
  { fieldId: 'actorEvidence', promptRole: 'proposal-output', valueType: 'array', description: '可定位到角色设定和行为轨迹的证据' },
];

export const SIMULATION_FIELD_ROUTINGS: SeedRouting[] = [
  // === persona-designer ===
  { agentId: 'skill:virtual-learner-persona-designer', fieldId: 'personaSeed', render: 'visible', handoff: ['simulation-agent'] },
  { agentId: 'skill:virtual-learner-persona-designer', fieldId: 'personaDebug', render: 'hidden', handoff: ['simulation-agent'], internal: true, notes: 'internal — 仅调试' },

  // === scenario-designer ===
  { agentId: 'skill:virtual-learner-scenario-designer', fieldId: 'goalSeed', render: 'visible', handoff: ['simulation-agent'] },
  { agentId: 'skill:virtual-learner-scenario-designer', fieldId: 'situationSeed', render: 'visible', handoff: ['simulation-agent'] },
  { agentId: 'skill:virtual-learner-scenario-designer', fieldId: 'stories', render: 'visible', handoff: ['simulation-agent'] },
  { agentId: 'skill:virtual-learner-scenario-designer', fieldId: 'consistencyNotes', render: 'visible', handoff: ['simulation-agent'] },

  // === goal-dialogue ===
  { agentId: 'skill:virtual-learner-goal-dialogue-simulator', fieldId: 'learnerReply', render: 'visible', handoff: ['simulation-agent'] },
  { agentId: 'skill:virtual-learner-goal-dialogue-simulator', fieldId: 'learnerEmotion', render: 'visible', handoff: ['simulation-agent'] },
  { agentId: 'skill:virtual-learner-goal-dialogue-simulator', fieldId: 'learnerState', render: 'visible', handoff: ['simulation-agent'] },
  { agentId: 'skill:virtual-learner-goal-dialogue-simulator', fieldId: 'learnerDebug', render: 'hidden', handoff: ['simulation-agent'], internal: true, notes: 'internal — 仅调试' },

  // === path-evaluator ===
  { agentId: 'skill:virtual-learner-path-evaluator', fieldId: 'pathReaction', render: 'visible', handoff: ['simulation-agent'] },
  { agentId: 'skill:virtual-learner-path-evaluator', fieldId: 'visibleRequestedChanges', render: 'visible', handoff: ['simulation-agent'] },
  { agentId: 'skill:virtual-learner-path-evaluator', fieldId: 'pathDebug', render: 'hidden', handoff: ['simulation-agent'], internal: true, notes: 'internal — 仅调试' },

  // === learn-turn ===
  { agentId: 'skill:virtual-learner-learn-turn-simulator', fieldId: 'learnerReply', render: 'visible', handoff: ['simulation-agent'] },
  { agentId: 'skill:virtual-learner-learn-turn-simulator', fieldId: 'learnerEmotion', render: 'visible', handoff: ['simulation-agent'] },
  { agentId: 'skill:virtual-learner-learn-turn-simulator', fieldId: 'learnerState', render: 'visible', handoff: ['simulation-agent'] },
  { agentId: 'skill:virtual-learner-learn-turn-simulator', fieldId: 'learnerFeedback', render: 'visible', handoff: ['simulation-agent'] },
  { agentId: 'skill:virtual-learner-learn-turn-simulator', fieldId: 'learnerDebug', render: 'hidden', handoff: ['simulation-agent'], internal: true, notes: 'internal — 仅调试' },

  // === referee ===
  { agentId: 'skill:virtual-learner-referee', fieldId: 'verdict', render: 'visible', handoff: ['simulation-agent'] },
  { agentId: 'skill:virtual-learner-referee', fieldId: 'scores', render: 'visible', handoff: ['simulation-agent'] },
  { agentId: 'skill:virtual-learner-referee', fieldId: 'findings', render: 'visible', handoff: ['simulation-agent'] },
  { agentId: 'skill:virtual-learner-referee', fieldId: 'recommendations', render: 'visible', handoff: ['simulation-agent'] },
  { agentId: 'skill:virtual-learner-referee', fieldId: 'evidence', render: 'visible', handoff: ['simulation-agent'] },

  // === actor-auditor ===
  { agentId: 'skill:virtual-learner-actor-auditor', fieldId: 'actorVerdict', render: 'visible', handoff: ['simulation-agent'] },
  { agentId: 'skill:virtual-learner-actor-auditor', fieldId: 'actorScores', render: 'visible', handoff: ['simulation-agent'] },
  { agentId: 'skill:virtual-learner-actor-auditor', fieldId: 'actorFindings', render: 'visible', handoff: ['simulation-agent'] },
  { agentId: 'skill:virtual-learner-actor-auditor', fieldId: 'actorRecommendations', render: 'visible', handoff: ['simulation-agent'] },
  { agentId: 'skill:virtual-learner-actor-auditor', fieldId: 'actorEvidence', render: 'visible', handoff: ['simulation-agent'] },
];

export interface SimulationFieldRoutingBootstrapResult {
  fieldsCreated: number; fieldsSkipped: number;
  contractsCreated: number; contractsSkipped: number;
  routingsCreated: number; routingsSkipped: number;
}

export async function ensureSimulationFieldRoutings(systemPrisma: PrismaClient): Promise<SimulationFieldRoutingBootstrapResult> {
  const result: SimulationFieldRoutingBootstrapResult = { fieldsCreated: 0, fieldsSkipped: 0, contractsCreated: 0, contractsSkipped: 0, routingsCreated: 0, routingsSkipped: 0 };

  for (const c of SIMULATION_FIELD_ROUTING_CONTRACTS) {
    const exists = await systemPrisma.agent_contracts.findUnique({ where: { agentId: c.agentId } });
    await systemPrisma.agent_contracts.upsert({ where: { agentId: c.agentId }, update: {}, create: { id: randomUUID(), agentId: c.agentId, stage: STAGE, displayName: c.displayName, description: c.description, schemaVersion: 'v3', source: 'code', managedByCode: true } });
    exists ? result.contractsSkipped++ : result.contractsCreated++;
  }

  for (const f of SIMULATION_FIELD_ROUTING_FIELDS) {
    const exists = await systemPrisma.field_definitions.findUnique({ where: { fieldId: f.fieldId } });
    await systemPrisma.field_definitions.upsert({ where: { fieldId: f.fieldId }, update: {}, create: { id: randomUUID(), fieldId: f.fieldId, stage: STAGE, promptRole: f.promptRole, valueType: f.valueType, snakeName: null, camelName: null, pathInRawOutput: null, description: f.description, enumValues: null, systemLocked: f.systemLocked ?? false, structureLocked: f.structureLocked ?? false, bindings: null } });
    exists ? result.fieldsSkipped++ : result.fieldsCreated++;
  }

  for (const r of SIMULATION_FIELD_ROUTINGS) {
    const exists = await systemPrisma.agent_field_routings.findUnique({ where: { agentId_fieldId: { agentId: r.agentId, fieldId: r.fieldId } } });
    await systemPrisma.agent_field_routings.upsert({ where: { agentId_fieldId: { agentId: r.agentId, fieldId: r.fieldId } }, update: {}, create: { id: randomUUID(), agentId: r.agentId, fieldId: r.fieldId, render: r.render, handoff: (r.handoff && r.handoff.length) ? JSON.stringify(r.handoff) : null, internalFlag: r.internal ?? false, accumulate: false, visibilityPreset: r.render === 'hidden' ? 'agent-internal' : null, notes: r.notes ?? null, source: 'code', managedByCode: true } });
    exists ? result.routingsSkipped++ : result.routingsCreated++;
  }

  return result;
}
