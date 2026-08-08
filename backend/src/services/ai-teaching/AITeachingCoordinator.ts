import { createHash, randomUUID } from 'crypto';
import { logger } from '../../utils/logger';
import prisma from '../../config/database';
import learningStateService, { LearningStateMetrics } from '../learning/learning-state.service';
import type { SessionWrapupArtifact, SessionWrapupSummary } from '../../skills/session-wrapup';
import { teachingTurnAgentDefinition, type TeachingTurnInput, type TeachingTurnOutput } from '../../skills/teaching-turn';
import { executeSkill, executeSkillWithResult, auxSkillDefinitionMap, sessionWrapupAgentDefinition, peerAgentDefinition } from '../../skills';
import { getEventBus } from '../../gateway/event-bus';
import { buildTeachingScenarioContext, type TeachingScenarioContext, type InteractionMetaRecord } from './TeachingContextBuilder';
import {
  teachingSessionRepository,
  TeachingSessionConflictError,
  type TeachingKnowledgePointState,
  type TeachingSessionMessage,
  type TeachingSessionOperationClaim,
  type TeachingSessionRecord,
} from './TeachingSessionRepository';
import { knowledgeStateService } from './KnowledgeStateService';
import { peerTriggerService } from './PeerTriggerService';
import { teachingContextCompressionService } from './TeachingContextCompressionService';
import { learnerSnapshotRefreshService } from '../learner/LearnerSnapshotRefreshService';
import { learnerSnapshotService } from '../learner/LearnerSnapshotService';
import { dashboardGuidanceSnapshotService } from '../learner/DashboardGuidanceSnapshotService';
import { learnerProjectionService } from '../learner/LearnerProjectionService';
import { assembleTeachingTurnChannels } from '../field-dispatcher';
import { createDomainEvent } from '../../events/contracts';
import { replanAdvisoryService, type ReplanAdvisory } from './ReplanAdvisoryService';
import { hasReliableSessionEvaluation, mergeFinalTeachingState } from './SessionFinalizationPolicy';
import { classifyFinalizationError } from './FinalizationErrors';
import { FinalizationLeaseGuard } from './FinalizationLeaseGuard';
import { memoryTraceService } from '../memory/memory-trace.service';

export type TeachingMode = 'tutor' | 'peer' | 'debate';
const AI_TEACHING_AGENT_ID = 'teaching-agent';

export interface KnowledgePointStatus {
  name: string;
  status: 'pending' | 'learning' | 'mastered' | 'review';
  progress: number;
}

export interface TeachingCheckpoint {
  id: string;
  type: 'single_choice' | 'multi_choice' | 'short_answer';
  title: string;
  question: string;
  options?: Array<{ id: string; text: string }>;
  allowSkip?: boolean;
  contextHint?: string;
}

export interface CheckpointSubmitPayload {
  selectedOptionIds?: string[];
  answerText?: string;
}

export interface CheckpointSubmitResult {
  passed: boolean;
  feedback: string;
  hint?: string;
  nextAction: 'continue' | 'review' | 'retry';
  revision: number;
}

export interface TeachingSessionStartInput {
  userId: string;
  taskId: string;
}

export interface TeachingOpening {
  message: string;
  question: string;
  quickReplies: Array<{ text: string }>;
  mode: 'self-assess' | 'predict' | 'example-first';
}

type SessionResumeMode = 'new' | 'resumed';

interface ProcessStudentMessageOptions {
  operationClaim?: TeachingSessionOperationClaim;
  checkpointId?: string;
  expectedRevision?: number;
  /** 前端交互特征（认知负荷量测 · 前端情报层）：随学生消息落库并注入教学上下文 */
  interactionMeta?: InteractionMetaRecord | null;
}

const RECOVERY_WINDOW_MS = 48 * 60 * 60 * 1000;

function buildSessionId(userId: string) {
  return `teaching_${userId}_${randomUUID()}`;
}

function requireTeachingRevision(revision: number | undefined): number {
  if (!Number.isInteger(revision) || Number(revision) < 0) {
    throw new TeachingSessionConflictError('缺少有效的课堂 revision', 'TEACHING_REVISION_REQUIRED');
  }
  return Number(revision);
}

function buildEndSessionRequestIdentity(endReason: string) {
  const requestJson = JSON.stringify({ action: 'end_only', endReason });
  return {
    requestJson,
    requestHash: createHash('sha256').update(requestJson).digest('hex')
  };
}

function toMessageRole(role: string): 'user' | 'assistant' | 'system' {
  if (role === 'assistant' || role === 'system') return role;
  return 'user';
}

function appendTimestamp(messages: Array<{ role: string; content: string; timestamp?: string; analysis?: any; checkpoint?: boolean; meta?: Record<string, number> | null }>): TeachingSessionMessage[] {
  return messages.map((message) => ({
    role: toMessageRole(message.role),
    content: message.content,
    timestamp: message.timestamp || new Date().toISOString(),
    ...(message.analysis ? { analysis: message.analysis } : {}),
    ...(message.checkpoint ? { checkpoint: true } : {}),
    ...(message.meta && Object.keys(message.meta).length > 0 ? { meta: message.meta } : {})
  }));
}

function normalizeKnowledgePoints(points: TeachingKnowledgePointState[]): KnowledgePointStatus[] {
  return points.map((point) => ({
    name: point.name,
    status: point.status,
    progress: point.progress,
  }));
}

function parseSessionArtifacts(teachingState: Record<string, any> | null | undefined) {
  return teachingState?.sessionArtifacts || {};
}

function getPendingCheckpoint(teachingState: Record<string, any> | null | undefined): TeachingCheckpoint | null {
  return teachingState?.pendingCheckpoint
    || parseSessionArtifacts(teachingState).pendingCheckpoint
    || null;
}

type LearnStage = 'opening' | 'teaching' | 'intervention' | 'checkpoint' | 'ready_to_close' | 'wrapup';

function mapOpeningModeToStage(openingMode: string | null | undefined): LearnStage {
  return openingMode ? 'opening' : 'opening';
}

function dedupeStringList(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => typeof value === 'string' ? value.trim() : '').filter(Boolean)));
}

function getLatestUserMessage(messages: TeachingSessionMessage[]): string {
  return [...messages].reverse().find((message) => message.role === 'user' && message.content?.trim())?.content || '';
}

function buildPathBackgroundContext(context: TeachingScenarioContext) {
  return {
    pathPosition: {
      pathTitle: context.pathProgress.pathTitle,
      pathSummary: context.pathProgress.pathSummary,
      currentMilestoneTitle: context.pathProgress.currentMilestoneTitle,
      currentStageNumber: context.pathProgress.currentStageNumber,
      currentTaskOrder: context.pathProgress.currentTaskOrder,
      totalTasksInMilestone: context.pathProgress.totalTasksInMilestone,
    },
    taskIntent: {
      subject: context.subject,
      topic: context.topic,
      taskTitle: context.taskTitle,
      taskDescription: context.taskDescription,
      acceptanceCriteria: context.currentTaskContext.acceptanceCriteria,
      taskType: context.taskType,
      taskGoal: context.cognitiveFrame.targetRelation,
      milestoneIntent: context.cognitiveFrame.milestoneIntent,
      transferGoal: context.cognitiveFrame.transferGoal,
    },
    knowledgeBoundary: {
      primaryConcepts: context.taskKnowledgeScope.primaryConcepts,
      prerequisiteConcepts: context.taskKnowledgeScope.prerequisiteConcepts,
      learningObjectives: context.taskProfile.learningObjectives,
      coreConcept: context.taskProfile.coreConcept,
    },
    cognitiveFrame: context.cognitiveFrame,
    teachingGuidance: context.teachingStrategyGuidance,
  };
}

function buildLearnerStateContext(
  context: TeachingScenarioContext,
  teachingState: Record<string, any> | null | undefined,
  latestAnalysis?: any,
) {
  const previous = teachingState?.learnerStateContext || {};
  return {
    currentUnderstanding: latestAnalysis?.understanding ?? previous.currentUnderstanding ?? null,
    currentCognitiveLevel: latestAnalysis?.cognitiveLevel || previous.currentCognitiveLevel || null,
    currentConfusionPoints: latestAnalysis?.confusionPoints || previous.currentConfusionPoints || [],
    emotionalState: latestAnalysis?.emotionalState || previous.emotionalState || null,
    engagement: latestAnalysis?.engagement ?? previous.engagement ?? null,
    struggleDetected: previous.struggleDetected === true,
  };
}

function extractTeachingStateMetrics(teachingState: Record<string, any> | null | undefined): LearningStateMetrics | null {
  return learningStateService.coerceMetrics(teachingState);
}

function deriveTeachingRuntimeSignals(context: TeachingScenarioContext) {
  const lss = Number(context.learningState?.lss ?? 0);
  const ktl = Number(context.learningState?.ktl ?? 0);
  const lf = Number(context.learningState?.lf ?? 0);
  const lsb = Number(context.learningState?.lsb ?? 0);

  const recommendedPacing: 'slow' | 'moderate' | 'fast' = lf >= 6 || lss >= 6
    ? 'slow'
    : ktl >= 5 && lf <= 3 && lss <= 4
      ? 'fast'
      : 'moderate';

  const recentTrend: 'improving' | 'stable' | 'declining' = lf >= 6 || lsb < 0
    ? 'declining'
    : ktl >= 6 && lf <= 3 && lss <= 4
      ? 'improving'
      : 'stable';

  const confidenceLevel: 'confident' | 'moderate' | 'anxious' = lsb < 0 || lf >= 6
    ? 'anxious'
    : ktl >= 6 && lf <= 3 && lss <= 4
      ? 'confident'
      : 'moderate';

  return {
    confidenceLevel,
    recentTrend,
    recommendedPacing,
  };
}

function buildTeachingControlContext(
  stage: LearnStage,
  context: TeachingScenarioContext,
  learnerStateContext: Record<string, any>,
  sessionArtifacts: Record<string, any>,
) {
  const canTriggerPeer = stage === 'intervention' || learnerStateContext.struggleDetected === true;
  const runtimeSignals = deriveTeachingRuntimeSignals(context);
  const recommendedApproach = runtimeSignals.confidenceLevel === 'anxious'
    ? '先给低压切入口，确认学生能跟上后再继续推进'
    : context.taskType === 'project' || context.taskType === 'practice'
      ? '以小步执行和即时反馈推进'
      : context.taskProfile.knowledgeType === 'procedural'
        ? '先示范步骤，再引导学生完成关键一步'
        : context.taskProfile.knowledgeType === 'conceptual'
          ? '先澄清关系，再用贴题例子验证'
          : context.taskProfile.knowledgeType === 'metacognitive'
            ? '先让学生说出判断与策略，再帮助其澄清和校正'
            : '先简洁解释，再做一次小检核';
  return {
    priority: stage === 'opening'
      ? '定位首个焦点知识点'
      : stage === 'intervention'
        ? '先脱离卡点并恢复推进'
        : stage === 'ready_to_close'
          ? '确认本任务已达到收束条件'
        : stage === 'checkpoint'
          ? '验证当前知识点是否真正建立'
          : stage === 'wrapup'
            ? '收束当前课堂并准备评估'
            : '围绕当前焦点知识点继续推进',
    recommendedApproach,
    targetDepth: context.teachingStrategyGuidance.targetDepth,
    allowPrerequisiteRecovery: true,
    allowPeerSupport: canTriggerPeer,
    allowCheckpoint: stage === 'checkpoint' || stage === 'teaching' || stage === 'ready_to_close',
    nearWrapup: sessionArtifacts.endReason === 'completion-candidate' || stage === 'ready_to_close' || stage === 'wrapup',
  };
}

function buildClassroomEvent(
  type: string,
  summary: string,
  payload: Record<string, any> = {},
) {
  return {
    type,
    summary,
    occurredAt: new Date().toISOString(),
    payload,
  };
}

function detectEndIntent(message: string) {
  const text = (message || '').trim();
  if (!text) return { isEndIntent: false, reason: '' };

  const patterns = [
    /结束(本节|这节|课程|课堂|学习)/,
    /到此结束/,
    /现在结束/,
    /请.*结束/,
    /标记.*结束/,
    /本节课结束/,
    /停止学习/,
    /不学了/,
    /结束吧/,
  ];

  if (patterns.some((pattern) => pattern.test(text))) {
    return { isEndIntent: true, reason: '检测到显式结束课堂意图' };
  }

  return { isEndIntent: false, reason: '' };
}

function determineNextStage(params: {
  currentStage: LearnStage;
  teachingOutput: TeachingTurnOutput;
  peerTriggered: boolean;
  learnerMessage: string;
}): { stage: LearnStage; reason: string } {
  const { currentStage, teachingOutput, peerTriggered, learnerMessage } = params;
  const understanding = Number(teachingOutput.analysis?.understanding ?? 0.5);
  const emotion = teachingOutput.analysis?.emotionalState;
  const confusionPoints = Array.isArray(teachingOutput.analysis?.confusionPoints)
    ? teachingOutput.analysis.confusionPoints
    : [];
  const completionCandidate = teachingOutput.control?.isCompletionCandidate === true;

  if (completionCandidate) {
    return { stage: 'ready_to_close', reason: '检测到完成候选，当前任务已接近收束' };
  }

  if (peerTriggered || understanding < 0.35 || emotion === 'frustrated' || confusionPoints.length >= 2) {
    return { stage: 'intervention', reason: '学生出现明显卡点，进入干预阶段' };
  }

  if (currentStage === 'opening' && learnerMessage.trim()) {
    return { stage: 'teaching', reason: '已完成开场定位，进入正常推进' };
  }

  if (currentStage === 'intervention' && understanding >= 0.5) {
    return { stage: 'teaching', reason: '卡点已缓解，回到授课推进' };
  }

  if ((currentStage === 'checkpoint' || currentStage === 'ready_to_close') && understanding < 0.5) {
    return { stage: 'teaching', reason: '检核信号不足，回到授课推进' };
  }

  return { stage: currentStage === 'opening' ? 'teaching' : currentStage, reason: '保持当前教学推进阶段' };
}

function buildClassroomContext(params: {
  previousState: Record<string, any> | null | undefined;
  stage: LearnStage;
  stageReason: string;
  teachingOutput?: TeachingTurnOutput | null;
  learnerMessage: string;
  context: TeachingScenarioContext;
  knowledgeState: TeachingKnowledgePointState[];
  learnerStateContext: Record<string, any>;
  peerTriggered?: boolean;
  peerMessage?: string;
}) {
  const {
    previousState,
    stage,
    stageReason,
    teachingOutput,
    learnerMessage,
    context,
    knowledgeState,
    learnerStateContext,
    peerTriggered,
  } = params;
  const previousClassroom = previousState?.classroomContext || {};
  const currentFocus = teachingOutput?.knowledge?.currentPoint
    || previousClassroom?.focus?.currentKnowledgePoint
    || knowledgeState.find((point) => point.status === 'learning')?.name
    || knowledgeState[0]?.name
    || context.taskProfile.coreConcept
    || null;
  const progressed = knowledgeState.filter((point) => point.progress > 0).map((point) => point.name);
  const pending = knowledgeState.filter((point) => point.status === 'pending').map((point) => point.name);
  const recovering = knowledgeState.filter((point) => point.status === 'review').map((point) => point.name);
  const mastered = knowledgeState.filter((point) => point.status === 'mastered').map((point) => point.name);
  const confusionPoints = learnerStateContext.currentConfusionPoints || [];

  return {
    stage: {
      current: stage,
      goal: stage === 'opening'
        ? '完成本节课切入点定位'
        : stage === 'intervention'
          ? '先处理当前卡点并恢复可推进状态'
          : stage === 'ready_to_close'
            ? '确认本任务已达到结束课堂条件'
          : stage === 'checkpoint'
            ? '验证当前焦点知识点是否真正建立'
            : stage === 'wrapup'
              ? '完成课堂收束并准备课后评估'
              : '围绕焦点知识点继续推进理解与应用',
      reason: stageReason,
    },
    focus: {
      currentKnowledgePoint: currentFocus,
      linkedTaskGoal: context.cognitiveFrame.targetRelation,
      latestLearnerMessage: learnerMessage,
    },
    progress: {
      progressedKnowledgePoints: dedupeStringList(progressed),
      pendingKnowledgePoints: dedupeStringList(pending),
      recoveringKnowledgePoints: dedupeStringList(recovering),
      initiallyMasteredKnowledgePoints: dedupeStringList(mastered),
    },
    risk: {
      confusionPoints,
      emotionalState: learnerStateContext.emotionalState || null,
      engagement: learnerStateContext.engagement ?? null,
      struggleDetected: learnerStateContext.struggleDetected === true,
      peerSupportActive: peerTriggered === true,
    },
    nextStep: {
      suggestedAction: stage === 'opening'
        ? '继续定位首个焦点知识点'
        : stage === 'intervention'
          ? '先降阶讲解或触发伴学'
          : stage === 'ready_to_close'
            ? '结束课堂并进入评估'
          : stage === 'checkpoint'
            ? '组织验证性追问或小检核'
            : stage === 'wrapup'
              ? '准备结束课堂并进入评估'
              : '继续围绕焦点知识点推进',
    },
  };
}

function buildTeachingStateWithArtifacts(
  teachingState: Record<string, any> | null | undefined,
  sessionArtifacts: Record<string, any>
) {
  return {
    ...(teachingState || {}),
    sessionArtifacts,
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number, errorMessage: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(errorMessage)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function computeEffectiveDurationMinutes(session: TeachingSessionRecord) {
  const rawDuration = Math.max(1, Math.round((Date.now() - session.startTime.getTime()) / 60000));
  const sessionArtifacts = parseSessionArtifacts(session.teachingState);
  const pausedDurationMs = Number(sessionArtifacts.pausedDurationMs || 0);
  if (!Number.isFinite(pausedDurationMs) || pausedDurationMs <= 0) {
    return rawDuration;
  }

  return Math.max(1, Math.round((Date.now() - session.startTime.getTime() - pausedDurationMs) / 60000));
}

function buildRecoveredOpening(session: TeachingSessionRecord): TeachingOpening {
  return {
    message: `已为你恢复这节关于 **${session.topic}** 的课程进度，我们从你上次离开的地方继续。`,
    question: '准备好了的话，我们继续刚才的内容。',
    quickReplies: [{ text: '继续上次进度' }, { text: '先回顾一下' }, { text: '从当前焦点继续' }],
    mode: 'self-assess',
  };
}

function cloneKnowledgePoints(points: TeachingKnowledgePointState[] | null | undefined): TeachingKnowledgePointState[] {
  if (!Array.isArray(points)) return [];
  return points
    .filter((point) => point && typeof point.name === 'string' && point.name.trim())
    .map((point) => ({
      name: point.name.trim(),
      status: point.status,
      progress: Number.isFinite(point.progress) ? Number(point.progress) : 0,
    }));
}

/** 合并后知识点的总数上限（防止模型每轮新增点导致无限膨胀） */
const MAX_KNOWLEDGE_POINTS = 12;

function normalizeFrozenKnowledgeState(
  frozenPoints: TeachingKnowledgePointState[] | null | undefined,
  currentPoints: TeachingKnowledgePointState[] | null | undefined,
): TeachingKnowledgePointState[] {
  const frozen = cloneKnowledgePoints(frozenPoints);
  const current = cloneKnowledgePoints(currentPoints);
  if (frozen.length === 0) {
    return current.slice(0, MAX_KNOWLEDGE_POINTS);
  }

  const frozenMap = new Map(
    frozen.map((point) => [point.name.trim().toLowerCase(), point])
  );
  const currentMap = new Map(
    current.map((point) => [point.name.trim().toLowerCase(), point])
  );

  const merged = frozen.map((point, index) => {
    const currentPoint = currentMap.get(point.name.trim().toLowerCase());
    return {
      name: point.name,
      status: currentPoint?.status || point.status || (index === 0 ? 'learning' : 'pending'),
      progress: currentPoint ? Math.max(point.progress || 0, currentPoint.progress || 0) : (point.progress || 0),
    };
  });

  // 保留模型/合并中新出现的点（不在种子集合里）：追加到末尾，避免新发现被静默丢弃
  for (const currentPoint of current) {
    if (!frozenMap.has(currentPoint.name.trim().toLowerCase())) {
      merged.push({ ...currentPoint });
    }
    if (merged.length >= MAX_KNOWLEDGE_POINTS) break;
  }
  return merged;
}

function isKnowledgeStateComplete(points: TeachingKnowledgePointState[] | null | undefined): boolean {
  return Array.isArray(points)
    && points.length > 0
    && points.every((point) => point.status === 'mastered');
}

function hasPrematureNextStepLanguage(reply: string): boolean {
  if (!reply || typeof reply !== 'string') return false;
  const text = reply.trim();
  if (!text) return false;

  const patterns = [
    /进入下一环节/,
    /进入下一个环节/,
    /进入下一步任务/,
    /进入下一个任务/,
    /接下来.*下一环节/,
    /接下来.*下一个任务/,
    /后续.*下一个任务/,
  ];

  return patterns.some((pattern) => pattern.test(text));
}

function buildFallbackOpening(
  context: TeachingScenarioContext,
  openingMode: TeachingOpening['mode']
): TeachingOpening {
  const taskTitle = context.taskTitle || context.topic || '当前任务';
  const coreConcept = context.taskProfile.coreConcept || context.taskProfile.linkedConceptName || context.pathProgress.currentMilestoneTitle;
  const acceptanceCriteria = context.currentTaskContext.acceptanceCriteria || context.currentTaskContext.description || context.taskDescription || '';
  const shortGoal = acceptanceCriteria.trim() || `先把 ${taskTitle} 这一步做清楚`;

  if (openingMode === 'example-first') {
    return {
      mode: openingMode,
      message: `这节课我们先不铺开讲，直接拿 **${taskTitle}** 里最小的一步开始。`,
      question: coreConcept
        ? `如果你现在就动手做，围绕“${coreConcept}”你会先观察哪一点？`
        : `如果你现在就动手做，你觉得这一步最先该确认什么？`,
      quickReplies: [
        { text: '先看字段或输入差异' },
        { text: '先拆成最小步骤' },
        { text: '先给我一个示范' },
      ],
    };
  }

  if (openingMode === 'predict') {
    return {
      mode: openingMode,
      message: `开始之前，先做一个快速判断，看看你对 **${taskTitle}** 的直觉在哪里。`,
      question: coreConcept
        ? `围绕“${coreConcept}”，你猜这一步最容易出错的是哪里？`
        : `你猜这一步最容易卡住的地方是什么？`,
      quickReplies: [
        { text: '我大概知道风险点' },
        { text: '我只能猜个方向' },
        { text: '我想先听你拆解' },
      ],
    };
  }

  return {
    mode: openingMode,
    message: `开始前先快速校准一下，我们这节会聚焦 **${taskTitle}**，目标是 ${shortGoal}。`,
    question: '你现在更接近哪种状态？',
    quickReplies: [
      { text: '我知道大概要做什么' },
      { text: '我只有模糊感觉' },
      { text: '我想先看一个例子' },
    ],
  };
}

function computeKnowledgeDelta(
  initialPoints: TeachingKnowledgePointState[],
  finalPoints: TeachingKnowledgePointState[]
) {
  const initialMap = new Map(initialPoints.map((point) => [point.name, point]));
  const finalMap = new Map(finalPoints.map((point) => [point.name, point]));
  const names = Array.from(new Set([...initialMap.keys(), ...finalMap.keys()]));

  const newlyMastered: string[] = [];
  const movedToReview: string[] = [];
  const stillLearning: string[] = [];
  const unchangedMastered: string[] = [];

  for (const name of names) {
    const before = initialMap.get(name);
    const after = finalMap.get(name);
    if (!after) continue;

    if (after.status === 'mastered') {
      if (!before || before.status !== 'mastered') {
        newlyMastered.push(name);
      } else {
        unchangedMastered.push(name);
      }
      continue;
    }

    if (after.status === 'review' && before?.status !== 'review') {
      movedToReview.push(name);
      continue;
    }

    if (after.status === 'learning' || after.status === 'pending') {
      stillLearning.push(name);
    }
  }

  return {
    newlyMastered,
    movedToReview,
    stillLearning,
    unchangedMastered,
  };
}

function computeSessionEvidence(session: TeachingSessionRecord) {
  // 排除检查点合成消息（非真实学生话语），避免污染理解/参与度统计
  const analyzedMessages = session.messages.filter((message) => !!message.analysis && !message.checkpoint);
  const avg = (values: number[]) => values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const understandingScores = analyzedMessages
    .map((message) => Number(message.analysis?.understanding))
    .filter((value) => Number.isFinite(value));
  const engagementScores = analyzedMessages
    .map((message) => Number(message.analysis?.engagement))
    .filter((value) => Number.isFinite(value));

  const confusionCounter = new Map<string, number>();
  const cognitiveCounter = new Map<string, number>();
  const emotionalSignals = {
    positive: 0,
    neutral: 0,
    frustrated: 0,
    confused: 0,
  };

  for (const message of analyzedMessages) {
    const confusionPoints = Array.isArray(message.analysis?.confusionPoints)
      ? message.analysis?.confusionPoints
      : [];
    for (const point of confusionPoints) {
      if (!point || typeof point !== 'string') continue;
      confusionCounter.set(point, (confusionCounter.get(point) || 0) + 1);
    }

    const level = typeof message.analysis?.cognitiveLevel === 'string'
      ? message.analysis.cognitiveLevel
      : null;
    if (level) {
      cognitiveCounter.set(level, (cognitiveCounter.get(level) || 0) + 1);
    }

    const emotion = typeof message.analysis?.emotionalState === 'string'
      ? message.analysis.emotionalState
      : null;
    if (emotion === 'positive' || emotion === 'neutral' || emotion === 'frustrated' || emotion === 'confused') {
      emotionalSignals[emotion] += 1;
    }
  }

  const dominantCognitiveLevel = Array.from(cognitiveCounter.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const lastCognitiveLevel = [...analyzedMessages].reverse().find((message) => !!message.analysis?.cognitiveLevel)?.analysis?.cognitiveLevel || null;
  const topConfusionPoints = Array.from(confusionCounter.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([label]) => label);
  const completionCandidateSeen = !!session.messages.find((message) => message.analysis?.completionCandidate === true)
    || !!(session.teachingState as any)?.completionCandidate;

  return {
    turnCount: session.messages.filter((message) => message.role === 'user').length,
    avgUnderstanding: avg(understandingScores),
    avgEngagement: avg(engagementScores),
    dominantCognitiveLevel,
    lastCognitiveLevel,
    topConfusionPoints,
    emotionalSignals,
    completionCandidateSeen,
  };
}

async function buildTeachingTurnInput(
  session: TeachingSessionRecord,
  context: TeachingScenarioContext
): Promise<TeachingTurnInput> {
  const compression = teachingContextCompressionService.compress(session.messages);
  const teachingState = session.teachingState || {};
  const classroomContext = teachingState.classroomContext || {};
  const learnerStateContext = teachingState.learnerStateContext || buildLearnerStateContext(context, teachingState);
  const teachingControlContext = teachingState.teachingControlContext || buildTeachingControlContext(
    (classroomContext?.stage?.current as LearnStage) || 'opening',
    context,
    learnerStateContext,
    parseSessionArtifacts(teachingState),
  );
  const classroomEventContext = {
    recentEvents: Array.isArray(teachingState.classroomEventHistory)
      ? teachingState.classroomEventHistory.slice(-5)
      : [],
  };

  const scenario: TeachingTurnInput['scenario'] = {
    subject: context.subject,
    topic: context.topic,
    taskTitle: context.taskTitle,
    taskDescription: context.taskDescription,
    taskType: context.taskType,
    taskProfile: context.taskProfile,
    currentTaskContext: context.currentTaskContext,
    cognitiveFrame: context.cognitiveFrame,
    teachingStrategyGuidance: context.teachingStrategyGuidance,
    pathTitle: context.pathProgress.pathTitle,
    pathSummary: context.pathProgress.pathSummary,
    currentMilestoneTitle: context.pathProgress.currentMilestoneTitle,
    currentStageNumber: context.pathProgress.currentStageNumber,
    currentTaskOrder: context.pathProgress.currentTaskOrder,
    totalTasksInMilestone: context.pathProgress.totalTasksInMilestone,
    taskKnowledgeScope: context.taskKnowledgeScope,
    pathBackgroundContext: buildPathBackgroundContext(context),
    learningSignal: context.learningSignal,
    lastLessonRecap: context.lastLessonRecap,
    contextCompression: compression.compressed ? {
      enabled: true,
      estimatedTokens: compression.estimatedTokens,
      triggerTokens: compression.triggerTokens,
      recap: compression.recap,
    } : undefined,
  };

  // L2 声明化装配（只读对账）：状态池形状由 sandbox-resolver 的 teaching provider 声明，
  // 本链只提供原始 context。缺键打 warn，不阻断。
  try {
    const { checkAgentSandboxRefsFromContext } = await import('../sandbox-resolver.service');
    await checkAgentSandboxRefsFromContext(
      'teaching-turn',
      'teaching',
      {
        sessionMessages: session.messages.map((item) => ({ role: item.role, content: item.content })),
        sessionId: session.id,
        mode: session.mode,
        topic: context.topic,
        learnerProjection: context.learnerProjection,
        knowledgeState: session.knowledgeState,
        classroomContext,
        teachingControlContext,
        scenario: scenario as Record<string, unknown>,
        interactionProfile: (context as any).interactionProfile,
      },
      { warnContext: { sessionId: session.id } }
    );
  } catch {
    // 对账失败不影响主流程
  }

  // 配置式输入通道（P2 声明 + 本链运行时消费）：routings 表 teaching-agent 通道行抽值优先，
  // 缺失回退既有组装；visibleDialogueContext 保持 {role, content} 映射语义
  const { channels } = await assembleTeachingTurnChannels({ session, teachingState, context }).catch(() => ({ channels: {}, skipped: [] }));
  const configuredVisible = Array.isArray(channels['visibleDialogueContext'])
    ? channels['visibleDialogueContext']
        .filter((item: any) => item && (typeof item.role === 'string' || typeof item.role === 'number'))
        .map((item: any) => ({ role: item.role, content: typeof item.content === 'string' ? item.content : '' }))
    : null;

  return {
    messages: compression.messages,
    learner: channels['learner.learnerProjection'] || context.learnerProjection,
    scenario,
    classroomContext: channels['classroomContext'] || classroomContext,
    classroomEventContext,
    visibleDialogueContext: configuredVisible || session.messages.map((item) => ({
      role: item.role,
      content: item.content,
    })),
    knowledge: {
      points: (channels['knowledge.state'] && Array.isArray(channels['knowledge.state'])
        ? channels['knowledge.state']
        : session.knowledgeState),
    },
    controls: {
      mode: session.mode as TeachingMode,
      teachingControlContext: channels['controls.teachingControlContext'] || teachingControlContext,
    }
  };
}

function normalizeConcept(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized || null;
}

function pruneOverlyBroadCoreConceptPoints(
  points: TeachingKnowledgePointState[],
  coreConcept: string | null,
): TeachingKnowledgePointState[] {
  const normalizedCoreConcept = normalizeConcept(coreConcept);
  const normalizedPoints = points.filter((point) => normalizeConcept(point.name));

  if (!normalizedCoreConcept) {
    return normalizedPoints;
  }

  const hasFinerPoint = normalizedPoints.some((point) => normalizeConcept(point.name) !== normalizedCoreConcept);
  if (!hasFinerPoint) {
    return normalizedPoints;
  }

  const filtered = normalizedPoints.filter((point) => normalizeConcept(point.name) !== normalizedCoreConcept);
  return filtered.length > 0 ? filtered : normalizedPoints;
}

function reconcileTeachingKnowledgeState(
  context: TeachingScenarioContext,
  output: TeachingTurnOutput,
  existingPoints: TeachingKnowledgePointState[]
) {
  const coreConcept = context.taskProfile.coreConcept || context.taskProfile.linkedConceptName || null;
  const filteredOutputPoints = pruneOverlyBroadCoreConceptPoints(output.knowledge.points, coreConcept).slice(0, 5);
  const filteredExistingPoints = pruneOverlyBroadCoreConceptPoints(existingPoints, coreConcept);
  const normalizedCurrentPoint = normalizeConcept(output.knowledge.currentPoint || null);
  const currentPointExists = !!normalizedCurrentPoint && [
    ...filteredOutputPoints,
    ...filteredExistingPoints,
  ].some((point) => normalizeConcept(point.name) === normalizedCurrentPoint);

  const currentPoint = currentPointExists
    ? output.knowledge.currentPoint
    : filteredOutputPoints[0]?.name || filteredExistingPoints[0]?.name || null;

  return {
    teachingOutput: {
      ...output,
      knowledge: {
        ...output.knowledge,
        currentPoint,
        points: filteredOutputPoints,
      }
    } as TeachingTurnOutput,
    existingPoints: filteredExistingPoints,
  };
}

function extractTeachingOutput(agentOutput: any): TeachingTurnOutput {
  return (
    agentOutput?.internal?.ext?.teachingTurnOutcome?.artifact
    || agentOutput?.internal?.ext?.teaching
  ) as TeachingTurnOutput;
}

function extractPeerDebug(agentOutput: any) {
  return agentOutput?.internal?.ext?.peer || null;
}

function extractTeachingPromptDebug(agentOutput: any) {
  return agentOutput?.internal?.ext?.promptDebug || null;
}

export class AITeachingOrchestrator {
  private idleTimeoutMs = 120 * 60 * 1000;
  private idleTimer: NodeJS.Timeout | null = null;
  private idleCheckInFlight: Promise<void> | null = null;
  private stopping = false;

  constructor() {
    this.start();
  }

  start(): void {
    if (this.idleTimer) return;
    this.stopping = false;
    this.idleTimer = setInterval(() => {
      if (this.stopping || this.idleCheckInFlight) return;
      const run = this.checkIdleSessions();
      this.idleCheckInFlight = run;
      void run.catch(error => {
        logger.warn('[AITeaching] idle session scan failed', {
          error: error instanceof Error ? error.message : String(error)
        });
      }).finally(() => {
        if (this.idleCheckInFlight === run) this.idleCheckInFlight = null;
      });
    }, 60 * 1000);
    this.idleTimer.unref?.();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.idleTimer) clearInterval(this.idleTimer);
    this.idleTimer = null;
    await this.idleCheckInFlight;
  }

  async startSession(input: TeachingSessionStartInput): Promise<{
    sessionId: string;
    subject: string;
    topic: string;
    startTime: Date;
    welcomeMessage: string;
    opening: TeachingOpening;
    knowledgePoints: KnowledgePointStatus[];
    mode: SessionResumeMode;
    revision: number;
  }> {
    const context = await buildTeachingScenarioContext(input.userId, input.taskId, null);
    const seededKnowledgeState = cloneKnowledgePoints(context.taskKnowledgeSeeds);
    // 记忆引擎 M2：惰性检查到期复习点，作为 review 状态注入本节课知识看板（旧知唤醒，
    // best-effort：查询失败不阻断开课）
    try {
      const dueTraces = await memoryTraceService.getDueTraces(input.userId, { limit: 2 });
      if (dueTraces.length > 0) {
        const existingKeys = new Set(seededKnowledgeState.map((point) => point.name));
        for (const trace of dueTraces) {
          if (existingKeys.has(trace.conceptKey)) continue;
          seededKnowledgeState.push({
            name: trace.conceptKey,
            status: 'review',
            progress: Math.round(trace.retention * 100),
          });
          existingKeys.add(trace.conceptKey);
          logger.info('[AITeaching] 到期旧知唤醒注入看板', {
            userId: input.userId,
            taskId: input.taskId,
            conceptKey: trace.conceptKey,
            retention: trace.retention,
          });
        }
      }
    } catch (error) {
      logger.warn('[AITeaching] 到期复习点查询失败，跳过注入', {
        userId: input.userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    const sessionId = buildSessionId(input.userId);
    const reservation = await teachingSessionRepository.reserve({
      id: sessionId,
      userId: input.userId,
      taskId: context.taskId,
      learningPathId: context.learningPathId,
      milestoneId: context.milestoneId,
      subject: context.subject,
      topic: context.topic,
      taskType: context.taskType,
      mode: 'tutor',
      messages: [],
      knowledgeState: seededKnowledgeState,
      teachingState: null,
    }, RECOVERY_WINDOW_MS);

    if (!reservation.created) {
      if (reservation.session.status === 'initializing' || reservation.session.status === 'finalizing') {
        throw new TeachingSessionConflictError('课堂正在启动或结束，请稍后重试', 'TEACHING_SESSION_BUSY');
      }

      const claim = await teachingSessionRepository.claimOperation(
        reservation.session.id,
        'resume',
        ['active', 'paused', 'timeout']
      );
      let committed = false;
      try {
        const previousSession = claim.session;
        const sessionArtifacts = parseSessionArtifacts(previousSession.teachingState);
        const resumedContext = await buildTeachingScenarioContext(input.userId, input.taskId, previousSession);
        const effectiveInitialKnowledgeState = cloneKnowledgePoints(
          Array.isArray(sessionArtifacts.initialKnowledgeState) && sessionArtifacts.initialKnowledgeState.length > 0
            ? sessionArtifacts.initialKnowledgeState
            : resumedContext.taskKnowledgeSeeds
        );
        const resumedKnowledgeState = normalizeFrozenKnowledgeState(
          effectiveInitialKnowledgeState,
          previousSession.knowledgeState,
        );
        const wasPausedAt = typeof sessionArtifacts.pausedAt === 'string'
          ? new Date(sessionArtifacts.pausedAt).getTime()
          : null;
        const additionalPausedMs = wasPausedAt ? Math.max(0, Date.now() - wasPausedAt) : 0;
        const resumedTeachingState = buildTeachingStateWithArtifacts(previousSession.teachingState, {
          ...sessionArtifacts,
          initialKnowledgeState: effectiveInitialKnowledgeState,
          pathBackgroundContext: sessionArtifacts.pathBackgroundContext || buildPathBackgroundContext(resumedContext),
          pausedAt: null,
          pauseReason: null,
          pausedDurationMs: Math.max(0, Number(sessionArtifacts.pausedDurationMs || 0)) + additionalPausedMs,
          resumedAt: new Date().toISOString(),
        });

        await teachingSessionRepository.commitTurnState(previousSession.id, claim.operationId, {
          messages: previousSession.messages,
          knowledgeState: resumedKnowledgeState,
          teachingState: resumedTeachingState,
          allowedStatuses: ['active', 'paused', 'timeout']
        });
        committed = true;

        const opening = buildRecoveredOpening(previousSession);
        return {
          sessionId: previousSession.id,
          subject: previousSession.subject,
          topic: previousSession.topic,
          startTime: previousSession.startTime,
          welcomeMessage: previousSession.messages[0]?.content || `${opening.message}\n\n${opening.question}`,
          opening,
          knowledgePoints: normalizeKnowledgePoints(resumedKnowledgeState),
          mode: 'resumed',
          revision: previousSession.revision + 1,
        };
      } finally {
        if (!committed) {
          await teachingSessionRepository.releaseOperation(claim.session.id, claim.operationId);
        }
      }
    }

    const operationId = reservation.operationId as string;
    try {
      const opening = await this.generateOpening(context);
      const welcomeMessage = `${opening.message}\n\n${opening.question}`;
      const messages: TeachingSessionMessage[] = [
        {
          role: 'assistant',
          content: welcomeMessage,
          timestamp: new Date().toISOString(),
          analysis: {
            openingMode: opening.mode,
            quickReplies: opening.quickReplies,
          }
        }
      ];
      const teachingState = {
        ...(context.learningState || {}),
        learnerStateContext: buildLearnerStateContext(context, null, {
          cognitiveLevel: null,
          understanding: null,
          confusionPoints: [],
          emotionalState: null,
          engagement: null,
        }),
        classroomContext: {
          stage: {
            current: mapOpeningModeToStage(opening.mode),
            goal: '完成本节课切入点定位',
            reason: '新课堂启动，进入开场定位',
          },
          focus: {
            currentKnowledgePoint: null,
            linkedTaskGoal: context.cognitiveFrame.targetRelation,
            latestLearnerMessage: '',
          },
          progress: {
            progressedKnowledgePoints: [],
            pendingKnowledgePoints: [],
            recoveringKnowledgePoints: [],
            initiallyMasteredKnowledgePoints: [],
          },
          risk: {
            confusionPoints: [],
            emotionalState: null,
            engagement: null,
            struggleDetected: false,
            peerSupportActive: false,
          },
          nextStep: {
            suggestedAction: '通过开场交互确认学生切入点',
          },
        },
        classroomEventHistory: [
          buildClassroomEvent('session-started', '课堂已开始，进入开场定位', {
            openingMode: opening.mode,
            taskTitle: context.taskTitle,
          }),
        ],
        stageHistory: [
          {
            stage: mapOpeningModeToStage(opening.mode),
            reason: '新课堂启动，进入开场定位',
            enteredAt: new Date().toISOString(),
          },
        ],
        teachingControlContext: buildTeachingControlContext(
          mapOpeningModeToStage(opening.mode),
          context,
          buildLearnerStateContext(context, null),
          {},
        ),
        sessionArtifacts: {
          initialKnowledgeState: seededKnowledgeState,
          pathBackgroundContext: buildPathBackgroundContext(context),
          endReason: null,
        },
      };
      const session = await teachingSessionRepository.completeInitialization(sessionId, operationId, {
        messages,
        knowledgeState: seededKnowledgeState,
        teachingState
      });

      logger.info('[AITeaching] 新教学会话已创建', {
        sessionId: session.id,
        userId: input.userId,
        taskId: input.taskId,
      });

      return {
        sessionId: session.id,
        subject: session.subject,
        topic: session.topic,
        startTime: session.startTime,
        welcomeMessage,
        opening,
        knowledgePoints: normalizeKnowledgePoints(seededKnowledgeState),
        mode: 'new',
        revision: session.revision,
      };
    } catch (error) {
      await teachingSessionRepository.failInitialization(sessionId, operationId);
      throw error;
    }
  }

  private async generateOpening(context: TeachingScenarioContext): Promise<TeachingOpening> {
    const runtimeSignals = deriveTeachingRuntimeSignals(context);
    const openingMode: TeachingOpening['mode'] = context.taskType === 'project'
      || context.taskType === 'practice'
      || runtimeSignals.confidenceLevel === 'anxious'
      ? 'example-first'
      : runtimeSignals.recentTrend === 'improving'
        && runtimeSignals.recommendedPacing !== 'slow'
        ? 'predict'
        : 'self-assess';
    const fallbackOpening = buildFallbackOpening(context, openingMode);
    let parsed: any = null;
    try {
      const result = await withTimeout(executeSkillWithResult(auxSkillDefinitionMap['teaching-opening-generator'], {
        subject: context.subject,
        topic: context.topic,
        taskTitle: context.taskTitle,
        taskDescription: context.taskDescription,
        taskType: context.taskType,
        pathSummary: context.pathProgress.pathSummary,
        currentMilestoneTitle: context.pathProgress.currentMilestoneTitle,
        learner: {
          confidenceLevel: runtimeSignals.confidenceLevel,
          recentTrend: runtimeSignals.recentTrend,
          recommendedPacing: runtimeSignals.recommendedPacing,
        },
        openingMode,
        ...(context.learningSignal ? { learningSignal: context.learningSignal } : {}),
        ...(context.lastLessonRecap ? { lastLessonRecap: context.lastLessonRecap } : {}),
        __fallback: fallbackOpening,
        __prompt: {
          userId: context.userId,
          taskId: context.taskId,
          requestPath: '/services/ai-teaching/generate-opening',
          callerAgentId: AI_TEACHING_AGENT_ID,
        },
      }), 15000, 'OPENING_GENERATION_TIMEOUT');
      parsed = result.success && result.output ? result.output : null;
    } catch (error) {
      logger.warn('[AITeaching] 开场交互块生成失败，使用 fallback opening', {
        error: error instanceof Error ? error.message : String(error),
        userId: context.userId,
        taskId: context.taskId,
        topic: context.topic,
      });
      return fallbackOpening;
    }

    if (parsed) {
      return parsed as TeachingOpening;
    }

    logger.warn('[AITeaching] 开场交互块缺少有效结构，使用 fallback opening', {
      userId: context.userId,
      taskId: context.taskId,
      topic: context.topic,
    });
    return fallbackOpening;
  }

  async processStudentMessage(
    sessionId: string,
    message: string,
    options: ProcessStudentMessageOptions = {},
  ): Promise<{
    analysis: TeachingTurnOutput['analysis'];
    aiResponse: string;
    strategies: string[];
    knowledgePoint: string | null;
    knowledgePoints: KnowledgePointStatus[];
    isCompletion: boolean;
    currentState: LearningStateMetrics;
    peerTriggered: boolean;
    peerMessage?: string;
    promptDebug?: any;
    peerDebug?: any;
    shouldConfirmEnd?: boolean;
    endReason?: 'completion-candidate' | 'learner-requested-end' | null;
    autoEnded?: boolean;
    recovered?: boolean;
    checkpoint?: TeachingCheckpoint | null;
    wrapup?: SessionWrapupArtifact & {
      stateUpdate: LearningStateMetrics | null;
      duration: number;
      summarySource: 'model' | 'fallback';
      evaluationSource: 'model' | 'ai-fallback' | 'failed';
    };
    advisory?: ReplanAdvisory;
    revision: number;
    checkpointResolution?: {
      passed: boolean;
      understanding: number;
    };
  }> {
    const operationClaim = options.operationClaim || await teachingSessionRepository.claimOperation(
      sessionId,
      options.checkpointId ? `checkpoint:${options.checkpointId}` : 'message',
      ['active', 'timeout'],
      requireTeachingRevision(options.expectedRevision)
    );
    let committed = false;

    try {
      const session = operationClaim.session;
      const recovered = session.status === 'timeout';
      if (recovered) {
        logger.info('[AITeaching] 会话超时，本轮提交时自动恢复为活跃状态', { sessionId });
      }

      const submittedCheckpoint = options.checkpointId
        ? getPendingCheckpoint(session.teachingState)
        : null;
      if (options.checkpointId && (!submittedCheckpoint || submittedCheckpoint.id !== options.checkpointId)) {
        throw new Error('理解检查不存在或已处理');
      }

      const context = await buildTeachingScenarioContext(session.userId, session.taskId, session, options.interactionMeta);
      const endIntent = detectEndIntent(message);

    const updatedMessages = appendTimestamp([
      ...session.messages,
      {
        role: 'user',
        content: message,
        timestamp: new Date().toISOString(),
        // 检查点合成消息打标记：进入教学上下文供模型分析答案，但不参与学生行为证据统计
        ...(options.checkpointId ? { checkpoint: true } : {}),
        // 前端交互特征（认知负荷量测 · 前端情报层）：随消息落库，供后续轮次对比
        ...(options.interactionMeta && Object.keys(options.interactionMeta).length > 0
          ? { meta: options.interactionMeta as Record<string, number> }
          : {}),
      }
    ]);

    const previousTeachingState = session.teachingState || {};
    const sessionArtifacts = parseSessionArtifacts(previousTeachingState);
    const effectiveInitialKnowledgeState = cloneKnowledgePoints(
      Array.isArray(sessionArtifacts.initialKnowledgeState) && sessionArtifacts.initialKnowledgeState.length > 0
        ? sessionArtifacts.initialKnowledgeState
        : context.taskKnowledgeSeeds
    );
    const frozenKnowledgeState = normalizeFrozenKnowledgeState(
      effectiveInitialKnowledgeState,
      session.knowledgeState,
    );

    const turnInput = await buildTeachingTurnInput({
      ...session,
      messages: updatedMessages,
      knowledgeState: frozenKnowledgeState,
    }, context);
    const turnResult = await executeSkill(teachingTurnAgentDefinition, turnInput, {
      contextEnvelope: {
        schemaVersion: 'context-envelope/v1',
        principal: { userId: session.userId },
        session: { sessionId: session.id, taskId: session.taskId },
      },
    });
    if (!turnResult.success) {
      throw new Error(typeof turnResult.error === 'string' ? turnResult.error : turnResult.error?.message || 'TEACHING_TURN_FAILED');
    }

    const turnRuntimeEnvelope = turnResult?.runtimeEnvelope || null;
    const rawTeachingOutput = extractTeachingOutput(turnResult);
    const promptDebug = extractTeachingPromptDebug(turnResult);
    const { teachingOutput, existingPoints } = reconcileTeachingKnowledgeState(context, rawTeachingOutput, frozenKnowledgeState);
    const mergedKnowledge = normalizeFrozenKnowledgeState(
      effectiveInitialKnowledgeState,
      knowledgeStateService.merge(
        existingPoints,
        teachingOutput.knowledge.points
      )
    );
    // 知识完成度仍是 completion 的唯一硬门禁；envelope phase 仅作观测 soft 信号
    const completionReady = isKnowledgeStateComplete(mergedKnowledge);
    const envelopeCompletionSignal =
      turnRuntimeEnvelope?.businessState?.phase === 'completion-candidate'
      || turnRuntimeEnvelope?.businessState?.isTerminal === true;
    // soft-AND：双方都同意完成时记 alignment=agree；仅 envelope 喊完成时 disagree（不改变硬门禁）
    const completionAlignment: 'agree' | 'envelope-only' | 'knowledge-only' | 'neither' =
      completionReady && envelopeCompletionSignal
        ? 'agree'
        : !completionReady && envelopeCompletionSignal
          ? 'envelope-only'
          : completionReady && !envelopeCompletionSignal
            ? 'knowledge-only'
            : 'neither';
    if (completionAlignment === 'envelope-only' || completionAlignment === 'knowledge-only') {
      logger.debug('[AITeaching] completion soft-AND 分歧', {
        sessionId: session.id,
        completionAlignment,
        knowledgeComplete: completionReady,
        envelopePhase: turnRuntimeEnvelope?.businessState?.phase || null,
        envelopeTerminal: turnRuntimeEnvelope?.businessState?.isTerminal === true,
      });
    }
    const effectiveTeachingOutput: TeachingTurnOutput = {
      ...teachingOutput,
      control: {
        ...teachingOutput.control,
        isCompletionCandidate: completionReady,
      },
    };
    const previousClassroomStage = (previousTeachingState.classroomContext?.stage?.current as LearnStage) || 'opening';
    const peerTriggered = peerTriggerService.shouldTrigger(session, teachingOutput, message);
    let peerMessage: string | undefined;
    let peerDebug: any = null;
    let peerRuntimeEnvelope: any = null;

    if (peerTriggered) {
      const peerInput = {
        topic: session.topic,
        strategy: 'feynman' as const,
        studentMessage: message,
        tutorContext: updatedMessages.slice(-6).map((item) => ({
          role: item.role,
          content: item.content,
        })),
        cognitiveLevel: teachingOutput.analysis.cognitiveLevel,
        understanding: teachingOutput.analysis.understanding,
      };
      try {
        const peerResult = await executeSkill(peerAgentDefinition, {
          input: peerInput,
          context: {
            userId: session.userId,
            sessionId: session.id,
          },
        }, {
          contextEnvelope: {
            schemaVersion: 'context-envelope/v1',
            principal: { userId: session.userId },
            session: { sessionId: session.id, taskId: session.taskId },
          },
        });
        peerMessage = peerResult.internal?.ext?.peer?.message || peerResult.userVisible || '';
        peerDebug = extractPeerDebug(peerResult);
        peerRuntimeEnvelope = peerResult?.runtimeEnvelope
          || peerResult?.internal?.ext?.peer?.runtimeEnvelope
          || null;
      } catch (e: any) {
        logger.warn('[AITeachingCoordinator] peer-reinforcement 失败', { error: e?.message || String(e) });
      }
    }

    const nextStageDecision = determineNextStage({
      currentStage: previousClassroomStage,
      teachingOutput: effectiveTeachingOutput,
      peerTriggered,
      learnerMessage: message,
    });
    const learnerStateContext = buildLearnerStateContext(context, previousTeachingState, {
      ...teachingOutput.analysis,
      struggleDetected: nextStageDecision.stage === 'intervention',
    });
    learnerStateContext.struggleDetected = nextStageDecision.stage === 'intervention';

    const classroomContext = buildClassroomContext({
      previousState: previousTeachingState,
      stage: nextStageDecision.stage,
      stageReason: nextStageDecision.reason,
      teachingOutput: effectiveTeachingOutput,
      learnerMessage: message,
      context,
      knowledgeState: mergedKnowledge,
      learnerStateContext,
      peerTriggered,
      peerMessage,
    });

    const classroomEvents = Array.isArray(previousTeachingState.classroomEventHistory)
      ? [...previousTeachingState.classroomEventHistory]
      : [];

    classroomEvents.push(buildClassroomEvent('teaching-turn', nextStageDecision.reason, {
      stage: nextStageDecision.stage,
      focusKnowledgePoint: classroomContext.focus.currentKnowledgePoint,
      learnerMessage: message,
      confusionPoints: learnerStateContext.currentConfusionPoints || [],
      peerTriggered,
      endIntent: endIntent.isEndIntent,
    }));

    if (endIntent.isEndIntent) {
      classroomEvents.push(buildClassroomEvent('end-intent', endIntent.reason, {
        learnerMessage: message,
      }));
    }

    if (peerTriggered) {
      classroomEvents.push(buildClassroomEvent('peer-support', '本轮触发伴学支持', {
        peerMessage: peerMessage || null,
      }));
    }

    if (completionReady) {
      classroomEvents.push(buildClassroomEvent('completion-candidate', '本轮出现课堂完成候选信号', {
        focusKnowledgePoint: classroomContext.focus.currentKnowledgePoint,
      }));
    }

    const stageHistory = Array.isArray(previousTeachingState.stageHistory)
      ? [...previousTeachingState.stageHistory]
      : [];
    const lastStage = stageHistory[stageHistory.length - 1];
    if (!lastStage || lastStage.stage !== nextStageDecision.stage) {
      stageHistory.push({
        stage: nextStageDecision.stage,
        reason: nextStageDecision.reason,
        enteredAt: new Date().toISOString(),
      });
    }

    const teachingControlContext = buildTeachingControlContext(
      nextStageDecision.stage,
      context,
      learnerStateContext,
      {
        ...sessionArtifacts,
        endReason: endIntent.isEndIntent
          ? 'learner-requested-end'
          : completionReady
            ? 'completion-candidate'
            : sessionArtifacts.endReason,
      },
    );

    const learnDebug = {
      input: {
        pathBackgroundContext: buildPathBackgroundContext(context),
        classroomContext,
        learnerStateContext,
        classroomEventContext: {
          recentEvents: classroomEvents.slice(-5),
        },
        visibleDialogueContext: session.messages.map((item) => ({
          role: item.role,
          content: item.content,
        })).concat([{ role: 'user', content: message }]),
        teachingControlContext,
      },
      output: {
        stageDecision: nextStageDecision,
        classroomContext,
        learnerStateContext,
        knowledgeState: normalizeKnowledgePoints(mergedKnowledge),
        auxiliaryActions: {
          peerTriggered,
          completionCandidate: completionReady,
          autoEndRequested: endIntent.isEndIntent,
        },
        completionCandidateEvidence: teachingOutput.control.completionCandidateEvidence || null,
      },
    };

    if (promptDebug && typeof promptDebug === 'object') {
      promptDebug.learnDebug = learnDebug;
    }

    const assistantMessage: TeachingSessionMessage = {
      role: 'assistant',
      content: teachingOutput.reply,
      timestamp: new Date().toISOString(),
      analysis: teachingOutput.analysis,
      strategies: teachingOutput.pedagogy.strategies,
      knowledgePoint: teachingOutput.knowledge.currentPoint,
      knowledgePoints: normalizeKnowledgePoints(mergedKnowledge),
      promptDebug,
      peerTriggered,
      peerMessage: peerMessage || null,
      peerDebug,
    };

    if (!completionReady && hasPrematureNextStepLanguage(assistantMessage.content)) {
      logger.warn('[AITeaching] 教学回复越界，尚未满足结束条件却提到下一环节', {
        sessionId,
        taskId: session.taskId,
        reply: assistantMessage.content,
      });
    }

    const persistedMessages = [...updatedMessages, assistantMessage];
    const previousMetrics = extractTeachingStateMetrics(previousTeachingState)
      || learningStateService.coerceMetrics(context.learningState)
      || null;
    
    // 将扩展的 taskType 映射到基础的 4 种类型
    const normalizedTaskType = normalizeTaskTypeForMetrics(context.taskType);
    
    const currentState = learningStateService.calculateRuntimeState(previousMetrics, {
      difficulty: Math.max(1, Math.min(10, teachingOutput.analysis.levelScore + 2)),
      cognitiveLoad: Math.max(1, Math.min(10, (1 - teachingOutput.analysis.understanding + 0.3) * 8)),
      efficiency: teachingOutput.analysis.engagement,
      timeSpent: 1,
      expectedTime: 15,
      completionRate: 1,
      taskType: normalizedTaskType,
    });

      const teachingState: Record<string, any> = {
      ...currentState,
      analysis: effectiveTeachingOutput.analysis,
      strategies: effectiveTeachingOutput.pedagogy.strategies,
      completionCandidate: completionReady,
      peerTriggered,
      learnerStateContext,
      classroomContext,
      classroomEventHistory: classroomEvents.slice(-40),
      stageHistory,
      teachingControlContext,
      lastRuntimeEnvelope: turnRuntimeEnvelope,
      lastBusinessPhase: turnRuntimeEnvelope?.businessState?.phase || null,
      envelopeCompletionSignal: !!envelopeCompletionSignal,
      completionAlignment,
      lastPeerRuntimeEnvelope: peerRuntimeEnvelope,
      sessionArtifacts: {
        ...parseSessionArtifacts(session.teachingState),
        initialKnowledgeState: effectiveInitialKnowledgeState,
        pathBackgroundContext: sessionArtifacts.pathBackgroundContext || buildPathBackgroundContext(context),
        endReason: endIntent.isEndIntent
          ? 'learner-requested-end'
          : completionReady
            ? 'completion-candidate'
            : parseSessionArtifacts(session.teachingState).endReason,
      },
      };

      // 检查点产生：teaching-turn 可选输出 control.checkpoint，按规则落库为 pendingCheckpoint
      const checkpointCandidate = teachingOutput.control.checkpoint;
      if (
        !submittedCheckpoint
        && !completionReady
        && !endIntent.isEndIntent
        && checkpointCandidate
        && !previousTeachingState.pendingCheckpoint
        && (teachingState.lastCheckpointTurn === undefined
          || updatedMessages.length - teachingState.lastCheckpointTurn >= 4)
      ) {
        const checkpointTitle = checkpointCandidate.question.length > 20
          ? `${checkpointCandidate.question.slice(0, 20)}…`
          : checkpointCandidate.question;
        teachingState.pendingCheckpoint = {
          id: `cp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: checkpointCandidate.type,
          title: checkpointTitle,
          question: checkpointCandidate.question,
          ...(checkpointCandidate.options ? { options: checkpointCandidate.options } : {}),
          allowSkip: true,
          ...(checkpointCandidate.hint ? { contextHint: checkpointCandidate.hint } : {}),
        };
        teachingState.lastCheckpointTurn = updatedMessages.length;
      }

      let checkpointResolution: { passed: boolean; understanding: number } | undefined;
      if (submittedCheckpoint) {
        const understanding = Number(teachingOutput.analysis?.understanding ?? 0);
        const currentPoint = effectiveTeachingOutput.knowledge.currentPoint?.trim().toLowerCase();
        const passed = completionReady || !!currentPoint && mergedKnowledge.some(
          (point) => point.name.trim().toLowerCase() === currentPoint && point.status === 'mastered'
        );
        const checkpointHistory = Array.isArray(teachingState.checkpointHistory)
          ? [...teachingState.checkpointHistory]
          : [];
        checkpointHistory.push({
          checkpointId: submittedCheckpoint.id,
          submittedAt: new Date().toISOString(),
          passed,
          understanding,
        });

        delete teachingState.pendingCheckpoint;
        const nextSessionArtifacts = { ...parseSessionArtifacts(teachingState) };
        delete nextSessionArtifacts.pendingCheckpoint;
        teachingState.sessionArtifacts = nextSessionArtifacts;
        teachingState.checkpointHistory = checkpointHistory.slice(-20);
        checkpointResolution = { passed, understanding };
      }

      await teachingSessionRepository.commitTurnState(sessionId, operationClaim.operationId, {
        messages: persistedMessages,
        knowledgeState: mergedKnowledge,
        teachingState,
        taskId: session.taskId,
        userId: session.userId,
        markTaskInProgress: true,
      });
      committed = true;

      const baseResult = {
      analysis: teachingOutput.analysis,
      aiResponse: teachingOutput.reply,
      strategies: effectiveTeachingOutput.pedagogy.strategies,
      knowledgePoint: effectiveTeachingOutput.knowledge.currentPoint,
      knowledgePoints: normalizeKnowledgePoints(mergedKnowledge),
      isCompletion: completionReady,
      currentState,
      peerTriggered,
      peerMessage,
      promptDebug,
      peerDebug,
      // 统一运行契约观测（不改变 isCompletion 硬门禁）
      runtimeEnvelope: turnRuntimeEnvelope,
      completionAlignment,
      envelopeCompletionSignal: !!envelopeCompletionSignal,
      lastBusinessPhase: turnRuntimeEnvelope?.businessState?.phase || null,
      shouldConfirmEnd: completionReady || endIntent.isEndIntent,
      endReason: endIntent.isEndIntent
        ? 'learner-requested-end' as const
        : completionReady
          ? 'completion-candidate' as const
          : null,
      recovered,
        checkpoint: getPendingCheckpoint(teachingState),
        checkpointResolution,
        revision: session.revision + 1,
      };

      return baseResult;
    } finally {
      if (!committed) {
        await teachingSessionRepository.releaseOperation(sessionId, operationClaim.operationId);
      }
    }
  }

  async endSession(
    sessionId: string,
    endReason = 'manual-end',
    expectedRevision?: number,
    requestedOperationId: string = randomUUID(),
    requestedRequestHash?: string,
    requestedRequestJson?: string
  ): Promise<{
    status: 'completed' | 'processing';
    operationId: string;
    wrapup?: SessionWrapupArtifact & {
      stateUpdate: LearningStateMetrics | null;
      duration: number;
      summarySource: 'model' | 'fallback';
      evaluationSource: 'model' | 'ai-fallback' | 'failed';
    };
    advisory?: ReplanAdvisory;
    revision: number;
  }> {
    const fallbackIdentity = buildEndSessionRequestIdentity(endReason);
    const requestHash = requestedRequestHash || fallbackIdentity.requestHash;
    const requestJson = requestedRequestJson || fallbackIdentity.requestJson;
    const finalization = await teachingSessionRepository.claimFinalization(
      sessionId,
      'end_only',
      requestedOperationId,
      requestHash,
      requestJson,
      requireTeachingRevision(expectedRevision)
    );
    if (finalization.status === 'completed') {
      return {
        status: 'completed',
        operationId: finalization.operationId,
        wrapup: finalization.session.wrapup as any,
        advisory: finalization.session.advisory as ReplanAdvisory,
        revision: finalization.session.revision,
      };
    }
    if (finalization.status === 'processing') {
      return {
        status: 'processing',
        operationId: finalization.operationId,
        revision: finalization.session.revision
      };
    }
    const { session, operationId, leaseOwner } = finalization;
    const leaseGuard = new FinalizationLeaseGuard(sessionId, operationId, leaseOwner);
    leaseGuard.start();
    try {
    const durationMinutes = computeEffectiveDurationMinutes(session);
    const sessionArtifacts = {
      ...parseSessionArtifacts(session.teachingState),
      endReason,
    };
    const classroomEventHistory = Array.isArray(session.teachingState?.classroomEventHistory)
      ? session.teachingState?.classroomEventHistory
      : [];
    const finalClassroomContext = session.teachingState?.classroomContext || null;
    const stageHistory = Array.isArray(session.teachingState?.stageHistory)
      ? session.teachingState?.stageHistory
      : [];
    const initialKnowledgeState = Array.isArray(sessionArtifacts.initialKnowledgeState)
      ? sessionArtifacts.initialKnowledgeState
      : [];
    const knowledgeDelta = computeKnowledgeDelta(initialKnowledgeState, session.knowledgeState);
    const sessionEvidence = computeSessionEvidence(session);
    const context = await buildTeachingScenarioContext(session.userId, session.taskId, session);

    const wrapupOutput = await executeSkill(sessionWrapupAgentDefinition, {
      input: {
        messages: session.messages.map((message) => ({
          role: message.role,
          content: message.content,
          timestamp: new Date(message.timestamp),
          analysis: message.analysis,
        })),
        knowledgePoints: session.knowledgeState,
        sessionInfo: {
          subject: session.subject,
          topic: session.topic,
          durationMinutes,
          userMessageCount: session.messages.filter((message) => message.role === 'user').length,
          assistantMessageCount: session.messages.filter((message) => message.role === 'assistant').length,
          taskType: session.taskType,
          taskTitle: context.taskTitle,
          taskDescription: context.taskDescription,
          pathTitle: context.pathContext.pathTitle || null,
          pathSummary: context.pathContext.pathSummary || null,
        },
        learningState: context.learningState ? {
          ...context.learningState,
          ...deriveTeachingRuntimeSignals(context),
        } : undefined,
        knowledgeContext: {
          initialPoints: initialKnowledgeState,
          delta: knowledgeDelta,
        },
        sessionEvidence,
        sessionStructure: {
          pathBackground: sessionArtifacts.pathBackgroundContext || null,
          finalClassroomContext,
          classroomEventHistory,
          stageHistory,
          endReason: sessionArtifacts.endReason || endReason,
        },
      },
      context: {
        userId: session.userId,
        sessionId,
      },
    }, {
      contextEnvelope: {
        schemaVersion: 'context-envelope/v1',
        principal: { userId: session.userId },
        session: { sessionId: session.id, taskId: session.taskId },
      },
    });

    const wrapupResult = wrapupOutput.internal.ext.sessionWrapup.result;
    const wrapupArtifact = wrapupOutput.internal.ext.sessionWrapup.artifact;
    const wrapupRuntimeEnvelope = wrapupOutput?.runtimeEnvelope
      || wrapupResult?.runtimeEnvelope
      || null;

    const evaluationResult = hasReliableSessionEvaluation(
      wrapupResult.evaluation,
      wrapupResult.evaluationSource
    )
      ? {
          source: wrapupResult.evaluationSource,
          evaluation: wrapupResult.evaluation!,
        }
      : null;

    const lastAnalyzedMessage = [...session.messages].reverse().find((message) => !!message.analysis);
    const scoreInput = evaluationResult ? {
      sessionLss: evaluationResult.evaluation.sessionLss,
      sessionKtl: evaluationResult.evaluation.sessionKtl,
      sessionLf: evaluationResult.evaluation.sessionLf,
      durationMinutes,
      confidence: evaluationResult.evaluation.confidence,
      pathId: session.learningPathId || null,
      taskId: session.taskId,
      sessionId,
    } : null;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const metricCommit = scoreInput
        ? await learningStateService.prepareSessionScoreCommit(session.userId, scoreInput)
        : null;
      const finalState = metricCommit?.metrics || null;
      const persistedEvaluation = {
        ...(evaluationResult ? evaluationResult.evaluation : {}),
        lss: finalState?.lss ?? 0,
        ktl: finalState?.ktl ?? 0,
        lf: finalState?.lf ?? 0,
        lsb: finalState?.lsb ?? 0,
        evaluationSource: (evaluationResult?.source || 'failed') as 'model' | 'ai-fallback' | 'failed',
        messageCount: session.messages.filter((message) => message.role === 'user').length,
        avgUnderstanding: sessionEvidence.avgUnderstanding ?? 0,
        avgCognitiveLevel: lastAnalyzedMessage?.analysis?.cognitiveLevel || 'understand',
        duration: durationMinutes,
      };
      const persistedWrapup = {
        ...wrapupArtifact,
        duration: durationMinutes,
        stateUpdate: finalState,
        summarySource: wrapupResult.summarySource,
        evaluationSource: wrapupResult.evaluationSource,
        runtimeEnvelope: wrapupRuntimeEnvelope,
      };
      const snapshotInput = {
        userId: session.userId,
        learningPathId: session.learningPathId || undefined,
        milestoneId: session.milestoneId || undefined,
        taskId: session.taskId,
        mode: 'teaching' as const,
      };
      const learnerSnapshot = finalState
        ? await learnerSnapshotService.previewSnapshotFromMetrics({
            ...snapshotInput,
            metrics: finalState,
            generatedAt: finalState.timestamp,
          })
        : await learnerSnapshotService.getSnapshot(snapshotInput);
      const learnerReplanProjection = learnerProjectionService.toReplanProjection(learnerSnapshot);
      const currentPath = learnerSnapshot.knowledgeMemory.currentPath;
      const currentStageNumber = currentPath?.currentPosition.stageNumber || 1;
      const nextMilestone = currentPath?.milestoneProgress.find((item) => item.stageNumber === currentStageNumber + 1) || null;
      const advisory = replanAdvisoryService.build({
        wrapup: persistedWrapup,
        learnerReplanProjection,
        nextMilestone: nextMilestone ? {
          milestoneId: nextMilestone.milestoneId,
          title: nextMilestone.title,
          goal: nextMilestone.goal,
          totalTasks: nextMilestone.totalTasks,
        } : null,
      });
      const finalWrapup = {
        ...persistedWrapup,
        learner: {
          recentTrend: learnerSnapshot.dynamicState.recentTrend,
          fatigueRisk: learnerSnapshot.dynamicState.fatigueRisk,
          recommendedPacing: learnerSnapshot.dynamicState.recommendedPacing,
        },
      };
      const lessonEvent = createDomainEvent({
        id: `evt_lesson_completed_${session.id}`,
        type: 'lesson:completed',
        aggregateType: 'lesson',
        aggregateId: session.id,
        userId: session.userId,
        source: AI_TEACHING_AGENT_ID,
        data: {
          lessonId: session.id,
          sessionId: session.id,
          taskId: session.taskId,
          pathId: session.learningPathId,
          milestoneId: session.milestoneId,
          duration: durationMinutes,
          performance: evaluationResult ? persistedEvaluation : null,
          knowledgeState: session.knowledgeState,
          visibleDialogueContext: session.messages.slice(-16).map((message) => ({
            role: message.role,
            content: message.content,
            analysis: message.analysis || null,
          })),
          classroomEventHistory,
          wrapup: finalWrapup,
          advisory
        }
      });

      try {
        await leaseGuard.assertOwned();
        await teachingSessionRepository.completeWithEvent(sessionId, operationId, leaseOwner, {
          messages: session.messages,
          knowledgeState: session.knowledgeState,
          teachingState: mergeFinalTeachingState(session.teachingState, finalState, sessionArtifacts),
          wrapup: finalWrapup,
          advisory,
          duration: durationMinutes
        }, lessonEvent, metricCommit ? {
          userId: metricCommit.userId,
          expectedRevision: metricCommit.expectedRevision,
          sourceKey: metricCommit.sourceKey,
          data: metricCommit.data,
        } : null);
      } catch (error) {
        if (
          error instanceof TeachingSessionConflictError
          && error.code === 'TEACHING_LEARNING_STATE_STALE'
          && attempt < 4
        ) {
          continue;
        }
        throw error;
      }

      dashboardGuidanceSnapshotService.refreshInBackground(session.userId, 'lesson-wrapup');
      // 记忆引擎 M2：课后按知识看板状态确定性回写内化强度（best-effort，失败不阻断课堂完成）
      memoryTraceService.recordSessionOutcome(session.userId, session.knowledgeState, 'derived').catch((error) => {
        logger.warn('[AITeaching] 记忆痕迹回写失败', {
          sessionId,
          userId: session.userId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      return {
        status: 'completed',
        operationId,
        wrapup: finalWrapup,
        advisory,
        revision: session.revision + 1,
      };
    }

    throw new TeachingSessionConflictError('学习状态持续变化，请稍后重试', 'TEACHING_LEARNING_STATE_STALE');
    } catch (error) {
      const info = classifyFinalizationError(error);
      try {
        await teachingSessionRepository.failFinalization(
          sessionId,
          operationId,
          leaseOwner,
          'end_only',
          info.code === 'FINALIZATION_PERSISTENCE_FAILED' ? 'SESSION_FINALIZATION_FAILED' : info.code,
          info.retryable
        );
      } catch (markError) {
        logger.error('[AITeaching] 课堂结束失败状态持久化失败', {
          sessionId,
          operationId,
          error: markError instanceof Error ? markError.message : String(markError)
        });
      }
      throw error;
    } finally {
      await leaseGuard.stop();
    }
  }

  async getSessionHistory(userId: string): Promise<Array<{
    id: string;
    subject: string;
    topic: string;
    taskId: string | null;
    startTime: Date;
    endTime: Date | null;
    duration: number | null;
    status: string;
    messageCount: number;
  }>> {
    const sessions = await teachingSessionRepository.listByUser(userId);
    return sessions.map((session) => ({
      id: session.id,
      subject: session.subject,
      topic: session.topic,
      taskId: session.taskId,
      startTime: session.startTime,
      endTime: session.endTime,
      duration: session.duration,
      status: session.status,
      messageCount: session.messages.length,
    }));
  }

  async getSessionDetail(sessionId: string, userId: string): Promise<{
    id: string;
    subject: string;
    topic: string;
    taskId: string | null;
    startTime: Date;
    endTime: Date | null;
    duration: number | null;
    status: string;
    messages: Array<{ role: string; content: string; timestamp: string; analysis?: any }>;
    state: any;
    knowledgePoints?: any[];
    wrapup?: any | null;
    advisory?: ReplanAdvisory | null;
    pendingCheckpoint?: TeachingCheckpoint | null;
    revision: number;
  } | null> {
    const session = await teachingSessionRepository.getById(sessionId);
    if (!session || session.userId !== userId) {
      return null;
    }

    return {
      id: session.id,
      subject: session.subject,
      topic: session.topic,
      taskId: session.taskId,
      startTime: session.startTime,
      endTime: session.endTime,
      duration: session.duration,
      status: session.status,
      messages: session.messages,
      state: session.teachingState || {},
      knowledgePoints: session.knowledgeState,
      wrapup: session.wrapup,
      advisory: (session.advisory as ReplanAdvisory | null) || null,
      pendingCheckpoint: getPendingCheckpoint(session.teachingState),
      revision: session.revision,
    };
  }

  async submitCheckpoint(
    sessionId: string,
    checkpointId: string,
    payload: CheckpointSubmitPayload,
    expectedRevision?: number,
  ): Promise<CheckpointSubmitResult> {
    const operationClaim = await teachingSessionRepository.claimOperation(
      sessionId,
      `checkpoint:${checkpointId}`,
      ['active', 'timeout'],
      requireTeachingRevision(expectedRevision)
    );
    const session = operationClaim.session;

    const checkpoint = getPendingCheckpoint(session.teachingState);
    if (!checkpoint || checkpoint.id !== checkpointId) {
      await teachingSessionRepository.releaseOperation(sessionId, operationClaim.operationId);
      throw new Error('理解检查不存在或已处理');
    }

    try {
      let answer: string;
      if (checkpoint.type === 'short_answer') {
        answer = payload.answerText?.trim() || '';
        if (!answer) {
          throw new Error('缺少作答内容');
        }
      } else {
        const selectedOptionIds = Array.from(new Set(payload.selectedOptionIds || []));
        const options = Array.isArray(checkpoint.options) ? checkpoint.options : [];
        const selectedOptions = selectedOptionIds.map((optionId) => options.find((option) => option.id === optionId));
        if (selectedOptions.length === 0 || selectedOptions.some((option) => !option)) {
          throw new Error('提交的选项无效');
        }
        if (checkpoint.type === 'single_choice' && selectedOptions.length !== 1) {
          throw new Error('单选题只能提交一个选项');
        }
        answer = selectedOptions.map((option) => `${option!.id}. ${option!.text}`).join('；');
      }

      const turn = await this.processStudentMessage(
        sessionId,
        `理解检查：${checkpoint.question}\n我的答案：${answer}`,
        { operationClaim, checkpointId }
      );
      const passed = turn.checkpointResolution?.passed === true;
      const hint = !passed && turn.analysis?.confusionPoints?.length
        ? `建议先回顾：${turn.analysis.confusionPoints.join('、')}`
        : undefined;
      return {
        passed,
        feedback: turn.aiResponse,
        ...(hint ? { hint } : {}),
        nextAction: passed ? 'continue' : 'review',
        revision: turn.revision,
      };
    } catch (error) {
      await teachingSessionRepository.releaseOperation(sessionId, operationClaim.operationId);
      throw error;
    }
  }

  async pauseSession(
    sessionId: string,
    userId: string,
    reason: 'manual' | 'pagehide' | 'hidden' = 'manual',
    expectedRevision?: number
  ): Promise<number> {
    requireTeachingRevision(expectedRevision);
    const session = await teachingSessionRepository.getById(sessionId);
    if (!session || session.userId !== userId) {
      throw new Error('会话不存在');
    }
    if (['completed', 'discarded', 'superseded'].includes(session.status)) {
      throw new Error('已结束的会话无法暂停');
    }

    const sessionArtifacts = parseSessionArtifacts(session.teachingState);
    if (session.status === 'paused' && sessionArtifacts.pausedAt) {
      return session.revision;
    }

    const operationClaim = await teachingSessionRepository.claimOperation(
      sessionId,
      `pause:${reason}`,
      ['active', 'timeout'],
      expectedRevision
    );
    let committed = false;
    try {
      const currentArtifacts = parseSessionArtifacts(operationClaim.session.teachingState);
      await teachingSessionRepository.commitLifecycleState(sessionId, operationClaim.operationId, {
        status: 'paused',
        endTime: null,
        duration: null,
        teachingState: buildTeachingStateWithArtifacts(operationClaim.session.teachingState, {
          ...currentArtifacts,
          pausedAt: new Date().toISOString(),
          pauseReason: reason,
        }),
      });
      committed = true;
      return operationClaim.session.revision + 1;
    } finally {
      if (!committed) {
        await teachingSessionRepository.releaseOperation(sessionId, operationClaim.operationId);
      }
    }
  }

  /**
   * 恢复暂停的授课会话：把暂停时长累加进 pausedDurationMs，状态回到 active。
   * 用于页面切回标签页/窗口恢复可见时，避免把切走的时间计入学习时长。
   */
  async resumeSession(
    sessionId: string,
    userId: string,
    expectedRevision?: number
  ): Promise<number> {
    requireTeachingRevision(expectedRevision);
    const session = await teachingSessionRepository.getById(sessionId);
    if (!session || session.userId !== userId) {
      throw new Error('会话不存在');
    }
    if (session.status !== 'paused') {
      return session.revision;
    }

    const sessionArtifacts = parseSessionArtifacts(session.teachingState);
    const wasPausedAt = typeof sessionArtifacts.pausedAt === 'string'
      ? new Date(sessionArtifacts.pausedAt).getTime()
      : null;
    if (!wasPausedAt || Number.isNaN(wasPausedAt)) {
      return session.revision;
    }
    const pausedDurationMs = Math.max(0, Date.now() - wasPausedAt)
      + Math.max(0, Number(sessionArtifacts.pausedDurationMs || 0));

    const operationClaim = await teachingSessionRepository.claimOperation(
      sessionId,
      'resume',
      ['paused'],
      expectedRevision
    );
    let committed = false;
    try {
      await teachingSessionRepository.commitLifecycleState(sessionId, operationClaim.operationId, {
        status: 'active',
        endTime: null,
        duration: null,
        teachingState: buildTeachingStateWithArtifacts(operationClaim.session.teachingState, {
          ...sessionArtifacts,
          pausedAt: null,
          pauseReason: null,
          pausedDurationMs,
          resumedAt: new Date().toISOString(),
        }),
      });
      committed = true;
      return operationClaim.session.revision + 1;
    } finally {
      if (!committed) {
        await teachingSessionRepository.releaseOperation(sessionId, operationClaim.operationId);
      }
    }
  }

  async resetSession(sessionId: string, userId: string, expectedRevision?: number): Promise<number> {
    requireTeachingRevision(expectedRevision);
    const session = await teachingSessionRepository.getById(sessionId);
    if (!session || session.userId !== userId) {
      throw new Error('会话不存在');
    }
    if (session.status === 'discarded') {
      return session.revision;
    }
    if (['completed', 'superseded'].includes(session.status)) {
      throw new Error('已结束的会话无法重置');
    }

    const operationClaim = await teachingSessionRepository.claimOperation(
      sessionId,
      'reset',
      ['active', 'paused', 'timeout'],
      expectedRevision
    );
    let committed = false;
    try {
      await teachingSessionRepository.commitLifecycleState(sessionId, operationClaim.operationId, {
        status: 'discarded',
        endTime: new Date(),
        duration: computeEffectiveDurationMinutes(operationClaim.session),
        clearOpenKey: true,
        teachingState: buildTeachingStateWithArtifacts(operationClaim.session.teachingState, {
          ...parseSessionArtifacts(operationClaim.session.teachingState),
          resetAt: new Date().toISOString(),
        }),
      });
      committed = true;
      return operationClaim.session.revision + 1;
    } finally {
      if (!committed) {
        await teachingSessionRepository.releaseOperation(sessionId, operationClaim.operationId);
      }
    }
  }

  private async syncVirtualSessionTimeout(sessionId: string): Promise<void> {
    const sessions = await prisma.virtual_sessions.findMany({
      where: { currentStage: 'teaching' },
      select: {
        id: true,
        status: true,
        stageResults: true,
        logs: true,
      }
    });

    for (const session of sessions) {
      let stageResults: Record<string, any> = {};
      try {
        stageResults = JSON.parse(session.stageResults || '{}') || {};
      } catch {
        stageResults = {};
      }

      const learningState = stageResults.teaching || {};
      if (learningState?.teachingSessionId !== sessionId) continue;

      const nextLearningState = {
        ...learningState,
        manualStop: true,
        stoppedAt: new Date().toISOString(),
        stoppedReason: 'teaching-session-timeout',
        taskRuntime: {
          ...(learningState.taskRuntime || {}),
          status: 'timeout',
          error: '授课会话已超时，请重新开始 Learn',
          updatedAt: new Date().toISOString()
        }
      };

      let logs: any[] = [];
      try {
        logs = JSON.parse(session.logs || '[]');
      } catch {
        logs = [];
      }

      const hasTimeoutLog = logs.some((entry: any) => entry?.phase === 'error' && entry?.details?.error === 'TEACHING_SESSION_TIMEOUT');
      const nextLogs = hasTimeoutLog
        ? logs
        : [
            ...logs,
            {
              timestamp: new Date().toISOString(),
              phase: 'error',
              details: {
                error: 'TEACHING_SESSION_TIMEOUT',
                output: {
                  action: 'teaching-step-stopped',
                  teachingSessionId: sessionId
                }
              }
            }
          ];

      await prisma.virtual_sessions.update({
        where: { id: session.id },
        data: {
          status: 'failed',
          stageResults: JSON.stringify({
            ...stageResults,
            learning: nextLearningState
          }),
          logs: JSON.stringify(nextLogs),
          updatedAt: new Date()
        }
      });
    }
  }

  async getLatestTaskEvaluation(taskId: string, userId: string): Promise<{
    sessionId: string;
    subject: string;
    topic: string;
    startTime: Date;
    endTime: Date | null;
    duration: number;
    messageCount: number;
    knowledgePoints: any[];
    wrapup: any;
    advisory?: ReplanAdvisory | null;
  } | null> {
    const sessions = await teachingSessionRepository.listByUser(userId);
    const target = sessions
      .filter((session) => session.taskId === taskId && session.status === 'completed' && session.wrapup)
      .sort((a, b) => (b.endTime?.getTime() || 0) - (a.endTime?.getTime() || 0))[0];

    if (!target || !target.wrapup) {
      return null;
    }

    return {
      sessionId: target.id,
      subject: target.subject,
      topic: target.topic,
      startTime: target.startTime,
      endTime: target.endTime,
      duration: target.duration || 0,
      messageCount: target.messages.filter((message) => message.role === 'user').length,
      knowledgePoints: target.knowledgeState,
      wrapup: target.wrapup,
      advisory: (target.advisory as ReplanAdvisory | null) || null,
    };
  }

  private async checkIdleSessions(): Promise<void> {
    const cutoff = new Date(Date.now() - this.idleTimeoutMs);
    const sessions = await prisma.teaching_sessions.findMany({
      where: {
        status: 'active',
        updatedAt: { lte: cutoff }
      },
      select: {
        id: true,
        revision: true,
      }
    });

    for (const session of sessions) {
      const timedOut = await teachingSessionRepository.timeoutIfIdle(session.id, session.revision, cutoff);
      if (timedOut) {
        await this.syncVirtualSessionTimeout(session.id);
        await this.applyTimeoutWrapupFallback(session.id);
      }
    }
  }

  /**
   * 超时会话兜底：写入轻量学习记录（不调 LLM），避免评估页出现
   * 「总结全空 + 用时 0 分钟」；用户之后恢复继续学习并正常结束时会被正式 wrapup 覆盖。
   */
  private async applyTimeoutWrapupFallback(sessionId: string): Promise<void> {
    try {
      const session = await teachingSessionRepository.getById(sessionId);
      if (!session || session.status !== 'timeout' || session.wrapup) return;

      // 活跃时长：按消息时间戳估算（间隔 > 30 分钟视为暂停），避免把 idle 时间算入
      const messages = Array.isArray(session.messages) ? session.messages : [];
      const times = messages
        .map((m) => (m.timestamp ? new Date(m.timestamp).getTime() : NaN))
        .filter((t) => Number.isFinite(t))
        .sort((a, b) => a - b);
      let activeMinutes = 0;
      for (let i = 1; i < times.length; i++) {
        activeMinutes += Math.min((times[i] - times[i - 1]) / 60000, 30);
      }
      const durationMinutes = Math.max(1, Math.round(activeMinutes));

      const knowledgePoints = cloneKnowledgePoints(session.knowledgeState);
      const mastered = knowledgePoints.filter((p) => p.status === 'mastered').map((p) => p.name);
      const learning = knowledgePoints.filter((p) => p.status === 'learning').map((p) => p.name);

      const wrapup = {
        status: 'summary-only' as const,
        sources: { summary: 'timeout-fallback' as const, evaluation: 'failed' as const },
        duration: durationMinutes,
        summary: {
          topicSummary: '本次会话未正常结束，为你保留了基础学习记录。',
          knowledgeSummary: mastered.length > 0 ? `已掌握：${mastered.join('、')}。` : '暂未确认掌握的知识点。',
          practiceAdvice: '重新开始本节，完成一次完整的学习后这里会给出完整建议。',
          learningEvaluation: '未生成学习评价。',
          knowledgeItems: knowledgePoints.map((p) => ({
            name: p.name,
            status: p.status,
            evidence: p.status === 'mastered' ? '会话中确认掌握' : '会话中未完成确认',
          })),
          keyTakeaways: [] as string[],
          actionPlan: [] as string[],
          evaluationHighlights: null,
          metricInterpretation: {
            session: '未生成本节课堂表现。',
            longTerm: '未生成长期状态评估。',
          },
          summaryVersion: 'v2',
        },
        evaluation: null,
        progress: {
          newlyMastered: mastered,
          movedToReview: [] as string[],
          stillLearning: learning,
          unchangedMastered: [] as string[],
        },
        evidence: {
          turnCount: messages.length,
          avgUnderstanding: null,
          avgEngagement: null,
          dominantCognitiveLevel: null,
          lastCognitiveLevel: null,
          topConfusionPoints: [] as string[],
          emotionalSignals: { positive: 0, neutral: 0, frustrated: 0, confused: 0 },
          completionCandidateSeen: false,
        },
      };

      await prisma.teaching_sessions.update({
        where: { id: sessionId },
        data: { wrapup: JSON.stringify(wrapup) }
      });
      logger.info('[AITeaching] 超时会话已写入兜底学习记录', { sessionId, durationMinutes });
    } catch (error) {
      logger.warn('[AITeaching] 超时会话兜底记录写入失败', {
        sessionId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async processPeerMessage(
    sessionId: string,
    message: string
  ): Promise<{
    peerResponse: string;
  }> {
    const session = await teachingSessionRepository.getById(sessionId);
    if (!session) {
      throw new Error('会话不存在或已结束');
    }
    if (session.status !== 'active' && session.status !== 'timeout') {
      throw new TeachingSessionConflictError('课堂已结束，无法继续伴学对话', 'TEACHING_SESSION_STATE_CHANGED');
    }

    // 伴学历史从已落库消息中恢复（peer 标记），不再依赖进程内 Map
    const peerHistory = session.messages
      .filter((item: any) => item.peer === true)
      .map((item: any) => ({ role: item.role, content: item.content }));

    const peerResult = await executeSkill(peerAgentDefinition, {
      input: {
        topic: session.topic,
        strategy: 'feynman',
        studentMessage: message,
        tutorContext: session.messages.slice(-6).map((item) => ({
          role: item.role,
          content: item.content,
        })),
        cognitiveLevel: (session.teachingState as any)?.analysis?.cognitiveLevel,
        understanding: (session.teachingState as any)?.analysis?.understanding,
        peerHistory,
      },
      context: {
        userId: session.userId,
        sessionId: session.id,
      },
    }, {
      contextEnvelope: {
        schemaVersion: 'context-envelope/v1',
        principal: { userId: session.userId },
        session: { sessionId: session.id, taskId: session.taskId },
      },
    });

    const peerResponse = peerResult.internal?.ext?.peer?.message || peerResult.userVisible || '';
    // 伴学对话落库（带 peer 标记），页面刷新后不丢失
    const now = new Date().toISOString();
    await teachingSessionRepository.appendPeerMessages(sessionId, [
      { role: 'user', content: message, timestamp: now, peer: true },
      { role: 'assistant', content: peerResponse, timestamp: now, peer: true },
    ]);
    return { peerResponse };
  }
}

// 辅助函数：将扩展的 taskType 映射到基础的 4 种类型（用于学习状态指标计算）
function normalizeTaskTypeForMetrics(
  taskType: 'reading' | 'practice' | 'project' | 'quiz' | 'acquire' | 'deconstruct' | 'model' | 'execute' | 'diagnose' | 'refine' | 'consolidate'
): 'reading' | 'practice' | 'project' | 'quiz' {
  switch (taskType) {
    // 直接映射
    case 'reading':
    case 'practice':
    case 'project':
    case 'quiz':
      return taskType;
    
    // 认知处理类 → reading（偏理解和分析）
    case 'acquire':      // 获取材料
    case 'deconstruct':  // 解构分析
    case 'consolidate':  // 巩固整理
      return 'reading';
    
    // 执行和建模类 → practice（偏动手操作）
    case 'execute':      // 执行操作
    case 'model':        // 建模构建
      return 'practice';
    
    // 诊断和改进类 → project（偏综合应用）
    case 'diagnose':     // 诊断问题
    case 'refine':       // 改进优化
      return 'project';
  }
}

export const aiTeachingOrchestrator = new AITeachingOrchestrator();
export default aiTeachingOrchestrator;
