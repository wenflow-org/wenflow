/**
 * Simulation Orchestrator - 模拟流程协调器
 * 
 * 负责协调虚拟用户模拟的完整流程：
 * - Goal对话阶段：VirtualLearnerSimulationAgent ↔ GoalConversationService
 * - Path生成阶段：调用PathOrchestrator
 * - Learning阶段：调用AITeachingService
 */

import { randomUUID as uuidv4 } from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';
import { logger } from '../utils/logger';
import prisma from '../config/database';
import goalConversationService from '../services/learning/goal-conversation.service';
import learningService from '../services/learning/learning.service';
import { assertPathMutationSafe } from '../services/learning/path-mutation-safety';
import pathCoordinator, { type GoalPathRequest } from './path.coordinator';
import aiTeachingOrchestrator from '../services/ai-teaching/AITeachingCoordinator';
import {
  getSimulationAgentConfig,
  type SimulationAgentConfig
} from '../services/agentConfig.service';
import { executeSkill, virtualLearnerGoalDialogueSimulatorDefinition, virtualLearnerPathEvaluatorDefinition, virtualLearnerLearnTurnSimulatorDefinition } from '../skills';
import { normalizeFrictionBudget, type FrictionBudget } from '../skills/virtual-learner-shared';
import { sessionWrapupAgent, type SessionWrapupInput } from '../skills/session-wrapup';
import { buildGoalPathVisibleSummary } from '../services/learning/goal-path-visible-summary';
import {
  resolvePathRawGoalFromSession,
  resolveStorySessionDemand,
} from '../virtual-lab/story-demand';
import type { 
  SimulationContext,
  SimulationStepResult,
  SimulationLogEntry,
  VirtualLearnerProfile,
  GoalConcernPool,
  LearnerLatentState
} from './simulation.types';

const COORDINATOR_ID = 'simulation-agent';
const ASSISTED_SESSION_LEASE_MS = 10 * 60 * 1000;
const ASSISTED_SESSION_LEASE_RENEW_MS = 2 * 60 * 1000;
const LEASE_RETRY_DELAYS_MS = [25, 50, 100];
const LEARN_UPSTREAM_RETRY_ATTEMPTS = 3;
const LEARN_UPSTREAM_RETRY_DELAY_MS = 750;

function isPrismaErrorCode(error: unknown, code: string) {
  return typeof error === 'object' && error !== null && (error as any).code === code;
}

function isLeaseDatabaseBusyError(error: unknown) {
  if (isPrismaErrorCode(error, 'P1008')) return true;
  const code = typeof error === 'object' && error !== null ? String((error as any).code || '') : '';
  const message = error instanceof Error ? error.message : String(error || '');
  return code === 'SQLITE_BUSY'
    || /SQLITE_BUSY|database (?:is|table is) locked|timed out|timeout/i.test(message);
}

export class VirtualSessionLeaseBusyError extends Error {
  readonly code = 'VIRTUAL_SESSION_BUSY';
  readonly statusCode = 409;
  readonly retryable = true;

  constructor() {
    super('当前模拟会话正在执行其他写操作，请稍后重试');
    this.name = 'VirtualSessionLeaseBusyError';
  }
}

export class VirtualSessionLeaseLostError extends Error {
  readonly code = 'VIRTUAL_SESSION_LEASE_LOST';
  readonly statusCode = 409;
  readonly retryable = true;

  constructor() {
    super('模拟会话执行租约已丢失，请重试');
    this.name = 'VirtualSessionLeaseLostError';
  }
}

export class VirtualSessionDatabaseBusyError extends Error {
  readonly code = 'DB_BUSY';
  readonly statusCode = 503;
  readonly retryable = true;

  constructor(readonly originalError?: unknown) {
    super('租约数据库暂时繁忙，请稍后重试');
    this.name = 'VirtualSessionDatabaseBusyError';
  }
}

type AssistedLeaseContext = {
  sessionId: string;
  ownerId: string;
  expiresAt: number;
  renewal: Promise<void>;
  failureError: unknown | null;
  assertLeaseOwned: (leaseClient?: any) => Promise<void>;
};

export interface SimulationOrchestratorInput {
  sessionId: string;
  userId: string;
  mode: 'single-step' | 'auto-loop';
}

export interface AutoLoopOptions {
  maxRounds?: number;
  onStep?: (result: SimulationStepResult) => void;
  autoAdvanceToPath?: boolean;
  autoAdvanceToLearning?: boolean;
}

export interface RunFullOptions {
  maxRounds?: number;
  maxMilestones?: number;
  continueOnTaskComplete?: boolean;
  autoAdvanceToPath?: boolean;
  autoAdvanceToLearning?: boolean;
}

class SimulationOrchestrator {
  readonly id = COORDINATOR_ID;
  private readonly sessionLocks = new Map<string, Promise<void>>();
  private readonly sessionLeaseContext = new AsyncLocalStorage<AssistedLeaseContext>();

  async runLeasedExclusive<T>(
    sessionId: string,
    work: (assertLeaseOwned: (leaseClient?: any) => Promise<void>) => Promise<T>,
    options: { skipFinalLeaseCheck?: boolean } = {}
  ): Promise<T> {
    const previous = this.sessionLocks.get(sessionId) || Promise.resolve();
    let releaseQueue!: () => void;
    const current = new Promise<void>(resolve => { releaseQueue = resolve; });
    const queued = previous.then(() => current);
    this.sessionLocks.set(sessionId, queued);

    await previous;
    const ownerId = `assisted_${uuidv4()}`;
    let acquiredExpiresAt: Date;
    try {
      acquiredExpiresAt = await this.acquireSessionLease(sessionId, ownerId);
    } catch (error) {
      releaseQueue();
      if (this.sessionLocks.get(sessionId) === queued) this.sessionLocks.delete(sessionId);
      throw error;
    }

    let rejectLeaseFailure!: (error: unknown) => void;
    const leaseFailurePromise = new Promise<never>((_, reject) => {
      rejectLeaseFailure = reject;
    });
    const context = {
      sessionId,
      ownerId,
      expiresAt: acquiredExpiresAt.getTime(),
      renewal: Promise.resolve(),
      failureError: null,
      assertLeaseOwned: async () => undefined
    } as AssistedLeaseContext;
    const markLeaseFailure = (error: unknown) => {
      if (context.failureError) return;
      context.failureError = error;
      logger.warn('[simulation-coordinator] 模拟会话执行租约续期失败', {
        sessionId,
        ownerId,
        error: error instanceof Error ? error.message : String(error)
      });
      rejectLeaseFailure(error);
    };
    context.assertLeaseOwned = async (leaseClient = prisma) => {
      try {
        await this.renewAssistedLease(context, leaseClient);
      } catch (error) {
        markLeaseFailure(error);
        throw error;
      }
    };
    const renewalTimer = setInterval(() => {
      if (context.failureError) return;
      void context.assertLeaseOwned().catch(() => undefined);
    }, ASSISTED_SESSION_LEASE_RENEW_MS);
    renewalTimer.unref();

    const workPromise = Promise.resolve().then(() => this.sessionLeaseContext.run(
      context,
      () => work(context.assertLeaseOwned)
    ));
    let workDone = false;
    const workSettled = workPromise.then(() => undefined, () => undefined);
    void workSettled.then(() => { workDone = true; });

    let result!: T;
    let primaryError: unknown;
    let failed = false;
    try {
      result = await Promise.race([workPromise, leaseFailurePromise]);
      if (!options.skipFinalLeaseCheck) await context.assertLeaseOwned();
    } catch (error) {
      failed = true;
      primaryError = error;
    }

    clearInterval(renewalTimer);
    const cleanupPromise = (async () => {
      try {
        await context.renewal;
      } catch {
        // 续租错误已经作为主结果处理，清理仍需继续释放 owner-scoped lease。
      }
      await workSettled;
      await this.releaseSessionLease(sessionId, ownerId);
    })()
      .finally(() => {
        releaseQueue();
        if (this.sessionLocks.get(sessionId) === queued) this.sessionLocks.delete(sessionId);
      });

    const logCleanupError = (cleanupError: unknown) => {
      logger.error('[simulation-coordinator] 保护工作清理失败', {
        sessionId,
        ownerId,
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
      });
    };

    if (failed) {
      if (primaryError === context.failureError && !workDone) {
        void cleanupPromise.catch(logCleanupError);
      } else {
        await cleanupPromise.catch(logCleanupError);
      }
      throw primaryError;
    }

    await cleanupPromise;
    return result;
  }

  private async acquireSessionLease(sessionId: string, ownerId: string): Promise<Date> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ASSISTED_SESSION_LEASE_MS);
    try {
      const updated = await prisma.virtual_experiment_leases.updateMany({
        where: { sessionId, expiresAt: { lt: now } },
        data: { ownerId, expiresAt }
      });
      if (updated.count === 1) return expiresAt;
    } catch (error) {
      if (isLeaseDatabaseBusyError(error)) throw new VirtualSessionDatabaseBusyError(error);
      throw error;
    }

    try {
      await prisma.virtual_experiment_leases.create({
        data: { sessionId, ownerId, expiresAt }
      });
      return expiresAt;
    } catch (error) {
      if (isPrismaErrorCode(error, 'P2002')) throw new VirtualSessionLeaseBusyError();
      if (isLeaseDatabaseBusyError(error)) throw new VirtualSessionDatabaseBusyError(error);
      throw error;
    }
  }

  private async releaseSessionLease(sessionId: string, ownerId: string) {
    try {
      await prisma.virtual_experiment_leases.deleteMany({ where: { sessionId, ownerId } });
    } catch (error) {
      if (isLeaseDatabaseBusyError(error)) throw new VirtualSessionDatabaseBusyError(error);
      throw error;
    }
  }

  private async renewSessionLease(
    sessionId: string,
    ownerId: string,
    knownExpiresAt = Date.now() + ASSISTED_SESSION_LEASE_MS,
    leaseClient: any = prisma
  ) {
    for (let attempt = 0; ; attempt += 1) {
      const now = new Date();
      if (now.getTime() >= knownExpiresAt) throw new VirtualSessionLeaseLostError();
      const expiresAt = new Date(now.getTime() + ASSISTED_SESSION_LEASE_MS);
      try {
        const updated = await leaseClient.virtual_experiment_leases.updateMany({
          where: { sessionId, ownerId, expiresAt: { gt: now } },
          data: { expiresAt }
        });
        if (updated.count !== 1) throw new VirtualSessionLeaseLostError();
        return expiresAt;
      } catch (error) {
        if (!isLeaseDatabaseBusyError(error)) throw error;
        const delayMs = LEASE_RETRY_DELAYS_MS[attempt];
        const remainingMs = knownExpiresAt - Date.now();
        if (delayMs === undefined || remainingMs <= delayMs) {
          throw new VirtualSessionDatabaseBusyError(error);
        }
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  private async renewAssistedLease(context: AssistedLeaseContext, leaseClient: any = prisma) {
    const renewal = context.renewal.then(async () => {
      if (context.failureError) throw context.failureError;
      const expiresAt = await this.renewSessionLease(
        context.sessionId,
        context.ownerId,
        context.expiresAt,
        leaseClient
      );
      context.expiresAt = expiresAt.getTime();
    });
    context.renewal = renewal;
    await renewal;
  }

  private async assertCurrentSessionLeaseOwned(sessionId: string) {
    const context = this.sessionLeaseContext.getStore();
    if (context?.sessionId === sessionId) await context.assertLeaseOwned();
  }

  private sanitizeVisibleDialogue(text: string): string {
    if (!text) return '';

    return text
      .replace(/<[^>]+>/g, ' ')
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  private sanitizeVisibleContextMessage(message: any, role: 'learner' | 'goal_agent') {
    const content = this.sanitizeVisibleDialogue(typeof message?.content === 'string' ? message.content : '');
    if (!content) return null;
    return { role, content };
  }

  private trimLearningConversationHistory(history: any[] = []) {
    if (!Array.isArray(history) || history.length === 0) return [];
    return history.slice(-6).map((item: any) => ({
      role: item?.role,
      content: this.sanitizeVisibleDialogue(typeof item?.content === 'string' ? item.content : '')
    })).filter((item: any) => item.content);
  }

  private inferLearningPhase(learnerState: LearnerLatentState | null | undefined): 'trying' | 'blocked' | 'verifying' | 'ready_to_close' {
    const state = learnerState || {};
    const blockerCount = Array.isArray(state.remainingBlockers) ? state.remainingBlockers.length : 0;
    const cognitiveLoad = typeof state.cognitiveLoad === 'number' ? state.cognitiveLoad : 0;
    const misconceptionRisk = typeof state.misconceptionRisk === 'number' ? state.misconceptionRisk : 0;
    const taskUnderstanding = typeof state.taskUnderstanding === 'number' ? state.taskUnderstanding : 0;

    if (state.readyForNextTask === true) return 'ready_to_close';
    if (blockerCount > 0 || cognitiveLoad >= 0.72 || misconceptionRisk >= 0.7) return 'blocked';
    if (taskUnderstanding >= 0.7) return 'verifying';
    return 'trying';
  }

  private getRunnableTasks(tasks: any[] = []) {
    return tasks.filter(task => task.status !== 'completed');
  }

  private countTaskProgress(milestones: any[], completedTaskId?: string | null) {
    const tasks = milestones.flatMap((milestone: any) => milestone?.subtasks || []);
    return {
      totalTasks: tasks.length,
      completedTasks: tasks.filter((task: any) => task.status === 'completed' || task.id === completedTaskId).length
    };
  }

  private isRetryableLearnUpstreamError(error: any) {
    const message = String(error?.message || error || '').toLowerCase();
    return /structured_output_invalid|invalid chat completion|finish_reason|length|empty content|reply completion mismatch|api request canceled|fetch failed|timeout|timed out|econnreset|socket|network|rate.?limit|\b429\b|\b502\b|\b503\b|\b504\b/.test(message);
  }

  private async retryLearnUpstream<T>(sessionId: string, operation: string, execute: () => Promise<T>): Promise<T> {
    let lastError: any;
    for (let attempt = 1; attempt <= LEARN_UPSTREAM_RETRY_ATTEMPTS; attempt += 1) {
      try {
        await this.assertCurrentSessionLeaseOwned(sessionId);
        return await execute();
      } catch (error: any) {
        lastError = error;
        if (!this.isRetryableLearnUpstreamError(error) || attempt === LEARN_UPSTREAM_RETRY_ATTEMPTS) break;
        logger.warn('[simulation-coordinator] Learn 上游调用失败，准备重试', {
          sessionId,
          operation,
          attempt,
          error: error?.message || String(error)
        });
        await new Promise(resolve => setTimeout(resolve, LEARN_UPSTREAM_RETRY_DELAY_MS * attempt));
      }
    }
    throw lastError;
  }

  private boundTaskCompletionError(error: any): string {
    const message = error?.message || String(error || '任务完成失败');
    return message.length > 1000 ? `${message.slice(0, 997)}...` : message;
  }

  private findTaskInPath(milestones: any[], taskId?: string | null) {
    if (!taskId) return null;

    for (let milestoneIdx = 0; milestoneIdx < milestones.length; milestoneIdx += 1) {
      const milestone = milestones[milestoneIdx];
      const taskIdx = (milestone?.subtasks || []).findIndex((task: any) => task.id === taskId);
      if (taskIdx >= 0) {
        return { milestone, milestoneIdx, task: milestone.subtasks[taskIdx], taskIdx };
      }
    }

    return null;
  }

  private buildProgressAfterTaskCompletion(milestones: any[], completedTaskId: string) {
    const flattenedTasks = milestones.flatMap((milestone: any, milestoneIdx: number) =>
      (milestone?.subtasks || []).map((task: any) => ({ milestone, milestoneIdx, task }))
    );
    const completedTaskIdx = flattenedTasks.findIndex((item: any) => item.task.id === completedTaskId);
    const isRunnable = (item: any) => item.task.id !== completedTaskId && item.task.status !== 'completed';
    const nextTask = flattenedTasks.find((item: any, index: number) => index > completedTaskIdx && isRunnable(item))
      || flattenedTasks.find(isRunnable)
      || null;

    if (!nextTask) {
      return {
        isPathCompleted: true,
        currentTask: null,
        progress: {
          currentMilestone: milestones.length,
          currentMilestoneTitle: null,
          currentTaskIdx: 0,
          currentTaskId: null,
          currentTaskTitle: null,
          totalMilestones: milestones.length
        }
      };
    }

    const runnableTasks = (nextTask.milestone.subtasks || [])
      .filter((task: any) => task.id !== completedTaskId && task.status !== 'completed');
    return {
      isPathCompleted: false,
      currentTask: nextTask.task,
      progress: {
        currentMilestone: nextTask.milestoneIdx,
        currentMilestoneTitle: nextTask.milestone.title || null,
        currentTaskIdx: Math.max(0, runnableTasks.findIndex((task: any) => task.id === nextTask.task.id)),
        currentTaskId: nextTask.task.id,
        currentTaskTitle: nextTask.task.title || null,
        totalMilestones: milestones.length
      }
    };
  }

  /**
   * 同一虚拟会话可以跨多个 Path task。完成当前 task 后，立即为下一 task 建立新课堂，
   * 不让已完成 taskRuntime 阻塞后续 executeLearningStep。
   */
  private async transitionToNextLearningTask(
    sessionId: string,
    session: any,
    learningState: any,
    completedTaskRuntime: any,
    nextProgress: ReturnType<SimulationOrchestrator['buildProgressAfterTaskCompletion']>,
    milestones: any[],
    logs: SimulationLogEntry[]
  ) {
    if (nextProgress.isPathCompleted || !nextProgress.currentTask) {
      return { learningState, nextTaskStarted: false };
    }

    await this.assertCurrentSessionLeaseOwned(sessionId);
    const nextTeachingSession = await this.retryLearnUpstream(
      sessionId,
      'start-next-learning-task',
      () => aiTeachingOrchestrator.startSession({
        userId: session.userId,
        taskId: nextProgress.currentTask.id
      })
    );
    const now = new Date().toISOString();
    const teachingSessionHistory = [
      ...(Array.isArray(learningState.teachingSessionHistory) ? learningState.teachingSessionHistory : []),
      {
        teachingSessionId: completedTaskRuntime.teachingSessionId || null,
        taskId: completedTaskRuntime.taskId || null,
        taskTitle: completedTaskRuntime.taskTitle || null,
        status: 'completed',
        completedAt: completedTaskRuntime.completedAt || now
      }
    ];
    const nextLearningState = {
      ...learningState,
      ...nextProgress.progress,
      teachingSessionId: nextTeachingSession.sessionId,
      teachingRevision: nextTeachingSession.revision,
      taskRuntime: {
        status: 'active',
        taskId: nextProgress.currentTask.id,
        taskTitle: nextProgress.currentTask.title,
        teachingSessionId: nextTeachingSession.sessionId,
        teachingRevision: nextTeachingSession.revision,
        startedAt: now,
        error: null,
        updatedAt: now
      },
      teachingSessionHistory
    };

    logs.push({
      timestamp: now,
      phase: 'learning-start',
      details: {
        output: {
          teachingSessionId: nextTeachingSession.sessionId,
          welcomeMessage: nextTeachingSession.welcomeMessage,
          currentMilestone: nextLearningState.currentMilestoneTitle,
          currentTask: nextProgress.currentTask.title,
          previousTaskId: completedTaskRuntime.taskId || null
        }
      }
    });

    return { learningState: nextLearningState, nextTaskStarted: true };
  }

  private async resolveTeachingRevision(
    sessionId: string,
    userId: string,
    revision?: number | null
  ): Promise<number> {
    if (Number.isInteger(revision) && Number(revision) >= 0) return Number(revision);
    const detail = await aiTeachingOrchestrator.getSessionDetail(sessionId, userId);
    if (!detail || !Number.isInteger(detail.revision)) {
      throw new Error('课堂缺少有效 revision');
    }
    return detail.revision;
  }

  private buildLearningProgressSnapshot(milestones: any[], milestoneIdx: number, taskIdx: number) {
    const milestone = milestones[milestoneIdx];
    const tasks = this.getRunnableTasks(milestone?.subtasks || []);
    const task = tasks[taskIdx] || null;

    return {
      currentMilestone: milestoneIdx,
      currentMilestoneTitle: milestone?.title || null,
      currentTaskIdx: task ? taskIdx : 0,
      currentTaskId: task?.id || null,
      currentTaskTitle: task?.title || null,
      totalMilestones: milestones.length
    };
  }

  private isGoalConverged(stage?: string | null) {
    return stage === 'ready' || stage === 'completed';
  }
  
  private async getVirtualSession(sessionId: string) {
    const session = await prisma.virtual_sessions.findUnique({
      where: { id: sessionId },
      include: {
        virtual_learner_profiles: true
      }
    });
    
    if (!session) {
      throw new Error('模拟会话不存在');
    }
    
    return session;
  }
  
  private async getGoalConversation(conversationId: string, userId: string) {
    const conversation = await prisma.goal_conversations.findFirst({
      where: { id: conversationId, userId }
    });
    
    return conversation;
  }
  
  private parseProfileData(profileRecord: any): VirtualLearnerProfile {
    let profileData: any = {};
    try {
      profileData = JSON.parse(profileRecord.profile || '{}');
    } catch {}
    
    let knownConcepts: string[] = [];
    try {
      knownConcepts = JSON.parse(profileRecord.knownConcepts || '[]');
    } catch {}
    
    let struggleConcepts: string[] = [];
    try {
      struggleConcepts = JSON.parse(profileRecord.struggleConcepts || '[]');
    } catch {}
    
    let personalityTraits: any = {};
    try {
      personalityTraits = JSON.parse(profileRecord.personalityTraits || '{}');
    } catch {}
    
    return {
      id: profileRecord.id,
      userId: profileRecord.userId,
      profile: profileData,
      learningGoal: profileRecord.learningGoal,
      knowledgeLevel: profileRecord.knowledgeLevel || 'beginner',
      knownConcepts,
      struggleConcepts,
      personalityTraits,
      simulationPrompt: profileRecord.simulationPrompt,
      simulationModel: profileRecord.simulationModel,
      simulationTemperature: profileRecord.simulationTemperature
    };
  }
  
  private buildSimulationContext(
    profile: VirtualLearnerProfile,
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
    lastAssistantMessage: string,
    currentStage: 'goal' | 'path' | 'learning',
    storyContext?: any,
    goalState?: any,
    learnerState?: any,
    knowledgeState?: any,
    learningState?: any
  ): SimulationContext {
    return {
      profile,
      conversationHistory,
      currentStage,
      lastAssistantMessage,
      storyContext,
      goalState,
      learnerState: this.mergeLearnerState(profile, learnerState, currentStage, storyContext),
      knowledgeState,
      learningState
    };
  }

  private buildStoryBehaviorBias(storyContext?: any): Partial<LearnerLatentState> {
    if (!storyContext) return {};

    const pressurePoints = Array.isArray(storyContext.pressurePoints) ? storyContext.pressurePoints : [];
    const behaviorHooks = Array.isArray(storyContext.behaviorHooks) ? storyContext.behaviorHooks : [];
    const text = [...pressurePoints, ...behaviorHooks].join('；');

    const partial: Partial<LearnerLatentState> = {};

    if (text.includes('焦虑') || text.includes('紧张') || text.includes('压力')) {
      partial.frustrationLevel = 0.34;
      partial.confusionLevel = 0.54;
    }

    if (text.includes('追问') || text.includes('确认') || text.includes('求助')) {
      partial.wantsClarification = true;
    }

    if (text.includes('保留') || text.includes('质疑') || text.includes('防御')) {
      partial.readyToAdvance = false;
    }

    if (text.includes('装懂') || text.includes('先猜') || text.includes('模糊带过')) {
      partial.selfPerceivedMastery = 0.58;
      partial.actualMastery = 0.38;
    }

    return partial;
  }

  private buildDefaultLearnerState(
    profile: VirtualLearnerProfile,
    currentStage: 'goal' | 'path' | 'learning'
  ): LearnerLatentState {
    const traits = profile.personalityTraits || {};
    const p = profile.profile || {};

    const patienceBase = traits.patience === 'low' ? 0.35 : traits.patience === 'high' ? 0.78 : 0.58;
    const enthusiasmBase = traits.enthusiasm === 'low' ? 0.4 : traits.enthusiasm === 'high' ? 0.76 : 0.58;
    const attentionPenalty = typeof p.cognitiveLoadTolerance === 'string' && p.cognitiveLoadTolerance.includes('信息一多') ? 0.12 : 0;
    const frustrationBoost = p.emotionalBaseline || (Array.isArray(p.emotionalTriggers) && p.emotionalTriggers.length) ? 0.08 : 0;
    const helpSeeking = typeof p.helpSeekingPattern === 'string' ? p.helpSeekingPattern : '';
    const wantsClarificationByTrait = traits.questionStyle === 'clarifying'
      || traits.questionStyle === 'challenging'
      || helpSeeking.includes('追问')
      || helpSeeking.includes('确认')
      || helpSeeking.includes('具体例子');

    return {
      motivationLevel: enthusiasmBase,
      attentionLevel: Math.max(0.2, patienceBase - attentionPenalty),
      persistenceLevel: patienceBase,
      confusionLevel: currentStage === 'goal' ? 0.48 : 0.32,
      frustrationLevel: Math.min(0.75, 0.18 + frustrationBoost),
      goalReadiness: currentStage === 'goal' ? 0.28 : currentStage === 'path' ? 0.6 : undefined,
      wantsClarification: currentStage === 'goal' ? wantsClarificationByTrait : undefined,
      readyToAdvance: currentStage === 'goal' ? false : undefined,
      selfPerceivedMastery: profile.knowledgeLevel === 'beginner' ? 0.24 : profile.knowledgeLevel === 'advanced' ? 0.72 : 0.5,
      actualMastery: profile.knowledgeLevel === 'beginner' ? 0.2 : profile.knowledgeLevel === 'advanced' ? 0.75 : 0.48,
      memoryStrength: p.memoryRepairPattern ? 0.42 : 0.5,
      remainingUnknowns: currentStage === 'goal' ? ['真实问题还没有完全说清', '还不确定哪种方式真正适合自己'] : undefined,
      stableErrorStyle: Array.isArray(p.failurePatterns) ? p.failurePatterns.slice(0, 2) : undefined
    };
  }

  private mergeLearnerState(
    profile: VirtualLearnerProfile,
    learnerState: any,
    currentStage: 'goal' | 'path' | 'learning',
    storyContext?: any
  ): LearnerLatentState {
    const merged = {
      ...this.buildDefaultLearnerState(profile, currentStage),
      ...this.buildStoryBehaviorBias(storyContext),
      ...(learnerState || {})
    };

    if (currentStage === 'goal') {
      if (typeof merged.goalReadiness !== 'number' || !Number.isFinite(merged.goalReadiness)) {
        merged.goalReadiness = this.buildDefaultLearnerState(profile, currentStage).goalReadiness;
      }

      if (merged.goalReadiness >= 0.78 && merged.wantsClarification === false && merged.readyToAdvance !== false) {
        merged.readyToAdvance = true;
      }

      if (merged.goalReadiness < 0.55) {
        merged.readyToAdvance = false;
      }
    }

    if (currentStage === 'learning') {
      if (typeof merged.taskUnderstanding !== 'number' || !Number.isFinite(merged.taskUnderstanding)) {
        merged.taskUnderstanding = merged.understandingLevel;
      }

      if (typeof merged.helpSeekingReadiness !== 'number' || !Number.isFinite(merged.helpSeekingReadiness)) {
        merged.helpSeekingReadiness = merged.wantsClarification ? 0.7 : 0.35;
      }

      if (typeof merged.readyForNextTask !== 'boolean') {
        merged.readyForNextTask = !!(merged.taskUnderstanding !== undefined && merged.taskUnderstanding >= 0.72 && merged.misconceptionRisk !== undefined && merged.misconceptionRisk < 0.45);
      }
    }

    return merged;
  }

  private mapGoalStageToLearnerPhase(goalStage?: string | null) {
    const normalized = String(goalStage || '').toLowerCase();
    if (normalized === 'proposing' || normalized === 'ready' || normalized === 'completed') {
      return 'proposal_evaluation' as const;
    }
    return 'understanding' as const;
  }

  private buildGoalVisibleContext(history: Array<{ role: 'user' | 'assistant'; content: string }>, lastAssistantMessage: string) {
    const visibleHistory = history.flatMap((item) => {
      if (item.role === 'user') {
        const learner = this.sanitizeVisibleContextMessage(item, 'learner');
        return learner ? [learner] : [];
      }
      const goalAgent = this.sanitizeVisibleContextMessage(item, 'goal_agent');
      return goalAgent ? [goalAgent] : [];
    });

    return {
      history: visibleHistory,
      lastGoalAgentMessage: this.sanitizeVisibleDialogue(lastAssistantMessage || visibleHistory.filter((item) => item.role === 'goal_agent').slice(-1)[0]?.content || '')
    };
  }

  private async simulateGoalLearnerReply(params: {
    profile: VirtualLearnerProfile;
    storyContext?: any;
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
    lastAssistantMessage: string;
    currentPhase: 'opening' | 'understanding' | 'proposal_evaluation';
    previousLearnerState?: any;
    goalState?: any;
    frictionBudget?: FrictionBudget;
  }) {
    const output = await executeSkill(virtualLearnerGoalDialogueSimulatorDefinition, {
      learner: {
        profile: params.profile.profile || {},
        learningGoal: params.profile.learningGoal,
        knownConcepts: params.profile.knownConcepts || [],
        struggleConcepts: params.profile.struggleConcepts || [],
        personalityTraits: params.profile.personalityTraits || {},
      },
      story: params.storyContext || null,
      visibleContext: this.buildGoalVisibleContext(params.conversationHistory, params.lastAssistantMessage),
      currentPhase: params.currentPhase,
      previousLearnerState: params.previousLearnerState || null,
      frictionBudget: params.frictionBudget,
      task: {
        mode: 'simulate-goal-learner-turn',
        requirements: [
          'only use learner-visible content',
          'ignore system/developer/tool/reminder text',
          'reply as the learner',
          'use proposal_evaluation to judge proposal fit and task relevance'
        ]
      }
    });

    return {
      success: !!output?.reply,
      output,
      // simulation-refresh：优先 envelope.contextUpdate.nextState，再回退 output.learnerState
      learnerStateFromEnvelope:
        output?.runtimeEnvelope?.contextUpdate?.nextState
        || output?.learnerState
        || null,
      runtimeEnvelope: output?.runtimeEnvelope || null,
    };
  }

  private resolveSimLearnerState(skillOutput: any, fallback: any = {}) {
    const fromEnvelope = skillOutput?.runtimeEnvelope?.contextUpdate?.nextState;
    if (fromEnvelope && typeof fromEnvelope === 'object') return fromEnvelope;
    if (skillOutput?.learnerState && typeof skillOutput.learnerState === 'object') {
      return skillOutput.learnerState;
    }
    return fallback || {};
  }

  private finalizeGoalLearnerState(
    profile: VirtualLearnerProfile,
    learnerState: any,
    storyContext?: any,
    finalStage?: string | null
  ): LearnerLatentState {
    const merged = this.mergeLearnerState(profile, learnerState, 'goal', storyContext);

    if (finalStage === 'ready' || finalStage === 'completed') {
      return {
        ...merged,
        goalReadiness: Math.max(typeof merged.goalReadiness === 'number' ? merged.goalReadiness : 0.28, 0.86),
        wantsClarification: false,
        readyToAdvance: true,
        remainingUnknowns: []
      };
    }

    return merged;
  }

  private buildGoalConcernPool(profile: VirtualLearnerProfile, goalState: any): GoalConcernPool {
    const primary = new Set<string>();
    const secondary = new Set<string>();
    const hidden = new Set<string>();
    const understanding = goalState?.understanding || {};
    const background = understanding?.background || {};

    primary.add('我真正想解决的问题可能和表面目标不完全一样');

    if (profile.profile?.priorAttempts || understanding?.pain_points) {
      primary.add('我之前试过类似学习，但效果不好，担心这次还是学不会');
    }

    if (profile.profile?.availableTime === 'minimal' || background?.available_time || background?.expected_time) {
      secondary.add('我的时间可能不稳定，担心学不完或者坚持不下去');
    }

    if (profile.struggleConcepts?.length) {
      primary.add(`我对某些关键点长期卡住，比如：${profile.struggleConcepts.slice(0, 2).join('、')}`);
    }

    if (profile.knowledgeLevel === 'beginner') {
      secondary.add('我担心自己基础不够，容易跟不上');
    }

    if (profile.personalityTraits?.questionStyle === 'none') {
      hidden.add('即使我没完全懂，也可能不会第一时间主动问出来');
    }

    if (profile.personalityTraits?.patience === 'low') {
      hidden.add('如果过程太绕或太长，我可能会失去耐心');
    }

    if (profile.profile?.motivationType === 'career' || profile.profile?.motivationType === 'necessity') {
      secondary.add('我希望学习结果尽快能用，不太想学很多暂时用不上的内容');
    }

    if (profile.profile?.emotionalBaseline) {
      hidden.add(`这件事会牵动我的情绪底色：${profile.profile.emotionalBaseline}`);
    }

    if (Array.isArray(profile.profile?.emotionalTriggers) && profile.profile.emotionalTriggers.length) {
      hidden.add(`有些情境会明显放大我的压力，比如：${profile.profile.emotionalTriggers.slice(0, 2).join('、')}`);
    }

    if (profile.profile?.helpSeekingPattern) {
      hidden.add(`我在求助上有固定习惯：${profile.profile.helpSeekingPattern}`);
    }

    if (profile.profile?.adversarialPattern) {
      secondary.add(`如果建议不贴近现实，我可能会先保留或质疑：${profile.profile.adversarialPattern}`);
    }

    if (profile.profile?.cognitiveLoadTolerance) {
      secondary.add(`我的信息承载方式有边界：${profile.profile.cognitiveLoadTolerance}`);
    }

    if (profile.profile?.metacognitiveProfile) {
      hidden.add(`我未必能马上准确说清卡点根因：${profile.profile.metacognitiveProfile}`);
    }

    if (profile.profile?.memoryRepairPattern) {
      hidden.add(`即使我忘了或没真懂，也可能先按自己的习惯处理：${profile.profile.memoryRepairPattern}`);
    }

    return {
      primary: Array.from(primary),
      secondary: Array.from(secondary),
      hidden: Array.from(hidden)
    };
  }

  private flattenGoalConcernPool(concernPool: GoalConcernPool): string[] {
    return [...(concernPool.primary || []), ...(concernPool.secondary || []), ...(concernPool.hidden || [])];
  }

  private inferDisclosedGoalConcerns(reply: string, concernPool: GoalConcernPool, disclosed: string[]): string[] {
    const next = new Set(disclosed);
    const text = (reply || '').toLowerCase();

    const flatPool = this.flattenGoalConcernPool(concernPool);

    const concernKeywords = flatPool.map(item => ({
      item,
      keywords: item
        .replace(/[，。；：,.:]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length >= 2)
    }));

    for (const { item, keywords } of concernKeywords) {
      if (keywords.some(keyword => text.includes(keyword.toLowerCase()))) {
        next.add(item);
      }
    }

    return Array.from(next);
  }
  
  private async addSessionLog(sessionId: string, log: SimulationLogEntry) {
    const session = await prisma.virtual_sessions.findUnique({
      where: { id: sessionId }
    });
    
    if (!session) return;
    
    let logs: SimulationLogEntry[] = [];
    try {
      logs = JSON.parse(session.logs || '[]');
    } catch {}
    
    logs.push(log);

    await this.assertCurrentSessionLeaseOwned(sessionId);
    await prisma.virtual_sessions.update({
      where: { id: sessionId },
      data: {
        logs: JSON.stringify(logs),
        updatedAt: new Date()
      }
    });
  }
  
  private async updateSessionStatus(
    sessionId: string,
    status: string,
    currentStage?: string,
    goalConversationId?: string,
    learningPathId?: string
  ) {
    await this.assertCurrentSessionLeaseOwned(sessionId);
    await prisma.virtual_sessions.update({
      where: { id: sessionId },
      data: {
        status,
        currentStage: currentStage || undefined,
        goalConversationId: goalConversationId || undefined,
        learningPathId: learningPathId || undefined,
        updatedAt: new Date()
      }
    });
  }
  
  private async updateStageResults(sessionId: string, stage: string, result: any) {
    const session = await prisma.virtual_sessions.findUnique({
      where: { id: sessionId }
    });
    
    if (!session) return;
    
    let stageResults: any = {};
    try {
      stageResults = JSON.parse(session.stageResults || '{}');
    } catch {}
    
    stageResults[stage] = result;

    await this.assertCurrentSessionLeaseOwned(sessionId);
    await prisma.virtual_sessions.update({
      where: { id: sessionId },
      data: {
        stageResults: JSON.stringify(stageResults),
        updatedAt: new Date()
      }
    });
  }

  /** 上游 Learn 调用耗尽重试后的终态记录；checkpoint 恢复分支不会走这里。 */
  private async persistLearningFailure(sessionId: string, error: any, logs: SimulationLogEntry[]) {
    const message = this.boundTaskCompletionError(error);
    try {
      const session = await this.getVirtualSession(sessionId);
      const stageResults = this.parseStageResultsPayload(session.stageResults);
      const learning = stageResults.learning || {};
      const now = new Date().toISOString();
      const failedLearning = {
        ...learning,
        taskRuntime: {
          ...(learning.taskRuntime || {}),
          status: 'error',
          error: message,
          failedAt: now,
          updatedAt: now
        }
      };

      await this.updateStageResults(sessionId, 'learning', failedLearning);
      await this.updateSessionStatus(sessionId, 'failed', 'learning');
      const failureLog: SimulationLogEntry = {
        timestamp: now,
        phase: 'error',
        details: {
          error: message,
          output: {
            action: 'learn-upstream-retries-exhausted',
            currentTaskId: failedLearning.currentTaskId || session.currentTaskId || null
          }
        }
      };
      logs.push(failureLog);
      await this.addSessionLog(sessionId, failureLog);
    } catch (persistError: any) {
      // 如果租约已丢失，不能越权写入；由新 owner 或后续恢复流程接管。
      logger.warn('[simulation-coordinator] 持久化 Learn 失败状态失败', {
        sessionId,
        error: persistError?.message || String(persistError)
      });
    }
  }

  private async resetSessionRuntime(
    sessionId: string,
    options: {
      keepGoalConversation?: boolean;
      keepLearningPath?: boolean;
      nextStage: 'goal' | 'path' | 'learning';
      nextStatus?: 'created' | 'running' | 'completed' | 'failed';
      removeStageResults?: string[];
      logPhasesToRemove?: string[];
      resetTaskProgress?: boolean;
      clearCompletedAt?: boolean;
    }
  ) {
    const session = await prisma.virtual_sessions.findUnique({
      where: { id: sessionId }
    })

    if (!session) {
      throw new Error('模拟会话不存在')
    }

    let stageResults: any = {}
    try {
      stageResults = JSON.parse(session.stageResults || '{}')
    } catch {}

    for (const key of options.removeStageResults || []) {
      delete stageResults[key]
    }

    let logs: any[] = []
    try {
      logs = JSON.parse(session.logs || '[]')
    } catch {}

    const logPhasesToRemove = new Set(options.logPhasesToRemove || [])
    const nextLogs = logPhasesToRemove.size
      ? logs.filter((entry: any) => !logPhasesToRemove.has(String(entry?.phase || '')))
      : logs

    await this.assertCurrentSessionLeaseOwned(sessionId)
    await prisma.virtual_sessions.update({
      where: { id: sessionId },
      data: {
        status: options.nextStatus || 'running',
        currentStage: options.nextStage,
        goalConversationId: options.keepGoalConversation ? session.goalConversationId || undefined : null,
        learningPathId: options.keepLearningPath ? session.learningPathId || undefined : null,
        currentTaskId: null,
        completedTasks: options.resetTaskProgress ? 0 : session.completedTasks,
        totalTasks: options.resetTaskProgress ? 0 : session.totalTasks,
        stageResults: JSON.stringify(stageResults),
        logs: JSON.stringify(nextLogs),
        completedAt: options.clearCompletedAt ? null : session.completedAt,
        updatedAt: new Date()
      }
    })
  }

  private parseStageResultsPayload(raw: string | null | undefined) {
    try {
      return JSON.parse(raw || '{}') || {}
    } catch {
      return {}
    }
  }

  private async completeCheckpointedSimulationTask(
    sessionId: string,
    session: any,
    learningState: any,
    milestones: any[],
    taskRuntime: any,
    logs: SimulationLogEntry[]
  ) {
    const taskMatch = this.findTaskInPath(milestones, taskRuntime.taskId);
    if (!taskMatch) return null;

    let taskCompletionResult: any;
    try {
      await this.assertCurrentSessionLeaseOwned(sessionId);
      taskCompletionResult = await learningService.completeTask({
        taskId: taskMatch.task.id,
        userId: session.userId,
        actualMinutes: taskMatch.task.estimatedMinutes || 30,
        notes: '虚拟学习者完成当前 task 的教学会话',
        rating: 5
      });
    } catch (error: any) {
      const boundedError = this.boundTaskCompletionError(error);
      const updatedAt = new Date().toISOString();
      await this.updateStageResults(sessionId, 'learning', {
        ...learningState,
        teachingRevision: taskRuntime.teachingRevision ?? learningState.teachingRevision,
        taskRuntime: {
          ...taskRuntime,
          status: 'task_completion_pending',
          error: boundedError,
          updatedAt
        }
      }).catch((checkpointError: any) => {
        logger.warn('[simulation-coordinator] 更新任务完成待重试错误失败，保留原 pending checkpoint', {
          sessionId,
          error: checkpointError?.message || String(checkpointError)
        });
      });

      const errorLog: SimulationLogEntry = {
        timestamp: updatedAt,
        phase: 'error',
        details: {
          error: boundedError,
          output: {
            currentTask: taskMatch.task.title,
            currentMilestone: taskMatch.milestone.title,
            action: 'task-completion-pending'
          }
        }
      };
      logs.push(errorLog);
      for (const log of logs) {
        await this.addSessionLog(sessionId, log).catch((logError: any) => {
          logger.warn('[simulation-coordinator] 记录任务完成待重试日志失败', {
            sessionId,
            error: logError?.message || String(logError)
          });
        });
      }

      return {
        success: false,
        milestoneProgress: {
          currentMilestone: taskMatch.milestoneIdx + 1,
          totalMilestones: milestones.length,
          currentTask: taskMatch.task.title
        },
        isPathCompleted: false,
        taskCompleted: false,
        currentTaskStopped: true,
        logs,
        error: boundedError
      };
    }

    const completedAt = new Date().toISOString();
    const nextProgress = this.buildProgressAfterTaskCompletion(milestones, taskMatch.task.id);
    const latestSession = await prisma.virtual_sessions.findUnique({ where: { id: sessionId } });
    const latestStageResults = this.parseStageResultsPayload(latestSession?.stageResults);
    const latestLearningState = latestStageResults.learning || learningState;
    const baseCompletedLearningState = {
      ...latestLearningState,
      teachingRevision: taskRuntime.teachingRevision ?? learningState.teachingRevision,
      ...nextProgress.progress,
      taskRuntime: {
        ...taskRuntime,
        status: 'completed',
        reason: taskRuntime.closureDecision?.reason || taskRuntime.reason || '教学系统与 AI 学生共同判定当前 task 已完成',
        completedAt,
        error: null,
        updatedAt: completedAt,
        completionResult: taskCompletionResult?.task ? {
          id: taskCompletionResult.task.id,
          status: taskCompletionResult.task.status,
          completedAt: taskCompletionResult.task.completedAt,
          alreadyCompleted: taskCompletionResult.alreadyCompleted === true
        } : null
      }
    };

    // 先持久化当前任务完成，再尝试启动下一课；下一课上游失败也不会丢失已完成 task。
    const currentProgress = this.countTaskProgress(milestones, taskMatch.task.id);

    await this.assertCurrentSessionLeaseOwned(sessionId);
    await prisma.virtual_sessions.update({
      where: { id: sessionId },
      data: {
        stageResults: JSON.stringify({
          ...latestStageResults,
          learning: baseCompletedLearningState
        }),
        currentTaskId: nextProgress.progress.currentTaskId,
        completedTasks: currentProgress.completedTasks,
        totalTasks: currentProgress.totalTasks,
        status: nextProgress.isPathCompleted ? 'completed' : undefined,
        currentStage: nextProgress.isPathCompleted ? 'learning' : undefined,
        updatedAt: new Date()
      }
    });

    let completedLearningState = baseCompletedLearningState;
    let nextTaskStarted = false;
    if (!nextProgress.isPathCompleted) {
      try {
        const transition = await this.transitionToNextLearningTask(
          sessionId,
          session,
          baseCompletedLearningState,
          baseCompletedLearningState.taskRuntime,
          nextProgress,
          milestones,
          logs
        );
        completedLearningState = transition.learningState;
        nextTaskStarted = transition.nextTaskStarted;
        await this.updateStageResults(sessionId, 'learning', completedLearningState);
        await this.assertCurrentSessionLeaseOwned(sessionId);
        await prisma.virtual_sessions.update({
          where: { id: sessionId },
          data: {
            currentTaskId: completedLearningState.currentTaskId,
            completedTasks: currentProgress.completedTasks,
            totalTasks: currentProgress.totalTasks,
            status: 'running',
            currentStage: 'learning',
            updatedAt: new Date()
          }
        });
      } catch (error: any) {
        const errorMessage = this.boundTaskCompletionError(error);
        completedLearningState = {
          ...baseCompletedLearningState,
          taskRuntime: {
            ...baseCompletedLearningState.taskRuntime,
            status: 'next_task_start_failed',
            error: errorMessage,
            updatedAt: new Date().toISOString()
          }
        };
        await this.updateStageResults(sessionId, 'learning', completedLearningState);
        await this.persistLearningFailure(sessionId, error, logs);
        logs.push({
          timestamp: new Date().toISOString(),
          phase: 'error',
          details: {
            error: errorMessage,
            output: {
              action: 'start-next-learning-task-failed',
              completedTaskId: taskMatch.task.id,
              nextTaskId: nextProgress.progress.currentTaskId
            }
          }
        });
        return {
          success: false,
          milestoneProgress: {
            currentMilestone: nextProgress.progress.currentMilestone + 1,
            totalMilestones: milestones.length,
            currentTask: nextProgress.progress.currentTaskTitle
          },
          isPathCompleted: false,
          taskCompleted: true,
          currentTaskStopped: true,
          logs,
          error: errorMessage
        };
      }
    }

    return {
      success: true,
      milestoneProgress: {
        currentMilestone: nextProgress.isPathCompleted
          ? milestones.length
          : nextProgress.progress.currentMilestone + 1,
        totalMilestones: milestones.length,
        currentTask: nextProgress.progress.currentTaskTitle
      },
      isPathCompleted: nextProgress.isPathCompleted,
      taskCompleted: true,
      currentTaskStopped: !nextTaskStarted,
      logs
    };
  }

  /**
   * 从 session.stageResults.simulationConfig 读取本次会话的 frictionBudget
   * 默认 'normal' (真实人物常态)
   */
  private getSessionFrictionBudget(session: any): FrictionBudget {
    const stageResults = this.parseStageResultsPayload(session?.stageResults)
    return normalizeFrictionBudget(stageResults?.simulationConfig?.frictionBudget)
  }

  private getSessionPromptOverrides(session: any): { goalAgent?: string; pathAgent?: string } | undefined {
    const overrides = this.parseStageResultsPayload(session?.stageResults)?.systemPromptOverrides;
    if (!overrides || typeof overrides !== 'object') return undefined;

    const goalAgent = typeof overrides.goalAgent === 'string' ? overrides.goalAgent.trim() : '';
    const pathAgent = typeof overrides.pathAgent === 'string' ? overrides.pathAgent.trim() : '';
    return goalAgent || pathAgent ? { goalAgent: goalAgent || undefined, pathAgent: pathAgent || undefined } : undefined;
  }

  private parseStoryContextFromStageResults(stageResults: any): any {
    return stageResults?.story || null;
  }
  
  async executeSingleStep(input: SimulationOrchestratorInput): Promise<SimulationStepResult> {
    const startTime = Date.now();
    const logs: SimulationLogEntry[] = [];
    
    try {
      logger.info('[simulation-coordinator] 执行单步模拟', {
        sessionId: input.sessionId,
        userId: input.userId
      });
      
      const session = await this.getVirtualSession(input.sessionId);
      const profile = this.parseProfileData(session.virtual_learner_profiles);
      let initialStageResults: any = {};
      try {
        initialStageResults = JSON.parse(session.stageResults || '{}');
      } catch {}
      const storyContext = this.parseStoryContextFromStageResults(initialStageResults);
      
      if (!session.goalConversationId) {
        // 故事当次需求 → Goal 开场（写入 conversation.description）→ 正式 Path 只吃 Goal，不读 story
        // description 固定用 storyDemand.text，保证传递链不被模拟者改写；模拟者只负责后续轮次。
        const storyDemand = resolveStorySessionDemand({
          story: storyContext,
          profileLearningGoal: profile.learningGoal,
        });
        const openingReply = storyDemand.text;
        if (!openingReply) {
          throw new Error('缺少 Goal 开场诉求：请绑定故事（visibleOpening / goalSeed）或填写画像长期倾向');
        }

        const openingStart = Date.now();
        const openingResult = await this.simulateGoalLearnerReply({
          profile,
          storyContext,
          conversationHistory: [],
          lastAssistantMessage: '',
          currentPhase: 'opening',
          previousLearnerState: undefined,
          goalState: undefined,
          frictionBudget: this.getSessionFrictionBudget(session)
        });

        logs.push({
          timestamp: new Date().toISOString(),
          phase: 'virtual-reply',
          durationMs: Date.now() - openingStart,
          details: {
            output: {
              reply: openingReply,
              thoughtProcess: openingResult.output?.debug?.stateChangeReason,
              learnerState: this.finalizeGoalLearnerState(
                profile,
                this.resolveSimLearnerState(openingResult.output, openingResult.learnerStateFromEnvelope || {}),
                storyContext,
                'understanding'
              ),
              emotion: openingResult.output?.emotion,
              runtimeEnvelope: openingResult.runtimeEnvelope || openingResult.output?.runtimeEnvelope || null,
              opening: true,
              storyDemandSource: storyDemand.source,
              storyId: storyDemand.storyId,
              // 模拟者开场仅作旁路观测，不进入 description
              simulatorOpeningReply: openingResult.output?.reply || null,
            }
          }
        });

        await this.assertCurrentSessionLeaseOwned(input.sessionId);
        const goalResult = await goalConversationService.startConversation(
          input.userId,
          openingReply,
          { systemPromptOverrides: this.getSessionPromptOverrides(session) }
        );
        
        await this.updateSessionStatus(
          input.sessionId,
          'running',
          'goal',
          goalResult.internal.core.conversationId
        );
        
        logs.push({
          timestamp: new Date().toISOString(),
          phase: 'goal-response',
          details: {
            output: {
              userVisible: goalResult.userVisible,
              stage: goalResult.internal.core.stage,
              confidence: goalResult.internal.core.confidence,
              conversationId: goalResult.internal.core.conversationId,
              quickReplies: goalResult.internal.ext?.goalConversation?.quickReplies?.map(q =>
                typeof q === 'string' ? q : q.text
              ) || []
            }
          }
        });

        for (const log of logs) {
          await this.addSessionLog(input.sessionId, log);
        }

        return {
          success: true,
          virtualUserReply: openingReply,
          goalConversationResponse: {
            userVisible: goalResult.userVisible,
            stage: goalResult.internal.core.stage,
            confidence: goalResult.internal.core.confidence,
            quickReplies: goalResult.internal.ext?.goalConversation?.quickReplies?.map(q => 
              typeof q === 'string' ? q : q.text
            )
          },
          currentStage: 'goal',
          goalReady: this.isGoalConverged(goalResult.internal.core.stage),
          logs
        };
      }
      
      const conversation = await this.getGoalConversation(session.goalConversationId, input.userId);
      
      if (!conversation) {
        throw new Error('Goal对话不存在');
      }
      
      let conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
      try {
        const collectedData = JSON.parse(conversation.collectedData || '{}');
        const rawMessages = collectedData.messages || [];
        conversationHistory = rawMessages.map((m: any) => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          content: this.sanitizeVisibleDialogue(typeof m.content === 'string' ? m.content : '')
        })).filter((m: { role: 'user' | 'assistant'; content: string }) => !!m.content);
      } catch {}
      
      const lastAssistantMessage = conversationHistory.length > 0
        ? conversationHistory.filter(m => m.role === 'assistant').pop()?.content || ''
        : conversationHistory.filter(m => m.role !== 'user').pop()?.content || '';
      
      let goalState: any = {};
      try {
        goalState = JSON.parse(conversation.collectedData || '{}');
      } catch {}

      let stageResults: any = {};
      try {
        stageResults = JSON.parse(session.stageResults || '{}');
      } catch {}

      const existingGoalState = stageResults.goal || {};
      const activeStoryContext = this.parseStoryContextFromStageResults(stageResults);
      const concernPool = existingGoalState.concernPool || this.buildGoalConcernPool(profile, goalState);
      const disclosedConcerns = existingGoalState.disclosedConcerns || [];
      const missingFields = [
        !goalState?.understanding?.real_problem ? '真实问题' : null,
        !goalState?.understanding?.background?.current_level ? '当前基础' : null,
        !goalState?.understanding?.background?.expected_time ? '时间预期' : null,
        !goalState?.understanding?.motivation ? '学习动机' : null
      ].filter(Boolean);

      const enrichedGoalState = {
        ...goalState,
        missingFields,
        concernPool,
        disclosedConcerns
      };
      
      const simulationContext = this.buildSimulationContext(
        profile,
        conversationHistory,
        lastAssistantMessage,
        'goal',
        activeStoryContext,
        enrichedGoalState,
        stageResults.goal?.learnerState,
        stageResults.goal?.knowledgeState,
        undefined
      );
      
      const virtualReplyStart = Date.now();
      const virtualReplyResult = await this.retryLearnUpstream(input.sessionId, 'simulate-goal-reply', () =>
        this.simulateGoalLearnerReply({
          profile,
          storyContext: activeStoryContext,
          conversationHistory,
          lastAssistantMessage,
          currentPhase: this.mapGoalStageToLearnerPhase(goalState?.stage || existingGoalState.stage),
          previousLearnerState: stageResults.goal?.learnerState,
          goalState,
          frictionBudget: this.getSessionFrictionBudget(session)
        })
      );
      
      if (!virtualReplyResult.success || !virtualReplyResult.output?.reply) {
        throw new Error('虚拟用户回复生成失败');
      }

      const currentGoalLearnerState = this.finalizeGoalLearnerState(
        profile,
        this.resolveSimLearnerState(
          virtualReplyResult.output,
          virtualReplyResult.learnerStateFromEnvelope || {}
        ),
        activeStoryContext,
        existingGoalState.finalStage || existingGoalState.stage || goalState?.stage
      );
      
      logs.push({
        timestamp: new Date().toISOString(),
        phase: 'virtual-reply',
        durationMs: Date.now() - virtualReplyStart,
        details: {
          output: {
              reply: virtualReplyResult.output?.reply,
            thoughtProcess: virtualReplyResult.output?.debug?.stateChangeReason,
            learnerState: currentGoalLearnerState,
            emotion: virtualReplyResult.output?.emotion,
            runtimeEnvelope: virtualReplyResult.runtimeEnvelope || virtualReplyResult.output?.runtimeEnvelope || null,
          }
        }
      });

      const nextDisclosedConcerns = this.inferDisclosedGoalConcerns(
        virtualReplyResult.output.reply,
        concernPool,
        disclosedConcerns
      );

      await this.updateStageResults(input.sessionId, 'goal', {
        ...existingGoalState,
        concernPool,
        disclosedConcerns: nextDisclosedConcerns,
        learnerState: currentGoalLearnerState,
        lastRuntimeEnvelope: virtualReplyResult.runtimeEnvelope || virtualReplyResult.output?.runtimeEnvelope || null,
      });
      
      const goalResponseStart = Date.now();
      await this.assertCurrentSessionLeaseOwned(input.sessionId);
      const goalResult = await this.retryLearnUpstream(input.sessionId, 'goal-conversation-turn', () =>
        goalConversationService.continueConversation(
          session.goalConversationId,
          virtualReplyResult.output.reply,
          input.userId,
          {
            systemPromptOverrides: this.getSessionPromptOverrides(session),
            // 平台硬规则：proposing 阶段只有显式确认动作才会收束并触发 Path 生成。
            // 黑盒有 confirm_proposal 动作映射；辅助模式由协调器根据虚拟学习者
            // 自评的 readyToAdvance 代发确认，否则 Goal 会永远停在 proposing。
            confirmProposal: currentGoalLearnerState.readyToAdvance === true
          }
        )
      );
      
      logs.push({
        timestamp: new Date().toISOString(),
        phase: 'goal-response',
        durationMs: Date.now() - goalResponseStart,
        details: {
          output: {
            userVisible: goalResult.userVisible,
            stage: goalResult.internal.core.stage,
            confidence: goalResult.internal.core.confidence,
            quickReplies: goalResult.internal.ext?.goalConversation?.quickReplies?.map(q =>
              typeof q === 'string' ? q : q.text
            ) || []
          }
        }
      });

      const goalReady = this.isGoalConverged(goalResult.internal.core.stage);
      const finalGoalLearnerState = this.finalizeGoalLearnerState(
        profile,
        virtualReplyResult.output?.learnerState || {},
        activeStoryContext,
        goalResult.internal.core.stage
      );

      if (goalReady) {
        // 同步 learningPathId 到 virtual_session（goalConversationService 已自动触发 path 生成）
        const updatedConversation = await prisma.goal_conversations.findUnique({
          where: { id: session.goalConversationId }
        });
        
        await this.updateSessionStatus(
          input.sessionId,
          'running',
          'path',
          undefined,
          updatedConversation?.learningPathId
        );
        
        await this.updateStageResults(input.sessionId, 'goal', {
          ...existingGoalState,
          success: true,
          durationMs: Date.now() - startTime,
          conversationId: session.goalConversationId,
          finalStage: goalResult.internal.core.stage,
          learningPathId: updatedConversation?.learningPathId,
          learnerState: finalGoalLearnerState,
          concernPool,
          disclosedConcerns: nextDisclosedConcerns
        });
        
        logs.push({
          timestamp: new Date().toISOString(),
          phase: 'stage-transition',
          details: {
            output: {
              from: 'goal',
              to: 'path',
              learningPathId: updatedConversation?.learningPathId,
              message: '路径已自动开始生成'
            }
          }
        });
        
      }

      for (const log of logs) {
        await this.addSessionLog(input.sessionId, log);
      }
      
      logger.info('[simulation-coordinator] 单步模拟完成', {
        sessionId: input.sessionId,
        durationMs: Date.now() - startTime,
        goalReady
      });
      
        return {
          success: true,
          virtualUserReply: virtualReplyResult.output.reply,
        goalConversationResponse: {
          userVisible: goalResult.userVisible,
          stage: goalResult.internal.core.stage,
          confidence: goalResult.internal.core.confidence,
          quickReplies: goalResult.internal.ext?.goalConversation?.quickReplies?.map(q =>
            typeof q === 'string' ? q : q.text
          )
        },
          currentStage: goalReady ? 'path' : 'goal',
          goalReady,
          logs
        };
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      
      logger.error('[simulation-coordinator] 单步模拟失败', {
        sessionId: input.sessionId,
        error: error.message,
        durationMs
      });
      
      logs.push({
        timestamp: new Date().toISOString(),
        phase: 'error',
        durationMs,
        details: {
          error: error.message
        }
      });
      
      await this.addSessionLog(input.sessionId, logs[logs.length - 1]);
      
      return {
        success: false,
        virtualUserReply: '',
        currentStage: 'goal',
        goalReady: false,
        logs,
        error: error.message
      };
    }
  }
  
  async executeAutoLoop(
    input: SimulationOrchestratorInput,
    options: AutoLoopOptions = {}
  ): Promise<SimulationStepResult[]> {
    const config = await getSimulationAgentConfig();
    const maxRounds = options.maxRounds || config.maxRounds;
    const results: SimulationStepResult[] = [];
    
    logger.info('[simulation-coordinator] 开始自动循环模拟', {
      sessionId: input.sessionId,
      maxRounds,
      config
    });
    
    for (let round = 0; round < maxRounds; round++) {
      const stepResult = await this.executeSingleStep(input);
      results.push(stepResult);
      
      if (options.onStep) {
        options.onStep(stepResult);
      }
      
      if (config.stepDelayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, config.stepDelayMs));
      }
      
      if (!stepResult.success) {
        logger.warn('[simulation-coordinator] 自动循环因错误终止', {
          sessionId: input.sessionId,
          round,
          error: stepResult.error
        });
        break;
      }
      
      if (stepResult.goalReady) {
        logger.info('[simulation-coordinator] 自动循环因Goal Ready终止', {
          sessionId: input.sessionId,
          round
        });
        
        const shouldAdvancePath = options.autoAdvanceToPath ?? config.autoAdvanceToPath;
        if (shouldAdvancePath) {
          logger.info('[simulation-coordinator] 自动推进到Path阶段', {
            sessionId: input.sessionId
          });
          await this.advanceToPathGeneration(input.sessionId);

          if (options.autoAdvanceToLearning) {
            logger.info('[simulation-coordinator] 自动推进到Learning阶段', {
              sessionId: input.sessionId
            });
            try {
              await this.resolvePathReview(input.sessionId, { startLearning: true });
            } catch (err: any) {
              logger.warn('[simulation-coordinator] 自动启动 Learn 失败', { error: err.message });
            }
          }
        }
        break;
      }
    }
    
    logger.info('[simulation-coordinator] 自动循环模拟完成', {
      sessionId: input.sessionId,
      totalRounds: results.length
    });
    
    return results;
  }

  /**
   * 一键运行整个会话: Goal -> Path -> Learn
   * 适合"全自动"按钮，跑到 Goal 收敛 -> 自动生成 Path -> 自动启动 Learn -> 跑完所有 task
   */
  async executeFullSession(
    sessionId: string,
    options: RunFullOptions = {}
  ): Promise<{
    success: boolean;
    goalRounds: number;
    learningSteps: number;
    pathGenerated: boolean;
    isPathCompleted: boolean;
    finalStage?: string;
    error?: string;
  }> {
    const config = await getSimulationAgentConfig();
    const maxRounds = options.maxRounds || config.maxRounds;
    const maxMilestones = options.maxMilestones || 10;
    const continueOnTaskComplete = options.continueOnTaskComplete ?? true;

    logger.info('[simulation-coordinator] 一键全流程开始', {
      sessionId,
      maxRounds,
      maxMilestones,
      continueOnTaskComplete
    });

    const session = await this.getVirtualSession(sessionId);
    const summary = {
      success: false,
      goalRounds: 0,
      learningSteps: 0,
      pathGenerated: false,
      isPathCompleted: false,
      finalStage: session.currentStage,
      error: undefined as string | undefined
    };

    try {
      // ========== Phase A: Goal ==========
      if (session.currentStage === 'goal') {
        const goalResults = await this.executeAutoLoop(
          { sessionId, userId: session.userId, mode: 'auto-loop' },
          {
            maxRounds,
            autoAdvanceToPath: options.autoAdvanceToPath ?? true,
            autoAdvanceToLearning: options.autoAdvanceToLearning ?? false
          }
        );
        summary.goalRounds = goalResults.length;
        const lastGoal = goalResults[goalResults.length - 1];
        if (!lastGoal?.goalReady && !lastGoal?.success) {
          summary.error = lastGoal?.error || 'Goal 阶段未完成';
          return summary;
        }
      }

      // refresh session state
      const updatedAfterGoal = await this.getVirtualSession(sessionId);
      summary.finalStage = updatedAfterGoal.currentStage;
      summary.pathGenerated = !!updatedAfterGoal.learningPathId;

      // ========== Phase B: Path -> Learn bridge ==========
      if (updatedAfterGoal.learningPathId && updatedAfterGoal.currentStage !== 'learning') {
        try {
          const review = await this.resolvePathReview(sessionId, {
            startLearning: options.autoAdvanceToLearning ?? false
          });
          if (!review.success) {
            summary.error = review.error || 'Path 评审失败';
            return summary;
          }
        } catch (err: any) {
          logger.warn('[simulation-coordinator] 启动 Learn 失败', { error: err.message });
          summary.error = err.message || '启动 Learn 失败';
          return summary;
        }
      }

      // ========== Phase C: Learn loop with continueOnTaskComplete ==========
      const refreshed = await this.getVirtualSession(sessionId);
      if (refreshed.currentStage !== 'learning') {
        summary.finalStage = refreshed.currentStage;
        summary.success = true;
        return summary;
      }

      let totalLearningSteps = 0;
      let consecutiveTaskBoundaries = 0;
      const maxTaskBoundaries = continueOnTaskComplete ? maxMilestones * 3 : 1;

      while (consecutiveTaskBoundaries < maxTaskBoundaries) {
        const learnResult = await this.executeAutoLearning(sessionId, { maxMilestones });
        totalLearningSteps += learnResult.totalSteps || 0;

        // refresh
        const after = await this.getVirtualSession(sessionId);
        summary.finalStage = after.currentStage;

        if (after.status === 'completed') {
          summary.isPathCompleted = true;
          break;
        }
        if (after.status === 'failed') {
          summary.error = '学习被中止';
          break;
        }
        if (!continueOnTaskComplete) {
          break;
        }

        // if last loop ran 0 steps, no further progress is possible
        if (!learnResult.success || (learnResult.totalSteps || 0) === 0) {
          break;
        }

        consecutiveTaskBoundaries += 1;
      }

      summary.learningSteps = totalLearningSteps;
      summary.success = true;
      return summary;
    } catch (error: any) {
      logger.error('[simulation-coordinator] 一键全流程失败', { sessionId, error });
      summary.error = error.message || 'unknown';
      return summary;
    }
  }

  
  async advanceToPathGeneration(sessionId: string): Promise<{
    success: boolean;
    learningPathId?: string;
    error?: string;
  }> {
    try {
      const session = await this.getVirtualSession(sessionId);
      
      if (!session.goalConversationId) {
        throw new Error('Goal对话不存在');
      }
      
      const conversation = await this.getGoalConversation(
        session.goalConversationId,
        session.userId
      );
      
      if (!conversation) {
        throw new Error('Goal对话记录不存在');
      }
      
      let collectedData: any = {};
      try {
        collectedData = JSON.parse(conversation.collectedData || '{}');
      } catch {}
      
      if (session.learningPathId) {
        // 会话上的 Path 指针可能因外部删除/重建而过期，校验后再复用。
        const existingPath = await prisma.learning_paths.findUnique({
          where: { id: session.learningPathId },
          select: { id: true }
        });
        if (existingPath) {
          return { success: true, learningPathId: session.learningPathId };
        }
        logger.warn('[simulation-coordinator] 会话绑定的 Path 已不存在，重新生成', {
          sessionId,
          stalePathId: session.learningPathId
        });
        await prisma.virtual_sessions.update({
          where: { id: sessionId },
          data: { learningPathId: null, updatedAt: new Date() }
        });
      }

      // Path 不读 story、不特判虚拟人：只消费 Goal 对话产物。
      // rawGoal 优先 conversation.description（= 故事需求经开场传入的正式链路）。
      const pathRawGoal = resolvePathRawGoalFromSession({
        goalConversationDescription: conversation.description,
      });
      if (!pathRawGoal.rawGoal) {
        throw new Error('无法推进 Path：Goal 对话缺少正式诉求，请先恢复 Goal 对话');
      }

      const pathRequest: GoalPathRequest = {
        userId: session.userId,
        sourceConversationId: session.goalConversationId,
        source: 'goal',
        rawGoal: pathRawGoal.rawGoal,
        visibleSummary: buildGoalPathVisibleSummary({
          understanding: collectedData.understanding || {},
          confirmedProposal: collectedData.confirmedProposal || null,
          collected: collectedData.collected || {},
        }),
        conversationHistory: collectedData.messages || [],
        systemPromptOverrides: this.getSessionPromptOverrides(session)?.pathAgent
          ? { pathAgent: this.getSessionPromptOverrides(session)?.pathAgent }
          : undefined
      };
      
      logger.info('[simulation-coordinator] 开始路径生成', {
        sessionId,
        userId: session.userId,
        rawGoalSource: pathRawGoal.source,
      });
      
      const pathResult = await pathCoordinator.generateFromGoal(pathRequest);
      
      const learningPathId = pathResult?.path?.id || pathResult?.id;
      
      if (learningPathId) {
        await this.updateSessionStatus(
          sessionId,
          'running',
          'path',
          undefined,
          learningPathId
        );

        // 同步 Goal ↔ Path 指针：重建 Path 后 goal_conversations 可能仍指向已删除的旧 Path，
        // 不回写会导致后续评审重规划拿着失效 id 报错。
        if (conversation.learningPathId !== learningPathId) {
          await prisma.goal_conversations.update({
            where: { id: session.goalConversationId },
            data: { learningPathId }
          }).catch((err: any) => {
            logger.warn('[simulation-coordinator] 回写 goal_conversations.learningPathId 失败', {
              sessionId,
              learningPathId,
              error: err?.message || String(err)
            });
          });
        }

        await this.updateStageResults(sessionId, 'path', {
          success: true,
          learningPathId,
          totalMilestones: pathResult?.path?.totalMilestones
        });
      }
      
      logger.info('[simulation-coordinator] 路径生成完成', {
        sessionId,
        learningPathId
      });
      
      return {
        success: true,
        learningPathId
      };
    } catch (error: any) {
      logger.error('[simulation-coordinator] 路径生成失败', {
        sessionId,
        error: error.message
      });
      
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  async reviewPathProposal(sessionId: string): Promise<{
    success: boolean;
    decision?: 'accept' | 'modify' | 'reject';
    reaction?: string;
    visibleRequestedChanges?: string[];
    error?: string;
  }> {
    try {
      const session = await this.getVirtualSession(sessionId);
      
      if (!session.learningPathId) {
        throw new Error('学习路径不存在，请先生成路径');
      }
      
      const profile = this.parseProfileData(session.virtual_learner_profiles);

      let stageResults: any = {};
      try {
        stageResults = JSON.parse(session.stageResults || '{}');
      } catch {}
      
      const learningPath = await prisma.learning_paths.findUnique({
        where: { id: session.learningPathId }
      });
      
      if (!learningPath) {
        throw new Error('学习路径记录不存在');
      }
      
      const milestones = await prisma.milestones.findMany({
        where: { learningPathId: session.learningPathId },
        orderBy: { stageNumber: 'asc' }
      });
      
      const reactionStart = Date.now();
      const reactionOutput = await executeSkill(virtualLearnerPathEvaluatorDefinition, {
        learner: profile,
        story: this.parseStoryContextFromStageResults(stageResults),
        pathProposal: {
          title: learningPath.title,
          description: learningPath.description,
          totalMilestones: learningPath.totalMilestones,
          estimatedHours: learningPath.estimatedHours,
          difficulty: learningPath.difficulty,
          milestones: milestones.map(m => ({
            stageNumber: m.stageNumber,
            title: m.title,
            description: m.description,
            estimatedHours: m.estimatedHours
          }))
        },
        goalState: null,
        previousReaction: stageResults.path_review || null,
        learnerState: this.mergeLearnerState(profile, stageResults.path_review?.learnerState || stageResults.goal?.learnerState, 'path', this.parseStoryContextFromStageResults(stageResults)),
        frictionBudget: this.getSessionFrictionBudget(session)
      });

      if (!reactionOutput?.reaction) {
        throw new Error('虚拟用户 Path 评审结果无效');
      }

      // path-evaluator envelope 仅作观测；决策仍读 debug.internalDecision
      const pathReviewEnvelope = reactionOutput?.runtimeEnvelope || null;
      
      const decision = ['accept', 'modify', 'reject'].includes(reactionOutput.debug?.internalDecision)
        ? reactionOutput.debug.internalDecision as 'accept' | 'modify' | 'reject'
        : 'accept';
      const visibleRequestedChanges = reactionOutput.visibleRequestedChanges || [];
      const biggestConcern = reactionOutput.debug?.visibleSignal || visibleRequestedChanges[0] || null;

      await this.addSessionLog(sessionId, {
        timestamp: new Date().toISOString(),
        phase: 'path-review',
        durationMs: Date.now() - reactionStart,
        details: {
          output: {
            reaction: reactionOutput.reaction,
            decision,
            confidence: reactionOutput.debug?.internalConfidence ?? null,
            visibleRequestedChanges,
            biggestConcern,
            learningPathId: session.learningPathId,
            runtimeEnvelope: pathReviewEnvelope,
          }
        }
      });
      
      await this.updateStageResults(sessionId, 'path_review', {
        success: true,
        lastRuntimeEnvelope: pathReviewEnvelope,
        status: 'pending',
        decision,
        reaction: reactionOutput.reaction,
        visibleRequestedChanges,
        biggestConcern,
        confidence: reactionOutput.debug?.internalConfidence ?? null,
        reviewedPathId: session.learningPathId,
        reviewedAt: new Date().toISOString(),
        learnerState: this.mergeLearnerState(profile, stageResults.path_review?.learnerState || stageResults.goal?.learnerState, 'path', this.parseStoryContextFromStageResults(stageResults))
      });
      
      logger.info('[simulation-coordinator] 路径评审完成', {
        sessionId,
        hasReaction: !!reactionOutput.reaction,
        requestedChangeCount: Array.isArray(reactionOutput.visibleRequestedChanges) ? reactionOutput.visibleRequestedChanges.length : 0
      });
      
      return {
        success: true,
        decision,
        reaction: reactionOutput.reaction,
        visibleRequestedChanges
      };
    } catch (error: any) {
      logger.error('[simulation-coordinator] 路径评审失败', {
        sessionId,
        error: error.message
      });
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  /** 人工确认接受评审结论。只改评审状态，不自动启动 Learn。 */
  async acceptPathReview(sessionId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const session = await this.getVirtualSession(sessionId);
      const stageResults = this.parseStageResultsPayload(session.stageResults);
      const pathReview = stageResults.path_review || {};

      if (!session.learningPathId) {
        throw new Error('学习路径不存在，请先生成 Path');
      }
      if (pathReview.decision !== 'accept') {
        throw new Error('虚拟学习者尚未接受当前 Path，不能标记接受');
      }
      if (pathReview.reviewedPathId !== session.learningPathId) {
        throw new Error('评审针对的是旧版 Path，请重新评审当前 Path');
      }

      await this.updateStageResults(sessionId, 'path_review', { ...pathReview, status: 'accepted' });
      await this.addSessionLog(sessionId, {
        timestamp: new Date().toISOString(),
        phase: 'stage-transition',
        details: {
          output: {
            from: 'path-review',
            to: 'path-accepted',
            reason: 'operator-confirmed-accept',
            learningPathId: session.learningPathId
          }
        }
      });
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /** 人工触发：按评审意见重规划。评审保持 pending，直到人工决定。 */
  async replanPathFromReview(sessionId: string): Promise<{
    success: boolean;
    learningPathId?: string;
    error?: string;
  }> {
    const session = await this.getVirtualSession(sessionId);
    const stageResults = this.parseStageResultsPayload(session.stageResults);
    const pathReview = stageResults.path_review || {};

    try {
      if (!session.learningPathId) {
        throw new Error('学习路径不存在，无法重规划');
      }
      if (!session.goalConversationId) {
        throw new Error('Goal 对话不存在，无法重规划');
      }
      if (pathReview.reviewedPathId && pathReview.reviewedPathId !== session.learningPathId) {
        throw new Error('评审针对的是旧版 Path，请先重新评审当前 Path');
      }
      if (pathReview.status === 'replanned') {
        throw new Error('已按上次意见重规划过，请先重新评审新版 Path');
      }

      const feedback = [pathReview.reaction, ...(pathReview.visibleRequestedChanges || [])]
        .filter(Boolean)
        .join('\n');
      if (!feedback) {
        throw new Error('评审没有可执行的修改意见，请先评审 Path');
      }

      await this.updateStageResults(sessionId, 'path_review', {
        ...pathReview,
        status: 'replanning',
        replan: { requestedAt: new Date().toISOString(), sourcePathId: session.learningPathId, reason: feedback }
      });
      await this.addSessionLog(sessionId, {
        timestamp: new Date().toISOString(),
        phase: 'path-replan',
        details: { output: { decision: pathReview.decision, learningPathId: session.learningPathId, feedback } }
      });

      await this.assertCurrentSessionLeaseOwned(sessionId);
      const result = await goalConversationService.regeneratePath(
        session.goalConversationId,
        session.userId,
        feedback,
        this.getSessionPromptOverrides(session)
      );
      const learningPathId = result.internal?.core?.learningPath?.id || session.learningPathId;
      await this.updateSessionStatus(sessionId, 'running', 'path', session.goalConversationId, learningPathId);
      await this.updateStageResults(sessionId, 'path_review', {
        ...pathReview,
        status: 'replanned',
        replan: { requestedAt: new Date().toISOString(), sourcePathId: session.learningPathId, resultPathId: learningPathId, completedAt: new Date().toISOString(), reason: feedback }
      });
      await this.addSessionLog(sessionId, {
        timestamp: new Date().toISOString(),
        phase: 'stage-transition',
        details: { output: { from: 'path-review', to: 'path', reason: 'path-replanned-awaiting-review', decision: pathReview.decision, learningPathId } }
      });
      return { success: true, learningPathId };
    } catch (error: any) {
      const latest = this.parseStageResultsPayload((await this.getVirtualSession(sessionId)).stageResults);
      await this.updateStageResults(sessionId, 'path_review', {
        ...(latest.path_review || pathReview),
        status: 'failed',
        error: error.message || '重规划失败'
      });
      return { success: false, error: error.message || '重规划失败' };
    }
  }

  /**
   * 一键全流程专用：评审后自动推进（accept→可选启动 Learn；否则自动重规划）。
   * 手动操作请用 reviewPathProposal / acceptPathReview / replanPathFromReview。
   */
  async resolvePathReview(sessionId: string, options: { startLearning?: boolean } = {}): Promise<{
    success: boolean;
    decision?: 'accept' | 'modify' | 'reject';
    currentStage?: string;
    learningPathId?: string;
    error?: string;
  }> {
    const review = await this.reviewPathProposal(sessionId);
    if (!review.success || !review.decision) return { success: false, error: review.error || 'Path 评审失败' };

    const session = await this.getVirtualSession(sessionId);

    if (review.decision === 'accept') {
      const accepted = await this.acceptPathReview(sessionId);
      if (!accepted.success) return { success: false, decision: review.decision, error: accepted.error };
      if (!options.startLearning) {
        return { success: true, decision: review.decision, currentStage: 'path', learningPathId: session.learningPathId };
      }
      await this.addSessionLog(sessionId, {
        timestamp: new Date().toISOString(),
        phase: 'stage-transition',
        details: { output: { from: 'path', to: 'learning', reason: 'path-review-accepted', learningPathId: session.learningPathId } }
      });
      const learning = await this.startLearningPhase(sessionId);
      return {
        success: learning.success,
        decision: review.decision,
        currentStage: learning.success ? 'learning' : 'path',
        learningPathId: session.learningPathId,
        error: learning.error
      };
    }

    const replanned = await this.replanPathFromReview(sessionId);
    return {
      success: replanned.success,
      decision: review.decision,
      currentStage: replanned.success ? 'path' : undefined,
      learningPathId: replanned.learningPathId,
      error: replanned.error
    };
  }

  async startLearningPhase(sessionId: string, options: { taskId?: string } = {}): Promise<{
    success: boolean;
    teachingSessionId?: string;
    welcomeMessage?: string;
    milestones?: any[];
    selectedTaskId?: string;
    error?: string;
  }> {
    try {
      const session = await this.getVirtualSession(sessionId);
      
      if (!session.learningPathId) {
        throw new Error('学习路径不存在，请先生成路径');
      }

      // 评审是独立质量旁路，不作为 Learn 前置闸门：Path 存在且任务就绪即可启动。
      // Learn 产生进度后，路径变更保护会阻止重规划/删除，证据链不被破坏。
      
      const learningPath = await prisma.learning_paths.findUnique({
        where: { id: session.learningPathId },
        include: {
          milestones: {
            orderBy: { stageNumber: 'asc' },
            include: {
              subtasks: {
                orderBy: { order: 'asc' }
              }
            }
          }
        }
      });
      
      if (!learningPath || !learningPath.milestones.length) {
        throw new Error('学习路径或里程碑不存在');
      }

      let firstMilestone = learningPath.milestones[0];
      let firstMilestoneIdx = 0;
      let runnableTasks = this.getRunnableTasks(firstMilestone?.subtasks || []);
      let firstTask = runnableTasks[0];
      let firstTaskIdx = 0;

      if (options.taskId) {
        firstMilestoneIdx = learningPath.milestones.findIndex(m => Array.isArray(m.subtasks) && m.subtasks.some(task => task.id === options.taskId));
        const selectedMilestone = firstMilestoneIdx >= 0 ? learningPath.milestones[firstMilestoneIdx] : undefined;
        runnableTasks = this.getRunnableTasks(selectedMilestone?.subtasks || []);
        const selectedTask = selectedMilestone?.subtasks?.find((task: any) => task.id === options.taskId);

        if (!selectedMilestone || !selectedTask) {
          throw new Error('指定任务不存在');
        }

        if (String(selectedTask.status || '').toLowerCase() === 'completed') {
          throw new Error('指定任务已完成，不能重新启动');
        }

        firstMilestone = selectedMilestone;
        firstTask = selectedTask;
        firstTaskIdx = runnableTasks.findIndex(task => task.id === options.taskId);

        if (firstTaskIdx < 0) {
          throw new Error('指定任务当前不可启动');
        }
      }
      
      if (!firstTask) {
        throw new Error('第一个里程碑没有可用任务');
      }
      
      logger.info('[simulation-coordinator] 开始学习阶段', {
        sessionId,
        learningPathId: learningPath.id,
        firstTaskId: firstTask.id,
        firstMilestone: firstMilestone.title
      });
      
      await this.assertCurrentSessionLeaseOwned(sessionId);
      const teachingSession = await this.retryLearnUpstream(
        sessionId,
        'start-learning-task',
        () => aiTeachingOrchestrator.startSession({
          userId: session.userId,
          taskId: firstTask.id
        })
      );
      
      await this.updateSessionStatus(
        sessionId,
        'running',
        'learning',
        session.goalConversationId || undefined,
        session.learningPathId
      );
      
      await this.addSessionLog(sessionId, {
        timestamp: new Date().toISOString(),
        phase: 'learning-start',
        details: {
          output: {
            teachingSessionId: teachingSession.sessionId,
            welcomeMessage: teachingSession.welcomeMessage,
            currentMilestone: firstMilestone.title,
            currentTask: firstTask.title
          }
        }
      });
      
      await this.updateStageResults(sessionId, 'learning', {
        success: true,
        teachingSessionId: teachingSession.sessionId,
        teachingRevision: teachingSession.revision,
        ...this.buildLearningProgressSnapshot(learningPath.milestones, firstMilestoneIdx, firstTaskIdx)
      });

      await this.assertCurrentSessionLeaseOwned(sessionId);
      await prisma.virtual_sessions.update({
        where: { id: sessionId },
        data: {
          currentTaskId: firstTask.id,
          ...this.countTaskProgress(learningPath.milestones),
          updatedAt: new Date()
        }
      });
      
      return {
        success: true,
        teachingSessionId: teachingSession.sessionId,
        welcomeMessage: teachingSession.welcomeMessage,
        selectedTaskId: firstTask.id,
        milestones: learningPath.milestones.map(m => ({
          stageNumber: m.stageNumber,
          title: m.title,
          description: m.description,
          estimatedHours: m.estimatedHours,
          subtasksCount: m.subtasks?.length || 0
        }))
      };
    } catch (error: any) {
      logger.error('[simulation-coordinator] 学习阶段启动失败', {
        sessionId,
        error: error.message
      });
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  async executeLearningStep(sessionId: string): Promise<{
    success: boolean;
    userMessage?: string;
    aiResponse?: string;
    milestoneProgress?: any;
    isPathCompleted?: boolean;
    taskCompleted?: boolean;
    currentTaskStopped?: boolean;
    logs?: SimulationLogEntry[];
    error?: string;
  }> {
    const startTime = Date.now();
    const logs: SimulationLogEntry[] = [];
    
    try {
      const session = await this.getVirtualSession(sessionId);
      const profile = this.parseProfileData(session.virtual_learner_profiles);
      
      if (!session.learningPathId) {
        throw new Error('学习路径不存在');
      }
      
      const stageResults: any = this.parseStageResultsPayload(session.stageResults)

      const learningState = stageResults.learning || {};
      if (learningState.manualStop || session.status === 'failed') {
        return {
          success: false,
          error: learningState.stoppedReason ? `学习已停止: ${learningState.stoppedReason}` : '学习已停止'
        }
      }

      const learningPath = await prisma.learning_paths.findUnique({
        where: { id: session.learningPathId },
        include: {
          milestones: {
            orderBy: { stageNumber: 'asc' },
            include: {
              subtasks: {
                orderBy: { order: 'asc' }
              }
            }
          }
        }
      });
      
      if (!learningPath) {
        throw new Error('学习路径不存在');
      }
      
      const milestones = learningPath.milestones;
      const taskRuntime = learningState.taskRuntime || {};
      const runtimeTaskMatch = this.findTaskInPath(milestones, taskRuntime.taskId);

      if (taskRuntime.status === 'task_completion_pending' && runtimeTaskMatch) {
        return await this.completeCheckpointedSimulationTask(
          sessionId,
          session,
          learningState,
          milestones,
          taskRuntime,
          logs
        );
      }

      if (
        runtimeTaskMatch
        && taskRuntime.status !== 'task_completion_pending'
        && taskRuntime.status !== 'completed'
        && taskRuntime.teachingSessionId
      ) {
        const teachingDetail = await aiTeachingOrchestrator.getSessionDetail(
          taskRuntime.teachingSessionId,
          session.userId
        );
        if (
          teachingDetail?.id === taskRuntime.teachingSessionId
          && teachingDetail.status === 'completed'
          && teachingDetail.taskId === taskRuntime.taskId
        ) {
          const finalizedAt = taskRuntime.finalizedAt
            || (teachingDetail.endTime ? new Date(teachingDetail.endTime).toISOString() : new Date().toISOString());
          const recoveredRuntime = {
            ...taskRuntime,
            status: 'task_completion_pending',
            taskId: runtimeTaskMatch.task.id,
            taskTitle: runtimeTaskMatch.task.title,
            teachingSessionId: teachingDetail.id,
            teachingRevision: teachingDetail.revision,
            closureDecision: taskRuntime.closureDecision || learningState.closureDecision || null,
            finalizedAt,
            error: null,
            updatedAt: new Date().toISOString()
          };
          const recoveredLearningState = {
            ...learningState,
            teachingRevision: teachingDetail.revision,
            taskRuntime: recoveredRuntime
          };
          await this.updateStageResults(sessionId, 'learning', recoveredLearningState);
          return await this.completeCheckpointedSimulationTask(
            sessionId,
            session,
            recoveredLearningState,
            milestones,
            recoveredRuntime,
            logs
          );
        }
      }

      if (taskRuntime.status === 'completed') {
        // 已完成任务与当前指针不同，说明在“完成 → 下一课开课”之间中断；恢复下一课。
        if (
          learningState.currentTaskId
          && taskRuntime.taskId
          && learningState.currentTaskId !== taskRuntime.taskId
        ) {
          const recoveredStart = await this.startLearningPhase(sessionId, {
            taskId: learningState.currentTaskId
          });
          if (!recoveredStart.success) {
            return {
              success: false,
              currentTaskStopped: true,
              logs,
              error: recoveredStart.error || '恢复下一学习任务失败'
            };
          }
          return {
            success: true,
            isPathCompleted: false,
            taskCompleted: false,
            currentTaskStopped: false,
            milestoneProgress: {
              currentMilestone: typeof learningState.currentMilestone === 'number'
                ? learningState.currentMilestone + 1
                : null,
              totalMilestones: milestones.length,
              currentTask: learningState.currentTaskTitle || null
            },
            logs
          };
        }
        const completedProgress = taskRuntime.taskId
          ? this.buildProgressAfterTaskCompletion(milestones, taskRuntime.taskId)
          : null;
        return {
          success: true,
          isPathCompleted: completedProgress?.isPathCompleted || false,
          taskCompleted: true,
          currentTaskStopped: true,
          milestoneProgress: {
            currentMilestone: completedProgress?.isPathCompleted
              ? milestones.length
              : typeof learningState.currentMilestone === 'number' ? learningState.currentMilestone + 1 : null,
            totalMilestones: milestones.length,
            currentTask: learningState.currentTaskTitle || null
          },
          logs
        };
      }

      const currentMilestoneIdx = learningState.currentMilestone || 0;
      const currentTaskIdx = learningState.currentTaskIdx || 0;
      const currentMilestone = milestones[currentMilestoneIdx];
      
      if (!currentMilestone) {
        return {
          success: true,
          isPathCompleted: true,
          milestoneProgress: {
            completed: milestones.length,
            total: milestones.length
          },
          logs
        };
      }
      
      const tasks = this.getRunnableTasks(currentMilestone.subtasks || []);
      const currentTask = tasks[currentTaskIdx];
      
      if (!currentTask) {
        const nextMilestoneIdx = currentMilestoneIdx + 1;
        if (nextMilestoneIdx >= milestones.length) {
          return {
            success: true,
            isPathCompleted: true,
            logs
          };
        }
        
        await this.updateStageResults(sessionId, 'learning', {
          ...learningState,
          ...this.buildLearningProgressSnapshot(milestones, nextMilestoneIdx, 0)
        });
        
        return await this.executeLearningStep(sessionId);
      }
      
      const trimmedConversationHistory = this.trimLearningConversationHistory(learningState.conversationHistory || [])
      const lastAssistantMessage = [...trimmedConversationHistory]
        .reverse()
        .find((item: any) => item.role === 'assistant')?.content || '';

      const mergedLearnerState = this.mergeLearnerState(profile, learningState.learnerState, 'learning', this.parseStoryContextFromStageResults(stageResults))
      const simulationContext = {
        profile,
        conversationHistory: trimmedConversationHistory,
        lastAssistantMessage,
        currentStage: 'learning',
        learnerState: {
          ...mergedLearnerState,
          phaseFocus: this.inferLearningPhase(mergedLearnerState)
        },
        learningState: {
          currentMilestone: currentMilestone.title,
          currentTask: currentTask.title,
          milestoneProgress: currentMilestoneIdx + 1,
          totalMilestones: milestones.length
        }
      };
      
      const virtualReplyStart = Date.now();
      const virtualReplyOutput = await this.retryLearnUpstream(sessionId, 'simulate-learning-turn', () => executeSkill(virtualLearnerLearnTurnSimulatorDefinition, {
        learner: {
          profile: profile.profile || {},
          learningGoal: profile.learningGoal,
          knownConcepts: profile.knownConcepts || [],
          struggleConcepts: profile.struggleConcepts || [],
          personalityTraits: profile.personalityTraits || {},
        },
        story: this.parseStoryContextFromStageResults(stageResults),
        visibleContext: {
          history: trimmedConversationHistory.map((item: any) => ({
            role: item.role === 'assistant' ? 'teacher' : 'learner',
            content: item.content,
          })),
          lastTeacherMessage: lastAssistantMessage,
        },
        currentPhase: simulationContext.learnerState.phaseFocus,
        previousLearnerState: mergedLearnerState,
        currentTask: {
          title: currentTask.title,
          milestoneTitle: currentMilestone.title,
        },
        knowledgeSnapshot: [],
        frictionBudget: this.getSessionFrictionBudget(session),
      }));

      const resolvedLearnState = this.resolveSimLearnerState(virtualReplyOutput);
      const virtualReplyResult = {
        success: !!virtualReplyOutput?.reply,
        userVisible: virtualReplyOutput?.reply || '',
        learnerState: resolvedLearnState,
        learnerFeedback: virtualReplyOutput?.learnerFeedback,
        runtimeEnvelope: virtualReplyOutput?.runtimeEnvelope || null,
        internal: {
          emotion: virtualReplyOutput?.emotion,
          learnerState: resolvedLearnState,
          learnerFeedback: virtualReplyOutput?.learnerFeedback,
        }
      };
      
      if (!virtualReplyResult.success || !virtualReplyResult.userVisible) {
        const errorMsg = !virtualReplyOutput?.reply ? '学习者回复生成失败' : '学习者回复为空';
        throw new Error(errorMsg);
      }
      
      logs.push({
        timestamp: new Date().toISOString(),
        phase: 'learning-reply',
        durationMs: Date.now() - virtualReplyStart,
        details: {
          output: {
            reply: virtualReplyResult.userVisible,
            currentTask: currentTask.title,
            currentMilestone: currentMilestone.title,
            learnerState: virtualReplyResult.learnerState || virtualReplyResult.internal?.learnerState,
            runtimeEnvelope: virtualReplyResult.runtimeEnvelope,
            learnerFeedback: virtualReplyResult.learnerFeedback || virtualReplyResult.internal?.learnerFeedback || null,
            emotion: virtualReplyResult.internal?.emotion
          }
        }
      });
      
      let aiResponse = '';
      let nextTaskIdx = currentTaskIdx;
      let nextMilestoneIdx = currentMilestoneIdx;
      let learningStepError: string | null = null;
      let closureDecision: any = null;
      let shouldStopCurrentTask = false;

      const teachingSessionId = learningState.teachingSessionId;
      let teachingRevision = teachingSessionId
        ? await this.resolveTeachingRevision(teachingSessionId, session.userId, learningState.teachingRevision)
        : undefined;
      
      if (teachingSessionId) {
        try {
          const aiResponseStart = Date.now();
          await this.assertCurrentSessionLeaseOwned(sessionId);
          const aiResult = await this.retryLearnUpstream(sessionId, 'process-teaching-turn', () =>
            aiTeachingOrchestrator.processStudentMessage(
              teachingSessionId,
              virtualReplyResult.userVisible,
              { expectedRevision: teachingRevision }
            )
          );
          teachingRevision = aiResult.revision;
          
          aiResponse = aiResult.aiResponse || '';
          
          const learnerFeedback = virtualReplyResult.learnerFeedback || virtualReplyResult.internal?.learnerFeedback || null;
          const teacherReady = !!(aiResult.isCompletion || aiResult.autoEnded);
          const learnerReady = !!(
            learnerFeedback?.selfReportedTaskDone === true &&
            learnerFeedback?.wantsMoreHelp !== true &&
            learnerFeedback?.stopAsking === true &&
            (!Array.isArray(learnerFeedback?.remainingBlockers) || learnerFeedback.remainingBlockers.length === 0)
          );
          closureDecision = {
            teacherReady,
            learnerReady,
            canCompleteTask: teacherReady && learnerReady,
            teacherSignal: {
              isCompletion: !!aiResult.isCompletion,
              autoEnded: !!aiResult.autoEnded,
              classroomStage: aiResult.promptDebug?.learnDebug?.output?.stageDecision?.stage || null
            },
            learnerFeedback,
            reason: teacherReady && learnerReady
              ? '教学系统给出收束信号，AI 学生也自评当前 task 已完成。'
              : teacherReady
                ? '教学系统给出收束信号，但 AI 学生仍未自评完成或仍想继续获得帮助。'
                : learnerReady
                  ? 'AI 学生自评当前 task 已完成，但教学系统尚未给出收束信号。'
                  : '教学系统与 AI 学生均未同时满足当前 task 收束条件。'
          };

          logs.push({
            timestamp: new Date().toISOString(),
            phase: 'learning-response',
            durationMs: Date.now() - aiResponseStart,
            details: {
              output: {
                aiResponse,
                isCompletion: aiResult.isCompletion,
                autoEnded: aiResult.autoEnded || false,
                cognitiveLevel: aiResult.analysis?.cognitiveLevel,
                knowledgePoint: aiResult.knowledgePoint || null,
                knowledgePoints: aiResult.knowledgePoints || [],
                strategies: aiResult.strategies || [],
                peerTriggered: aiResult.peerTriggered || false,
                peerMessage: aiResult.peerMessage || null,
                currentState: aiResult.currentState || null,
                promptDebug: aiResult.promptDebug || null,
                closureDecision
              }
            }
          });
          
          if (closureDecision.canCompleteTask) {
            await this.assertCurrentSessionLeaseOwned(sessionId);
            const endResult = await aiTeachingOrchestrator.endSession(
              teachingSessionId,
              'task-completed',
              teachingRevision
            );
            teachingRevision = endResult.revision;
            const taskFinalizedAt = new Date().toISOString();
            const checkpointLearnerState = this.mergeLearnerState(
              profile,
              virtualReplyResult.learnerState || virtualReplyResult.internal?.learnerState,
              'learning',
              this.parseStoryContextFromStageResults(stageResults)
            );
            const checkpointConversationHistory = [
              ...(learningState.conversationHistory || []),
              { role: 'user', content: virtualReplyResult.userVisible },
              { role: 'assistant', content: aiResponse }
            ];
            const pendingTaskRuntime = {
              status: 'task_completion_pending',
              reason: closureDecision.reason,
              taskId: currentTask.id,
              taskTitle: currentTask.title,
              teachingSessionId,
              teachingRevision,
              closureDecision,
              finalizedAt: taskFinalizedAt,
              completionSource: 'teacher-and-learner-feedback',
              error: null,
              updatedAt: taskFinalizedAt
            };
            const checkpointLearningState = {
              ...learningState,
              teachingRevision,
              learnerState: checkpointLearnerState,
              latestLearnerFeedback: virtualReplyResult.learnerFeedback || virtualReplyResult.internal?.learnerFeedback || null,
              closureDecision,
              taskRuntime: pendingTaskRuntime,
              conversationHistory: checkpointConversationHistory
            };
            await this.updateStageResults(sessionId, 'learning', checkpointLearningState);
            const taskCompletionResult = await this.completeCheckpointedSimulationTask(
              sessionId,
              session,
              checkpointLearningState,
              milestones,
              pendingTaskRuntime,
              logs
            );
            if (!taskCompletionResult) {
              throw new Error('待完成任务不在当前学习路径中');
            }

            if (taskCompletionResult.success) {
              if (taskCompletionResult.isPathCompleted) {
                logs.push({
                  timestamp: new Date().toISOString(),
                  phase: 'stage-transition',
                  details: {
                    output: {
                      from: 'learning',
                      to: 'completed',
                      message: '学习路径已完成'
                    }
                  }
                });

                try {
                  await this.generateWrapupForSession(sessionId);
                  logs.push({
                    timestamp: new Date().toISOString(),
                    phase: 'stage-transition',
                    details: {
                      output: { message: '已生成学习总结' }
                    }
                  });
                } catch (err: any) {
                  logger.warn('[simulation-coordinator] 生成 wrapup 失败', { sessionId, error: err.message });
                  logs.push({
                    timestamp: new Date().toISOString(),
                    phase: 'error',
                    details: {
                      error: err.message || 'wrapup generation failed'
                    }
                  });
                }
              }

              for (const log of logs) {
                await this.addSessionLog(sessionId, log).catch((logError: any) => {
                  logger.warn('[simulation-coordinator] 记录任务完成日志失败', {
                    sessionId,
                    error: logError?.message || String(logError)
                  });
                });
              }
            }

            return {
              ...taskCompletionResult,
              userMessage: virtualReplyResult.userVisible,
              aiResponse,
              logs
            };
          } else if (closureDecision.teacherReady) {
            shouldStopCurrentTask = true;
          }
        } catch (err: any) {
          logger.warn('[simulation-coordinator] AI教学响应失败，已停止当前学习步骤', {
            sessionId,
            error: err.message
          });
          learningStepError = err.message || '教学响应失败';
          aiResponse = `当前教学会话不可继续：${learningStepError}。请重新开始当前 task 或人工检查。`;
          logs.push({
            timestamp: new Date().toISOString(),
            phase: 'error',
            details: {
              error: err.message || '教学响应失败',
              output: {
                currentTask: currentTask.title,
                currentMilestone: currentMilestone.title,
                action: 'learning-step-stopped'
              }
            }
          });
        }
      } else {
        learningStepError = '当前 Learn 没有绑定教学会话';
        aiResponse = '当前 Learn 没有绑定教学会话，请先重新开始当前 task。';
        logs.push({
          timestamp: new Date().toISOString(),
          phase: 'error',
          details: {
            error: '当前 Learn 没有绑定教学会话',
            output: {
              currentTask: currentTask.title,
              currentMilestone: currentMilestone.title,
              action: 'learning-step-stopped'
            }
          }
        });
      }
      
      const isPathCompleted = nextMilestoneIdx >= milestones.length;
      
      const nextLearningState = {
        ...learningState,
        teachingRevision,
        ...(isPathCompleted
          ? {
              currentMilestone: milestones.length,
              currentMilestoneTitle: null,
              currentTaskIdx: 0,
              currentTaskId: null,
              currentTaskTitle: null,
              totalMilestones: milestones.length
            }
          : this.buildLearningProgressSnapshot(milestones, nextMilestoneIdx, nextTaskIdx)),
        learnerState: this.mergeLearnerState(profile, virtualReplyResult.learnerState || virtualReplyResult.internal?.learnerState, 'learning', this.parseStoryContextFromStageResults(stageResults)),
        latestLearnerFeedback: virtualReplyResult.learnerFeedback || virtualReplyResult.internal?.learnerFeedback || null,
        closureDecision,
        taskRuntime: {
          ...(learningState.taskRuntime || {}),
          status: learningStepError
            ? 'error'
            : closureDecision?.teacherReady && !closureDecision?.learnerReady
              ? 'teacher_ready_learner_not_satisfied'
              : closureDecision?.learnerReady && !closureDecision?.teacherReady
                ? 'learner_ready_waiting_teacher'
                : 'active',
          taskId: currentTask.id,
          taskTitle: currentTask.title,
          teachingSessionId,
          error: learningStepError,
          closureDecision,
          updatedAt: new Date().toISOString()
        },
        conversationHistory: [
          ...(learningState.conversationHistory || []),
          { role: 'user', content: virtualReplyResult.userVisible },
          { role: 'assistant', content: aiResponse }
        ]
      };

      await this.updateStageResults(sessionId, 'learning', nextLearningState);
      await this.assertCurrentSessionLeaseOwned(sessionId);
      await prisma.virtual_sessions.update({
        where: { id: sessionId },
        data: {
          currentTaskId: isPathCompleted ? null : currentTask.id,
          status: learningStepError ? 'failed' : undefined,
          currentStage: learningStepError ? 'learning' : undefined,
          updatedAt: new Date()
        }
      });

      if (learningStepError) {
        logs.push({
          timestamp: new Date().toISOString(),
          phase: 'stage-transition',
          details: {
            output: {
              from: 'learning',
              to: 'failed',
              message: 'Learn 上游调用重试耗尽，保留当前 task 供重启 Learn 恢复',
              currentTaskId: currentTask.id
            }
          }
        });
      }
      
      if (isPathCompleted) {
        await this.updateSessionStatus(sessionId, 'completed', 'learning');
        
        logs.push({
          timestamp: new Date().toISOString(),
          phase: 'stage-transition',
          details: {
            output: {
              from: 'learning',
              to: 'completed',
              message: '学习路径已完成'
            }
          }
        });

        // 触发 wrapup 总结生成
        try {
          await this.generateWrapupForSession(sessionId);
          logs.push({
            timestamp: new Date().toISOString(),
            phase: 'stage-transition',
            details: {
              output: { message: '已生成学习总结' }
            }
          });
        } catch (err: any) {
          logger.warn('[simulation-coordinator] 生成 wrapup 失败', { sessionId, error: err.message });
          logs.push({
            timestamp: new Date().toISOString(),
            phase: 'error',
            details: {
              error: err.message || 'wrapup generation failed'
            }
          });
        }
      }
      
      for (const log of logs) {
        await this.addSessionLog(sessionId, log);
      }
      
      return {
        success: !learningStepError,
        userMessage: virtualReplyResult.userVisible,
        aiResponse,
        milestoneProgress: {
          currentMilestone: isPathCompleted
            ? milestones.length
            : nextMilestoneIdx + 1,
          totalMilestones: milestones.length,
          currentTask: isPathCompleted
            ? null
            : (this.buildLearningProgressSnapshot(milestones, nextMilestoneIdx, nextTaskIdx).currentTaskTitle || null)
        },
        isPathCompleted,
        taskCompleted: false,
        ...(shouldStopCurrentTask ? { currentTaskStopped: true } : {}),
        logs,
        error: learningStepError || undefined
      };
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      
      logger.error('[simulation-coordinator] 学习步骤执行失败', {
        sessionId,
        error: error.message,
        durationMs
      });
      
      logs.push({
        timestamp: new Date().toISOString(),
        phase: 'error',
        durationMs,
        details: {
          error: error.message
        }
      });

      await this.persistLearningFailure(sessionId, error, logs);
      
      return {
        success: false,
        logs,
        error: error.message
      };
    }
  }

  async executeAutoLearning(
    sessionId: string,
    options: { maxMilestones?: number } = {}
  ): Promise<{
    success: boolean;
    totalSteps?: number;
    completedMilestones?: number;
    error?: string;
  }> {
    const maxMilestones = options.maxMilestones || 10;
    
    try {
      let session = await this.getVirtualSession(sessionId);

      if (session.status === 'completed') {
        return { success: true, totalSteps: 0, completedMilestones: 0 };
      }

      const initialStageResults = this.parseStageResultsPayload(session.stageResults)
      if (initialStageResults.learning?.manualStop || session.status === 'failed') {
        return {
          success: false,
          error: initialStageResults.learning?.stoppedReason ? `学习已停止: ${initialStageResults.learning.stoppedReason}` : '学习已停止'
        }
      }

      if (session.currentStage !== 'learning') {
        const startResult = await this.startLearningPhase(sessionId);
        if (!startResult.success) {
          return { success: false, error: startResult.error };
        }
        session = await this.getVirtualSession(sessionId)
      }
      
      let steps = 0;
      const maxSteps = maxMilestones * 3;
      
      for (let i = 0; i < maxSteps; i++) {
        const latestSession = await this.getVirtualSession(sessionId)
        const latestStageResults = this.parseStageResultsPayload(latestSession.stageResults)
        if (latestStageResults.learning?.manualStop || latestSession.status === 'failed') {
          return {
            success: false,
            totalSteps: steps,
            error: latestStageResults.learning?.stoppedReason ? `学习已停止: ${latestStageResults.learning.stoppedReason}` : '学习已停止'
          }
        }

        const stepResult = await this.executeLearningStep(sessionId);
        steps++;
        
        if (stepResult.isPathCompleted) {
          logger.info('[simulation-coordinator] 自动学习完成', {
            sessionId,
            totalSteps: steps
          });
          
          return {
            success: true,
            totalSteps: steps,
            completedMilestones: maxMilestones
          };
        }

        if (!stepResult.success) {
          throw new Error(stepResult.error || '学习步骤失败');
        }

        if ((stepResult as any).currentTaskStopped) {
          logger.info('[simulation-coordinator] 当前学习任务已收束或需处理，停止自动学习', {
            sessionId,
            totalSteps: steps
          });

          return {
            success: true,
            totalSteps: steps,
            completedMilestones: 0
          };
        }
        
        if (i % 5 === 0) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      return {
        success: true,
        totalSteps: steps,
        completedMilestones: maxMilestones
      };
    } catch (error: any) {
      logger.error('[simulation-coordinator] 自动学习失败', {
        sessionId,
        error: error.message
      });
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  async emergencyStopLearning(sessionId: string, reason = 'admin-emergency-stop'): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      const session = await this.getVirtualSession(sessionId);

      let stageResults: any = {};
      try {
        stageResults = JSON.parse(session.stageResults || '{}');
      } catch {}

      const learningState = stageResults.learning || {};
      const teachingSessionId = learningState.teachingSessionId;

      if (teachingSessionId) {
        const teachingRevision = await this.resolveTeachingRevision(
          teachingSessionId,
          session.userId,
          learningState.teachingRevision
        );
        await this.assertCurrentSessionLeaseOwned(sessionId);
        await aiTeachingOrchestrator.resetSession(
          teachingSessionId,
          session.userId,
          teachingRevision
        ).catch(() => {});
      }

      await this.updateStageResults(sessionId, 'learning', {
        ...learningState,
        manualStop: true,
        stoppedAt: new Date().toISOString(),
        stoppedReason: reason
      });

      await this.updateSessionStatus(sessionId, 'failed', 'learning');

      await this.addSessionLog(sessionId, {
        timestamp: new Date().toISOString(),
        phase: 'error',
        details: {
          error: `EMERGENCY_STOP:${reason}`
        }
      });

      return { success: true };
    } catch (error: any) {
      logger.error('[simulation-coordinator] 紧急停止学习失败', {
        sessionId,
        error: error.message
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  async restartPathPhase(sessionId: string): Promise<{
    success: boolean;
    learningPathId?: string;
    error?: string;
  }> {
    try {
      const session = await this.getVirtualSession(sessionId)

      let stageResults: any = {}
      try {
        stageResults = JSON.parse(session.stageResults || '{}')
      } catch {}

      const learningState = stageResults.learning || {}
      const teachingSessionId = learningState.teachingSessionId

      if (session.learningPathId) {
        // 已进入 Learn/有任务进度的正式 Path 不能删除重建，保留故事→Goal→Path→Learn 证据链。
        await assertPathMutationSafe(prisma, session.learningPathId, 'delete-path')
      }

      if (teachingSessionId) {
        const teachingRevision = await this.resolveTeachingRevision(
          teachingSessionId,
          session.userId,
          learningState.teachingRevision
        )
        await this.assertCurrentSessionLeaseOwned(sessionId)
        await aiTeachingOrchestrator.resetSession(
          teachingSessionId,
          session.userId,
          teachingRevision
        ).catch(() => {})
      }

      if (session.learningPathId) {
        await prisma.learning_paths.delete({
          where: { id: session.learningPathId }
        })
        // Goal 上的 Path 指针同步清空，避免后续重规划引用已删除的旧 Path。
        if (session.goalConversationId) {
          await prisma.goal_conversations.update({
            where: { id: session.goalConversationId },
            data: { learningPathId: null }
          }).catch(() => {})
        }
      }

      await this.resetSessionRuntime(sessionId, {
        keepGoalConversation: true,
        keepLearningPath: false,
        nextStage: 'path',
        nextStatus: 'running',
        removeStageResults: ['path', 'path_review', 'learning'],
        logPhasesToRemove: ['learning-start', 'learning-step', 'stage-transition'],
        // 重启课堂不重置 Path 上已完成 task 的真实进度。
        resetTaskProgress: false,
        clearCompletedAt: true
      })

      return await this.advanceToPathGeneration(sessionId)
    } catch (error: any) {
      logger.error('[simulation-coordinator] 重建路径失败', {
        sessionId,
        error: error.message
      })

      return {
        success: false,
        error: error.message
      }
    }
  }

  async restartLearningPhase(sessionId: string, options: { taskId?: string } = {}): Promise<{
    success: boolean;
    teachingSessionId?: string;
    welcomeMessage?: string;
    milestones?: any[];
    selectedTaskId?: string;
    error?: string;
  }> {
    try {
      const session = await this.getVirtualSession(sessionId)

      let stageResults: any = {}
      try {
        stageResults = JSON.parse(session.stageResults || '{}')
      } catch {}

      const learningState = stageResults.learning || {}
      const teachingSessionId = learningState.teachingSessionId
      const preferredTaskId = options.taskId || learningState.currentTaskId || undefined
      const teachingSessionHistory = [
        ...(Array.isArray(learningState.teachingSessionHistory) ? learningState.teachingSessionHistory : []),
        ...(teachingSessionId ? [{
          teachingSessionId,
          taskId: learningState.currentTaskId || null,
          taskTitle: learningState.currentTaskTitle || null,
          status: 'restarted',
          restartedAt: new Date().toISOString()
        }] : [])
      ]

      if (teachingSessionId) {
        const teachingRevision = await this.resolveTeachingRevision(
          teachingSessionId,
          session.userId,
          learningState.teachingRevision
        )
        await this.assertCurrentSessionLeaseOwned(sessionId)
        await aiTeachingOrchestrator.resetSession(
          teachingSessionId,
          session.userId,
          teachingRevision
        ).catch(() => {})
      }

      await this.resetSessionRuntime(sessionId, {
        keepGoalConversation: true,
        keepLearningPath: true,
        nextStage: 'learning',
        nextStatus: 'running',
        removeStageResults: ['learning'],
        logPhasesToRemove: ['learning-start', 'learning-step', 'learning-reply', 'learning-response', 'stage-transition'],
        resetTaskProgress: true,
        clearCompletedAt: true
      })

      const restartResult = await this.startLearningPhase(sessionId, preferredTaskId ? { taskId: preferredTaskId } : {})
      if (restartResult.success) {
        const restartedSession = await this.getVirtualSession(sessionId)
        const restartedStageResults = this.parseStageResultsPayload(restartedSession.stageResults)
        await this.updateStageResults(sessionId, 'learning', {
          ...(restartedStageResults.learning || {}),
          teachingSessionHistory
        })
        return restartResult
      }

      if (preferredTaskId && ['指定任务不存在', '指定任务已完成，不能重新启动', '指定任务当前不可启动'].includes(String(restartResult.error || ''))) {
        logger.warn('[simulation-coordinator] 重新开始学习时指定任务不可用，回退到首个可启动任务', {
          sessionId,
          preferredTaskId,
          error: restartResult.error
        })

        return await this.startLearningPhase(sessionId)
      }

      return restartResult
    } catch (error: any) {
      logger.error('[simulation-coordinator] 重开学习失败', {
        sessionId,
        error: error.message
      })

      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * 学习完成后生成 wrapup 总结 (调用 skill:session-wrapup)
   * 将结果写入 stageResults.learning.wrapup
   */
  async generateWrapupForSession(sessionId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const session = await this.getVirtualSession(sessionId);
      const stageResults = this.parseStageResultsPayload(session.stageResults);
      const learning = stageResults.learning || {};
      const storyContext = stageResults.story || stageResults.storyContext || null;

      // 已经生成过就不重复
      if (learning.wrapup) {
        return { success: true };
      }

      const conversation = Array.isArray(learning.conversationHistory) ? learning.conversationHistory : [];
      const messages = conversation.map((m: any) => ({
        role: m.role || (m.isLearner ? 'user' : 'assistant'),
        content: m.content || m.text || '',
        timestamp: m.timestamp || m.createdAt || undefined
      }));

      const userMessageCount = messages.filter(m => m.role === 'user').length;
      const assistantMessageCount = messages.filter(m => m.role === 'assistant').length;

      const createdAt = session.createdAt ? new Date(session.createdAt as any).getTime() : Date.now();
      const completedAt = Date.now();
      const durationMinutes = Math.max(1, Math.round((completedAt - createdAt) / 60000));

      // 知识点: 从 learnerState 抽取
      const learnerState = learning.learnerState || {};
      const knowledgePoints: SessionWrapupInput['knowledgePoints'] = Array.isArray(learnerState.knowledgePoints)
        ? learnerState.knowledgePoints.map((kp: any) => ({
            name: kp.name || kp.label || '未命名知识点',
            status: kp.status || 'in_progress',
            progress: typeof kp.progress === 'number' ? kp.progress : 50
          }))
        : [];

      const wrapupInput: SessionWrapupInput = {
        messages,
        knowledgePoints,
        sessionInfo: {
          subject: storyContext?.subject || '虚拟学习场景',
          topic: storyContext?.title || storyContext?.storyTitle || '本次故事',
          durationMinutes,
          userMessageCount,
          assistantMessageCount,
          taskType: 'practice',
          taskTitle: learning.currentTaskTitle || undefined,
          taskDescription: learning.currentTaskDescription || undefined,
          pathTitle: storyContext?.pathTitle || null,
          pathSummary: storyContext?.pathSummary || null
        },
        learningState: typeof learnerState.lss === 'number'
          ? {
              lss: learnerState.lss || 5,
              ktl: learnerState.ktl || 5,
              lf: learnerState.lf || 5,
              lsb: learnerState.lsb || 5,
              recentTrend: learnerState.recentTrend,
              recommendedPacing: learnerState.recommendedPacing
            }
          : undefined
      };

      const result = await sessionWrapupAgent.generate(wrapupInput);

      // 写回 stageResults.learning.wrapup
      await this.updateStageResults(sessionId, 'learning', {
        ...learning,
        wrapup: {
          generatedAt: new Date().toISOString(),
          summary: result.summary,
          evaluation: result.evaluation,
          summarySource: result.summarySource,
          evaluationSource: result.evaluationSource
        }
      });

      logger.info('[simulation-coordinator] wrapup 已生成', { sessionId });
      return { success: true };
    } catch (error: any) {
      logger.error('[simulation-coordinator] generateWrapupForSession 失败', { sessionId, error });
      return { success: false, error: error.message || 'unknown' };
    }
  }
}

const simulationOrchestrator = new SimulationOrchestrator();

export default simulationOrchestrator;
export { SimulationOrchestrator };
