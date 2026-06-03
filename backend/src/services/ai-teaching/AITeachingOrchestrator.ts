import { logger } from '../../utils/logger';
import prisma from '../../config/database';
import learningStateService, { LearningStateMetrics } from '../learning/learning-state.service';
import type { SessionWrapupArtifact, SessionWrapupSummary } from '../../agents/session-wrapup-agent';
import { sessionWrapupAgent, toWrapupArtifact } from '../../agents/session-wrapup-agent';
import { teachingTurnAgentHandler, type TeachingTurnInput, type TeachingTurnOutput } from '../../agents/teaching-turn-agent';
import { getAPIGateway, CallerInfo } from '../../gateway/api-gateway';
import { getEventBus } from '../../gateway/event-bus';
import { peerAgentHandler } from '../../agents/peer-agent';
import { buildTeachingScenarioContext, type TeachingScenarioContext } from './TeachingContextBuilder';
import {
  teachingSessionRepository,
  type TeachingKnowledgePointState,
  type TeachingSessionMessage,
  type TeachingSessionRecord,
} from './TeachingSessionRepository';
import { knowledgeStateService } from './KnowledgeStateService';
import { peerTriggerService } from './PeerTriggerService';
import { teachingContextCompressionService } from './TeachingContextCompressionService';
import { learnerSnapshotRefreshService } from '../learner/LearnerSnapshotRefreshService';
import { dashboardGuidanceSnapshotService } from '../learner/DashboardGuidanceSnapshotService';
import { learnerProjectionService } from '../learner/LearnerProjectionService';
import { replanAdvisoryService, type ReplanAdvisory } from './ReplanAdvisoryService';
import learningService from '../learning/learning.service';

export type TeachingMode = 'tutor' | 'peer' | 'debate';
const AI_TEACHING_AGENT_ID = 'ai-teaching-agent';

export interface KnowledgePointStatus {
  name: string;
  status: 'pending' | 'learning' | 'mastered' | 'review';
  progress: number;
}

export interface TeachingSessionStartInput {
  userId: string;
  taskId: string;
  forceNew?: boolean;
}

export interface TeachingOpening {
  message: string;
  question: string;
  quickReplies: Array<{ text: string }>;
  mode: 'self-assess' | 'predict' | 'example-first';
}

type SessionResumeMode = 'new' | 'resumed';

const RECOVERY_WINDOW_MS = 48 * 60 * 60 * 1000;

function buildSessionId(userId: string) {
  return `teaching_${Date.now()}_${userId}`;
}

function toMessageRole(role: string): 'user' | 'assistant' | 'system' {
  if (role === 'assistant' || role === 'system') return role;
  return 'user';
}

function appendTimestamp(messages: Array<{ role: string; content: string; timestamp?: string; analysis?: any }>): TeachingSessionMessage[] {
  return messages.map((message) => ({
    role: toMessageRole(message.role),
    content: message.content,
    timestamp: message.timestamp || new Date().toISOString(),
    ...(message.analysis ? { analysis: message.analysis } : {})
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
  const analyzedMessages = session.messages.filter((message) => !!message.analysis);
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

function buildTeachingTurnInput(
  session: TeachingSessionRecord,
  context: TeachingScenarioContext
): TeachingTurnInput {
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

  return {
    messages: compression.messages,
    scenario: {
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
      contextCompression: compression.compressed ? {
        enabled: true,
        estimatedTokens: compression.estimatedTokens,
        triggerTokens: compression.triggerTokens,
        recap: compression.recap,
      } : undefined,
    },
    classroomContext,
    classroomEventContext,
    visibleDialogueContext: session.messages.map((item) => ({
      role: item.role,
      content: item.content,
    })),
    knowledge: {
      points: session.knowledgeState,
    },
    controls: {
      mode: session.mode as TeachingMode,
      teachingControlContext,
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
  return agentOutput?.internal?.ext?.teaching as TeachingTurnOutput;
}

function extractPeerDebug(agentOutput: any) {
  return agentOutput?.internal?.ext?.peer || null;
}

function extractTeachingPromptDebug(agentOutput: any) {
  return agentOutput?.internal?.ext?.promptDebug || null;
}

export class AITeachingOrchestrator {
  private peerMessages: Map<string, Array<{ role: string; content: string }>> = new Map();
  private idleTimeoutMs = 30 * 60 * 1000;

  constructor() {
    setInterval(() => {
      void this.checkIdleSessions();
    }, 60 * 1000);
  }

  async startSession(input: TeachingSessionStartInput): Promise<{
    sessionId: string;
    subject: string;
    topic: string;
    startTime: Date;
    welcomeMessage: string;
    opening: TeachingOpening;
    mode: SessionResumeMode;
  }> {
    const previousSession = input.forceNew
      ? null
      : await teachingSessionRepository.getRecoverableByTask(
          input.userId,
          input.taskId,
          RECOVERY_WINDOW_MS,
        );

    if (previousSession) {
      const sessionArtifacts = parseSessionArtifacts(previousSession.teachingState);
      const wasPausedAt = typeof sessionArtifacts.pausedAt === 'string'
        ? new Date(sessionArtifacts.pausedAt).getTime()
        : null;
      const additionalPausedMs = wasPausedAt ? Math.max(0, Date.now() - wasPausedAt) : 0;
      const resumedArtifacts = {
        ...sessionArtifacts,
        pausedAt: null,
        pauseReason: null,
        pausedDurationMs: Math.max(0, Number(sessionArtifacts.pausedDurationMs || 0)) + additionalPausedMs,
        resumedAt: new Date().toISOString(),
      };

      await teachingSessionRepository.updateLifecycleState(previousSession.id, {
        status: 'active',
        endTime: null,
        duration: null,
        teachingState: buildTeachingStateWithArtifacts(previousSession.teachingState, resumedArtifacts),
      });

      const opening = buildRecoveredOpening(previousSession);
      return {
        sessionId: previousSession.id,
        subject: previousSession.subject,
        topic: previousSession.topic,
        startTime: previousSession.startTime,
        welcomeMessage: previousSession.messages[0]?.content || `${opening.message}\n\n${opening.question}`,
        opening,
        mode: 'resumed',
      };
    }

    const context = await buildTeachingScenarioContext(input.userId, input.taskId, previousSession);

    const sessionId = buildSessionId(input.userId);
    const opening = await this.generateOpening(context);
    const welcomeMessage = `${opening.message}\n\n${opening.question}`;

    const session = await teachingSessionRepository.create({
      id: sessionId,
      userId: input.userId,
      taskId: context.taskId,
      learningPathId: context.learningPathId,
      milestoneId: context.milestoneId,
      subject: context.subject,
      topic: context.topic,
      taskType: context.taskType,
      mode: 'tutor',
      messages: [
        {
          role: 'assistant',
          content: welcomeMessage,
          timestamp: new Date().toISOString(),
          analysis: {
            openingMode: opening.mode,
            quickReplies: opening.quickReplies,
          }
        }
      ],
      knowledgeState: context.previousSession?.knowledgePoints || [],
      teachingState: {
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
          initialKnowledgeState: context.previousSession?.knowledgePoints || [],
          pathBackgroundContext: buildPathBackgroundContext(context),
          endReason: null,
        },
      },
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
      mode: 'new',
    };
  }

  private async generateOpening(context: TeachingScenarioContext): Promise<TeachingOpening> {
    const gateway = getAPIGateway();
    const caller: CallerInfo = { agentId: AI_TEACHING_AGENT_ID };
    const runtimeSignals = deriveTeachingRuntimeSignals(context);
    const openingMode: TeachingOpening['mode'] = context.taskType === 'project'
      || context.taskType === 'practice'
      || runtimeSignals.confidenceLevel === 'anxious'
      ? 'example-first'
      : runtimeSignals.recentTrend === 'improving'
        && runtimeSignals.recommendedPacing !== 'slow'
        ? 'predict'
        : 'self-assess';
    let response: any = null;
    try {
      response = await withTimeout(gateway.execute({
        messages: [
          {
            role: 'system',
            content: `你是一位经验丰富的 AI 教师。请为本节课生成一个“开场交互块”，输出严格 JSON。

格式：
{
  "message": "1-2 句开场定位，不要像通知",
  "question": "一句低门槛互动问题",
  "quickReplies": [{"text":"选项1"}, {"text":"选项2"}, {"text":"选项3"}]
}

要求：
1. 只输出 JSON
2. 开场要有互动感，不要只是宣布上课
3. question 必须容易回答，适合学生立即回应
4. quickReplies 提供 2-3 个短选项，适合一键点击
5. 结合任务类型、当前阶段、学习者信心与节奏来决定 opening 风格
6. 如果 mode = example-first，优先从一个小例子或具体切入口打开
7. 如果 mode = predict，优先让学生先猜或先判断
8. 如果 mode = self-assess，优先让学生快速自评当前熟悉度或难点`
        },
        {
          role: 'user',
          content: JSON.stringify({
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
          })
          }
        ]
      }, caller, { userId: context.userId }), 8000, 'OPENING_GENERATION_TIMEOUT');
    } catch (error) {
      logger.error('[AITeaching] 开场交互块生成失败，已中止会话启动', {
        error: error instanceof Error ? error.message : String(error),
        userId: context.userId,
        taskId: context.taskId,
        topic: context.topic,
      });
      throw error instanceof Error ? error : new Error(String(error));
    }

    try {
      const content = response?.choices?.[0]?.message?.content || '{}';
      const parsed = JSON.parse(content);
      const quickReplies = Array.isArray(parsed?.quickReplies)
        ? parsed.quickReplies
            .map((item: any) => typeof item?.text === 'string' ? { text: item.text.trim() } : null)
            .filter((item: any) => item && item.text)
            .slice(0, 3)
        : [];

      if (typeof parsed?.message === 'string' && typeof parsed?.question === 'string' && quickReplies.length > 0) {
        return {
          message: parsed.message.trim(),
          question: parsed.question.trim(),
          quickReplies,
          mode: openingMode,
        };
      }
    } catch (error) {
      logger.error('[AITeaching] 开场交互块解析失败，已中止会话启动', {
        error: error instanceof Error ? error.message : String(error),
        userId: context.userId,
        taskId: context.taskId,
        topic: context.topic,
        rawContent: response?.choices?.[0]?.message?.content || null,
      });
      throw error instanceof Error ? error : new Error(String(error));
    }

    logger.error('[AITeaching] 开场交互块缺少有效结构，已中止会话启动', {
      userId: context.userId,
      taskId: context.taskId,
      topic: context.topic,
      rawContent: response?.choices?.[0]?.message?.content || null,
    });
    throw new Error('OPENING_GENERATION_INVALID');
  }

  async processStudentMessage(
    sessionId: string,
    message: string,
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
    autoEnded?: boolean;
    wrapup?: SessionWrapupArtifact & {
      stateUpdate: LearningStateMetrics | null;
      duration: number;
      summarySource: 'model' | 'fallback';
      evaluationSource: 'model' | 'ai-fallback' | 'failed';
    };
    advisory?: ReplanAdvisory;
  }> {
    const session = await teachingSessionRepository.getById(sessionId);
    if (!session || session.status !== 'active') {
      throw new Error('会话不存在或已结束，请重新开始授课');
    }

    const context = await buildTeachingScenarioContext(session.userId, session.taskId, session);
    const endIntent = detectEndIntent(message);

    const updatedMessages = appendTimestamp([
      ...session.messages,
      {
        role: 'user',
        content: message,
        timestamp: new Date().toISOString(),
      }
    ]);

    const turnInput = buildTeachingTurnInput({
      ...session,
      messages: updatedMessages,
    }, context);
    const turnResult = await teachingTurnAgentHandler(turnInput);
    if (!turnResult.success) {
      throw new Error(typeof turnResult.error === 'string' ? turnResult.error : turnResult.error?.message || 'TEACHING_TURN_FAILED');
    }

    const rawTeachingOutput = extractTeachingOutput(turnResult);
    const promptDebug = extractTeachingPromptDebug(turnResult);
    const { teachingOutput, existingPoints } = reconcileTeachingKnowledgeState(context, rawTeachingOutput, session.knowledgeState);
    const mergedKnowledge = knowledgeStateService.merge(
      existingPoints,
      teachingOutput.knowledge.points
    );
    const previousTeachingState = session.teachingState || {};
    const previousClassroomStage = (previousTeachingState.classroomContext?.stage?.current as LearnStage) || 'opening';
    const peerTriggered = peerTriggerService.shouldTrigger(session, teachingOutput, message);
    let peerMessage: string | undefined;
    let peerDebug: any = null;

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
      const peerResult = await peerAgentHandler(peerInput, {
        userId: session.userId,
        sessionId: session.id,
      });

      if (peerResult.success) {
        peerMessage = peerResult.internal?.ext?.peer?.message || peerResult.userVisible || '';
        peerDebug = extractPeerDebug(peerResult);
      }
    }

    const nextStageDecision = determineNextStage({
      currentStage: previousClassroomStage,
      teachingOutput,
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
      teachingOutput,
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

    if (teachingOutput.control.isCompletionCandidate) {
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

    const sessionArtifacts = parseSessionArtifacts(previousTeachingState);
    const teachingControlContext = buildTeachingControlContext(
      nextStageDecision.stage,
      context,
      learnerStateContext,
      {
        ...sessionArtifacts,
        endReason: endIntent.isEndIntent
          ? 'learner-requested-end'
          : teachingOutput.control.isCompletionCandidate
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
          completionCandidate: teachingOutput.control.isCompletionCandidate,
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

    const persistedMessages = [...updatedMessages, assistantMessage];
    const previousMetrics = extractTeachingStateMetrics(previousTeachingState)
      || learningStateService.coerceMetrics(context.learningState)
      || null;
    const currentState = learningStateService.calculateRuntimeState(previousMetrics, {
      difficulty: Math.max(1, Math.min(10, teachingOutput.analysis.levelScore + 2)),
      cognitiveLoad: Math.max(1, Math.min(10, (1 - teachingOutput.analysis.understanding + 0.3) * 8)),
      efficiency: teachingOutput.analysis.engagement,
      timeSpent: 1,
      expectedTime: 15,
      completionRate: 1,
      taskType: context.taskType,
    });

    const teachingState = {
      ...currentState,
      analysis: teachingOutput.analysis,
      strategies: teachingOutput.pedagogy.strategies,
      completionCandidate: teachingOutput.control.isCompletionCandidate,
      peerTriggered,
      learnerStateContext,
      classroomContext,
      classroomEventHistory: classroomEvents.slice(-40),
      stageHistory,
      teachingControlContext,
      sessionArtifacts: {
        ...parseSessionArtifacts(session.teachingState),
        endReason: endIntent.isEndIntent
          ? 'learner-requested-end'
          : teachingOutput.control.isCompletionCandidate
            ? 'completion-candidate'
            : parseSessionArtifacts(session.teachingState).endReason,
      },
    };

    await teachingSessionRepository.updateTurnState(sessionId, {
      messages: persistedMessages,
      knowledgeState: mergedKnowledge,
      teachingState,
    });

    await learningService.markTaskInProgress(session.taskId, session.userId);

    const baseResult = {
      analysis: teachingOutput.analysis,
      aiResponse: teachingOutput.reply,
      strategies: teachingOutput.pedagogy.strategies,
      knowledgePoint: teachingOutput.knowledge.currentPoint,
      knowledgePoints: normalizeKnowledgePoints(mergedKnowledge),
      isCompletion: teachingOutput.control.isCompletionCandidate,
      currentState,
      peerTriggered,
      peerMessage,
      promptDebug,
      peerDebug,
    };

    if (endIntent.isEndIntent || teachingOutput.control.isCompletionCandidate) {
      const ended = await this.endSession(sessionId);
      return {
        ...baseResult,
        autoEnded: true,
        wrapup: ended.wrapup,
        advisory: ended.advisory,
      };
    }

    return baseResult;
  }

  async endSession(sessionId: string): Promise<{
    wrapup: SessionWrapupArtifact & {
      stateUpdate: LearningStateMetrics | null;
      duration: number;
      summarySource: 'model' | 'fallback';
      evaluationSource: 'model' | 'ai-fallback' | 'failed';
    };
    advisory: ReplanAdvisory;
  }> {
    const session = await teachingSessionRepository.getById(sessionId);
    if (!session) {
      throw new Error('会话不存在或已结束');
    }

    const durationMinutes = computeEffectiveDurationMinutes(session);
    const sessionArtifacts = parseSessionArtifacts(session.teachingState);
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

    const wrapupResult = await sessionWrapupAgent.generate({
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
        endReason: sessionArtifacts.endReason || 'manual-end',
      },
    });

    const wrapupArtifact = toWrapupArtifact(wrapupResult, {
      messages: session.messages,
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
        endReason: sessionArtifacts.endReason || 'manual-end',
      },
    });

    const evaluationResult = wrapupResult.evaluation
      ? {
          source: wrapupResult.evaluationSource,
          evaluation: wrapupResult.evaluation,
        }
      : null;

    const finalState = evaluationResult
      ? await learningStateService.calculateAndUpdateFromSessionScore(session.userId, {
          sessionLss: evaluationResult.evaluation.sessionLss,
          sessionKtl: evaluationResult.evaluation.sessionKtl,
          sessionLf: evaluationResult.evaluation.sessionLf,
          durationMinutes,
          confidence: evaluationResult.evaluation.confidence,
          pathId: session.learningPathId || null,
          taskId: session.taskId,
          sessionId,
        })
      : null;

    const lastAnalyzedMessage = [...session.messages].reverse().find((message) => !!message.analysis);

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
    };

    await teachingSessionRepository.complete(sessionId, {
      messages: session.messages,
      knowledgeState: session.knowledgeState,
      teachingState: finalState ? {
        ...finalState,
        sessionArtifacts,
      } : {
        sessionArtifacts,
      },
      wrapup: persistedWrapup,
      advisory: null,
      duration: durationMinutes,
    });

    const learnerSnapshot = await learnerSnapshotRefreshService.refresh({
      userId: session.userId,
      pathId: session.learningPathId || undefined,
      milestoneId: session.milestoneId || undefined,
      taskId: session.taskId,
      scope: 'teaching',
    });
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

    await prisma.teaching_sessions.update({
      where: { id: sessionId },
      data: {
        wrapup: JSON.stringify(finalWrapup),
        advisory: JSON.stringify(advisory),
        updatedAt: new Date(),
      }
    });

    void getEventBus().emit({
      type: 'lesson:completed',
      source: AI_TEACHING_AGENT_ID,
      userId: session.userId,
      sessionId: session.id,
        data: {
          lessonId: session.id,
          sessionId: session.id,
          taskId: session.taskId,
          pathId: session.learningPathId,
          performance: evaluationResult ? persistedEvaluation : null,
          knowledgeState: session.knowledgeState,
          visibleDialogueContext: session.messages.slice(-16).map((message) => ({
            role: message.role,
            content: message.content,
            analysis: message.analysis || null,
          })),
          classroomEventHistory,
          wrapup: finalWrapup,
          advisory,
        },
      });

    void dashboardGuidanceSnapshotService.refresh(session.userId, 'lesson-wrapup');

    return {
      wrapup: finalWrapup,
      advisory,
    };
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
    };
  }

  async pauseSession(
    sessionId: string,
    userId: string,
    reason: 'manual' | 'pagehide' = 'manual'
  ): Promise<void> {
    const session = await teachingSessionRepository.getById(sessionId);
    if (!session || session.userId !== userId) {
      throw new Error('会话不存在');
    }
    if (session.status === 'completed') {
      throw new Error('已结束的会话无法暂停');
    }

    const sessionArtifacts = parseSessionArtifacts(session.teachingState);
    if (session.status === 'paused' && sessionArtifacts.pausedAt) {
      return;
    }

    await teachingSessionRepository.updateLifecycleState(sessionId, {
      status: 'paused',
      endTime: null,
      duration: null,
      teachingState: buildTeachingStateWithArtifacts(session.teachingState, {
        ...sessionArtifacts,
        pausedAt: new Date().toISOString(),
        pauseReason: reason,
      }),
    });
  }

  async resetSession(sessionId: string, userId: string): Promise<void> {
    const session = await teachingSessionRepository.getById(sessionId);
    if (!session || session.userId !== userId) {
      throw new Error('会话不存在');
    }
    if (session.status === 'completed') {
      throw new Error('已结束的会话无法重置');
    }

    await teachingSessionRepository.updateLifecycleState(sessionId, {
      status: 'completed',
      endTime: new Date(),
      duration: computeEffectiveDurationMinutes(session),
      teachingState: buildTeachingStateWithArtifacts(session.teachingState, {
        ...parseSessionArtifacts(session.teachingState),
        resetAt: new Date().toISOString(),
      }),
    });
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
    const sessions = await prisma.teaching_sessions.findMany({
      where: { status: 'active' },
      select: {
        id: true,
        updatedAt: true,
      }
    });

    const now = Date.now();
    for (const session of sessions) {
      const idleTime = now - new Date(session.updatedAt).getTime();
      if (idleTime > this.idleTimeoutMs) {
        await prisma.teaching_sessions.update({
          where: { id: session.id },
          data: {
            status: 'timeout',
            endTime: new Date(),
            updatedAt: new Date(),
          }
        });
      }
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

    if (!this.peerMessages.has(sessionId)) {
      this.peerMessages.set(sessionId, []);
    }
    const peerHistory = this.peerMessages.get(sessionId)!;
    peerHistory.push({ role: 'user', content: message });

    const peerResult = await peerAgentHandler({
      topic: session.topic,
      strategy: 'feynman',
      studentMessage: message,
      tutorContext: session.messages.slice(-6).map((item) => ({
        role: item.role,
        content: item.content,
      })),
      cognitiveLevel: (session.teachingState as any)?.analysis?.cognitiveLevel,
      understanding: (session.teachingState as any)?.analysis?.understanding,
    }, {
      userId: session.userId,
      sessionId: session.id,
    });

    if (!peerResult.success) {
      throw new Error(typeof peerResult.error === 'string' ? peerResult.error : peerResult.error?.message || 'PEER_TURN_FAILED');
    }

    const peerResponse = peerResult.internal?.ext?.peer?.message || peerResult.userVisible || '';
    peerHistory.push({ role: 'assistant', content: peerResponse });
    return { peerResponse };
  }
}

export const aiTeachingOrchestrator = new AITeachingOrchestrator();
export default aiTeachingOrchestrator;
