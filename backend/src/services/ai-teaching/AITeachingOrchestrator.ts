import { logger } from '../../utils/logger';
import prisma from '../../config/database';
import learningStateService, { LearningStateMetrics } from '../learning/learning-state.service';
import { summaryAgent, type SummaryOutput } from '../../agents/summary-agent';
import { sessionEvaluationAgent } from '../../agents/session-evaluation-agent';
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
}

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
      pathTitle: context.teachingProjection.pathContext.pathTitle,
      pathSummary: context.teachingProjection.pathContext.pathSummary,
      currentMilestoneTitle: context.teachingProjection.pathContext.currentMilestoneTitle,
      currentStageNumber: context.teachingProjection.pathContext.currentStageNumber,
      currentTaskOrder: context.teachingProjection.pathContext.currentTaskOrder,
      totalTasksInMilestone: context.teachingProjection.pathContext.totalTasksInMilestone,
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
  }> {
    const previousSession = await teachingSessionRepository.getActiveByTask(input.userId, input.taskId);
    const context = await buildTeachingScenarioContext(input.userId, input.taskId, previousSession);

    const sessionId = buildSessionId(input.userId);
    const welcomeMessage = await this.generateWelcomeMessage(context);

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
        }
      ],
      knowledgeState: context.previousSession?.knowledgePoints || [],
      teachingState: context.learningState ? {
        ...context.learningState,
      } : null,
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
    };
  }

  private async generateWelcomeMessage(context: TeachingScenarioContext): Promise<string> {
    const gateway = getAPIGateway();
    const caller: CallerInfo = { agentId: AI_TEACHING_AGENT_ID };
    const response = await gateway.execute({
      messages: [
        {
          role: 'system',
          content: '你是一位经验丰富的 AI 教师。请用 120 字以内生成课堂开场白，说明本节学习主题和目标，语气自然友好，可使用 Markdown。'
        },
        {
          role: 'user',
          content: JSON.stringify({
            subject: context.subject,
            topic: context.topic,
            taskTitle: context.taskTitle,
            pathSummary: context.pathContext.pathSummary,
          })
        }
      ]
    }, caller, { userId: context.userId });

    return response.choices[0]?.message.content || `欢迎来到 **${context.subject}** 学习。本节我们聚焦 **${context.topic}**，一起把这个任务真正学明白。`;
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

    const teachingOutput = extractTeachingOutput(turnResult);
    const mergedKnowledge = knowledgeStateService.merge(session.knowledgeState, teachingOutput.knowledge.points);
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
    };

    await teachingSessionRepository.updateTurnState(sessionId, {
      messages: persistedMessages,
      knowledgeState: mergedKnowledge,
      teachingState,
    });

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
    summary: SummaryOutput;
    summarySource: 'model' | 'fallback';
    finalState: LearningStateMetrics | null;
    duration: number;
    evaluation?: {
      lss: number;
      ktl: number;
      lf: number;
      lsb: number;
      sessionLss: number;
      sessionKtl: number;
      sessionLf: number;
      confidence: number;
      evaluationSource: 'model' | 'fallback';
      messageCount: number;
      avgUnderstanding: number;
      avgCognitiveLevel: string;
      duration: number;
    };
  }> {
    const session = await teachingSessionRepository.getById(sessionId);
    if (!session) {
      throw new Error('会话不存在或已结束');
    }

    const durationMinutes = Math.max(1, Math.round((Date.now() - session.startTime.getTime()) / 60000));

    const evaluationResult = await sessionEvaluationAgent.evaluate({
      messages: session.messages.map((message) => ({
        role: message.role,
        content: message.content,
        timestamp: new Date(message.timestamp),
      })),
      knowledgePoints: session.knowledgeState,
      sessionInfo: {
        subject: session.subject,
        topic: session.topic,
        durationMinutes,
        userMessageCount: session.messages.filter((message) => message.role === 'user').length,
        assistantMessageCount: session.messages.filter((message) => message.role === 'assistant').length,
      }
    });

    const finalState = await learningStateService.calculateAndUpdateFromSessionScore(session.userId, {
      sessionLss: evaluationResult.evaluation.sessionLss,
      durationMinutes,
      confidence: evaluationResult.evaluation.confidence,
    });

    const summaryResult = await summaryAgent.generate({
      messages: session.messages.map((message) => ({
        role: message.role,
        content: message.content,
        timestamp: new Date(message.timestamp),
      })),
      knowledgePoints: session.knowledgeState,
      learningState: finalState ? {
        lss: finalState.lss,
        ktl: finalState.ktl,
        lf: finalState.lf,
        lsb: finalState.lsb,
      } : undefined,
      sessionInfo: {
        subject: session.subject,
        topic: session.topic,
        duration: durationMinutes,
        messageCount: session.messages.filter((message) => message.role === 'user').length,
      }
    });

    const lastAnalyzedMessage = [...session.messages].reverse().find((message) => !!message.analysis);

    const persistedEvaluation = {
      ...evaluationResult.evaluation,
      lss: finalState.lss,
      ktl: finalState.ktl,
      lf: finalState.lf,
      lsb: finalState.lsb,
      evaluationSource: evaluationResult.source,
      messageCount: session.messages.filter((message) => message.role === 'user').length,
      avgUnderstanding: session.messages
        .filter((message) => message.analysis)
        .reduce((sum, message, _index, array) => sum + (message.analysis?.understanding || 0), 0) / Math.max(1, session.messages.filter((message) => message.analysis).length),
      avgCognitiveLevel: lastAnalyzedMessage?.analysis?.cognitiveLevel || 'understand',
      duration: durationMinutes,
    };

    await teachingSessionRepository.complete(sessionId, {
      messages: session.messages,
      knowledgeState: session.knowledgeState,
      teachingState: finalState ? {
        ...finalState,
      } : null,
      summary: summaryResult.summary,
      evaluation: persistedEvaluation,
      duration: durationMinutes,
    });

    void learnerSnapshotRefreshService.refresh({
      userId: session.userId,
      pathId: session.learningPathId || undefined,
      milestoneId: session.milestoneId || undefined,
      taskId: session.taskId,
      scope: 'teaching',
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
        performance: persistedEvaluation,
      },
    });

    return {
      summary: summaryResult.summary,
      summarySource: summaryResult.source,
      finalState,
      duration: durationMinutes,
      evaluation: persistedEvaluation,
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
    };
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
    summary: SummaryOutput;
    summarySource?: 'model' | 'fallback';
    evaluation: any;
  } | null> {
    const sessions = await teachingSessionRepository.listByUser(userId);
    const target = sessions
      .filter((session) => session.taskId === taskId && session.status === 'completed' && session.summary && session.evaluation)
      .sort((a, b) => (b.endTime?.getTime() || 0) - (a.endTime?.getTime() || 0))[0];

    if (!target || !target.summary || !target.evaluation) {
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
      summary: target.summary as SummaryOutput,
      summarySource: 'model',
      evaluation: target.evaluation,
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
