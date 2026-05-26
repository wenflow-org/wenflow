import { SkillDefinition, SkillExecutionResult } from '../protocol';

export const sessionKnowledgeDistillerDefinition: SkillDefinition = {
  name: 'session-knowledge-distiller',
  displayName: '课堂知识蒸馏器',
  version: '1.0.0',
  category: 'analysis',
  description: '从课堂结构化知识状态、变化量和 wrapup 结果中提炼学习者可复用的知识背景增量。',
  status: 'working',
  inputSchema: {
    type: 'object',
    properties: {
      knowledgeState: { type: 'object', description: '当前课堂知识状态', required: true },
      knowledgeDelta: { type: 'object', description: '课堂知识变化量' },
      wrapup: { type: 'object', description: '课堂总结与评估' },
      taskContext: { type: 'object', description: '任务与路径上下文' },
      sessionEvidence: { type: 'object', description: '课堂证据摘要' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      conceptLedger: { type: 'array', description: '知识背景账本增量' },
      reusableFoundations: { type: 'array', description: '可复用基础' },
      blockedFoundations: { type: 'array', description: '不稳定前置' },
      transferSignals: { type: 'array', description: '迁移信号' }
    }
  },
  capabilities: ['session-knowledge-distillation', 'learner-background-update'],
  stats: { callCount: 0, successRate: 0, avgLatency: 0 }
};

export interface SessionKnowledgeDistillerInput {
  knowledgeState: Array<{ name: string; status: 'pending' | 'learning' | 'mastered' | 'review'; progress: number }>;
  knowledgeDelta?: {
    newlyMastered?: string[];
    movedToReview?: string[];
    stillLearning?: string[];
    unchangedMastered?: string[];
  } | null;
  wrapup?: any;
  taskContext?: {
    learningPathId?: string;
    taskId?: string;
  };
  sessionEvidence?: any;
}

export interface SessionKnowledgeDistillerOutput {
  conceptLedger: Array<{
    conceptKey: string;
    label: string;
    familiarity: 'seen' | 'practiced' | 'understood' | 'stable';
    transferReadiness: 'low' | 'medium' | 'high';
    misconceptionRisk: 'low' | 'medium' | 'high';
    sourcePaths: string[];
    sourceTasks: string[];
    evidenceCount: number;
  }>;
  reusableFoundations: string[];
  blockedFoundations: string[];
  transferSignals: Array<{
    conceptKey: string;
    label: string;
    readiness: 'low' | 'medium' | 'high';
    confidence: number;
  }>;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => normalizeText(value)).filter(Boolean)));
}

export async function sessionKnowledgeDistiller(input: SessionKnowledgeDistillerInput): Promise<SkillExecutionResult<SessionKnowledgeDistillerOutput>> {
  const startTime = Date.now();
  const knowledgeState = Array.isArray(input.knowledgeState) ? input.knowledgeState : [];
  const taskId = normalizeText(input.taskContext?.taskId);
  const pathId = normalizeText(input.taskContext?.learningPathId);

  const conceptLedger = knowledgeState.map((point) => {
    const familiarity: SessionKnowledgeDistillerOutput['conceptLedger'][number]['familiarity'] = point.status === 'mastered'
      ? 'stable'
      : point.status === 'review'
        ? 'understood'
        : point.status === 'learning'
          ? 'practiced'
          : 'seen';
    const transferReadiness: SessionKnowledgeDistillerOutput['transferSignals'][number]['readiness'] = point.status === 'mastered'
      ? 'high'
      : point.progress >= 60
        ? 'medium'
        : 'low';
    const misconceptionRisk: SessionKnowledgeDistillerOutput['conceptLedger'][number]['misconceptionRisk'] = point.status === 'review'
      ? 'high'
      : point.status === 'learning'
        ? 'medium'
        : 'low';
    return {
      conceptKey: point.name,
      label: point.name,
      familiarity,
      transferReadiness,
      misconceptionRisk,
      sourcePaths: pathId ? [pathId] : [],
      sourceTasks: taskId ? [taskId] : [],
      evidenceCount: Math.max(1, Math.round(Math.max(0, Math.min(100, point.progress)) / 25)),
    };
  });

  const reusableFoundations = uniqueStrings([
    ...(input.knowledgeDelta?.newlyMastered || []),
    ...conceptLedger.filter((item) => item.transferReadiness === 'high').map((item) => item.label),
  ]).slice(0, 16);

  const blockedFoundations = uniqueStrings([
    ...(input.knowledgeDelta?.movedToReview || []),
    ...conceptLedger.filter((item) => item.misconceptionRisk === 'high').map((item) => item.label),
  ]).slice(0, 16);

  const transferSignals = conceptLedger
    .filter((item) => item.transferReadiness !== 'low')
    .map((item) => ({
      conceptKey: item.conceptKey,
      label: item.label,
      readiness: item.transferReadiness,
      confidence: item.transferReadiness === 'high' ? 0.8 : 0.6,
    }))
    .slice(0, 16);

  return {
    success: true,
    output: {
      conceptLedger,
      reusableFoundations,
      blockedFoundations,
      transferSignals,
    },
    duration: Date.now() - startTime,
  };
}

export default sessionKnowledgeDistiller;
