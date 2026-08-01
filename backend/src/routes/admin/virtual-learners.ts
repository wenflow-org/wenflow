/**
 * Admin Virtual Learners API
 * 
 * 虚拟用户模拟管理接口
 */

import express from 'express';
import { randomUUID as uuidv4 } from 'crypto';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import simulationCoordinator from '../../coordinators/simulation.coordinator';
import { getGateway } from '../../gateway';
import { virtualLearnerPersonaDesignerDefinition } from '../../skills/virtual-learner-persona-designer';
import { virtualLearnerScenarioDesignerDefinition } from '../../skills/virtual-learner-scenario-designer';
import { executeSkill } from '../../skills';
import learningService from '../../services/learning/learning.service';
import { assertPathMutationSafe } from '../../services/learning/path-mutation-safety';
import { teachingSessionRepository } from '../../services/ai-teaching/TeachingSessionRepository';
import { signProjectionToken, SyntheticCapability, verifyProjectionToken } from '../../utils/projection-token';
import blackboxVirtualLearnerRunner from '../../virtual-lab/blackbox-runner';
import type { LearnerAction } from '../../virtual-lab/contracts';
import { assertAssistedSessionMode } from '../../virtual-lab/session-mode';
import {
  parseJson,
  normalizeStoryPoolData,
  ensureProfileStoryPool,
  isSameStory,
  getStoryPool,
  pickStoryFromPool,
  createSessionForProfile,
  SIMULATION_FRICTION_BUDGETS,
} from '../../virtual-lab/session-factory';

const router = express.Router();

const DEFAULT_SCENARIO_CANDIDATE_DOMAINS = [
  '番茄工作法与时间管理',
  '课堂复盘与总结',
  '需求拆解',
  '向上汇报表达',
  'SQL 基础查询',
  'Python 基础',
  'Excel 数据处理',
  '英语口语表达',
  '备考规划',
  '个人记账与财务整理',
  '亲子沟通',
  '演讲与公开表达',
  '阅读方法',
  '健身习惯建立',
  '写作与结构表达',
  '短视频脚本表达',
  '面试回答组织',
  '家庭信息整理',
  '情绪记录与自我觉察',
  '基础营养与饮食规划',
];

const DEFAULT_SCENARIO_CANDIDATE_PERSONAS = [
  '销售主管，常被临时消息打断',
  '运营专员，最近要独立做复盘',
  '产品经理，方案总是越写越散',
  '教培老师，课后复盘全凭感觉',
  '求职转行者，自学总在开头放弃',
  '大三学生，备考节奏很乱',
  '二胎妈妈，想重新建立学习时间',
  '门店店长，排班和复盘都很碎片化',
  '客服组长，沟通记录难以整理',
  '自由职业设计师，项目切换频繁',
  '财务助理，月末报表压力大',
  '社区工作者，信息整理任务很多',
  '短视频创作者，选题和复盘混乱',
  '大学辅导员，事务多且优先级难排',
  '高中英语老师，想提升讲后总结质量',
  '全职妈妈，想恢复规律学习或锻炼',
  '兼职插画师，在家接稿兼顾家庭事务',
  '大学生，想提升公开表达或面试能力',
  '自由职业写作者，长期拖延交稿',
  '行政助理，日常任务碎片化严重',
];

function pickTopLabels(values: string[], limit = 3) {
  const counts = new Map<string, number>();
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) continue;
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

function parseSimulationLimit(value: unknown, fallback: number, max: number, field: string) {
  const limit = value === undefined ? fallback : value;
  if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > max) {
    throw Object.assign(new Error(`${field} 必须是 1 到 ${max} 之间的整数`), {
      code: 'INVALID_SIMULATION_LIMIT',
      statusCode: 400
    });
  }
  return Number(limit);
}

function parseStoryContext(session: any) {
  try {
    const stageResults = JSON.parse(session.stageResults || '{}');
    return stageResults.story || null;
  } catch {
    return null;
  }
}

function parseLearningProgress(session: any) {
  try {
    const stageResults = JSON.parse(session.stageResults || '{}');
    return stageResults.learning || {};
  } catch {
    return {};
  }
}

function parseStageResults(session: any) {
  try {
    return JSON.parse(session.stageResults || '{}');
  } catch {
    return {};
  }
}

function parseLogs(session: any) {
  try {
    const logs = JSON.parse(session.logs || '[]');
    return Array.isArray(logs) ? logs : [];
  } catch {
    return [];
  }
}

function buildLearningConversationProjection(logs: any[] = []) {
  const conversation: Array<{ role: 'assistant' | 'user'; content: string; phase: string; timestamp?: string | null }> = [];

  for (const log of logs) {
    if (log?.phase === 'learning-start' && log?.details?.output?.welcomeMessage) {
      conversation.push({
        role: 'assistant',
        content: String(log.details.output.welcomeMessage),
        phase: 'learning-start',
        timestamp: log.timestamp || null,
      });
    }

    if (log?.phase === 'learning-reply' && log?.details?.output?.reply) {
      conversation.push({
        role: 'user',
        content: String(log.details.output.reply),
        phase: 'learning-reply',
        timestamp: log.timestamp || null,
      });
    }

    if (log?.phase === 'learning-response' && log?.details?.output?.aiResponse) {
      conversation.push({
        role: 'assistant',
        content: String(log.details.output.aiResponse),
        phase: 'learning-response',
        timestamp: log.timestamp || null,
      });
    }
  }

  return conversation;
}

function buildLearningConversationRoundsProjection(logs: any[] = []) {
  const rounds: Array<{
    round: number;
    isOpening: boolean;
    timestamp?: string | null;
    learnerMessage: { role: 'user'; content: string; timestamp?: string | null } | null;
    assistantMessage: { role: 'assistant'; content: string; timestamp?: string | null } | null;
    knowledgePoints: any[];
    currentState: any | null;
    currentTask: string | null;
    currentMilestone: string | null;
    strategies: string[];
    cognitiveLevel: string | null;
    knowledgePoint: string | null;
    isCompletion: boolean;
    autoEnded: boolean;
    peerTriggered: boolean;
    peerMessage: string | null;
    learnerState: any | null;
    learnerFeedback: any | null;
    closureDecision: any | null;
    emotion: string | null;
  }> = [];

  let pendingLearner: any | null = null;
  let roundNumber = 0;

  for (const log of logs) {
    if (log?.phase === 'learning-start' && log?.details?.output?.welcomeMessage) {
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

    if (log?.phase === 'learning-reply' && log?.details?.output?.reply) {
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

    if (log?.phase === 'learning-response' && pendingLearner) {
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
        currentState: output?.currentState && typeof output.currentState === 'object' ? output.currentState : null,
        currentTask: pendingLearner.currentTask,
        currentMilestone: pendingLearner.currentMilestone,
        strategies: Array.isArray(output?.strategies)
          ? output.strategies.filter((item: any) => typeof item === 'string' && item.trim())
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

function buildGoalConversationProjection(goalConversation: any, fallbackLogs: any[] = []) {
  if (goalConversation) {
    const data = parseJson<any>(goalConversation.collectedData, {});
    const messages = Array.isArray(data.messages) ? data.messages : [];

    return {
      source: 'goal-conversation',
      stage: goalConversation.stage || null,
      status: goalConversation.status || null,
      messages: messages.map((message: any, index: number) => ({
        id: message?.id || `goal-${index}`,
        role: message?.role === 'user' ? 'user' : 'assistant',
        content: typeof message?.content === 'string' ? message.content : '',
        timestamp: message?.timestamp || null,
      })).filter((message: any) => message.content),
      confidence: typeof data.confidence === 'number' ? data.confidence : 0,
      quickReplies: Array.isArray(data.questions_to_ask) ? data.questions_to_ask : [],
    };
  }

  const goalLogs = Array.isArray(fallbackLogs) ? fallbackLogs : [];
  const messages: any[] = [];

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

function buildSessionConversations(session: any, logs: any[] = [], goalConversation?: any) {
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

function buildSessionBindings(session: any) {
  const stageResults = parseStageResults(session);
  const learningState = stageResults.learning || {};

  return {
    goalConversationId: session.goalConversationId || null,
    learningPathId: session.learningPathId || null,
    teachingSessionId: learningState.teachingSessionId || null,
    currentTaskId: learningState.currentTaskId || null,
  };
}

function buildSessionLearnerStateProjection(session: any, stageResults: any, storyContext: any) {
  const goalState = stageResults.goal || {};
  const pathReviewState = stageResults.path_review || {};
  const learningState = stageResults.learning || {};
  const goalLearnerState = goalState.learnerState && typeof goalState.learnerState === 'object' ? goalState.learnerState : null;
  const pathReviewLearnerState = pathReviewState.learnerState && typeof pathReviewState.learnerState === 'object' ? pathReviewState.learnerState : null;
  const learningLearnerState = learningState.learnerState && typeof learningState.learnerState === 'object' ? learningState.learnerState : null;

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

function buildSessionKnowledgeProjection(stageResults: any, logs: any[] = [], teachingSession?: any) {
  const learningState = stageResults.learning || {};
  const learningConversation = Array.isArray(learningState.conversationHistory) ? learningState.conversationHistory : [];
  const latestLearningResponse = [...logs].reverse().find((log: any) => log?.phase === 'learning-response')?.details?.output || {};
  const teachingKnowledgePoints = Array.isArray(teachingSession?.knowledgeState) ? teachingSession.knowledgeState : [];
  const knowledgePoints = teachingKnowledgePoints.length
    ? teachingKnowledgePoints
    : (Array.isArray(latestLearningResponse.knowledgePoints) ? latestLearningResponse.knowledgePoints : []);
  const currentState = teachingSession?.teachingState && typeof teachingSession.teachingState === 'object'
    ? {
        lss: teachingSession.teachingState.lss ?? null,
        ktl: teachingSession.teachingState.ktl ?? null,
        lf: teachingSession.teachingState.lf ?? null,
        lsb: teachingSession.teachingState.lsb ?? null,
      }
    : (latestLearningResponse.currentState && typeof latestLearningResponse.currentState === 'object'
      ? latestLearningResponse.currentState
      : null);
  const latestKnowledgePoint = teachingSession?.messages?.slice?.().reverse?.().find((message: any) => message?.knowledgePoint)?.knowledgePoint
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

function buildSessionRuntime(session: any, teachingSession?: any) {
  const storyContext = parseStoryContext(session);
  const stageResults = parseStageResults(session);
  const logs = parseLogs(session);
  const goalState = stageResults.goal || {};
  const pathState = stageResults.path || {};
  const pathReviewState = stageResults.path_review || {};
  const learningState = stageResults.learning || {};
  const bindings = buildSessionBindings(session);
  const learnerState = buildSessionLearnerStateProjection(session, stageResults, storyContext);
  const knowledgeState = buildSessionKnowledgeProjection(stageResults, logs, teachingSession);

  return {
    learnerId: session.virtualLearnerProfileId || session.virtualLearnerId || null,
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

function buildVirtualLearnerTestProjection(profile: any) {
  const storyPool = getStoryPool(profile);
  const sessions = Array.isArray(profile?.sessions)
    ? [...profile.sessions].sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    : [];
  const latestSession = sessions[0] || null;
  const latestStoryContext = latestSession ? parseStoryContext(latestSession) : null;
  const latestBindings = latestSession ? buildSessionBindings(latestSession) : null;
  const activeStory = latestStoryContext?.storyId
    ? storyPool.find((story: any) => story?.id === latestStoryContext.storyId) || latestStoryContext
    : latestStoryContext || storyPool[0] || null;

  let recommendedEntry: 'dashboard' | 'goal' | 'path' | 'learning' = 'dashboard';
  let recommendedReason = '当前还没有运行记录，先进入前台总览。';

  if (latestSession && latestBindings?.currentTaskId) {
    recommendedEntry = 'learning';
    recommendedReason = '最近一次运行已经进入学习阶段，直接查看当前学习任务最贴近真实状态。';
  } else if (latestSession && latestBindings?.learningPathId) {
    recommendedEntry = 'path';
    recommendedReason = '最近一次运行已经生成 Path，先查看路径内容与阶段承接。';
  } else if (latestSession && latestBindings?.goalConversationId) {
    recommendedEntry = 'goal';
    recommendedReason = '最近一次运行停留在 Goal，对话上下文最值得优先查看。';
  }

  return {
    profile: {
      id: profile.id,
      userId: profile.userId,
      userName: profile.users?.name || '',
      email: profile.users?.email || '',
    },
    latestSession: latestSession ? {
      id: latestSession.id,
      status: latestSession.status,
      currentStage: latestSession.currentStage,
      updatedAt: latestSession.updatedAt,
      storyContext: latestStoryContext,
      bindings: latestBindings,
    } : null,
    activeStory: activeStory ? {
      storyId: activeStory.id || activeStory.storyId || null,
      title: activeStory.title || activeStory.storyTitle || null,
      triggerEvent: activeStory.storyTriggerEvent || activeStory.triggerEvent || null,
    } : null,
    recommendedEntry,
    recommendedReason,
    entries: {
      formal: {
        dashboard: '/dashboard?projection=1',
        goal: latestBindings?.goalConversationId
          ? `/goal-conversation/${latestBindings.goalConversationId}?virtualSessionId=${latestSession.id}&viewMode=formal&projection=1`
          : null,
        path: latestBindings?.learningPathId
          ? `/learning-path/${latestBindings.learningPathId}?virtualSessionId=${latestSession.id}&viewMode=formal&projection=1`
          : null,
        learning: latestBindings?.currentTaskId
          ? `/learn/${latestBindings.currentTaskId}?virtualSessionId=${latestSession.id}&viewMode=formal&projection=1`
          : null,
      },
      test: {
        goal: latestBindings?.goalConversationId
          ? `/admin/test/goal-full/${latestBindings.goalConversationId}?virtualSessionId=${latestSession.id}&viewMode=debug`
          : null,
        path: latestBindings?.learningPathId
          ? `/admin/test/learning-path/${latestBindings.learningPathId}?virtualSessionId=${latestSession.id}&viewMode=debug`
          : null,
        learning: latestBindings?.currentTaskId
          ? `/admin/test/learn/${latestBindings.currentTaskId}?virtualSessionId=${latestSession.id}&viewMode=debug`
          : null,
      }
    }
  };
}

function normalizeGoalLearnerStateForSummary(session: any, goalState: any) {
  const learnerState = goalState?.learnerState;
  if (!learnerState || typeof learnerState !== 'object') return learnerState || null;

  const finalStage = String(goalState?.finalStage || goalState?.stage || '').toLowerCase();
  const goalCompleted = ['ready', 'completed'].includes(finalStage)
    || session?.currentStage === 'path'
    || session?.currentStage === 'learning'
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

function buildSessionSummary(session: any) {
  const storyContext = parseStoryContext(session);
  const stageResults = parseStageResults(session);
  const goalState = stageResults.goal || {};
  const learningProgress = stageResults.learning || {};
  const logs = parseLogs(session);
  const roundCount = logs.filter((log: any) => log?.phase === 'virtual-reply' || log?.phase === 'learning-reply').length;
  const runtime = buildSessionRuntime(session);
  const conversations = buildSessionConversations(session, logs);

  return {
    id: session.id,
    status: session.status,
    currentStage: session.currentStage,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
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

async function buildRecentScenarioHints() {
  const recentProfiles = await prisma.virtual_learner_profiles.findMany({
    take: 12,
    orderBy: { createdAt: 'desc' },
    select: {
      profile: true,
      learningGoal: true,
      notes: true,
    },
  });

  const occupations = recentProfiles
    .map((item) => parseJson<any>(item.profile, {}).occupation)
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0);

  const domains = recentProfiles
    .map((item) => {
      const notes = item.notes || '';
      const matched = notes.match(/(?:^|\n)domain:\s*(.+)$/m);
      return matched?.[1]?.trim() || '';
    })
    .filter(Boolean);

  const goals = recentProfiles
    .map((item) => item.learningGoal || '')
    .filter(Boolean);

  const topOccupations = pickTopLabels(occupations, 4);
  const topDomains = pickTopLabels(domains, 4);
  const topGoals = pickTopLabels(goals, 3);

  const hints: string[] = [
    '请优先避免与最近样本重复的职业、问题来源和主题组合。',
    '如果最近样本里教师或时间管理类已经偏多，请主动切换到其他角色背景与问题来源。',
  ];

  for (const item of topOccupations) {
    hints.push(`最近高频职业：${item.label}（${item.count} 次），这次尽量换职业背景。`);
  }

  for (const item of topDomains) {
    hints.push(`最近高频主题：${item.label}（${item.count} 次），这次尽量换主题。`);
  }

  for (const item of topGoals) {
    hints.push(`最近高频目标表达：${item.label}（${item.count} 次），避免复述相似表述。`);
  }

  return hints;
}

router.get('/:id/stories', async (req: any, res) => {
  try {
    const { id } = req.params;
    const profile = await prisma.virtual_learner_profiles.findUnique({
      where: { id },
      include: {
        users: {
          select: { id: true, email: true, name: true }
        },
        sessions: {
          orderBy: { updatedAt: 'desc' },
          take: 200,
        },
      },
    });

    if (!profile) {
      return res.status(404).json({ success: false, error: '虚拟用户不存在' });
    }

    const { profileData, storyPool } = await ensureProfileStoryPool(profile);
    const stories = storyPool.map((story: any, index: number) => {
      const runs = Array.isArray(profile.sessions)
        ? profile.sessions
            .filter((session: any) => {
              const sessionStory = parseStoryContext(session);
              return isSameStory(story, sessionStory);
            })
            .map((session: any) => ({
              sessionId: session.id,
              status: session.status,
              currentStage: session.currentStage,
              updatedAt: session.updatedAt,
              createdAt: session.createdAt,
              storyContext: parseStoryContext(session),
              bindings: buildSessionBindings(session),
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
          goalCount: runs.filter((item: any) => !!item.bindings?.goalConversationId).length,
          pathCount: runs.filter((item: any) => !!item.bindings?.learningPathId).length,
          learnCount: runs.filter((item: any) => !!item.bindings?.teachingSessionId || !!item.bindings?.currentTaskId).length,
          runningCount: runs.filter((item: any) => item.status === 'running').length,
        },
        latestRun,
        projection: {
          formal: {
            goal: latestRun?.bindings?.goalConversationId ? `/goal-conversation/${latestRun.bindings.goalConversationId}?virtualSessionId=${latestRun.sessionId}&viewMode=formal` : null,
            path: latestRun?.bindings?.learningPathId ? `/learning-path/${latestRun.bindings.learningPathId}?virtualSessionId=${latestRun.sessionId}&viewMode=formal` : null,
            learning: latestRun?.bindings?.currentTaskId ? `/learn/${latestRun.bindings.currentTaskId}?virtualSessionId=${latestRun.sessionId}&viewMode=formal` : null,
          },
          test: {
            goal: latestRun?.bindings?.goalConversationId ? `/admin/test/goal-full/${latestRun.bindings.goalConversationId}?virtualSessionId=${latestRun.sessionId}&viewMode=debug` : null,
            path: latestRun?.bindings?.learningPathId ? `/admin/test/learning-path/${latestRun.bindings.learningPathId}?virtualSessionId=${latestRun.sessionId}&viewMode=debug` : null,
            learning: latestRun?.bindings?.currentTaskId ? `/admin/test/learn/${latestRun.bindings.currentTaskId}?virtualSessionId=${latestRun.sessionId}&viewMode=debug` : null,
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
          goalCount: stories.reduce((sum: number, item: any) => sum + (item.stats.goalCount || 0), 0),
          pathCount: stories.reduce((sum: number, item: any) => sum + (item.stats.pathCount || 0), 0),
          learnCount: stories.reduce((sum: number, item: any) => sum + (item.stats.learnCount || 0), 0),
        }
      }
    })
  } catch (error: any) {
    logger.error('获取虚拟学习者故事摘要失败:', error)
    res.status(500).json({ success: false, error: error.message || '获取虚拟学习者故事摘要失败' })
  }
})

router.get('/sessions/:sessionId/goal-conversation', async (req: any, res) => {
  try {
    const { sessionId } = req.params;

    const session = await prisma.virtual_sessions.findUnique({
      where: { id: sessionId },
      include: {
        virtual_learner_profiles: {
          include: {
            users: {
              select: { id: true, email: true, name: true }
            }
          }
        }
      }
    });

    if (!session) {
      return res.status(404).json({ success: false, error: '模拟会话不存在' });
    }

    if (!session.goalConversationId) {
      return res.status(404).json({ success: false, error: '当前虚拟会话尚未生成 Goal 对话' });
    }

    const conversation = await prisma.goal_conversations.findFirst({
      where: { id: session.goalConversationId }
    });

    if (!conversation) {
      return res.status(404).json({ success: false, error: 'Goal 对话不存在' });
    }

    const data = parseJson<any>(conversation.collectedData, {});

    res.json({
      success: true,
      data: {
        id: conversation.id,
        description: conversation.description,
        stage: conversation.stage,
        status: conversation.status,
        messages: data.messages || [],
        collected: data.collected || {},
        understanding: data.understanding || {},
        nextQuestions: data.questions_to_ask || [],
        confirmedProposal: data.confirmedProposal || null,
        structuredData: data.structuredData || null,
        confidenceScores: data.confidenceScores || null,
        learningPath: data.learningPath || (conversation.learningPathId ? { id: conversation.learningPathId } : null),
        confidence: data.confidence || 0,
        createdAt: conversation.createdAt,
        completedAt: conversation.completedAt,
        meta: {
          source: 'goal-conversation',
          timestamp: new Date().toISOString(),
          messages: data.messages || [],
          virtualSessionId: sessionId,
          profile: {
            id: session.virtual_learner_profiles.id,
            userId: session.virtual_learner_profiles.userId,
            userName: session.virtual_learner_profiles.users.name,
            email: session.virtual_learner_profiles.users.email,
          }
        }
      }
    });
  } catch (error: any) {
    logger.error('获取虚拟会话 Goal 对话失败:', error);
    res.status(500).json({ success: false, error: error.message || '获取虚拟会话 Goal 对话失败' });
  }
})

/**
 * AI生成画像
 * POST /api/admin/virtual-learners/generate-profile
 */
router.post('/generate-profile', async (req: any, res) => {
  try {
    const { learningGoal, knowledgeLevel, simulationMode, personalityTraits } = req.body;
    
    if (!learningGoal) {
      return res.status(400).json({
        success: false,
        error: '学习目标不能为空'
      });
    }
    
    logger.info('[generate-profile] 开始生成画像', { learningGoal, knowledgeLevel: knowledgeLevel || null });
    
    const result = await executeSkill(virtualLearnerPersonaDesignerDefinition, {
      preferredLevels: knowledgeLevel ? [knowledgeLevel] : undefined,
      existingPersonaSeed: {
        learningGoal,
        personalityTraits,
        simulationMode,
      }
    });

    logger.info('[generate-profile] Skill返回', { result: JSON.stringify(result).substring(0, 1000) });

    if (!result?.personaSeed) {
      return res.status(500).json({
        success: false,
        error: 'AI生成画像失败：未返回画像数据'
      });
    }
    
    logger.info('AI生成画像成功', {
      userId: req.user?.userId,
      learningGoal,
      generatedProfile: result.personaSeed
    });
    
    res.json({
      success: true,
      data: result.personaSeed
    });
  } catch (error: any) {
    logger.error('AI生成画像失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'AI生成画像失败'
    });
  }
});

router.get('/sessions/:sessionId/learning-path', async (req: any, res) => {
  try {
    const { sessionId } = req.params;

    const session = await prisma.virtual_sessions.findUnique({
      where: { id: sessionId },
      include: {
        virtual_learner_profiles: {
          include: {
            users: {
              select: { id: true, email: true, name: true }
            }
          }
        }
      }
    });

    if (!session) {
      return res.status(404).json({ success: false, error: '模拟会话不存在' });
    }

    if (!session.learningPathId) {
      return res.status(404).json({ success: false, error: '当前虚拟会话尚未生成 Learning Path' });
    }

    const learningPath = await learningService.getLearningPath(session.learningPathId);
    if (!learningPath) {
      return res.status(404).json({ success: false, error: 'Learning Path 不存在' });
    }

    const storyContext = parseStoryContext(session);
    const learningProgress = parseLearningProgress(session);
    const firstMilestone = learningPath.milestones?.[0] || null;
    const firstTask = firstMilestone?.subtasks?.[0] || null;
    const activeTask = learningPath.milestones
      ?.flatMap((milestone: any, milestoneIndex: number) => (milestone.subtasks || []).map((task: any, taskIndex: number) => ({
        ...task,
        milestone,
        milestoneIndex,
        taskIndex
      })))
      ?.find((task: any) => task.id === learningProgress.currentTaskId)
      || null;
    const contextTask = activeTask || firstTask;
    const contextMilestone = activeTask?.milestone || firstMilestone;
    const pathContext = {
      storyContext,
      pathTitle: learningPath.title,
      pathSummary: learningPath.summary || learningPath.description || learningPath.aiPromptTemplate || null,
      subject: learningPath.subject || null,
      currentStageNumber: learningProgress.currentMilestone !== undefined && learningProgress.currentMilestone !== null
        ? Number(learningProgress.currentMilestone) + 1
        : (contextMilestone?.stageNumber || 1),
      currentTaskOrder: learningProgress.currentTaskIdx !== undefined && learningProgress.currentTaskIdx !== null
        ? Number(learningProgress.currentTaskIdx) + 1
        : (contextTask?.order || 1),
      taskProfile: contextTask ? {
        knowledgeType: contextTask.knowledgeType || null,
        cognitiveLevel: contextTask.cognitiveLevel || null,
        displayLabel: contextTask.displayLabel || null,
        coreConcept: contextTask.coreConcept || null,
        learningObjectives: Array.isArray(contextTask.learningObjectives)
          ? contextTask.learningObjectives
          : typeof contextTask.learningObjectives === 'string' && contextTask.learningObjectives.trim()
            ? contextTask.learningObjectives.split(/[,，\n]/).map((item: string) => item.trim()).filter(Boolean)
            : [],
        linkedConceptName: contextTask.linkedConceptName || contextTask.coreConcept || null,
      } : null,
      currentMilestoneTitle: contextMilestone?.title || null,
      currentTaskTitle: contextTask?.title || null,
      taskKnowledgeScope: null,
      cognitiveFrame: null,
      teachingStrategyGuidance: null
    };

    res.json({
      success: true,
      data: {
        status: learningPath.status,
        learningPathId: learningPath.id,
        path: {
          id: learningPath.id,
          title: learningPath.title,
          name: learningPath.name,
          summary: learningPath.summary || null,
          description: learningPath.description,
          subject: learningPath.subject,
          difficulty: learningPath.difficulty,
          estimatedHours: learningPath.estimatedHours,
          totalMilestones: learningPath.totalMilestones,
          completedMilestones: learningPath.completedMilestones,
          status: learningPath.status,
          aiGenerated: learningPath.aiGenerated,
          generationStatus: learningPath.generationStatus || null,
          sceneSummary: learningPath.sceneSummary || null,
          cognitiveDesign: learningPath.cognitiveDesign || null,
          adjustmentPolicy: learningPath.adjustmentPolicy || null,
          adjustmentEvidence: learningPath.adjustmentEvidence || null,
          canStartLearning: learningPath.canStartLearning,
          learningBlockedReason: learningPath.learningBlockedReason || null,
          replanLineage: learningPath.replanLineage || null,
          createdAt: learningPath.createdAt,
          updatedAt: learningPath.updatedAt,
          milestones: learningPath.milestones,
          stages: learningPath.stages || learningPath.milestones,
          totalStages: learningPath.totalStages || learningPath.totalMilestones
        },
        pathContext
      }
    });
  } catch (error: any) {
    logger.error('获取虚拟会话 Learning Path 失败:', error);
    res.status(500).json({ success: false, error: error.message || '获取虚拟会话 Learning Path 失败' });
  }
});

router.get('/sessions/:sessionId/learning-task', async (req: any, res) => {
  try {
    const { sessionId } = req.params;

    const session = await prisma.virtual_sessions.findUnique({
      where: { id: sessionId },
      include: {
        virtual_learner_profiles: {
          include: {
            users: {
              select: { id: true, email: true, name: true }
            }
          }
        }
      }
    });

    if (!session) {
      return res.status(404).json({ success: false, error: '模拟会话不存在' });
    }

    const learningProgress = parseLearningProgress(session);
    const taskId = learningProgress.currentTaskId || learningProgress.currentTask || null;
    if (!taskId) {
      return res.status(404).json({ success: false, error: '当前虚拟会话尚未绑定学习任务' });
    }

    const task = await prisma.subtasks.findUnique({
      where: { id: String(taskId) }
    });

    if (!task) {
      return res.status(404).json({ success: false, error: '学习任务不存在' });
    }

    res.json({
      success: true,
      data: task
    });
  } catch (error: any) {
    logger.error('获取虚拟会话 Learning Task 失败:', error);
    res.status(500).json({ success: false, error: error.message || '获取虚拟会话 Learning Task 失败' });
  }
});

router.get('/sessions/:sessionId/teaching-detail', async (req: any, res) => {
  try {
    const { sessionId } = req.params;

    const session = await prisma.virtual_sessions.findUnique({
      where: { id: sessionId }
    });

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
        .map((entry: any) => typeof entry?.teachingSessionId === 'string' ? entry.teachingSessionId : '')
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
  } catch (error: any) {
    logger.error('获取虚拟会话授课详情失败:', error);
    res.status(500).json({ success: false, error: error.message || '获取虚拟会话授课详情失败' });
  }
});

/**
 * AI生成虚拟学习者实验场景
 * POST /api/admin/virtual-learners/generate-scenario
 */
router.post('/generate-scenario', async (req: any, res) => {
  try {
    const {
      preferredDomains,
      preferredGoalTypes,
      preferredLevels,
      preferredMotivations,
      avoidDomains,
      candidateDomains,
      candidatePersonas,
    } = req.body || {};

    const recentScenarioHints = await buildRecentScenarioHints();

    const result = await executeSkill(virtualLearnerScenarioDesignerDefinition, {
      preferredDomains,
      preferredGoalTypes,
      preferredLevels,
      preferredMotivations,
      avoidDomains,
      candidateDomains: Array.isArray(candidateDomains) && candidateDomains.length ? candidateDomains : DEFAULT_SCENARIO_CANDIDATE_DOMAINS,
      candidatePersonas: Array.isArray(candidatePersonas) && candidatePersonas.length ? candidatePersonas : DEFAULT_SCENARIO_CANDIDATE_PERSONAS,
      recentScenarioHints,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    logger.error('AI生成虚拟学习者场景失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'AI生成虚拟学习者场景失败',
    });
  }
});

router.post('/generate-persona', async (req: any, res) => {
  try {
    const { preferredLevels, candidatePersonas, existingPersonaSeed } = req.body || {};
    const recentScenarioHints = await buildRecentScenarioHints();

    const result = await executeSkill(virtualLearnerPersonaDesignerDefinition, {
      preferredLevels,
      candidatePersonas: Array.isArray(candidatePersonas) && candidatePersonas.length ? candidatePersonas : DEFAULT_SCENARIO_CANDIDATE_PERSONAS,
      recentPersonaHints: recentScenarioHints,
      existingPersonaSeed,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    logger.error('AI生成虚拟学习者身份失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'AI生成虚拟学习者身份失败',
    });
  }
});

router.post('/:id/draft-profile', async (req: any, res) => {
  try {
    const { id } = req.params;

    const profile = await prisma.virtual_learner_profiles.findUnique({ where: { id } });
    if (!profile) {
      return res.status(404).json({ success: false, error: '虚拟用户不存在' });
    }

    const existingProfile = parseJson<any>(profile.profile, {});
    const existingTraits = parseJson<any>(profile.personalityTraits, {});
    const result = await executeSkill(virtualLearnerPersonaDesignerDefinition, {
      preferredLevels: profile.knowledgeLevel ? [profile.knowledgeLevel] : undefined,
      existingPersonaSeed: {
        ...existingProfile,
        personalityTraits: existingTraits,
        learningGoal: profile.learningGoal,
      }
    });

    const personaSeed = result?.personaSeed;
    if (!personaSeed) {
      return res.status(500).json({ success: false, error: '增强画像生成失败' });
    }

    res.json({
      success: true,
      data: {
        generatedProfile: personaSeed,
      }
    });
  } catch (error: any) {
    logger.error('增强画像生成失败:', error);
    res.status(500).json({ success: false, error: error.message || '增强画像生成失败' });
  }
});

router.post('/:id/draft-stories', async (req: any, res) => {
  try {
    const { id } = req.params;

    const profile = await prisma.virtual_learner_profiles.findUnique({ where: { id } });
    if (!profile) {
      return res.status(404).json({ success: false, error: '虚拟用户不存在' });
    }

    const { profileData } = await ensureProfileStoryPool(profile);
    const existingStoryPool = Array.isArray(profileData.storyPool) ? profileData.storyPool : [];
    const recentScenarioHints = await buildRecentScenarioHints();

    logger.info('[admin-generate-stories] 开始生成故事', {
      virtualProfileId: id,
      profileUserId: profile.userId,
      existingStoryPoolCount: existingStoryPool.length,
      hasExistingPersonaSeed: !!profileData && Object.keys(profileData).length > 0,
      requestedStoryCount: 3,
    });

    const result = await executeSkill(virtualLearnerScenarioDesignerDefinition, {
      preferredMotivations: profileData?.motivationType ? [profileData.motivationType] : undefined,
      candidateDomains: DEFAULT_SCENARIO_CANDIDATE_DOMAINS,
      candidatePersonas: DEFAULT_SCENARIO_CANDIDATE_PERSONAS,
      recentScenarioHints,
      existingPersonaSeed: profileData,
      existingStoryPool,
      targetStoryCount: 1,
    });

    logger.info('[admin-generate-stories] 故事生成完成', {
      virtualProfileId: id,
      generatedStoryTitle: result?.story?.title || null,
      systemPromptVersion: result?._debug?.systemPromptVersion || null,
    });

    const newStory = result?.story;
    if (newStory) {
      const storyWithStatus = {
        ...newStory,
        createdAt: new Date().toISOString(),
      };
      const normalizedUpdated = normalizeStoryPoolData({
        ...profileData,
        storyPool: [...existingStoryPool, storyWithStatus],
      });
      const updatedStoryPool = normalizedUpdated.storyPool;
      const updatedProfile = normalizedUpdated.profileData;

      await prisma.virtual_learner_profiles.update({
        where: { id },
        data: { profile: JSON.stringify(updatedProfile) },
      });

      logger.info('[admin-generate-stories] 故事已自动持久化', {
        virtualProfileId: id,
        storyPoolCount: updatedStoryPool.length,
      });

      return res.json({
        success: true,
        data: {
          ...result,
          persisted: true,
          storyPoolCount: updatedStoryPool.length,
        },
      });
    }

    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error('增强故事生成失败:', error);
    res.status(500).json({ success: false, error: error.message || '增强故事生成失败' });
  }
});

router.put('/:id/stories/:storyIndex', async (req: any, res) => {
  try {
    const { id, storyIndex } = req.params;
    const { title, storyOutline, storyTriggerEvent, visibleOpening, pressurePoints, problemKnowledge } = req.body || {};

    const profile = await prisma.virtual_learner_profiles.findUnique({ where: { id } });
    if (!profile) {
      return res.status(404).json({ success: false, error: '虚拟用户不存在' });
    }

    const { profileData } = await ensureProfileStoryPool(profile);
    const storyPool = Array.isArray(profileData.storyPool) ? profileData.storyPool : [];
    const index = parseInt(storyIndex, 10);

    if (isNaN(index) || index < 0 || index >= storyPool.length) {
      return res.status(400).json({ success: false, error: '无效的故事索引' });
    }

    const updatedStoryPool = [...storyPool];
    const currentStory = updatedStoryPool[index] || {};
    const nextStory = { ...currentStory };

    if (typeof title === 'string') {
      nextStory.title = title.trim();
    }

    if (typeof storyOutline === 'string') {
      nextStory.storyOutline = storyOutline.trim();
    }

    if (typeof storyTriggerEvent === 'string') {
      nextStory.storyTriggerEvent = storyTriggerEvent.trim();
      nextStory.triggerEvent = storyTriggerEvent.trim();
    }

    if (typeof visibleOpening === 'string') {
      nextStory.visibleOpening = visibleOpening.trim();
    }

    if (Array.isArray(pressurePoints)) {
      nextStory.pressurePoints = pressurePoints
        .map((item: any) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item: string) => !!item);
    }

    if (problemKnowledge && typeof problemKnowledge === 'object') {
      nextStory.problemKnowledge = {
        domainFamiliarity: ['low', 'medium', 'high'].includes(String(problemKnowledge.domainFamiliarity)) ? String(problemKnowledge.domainFamiliarity) : 'low',
        knownConcepts: Array.isArray(problemKnowledge.knownConcepts)
          ? problemKnowledge.knownConcepts.map((item: any) => (typeof item === 'string' ? item.trim() : '')).filter((item: string) => !!item)
          : [],
        struggleConcepts: Array.isArray(problemKnowledge.struggleConcepts)
          ? problemKnowledge.struggleConcepts.map((item: any) => (typeof item === 'string' ? item.trim() : '')).filter((item: string) => !!item)
          : [],
        selfAssessment: typeof problemKnowledge.selfAssessment === 'string' ? problemKnowledge.selfAssessment.trim() : '',
        hiddenGaps: Array.isArray(problemKnowledge.hiddenGaps)
          ? problemKnowledge.hiddenGaps.map((item: any) => (typeof item === 'string' ? item.trim() : '')).filter((item: string) => !!item)
          : []
      }
    }

    updatedStoryPool[index] = nextStory;

    const normalizedUpdated = normalizeStoryPoolData({
      ...profileData,
      storyPool: updatedStoryPool,
    });
    const updatedProfile = normalizedUpdated.profileData;

    await prisma.virtual_learner_profiles.update({
      where: { id },
      data: { profile: JSON.stringify(updatedProfile) },
    });

    res.json({
      success: true,
      data: {
        storyPool: normalizedUpdated.storyPool,
      },
    });
  } catch (error: any) {
    logger.error('更新故事状态失败:', error);
    res.status(500).json({ success: false, error: error.message || '更新故事状态失败' });
  }
});

router.delete('/:id/stories/:storyIndex', async (req: any, res) => {
  try {
    const { id, storyIndex } = req.params;

    const profile = await prisma.virtual_learner_profiles.findUnique({ where: { id } });
    if (!profile) {
      return res.status(404).json({ success: false, error: '虚拟用户不存在' });
    }

    const { profileData } = await ensureProfileStoryPool(profile);
    const storyPool = Array.isArray(profileData.storyPool) ? profileData.storyPool : [];
    const index = parseInt(storyIndex, 10);

    if (isNaN(index) || index < 0 || index >= storyPool.length) {
      return res.status(400).json({ success: false, error: '无效的故事索引' });
    }

    const updatedStoryPool = storyPool.filter((_: any, i: number) => i !== index);

    const normalizedUpdated = normalizeStoryPoolData({
      ...profileData,
      storyPool: updatedStoryPool,
    });
    const updatedProfile = normalizedUpdated.profileData;

    await prisma.virtual_learner_profiles.update({
      where: { id },
      data: { profile: JSON.stringify(updatedProfile) },
    });

    res.json({
      success: true,
      data: {
        storyPool: normalizedUpdated.storyPool,
      },
    });
  } catch (error: any) {
    logger.error('删除故事失败:', error);
    res.status(500).json({ success: false, error: error.message || '删除故事失败' });
  }
});

/**
 * 创建虚拟用户
 * POST /api/admin/virtual-learners
 */
router.post('/', async (req: any, res) => {
  try {
    const {
      name,
      profile,
      learningGoal,
      knowledgeLevel,
      knownConcepts,
      struggleConcepts,
      simulationMode,
      simulationPrompt,
      simulationModel,
      simulationTemperature,
      personalityTraits,
      tags,
      notes
    } = req.body;
    
    if (!name) {
      return res.status(400).json({
        success: false,
        error: '名称不能为空'
      });
    }

    const normalizedLearningGoal = typeof learningGoal === 'string' ? learningGoal.trim() : '';
    const normalizedKnowledgeLevel = typeof knowledgeLevel === 'string' && knowledgeLevel.trim()
      ? knowledgeLevel.trim()
      : 'beginner';
    
    const email = `virtual_${uuidv4().substring(0, 8)}@test.local`;
    // 虚拟学习者仅供系统编排使用，不提供可共享的登录凭据。
    const hashedPassword = await bcrypt.hash(randomBytes(32).toString('hex'), 10);
    
    const user = await prisma.users.create({
      data: {
        id: uuidv4(),
        email,
        name,
        password: hashedPassword,
        role: 'user',
        currentLevel: normalizedKnowledgeLevel || 'beginner',
        isAdmin: false,
        // 合成数据标记：生产统计（overview/stats 等）据此排除虚拟学习者
        isVirtualLearner: true,
        updatedAt: new Date()
      }
    });
    
    await prisma.student_baselines.create({
      data: {
        id: uuidv4(),
        userId: user.id,
        totalXp: 0,
        totalTime: 0,
        totalTasks: 0,
        completedTasks: 0,
        avgRating: 0,
        streakDays: 0
      }
    });
    
    const virtualProfile = await prisma.virtual_learner_profiles.create({
      data: {
        id: uuidv4(),
        userId: user.id,
        profile: JSON.stringify(profile || {}),
        learningGoal: normalizedLearningGoal,
        knowledgeLevel: normalizedKnowledgeLevel,
        knownConcepts: knownConcepts ? JSON.stringify(knownConcepts) : null,
        struggleConcepts: struggleConcepts ? JSON.stringify(struggleConcepts) : null,
        simulationMode: simulationMode || 'manual',
        simulationPrompt,
        simulationModel,
        simulationTemperature: simulationTemperature || 0.8,
        personalityTraits: personalityTraits ? JSON.stringify(personalityTraits) : null,
        tags: tags ? JSON.stringify(tags) : null,
        notes
      }
    });
    
    logger.info('创建虚拟用户成功', {
      userId: user.id,
      email,
      name,
      createdBy: req.user?.userId
    });
    
    res.json({
      success: true,
      data: {
        ...virtualProfile,
        email,
        profile: JSON.parse(virtualProfile.profile),
        knownConcepts: virtualProfile.knownConcepts ? JSON.parse(virtualProfile.knownConcepts) : [],
        struggleConcepts: virtualProfile.struggleConcepts ? JSON.parse(virtualProfile.struggleConcepts) : [],
        personalityTraits: virtualProfile.personalityTraits ? JSON.parse(virtualProfile.personalityTraits) : {},
        tags: virtualProfile.tags ? JSON.parse(virtualProfile.tags) : []
      }
    });
  } catch (error: any) {
    logger.error('创建虚拟用户失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '创建虚拟用户失败'
    });
  }
});

/**
 * 获取虚拟用户列表
 * GET /api/admin/virtual-learners
 */
router.get('/', async (req: any, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;
    
    const [profiles, total] = await Promise.all([
      prisma.virtual_learner_profiles.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          users: {
            select: {
              id: true,
              email: true,
              name: true,
              currentLevel: true,
              createdAt: true
            }
          },
          sessions: {
            select: {
              id: true,
              status: true,
              currentStage: true,
              createdAt: true,
              updatedAt: true
            },
            orderBy: { createdAt: 'desc' },
            take: 5
          },
          _count: {
            select: { sessions: true }
          }
        }
      }),
      prisma.virtual_learner_profiles.count()
    ]);
    
    const formattedProfiles = profiles.map(p => {
      const profileData = JSON.parse(p.profile || '{}');
      const storyPool = Array.isArray(profileData?.storyPool) ? profileData.storyPool : [];
      return {
        ...p,
        email: p.users.email,
        userName: p.users.name,
        profile: profileData,
        knownConcepts: p.knownConcepts ? JSON.parse(p.knownConcepts) : [],
        struggleConcepts: p.struggleConcepts ? JSON.parse(p.struggleConcepts) : [],
        personalityTraits: p.personalityTraits ? JSON.parse(p.personalityTraits) : {},
        tags: p.tags ? JSON.parse(p.tags) : [],
        sessionCount: p._count?.sessions ?? p.sessions.length,
        storyCount: storyPool.length
      };
    });
    
    res.json({
      success: true,
      data: {
        profiles: formattedProfiles,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error: any) {
    logger.error('获取虚拟用户列表失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取虚拟用户列表失败'
    });
  }
});

/**
 * 获取虚拟用户详情
 * GET /api/admin/virtual-learners/:id
 */
router.get('/:id', async (req: any, res) => {
  try {
    const { id } = req.params;
    
    const profile = await prisma.virtual_learner_profiles.findUnique({
      where: { id },
      include: {
        users: {
          select: {
            id: true,
            email: true,
            name: true,
            currentLevel: true
          }
        },
        sessions: {
          orderBy: { updatedAt: 'desc' },
          take: 200
        }
      }
    });
    
    if (!profile) {
      return res.status(404).json({
        success: false,
        error: '虚拟用户不存在'
      });
    }

    const { profileData } = await ensureProfileStoryPool(profile);
    
    res.json({
      success: true,
      data: {
        ...profile,
        email: profile.users.email,
        userName: profile.users.name,
        profile: profileData,
        knownConcepts: profile.knownConcepts ? JSON.parse(profile.knownConcepts) : [],
        struggleConcepts: profile.struggleConcepts ? JSON.parse(profile.struggleConcepts) : [],
        personalityTraits: profile.personalityTraits ? JSON.parse(profile.personalityTraits) : {},
        tags: profile.tags ? JSON.parse(profile.tags) : [],
        sessions: Array.isArray(profile.sessions) ? profile.sessions.map((session: any) => buildSessionSummary(session)) : []
      }
    });
  } catch (error: any) {
    logger.error('获取虚拟用户详情失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取虚拟用户详情失败'
    });
  }
});

/**
 * 更新虚拟用户画像
 * PUT /api/admin/virtual-learners/:id
 */
router.put('/:id', async (req: any, res) => {
  try {
    const { id } = req.params;
    
    const profile = await prisma.virtual_learner_profiles.findUnique({
      where: { id }
    });
    
    if (!profile) {
      return res.status(404).json({
        success: false,
        error: '虚拟用户不存在'
      });
    }
    
    const updateData: any = {};
    
    if (req.body.profile) {
      const existingProfile = parseJson<any>(profile.profile, {});
      updateData.profile = JSON.stringify({ ...existingProfile, ...req.body.profile });
    }
    if (typeof req.body.name === 'string' && req.body.name.trim()) {
      await prisma.users.update({ where: { id: profile.userId }, data: { name: req.body.name.trim() } });
    }
    // learningGoal 的产品语义已降为可选长期倾向；请求显式携带空串时也要允许清空。
    if (typeof req.body.learningGoal === 'string') updateData.learningGoal = req.body.learningGoal.trim();
    if (req.body.knowledgeLevel) updateData.knowledgeLevel = req.body.knowledgeLevel;
    if (req.body.knownConcepts) updateData.knownConcepts = JSON.stringify(req.body.knownConcepts);
    if (req.body.struggleConcepts) updateData.struggleConcepts = JSON.stringify(req.body.struggleConcepts);
    if (req.body.simulationMode) updateData.simulationMode = req.body.simulationMode;
    if (req.body.simulationPrompt) updateData.simulationPrompt = req.body.simulationPrompt;
    if (req.body.simulationModel) updateData.simulationModel = req.body.simulationModel;
    if (req.body.simulationTemperature) updateData.simulationTemperature = req.body.simulationTemperature;
    if (req.body.personalityTraits) updateData.personalityTraits = JSON.stringify(req.body.personalityTraits);
    if (req.body.tags) updateData.tags = JSON.stringify(req.body.tags);
    if (req.body.notes) updateData.notes = req.body.notes;
    
    const updated = await prisma.virtual_learner_profiles.update({
      where: { id },
      data: updateData
    });
    
    res.json({
      success: true,
      data: {
        ...updated,
        profile: JSON.parse(updated.profile || '{}'),
        knownConcepts: updated.knownConcepts ? JSON.parse(updated.knownConcepts) : [],
        struggleConcepts: updated.struggleConcepts ? JSON.parse(updated.struggleConcepts) : [],
        personalityTraits: updated.personalityTraits ? JSON.parse(updated.personalityTraits) : {},
        tags: updated.tags ? JSON.parse(updated.tags) : []
      }
    });
  } catch (error: any) {
    logger.error('更新虚拟用户画像失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '更新虚拟用户画像失败'
    });
  }
});

/**
 * 删除虚拟用户
 * DELETE /api/admin/virtual-learners/:id
 */
router.delete('/:id', async (req: any, res) => {
  try {
    const { id } = req.params;
    
    const profile = await prisma.virtual_learner_profiles.findUnique({
      where: { id }
    });
    
    if (!profile) {
      return res.status(404).json({
        success: false,
        error: '虚拟用户不存在'
      });
    }

    const sessionCount = await prisma.virtual_sessions.count({
      where: { virtualProfileId: id }
    });
    if (sessionCount > 0) {
      return res.status(409).json({
        success: false,
        error: '虚拟用户仍有模拟会话，请先逐个删除会话',
        code: 'VIRTUAL_PROFILE_HAS_SESSIONS'
      });
    }

    await prisma.$transaction(async tx => {
      const currentProfile = await tx.virtual_learner_profiles.findUnique({
        where: { id }
      });
      if (!currentProfile) throw new Error('虚拟用户不存在');

      const currentSessionCount = await tx.virtual_sessions.count({
        where: { virtualProfileId: id }
      });
      if (currentSessionCount > 0) {
        throw Object.assign(new Error('虚拟用户仍有模拟会话，请先逐个删除会话'), {
          code: 'VIRTUAL_PROFILE_HAS_SESSIONS',
          statusCode: 409
        });
      }

      await tx.virtual_learner_profiles.delete({ where: { id } });
      await tx.users.delete({ where: { id: currentProfile.userId } });
    });
    
    logger.info('删除虚拟用户成功', {
      profileId: id,
      userId: profile.userId,
      deletedBy: req.user?.userId
    });
    
    res.json({
      success: true,
      message: '虚拟用户已删除'
    });
  } catch (error: any) {
    logger.error('删除虚拟用户失败:', error);
    res.status(error?.statusCode || (error?.message === '虚拟用户不存在' ? 404 : 500)).json({
      success: false,
      error: error.message || '删除虚拟用户失败',
      ...(error?.code ? { code: error.code } : {})
    });
  }
});

/**
 * 启动模拟会话
 * POST /api/admin/virtual-learners/:id/start-session
 */
router.post('/:id/start-session', async (req: any, res) => {
  try {
    const { id } = req.params;
    const { storyId, storyIndex, frictionBudget } = req.body || {};
    if (frictionBudget && !SIMULATION_FRICTION_BUDGETS.includes(frictionBudget)) {
      return res.status(400).json({ success: false, error: 'frictionBudget 不合法' });
    }
    const session = await createSessionForProfile(id, { storyId, storyIndex, frictionBudget });
    if (!session) {
      return res.status(404).json({ success: false, error: '虚拟用户不存在' });
    }
    res.json({ success: true, data: session });
  } catch (error: any) {
    const status = Number(error?.status) || 500;
    if (status >= 500) logger.error('启动模拟会话失败:', error);
    res.status(status).json({
      success: false,
      error: error.message || '启动模拟会话失败',
      ...(error?.code ? { code: error.code } : {})
    });
  }
});

/**
 * 获取模拟会话详情
 * GET /api/admin/virtual-sessions/:sessionId
 */
router.get('/sessions/:sessionId', async (req: any, res) => {
  try {
    const { sessionId } = req.params;
    
    const session = await prisma.virtual_sessions.findUnique({
      where: { id: sessionId },
      include: {
        virtual_learner_profiles: {
          include: {
            users: {
              select: {
                id: true,
                email: true,
                name: true
              }
            }
          }
        }
      }
    });
    
    if (!session) {
      return res.status(404).json({
        success: false,
        error: '模拟会话不存在'
      });
    }
    
    let logs: any[] = [];
    try {
      logs = JSON.parse(session.logs || '[]');
    } catch {
      // ignore malformed logs payload
    }
    
    let stageResults: any = {};
    try {
      stageResults = JSON.parse(session.stageResults || '{}');
    } catch {
      // ignore malformed stageResults payload
    }

    let goalConversation: any = null;
    if (session.goalConversationId) {
      goalConversation = await prisma.goal_conversations.findFirst({
        where: { id: session.goalConversationId }
      });
    }

    let teachingSession: any = null;
    const teachingSessionId = stageResults?.learning?.teachingSessionId;
    if (typeof teachingSessionId === 'string' && teachingSessionId.trim()) {
      teachingSession = await teachingSessionRepository.getById(teachingSessionId.trim());
    }

    const conversations = buildSessionConversations(session, logs, goalConversation);
    const runtime = buildSessionRuntime(session, teachingSession);
    
    res.json({
      success: true,
      data: {
        ...session,
        logs,
        stageResults,
        conversations,
        runtime,
        bindings: buildSessionBindings(session),
        storyContext: parseStoryContext(session),
        profile: {
          ...session.virtual_learner_profiles,
          profile: JSON.parse(session.virtual_learner_profiles.profile || '{}'),
          email: session.virtual_learner_profiles.users.email,
          userName: session.virtual_learner_profiles.users.name
        }
      }
    });
  } catch (error: any) {
    logger.error('获取模拟会话详情失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取模拟会话详情失败'
    });
  }
});

router.post('/:id/projection-token', async (req: any, res) => {
  try {
    const { id } = req.params;
    const operatorId = req.user?.userId;

    const profile = await prisma.virtual_learner_profiles.findUnique({
      where: { id },
      include: {
        users: {
          select: { id: true, email: true, name: true }
        }
      }
    });

    if (!profile) {
      return res.status(404).json({ success: false, error: '虚拟用户不存在' });
    }

    const token = signProjectionToken({
      targetUserId: profile.userId,
      sourceProfileId: profile.id,
      issuedByAdminId: operatorId,
      grantSource: 'virtual-learner',
      grantId: null,
      storyId: typeof req.body?.storyId === 'string' && req.body.storyId.trim() ? req.body.storyId.trim() : null,
      virtualSessionId: typeof req.body?.virtualSessionId === 'string' && req.body.virtualSessionId.trim() ? req.body.virtualSessionId.trim() : null,
      scope: req.body?.scope === 'full' ? 'full' : 'dashboard',
      type: 'projection'
    });

    res.json({
      success: true,
      data: {
        token,
        grantSource: 'virtual-learner',
        grantId: null,
        targetUserId: profile.userId,
        profileId: profile.id,
        userName: profile.users.name,
        email: profile.users.email,
        expiresIn: '30m'
      }
    });
  } catch (error: any) {
    logger.error('创建前台投影 token 失败:', error)
    res.status(500).json({ success: false, error: error.message || '创建前台投影 token 失败' })
  }
})

router.get('/:id/test-projection', async (req: any, res) => {
  try {
    const { id } = req.params;

    const profile = await prisma.virtual_learner_profiles.findUnique({
      where: { id },
      include: {
        users: {
          select: { id: true, email: true, name: true }
        },
        sessions: {
          orderBy: { updatedAt: 'desc' },
          take: 200,
        },
      },
    });

    if (!profile) {
      return res.status(404).json({ success: false, error: '虚拟用户不存在' });
    }

    res.json({
      success: true,
      data: buildVirtualLearnerTestProjection(profile)
    });
  } catch (error: any) {
    logger.error('获取虚拟学习者 test 投影失败:', error)
    res.status(500).json({ success: false, error: error.message || '获取虚拟学习者 test 投影失败' })
  }
})

router.post('/projection/resolve', async (req: any, res) => {
  try {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : ''
    if (!token) {
      return res.status(400).json({ success: false, error: '缺少投影 token' })
    }

    const payload = verifyProjectionToken(token)

    if ((payload.grantSource || 'virtual-learner') !== 'virtual-learner' || !payload.sourceProfileId) {
      return res.status(400).json({ success: false, error: '该投影 token 不属于虚拟学习者投影' })
    }

    const profile = await prisma.virtual_learner_profiles.findUnique({
      where: { id: payload.sourceProfileId },
      include: {
        users: {
          select: { id: true, email: true, name: true }
        }
      }
    })

    if (!profile) {
      return res.status(404).json({ success: false, error: '投影用户不存在' })
    }

    res.json({
      success: true,
      data: {
        targetUserId: payload.targetUserId,
        sourceProfileId: payload.sourceProfileId,
        issuedByAdminId: payload.issuedByAdminId,
        grantSource: payload.grantSource || 'virtual-learner',
        grantId: payload.grantId || null,
        storyId: payload.storyId || null,
        virtualSessionId: payload.virtualSessionId || null,
        scope: payload.scope,
        scopeDefinition: payload.scopeDefinition || null,
        profile: {
          id: profile.id,
          userId: profile.userId,
          userName: profile.users.name,
          email: profile.users.email
        }
      }
    })
  } catch (error: any) {
    logger.error('解析前台投影 token 失败:', error)
    res.status(401).json({ success: false, error: error.message || '解析前台投影 token 失败' })
  }
})

/**
 * 获取模拟会话上下文
 * GET /api/admin/virtual-learners/sessions/:sessionId/context
 */
router.get('/sessions/:sessionId/context', async (req: any, res) => {
  try {
    const { sessionId } = req.params;

    const session = await prisma.virtual_sessions.findUnique({
      where: { id: sessionId },
      include: {
        virtual_learner_profiles: {
          include: {
            users: {
              select: {
                id: true,
                email: true,
                name: true
              }
            }
          }
        }
      }
    });

    if (!session) {
      return res.status(404).json({
        success: false,
        error: '模拟会话不存在'
      });
    }

    const storyContext = parseStoryContext(session);
    const bindings = buildSessionBindings(session);
    const stageResults = parseStageResults(session);
    const logs = parseLogs(session);
    let goalConversation: any = null;
    let teachingSession: any = null;

    if (session.goalConversationId) {
      goalConversation = await prisma.goal_conversations.findFirst({
        where: { id: session.goalConversationId }
      });
    }

    const teachingSessionId = stageResults?.learning?.teachingSessionId;
    if (typeof teachingSessionId === 'string' && teachingSessionId.trim()) {
      teachingSession = await teachingSessionRepository.getById(teachingSessionId.trim());
    }

    const conversations = buildSessionConversations(session, logs, goalConversation);
    const runtime = buildSessionRuntime(session, teachingSession);

    res.json({
      success: true,
      data: {
        virtualSession: buildSessionSummary(session),
        profile: {
          id: session.virtual_learner_profiles.id,
          userId: session.virtual_learner_profiles.userId,
          email: session.virtual_learner_profiles.users.email,
          userName: session.virtual_learner_profiles.users.name,
          learningGoal: session.virtual_learner_profiles.learningGoal,
          knowledgeLevel: session.virtual_learner_profiles.knowledgeLevel,
          profile: parseJson<any>(session.virtual_learner_profiles.profile, {}),
        },
        storyContext,
        bindings,
        currentStage: session.currentStage,
        status: session.status,
        stageResults,
        runtime,
        conversations,
      }
    });
  } catch (error: any) {
    logger.error('获取模拟会话上下文失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取模拟会话上下文失败'
    });
  }
});

/**
 * 单步模拟（手动模式）
 * POST /api/admin/virtual-sessions/:sessionId/step
 */
router.post('/sessions/:sessionId/step', async (req: any, res) => {
  try {
    const { sessionId } = req.params;
    const result = await runAssistedSessionMutation(sessionId, session =>
      simulationCoordinator.executeSingleStep({
        sessionId,
        userId: session.userId,
        mode: 'single-step'
      })
    );
    
    res.json({
      success: result.success,
      data: result,
      error: result.error
    });
  } catch (error: any) {
    logger.error('单步模拟失败:', error);
    sendVirtualSessionError(res, error, '单步模拟失败');
  }
});

/**
 * 自动循环模拟
 * POST /api/admin/virtual-sessions/:sessionId/auto
 */
router.post('/sessions/:sessionId/auto', async (req: any, res) => {
  try {
    const { sessionId } = req.params;
    const maxRounds = parseSimulationLimit(req.body?.maxRounds, 20, 50, 'maxRounds');
    
    const results = await runAssistedSessionMutation(sessionId, session =>
      simulationCoordinator.executeAutoLoop(
        {
          sessionId,
          userId: session.userId,
          mode: 'auto-loop'
        },
        { maxRounds }
      )
    );
    
    res.json({
      success: true,
      data: {
        results,
        totalRounds: results.length,
        lastResult: results[results.length - 1]
      }
    });
  } catch (error: any) {
    logger.error('自动循环模拟失败:', error);
    sendVirtualSessionError(res, error, '自动循环模拟失败');
  }
});

/**
 * 兜底重试：推进到路径生成阶段
 * 仅在 goalConversationService 自动触发的 path 生成失败时由前端调用
 * POST /api/admin/virtual-sessions/:sessionId/advance-path
 */
router.post('/sessions/:sessionId/advance-path', async (req: any, res) => {
  try {
    const { sessionId } = req.params;
    const result = await runAssistedSessionMutation(sessionId, () =>
      simulationCoordinator.advanceToPathGeneration(sessionId)
    );
    
    res.json({
      success: result.success,
      data: result,
      error: result.error
    });
  } catch (error: any) {
    logger.error('推进路径生成失败:', error);
    sendVirtualSessionError(res, error, '推进路径生成失败');
  }
});

router.post('/:id/start-blackbox-session', async (req: any, res) => {
  try {
    const { storyId, storyIndex, frictionBudget } = req.body || {};
    if (frictionBudget && !SIMULATION_FRICTION_BUDGETS.includes(frictionBudget)) {
      return res.status(400).json({ success: false, error: 'frictionBudget 不合法' });
    }
    const session = await createSessionForProfile(req.params.id, {
      storyId,
      storyIndex,
      frictionBudget,
      blackboxOperatorId: req.user.userId
    });
    if (!session) return res.status(404).json({ success: false, error: '虚拟用户不存在' });
    res.json({ success: true, data: session });
  } catch (error: any) {
    const status = Number(error?.status) || 500;
    if (status >= 500) logger.error('启动黑盒模拟会话失败:', error);
    res.status(status).json({
      success: false,
      error: error.message || '启动黑盒模拟会话失败',
      ...(error?.code ? { code: error.code } : {})
    });
  }
});

router.post('/sessions/:sessionId/blackbox-rerun', async (req: any, res) => {
  try {
    const source = await prisma.virtual_sessions.findUnique({ where: { id: req.params.sessionId } });
    if (!source) return res.status(404).json({ success: false, error: '模拟会话不存在' });
    if (!['completed', 'failed', 'abandoned'].includes(source.status)) {
      return res.status(409).json({ success: false, error: '只有终态黑盒实验可以按原输入重跑' });
    }
    const sourceState = parseJson<any>(source.stageResults, {});
    if (sourceState.experiment?.mode !== 'blackbox-api') {
      return res.status(409).json({ success: false, error: '当前会话不是 blackbox-api 实验' });
    }
    const snapshot = sourceState.experimentSnapshot;
    const simulatorSnapshots = [snapshot?.simulators?.goal, snapshot?.simulators?.learning];
    const hasCompleteRuntimeSnapshot = snapshot?.actorProfile
      && snapshot?.frictionBudget
      && typeof snapshot?.simulatorPrompts?.goal === 'string'
      && typeof snapshot?.simulatorPrompts?.learning === 'string'
      && simulatorSnapshots.every((item: any) => item?.route?.providerId
        && item?.route?.credentialFingerprint
        && item?.route?.endpoint
        && item?.route?.model
        && Number.isFinite(item?.temperature)
        && Number.isFinite(item?.maxTokens));
    if (!hasCompleteRuntimeSnapshot) {
      return res.status(409).json({ success: false, error: '旧实验缺少完整运行时快照，不能保证同配置重跑' });
    }
    if (!sourceState.experiment?.experimentId || !sourceState.experiment?.runId) {
      return res.status(409).json({ success: false, error: '旧实验缺少 lineage 标识，不能保证同实验重跑' });
    }
    const frictionBudget = snapshot.frictionBudget || 'normal';
    if (!SIMULATION_FRICTION_BUDGETS.includes(frictionBudget)) {
      return res.status(400).json({ success: false, error: 'frictionBudget 不合法' });
    }
    const rerun = await createSessionForProfile(source.virtualProfileId, {
      frictionBudget,
      blackboxOperatorId: req.user.userId,
      experimentId: sourceState.experiment.experimentId,
      parentRunId: sourceState.experiment.runId,
      actorProfileOverride: snapshot.actorProfile,
      storyContextOverride: snapshot.story ?? null,
      hasStoryContextOverride: true,
      experimentSnapshotOverride: snapshot
    });
    if (!rerun) return res.status(404).json({ success: false, error: '虚拟用户不存在' });
    res.json({ success: true, data: rerun });
  } catch (error: any) {
    logger.error('按原输入重跑黑盒实验失败:', error);
    sendVirtualSessionError(res, error, '按原输入重跑黑盒实验失败');
  }
});

function parseBlackboxAction(body: any): LearnerAction {
  const type = typeof body?.type === 'string' ? body.type : '';
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  const answer = typeof body?.answer === 'string' ? body.answer : '';
  const code = typeof body?.code === 'string' ? body.code : '';

  if (type === 'chat' || type === 'request_hint' || type === 'request_example' || type === 'confirm_proposal') {
    if (!text) throw new Error(`${type} 动作缺少 text`);
    return { type, text } as LearnerAction;
  }
  if (type === 'submit_answer') {
    if (!answer.trim()) throw new Error('submit_answer 动作缺少 answer');
    return { type, answer };
  }
  if (type === 'submit_code') {
    if (!code.trim()) throw new Error('submit_code 动作缺少 code');
    return { type, code };
  }
  if (type === 'abandon' || type === 'skip') {
    if (!reason) throw new Error(`${type} 动作缺少 reason`);
    return { type, reason } as LearnerAction;
  }
  if (type === 'start_learning') {
    return { type, taskId: typeof body.taskId === 'string' && body.taskId.trim() ? body.taskId.trim() : undefined };
  }
  if (type === 'confirm_complete') return { type };
  throw new Error('不支持的黑盒学习者动作');
}

async function requireAssistedSession(sessionId: string) {
  const session = await prisma.virtual_sessions.findUnique({ where: { id: sessionId } });
  if (!session) throw new Error('模拟会话不存在');
  assertAssistedSessionMode(parseJson<any>(session.stageResults, {}));
  return session;
}

async function runAssistedSessionMutation<T>(
  sessionId: string,
  work: (session: any, assertLeaseOwned: (leaseClient?: any) => Promise<void>) => Promise<T>
) {
  await requireAssistedSession(sessionId);
  return simulationCoordinator.runLeasedExclusive(sessionId, async assertLeaseOwned => {
    const session = await requireAssistedSession(sessionId);
    await assertLeaseOwned();
    const result = await work(session, assertLeaseOwned);
    await assertLeaseOwned();
    return result;
  });
}

function virtualSessionErrorStatus(error: any, fallback = 500) {
  if (typeof error?.statusCode === 'number') return error.statusCode;
  if (typeof error?.status === 'number') return error.status;
  const message = String(error?.message || '');
  if (message.includes('不存在')) return 404;
  if (message.includes('不合法') || message.includes('缺少') || message.includes('不支持')) return 400;
  if (message.includes('当前') || message.includes('不能') || message.includes('必须')) return 409;
  return fallback;
}

function sendVirtualSessionError(res: express.Response, error: any, fallbackMessage: string, fallbackStatus = 500) {
  return res.status(virtualSessionErrorStatus(error, fallbackStatus)).json({
    success: false,
    error: error?.message || fallbackMessage,
    ...(error?.code ? { code: error.code } : {}),
    ...(typeof error?.retryable === 'boolean' ? { retryable: error.retryable } : {})
  });
}

function getBlackboxCommandId(req: express.Request) {
  const header = req.get('Idempotency-Key');
  const bodyValue = typeof req.body?.commandId === 'string' ? req.body.commandId : '';
  return String(header || bodyValue || '').trim();
}

function getExpectedBlackboxTraceCount(req: express.Request) {
  const header = req.get('X-Expected-Trace-Count');
  const bodyValue = req.body?.expectedTraceCount;
  const value = header ?? bodyValue;
  const parsed = typeof value === 'number' ? value : Number(value);
  return parsed;
}

router.post('/sessions/:sessionId/blackbox-action', async (req: any, res) => {
  try {
    const action = parseBlackboxAction(req.body);
    const command = await blackboxVirtualLearnerRunner.runCommand({
      sessionId: req.params.sessionId,
      operatorId: req.user.userId,
      commandId: getBlackboxCommandId(req),
      kind: 'action',
      request: action,
      expectedTraceCount: getExpectedBlackboxTraceCount(req)
    }, () => blackboxVirtualLearnerRunner.act(req.params.sessionId, req.user.userId, action));
    res.json({ success: true, data: command.result, reused: command.reused });
  } catch (error: any) {
    logger.error('执行黑盒学习者动作失败:', error);
    sendVirtualSessionError(res, error, '执行黑盒学习者动作失败');
  }
});

router.post('/sessions/:sessionId/blackbox-step', async (req: any, res) => {
  try {
    const command = await blackboxVirtualLearnerRunner.runCommand({
      sessionId: req.params.sessionId,
      operatorId: req.user.userId,
      commandId: getBlackboxCommandId(req),
      kind: 'step',
      request: {},
      expectedTraceCount: getExpectedBlackboxTraceCount(req)
    }, () => blackboxVirtualLearnerRunner.autoStep(req.params.sessionId, req.user.userId));
    res.json({ success: true, data: command.result, reused: command.reused });
  } catch (error: any) {
    logger.error('执行黑盒自动步骤失败:', error);
    sendVirtualSessionError(res, error, '执行黑盒自动步骤失败');
  }
});

router.post('/sessions/:sessionId/blackbox-observe', async (req: any, res) => {
  try {
    const command = await blackboxVirtualLearnerRunner.runCommand({
      sessionId: req.params.sessionId,
      operatorId: req.user.userId,
      commandId: getBlackboxCommandId(req),
      kind: 'observe',
      request: {},
      expectedTraceCount: getExpectedBlackboxTraceCount(req)
    }, () => blackboxVirtualLearnerRunner.observe(req.params.sessionId, req.user.userId));
    res.json({ success: true, data: command.result, reused: command.reused });
  } catch (error: any) {
    logger.error('刷新黑盒平台观察失败:', error);
    sendVirtualSessionError(res, error, '刷新黑盒平台观察失败');
  }
});

router.get('/sessions/:sessionId/blackbox-snapshot', async (req: any, res) => {
  try {
    const result = await blackboxVirtualLearnerRunner.getSnapshot(req.params.sessionId);
    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error('获取黑盒实验快照失败:', error);
    sendVirtualSessionError(res, error, '获取黑盒实验快照失败');
  }
});

router.post('/sessions/:sessionId/blackbox-referee', async (req: any, res) => {
  try {
    const result = await blackboxVirtualLearnerRunner.runLeasedExclusive(
      req.params.sessionId,
      () => blackboxVirtualLearnerRunner.referee(req.params.sessionId, req.user.userId)
    );
    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error('生成黑盒裁判报告失败:', error);
    sendVirtualSessionError(res, error, '生成黑盒裁判报告失败', 502);
  }
});

router.post('/sessions/:sessionId/blackbox-evaluations', async (req: any, res) => {
  try {
    const result = await blackboxVirtualLearnerRunner.runLeasedExclusive(
      req.params.sessionId,
      async () => ({
        platform: await blackboxVirtualLearnerRunner.referee(req.params.sessionId, req.user.userId),
        actor: await blackboxVirtualLearnerRunner.actorAudit(req.params.sessionId, req.user.userId)
      })
    );
    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error('生成黑盒双评估报告失败:', error);
    sendVirtualSessionError(res, error, '生成黑盒双评估报告失败', 502);
  }
});

router.post('/sessions/:sessionId/synthetic-token', async (req: any, res) => {
  try {
    const session = await prisma.virtual_sessions.findUnique({ where: { id: req.params.sessionId } });
    if (!session) return res.status(404).json({ success: false, error: '模拟会话不存在' });

    const stageResults = parseJson<any>(session.stageResults, {});
    if (stageResults.experiment?.mode !== 'blackbox-api' || !stageResults.experiment?.experimentId || !stageResults.experiment?.runId) {
      return res.status(400).json({ success: false, error: '当前会话不是 blackbox-api 实验' });
    }

    const externallyAllowedCapabilities: SyntheticCapability[] = ['goal:read', 'path:read'];
    const allowed = new Set<string>(externallyAllowedCapabilities);
    const requested = Array.isArray(req.body?.capabilities) ? req.body.capabilities : externallyAllowedCapabilities;
    if (!requested.length || requested.some((item: unknown) => typeof item !== 'string' || !allowed.has(item))) {
      return res.status(400).json({ success: false, error: '外部 synthetic token 仅允许只读 capability' });
    }
    const capabilities = Array.from(new Set(requested)) as SyntheticCapability[];
    const token = signProjectionToken({
      targetUserId: session.userId,
      sourceProfileId: session.virtualProfileId,
      issuedByAdminId: req.user.userId,
      grantSource: 'synthetic',
      virtualSessionId: session.id,
      scope: 'full',
      capabilities,
      experimentId: stageResults.experiment.experimentId,
      runId: stageResults.experiment.runId,
      type: 'projection'
    });

    res.json({
      success: true,
      data: {
        token,
        expiresIn: '30m',
        capabilities,
        experimentId: stageResults.experiment.experimentId,
        runId: stageResults.experiment.runId,
        targetUserId: session.userId,
        virtualSessionId: session.id
      }
    });
  } catch (error: any) {
    logger.error('签发合成用户 token 失败:', error);
    res.status(500).json({ success: false, error: error.message || '签发合成用户 token 失败' });
  }
});

/**
 * 以虚拟学习者视角评审当前 Path。只产出评审结论（accept/modify/reject），
 * 不自动启动 Learn、不自动重规划；后续动作由人工通过 accept-path / replan-path 触发。
 * POST /api/admin/virtual-learners/sessions/:sessionId/review-path
 */
router.post('/sessions/:sessionId/review-path', async (req: any, res) => {
  try {
    const result = await runAssistedSessionMutation(req.params.sessionId, () =>
      simulationCoordinator.reviewPathProposal(req.params.sessionId)
    );
    res.json({ success: result.success, data: result, error: result.error });
  } catch (error: any) {
    logger.error('Path 评审失败:', error);
    sendVirtualSessionError(res, error, 'Path 评审失败');
  }
});

/**
 * 人工确认接受评审结论（decision=accept 且评审对应当前 Path）。只改评审状态，不启动 Learn。
 * POST /api/admin/virtual-learners/sessions/:sessionId/accept-path
 */
router.post('/sessions/:sessionId/accept-path', async (req: any, res) => {
  try {
    const result = await runAssistedSessionMutation(req.params.sessionId, () =>
      simulationCoordinator.acceptPathReview(req.params.sessionId)
    );
    res.json({ success: result.success, data: result, error: result.error });
  } catch (error: any) {
    logger.error('接受 Path 失败:', error);
    sendVirtualSessionError(res, error, '接受 Path 失败');
  }
});

/**
 * 人工触发：按评审意见重规划 Path（评审保持 pending 直到人工决定）。
 * POST /api/admin/virtual-learners/sessions/:sessionId/replan-path
 */
router.post('/sessions/:sessionId/replan-path', async (req: any, res) => {
  try {
    const result = await runAssistedSessionMutation(req.params.sessionId, () =>
      simulationCoordinator.replanPathFromReview(req.params.sessionId)
    );
    res.json({ success: result.success, data: result, error: result.error });
  } catch (error: any) {
    logger.error('重规划 Path 失败:', error);
    sendVirtualSessionError(res, error, '重规划 Path 失败');
  }
});

/**
 * 查询路径生成状态（前端轮询用）
 * GET /api/admin/virtual-sessions/:sessionId/path-status
 */
router.get('/sessions/:sessionId/path-status', async (req: any, res) => {
  try {
    const { sessionId } = req.params;
    
    const session = await prisma.virtual_sessions.findUnique({
      where: { id: sessionId }
    });
    
    if (!session) {
      return res.status(404).json({
        success: false,
        error: '模拟会话不存在'
      });
    }
    
    if (!session.learningPathId) {
      return res.json({
        success: true,
        data: {
          status: session.currentStage === 'path' ? 'generating' : 'not_started',
          learningPathId: null,
          path: null,
          pathContext: null
        }
      });
    }
    
    const learningPath = await learningService.getLearningPath(session.learningPathId);
    
    if (!learningPath) {
      return res.json({
        success: true,
        data: {
          status: 'not_found',
          learningPathId: session.learningPathId,
          path: null,
          pathContext: null
        }
      });
    }

    const storyContext = parseStoryContext(session);
    const learningProgress = parseLearningProgress(session);
    const firstMilestone = learningPath.milestones?.[0] || null;
    const firstTask = firstMilestone?.subtasks?.[0] || null;
    const activeTask = learningPath.milestones
      ?.flatMap((milestone: any, milestoneIndex: number) => (milestone.subtasks || []).map((task: any, taskIndex: number) => ({
        ...task,
        milestone,
        milestoneIndex,
        taskIndex
      })))
      ?.find((task: any) => task.id === learningProgress.currentTaskId)
      || null;
    const contextTask = activeTask || firstTask;
    const contextMilestone = activeTask?.milestone || firstMilestone;
    const pathContext = {
      storyContext,
      pathTitle: learningPath.title,
      pathSummary: learningPath.summary || learningPath.description || learningPath.aiPromptTemplate || null,
      subject: learningPath.subject || null,
      currentStageNumber: learningProgress.currentMilestone !== undefined && learningProgress.currentMilestone !== null
        ? Number(learningProgress.currentMilestone) + 1
        : (contextMilestone?.stageNumber || 1),
      currentTaskOrder: learningProgress.currentTaskIdx !== undefined && learningProgress.currentTaskIdx !== null
        ? Number(learningProgress.currentTaskIdx) + 1
        : (contextTask?.order || 1),
      taskProfile: contextTask ? {
        knowledgeType: contextTask.knowledgeType || null,
        cognitiveLevel: contextTask.cognitiveLevel || null,
        displayLabel: contextTask.displayLabel || null,
        coreConcept: contextTask.coreConcept || null,
        learningObjectives: Array.isArray(contextTask.learningObjectives)
          ? contextTask.learningObjectives
          : typeof contextTask.learningObjectives === 'string' && contextTask.learningObjectives.trim()
            ? contextTask.learningObjectives.split(/[,，\n]/).map((item: string) => item.trim()).filter(Boolean)
            : [],
        linkedConceptName: contextTask.linkedConceptName || contextTask.coreConcept || null,
      } : null,
      currentMilestoneTitle: contextMilestone?.title || null,
      currentTaskTitle: contextTask?.title || null,
      taskKnowledgeScope: null,
      cognitiveFrame: null,
      teachingStrategyGuidance: null
    };

    res.json({
      success: true,
      data: {
        status: learningPath.status,
        learningPathId: learningPath.id,
        path: {
          id: learningPath.id,
          title: learningPath.title,
          name: learningPath.name,
          summary: learningPath.summary || null,
          description: learningPath.description,
          subject: learningPath.subject,
          difficulty: learningPath.difficulty,
          estimatedHours: learningPath.estimatedHours,
          totalMilestones: learningPath.totalMilestones,
          completedMilestones: learningPath.completedMilestones,
          status: learningPath.status,
          aiGenerated: learningPath.aiGenerated,
          generationStatus: learningPath.generationStatus || null,
          sceneSummary: learningPath.sceneSummary || null,
          cognitiveDesign: learningPath.cognitiveDesign || null,
          adjustmentPolicy: learningPath.adjustmentPolicy || null,
          adjustmentEvidence: learningPath.adjustmentEvidence || null,
          canStartLearning: learningPath.canStartLearning,
          learningBlockedReason: learningPath.learningBlockedReason || null,
          replanLineage: learningPath.replanLineage || null,
          createdAt: learningPath.createdAt,
          updatedAt: learningPath.updatedAt,
          milestones: learningPath.milestones,
          stages: learningPath.stages || learningPath.milestones,
          totalStages: learningPath.totalStages || learningPath.totalMilestones
        },
        pathContext
      }
    });
  } catch (error: any) {
    logger.error('查询路径状态失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '查询路径状态失败'
    });
  }
});

/**
 * 开始 Learning 阶段
 * POST /api/admin/virtual-sessions/:sessionId/start-learning
 */
router.post('/sessions/:sessionId/start-learning', async (req: any, res) => {
  try {
    const { sessionId } = req.params;
    const { taskId } = req.body || {};
    const result = await runAssistedSessionMutation(sessionId, () =>
      simulationCoordinator.startLearningPhase(sessionId, { taskId })
    );
    
    res.json({
      success: result.success,
      data: result,
      error: result.error
    });
  } catch (error: any) {
    logger.error('开始学习阶段失败:', error);
    sendVirtualSessionError(res, error, '开始学习阶段失败');
  }
});

/**
 * 执行单步学习
 * POST /api/admin/virtual-sessions/:sessionId/learning-step
 */
router.post('/sessions/:sessionId/learning-step', async (req: any, res) => {
  try {
    const { sessionId } = req.params;
    const result = await runAssistedSessionMutation(sessionId, () =>
      simulationCoordinator.executeLearningStep(sessionId)
    );
    
    res.json({
      success: result.success,
      data: result,
      error: result.error
    });
  } catch (error: any) {
    logger.error('执行学习步骤失败:', error);
    sendVirtualSessionError(res, error, '执行学习步骤失败');
  }
});

/**
 * 自动学习（完成整个路径或指定里程碑数）
 * POST /api/admin/virtual-sessions/:sessionId/auto-learning
 */
router.post('/sessions/:sessionId/auto-learning', async (req: any, res) => {
  try {
    const { sessionId } = req.params;
    const maxMilestones = parseSimulationLimit(req.body?.maxMilestones, 10, 20, 'maxMilestones');
    const result = await runAssistedSessionMutation(sessionId, () =>
      simulationCoordinator.executeAutoLearning(sessionId, { maxMilestones })
    );
    
    res.json({
      success: result.success,
      data: result,
      error: result.error
    });
  } catch (error: any) {
    logger.error('自动学习失败:', error);
    sendVirtualSessionError(res, error, '自动学习失败');
  }
});

/**
 * 一键全自动: Goal -> Path -> Learn 全流程
 * POST /api/admin/virtual-sessions/:sessionId/run-full
 * body: { maxRounds?, maxMilestones?, continueOnTaskComplete?, autoAdvanceToPath?, autoAdvanceToLearning? }
 */
router.post('/sessions/:sessionId/run-full', async (req: any, res) => {
  try {
    const { sessionId } = req.params;
    const {
      maxRounds: requestedMaxRounds,
      maxMilestones: requestedMaxMilestones,
      continueOnTaskComplete = true,
      autoAdvanceToPath = true,
      autoAdvanceToLearning = true
    } = req.body || {};
    const maxRounds = parseSimulationLimit(requestedMaxRounds, 20, 50, 'maxRounds');
    const maxMilestones = parseSimulationLimit(requestedMaxMilestones, 10, 20, 'maxMilestones');

    const result = await runAssistedSessionMutation(sessionId, () =>
      simulationCoordinator.executeFullSession(sessionId, {
        maxRounds,
        maxMilestones,
        continueOnTaskComplete,
        autoAdvanceToPath,
        autoAdvanceToLearning
      })
    );

    res.json({
      success: result.success,
      data: result,
      error: result.error
    });
  } catch (error: any) {
    logger.error('一键全流程失败:', error);
    sendVirtualSessionError(res, error, '一键全流程失败');
  }
});

/**
 * 手动触发 wrapup 学习总结
 * POST /api/admin/virtual-sessions/:sessionId/wrapup
 */
router.post('/sessions/:sessionId/wrapup', async (req: any, res) => {
  try {
    const { sessionId } = req.params;
    const result = await runAssistedSessionMutation(sessionId, () =>
      simulationCoordinator.generateWrapupForSession(sessionId)
    );

    res.json({
      success: result.success,
      data: result,
      error: result.error
    });
  } catch (error: any) {
    logger.error('生成 wrapup 失败:', error);
    sendVirtualSessionError(res, error, '生成 wrapup 失败');
  }
});

/**
 * 更新 session 的模拟配置 (目前主要是 frictionBudget)
 * PUT /api/admin/virtual-learners/sessions/:sessionId/simulation-config
 * body: { frictionBudget?: 'none' | 'low' | 'normal' | 'high' | 'stress_test' }
 */
router.put('/sessions/:sessionId/simulation-config', async (req: any, res) => {
  try {
    const { sessionId } = req.params;
    const { frictionBudget } = req.body || {};

    if (frictionBudget && !SIMULATION_FRICTION_BUDGETS.includes(frictionBudget)) {
      return res.status(400).json({ success: false, error: 'frictionBudget 不合法' });
    }

    const simulationConfig = await runAssistedSessionMutation(sessionId, async (session, assertLeaseOwned) => {
      const stageResults = parseJson<any>(session.stageResults, {});
      const nextStageResults = {
        ...stageResults,
        simulationConfig: {
          ...(stageResults.simulationConfig || {}),
          ...(frictionBudget ? { frictionBudget } : {})
        }
      };

      await assertLeaseOwned();
      await prisma.virtual_sessions.update({
        where: { id: sessionId },
        data: {
          stageResults: JSON.stringify(nextStageResults),
          updatedAt: new Date()
        }
      });

      await assertLeaseOwned();
      return nextStageResults.simulationConfig;
    });

    res.json({
      success: true,
      data: { simulationConfig }
    });
  } catch (error: any) {
    logger.error('更新 simulation-config 失败:', error);
    sendVirtualSessionError(res, error, '更新 simulation-config 失败');
  }
});

router.post('/sessions/:sessionId/restart-path', async (req: any, res) => {
  try {
    const { sessionId } = req.params;
    const result = await runAssistedSessionMutation(sessionId, () =>
      simulationCoordinator.restartPathPhase(sessionId)
    );

    res.json({
      success: result.success,
      data: result,
      error: result.error
    });
  } catch (error: any) {
    logger.error('重新开始路径失败:', error);
    sendVirtualSessionError(res, error, '重新开始路径失败');
  }
});

router.post('/sessions/:sessionId/restart-learning', async (req: any, res) => {
  try {
    const { sessionId } = req.params;
    const { taskId } = req.body || {};
    const result = await runAssistedSessionMutation(sessionId, () =>
      simulationCoordinator.restartLearningPhase(sessionId, { taskId })
    );

    res.json({
      success: result.success,
      data: result,
      error: result.error
    });
  } catch (error: any) {
    logger.error('重新开始学习失败:', error);
    sendVirtualSessionError(res, error, '重新开始学习失败');
  }
});

router.post('/sessions/:sessionId/stop-learning', async (req: any, res) => {
  try {
    const { sessionId } = req.params;
    const result = await runAssistedSessionMutation(sessionId, () =>
      simulationCoordinator.emergencyStopLearning(sessionId, 'admin-emergency-stop')
    );

    res.json({
      success: result.success,
      data: result,
      error: result.error
    });
  } catch (error: any) {
    logger.error('紧急停止学习失败:', error);
    sendVirtualSessionError(res, error, '紧急停止学习失败');
  }
});

/**
 * 获取模拟会话日志
 * GET /api/admin/virtual-sessions/:sessionId/logs
 */
router.get('/sessions/:sessionId/logs', async (req: any, res) => {
  try {
    const { sessionId } = req.params;
    
    const session = await prisma.virtual_sessions.findUnique({
      where: { id: sessionId }
    });
    
    if (!session) {
      return res.status(404).json({
        success: false,
        error: '模拟会话不存在'
      });
    }
    
    let logs: any[] = [];
    try {
      logs = JSON.parse(session.logs || '[]');
    } catch {
      // ignore malformed logs payload
    }
    
    res.json({
      success: true,
      data: {
        logs,
        totalLogs: logs.length
      }
    });
  } catch (error: any) {
    logger.error('获取模拟会话日志失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取模拟会话日志失败'
    });
  }
});

/**
 * 删除模拟会话
 * DELETE /api/admin/virtual-sessions/:sessionId
 */
router.delete('/sessions/:sessionId', async (req: any, res) => {
  try {
    const { sessionId } = req.params;

    const existingSession = await prisma.virtual_sessions.findUnique({
      where: { id: sessionId }
    });

    if (!existingSession) {
      return res.status(404).json({
        success: false,
        error: '模拟会话不存在'
      });
    }

    const session = await simulationCoordinator.runLeasedExclusive(sessionId, async assertLeaseOwned => {
      const leasedSession = await prisma.virtual_sessions.findUnique({
        where: { id: sessionId }
      });
      if (!leasedSession) throw new Error('模拟会话不存在');

      await assertLeaseOwned();
      await prisma.$transaction(async tx => {
        await assertLeaseOwned(tx);
        const teachingSessionScopes: any[] = [];
        const teachingSessionId = parseLearningProgress(leasedSession).teachingSessionId;
        if (teachingSessionId) teachingSessionScopes.push({ id: String(teachingSessionId) });

        if (leasedSession.learningPathId) {
          const learningPath = await tx.learning_paths.findFirst({
            where: {
              id: leasedSession.learningPathId,
              userId: leasedSession.userId
            },
            select: { id: true }
          });
          if (!learningPath) {
            throw Object.assign(new Error('学习路径不属于当前虚拟学习者'), {
              code: 'VIRTUAL_SESSION_PATH_OWNERSHIP_MISMATCH',
              statusCode: 409
            });
          }

          await assertPathMutationSafe(tx, learningPath.id, 'delete-path');

          const pathTasks = await tx.subtasks.findMany({
            where: { milestones: { learningPathId: learningPath.id } },
            select: { id: true }
          });
          const taskIds = pathTasks.map((task: { id: string }) => task.id);
          teachingSessionScopes.push(
            { learningPathId: learningPath.id },
            ...(taskIds.length > 0 ? [{ taskId: { in: taskIds } }] : [])
          );
        }

        if (teachingSessionScopes.length > 0) {
          const associatedTeachingSession = await tx.teaching_sessions.findFirst({
            where: { OR: teachingSessionScopes },
            select: { id: true }
          });
          if (associatedTeachingSession) {
            throw Object.assign(new Error('模拟会话仍有关联课堂记录，不能删除'), {
              code: 'VIRTUAL_SESSION_HAS_TEACHING_RECORDS',
              statusCode: 409
            });
          }
        }

        if (leasedSession.goalConversationId) {
          await tx.goal_conversations.deleteMany({
            where: {
              id: leasedSession.goalConversationId,
              userId: leasedSession.userId
            }
          });
        }
        if (leasedSession.learningPathId) {
          await tx.learning_paths.deleteMany({
            where: {
              id: leasedSession.learningPathId,
              userId: leasedSession.userId
            }
          });
        }
        await tx.virtual_sessions.delete({
          where: { id: sessionId }
        });
      });

      return leasedSession;
    }, { skipFinalLeaseCheck: true });

    logger.info('删除模拟会话成功', {
      sessionId,
      userId: session.userId
    });
    
    res.json({
      success: true,
      message: '模拟会话已删除'
    });
  } catch (error: any) {
    logger.error('删除模拟会话失败:', error);
    sendVirtualSessionError(res, error, '删除模拟会话失败');
  }
});

/**
 * 回归测试: 跑一个完整的 Goal→Path 流程, 可指定 prompt 版本 override
 * POST /api/admin/virtual-learners/:profileId/regression-run
 */
router.post('/:profileId/regression-run', async (req: any, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: '未登录' });
    }

    const { profileId } = req.params;
    const { storyId, storyIndex, maxGoalRounds: requestedMaxGoalRounds, systemPromptOverrides } = req.body || {};
    const maxGoalRounds = parseSimulationLimit(requestedMaxGoalRounds, 20, 50, 'maxGoalRounds');

    const profile = await prisma.virtual_learner_profiles.findUnique({
      where: { id: profileId }
    });
    if (!profile) {
      return res.status(404).json({ success: false, error: '虚拟用户不存在' });
    }

    // 1. 创建新 session
    const session = await createSessionForProfile(profileId, { storyId, storyIndex });
    if (!session) {
      return res.status(404).json({ success: false, error: '虚拟用户不存在或故事池为空' });
    }
    const sessionId = session.id;

    // 2. 执行全自动 (Goal→Path→Learn 一条龙, 受 maxGoalRounds 限制)
    const result = await runAssistedSessionMutation(sessionId, async (leasedSession, assertLeaseOwned) => {
      if (systemPromptOverrides && typeof systemPromptOverrides === 'object') {
        const goalAgent = typeof systemPromptOverrides.goalAgent === 'string' ? systemPromptOverrides.goalAgent.trim() : '';
        const pathAgent = typeof systemPromptOverrides.pathAgent === 'string' ? systemPromptOverrides.pathAgent.trim() : '';
        if (goalAgent || pathAgent) {
          await assertLeaseOwned();
          await prisma.virtual_sessions.update({
            where: { id: sessionId },
            data: {
              stageResults: JSON.stringify({
                ...parseJson(leasedSession.stageResults, {}),
                systemPromptOverrides: { goalAgent: goalAgent || undefined, pathAgent: pathAgent || undefined }
              })
            }
          });
          await assertLeaseOwned();
        }
      }

      return simulationCoordinator.executeFullSession(sessionId, {
        maxRounds: maxGoalRounds,
        maxMilestones: 5,
        continueOnTaskComplete: false, // 回归测试只跑首个 task
        autoAdvanceToPath: true,
        autoAdvanceToLearning: false  // 回归测试主要看 Goal+Path, 不跑完整 Learn
      });
    });

    res.json({
      success: result.success,
      data: {
        sessionId,
        ...result,
      },
      error: result.error
    });
  } catch (error: any) {
    logger.error('回归测试失败:', error);
    sendVirtualSessionError(res, error, '回归测试失败');
  }
});

/**
 * 回归对比: 对比两个 session 的关键运行结果
 * GET /api/admin/virtual-learners/regression/compare-sessions?sessionA=&sessionB=
 */
router.get('/regression/compare-sessions', async (req: any, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: '未登录' });
    }

    const sessionA = String(req.query.sessionA || '');
    const sessionB = String(req.query.sessionB || '');
    if (!sessionA || !sessionB) {
      return res.status(400).json({ success: false, error: '需要提供 sessionA 与 sessionB' });
    }

    const [a, b] = await Promise.all([
      prisma.virtual_sessions.findUnique({ where: { id: sessionA } }),
      prisma.virtual_sessions.findUnique({ where: { id: sessionB } })
    ]);

    if (!a || !b) {
      return res.status(404).json({
        success: false,
        error: '至少一个 session 不存在'
      });
    }

    const summarize = (s: any) => {
      const stageResults = parseStageResults(s);
      return {
        id: s.id,
        status: s.status,
        currentStage: s.currentStage,
        goalConversationId: s.goalConversationId,
        learningPathId: s.learningPathId,
        currentTaskId: s.currentTaskId,
        completedTasks: s.completedTasks,
        totalTasks: s.totalTasks,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        goalStage: stageResults?.goal?.finalStage || stageResults?.goal?.stage || null,
        pathReady: !!stageResults?.path?.success,
        learnerStateSnapshot: stageResults?.learning?.learnerState || stageResults?.goal?.learnerState || null,
        wrapup: stageResults?.learning?.wrapup || null,
        rounds: {
          goal: Array.isArray(stageResults?.goal?.conversationHistory) ? stageResults.goal.conversationHistory.length : 0,
          learning: Array.isArray(stageResults?.learning?.conversationHistory) ? stageResults.learning.conversationHistory.length : 0,
        }
      };
    };

    res.json({
      success: true,
      data: {
        sessionA: summarize(a),
        sessionB: summarize(b),
      }
    });
  } catch (error: any) {
    logger.error('对比 session 失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '对比 session 失败'
    });
  }
});

export default router;
