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

function buildTeachingStateWithArtifacts(
  teachingState: Record<string, any> | null | undefined,
  sessionArtifacts: Record<string, any>
) {
  return {
    ...(teachingState || {}),
    sessionArtifacts,
  };
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

  return {
    messages: compression.messages,
    scenario: {
      subject: context.subject,
      topic: context.topic,
      taskTitle: context.taskTitle,
      taskDescription: context.taskDescription,
      taskType: context.taskType,
      taskProfile: context.taskProfile,
      teachingStrategyGuidance: context.teachingStrategyGuidance,
      pathTitle: context.teachingProjection.pathContext.pathTitle,
      pathSummary: context.teachingProjection.pathContext.pathSummary,
      currentMilestoneTitle: context.teachingProjection.pathContext.currentMilestoneTitle,
      currentStageNumber: context.teachingProjection.pathContext.currentStageNumber,
      currentTaskOrder: context.teachingProjection.pathContext.currentTaskOrder,
      totalTasksInMilestone: context.teachingProjection.pathContext.totalTasksInMilestone,
      taskKnowledgeScope: context.taskKnowledgeScope,
      contextCompression: compression.compressed ? {
        enabled: true,
        estimatedTokens: compression.estimatedTokens,
        triggerTokens: compression.triggerTokens,
        recap: compression.recap,
      } : undefined,
    },
    learner: {
      profile: context.userProfile,
      currentState: context.learningState,
      projection: context.teachingProjection,
    },
    knowledge: {
      points: session.knowledgeState,
    },
    controls: {
      mode: session.mode as TeachingMode,
    }
  };
}

function normalizeConcept(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized || null;
}

function buildTaskKnowledgeCandidates(context: TeachingScenarioContext, currentPoint: string | null): string[] {
  return Array.from(new Set([
    ...context.taskKnowledgeScope.primaryConcepts,
    ...context.taskKnowledgeScope.prerequisiteConcepts,
    currentPoint,
  ].map((item) => normalizeConcept(item)).filter(Boolean) as string[]));
}

function isTaskScopedKnowledgePoint(name: string, candidates: string[]): boolean {
  const normalized = normalizeConcept(name);
  if (!normalized) return false;
  return candidates.some((candidate) => {
    const lowerName = normalized.toLowerCase();
    const lowerCandidate = candidate.toLowerCase();
    return lowerName === lowerCandidate || lowerName.includes(lowerCandidate) || lowerCandidate.includes(lowerName);
  });
}

function filterTaskScopedKnowledgePoints(
  context: TeachingScenarioContext,
  output: TeachingTurnOutput,
  existingPoints: TeachingKnowledgePointState[]
) {
  const candidates = buildTaskKnowledgeCandidates(context, output.knowledge.currentPoint);
  const filteredOutputPoints = output.knowledge.points.filter((point) => isTaskScopedKnowledgePoint(point.name, candidates));
  const filteredExistingPoints = existingPoints.filter((point) => isTaskScopedKnowledgePoint(point.name, candidates));

  return {
    ...output,
    knowledge: {
      ...output.knowledge,
      currentPoint: isTaskScopedKnowledgePoint(output.knowledge.currentPoint || '', candidates)
        ? output.knowledge.currentPoint
        : filteredOutputPoints[0]?.name || filteredExistingPoints[0]?.name || null,
      points: filteredOutputPoints.slice(0, 5),
    }
  } as TeachingTurnOutput;
}

function extractTeachingOutput(agentOutput: any): TeachingTurnOutput {
  return agentOutput?.internal?.ext?.teaching as TeachingTurnOutput;
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
        sessionArtifacts: {
          initialKnowledgeState: context.previousSession?.knowledgePoints || [],
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
    const openingMode: TeachingOpening['mode'] = context.taskType === 'project'
      || context.taskType === 'practice'
      || context.teachingProjection.stableProfile.confidenceLevel === 'anxious'
      ? 'example-first'
      : context.teachingProjection.liveState.recentTrend === 'improving'
        && context.teachingProjection.liveState.recommendedPacing !== 'slow'
        ? 'predict'
        : 'self-assess';
    const response = await gateway.execute({
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
            pathSummary: context.pathContext.pathSummary,
            currentMilestoneTitle: context.teachingProjection.pathContext.currentMilestoneTitle,
            learner: {
              preferredStyle: context.teachingProjection.stableProfile.preferredStyle,
              confidenceLevel: context.teachingProjection.stableProfile.confidenceLevel,
              recentTrend: context.teachingProjection.liveState.recentTrend,
              recommendedPacing: context.teachingProjection.liveState.recommendedPacing,
              fragile: context.teachingProjection.relevantKnowledge.fragile.slice(0, 3),
              struggling: context.teachingProjection.relevantKnowledge.struggling.slice(0, 3),
            },
            openingMode,
          })
        }
      ]
    }, caller, { userId: context.userId });

    try {
      const content = response.choices[0]?.message.content || '{}';
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
    } catch {
      // ignore and use fallback
    }

    const fallbackQuickReplies = openingMode === 'predict'
      ? [{ text: '我先猜一下' }, { text: '先给我一个例子' }, { text: '我会一点' }]
      : openingMode === 'example-first'
        ? [{ text: '先给我一个最小例子' }, { text: '一步步带我做' }, { text: '我想先自己试试' }]
        : [{ text: '我完全不会' }, { text: '我知道一点' }, { text: '直接开始吧' }];

    return {
      message: `这节我们聚焦 **${context.topic}**，我会结合你当前的学习状态，用尽量顺手的方式带你进入这个任务。`,
      question: openingMode === 'predict'
        ? '开始前，你想先猜一下这题/这个概念会怎么走，还是先看一个例子？'
        : openingMode === 'example-first'
          ? '开始前，你更希望我先给一个最小例子，还是一步一步带你拆开？'
          : '开始前，你觉得自己对这块是完全陌生、知道一点，还是已经做过类似内容？',
      quickReplies: fallbackQuickReplies,
      mode: openingMode,
    };
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
  }> {
    const session = await teachingSessionRepository.getById(sessionId);
    if (!session || session.status !== 'active') {
      throw new Error('会话不存在或已结束，请重新开始授课');
    }

    const context = await buildTeachingScenarioContext(session.userId, session.taskId, session);

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
    const teachingOutput = filterTaskScopedKnowledgePoints(context, rawTeachingOutput, session.knowledgeState);
    const mergedKnowledge = knowledgeStateService.merge(
      session.knowledgeState.filter((point) => isTaskScopedKnowledgePoint(point.name, buildTaskKnowledgeCandidates(context, teachingOutput.knowledge.currentPoint))),
      teachingOutput.knowledge.points
    );
    const peerTriggered = peerTriggerService.shouldTrigger(session, teachingOutput, message);
    const assistantMessage: TeachingSessionMessage = {
      role: 'assistant',
      content: teachingOutput.reply,
      timestamp: new Date().toISOString(),
      analysis: teachingOutput.analysis,
    };

    const persistedMessages = [...updatedMessages, assistantMessage];
    const currentState = await learningStateService.calculateAndUpdate(session.userId, {
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
      sessionArtifacts: parseSessionArtifacts(session.teachingState),
    };

    await teachingSessionRepository.updateTurnState(sessionId, {
      messages: persistedMessages,
      knowledgeState: mergedKnowledge,
      teachingState,
    });

    await learningService.markTaskInProgress(session.taskId, session.userId);

    return {
      analysis: teachingOutput.analysis,
      aiResponse: teachingOutput.reply,
      strategies: teachingOutput.pedagogy.strategies,
      knowledgePoint: teachingOutput.knowledge.currentPoint,
      knowledgePoints: normalizeKnowledgePoints(mergedKnowledge),
      isCompletion: teachingOutput.control.isCompletionCandidate,
      currentState,
      peerTriggered,
      peerMessage: undefined,
    };
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
        recentTrend: context.teachingProjection.liveState.recentTrend,
        recommendedPacing: context.teachingProjection.liveState.recommendedPacing,
      } : undefined,
      knowledgeContext: {
        initialPoints: initialKnowledgeState,
        delta: knowledgeDelta,
      },
      sessionEvidence,
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
        recentTrend: context.teachingProjection.liveState.recentTrend,
        recommendedPacing: context.teachingProjection.liveState.recommendedPacing,
      } : undefined,
      knowledgeContext: {
        initialPoints: initialKnowledgeState,
        delta: knowledgeDelta,
      },
      sessionEvidence,
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
          durationMinutes,
          confidence: evaluationResult.evaluation.confidence,
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
          wrapup: finalWrapup,
          advisory,
        },
      });

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
