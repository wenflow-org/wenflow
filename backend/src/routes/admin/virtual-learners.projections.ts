/**
 * 读侧投影：会话/画像投影构造 helper + 记忆、故事、授课详情 3 个读端点
 *
 * 由 routes/admin/virtual-learners.ts 于 2026-10-19（issue #76）按声明簇纯搬移拆出（L263–L767、L826–L1054）。
 * 契约不变：路由路径、注册顺序、中间件与处理器代码逐字未改；本文件只导出注册函数，
 * 由 virtual-learners.ts 在**同一个** router 实例上按原顺序调用（Express 顺序匹配语义与拆分前一致）。
 * 为保持逐行可 diff，搬移文本未重新缩进：register 函数体内的路由仍沿用原文件缩进（column 0）。
 */

import { type Router, type Request } from 'express';
import type { goal_conversations } from '../../services/prisma-client-types';
import { findProfileById, findProfileWithRecentSessions, findMemoryTracesByUser } from '../../services/virtual-lab/virtual-learner-profile.repo';
import { findSessionById } from '../../services/virtual-lab/virtual-session.repo';
import { logger } from '../../utils/logger';
import { teachingSessionRepository, type TeachingSessionRecord } from '../../services/ai-teaching/TeachingSessionRepository';
import { buildLearnerMemorySnapshot } from '../../virtual-lab/learner-memory';
import { buildRetentionSeriesForConcepts, type RetentionConceptInput } from '../../services/memory/retention-series';
import { simulatedNowOr } from '../../services/virtual-lab/simulation-clock-context';
import type { SimulationLogEntry } from '../../coordinators/simulation.types';
import type { StageResults, VirtualSessionRow } from '../../virtual-lab/vlab-types';
import { parseJson, ensureProfileStoryPool, isSameStory } from '../../virtual-lab/session-factory';

// ===== 原 virtual-learners.ts L263–L767 =====
export function parseStoryContext(session: VirtualSessionRow) {
  try {
    const stageResults = JSON.parse(session.stageResults || '{}');
    return stageResults.story || null;
  } catch {
    return null;
  }
}

export function parseLearningProgress(session: VirtualSessionRow) {
  try {
    const stageResults = JSON.parse(session.stageResults || '{}');
    return stageResults.teaching || {};
  } catch {
    return {};
  }
}

export function parseStageResults(session: VirtualSessionRow) {
  try {
    return JSON.parse(session.stageResults || '{}');
  } catch {
    return {};
  }
}

function parseLogs(session: VirtualSessionRow) {
  try {
    const logs = JSON.parse(session.logs || '[]');
    return Array.isArray(logs) ? logs : [];
  } catch {
    return [];
  }
}

function buildLearningConversationProjection(logs: SimulationLogEntry[] = []) {
  const conversation: Array<{ role: 'assistant' | 'user'; content: string; phase: string; timestamp?: string | null }> = [];

  for (const log of logs) {
    if (log?.phase === 'teaching-start' && log?.details?.output?.welcomeMessage) {
      conversation.push({
        role: 'assistant',
        content: String(log.details.output.welcomeMessage),
        phase: 'teaching-start',
        timestamp: log.timestamp || null,
      });
    }

    if (log?.phase === 'teaching-reply' && log?.details?.output?.reply) {
      conversation.push({
        role: 'user',
        content: String(log.details.output.reply),
        phase: 'teaching-reply',
        timestamp: log.timestamp || null,
      });
    }

    if (log?.phase === 'teaching-response' && log?.details?.output?.aiResponse) {
      conversation.push({
        role: 'assistant',
        content: String(log.details.output.aiResponse),
        phase: 'teaching-response',
        timestamp: log.timestamp || null,
      });
    }
  }

  return conversation;
}

function buildLearningConversationRoundsProjection(logs: SimulationLogEntry[] = []) {
  const rounds: Array<{
    round: number;
    isOpening: boolean;
    timestamp?: string | null;
    learnerMessage: { role: 'user'; content: string; timestamp?: string | null } | null;
    assistantMessage: { role: 'assistant'; content: string; timestamp?: string | null } | null;
    knowledgePoints: unknown[];
    currentState: Record<string, unknown> | null;
    currentTask: string | null;
    currentMilestone: string | null;
    strategies: string[];
    cognitiveLevel: string | null;
    knowledgePoint: string | null;
    isCompletion: boolean;
    autoEnded: boolean;
    peerTriggered: boolean;
    peerMessage: string | null;
    learnerState: Record<string, unknown> | null;
    learnerFeedback: Record<string, unknown> | null;
    closureDecision: Record<string, unknown> | null;
    emotion: string | null;
  }> = [];

  let pendingLearner: {
    timestamp?: string | null;
    content: string;
    currentTask: string | null;
    currentMilestone: string | null;
    learnerState: Record<string, unknown> | null;
    learnerFeedback: Record<string, unknown> | null;
    emotion: string | null;
  } | null = null;
  let roundNumber = 0;

  for (const log of logs) {
    if (log?.phase === 'teaching-start' && log?.details?.output?.welcomeMessage) {
      rounds.push({
        round: roundNumber,
        isOpening: true,
        timestamp: log.timestamp || null,
        learnerMessage: null,
        assistantMessage: {
          role: 'assistant',
          content: String(log.details.output.welcomeMessage),
          timestamp: log.timestamp || null,
        },
        knowledgePoints: [],
        currentState: null,
        currentTask: log?.details?.output?.currentTask ? String(log.details.output.currentTask) : null,
        currentMilestone: log?.details?.output?.currentMilestone ? String(log.details.output.currentMilestone) : null,
        strategies: [],
        cognitiveLevel: null,
        knowledgePoint: null,
        isCompletion: false,
        autoEnded: false,
        peerTriggered: false,
        peerMessage: null,
        learnerState: null,
        learnerFeedback: null,
        closureDecision: null,
        emotion: null,
      });
      continue;
    }

    if (log?.phase === 'teaching-reply' && log?.details?.output?.reply) {
      pendingLearner = {
        timestamp: log.timestamp || null,
        content: String(log.details.output.reply),
        currentTask: log?.details?.output?.currentTask ? String(log.details.output.currentTask) : null,
        currentMilestone: log?.details?.output?.currentMilestone ? String(log.details.output.currentMilestone) : null,
        learnerState: log?.details?.output?.learnerState || null,
        learnerFeedback: log?.details?.output?.learnerFeedback || null,
        emotion: log?.details?.output?.emotion ? String(log.details.output.emotion) : null,
      };
      continue;
    }

    if (log?.phase === 'teaching-response' && pendingLearner) {
      roundNumber += 1;
      const output = log?.details?.output || {};
      rounds.push({
        round: roundNumber,
        isOpening: false,
        timestamp: log.timestamp || pendingLearner.timestamp || null,
        learnerMessage: {
          role: 'user',
          content: pendingLearner.content,
          timestamp: pendingLearner.timestamp || null,
        },
        assistantMessage: {
          role: 'assistant',
          content: output?.aiResponse ? String(output.aiResponse) : '',
          timestamp: log.timestamp || null,
        },
        knowledgePoints: Array.isArray(output?.knowledgePoints) ? output.knowledgePoints : [],
        currentState: (output?.currentState && typeof output.currentState === 'object' ? output.currentState : null) as Record<string, unknown> | null,
        currentTask: pendingLearner.currentTask,
        currentMilestone: pendingLearner.currentMilestone,
        strategies: Array.isArray(output?.strategies)
          ? output.strategies.filter((item: unknown) => typeof item === 'string' && item.trim())
          : [],
        cognitiveLevel: output?.cognitiveLevel ? String(output.cognitiveLevel) : null,
        knowledgePoint: output?.knowledgePoint ? String(output.knowledgePoint) : null,
        isCompletion: !!output?.isCompletion,
        autoEnded: !!output?.autoEnded,
        peerTriggered: !!output?.peerTriggered,
        peerMessage: output?.peerMessage ? String(output.peerMessage) : null,
        learnerState: pendingLearner.learnerState,
        learnerFeedback: pendingLearner.learnerFeedback,
        closureDecision: output?.closureDecision && typeof output.closureDecision === 'object' ? output.closureDecision : null,
        emotion: pendingLearner.emotion,
      });
      pendingLearner = null;
    }
  }

  if (pendingLearner) {
    roundNumber += 1;
    rounds.push({
      round: roundNumber,
      isOpening: false,
      timestamp: pendingLearner.timestamp || null,
      learnerMessage: {
        role: 'user',
        content: pendingLearner.content,
        timestamp: pendingLearner.timestamp || null,
      },
      assistantMessage: null,
      knowledgePoints: [],
      currentState: null,
      currentTask: pendingLearner.currentTask,
      currentMilestone: pendingLearner.currentMilestone,
      strategies: [],
      cognitiveLevel: null,
      knowledgePoint: null,
      isCompletion: false,
      autoEnded: false,
      peerTriggered: false,
      peerMessage: null,
      learnerState: pendingLearner.learnerState,
      learnerFeedback: pendingLearner.learnerFeedback,
      closureDecision: null,
      emotion: pendingLearner.emotion,
    });
  }

  const latestRound = [...rounds].reverse().find((item) => !item.isOpening) || null;

  return {
    rounds,
    latest: latestRound
      ? {
          knowledgePoints: latestRound.knowledgePoints,
          currentState: latestRound.currentState,
          currentTask: latestRound.currentTask,
          currentMilestone: latestRound.currentMilestone,
          strategies: latestRound.strategies,
          cognitiveLevel: latestRound.cognitiveLevel,
        }
      : {
          knowledgePoints: [],
          currentState: null,
          currentTask: null,
          currentMilestone: null,
          strategies: [],
          cognitiveLevel: null,
        },
  };
}

function buildGoalConversationProjection(goalConversation: goal_conversations | null | undefined, fallbackLogs: SimulationLogEntry[] = []) {
  if (goalConversation) {
    const data = parseJson<Record<string, unknown>>(goalConversation.collectedData, {});
    const messages = Array.isArray(data.messages) ? data.messages : [];

    return {
      source: 'goal-conversation',
      stage: goalConversation.stage || null,
      status: goalConversation.status || null,
      messages: messages.map((message, index: number) => ({
        id: message?.id || `goal-${index}`,
        role: message?.role === 'user' ? 'user' : 'assistant',
        content: typeof message?.content === 'string' ? message.content : '',
        timestamp: message?.timestamp || null,
      })).filter((message) => message.content),
      confidence: typeof data.confidence === 'number' ? data.confidence : 0,
      quickReplies: Array.isArray(data.questions_to_ask) ? data.questions_to_ask : [],
    };
  }

  const goalLogs = Array.isArray(fallbackLogs) ? fallbackLogs : [];
  const messages: Array<{ id: string; role: 'user' | 'assistant'; content: string; timestamp?: string | null }> = [];

  for (const log of goalLogs) {
    if (log?.phase === 'virtual-reply' && log?.details?.output?.reply) {
      messages.push({
        id: `goal-fallback-user-${messages.length}`,
        role: 'user',
        content: String(log.details.output.reply),
        timestamp: log.timestamp || null,
      });
    }

    if (log?.phase === 'goal-response' && log?.details?.output?.userVisible) {
      messages.push({
        id: `goal-fallback-ai-${messages.length}`,
        role: 'assistant',
        content: String(log.details.output.userVisible),
        timestamp: log.timestamp || null,
      });
    }
  }

  return {
    source: 'logs-fallback',
    stage: null,
    status: null,
    messages,
    confidence: 0,
    quickReplies: [],
  };
}

export function buildSessionConversations(session: VirtualSessionRow, logs: SimulationLogEntry[] = [], goalConversation?: goal_conversations | null) {
  const learningProjection = buildLearningConversationRoundsProjection(logs);
  return {
    goal: buildGoalConversationProjection(goalConversation, logs),
    learning: {
      source: 'session-logs',
      messages: buildLearningConversationProjection(logs),
      rounds: learningProjection.rounds,
      latest: learningProjection.latest,
    }
  };
}

export function buildSessionBindings(session: VirtualSessionRow) {
  const stageResults = parseStageResults(session);
  const learningState = stageResults.teaching || {};

  return {
    goalConversationId: session.goalConversationId || null,
    learningPathId: session.learningPathId || null,
    teachingSessionId: learningState.teachingSessionId || null,
    currentTaskId: learningState.currentTaskId || null,
  };
}

function buildSessionLearnerStateProjection(session: VirtualSessionRow, stageResults: StageResults, storyContext: Record<string, unknown> | null) {
  const goalState = stageResults.goal || {};
  const pathReviewState = stageResults.path_review || {};
  const learningState = stageResults.teaching || {};
  const goalLearnerState = (goalState.learnerState && typeof goalState.learnerState === 'object' ? goalState.learnerState : null) as Record<string, unknown> | null;
  const pathReviewLearnerState = (pathReviewState.learnerState && typeof pathReviewState.learnerState === 'object' ? pathReviewState.learnerState : null) as Record<string, unknown> | null;
  const learningLearnerState = (learningState.learnerState && typeof learningState.learnerState === 'object' ? learningState.learnerState : null) as Record<string, unknown> | null;

  const common = {
    emotion: learningLearnerState?.emotion || goalLearnerState?.emotion || null,
    confusionLevel: learningLearnerState?.confusionLevel ?? goalLearnerState?.confusionLevel ?? null,
    frustrationLevel: learningLearnerState?.frustrationLevel ?? goalLearnerState?.frustrationLevel ?? null,
    motivationLevel: learningLearnerState?.motivationLevel ?? goalLearnerState?.motivationLevel ?? null,
    attentionLevel: learningLearnerState?.attentionLevel ?? goalLearnerState?.attentionLevel ?? null,
    persistenceLevel: learningLearnerState?.persistenceLevel ?? goalLearnerState?.persistenceLevel ?? null,
    selfPerceivedMastery: learningLearnerState?.selfPerceivedMastery ?? goalLearnerState?.selfPerceivedMastery ?? null,
    actualMastery: learningLearnerState?.actualMastery ?? goalLearnerState?.actualMastery ?? null,
    remainingUnknowns: Array.isArray(goalLearnerState?.remainingUnknowns)
      ? goalLearnerState.remainingUnknowns
      : Array.isArray(learningLearnerState?.remainingBlockers)
        ? learningLearnerState.remainingBlockers
        : [],
    storyPressurePoints: Array.isArray(storyContext?.pressurePoints) ? storyContext.pressurePoints : [],
    storyBehaviorHooks: Array.isArray(storyContext?.behaviorHooks) ? storyContext.behaviorHooks : [],
  };

  return {
    currentStage: session.currentStage,
    common,
    goal: goalLearnerState,
    pathReview: pathReviewLearnerState,
    learning: learningLearnerState,
    latest: learningLearnerState || pathReviewLearnerState || goalLearnerState || common,
  };
}

function buildSessionKnowledgeProjection(stageResults: StageResults, logs: SimulationLogEntry[] = [], teachingSession?: TeachingSessionRecord) {
  const learningState = stageResults.teaching || {};
  const learningConversation = Array.isArray(learningState.conversationHistory) ? learningState.conversationHistory : [];
  const latestLearningResponse = [...logs].reverse().find((log) => log?.phase === 'teaching-response')?.details?.output || {};
  const teachingKnowledgePoints = Array.isArray(teachingSession?.knowledgeState) ? teachingSession.knowledgeState : [];
  const knowledgePoints = teachingKnowledgePoints.length
    ? teachingKnowledgePoints
    : (Array.isArray(latestLearningResponse.knowledgePoints) ? latestLearningResponse.knowledgePoints : []);
  const teachingState = (teachingSession?.teachingState && typeof teachingSession.teachingState === 'object'
    ? teachingSession.teachingState
    : null) as Record<string, unknown> | null;
  const currentState = teachingState
    ? {
        lss: teachingState.lss ?? null,
        ktl: teachingState.ktl ?? null,
        lf: teachingState.lf ?? null,
        lsb: teachingState.lsb ?? null,
      }
    : (latestLearningResponse.currentState && typeof latestLearningResponse.currentState === 'object'
      ? latestLearningResponse.currentState
      : null);
  const latestKnowledgePoint = (teachingSession?.messages && Array.isArray(teachingSession.messages) ? teachingSession.messages : []).slice().reverse().find((message) => message?.knowledgePoint)?.knowledgePoint
    || latestLearningResponse.knowledgePoint
    || knowledgePoints[0]?.name
    || null;

  return {
    goal: Array.isArray(stageResults.goal?.knowledgeState) ? stageResults.goal.knowledgeState : [],
    learning: {
      knowledgePoints,
      currentState,
      latestKnowledgePoint,
      conversationHistory: learningConversation,
    },
    latest: knowledgePoints,
  };
}

export function buildSessionRuntime(session: VirtualSessionRow, teachingSession?: TeachingSessionRecord) {
  const storyContext = parseStoryContext(session);
  const stageResults = parseStageResults(session);
  const logs = parseLogs(session);
  const goalState = stageResults.goal || {};
  const pathState = stageResults.path || {};
  const pathReviewState = stageResults.path_review || {};
  const learningState = stageResults.teaching || {};
  const bindings = buildSessionBindings(session);
  const learnerState = buildSessionLearnerStateProjection(session, stageResults, storyContext);
  const knowledgeState = buildSessionKnowledgeProjection(stageResults, logs, teachingSession);

  return {
    learnerId: session.virtualProfileId || null,
    currentStage: session.currentStage,
    status: session.status,
    story: storyContext,
    bindings,
    learnerState,
    knowledgeState,
    stageStatus: {
      goal: {
        conversationId: bindings.goalConversationId,
        stage: goalState.finalStage || goalState.stage || null,
        ready: ['ready', 'completed'].includes(String(goalState.finalStage || goalState.stage || '').toLowerCase()) || !!bindings.learningPathId,
        learnerState: goalState.learnerState || null,
        concernPool: goalState.concernPool || null,
        disclosedConcerns: goalState.disclosedConcerns || [],
      },
      path: {
        learningPathId: bindings.learningPathId,
        generated: !!bindings.learningPathId,
        totalMilestones: pathState.totalMilestones || null,
        review: pathReviewState && Object.keys(pathReviewState).length ? {
          decision: pathReviewState.decision || null,
          reaction: pathReviewState.reaction || null,
          confidence: pathReviewState.confidence || null,
          biggestConcern: pathReviewState.biggestConcern || null,
          learnerState: pathReviewState.learnerState || null,
        } : null,
      },
      learning: {
        teachingSessionId: bindings.teachingSessionId,
        currentMilestone: learningState.currentMilestone ?? null,
        currentMilestoneTitle: learningState.currentMilestoneTitle || null,
        currentTaskId: learningState.currentTaskId || null,
        currentTaskTitle: learningState.currentTaskTitle || null,
        totalMilestones: learningState.totalMilestones || null,
        learnerState: learningState.learnerState || null,
        knowledgeState: knowledgeState.learning.knowledgePoints,
        currentState: knowledgeState.learning.currentState,
        latestKnowledgePoint: knowledgeState.learning.latestKnowledgePoint,
        manualStop: !!learningState.manualStop,
      }
    }
  };
}

function normalizeGoalLearnerStateForSummary(session: VirtualSessionRow, goalState: Record<string, unknown>) {
  const learnerState = (goalState?.learnerState && typeof goalState.learnerState === 'object' ? goalState.learnerState : null) as Record<string, unknown> | null;
  if (!learnerState) return null;

  const finalStage = String(goalState?.finalStage || goalState?.stage || '').toLowerCase();
  const goalCompleted = ['ready', 'completed'].includes(finalStage)
    || session?.currentStage === 'path'
    || session?.currentStage === 'teaching'
    || !!session?.learningPathId;

  if (!goalCompleted) return learnerState;

  return {
    ...learnerState,
    goalReadiness: Math.max(typeof learnerState.goalReadiness === 'number' ? learnerState.goalReadiness : 0, 0.86),
    wantsClarification: false,
    readyToAdvance: true,
    remainingUnknowns: []
  };
}

export function buildSessionSummary(session: VirtualSessionRow) {
  const storyContext = parseStoryContext(session);
  const stageResults = parseStageResults(session);
  const goalState = stageResults.goal || {};
  const learningProgress = stageResults.teaching || {};
  const logs = parseLogs(session);
  const roundCount = logs.filter((log) => log?.phase === 'virtual-reply' || log?.phase === 'teaching-reply').length;
  const runtime = buildSessionRuntime(session);
  const conversations = buildSessionConversations(session, logs);

  return {
    id: session.id,
    status: session.status,
    currentStage: session.currentStage,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    learningPathId: runtime.bindings?.learningPathId || null,
    storyContext,
    roundCount,
    goalStage: goalState.stage || null,
    learnerState: normalizeGoalLearnerStateForSummary(session, goalState),
    logs,
    bindings: runtime.bindings,
    stageResults,
    conversations,
    completedTasks: session.completedTasks || 0,
    totalTasks: session.totalTasks || 0,
    currentTaskTitle: learningProgress.currentTaskTitle || null,
    currentMilestoneTitle: learningProgress.currentMilestoneTitle || null,
    runtime,
  };
}

export function registerProjectionRoutes(router: Router): void {
// ===== 原 virtual-learners.ts L826–L1054 =====
/**
 * GET /:id/memory —— 虚拟学习者记忆池
 * 展示此人记住了什么：已掌握 / 到期复习点 / 易混淆卡点 / 最近完成事项（成果物）。
 * 数据由 learner-memory 模块聚合（画像 knownConcepts + memory_traces 到期点 + recentCompleted）。
 */
router.get('/:id/memory', async (req: Request, res) => {
  try {
    const { id } = req.params;
    const profile = await findProfileById(id);
    if (!profile) {
      return res.status(404).json({ success: false, error: '虚拟用户不存在' });
    }

    const memory = await buildLearnerMemorySnapshot(profile.userId, { limit: 12 });

    // Q2/Q8 记忆看板：在既有聚合之上，补一条纯函数派生的遗忘曲线（只增字段，不改既有形状）。
    // 数据源与排期同源：memory_traces（含 FSRS 状态列），桶分类沿用上面的 mastered/dueReview。
    const asOf = simulatedNowOr();
    const dueNames = new Set(memory.dueReview.map((item) => item.name));
    const masteredNames = new Set(memory.mastered.map((item) => item.name));
    const traces = await findMemoryTracesByUser(profile.userId);
    const concepts = buildRetentionSeriesForConcepts(
      traces.map((trace): RetentionConceptInput => ({
        conceptKey: trace.conceptKey,
        label: trace.label,
        bucket: dueNames.has(trace.conceptKey)
          ? 'due'
          : masteredNames.has(trace.conceptKey)
            ? 'mastered'
            : 'other',
        stabilityLabel: trace.stability,
        fsrsStability: trace.fsrsStability,
        fsrsDifficulty: trace.fsrsDifficulty,
        fsrsLapses: trace.fsrsLapses,
        fsrsReps: trace.fsrsReps,
        masteryScore: trace.masteryScore,
        extractionCount: trace.extractionCount,
        lastSeenAt: trace.lastSeenAt,
      })),
      { asOf, max: 8 },
    );

    return res.json({
      success: true,
      data: {
        profileId: id,
        updatedAt: profile.updatedAt,
        asOf: asOf.toISOString(),
        mastered: memory.mastered.map((item) => ({ name: item.name })),
        dueReview: memory.dueReview.map((item) => ({ name: item.name, retention: item.progress / 100 })),
        struggling: memory.struggling.map((item) => ({ name: item.name })),
        recentCompleted: memory.recentCompleted,
        recentTaskTitles: memory.recentTaskTitles,
        // 每个有痕迹的概念：stability（天）/ lastSeenAt / extractionCount / 当前 retention + 遗忘曲线
        concepts,
        counts: {
          mastered: memory.mastered.length,
          dueReview: memory.dueReview.length,
          struggling: memory.struggling.length,
          completed: memory.recentCompleted.length,
        },
      },
    });
  } catch (error) {
    logger.error('[virtual-learners] 记忆池获取失败:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : '获取记忆池失败' });
  }
});

router.get('/:id/stories', async (req: Request, res) => {
  try {
    const { id } = req.params;
    const profile = await findProfileWithRecentSessions(id);

    if (!profile) {
      return res.status(404).json({ success: false, error: '虚拟用户不存在' });
    }

    const { profileData, storyPool } = await ensureProfileStoryPool(profile);
    const stories = storyPool.map((story, index: number) => {
      const runs = Array.isArray(profile.sessions)
        ? profile.sessions
            .filter((session: VirtualSessionRow) => {
              const sessionStory = parseStoryContext(session);
              return isSameStory(story, sessionStory);
            })
            .map((session: VirtualSessionRow) => ({
              sessionId: session.id,
              status: session.status,
              currentStage: session.currentStage,
              updatedAt: session.updatedAt,
              createdAt: session.createdAt,
              storyContext: parseStoryContext(session),
              bindings: buildSessionBindings(session),
              // 自动驾驶状态（供前端区分「运行中 / 已暂停」：会话 status=running 但 autopilot=stopped 视为暂停）
              autopilotStatus: (() => {
                try {
                  const sr = JSON.parse(session.stageResults || '{}');
                  return sr?.autopilot?.status || null;
                } catch {
                  return null;
                }
              })(),
            }))
        : [];

      const latestRun = runs[0] || null;
      return {
        key: story?.id || `story-${index}`,
        index,
        ...story,
        storyId: story?.id || null,
        storyTitle: story?.title || `故事 ${index + 1}`,
        storyOutline: story?.storyOutline || story?.outline || '',
        storyTriggerEvent: story?.storyTriggerEvent || story?.triggerEvent || '',
        stats: {
          totalRuns: runs.length,
          goalCount: runs.filter((item) => !!item.bindings?.goalConversationId).length,
          pathCount: runs.filter((item) => !!item.bindings?.learningPathId).length,
          learnCount: runs.filter((item) => !!item.bindings?.teachingSessionId || !!item.bindings?.currentTaskId).length,
          runningCount: runs.filter((item) => item.status === 'running').length,
        },
        latestRun,
        projection: {
          formal: {
            goal: latestRun?.bindings?.goalConversationId ? `/goal-conversation/${latestRun.bindings.goalConversationId}?virtualSessionId=${latestRun.sessionId}&viewMode=formal` : null,
            path: latestRun?.bindings?.learningPathId ? `/learning-path/${latestRun.bindings.learningPathId}?virtualSessionId=${latestRun.sessionId}&viewMode=formal` : null,
            learning: latestRun?.bindings?.currentTaskId ? `/learn/${latestRun.bindings.currentTaskId}?virtualSessionId=${latestRun.sessionId}&viewMode=formal` : null,
          },
          test: {
            goal: latestRun?.bindings?.goalConversationId ? `/goal-conversation/${latestRun.bindings.goalConversationId}?virtualSessionId=${latestRun.sessionId}&viewMode=formal` : null,
            path: latestRun?.bindings?.learningPathId ? `/learning-path/${latestRun.bindings.learningPathId}?virtualSessionId=${latestRun.sessionId}&viewMode=formal` : null,
            learning: latestRun?.bindings?.currentTaskId ? `/learn/${latestRun.bindings.currentTaskId}?virtualSessionId=${latestRun.sessionId}&viewMode=formal` : null,
          }
        }
      }
    })

    res.json({
      success: true,
      data: {
        profile: {
          id: profile.id,
          userId: profile.userId,
          userName: profile.users.name,
          email: profile.users.email,
          learningGoal: profile.learningGoal,
          knowledgeLevel: profile.knowledgeLevel,
          profile: profileData,
        },
        stories,
        summary: {
          storyCount: stories.length,
          runCount: Array.isArray(profile.sessions) ? profile.sessions.length : 0,
          goalCount: stories.reduce((sum: number, item) => sum + (item.stats.goalCount || 0), 0),
          pathCount: stories.reduce((sum: number, item) => sum + (item.stats.pathCount || 0), 0),
          learnCount: stories.reduce((sum: number, item) => sum + (item.stats.learnCount || 0), 0),
        }
      }
    })
  } catch (error) {
    logger.error('获取虚拟学习者故事摘要失败:', error)
    res.status(500).json({ success: false, error: error.message || '获取虚拟学习者故事摘要失败' })
  }
})

router.get('/sessions/:sessionId/teaching-detail', async (req: Request, res) => {
  try {
    const { sessionId } = req.params;

    const session = await findSessionById(sessionId);

    if (!session) {
      return res.status(404).json({ success: false, error: '模拟会话不存在' });
    }

    const learningProgress = parseLearningProgress(session);
    const currentTeachingSessionId = learningProgress.teachingSessionId || null;
    const requestedTeachingSessionId = typeof req.query?.teachingSessionId === 'string'
      ? req.query.teachingSessionId.trim()
      : '';
    const teachingHistory = Array.isArray(learningProgress.teachingSessionHistory)
      ? learningProgress.teachingSessionHistory
      : [];
    const archivedTeachingSessionIds = new Set(
      teachingHistory
        .map((entry) => typeof entry?.teachingSessionId === 'string' ? entry.teachingSessionId : '')
        .filter(Boolean)
    );
    const teachingSessionId = requestedTeachingSessionId || currentTeachingSessionId;
    if (!teachingSessionId) {
      return res.status(404).json({ success: false, error: '当前虚拟会话尚未绑定 Learn 会话' });
    }
    if (requestedTeachingSessionId && requestedTeachingSessionId !== currentTeachingSessionId && !archivedTeachingSessionIds.has(requestedTeachingSessionId)) {
      return res.status(403).json({ success: false, error: '该授课会话不属于当前虚拟会话的教学历史' });
    }

    const teachingSession = await teachingSessionRepository.getById(String(teachingSessionId));
    if (!teachingSession) {
      return res.status(404).json({ success: false, error: '授课会话不存在' });
    }

    res.json({
      success: true,
      data: {
        id: teachingSession.id,
        subject: teachingSession.subject,
        topic: teachingSession.topic,
        taskId: teachingSession.taskId,
        startTime: teachingSession.startTime,
        endTime: teachingSession.endTime,
        duration: teachingSession.duration,
        status: teachingSession.status,
        messages: teachingSession.messages,
        state: teachingSession.teachingState || {},
        knowledgePoints: teachingSession.knowledgeState,
        wrapup: teachingSession.wrapup,
        advisory: teachingSession.advisory || null,
        revision: teachingSession.revision,
        isArchived: teachingSessionId !== currentTeachingSessionId,
        teachingSessionHistory: teachingHistory,
      }
    });
  } catch (error) {
    logger.error('获取虚拟会话授课详情失败:', error);
    res.status(500).json({ success: false, error: error.message || '获取虚拟会话授课详情失败' });
  }
});
}
