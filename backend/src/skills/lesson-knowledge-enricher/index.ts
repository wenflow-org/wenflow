/**
 * Lesson Knowledge Enricher Skill
 *
 * 由 session-knowledge-distiller 与 dialogue-concept-extractor 合并而来（2026-07）。
 * 一节课结束后单次 LLM 调用，同时产出结构化知识台账增量与隐性概念线索，
 * 避免两份输入高度重叠的后台 skill 各自发起一次 LLM 请求。
 */
import { SkillDefinition, SkillExecutionResult } from '../protocol';
import { callPrompt } from '../../composers/prompt-composer';

export const lessonKnowledgeEnricherDefinition: SkillDefinition = {
  name: 'lesson-knowledge-enricher',
  displayName: '课后知识增强器',
  version: '1.0.0',
  category: 'analysis',
  description: '课后单次调用：从知识状态、wrapup、课堂证据与可见对话切片中提炼知识台账增量与隐性概念线索。',
  status: 'working',
  inputSchema: {
    type: 'object',
    properties: {
      knowledgeState: { type: 'array', description: '当前课堂知识状态', required: true },
      knowledgeDelta: { type: 'object', description: '课堂知识变化量' },
      wrapup: { type: 'object', description: '课堂总结与评估' },
      taskContext: { type: 'object', description: '任务与路径上下文' },
      sessionEvidence: { type: 'object', description: '课堂证据摘要' },
      visibleDialogueContext: { type: 'array', description: '可见课堂对话切片' },
      classroomEventHistory: { type: 'array', description: '课堂事件历史' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      conceptLedger: { type: 'array', description: '知识背景账本增量' },
      reusableFoundations: { type: 'array', description: '可复用基础' },
      blockedFoundations: { type: 'array', description: '不稳定前置' },
      transferSignals: { type: 'array', description: '迁移信号' },
      recurringConfusions: { type: 'array', description: '反复混淆模式' }
    }
  },
  capabilities: ['lesson-knowledge-enrichment', 'learner-background-update'],
  stats: { callCount: 0, successRate: 0, avgLatency: 0 }
};

export interface LessonKnowledgeEnricherInput {
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
  visibleDialogueContext?: Array<{ role: string; content: string }>;
  classroomEventHistory?: Array<Record<string, any>>;
}

export interface LessonKnowledgeEnricherOutput {
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
  recurringConfusions: Array<{
    conceptKey: string;
    label: string;
    pattern: string;
    confidence: number;
    count: number;
  }>;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => normalizeText(value)).filter(Boolean)));
}

function safeArray<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
}

function clampConfidence(value: unknown): number {
  return Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : 0.5;
}

function normalizeLedgerItem(item: any) {
  const familiarity = ['seen', 'practiced', 'understood', 'stable'].includes(item?.familiarity)
    ? item.familiarity
    : 'seen';
  const transferReadiness = ['low', 'medium', 'high'].includes(item?.transferReadiness)
    ? item.transferReadiness
    : 'low';
  const misconceptionRisk = ['low', 'medium', 'high'].includes(item?.misconceptionRisk)
    ? item.misconceptionRisk
    : 'low';

  return {
    conceptKey: normalizeText(item?.conceptKey) || normalizeText(item?.label) || '',
    label: normalizeText(item?.label) || normalizeText(item?.conceptKey) || '',
    familiarity,
    transferReadiness,
    misconceptionRisk,
    sourcePaths: safeArray(item?.sourcePaths).map((value) => normalizeText(value)).filter(Boolean),
    sourceTasks: safeArray(item?.sourceTasks).map((value) => normalizeText(value)).filter(Boolean),
    evidenceCount: Math.max(1, Number.isFinite(Number(item?.evidenceCount)) ? Number(item.evidenceCount) : 1),
  };
}

function normalizeTransferSignal(item: any) {
  const readiness = ['low', 'medium', 'high'].includes(item?.readiness)
    ? item?.readiness
    : 'low';
  return {
    conceptKey: normalizeText(item?.conceptKey) || normalizeText(item?.label) || '',
    label: normalizeText(item?.label) || normalizeText(item?.conceptKey) || '',
    readiness,
    confidence: clampConfidence(item?.confidence),
  };
}

function normalizeConfusionItem(item: any): LessonKnowledgeEnricherOutput['recurringConfusions'][number] | null {
  const conceptKey = normalizeText(item?.conceptKey) || normalizeText(item?.label);
  if (!conceptKey) return null;
  return {
    conceptKey,
    label: normalizeText(item?.label) || conceptKey,
    pattern: normalizeText(item?.pattern) || normalizeText(item?.evidence),
    confidence: clampConfidence(item?.confidence),
    count: Math.max(1, Number.isFinite(Number(item?.count)) ? Math.round(Number(item.count)) : 1),
  };
}

function buildFallback(input: LessonKnowledgeEnricherInput): LessonKnowledgeEnricherOutput {
  const knowledgeState = Array.isArray(input.knowledgeState) ? input.knowledgeState : [];
  const taskId = normalizeText(input.taskContext?.taskId);
  const pathId = normalizeText(input.taskContext?.learningPathId);

  const conceptLedger = knowledgeState.map((point) => {
    const familiarity: LessonKnowledgeEnricherOutput['conceptLedger'][number]['familiarity'] = point.status === 'mastered'
      ? 'stable'
      : point.status === 'review'
        ? 'understood'
        : point.status === 'learning'
          ? 'practiced'
          : 'seen';
    const transferReadiness: LessonKnowledgeEnricherOutput['conceptLedger'][number]['transferReadiness'] = point.status === 'mastered'
      ? 'high'
      : point.progress >= 60
        ? 'medium'
        : 'low';
    const misconceptionRisk: LessonKnowledgeEnricherOutput['conceptLedger'][number]['misconceptionRisk'] = point.status === 'review'
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

  return {
    conceptLedger,
    reusableFoundations: uniqueStrings([
      ...(input.knowledgeDelta?.newlyMastered || []),
      ...conceptLedger.filter((item) => item.transferReadiness === 'high').map((item) => item.label),
    ]).slice(0, 16),
    blockedFoundations: uniqueStrings([
      ...(input.knowledgeDelta?.movedToReview || []),
      ...conceptLedger.filter((item) => item.misconceptionRisk === 'high').map((item) => item.label),
    ]).slice(0, 16),
    transferSignals: conceptLedger
      .filter((item) => item.transferReadiness !== 'low')
      .map((item) => ({
        conceptKey: item.conceptKey,
        label: item.label,
        readiness: item.transferReadiness,
        confidence: item.transferReadiness === 'high' ? 0.8 : 0.6,
      }))
      .slice(0, 16),
    recurringConfusions: knowledgeState
      .filter((item) => item.status === 'review')
      .slice(0, 8)
      .map((item) => ({
        conceptKey: item.name,
        label: item.name,
        pattern: '课堂中该概念仍表现为回看或不稳定，需要后续继续作为重点复习项。',
        confidence: 0.65,
        count: 1,
      })),
  };
}

export async function lessonKnowledgeEnricher(input: LessonKnowledgeEnricherInput): Promise<SkillExecutionResult<LessonKnowledgeEnricherOutput>> {
  const startTime = Date.now();
  try {
    const result = await callPrompt<LessonKnowledgeEnricherInput, LessonKnowledgeEnricherOutput>({
      agentId: 'skill:lesson-knowledge-enricher',
      defaultSystemPrompt: '',
      requireActivePrompt: true,
      caller: { skillId: 'lesson-knowledge-enricher' },
            buildUserPayload: (payload) => payload,
      normalizeOutput: (parsed, payload) => {
        const base = buildFallback(payload);
        const obj = parsed && typeof parsed === 'object' ? parsed : {};
        const ledger = safeArray(obj.conceptLedger)
          .map(normalizeLedgerItem)
          .filter((item) => item.conceptKey && item.label);
        const signals = safeArray(obj.transferSignals)
          .map(normalizeTransferSignal)
          .filter((item) => item.conceptKey && item.label);
        const confusions = safeArray(obj.recurringConfusions)
          .map(normalizeConfusionItem)
          .filter((item): item is NonNullable<typeof item> => item !== null);
        return {
          conceptLedger: ledger.length > 0 ? ledger : base.conceptLedger,
          reusableFoundations: uniqueStrings(safeArray(obj.reusableFoundations)).length > 0
            ? uniqueStrings(safeArray(obj.reusableFoundations)).slice(0, 16)
            : base.reusableFoundations,
          blockedFoundations: uniqueStrings(safeArray(obj.blockedFoundations)).length > 0
            ? uniqueStrings(safeArray(obj.blockedFoundations)).slice(0, 16)
            : base.blockedFoundations,
          transferSignals: signals.length > 0 ? signals : base.transferSignals,
          recurringConfusions: confusions.length > 0 ? confusions : base.recurringConfusions,
        };
      },
      validateParsedOutput: (parsed) =>
        parsed && typeof parsed === 'object'
          ? { valid: true }
          : { valid: false, failureReason: 'LESSON_KNOWLEDGE_ENRICHER_OUTPUT_NOT_OBJECT' },
    }, input);

    if (!result.success || !result.output) {
      throw new Error(result.error?.message || 'LESSON_KNOWLEDGE_ENRICHER_FAILED');
    }

    return {
      success: true,
      output: result.output,
      duration: Date.now() - startTime,
      quality: 'model',
    };
  } catch {
    return {
      success: true,
      output: buildFallback(input),
      duration: Date.now() - startTime,
      cached: true,
      quality: 'fallback',
    };
  }
}

export default lessonKnowledgeEnricher;
