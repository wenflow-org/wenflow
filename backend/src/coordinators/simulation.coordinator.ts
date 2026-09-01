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
import { executeSkill, virtualLearnerGoalDialogueSimulatorDefinition, virtualLearnerPathEvaluatorDefinition, virtualLearnerLearnTurnSimulatorDefinition, virtualLearnerMemoryCuratorDefinition } from '../skills';
import { normalizeFrictionBudget, type FrictionBudget } from '../skills/virtual-learner-shared';
import { sessionWrapupAgent, type SessionWrapupInput } from '../skills/session-wrapup';
import { buildGoalPathVisibleSummary } from '../services/learning/goal-path-visible-summary';
import {
  resolvePathRawGoalFromSession,
  resolveStorySessionDemand,
} from '../virtual-lab/story-demand';
import { safeJsonParse } from '../utils/safe-json';
import { asErrorLike } from '../virtual-lab/vlab-types';
import { memoryTraceService } from '../services/memory/memory-trace.service';
import {
  buildLearnerMemorySnapshot,
  recordCompletedArtifact,
  writeProfileConceptsAfterLesson,
  type LessonKnowledgePoint,
  type SelfReportedLearnerState,
} from '../virtual-lab/learner-memory';
import type { LeaseClientLike } from '../virtual-lab/vlab-types';
import type {
  SimulationMilestone,
  SimulationTask,
  SimulatorSkillOutput,
  StageResults,
  TeachingState,
  VirtualLearnerProfileRow,
  VirtualSessionWithProfile
} from '../virtual-lab/vlab-types';
import type { 
  ConversationHistoryItem,
  KnowledgePointState,
  PersonalityTraits,
  SimulationContext,
  SimulationStepResult,
  SimulationLogEntry,
  VirtualLearnerProfile,
  VirtualLearnerProfileData,
  GoalConcernPool,
  LearnerLatentState
} from './simulation.types';

const COORDINATOR_ID = 'simulation-agent';
const ASSISTED_SESSION_LEASE_MS = 10 * 60 * 1000;
const ASSISTED_SESSION_LEASE_RENEW_MS = 2 * 60 * 1000;
const LEASE_RETRY_DELAYS_MS = [25, 50, 100];
const LEARN_UPSTREAM_RETRY_ATTEMPTS = 8;
const LEARN_UPSTREAM_RETRY_DELAY_MS = 2000;
/** 一节课的课时预算：超过仍未双方收束则显式失败（可重启恢复），不允许无限拖堂 */
const LEARN_TASK_TURN_BUDGET = 40;
/** 「自动完成本课」单次调用的回合上限（按课界停止，不按里程碑数估算） */
const LEARN_AUTO_TURN_CAP = 40;
/** Provider 不稳定时的自动重试上限（每次 executeAutoLearning 循环内） */
const LEARN_STEP_PROVIDER_RETRIES = 3;

/** 判断错误是否为 LLM Provider 可重试错误（过载/超时/JSON 解析失败） */
function isProviderRetryable(errorMsg: string): boolean {
  const e = errorMsg.toLowerCase();
  // turn_budget_exhausted 是课时预算闸门的显式终止信号：若被当作可重试，
  // 自动循环会静默 restartLearningPhase 把 turns 归零，预算形同虚设
  // retry_budget_exhausted 同理：总 AI 调用预算耗尽后 restart 只会再次耗尽，空转恢复次数
  if (e.includes('turn_budget_exhausted') || e.includes('retry_budget_exhausted')) return false;
  return e.includes('provider') || e.includes('retry') || e.includes('timeout')
    || e.includes('overload') || e.includes('budget') || e.includes('503')
    || e.includes('does not contain valid json') || e.includes('response does not contain');
}
/** 保护工作（可能悬挂的 LLM 调用）超过该时限仍未收尾时，强制放行会话队列 */
const WORK_SETTLE_TIMEOUT_MS = 5 * 60 * 1000;
/** 疑似卡死 running 会话的判定阈值：无活跃租约且超过该时长未写入 */
const STALE_RUNNING_SESSION_MS = 30 * 60 * 1000;

function isPrismaErrorCode(error: unknown, code: string) {
  return typeof error === 'object' && error !== null && asErrorLike(error).code === code;
}

function isLeaseDatabaseBusyError(error: unknown) {
  if (isPrismaErrorCode(error, 'P1008')) return true;
  const code = typeof error === 'object' && error !== null ? String(asErrorLike(error).code || '') : '';
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
  assertLeaseOwned: (leaseClient?: LeaseClientLike) => Promise<void>;
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
    work: (assertLeaseOwned: (leaseClient?: LeaseClientLike) => Promise<void>) => Promise<T>,
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
    await this.detectStaleRunningSession(sessionId);

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
      let forceReleaseTimer: NodeJS.Timeout | undefined;
      const forceReleaseDeadline = new Promise<void>(resolve => {
        forceReleaseTimer = setTimeout(() => {
          logger.warn('[simulation-coordinator] 保护工作超过时限仍未收尾，强制放行会话队列', {
            sessionId,
            ownerId,
            timeoutMs: WORK_SETTLE_TIMEOUT_MS
          });
          resolve();
        }, WORK_SETTLE_TIMEOUT_MS);
      });
      forceReleaseTimer?.unref();
      await Promise.race([workSettled, forceReleaseDeadline]);
      if (forceReleaseTimer) clearTimeout(forceReleaseTimer);
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

  private async detectStaleRunningSession(sessionId: string) {
    try {
      const session = await prisma.virtual_sessions.findUnique({
        where: { id: sessionId },
        select: { status: true, currentStage: true, updatedAt: true }
      });
      if (!session || session.status !== 'running') return;
      const updatedAt = session.updatedAt ? new Date(session.updatedAt).getTime() : 0;
      if (Number.isFinite(updatedAt) && Date.now() - updatedAt > STALE_RUNNING_SESSION_MS) {
        logger.warn('[simulation-coordinator] 检测到疑似卡死的 running 会话：无活跃租约且长时间未写入，请人工确认后重启', {
          sessionId,
          currentStage: session.currentStage,
          staleMs: Date.now() - updatedAt,
          thresholdMs: STALE_RUNNING_SESSION_MS
        });
      }
    } catch (error) {
      logger.warn('[simulation-coordinator] 检查疑似卡死会话状态失败', {
        sessionId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async renewSessionLease(
    sessionId: string,
    ownerId: string,
    knownExpiresAt = Date.now() + ASSISTED_SESSION_LEASE_MS,
    leaseClient: LeaseClientLike = prisma
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

  private async renewAssistedLease(context: AssistedLeaseContext, leaseClient: LeaseClientLike = prisma) {
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

  private sanitizeVisibleContextMessage(message: { content?: unknown }, role: 'learner' | 'goal_agent') {
    const content = this.sanitizeVisibleDialogue(typeof message?.content === 'string' ? message.content : '');
    if (!content) return null;
    return { role, content };
  }

  private trimLearningConversationHistory(history: Array<{ role: string; content: string }> = []): ConversationHistoryItem[] {
    if (!Array.isArray(history) || history.length === 0) return [];
    return history.slice(-6).map((item): ConversationHistoryItem => ({
      role: item.role === 'assistant' ? 'assistant' : 'user',
      content: this.sanitizeVisibleDialogue(typeof item?.content === 'string' ? item.content : '')
    })).filter((item) => item.content);
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

  /**
   * phaseFocus 以模拟器（LLM 基于对话+看板）判断为主，编排器只做钳制：
   * 1. 模拟器上次输出的 phaseFocus 若合法且非孤立 ready_to_close（需 readyForNextTask=true），直接沿用；
   * 2. 否则回退阈值机推断（首轮/缺失/非法/自相矛盾时兜底）。
   */
  private resolveLearnerPhase(learnerState: LearnerLatentState | null | undefined): 'trying' | 'blocked' | 'verifying' | 'ready_to_close' {
    const state = learnerState || {};
    const current = state.phaseFocus;
    const VALID_PHASES: Array<'trying' | 'blocked' | 'verifying' | 'ready_to_close'> = ['trying', 'blocked', 'verifying', 'ready_to_close'];
    if (VALID_PHASES.includes(current as (typeof VALID_PHASES)[number])) {
      if (current === 'ready_to_close' && state.readyForNextTask !== true) {
        return this.inferLearningPhase(state);
      }
      return current as (typeof VALID_PHASES)[number];
    }
    return this.inferLearningPhase(state);
  }

  private getRunnableTasks(tasks: SimulationTask[] = []) {
    return tasks.filter(task => task.status !== 'completed');
  }

  private countTaskProgress(milestones: SimulationMilestone[], completedTaskId?: string | null) {
    const tasks = milestones.flatMap((milestone) => milestone?.subtasks || []);
    return {
      totalTasks: tasks.length,
      completedTasks: tasks.filter((task) => task.status === 'completed' || task.id === completedTaskId).length
    };
  }

  private isRetryableLearnUpstreamError(error: unknown) {
    const message = String(asErrorLike(error).message || error || '').toLowerCase();
    // 注意：不匹配 "retry budget" —— RETRY_BUDGET_EXHAUSTED 是网关的终止信号，
    // 上层若将其视为可重试，等于每次重试都重新发放预算，预算形同虚设。
    return /structured_output_invalid|invalid chat completion|finish_reason|length|empty content|reply completion mismatch|api request canceled|fetch failed|timeout|timed out|econnreset|socket|network|rate.?limit|\b429\b|\b502\b|\b503\b|\b504\b|\b529\b/.test(message);
  }

  private async retryLearnUpstream<T>(sessionId: string, operation: string, execute: () => Promise<T>): Promise<T> {
    // 预算来源：故事级覆盖（storyContext.budget）优先，否则角色级（profile.simulationBudget）。
    // 语义：maxRetriesPerStep = 单次上游调用的重试次数；maxRetriesTotal = 单会话累计 AI 调用
    // 上限（防无限跑的总护栏，含重试）；两者任一耗尽即终止。
    let maxRetries = LEARN_UPSTREAM_RETRY_ATTEMPTS;
    let maxTotalCalls: number | null = null;
    try {
      const session = await this.getVirtualSession(sessionId);
      const profileData = safeJsonParse<VirtualLearnerProfileData>(session.virtual_learner_profiles.profile, {});
      const stageResults = this.parseStageResultsPayload(session.stageResults);
      // 故事级覆盖：会话绑定的故事可单独设预算（单个故事失控时单独限制，不影响其他故事）
      const storyBudget = (stageResults.story?.budget || null) as Record<string, unknown> | null;
      const budget = storyBudget || profileData?.simulationBudget || null;
      if (budget && Number.isFinite(Number(budget.maxRetriesPerStep)) && Number(budget.maxRetriesPerStep) > 0) {
        // 上限钳制与路由层/前端输入框一致（[1,20]），防止历史脏数据触发近无限重试
        maxRetries = Math.min(20, Math.max(1, Math.round(Number(budget.maxRetriesPerStep))));
      }
      if (budget && Number.isFinite(Number(budget.maxRetriesTotal)) && Number(budget.maxRetriesTotal) > 0) {
        maxTotalCalls = Math.min(1000, Math.max(1, Math.round(Number(budget.maxRetriesTotal))));
      }
    } catch {
      // 会话尚不可用或 profile 无预算配置：沿用默认值
    }
    let lastError: unknown;
    let attempts = 0;
    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      attempts = attempt;
      // 总 AI 调用护栏：每次实际执行前检查累计值（含本次），超限即终止
      if (maxTotalCalls !== null) {
        const consumed = await this.readAiCallCount(sessionId);
        if (consumed + 1 > maxTotalCalls) {
          const err = new Error(`retry_budget_exhausted：本会话累计 AI 调用已达上限（${maxTotalCalls}），已终止。可调高预算后重试续传。`);
          (err as Error & { code?: string }).code = 'RETRY_BUDGET_EXHAUSTED';
          throw err;
        }
      }
      try {
        await this.assertCurrentSessionLeaseOwned(sessionId);
        const result = await execute();
        // 成功也计入一次 AI 调用（重试次数 + 最终成功那次）
        await this.consumeAiCall(sessionId, attempts);
        return result;
      } catch (error: unknown) {
        lastError = error;
        if (!this.isRetryableLearnUpstreamError(error) || attempt === maxRetries) break;
        logger.warn('[simulation-coordinator] Learn 上游调用失败，准备重试', {
          sessionId,
          operation,
          attempt,
          maxRetries,
          error: asErrorLike(error).message || String(error)
        });
        await new Promise(resolve => setTimeout(resolve, LEARN_UPSTREAM_RETRY_DELAY_MS * attempt));
      }
    }
    // 重试耗尽：也计入消耗（失败的重试调用）
    if (maxTotalCalls !== null) {
      await this.consumeAiCall(sessionId, attempts).catch(() => undefined);
    }
    throw lastError;
  }

  /** 读取该会话累计 AI 调用次数（stageResults.runtimeStats.aiCalls） */
  private async readAiCallCount(sessionId: string): Promise<number> {
    try {
      const session = await this.getVirtualSession(sessionId);
      const stageResults = this.parseStageResultsPayload(session.stageResults);
      return Number((stageResults.runtimeStats as Record<string, unknown> | undefined)?.aiCalls) || 0;
    } catch {
      return 0;
    }
  }

  /** 原子累计该会话 AI 调用次数（并发安全：事务内读-改-写） */
  private async consumeAiCall(sessionId: string, count: number): Promise<void> {
    if (!Number.isFinite(count) || count < 1) return;
    try {
      await prisma.$transaction(async (tx) => {
        const session = await tx.virtual_sessions.findUnique({
          where: { id: sessionId },
          select: { stageResults: true }
        });
        if (!session) return;
        const stageResults: StageResults = safeJsonParse<StageResults>(session.stageResults, {});
        const stats = (stageResults.runtimeStats || {}) as Record<string, unknown>;
        const prev = Number(stats.aiCalls) || 0;
        stageResults.runtimeStats = { ...stats, aiCalls: prev + count };
        await tx.virtual_sessions.update({
          where: { id: sessionId },
          data: { stageResults: JSON.stringify(stageResults) }
        });
      });
    } catch (error) {
      // 计数失败不阻断主流程（护栏是尽力而为，宁可少计一次也不让学习卡死）
      logger.warn('[simulation-coordinator] 累计 AI 调用计数失败', { sessionId, error: String(error) });
    }
  }

  private boundTaskCompletionError(error: unknown): string {
    const message = asErrorLike(error).message || String(error || '任务完成失败');
    return message.length > 1000 ? `${message.slice(0, 997)}...` : message;
  }

  private findTaskInPath(milestones: SimulationMilestone[], taskId?: string | null) {
    if (!taskId) return null;

    for (let milestoneIdx = 0; milestoneIdx < milestones.length; milestoneIdx += 1) {
      const milestone = milestones[milestoneIdx];
      const taskIdx = (milestone?.subtasks || []).findIndex((task) => task.id === taskId);
      if (taskIdx >= 0) {
        return { milestone, milestoneIdx, task: milestone.subtasks[taskIdx], taskIdx };
      }
    }

    return null;
  }

  private buildProgressAfterTaskCompletion(milestones: SimulationMilestone[], completedTaskId: string) {
    const flattenedTasks = milestones.flatMap((milestone: SimulationMilestone, milestoneIdx: number) =>
      (milestone?.subtasks || []).map((task: SimulationTask) => ({ milestone, milestoneIdx, task }))
    );
    const completedTaskIdx = flattenedTasks.findIndex((item) => item.task.id === completedTaskId);
    const isRunnable = (item) => item.task.id !== completedTaskId && item.task.status !== 'completed';
    const nextTask = flattenedTasks.find((item, index: number) => index > completedTaskIdx && isRunnable(item))
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
      .filter((task) => task.id !== completedTaskId && task.status !== 'completed');
    return {
      isPathCompleted: false,
      currentTask: nextTask.task,
      progress: {
        currentMilestone: nextTask.milestoneIdx,
        currentMilestoneTitle: nextTask.milestone.title || null,
        currentTaskIdx: Math.max(0, runnableTasks.findIndex((task) => task.id === nextTask.task.id)),
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
    session: VirtualSessionWithProfile,
    learningState: Record<string, unknown>,
    completedTaskRuntime: Record<string, unknown>,
    nextProgress: ReturnType<SimulationOrchestrator['buildProgressAfterTaskCompletion']>,
    milestones: SimulationMilestone[],
    logs: SimulationLogEntry[]
  ): Promise<{ learningState: Record<string, unknown>; nextTaskStarted: boolean }> {
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
      phase: 'teaching-start',
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

    return { learningState: nextLearningState as Record<string, unknown>, nextTaskStarted: true };
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

  private buildLearningProgressSnapshot(milestones: SimulationMilestone[], milestoneIdx: number, taskIdx: number) {
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
  
  private async getVirtualSession(sessionId: string): Promise<VirtualSessionWithProfile> {
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
  
  private parseProfileData(profileRecord: VirtualLearnerProfileRow): VirtualLearnerProfile {
    const profileData = safeJsonParse<VirtualLearnerProfileData>(profileRecord.profile, {});
    const knownConcepts = safeJsonParse<string[]>(profileRecord.knownConcepts, []);
    const struggleConcepts = safeJsonParse<string[]>(profileRecord.struggleConcepts, []);
    const personalityTraits = safeJsonParse<PersonalityTraits>(profileRecord.personalityTraits, {});
    
    return {
      id: profileRecord.id,
      userId: profileRecord.userId,
      profile: profileData,
      learningGoal: profileRecord.learningGoal,
      knowledgeLevel: (profileRecord.knowledgeLevel || 'beginner') as VirtualLearnerProfile['knowledgeLevel'],
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
    currentStage: 'goal' | 'path' | 'teaching',
    storyContext?: SimulationContext['storyContext'],
    goalState?: SimulationContext['goalState'],
    learnerState?: Partial<LearnerLatentState>,
    knowledgeState?: KnowledgePointState[],
    learningState?: SimulationContext['learningState']
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

  private buildStoryBehaviorBias(storyContext?: SimulationContext['storyContext']): Partial<LearnerLatentState> {
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
    currentStage: 'goal' | 'path' | 'teaching'
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
    learnerState: Partial<LearnerLatentState> | undefined,
    currentStage: 'goal' | 'path' | 'teaching',
    storyContext?: SimulationContext['storyContext']
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

    if (currentStage === 'teaching') {
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
    storyContext?: SimulationContext['storyContext'];
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
    lastAssistantMessage: string;
    currentPhase: 'opening' | 'understanding' | 'proposal_evaluation';
    previousLearnerState?: Partial<LearnerLatentState>;
    goalState?: SimulationContext['goalState'];
    frictionBudget?: FrictionBudget;
    userId?: string;
  }) {
    // 长期记忆注入（目标澄清时学习者能提及过往学习经历）
    const learnerMemory = params.userId
      ? await this.buildAssistedLearnerMemory(params.userId)
      : null;
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
      learnerMemory,
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

  private resolveSimLearnerState(skillOutput: SimulatorSkillOutput, fallback: Record<string, unknown> = {}) {
    const envelope = skillOutput?.runtimeEnvelope as { contextUpdate?: { nextState?: Record<string, unknown> } } | undefined;
    const fromEnvelope = envelope?.contextUpdate?.nextState;
    if (fromEnvelope && typeof fromEnvelope === 'object') return fromEnvelope;
    if (skillOutput?.learnerState && typeof skillOutput.learnerState === 'object') {
      return skillOutput.learnerState;
    }
    return fallback || {};
  }

  private finalizeGoalLearnerState(
    profile: VirtualLearnerProfile,
    learnerState: Partial<LearnerLatentState>,
    storyContext?: SimulationContext['storyContext'],
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

  private buildGoalConcernPool(profile: VirtualLearnerProfile, goalState: SimulationContext['goalState']): GoalConcernPool {
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
    // 只取 logs 列：整行读会连带拖回 stageResults 大字段（每条日志一次，放大明显）
    const session = await prisma.virtual_sessions.findUnique({
      where: { id: sessionId },
      select: { logs: true }
    });

    if (!session) return;

    let logs: SimulationLogEntry[] = [];
    try {
      logs = JSON.parse(session.logs || '[]');
    } catch { /* 解析失败时保留默认值 */ }

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

  /**
   * 批量追加日志：一次读-改-写落多条。
   * 背景：调用方曾普遍 `for (const log of logs) await addSessionLog(...)`，
   * 每条日志都全量 parse/stringify 整个 logs 数组，形成 O(n²) 写放大
   * （单会话累计冗余写可达 MB 级）。批量入口把 n 次读写收敛为 1 次。
   */
  private async addSessionLogs(sessionId: string, entries: SimulationLogEntry[]) {
    if (!entries.length) return;
    const session = await prisma.virtual_sessions.findUnique({
      where: { id: sessionId },
      select: { logs: true }
    });
    if (!session) return;

    let logs: SimulationLogEntry[] = [];
    try {
      logs = JSON.parse(session.logs || '[]');
    } catch { /* 解析失败时保留默认值 */ }

    logs.push(...entries);

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
  
  private async updateStageResults(sessionId: string, stage: string, result: Record<string, unknown>) {
    await this.assertCurrentSessionLeaseOwned(sessionId);
    // 事务内原子读-改-写，防止并发覆盖（step 更新 goal 与 advanceToPathGeneration 更新 path 同时写入）
    await prisma.$transaction(async (tx) => {
      const session = await tx.virtual_sessions.findUnique({
        where: { id: sessionId },
        select: { stageResults: true }
      });
      if (!session) return;
      const stageResults: StageResults = safeJsonParse<StageResults>(session.stageResults, {});
      stageResults[stage] = result;
      await tx.virtual_sessions.update({
        where: { id: sessionId },
        data: {
          stageResults: JSON.stringify(stageResults),
          updatedAt: new Date()
        }
      });
    });
  }

  /**
   * 步骤回写专用：teaching 状态整包写回前，用 DB 最新值覆盖控制标志（paused/manualStop*）。
   * 背景：executeLearningStep 用步骤开始时的快照整体回写，管理员在步骤执行期间经 pause/stop
   * 旁路写入的标志会被旧快照静默抹掉（丢失更新）。此处让「最新写入的控制标志」获胜；
   * 读取失败时退回直接写入（与旧行为一致）。非原子，但窗口从「整个步骤时长」缩到毫秒级。
   */
  private async updateTeachingStatePreservingControlFlags(sessionId: string, incoming: Record<string, unknown>) {
    try {
      const session = await this.getVirtualSession(sessionId);
      const latestTeaching = this.parseStageResultsPayload(session.stageResults).teaching || {};
      const merged: Record<string, unknown> = { ...incoming };
      for (const key of ['paused', 'manualStop', 'stoppedAt', 'stoppedReason'] as const) {
        if ((latestTeaching as Record<string, unknown>)[key] !== undefined) {
          merged[key] = (latestTeaching as Record<string, unknown>)[key];
        }
      }
      await this.updateStageResults(sessionId, 'teaching', merged);
    } catch {
      await this.updateStageResults(sessionId, 'teaching', incoming);
    }
  }

  /** 上游 Learn 调用耗尽重试后的终态记录；checkpoint 恢复分支不会走这里。 */
  private async persistLearningFailure(sessionId: string, error: unknown, logs: SimulationLogEntry[]) {
    const message = this.boundTaskCompletionError(error);
    try {
      const session = await this.getVirtualSession(sessionId);
      const stageResults = this.parseStageResultsPayload(session.stageResults);
      const learning = (stageResults.teaching || {}) as Record<string, unknown>;
      const now = new Date().toISOString();
      const failedLearning: Record<string, unknown> = {
        ...learning,
        taskRuntime: {
          ...((learning.taskRuntime ?? {}) as Record<string, unknown>),
          status: 'error',
          error: message,
          failedAt: now,
          updatedAt: now
        }
      };

      await this.updateStageResults(sessionId, 'teaching', failedLearning);
      await this.updateSessionStatus(sessionId, 'failed', 'teaching');
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
      // 只写库、不推入 logs 数组：调用方随后会批量 flush logs，
      // 若这里也 push 会导致同一条失败日志重复落库
      await this.addSessionLog(sessionId, failureLog);
    } catch (persistError: unknown) {
      logger.error('[simulation-coordinator] 持久化 Learn 失败状态失败（failed 标记可能静默丢失）', {
        sessionId,
        error: asErrorLike(persistError).message || String(persistError),
        stack: persistError instanceof Error ? persistError.stack : undefined,
        sourceError: asErrorLike(error).message || String(error)
      });
    }
  }

  private async resetSessionRuntime(
    sessionId: string,
    options: {
      keepGoalConversation?: boolean;
      keepLearningPath?: boolean;
      nextStage: 'goal' | 'path' | 'teaching';
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

    const stageResults: StageResults = safeJsonParse<StageResults>(session.stageResults, {})

    for (const key of options.removeStageResults || []) {
      delete stageResults[key]
    }

    const logs: SimulationLogEntry[] = safeJsonParse<SimulationLogEntry[]>(session.logs, [])

    const logPhasesToRemove = new Set(options.logPhasesToRemove || [])
    const nextLogs = logPhasesToRemove.size
      ? logs.filter((entry) => !logPhasesToRemove.has(String(entry?.phase || '')))
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

  private parseStageResultsPayload(raw: string | null | undefined): StageResults {
    try {
      return (JSON.parse(raw || '{}') || {}) as StageResults
    } catch {
      return {}
    }
  }

  private async completeCheckpointedSimulationTask(
    sessionId: string,
    session: VirtualSessionWithProfile,
    learningState: Record<string, unknown>,
    milestones: SimulationMilestone[],
    taskRuntime: Record<string, unknown>,
    logs: SimulationLogEntry[]
  ) {
    const taskMatch = this.findTaskInPath(milestones, typeof taskRuntime.taskId === 'string' ? taskRuntime.taskId : undefined);
    if (!taskMatch) return null;

    let taskCompletionResult: Awaited<ReturnType<typeof learningService.completeTask>> | undefined;
    try {
      await this.assertCurrentSessionLeaseOwned(sessionId);
      taskCompletionResult = await learningService.completeTask({
        taskId: taskMatch.task.id,
        userId: session.userId,
        actualMinutes: taskMatch.task.estimatedMinutes || 30,
        notes: '虚拟学习者完成当前 task 的教学会话',
        rating: 5
      });
      // 记忆回写：画像概念 + 成果物登记（best-effort，失败不阻断）
      await this.persistAssistedLearnerMemory(sessionId, session, taskMatch.task);
    } catch (error: unknown) {
      const boundedError = this.boundTaskCompletionError(error);
      const updatedAt = new Date().toISOString();
      await this.updateStageResults(sessionId, 'teaching', {
        ...learningState,
        teachingRevision: taskRuntime.teachingRevision ?? learningState.teachingRevision,
        taskRuntime: {
          ...taskRuntime,
          status: 'task_completion_pending',
          error: boundedError,
          updatedAt
        }
      }).catch((checkpointError: unknown) => {
        logger.warn('[simulation-coordinator] 更新任务完成待重试错误失败，保留原 pending checkpoint', {
          sessionId,
          error: asErrorLike(checkpointError).message || String(checkpointError)
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
      await this.addSessionLogs(sessionId, logs).catch((logError: unknown) => {
        logger.warn('[simulation-coordinator] 记录任务完成待重试日志失败', {
          sessionId,
          error: asErrorLike(logError).message || String(logError)
        });
      });

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
    const latestLearningState = (latestStageResults.teaching || learningState) as Record<string, unknown>;
    const baseCompletedLearningState: Record<string, unknown> = {
      ...latestLearningState,
      teachingRevision: taskRuntime.teachingRevision ?? learningState.teachingRevision,
      ...nextProgress.progress,
      taskRuntime: {
        ...taskRuntime,
        status: 'completed',
        reason: ((taskRuntime.closureDecision && typeof taskRuntime.closureDecision === 'object' ? taskRuntime.closureDecision : {}) as Record<string, unknown>).reason || taskRuntime.reason || '教学系统与 AI 学生共同判定当前 task 已完成',
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
          teaching: baseCompletedLearningState
        }),
        currentTaskId: nextProgress.progress.currentTaskId,
        completedTasks: currentProgress.completedTasks,
        totalTasks: currentProgress.totalTasks,
        status: nextProgress.isPathCompleted ? 'completed' : undefined,
        currentStage: nextProgress.isPathCompleted ? 'teaching' : undefined,
        updatedAt: new Date()
      }
    });

    let completedLearningState: Record<string, unknown> = baseCompletedLearningState;
    let nextTaskStarted = false;
    if (!nextProgress.isPathCompleted) {
      try {
        const transition = await this.transitionToNextLearningTask(
          sessionId,
          session,
          baseCompletedLearningState,
          (baseCompletedLearningState.taskRuntime ?? {}) as Record<string, unknown>,
          nextProgress,
          milestones,
          logs
        );
        completedLearningState = transition.learningState;
        nextTaskStarted = transition.nextTaskStarted;
        await this.updateStageResults(sessionId, 'teaching', completedLearningState);
        await this.assertCurrentSessionLeaseOwned(sessionId);
        await prisma.virtual_sessions.update({
          where: { id: sessionId },
          data: {
            currentTaskId: typeof completedLearningState.currentTaskId === 'string' ? completedLearningState.currentTaskId : null,
            completedTasks: currentProgress.completedTasks,
            totalTasks: currentProgress.totalTasks,
            status: 'running',
            currentStage: 'teaching',
            updatedAt: new Date()
          }
        });
      } catch (error: unknown) {
        const rawMessage = this.boundTaskCompletionError(error);
        // 预算耗尽且本课已完成：文案明确「本课已学完、调高预算后可续传」，
        // 避免用户误以为学习失败；续传从下一课继续，不丢本课进度。
        const isBudget = /retry_budget_exhausted|budget_exhausted/i.test(rawMessage);
        const errorMessage = isBudget
          ? `本课已完成，但会话 AI 调用预算已耗尽，无法启动下一课。可在画像/故事预算中调高「会话 AI 调用上限」后重试续传（从下一课继续，不丢本课进度）。`
          : rawMessage;
        completedLearningState = {
          ...baseCompletedLearningState,
          taskRuntime: {
            ...((baseCompletedLearningState.taskRuntime ?? {}) as Record<string, unknown>),
            status: 'next_task_start_failed',
            error: errorMessage,
            updatedAt: new Date().toISOString()
          }
        };
        await this.updateStageResults(sessionId, 'teaching', completedLearningState);
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
  private getSessionFrictionBudget(session: VirtualSessionWithProfile): FrictionBudget {
    const stageResults = this.parseStageResultsPayload(session?.stageResults)
    return normalizeFrictionBudget(stageResults?.simulationConfig?.frictionBudget)
  }

  private getSessionPromptOverrides(session: VirtualSessionWithProfile): { goalAgent?: string; pathAgent?: string } | undefined {
    const overrides = this.parseStageResultsPayload(session?.stageResults)?.systemPromptOverrides;
    if (!overrides || typeof overrides !== 'object') return undefined;
    const overridesRecord = overrides as Record<string, unknown>;

    const goalAgent = typeof overridesRecord.goalAgent === 'string' ? overridesRecord.goalAgent.trim() : '';
    const pathAgent = typeof overridesRecord.pathAgent === 'string' ? overridesRecord.pathAgent.trim() : '';
    return goalAgent || pathAgent ? { goalAgent: goalAgent || undefined, pathAgent: pathAgent || undefined } : undefined;
  }

  private parseStoryContextFromStageResults(stageResults: StageResults): SimulationContext['storyContext'] {
    return (stageResults?.story || null) as SimulationContext['storyContext'];
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
      const initialStageResults: StageResults = safeJsonParse<StageResults>(session.stageResults, {});
      const storyContext = this.parseStoryContextFromStageResults(initialStageResults);
      // 管理面终态（批量终止/僵尸回收/失败）的会话不可再推进：防止执行器复活会话
      if (session.status === 'failed' || session.status === 'abandoned') {
        throw new Error(`会话已终止（${session.status}），无法继续执行`);
      }
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
        // 开场模拟者调用同样计入会话 AI 调用预算（此前旁路漏计，管理员手动
        // 「推进一步」开新 Goal 对话时每次白嫖 1 次调用）
        const openingResult = await this.retryLearnUpstream(input.sessionId, 'simulate-goal-opening', () =>
          this.simulateGoalLearnerReply({
            profile,
            storyContext,
            conversationHistory: [],
            lastAssistantMessage: '',
            currentPhase: 'opening',
            previousLearnerState: undefined,
            goalState: undefined,
            userId: input.userId,
            frictionBudget: this.getSessionFrictionBudget(session)
          })
        );

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
        // goal agent 开场回应是真实 LLM 调用，计入会话 AI 调用预算
        const goalResult = await this.retryLearnUpstream(input.sessionId, 'goal-opening-turn', () =>
          goalConversationService.startConversation(
            input.userId,
            openingReply,
            { systemPromptOverrides: this.getSessionPromptOverrides(session) }
          )
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
        conversationHistory = rawMessages.map((m: { role?: string; content?: unknown }) => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          content: this.sanitizeVisibleDialogue(typeof m.content === 'string' ? m.content : '')
        })).filter((m: { role: 'user' | 'assistant'; content: string }) => !!m.content);
      } catch { /* 解析失败时保留默认值 */ }
      
      const lastAssistantMessage = conversationHistory.length > 0
        ? conversationHistory.filter(m => m.role === 'assistant').pop()?.content || ''
        : conversationHistory.filter(m => m.role !== 'user').pop()?.content || '';
      
      const goalState: SimulationContext['goalState'] = safeJsonParse<SimulationContext['goalState']>(conversation.collectedData, {});

      const stageResults: StageResults = safeJsonParse<StageResults>(session.stageResults, {});

      const existingGoalState = (stageResults.goal || {}) as Record<string, unknown>;
      const activeStoryContext = this.parseStoryContextFromStageResults(stageResults);
      const concernPool: GoalConcernPool = (existingGoalState.concernPool as GoalConcernPool | undefined) || this.buildGoalConcernPool(profile, goalState);
      const disclosedConcerns = (existingGoalState.disclosedConcerns || []) as string[];
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
        stageResults.goal?.learnerState as Partial<LearnerLatentState> | undefined,
        stageResults.goal?.knowledgeState as KnowledgePointState[] | undefined,
        undefined
      );
      
      const virtualReplyStart = Date.now();
      const virtualReplyResult = await this.retryLearnUpstream(input.sessionId, 'simulate-goal-reply', () =>
        this.simulateGoalLearnerReply({
          profile,
          storyContext: activeStoryContext,
          conversationHistory,
          lastAssistantMessage,
          currentPhase: this.mapGoalStageToLearnerPhase(goalState?.stage || existingGoalState.stage as string | undefined),
          previousLearnerState: stageResults.goal?.learnerState,
          goalState,
          userId: input.userId,
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
        (existingGoalState.finalStage as string | undefined) || (existingGoalState.stage as string | undefined) || goalState?.stage
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

      await this.addSessionLogs(input.sessionId, logs);

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
    } catch (error: unknown) {
      const durationMs = Date.now() - startTime;
      
      logger.error('[simulation-coordinator] 单步模拟失败', {
        sessionId: input.sessionId,
        error: asErrorLike(error).message,
        durationMs
      });
      
      logs.push({
        timestamp: new Date().toISOString(),
        phase: 'error',
        durationMs,
        details: {
          error: asErrorLike(error).message
        }
      });
      
      await this.addSessionLog(input.sessionId, logs[logs.length - 1]);
      
      return {
        success: false,
        virtualUserReply: '',
        currentStage: 'goal',
        goalReady: false,
        logs,
        error: asErrorLike(error).message
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
            } catch (err: unknown) {
              logger.warn('[simulation-coordinator] 自动启动 Learn 失败', { error: asErrorLike(err).message });
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
   * 诚实返回：任何阶段未推进到位都返回 error，不静默报 success（2026-08-22 修复）。
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
            autoAdvanceToLearning: false
          }
        );
        summary.goalRounds = goalResults.length;
        const lastGoal = goalResults[goalResults.length - 1];
        // 诚实返回：Goal 未在预算内收敛同样报错（不再静默跳到后续阶段）
        if (!lastGoal?.goalReady) {
          summary.error = lastGoal?.error || `Goal 阶段在 ${maxRounds} 轮内未收敛，请再次运行或调大 maxRounds`;
          return summary;
        }
      }

      // refresh session state
      const updatedAfterGoal = await this.getVirtualSession(sessionId);
      summary.finalStage = updatedAfterGoal.currentStage;
      summary.pathGenerated = !!updatedAfterGoal.learningPathId;

      // ========== Phase B: Path -> Learn bridge ==========
      if (updatedAfterGoal.currentStage === 'goal') {
        // Goal 已收敛但未进入 Path 生成（advance 未成功）——显式失败，不等候
        summary.error = 'Goal 已收敛但未进入 Path 生成，请检查路径生成状态或手动推进';
        return summary;
      }
      if (updatedAfterGoal.currentStage !== 'teaching') {
        // 等待 Path 生成完成（多点几分钟是正常的，黑盒实测 2-3 分钟）
        const waitResult = await this.waitForPathReady(sessionId, updatedAfterGoal.learningPathId);
        if (!waitResult.ready) {
          summary.error = waitResult.reason || '学习路径未就绪';
          return summary;
        }
        summary.pathGenerated = true;
        try {
          const review = await this.resolvePathReview(sessionId, {
            startLearning: options.autoAdvanceToLearning ?? false
          });
          if (!review.success) {
            summary.error = review.error || 'Path 评审失败';
            return summary;
          }
        } catch (err: unknown) {
          logger.warn('[simulation-coordinator] 启动 Learn 失败', { error: asErrorLike(err).message });
          summary.error = asErrorLike(err).message || '启动 Learn 失败';
          return summary;
        }
      }

      // ========== Phase C: Learn loop with continueOnTaskComplete ==========
      const refreshed = await this.getVirtualSession(sessionId);
      if (refreshed.currentStage !== 'teaching') {
        summary.finalStage = refreshed.currentStage;
        // 诚实返回：未能进入教学阶段 = 未完成，不允许 success=true 静默提前收工
        summary.error = `未能进入教学阶段（当前阶段：${refreshed.currentStage}），请检查路径生成或手动推进`;
        return summary;
      }

      // 边界预算按 path 实际任务数计算（不再用 maxMilestones*3 的下限截断：
      // 多任务 path（如 21 任务）一次点击必须能跑完，否则静默停在半路）
      let totalTasksBudget = 1;
      try {
        const milestones = refreshed.learningPathId
          ? await prisma.milestones.findMany({
              where: { learningPathId: refreshed.learningPathId },
              select: { subtasks: { select: { id: true } } }
            })
          : [];
        const taskCount = milestones.reduce((sum, m) => sum + m.subtasks.length, 0);
        totalTasksBudget = taskCount > 0 ? taskCount : 1;
      } catch {
        totalTasksBudget = 1;
      }
      const maxTaskBoundaries = continueOnTaskComplete ? totalTasksBudget + 2 : 1;

      let totalLearningSteps = 0;
      let taskBoundaries = 0;
      let lastAfter: VirtualSessionWithProfile | null = null;
      while (taskBoundaries < maxTaskBoundaries) {
        const learnResult = await this.executeAutoLearning(sessionId, { maxMilestones });
        totalLearningSteps += learnResult.totalSteps || 0;

        // refresh
        const after = await this.getVirtualSession(sessionId);
        lastAfter = after;
        summary.finalStage = after.currentStage;

        if (after.status === 'completed') {
          summary.isPathCompleted = true;
          break;
        }
        if (after.status === 'failed' || after.status === 'abandoned') {
          summary.error = learnResult?.error || `学习被中止（${after.status}）`;
          break;
        }
        if (!continueOnTaskComplete) {
          break;
        }
        if (!learnResult.success) {
          summary.error = learnResult.error || '自动学习失败';
          break;
        }

        // 无进展（0 回合）：区分暂停与真无进展，都显式说明
        if ((learnResult.totalSteps || 0) === 0) {
          const paused = this.parseStageResultsPayload(after.stageResults).teaching?.paused === true;
          summary.error = paused ? '学习已暂停，请先恢复再继续' : '自动学习无进展（0 回合），停止推进';
          break;
        }

        taskBoundaries += 1;
      }

      summary.learningSteps = totalLearningSteps;
      // 边界预算耗尽仍未完成：诚实报错（原实现 success=true 静默收工）
      if (!summary.isPathCompleted && !summary.error) {
        const doneTasks = lastAfter?.completedTasks ?? 0;
        const totalTasks = lastAfter?.totalTasks ?? totalTasksBudget;
        summary.error = `任务边界预算（${maxTaskBoundaries} 份任务）耗尽仍未完成路径（已完成 ${doneTasks}/${totalTasks}）`;
      }
      summary.success = !summary.error;
      return summary;
    } catch (error: unknown) {
      logger.error('[simulation-coordinator] 一键全流程失败', { sessionId, error });
      summary.error = asErrorLike(error).message || 'unknown';
      return summary;
    }
  }

  /**
   * 等待学习路径生成就绪：轮询 path 的里程碑落地（最多 timeoutMs）。
   * Goal 收敛后 path 生成是异步任务，实测需要 2-3 分钟；
   * 黑盒/辅助模式均应等待而非让用户反复点击空转。
   */
  async waitForPathReady(
    sessionId: string,
    learningPathId: string | null,
    timeoutMs = 600_000
  ): Promise<{ ready: boolean; reason?: string }> {
    const deadline = Date.now() + timeoutMs;
    let pathId = learningPathId;
    while (Date.now() < deadline) {
      if (!pathId) {
        const s = await this.getVirtualSession(sessionId);
        pathId = s.learningPathId || null;
        if (!pathId) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          continue;
        }
      }
      const milestoneCount = await prisma.milestones.count({ where: { learningPathId: pathId } });
      if (milestoneCount > 0) {
        // 关键：里程碑存在 ≠ 可启动。任务（subtasks）可能在里程碑写入后才插入，
        // 过早 ready 会让 startLearningPhase 报「第一个里程碑没有可用任务」。
        // 必须等到至少一个里程碑下有非 completed 的可启动任务。
        const firstRunnable = await prisma.subtasks.findFirst({
          where: {
            milestones: { learningPathId: pathId },
            status: { not: 'completed' }
          },
          select: { id: true }
        });
        if (firstRunnable) return { ready: true };
      }

      const path = await prisma.learning_paths.findUnique({
        where: { id: pathId },
        select: { status: true }
      });
      if (path && !['active', 'generating'].includes(path.status)) {
        return { ready: false, reason: `路径生成未产出里程碑（path status=${path.status}）` };
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    return { ready: false, reason: '等待路径生成超时，请检查路径生成任务' };
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
      
      const collectedData: Record<string, unknown> = safeJsonParse<Record<string, unknown>>(conversation.collectedData, {});
      
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
        conversationHistory: (Array.isArray(collectedData.messages) ? collectedData.messages : []) as ConversationHistoryItem[],
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
          }).catch((err: unknown) => {
            logger.warn('[simulation-coordinator] 回写 goal_conversations.learningPathId 失败', {
              sessionId,
              learningPathId,
              error: asErrorLike(err).message || String(err)
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
    } catch (error: unknown) {
      logger.error('[simulation-coordinator] 路径生成失败', {
        sessionId,
        error: asErrorLike(error).message
      });
      
      return {
        success: false,
        error: asErrorLike(error).message
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

      const stageResults: StageResults = safeJsonParse<StageResults>(session.stageResults, {});
      
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
      const pathLearnerMemory = await this.buildAssistedLearnerMemory(session.userId);
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
        learnerMemory: pathLearnerMemory,
        learnerState: this.mergeLearnerState(profile, (stageResults.path_review?.learnerState || stageResults.goal?.learnerState) as Partial<LearnerLatentState> | undefined, 'path', this.parseStoryContextFromStageResults(stageResults)),
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
    } catch (error: unknown) {
      logger.error('[simulation-coordinator] 路径评审失败', {
        sessionId,
        error: asErrorLike(error).message
      });
      
      return {
        success: false,
        error: asErrorLike(error).message
      };
    }
  }

  /** 人工确认接受评审结论。只改评审状态，不自动启动 Learn。 */
  async acceptPathReview(sessionId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const session = await this.getVirtualSession(sessionId);
      const stageResults = this.parseStageResultsPayload(session.stageResults);
      const pathReview = (stageResults.path_review || {}) as Record<string, unknown>;

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
    } catch (error: unknown) {
      return { success: false, error: asErrorLike(error).message };
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

      const feedback = [pathReview.reaction, ...(Array.isArray(pathReview.visibleRequestedChanges) ? pathReview.visibleRequestedChanges : [])]
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
    } catch (error: unknown) {
      const latest = this.parseStageResultsPayload((await this.getVirtualSession(sessionId)).stageResults);
      await this.updateStageResults(sessionId, 'path_review', {
        ...(latest.path_review || pathReview),
        status: 'failed',
        error: asErrorLike(error).message || '重规划失败'
      });
      return { success: false, error: asErrorLike(error).message || '重规划失败' };
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
        details: { output: { from: 'path', to: 'teaching', reason: 'path-review-accepted', learningPathId: session.learningPathId } }
      });
      const learning = await this.startLearningPhase(sessionId);
      return {
        success: learning.success,
        decision: review.decision,
        currentStage: learning.success ? 'teaching' : 'path',
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
    milestones?: SimulationMilestone[];
    selectedTaskId?: string;
    error?: string;
  }> {
    try {
      const session = await this.getVirtualSession(sessionId);
      
      const sessionStageResults = this.parseStageResultsPayload(session.stageResults);
      if (session.status === 'failed' || sessionStageResults.teaching?.manualStop === true) {
        throw new Error('学习会话已停止或失败，请先重新开始学习（restartLearningPhase）');
      }

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
        const selectedTask = selectedMilestone?.subtasks?.find((task) => task.id === options.taskId);

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
        'teaching',
        session.goalConversationId || undefined,
        session.learningPathId
      );
      
      await this.addSessionLog(sessionId, {
        timestamp: new Date().toISOString(),
        phase: 'teaching-start',
        details: {
          output: {
            teachingSessionId: teachingSession.sessionId,
            welcomeMessage: teachingSession.welcomeMessage,
            currentMilestone: firstMilestone.title,
            currentTask: firstTask.title
          }
        }
      });
      
      await this.updateStageResults(sessionId, 'teaching', {
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
    } catch (error: unknown) {
      logger.error('[simulation-coordinator] 学习阶段启动失败', {
        sessionId,
        error: asErrorLike(error).message
      });
      
      return {
        success: false,
        error: asErrorLike(error).message
      };
    }
  }

  /**
   * 学习路径全部任务完成后的公共收口：写终态 + 生成 wrapup + 记录阶段日志。
   * executeLearningStep 的各完成分支共用，避免「已完成但会话仍 running/teaching」的悬挂状态。
   */
  private async finalizePathCompletion(sessionId: string, logs: SimulationLogEntry[]) {
    await this.updateSessionStatus(sessionId, 'completed', 'teaching');

    logs.push({
      timestamp: new Date().toISOString(),
      phase: 'stage-transition',
      details: {
        output: {
          from: 'teaching',
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
    } catch (err: unknown) {
      logger.warn('[simulation-coordinator] 生成 wrapup 失败', { sessionId, error: asErrorLike(err).message });
      logs.push({
        timestamp: new Date().toISOString(),
        phase: 'error',
        details: {
          error: asErrorLike(err).message || 'wrapup generation failed'
        }
      });
    }
  }

  /**
   * 记忆引擎 M2：教学回合后按知识看板状态增量写 memory_traces。
   * best-effort——失败不阻断教学回合；修复「卡死任务期间 learner 状态零落库」。
   */
  private persistKnowledgeState(userId: string, knowledgePoints: Array<{ name: string; status: string; progress: number }>): void {
    if (!userId || !Array.isArray(knowledgePoints) || !knowledgePoints.length) return;
    const outcomes = knowledgePoints
      .filter((kp) => kp && String(kp.name || '').trim())
      .map((kp) => ({
        name: String(kp.name).trim(),
        status: (['pending', 'learning', 'mastered', 'review'].includes(kp.status)
          ? kp.status
          : 'learning') as 'pending' | 'learning' | 'mastered' | 'review',
        progress: Number.isFinite(Number(kp.progress)) ? Number(kp.progress) : 0,
      }));
    if (!outcomes.length) return;
    memoryTraceService.recordSessionOutcome(userId, outcomes, 'derived').catch((error) => {
      logger.warn('[simulation-coordinator] 教学回合记忆痕迹回写失败', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  /**
   * 组装 assisted 模式的学习者记忆（learnerMemory 用）：已掌握/到期复习/易混淆 + 最近成果。
   */
  private async buildAssistedLearnerMemory(
    userId: string
  ): Promise<{
    mastered: string[];
    dueReview: string[];
    struggling: string[];
    recentCompleted: string[];
  } | null> {
    const memory = await buildLearnerMemorySnapshot(userId, { limit: 8 }).catch(() => null);
    if (!memory) return null;
    return {
      mastered: memory.mastered.map((item) => item.name),
      dueReview: memory.dueReview.map((item) => item.name),
      struggling: memory.struggling.map((item) => item.name),
      recentCompleted: memory.recentTaskTitles,
    };
  }

  /**
   * 组装 assisted 模式的学习者记忆快照（knowledgeSnapshot 用）：
   * 当前任务概念为锚 + 画像已掌握/易混淆 + 到期复习点 + 最近成果。
   */
  private async buildAssistedKnowledgeSnapshot(
    userId: string,
    currentTask: SimulationTask | null,
    currentMilestone: SimulationMilestone | null
  ): Promise<Array<{ name: string; status: string; progress: number }>> {
    const memory = await buildLearnerMemorySnapshot(userId, { limit: 6 }).catch(() => null);
    const result: Array<{ name: string; status: string; progress: number }> = [];
    const anchor = currentTask?.linkedConcept || currentMilestone?.coreConceptId
      || currentTask?.title || currentMilestone?.title || '当前任务概念';
    result.push({ name: String(anchor), status: 'learning', progress: 40 });
    for (const item of memory?.mastered || []) result.push({ name: item.name, status: 'mastered', progress: 100 });
    for (const item of memory?.dueReview || []) result.push({ name: item.name, status: 'review', progress: item.progress });
    for (const item of memory?.struggling || []) result.push({ name: item.name, status: 'learning', progress: 30 });
    return result.slice(0, 8);
  }

  /**
   * assisted 模式任务结算后的记忆回写：画像概念（统一出口）+ 成果物登记。
   * best-effort——失败不阻断任务完成。
   */
  private async persistAssistedLearnerMemory(
    sessionId: string,
    session: VirtualSessionWithProfile,
    task: SimulationTask
  ): Promise<void> {
    try {
      const stageResults = this.parseStageResultsPayload(session.stageResults);
      const learningState = (stageResults.teaching || {}) as Record<string, unknown>;
      const teachingSessionId = typeof learningState.teachingSessionId === 'string' ? learningState.teachingSessionId : null;
      let knowledgePoints: LessonKnowledgePoint[] = [];
      if (teachingSessionId) {
        const teaching = await prisma.teaching_sessions.findUnique({ where: { id: teachingSessionId } }).catch(() => null);
        knowledgePoints = Array.isArray(teaching?.knowledgeState)
          ? (teaching.knowledgeState as LessonKnowledgePoint[]).filter(
              (kp) => kp && typeof kp.name === 'string' && kp.name.trim()
            )
          : [];
      }
      // 内部提炼：用模拟器自述状态（assisted 的收束轮 learnerState + learnerFeedback）
      const learnerState = (learningState.learnerState && typeof learningState.learnerState === 'object'
        ? learningState.learnerState : {}) as Record<string, any>;
      const feedback = (learningState.latestLearnerFeedback && typeof learningState.latestLearnerFeedback === 'object'
        ? learningState.latestLearnerFeedback : {}) as Record<string, any>;
      const selfState: SelfReportedLearnerState | null = {
        conceptName: task.linkedConcept || task.title || null,
        conceptualMastery: typeof learnerState.conceptualMastery === 'number' ? learnerState.conceptualMastery : null,
        taskUnderstanding: typeof learnerState.taskUnderstanding === 'number' ? learnerState.taskUnderstanding : null,
        proceduralMastery: typeof learnerState.proceduralMastery === 'number' ? learnerState.proceduralMastery : null,
        selfReportedTaskDone: typeof feedback.selfReportedTaskDone === 'boolean' ? feedback.selfReportedTaskDone : null,
        confidence: typeof feedback.confidence === 'number' ? feedback.confidence : null,
        wantsMoreHelp: typeof feedback.wantsMoreHelp === 'boolean' ? feedback.wantsMoreHelp : null,
        remainingBlockers: Array.isArray(feedback.remainingBlockers) ? feedback.remainingBlockers : null,
        wantsHint: typeof learnerState.wantsHint === 'boolean' ? learnerState.wantsHint : null,
      };
      // 记忆提炼 skill（LLM 主路径，失败走确定性 fallback）
      const curated = await this.runAssistedMemoryCurator(session, learningState, task);
      const effectiveSelfState: SelfReportedLearnerState | null = curated
        ? {
            ...(selfState || {}),
            conceptName: curated.masteredConcepts[0]?.name || curated.struggleConcepts[0]?.name
              || selfState?.conceptName || task.title || null,
            conceptualMastery: curated.masteredConcepts.length > 0 ? 0.85 : selfState?.conceptualMastery ?? null,
            selfReportedTaskDone: curated.masteredConcepts.length > 0 ? true : selfState?.selfReportedTaskDone ?? null,
            remainingBlockers: curated.struggleConcepts.length > 0
              ? curated.struggleConcepts.map((s) => s.blocker).filter(Boolean)
              : selfState?.remainingBlockers || null,
          }
        : selfState;
      await writeProfileConceptsAfterLesson(session.userId, knowledgePoints, { source: 'assisted', selfState: effectiveSelfState });
      await recordCompletedArtifact({
        userId: session.userId,
        taskId: task.id,
        taskTitle: task.title || '当前任务',
        artifactType: typeof task.taskType === 'string' ? task.taskType : null,
        deliverable: typeof task.acceptanceCriteria === 'string' ? task.acceptanceCriteria : null,
        knowledgePoints,
        selfState: effectiveSelfState,
        memoryDelta: curated?.memoryDelta || null,
        memoryCurated: curated ? {
          mastered: curated.masteredConcepts.map((m) => m.name),
          struggling: curated.struggleConcepts.map((s) => s.name),
          selfCalibration: curated.selfCalibration,
        } : undefined,
        milestoneTitle: null,
      });
    } catch (error) {
      logger.warn('[simulation-coordinator] 虚拟学习者记忆回写失败（不影响任务完成）', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** assisted 的记忆提炼 skill 调用（LLM 主路径；失败返回 null 走 fallback） */
  private async runAssistedMemoryCurator(
    session: VirtualSessionWithProfile,
    learningState: Record<string, unknown>,
    task: SimulationTask
  ): Promise<{
    masteredConcepts: Array<{ name: string; evidence: string; confidence: number }>;
    struggleConcepts: Array<{ name: string; blocker: string; severity: string }>;
    selfCalibration: string;
    memoryDelta: string;
  } | null> {
    try {
      const profile = session.virtual_learner_profiles;
      if (!profile) return null;
      const persona = {
        ...safeJsonParse<Record<string, any>>(profile.profile, {}),
        learningGoal: profile.learningGoal,
      };
      // 从 conversationHistory 构建回合序列
      const history = Array.isArray(learningState.conversationHistory) ? learningState.conversationHistory : [];
      const turnSequence = history.slice(-24).map((m: any, index: number) => ({
        turn: index + 1,
        reply: typeof m.content === 'string' ? m.content : '',
        emotion: null,
        learnerState: undefined,
        learnerFeedback: undefined,
        role: m.role || 'learner',
      }));
      const existing = await buildLearnerMemorySnapshot(session.userId, { limit: 30 }).catch(() => null);
      const result = await executeSkill(virtualLearnerMemoryCuratorDefinition, {
        persona,
        turnSequence,
        currentTask: {
          title: task.title || null,
          linkedConcept: task.linkedConcept || null,
          acceptanceCriteria: typeof task.acceptanceCriteria === 'string' ? task.acceptanceCriteria : null,
        },
        existingKnown: existing?.mastered.map((m) => m.name) || [],
        existingStruggle: existing?.struggling.map((m) => m.name) || [],
      });
      if (!result.success || !result.output) return null;
      const output = result.output as any;
      return {
        masteredConcepts: Array.isArray(output.masteredConcepts) ? output.masteredConcepts : [],
        struggleConcepts: Array.isArray(output.struggleConcepts) ? output.struggleConcepts : [],
        selfCalibration: typeof output.selfCalibration === 'string' ? output.selfCalibration : '',
        memoryDelta: typeof output.memoryDelta === 'string' ? output.memoryDelta : '',
      };
    } catch (error) {
      logger.warn('[simulation-coordinator] 记忆提炼 skill 调用失败，走确定性 fallback', {
        sessionId: session.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * 任务完成后回写画像字段：掌握的概念 → knownConcepts，仍在学/需复习 → struggleConcepts。
   * best-effort——失败不阻断；修复「画像字段整个学习过程不更新」。
   */
  private async persistProfileConcepts(sessionId: string, userId: string, knowledgePoints: Array<{ name: string; status: string }>): Promise<void> {
    if (!userId || !Array.isArray(knowledgePoints) || !knowledgePoints.length) return;
    try {
      const profile = await prisma.virtual_learner_profiles.findUnique({ where: { userId } });
      if (!profile) return;
      const mastered = new Set<string>();
      const struggling = new Set<string>();
      for (const kp of knowledgePoints) {
        const name = String(kp?.name || '').trim();
        if (!name) continue;
        if (kp.status === 'mastered') mastered.add(name);
        else if (kp.status === 'review' || kp.status === 'learning' || kp.status === 'pending') struggling.add(name);
      }
      const profileData = safeJsonParse<Record<string, any>>(profile.profile, {});
      const knownConcepts = [...new Set([...(profileData.knownConcepts || []), ...mastered])];
      const struggleConcepts = [...new Set([...(profileData.struggleConcepts || []), ...struggling].filter((c) => !mastered.has(c)))];
      if (knownConcepts.length || struggleConcepts.length) {
        await prisma.virtual_learner_profiles.update({
          where: { userId },
          data: {
            profile: JSON.stringify({
              ...profileData,
              knownConcepts,
              struggleConcepts,
            }),
            knownConcepts: JSON.stringify(knownConcepts),
            struggleConcepts: JSON.stringify(struggleConcepts),
            updatedAt: new Date(),
          },
        });
        logger.info('[simulation-coordinator] 画像概念字段已回写', {
          sessionId,
          userId,
          known: knownConcepts.length,
          struggle: struggleConcepts.length,
        });
      }
    } catch (error) {
      logger.warn('[simulation-coordinator] 画像字段回写失败', {
        sessionId,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * 课时闸门：同一 task 的回合数硬上限。取三者的最大值——
   * - LEARN_TASK_TURN_BUDGET（默认 40）：未配置时的兜底，防手动单步无限拖堂
   * - authorizedTurns（executeAutoLearning 的 maxTurns）：驾驶舱「回合上限」本次输入
   * - 会话生效回合上限（autopilot.maxTurns ?? simulationConfig.turnCapPerLesson）：画像偏好/自动驾驶透传
   * 任一来源调高即放宽，避免「配置 60 却在第 41 回合被默认闸门提前终态化」。
   */
  private resolveLearnTurnBudget(stageResults: StageResults, authorizedTurns?: number): number {
    const simConfig = (stageResults.simulationConfig || {}) as Record<string, unknown>;
    const autopilotState = (stageResults.autopilot || {}) as Record<string, unknown>;
    const candidates = [LEARN_TASK_TURN_BUDGET];
    const authorized = Number(authorizedTurns);
    if (Number.isFinite(authorized) && authorized > 0) candidates.push(Math.min(100, Math.round(authorized)));
    const sessionCap = Number(autopilotState.maxTurns ?? simConfig.turnCapPerLesson);
    if (Number.isFinite(sessionCap) && sessionCap > 0) candidates.push(Math.min(100, Math.round(sessionCap)));
    return Math.max(...candidates);
  }

  async executeLearningStep(sessionId: string, options: { turnBudget?: number } = {}): Promise<{
    success: boolean;
    userMessage?: string;
    aiResponse?: string;
    milestoneProgress?: Record<string, unknown>;
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
      
      const stageResults: StageResults = this.parseStageResultsPayload(session.stageResults)

      const learningState = (stageResults.teaching || {}) as TeachingState;
      if (learningState.manualStop || session.status === 'failed' || session.status === 'abandoned') {
        return {
          success: false,
          error: learningState.stoppedReason ? `学习已停止: ${learningState.stoppedReason}` : `学习已停止（${session.status}）`
        }
      }
      // 冻结语义：暂停期间手动单步同样拒绝（拍板 2026-08-21）——
      // 「暂停」的管理员预期是会话完全静止，而非仅停自动驾驶
      if (learningState.paused === true) {
        return {
          success: false,
          error: '会话已暂停：先恢复（▶ 继续）再执行学习步骤'
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
      
      const milestones = (Array.isArray(learningPath.milestones) ? learningPath.milestones : []) as SimulationMilestone[];
      const taskRuntime = (learningState.taskRuntime || {}) as Record<string, unknown>;
      const runtimeTaskMatch = this.findTaskInPath(milestones, typeof taskRuntime.taskId === 'string' ? taskRuntime.taskId : undefined);

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
          taskRuntime.teachingSessionId as string,
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
          await this.updateStageResults(sessionId, 'teaching', recoveredLearningState);
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
            taskId: learningState.currentTaskId || undefined
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
          ? this.buildProgressAfterTaskCompletion(milestones, taskRuntime.taskId as string)
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
        await this.finalizePathCompletion(sessionId, logs);
        await this.addSessionLogs(sessionId, logs).catch((logError: unknown) => {
          logger.warn('[simulation-coordinator] 记录学习完成日志失败', {
            sessionId,
            error: asErrorLike(logError).message || String(logError)
          });
        });
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
          await this.finalizePathCompletion(sessionId, logs);
          await this.addSessionLogs(sessionId, logs).catch((logError: unknown) => {
            logger.warn('[simulation-coordinator] 记录学习完成日志失败', {
              sessionId,
              error: asErrorLike(logError).message || String(logError)
            });
          });
          return {
            success: true,
            isPathCompleted: true,
            logs
          };
        }
        
        await this.updateTeachingStatePreservingControlFlags(sessionId, {
          ...learningState,
          ...this.buildLearningProgressSnapshot(milestones, nextMilestoneIdx, 0)
        });

        return await this.executeLearningStep(sessionId, options);
      }

      // 课时预算（时间盒）：同一 task 回合数超限仍未双方收束 → 按「超时跳课」处理：
      // 标记本课完成（timebox skip），自动推进到下一课，而不是卡住本课等待人工干预。
      // 闸门取三者的最大值：默认 40 / 本次授权回合数（executeAutoLearning 透传）/ 会话生效回合上限。
      // 用户诉求（2026-08-30）：单课程上限轮次超了还没结束，就跳下一节课，不让进度卡死。
      const learnTurnBudget = this.resolveLearnTurnBudget(stageResults, options.turnBudget);
      const runtimeTurns = taskRuntime.taskId === currentTask.id ? Number(taskRuntime.turns || 0) : 0;
      if (runtimeTurns >= learnTurnBudget) {
        const skipReason = `当前 task 已达 ${learnTurnBudget} 回合课时上限仍未收束，自动跳过本课，进入下一课（timebox-skip）`;
        logs.push({
          timestamp: new Date().toISOString(),
          phase: 'teaching-response',
          details: {
            output: {
              currentTask: currentTask.title,
              action: 'turn-budget-skip',
              turns: runtimeTurns,
              budget: learnTurnBudget
            }
          }
        });
        // 构造 timebox 跳过的 pending 完成态，走完整完成链路（completeTask 落库 + 推进下一课）
        const skipFinalizedAt = new Date().toISOString();
        const skipTaskRuntime = {
          status: 'task_completion_pending',
          reason: skipReason,
          taskId: currentTask.id,
          taskTitle: currentTask.title,
          teachingSessionId: taskRuntime.teachingSessionId ?? null,
          teachingRevision: taskRuntime.teachingRevision ?? learningState.teachingRevision,
          closureDecision: {
            canCompleteTask: true,
            reason: 'timebox-skip',
            autoEnded: true
          },
          finalizedAt: skipFinalizedAt,
          completionSource: 'timebox-skip',
          error: null,
          updatedAt: skipFinalizedAt,
          timeboxSkip: true
        };
        const skipLearningState = {
          ...learningState,
          teachingRevision: taskRuntime.teachingRevision ?? learningState.teachingRevision,
          taskRuntime: skipTaskRuntime
        };
        await this.updateTeachingStatePreservingControlFlags(sessionId, skipLearningState);
        // 复用完成链路：endSession（若教学会话在跑）+ completeTask + 推进下一课
        try {
          await this.assertCurrentSessionLeaseOwned(sessionId);
          const teachingSessionId = typeof taskRuntime.teachingSessionId === 'string' ? taskRuntime.teachingSessionId : null;
          const teachingRevision = typeof taskRuntime.teachingRevision === 'number'
            ? taskRuntime.teachingRevision
            : (typeof learningState.teachingRevision === 'number' ? learningState.teachingRevision : undefined);
          if (teachingSessionId) {
            await aiTeachingOrchestrator.endSession(teachingSessionId, 'task-completed', teachingRevision).catch(() => {});
          }
        } catch (error: unknown) {
          logger.warn('[simulation-coordinator] timebox-skip endSession 失败（不阻断跳课）', {
            sessionId,
            error: asErrorLike(error).message || String(error)
          });
        }
        const skipResult = await this.completeCheckpointedSimulationTask(
          sessionId,
          session,
          skipLearningState,
          milestones,
          skipTaskRuntime,
          logs
        );
        if (!skipResult) {
          throw new Error('待跳过的任务不在当前学习路径中');
        }
        if (!skipResult.success && skipResult.currentTaskStopped) {
          // completeTask 失败：保留 pending checkpoint（会话 running，可恢复续传）
          return {
            success: false,
            taskCompleted: false,
            currentTaskStopped: true,
            logs,
            error: skipResult.error || '跳过本课失败（完成结算未落库）'
          };
        }
        await this.addSessionLogs(sessionId, logs).catch(() => {});
        return {
          success: true,
          taskCompleted: true,
          isPathCompleted: skipResult.isPathCompleted === true,
          milestoneProgress: skipResult.milestoneProgress,
          logs,
          error: undefined
        };
      }
      
      const trimmedConversationHistory = this.trimLearningConversationHistory(learningState.conversationHistory || [])
      const lastAssistantMessage = [...trimmedConversationHistory]
        .reverse()
        .find((item) => item.role === 'assistant')?.content || '';

      const mergedLearnerState = this.mergeLearnerState(profile, learningState.learnerState as Partial<LearnerLatentState> | undefined, 'teaching', this.parseStoryContextFromStageResults(stageResults))
      const simulationContext = {
        profile,
        conversationHistory: trimmedConversationHistory,
        lastAssistantMessage,
        currentStage: 'teaching',
        learnerState: {
          ...mergedLearnerState,
          phaseFocus: this.resolveLearnerPhase(mergedLearnerState)
        },
        learningState: {
          currentMilestone: currentMilestone.title,
          currentTask: currentTask.title,
          milestoneProgress: currentMilestoneIdx + 1,
          totalMilestones: milestones.length
        }
      };
      
      const virtualReplyStart = Date.now();
      // 知识看板快照：当前任务概念为锚 + 学习者记忆（已掌握/到期复习/易混淆/最近成果）
      const knowledgeSnapshot = await this.buildAssistedKnowledgeSnapshot(
        session.userId,
        currentTask,
        currentMilestone
      );
      const learnerMemoryForSimulator = await this.buildAssistedLearnerMemory(session.userId);
      const virtualReplyOutput = await this.retryLearnUpstream(sessionId, 'simulate-teaching-turn', () => executeSkill(virtualLearnerLearnTurnSimulatorDefinition, {
        learner: {
          profile: profile.profile || {},
          learningGoal: profile.learningGoal,
          knownConcepts: profile.knownConcepts || [],
          struggleConcepts: profile.struggleConcepts || [],
          personalityTraits: profile.personalityTraits || {},
        },
        story: this.parseStoryContextFromStageResults(stageResults),
        visibleContext: {
          history: trimmedConversationHistory.map((item) => ({
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
          // 学习者自评“是否达成”要与教师侧用同一判据（subtasks 表已有该字段）
          acceptanceCriteria: currentTask.acceptanceCriteria || null,
          description: currentTask.description || null,
        },
        knowledgeSnapshot,
        learnerMemory: learnerMemoryForSimulator,
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
        phase: 'teaching-reply',
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
      const nextTaskIdx = currentTaskIdx;
      const nextMilestoneIdx = currentMilestoneIdx;
      let learningStepError: string | null = null;
      let closureDecision: Record<string, unknown> | null = null;
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
          
          // 记忆引擎：教学回合后增量写 memory_traces（知识看板状态 → 内化强度）
          this.persistKnowledgeState(session.userId, aiResult.knowledgePoints || []);
          // 画像回写：掌握 → knownConcepts，仍在学/需复习 → struggleConcepts
          void this.persistProfileConcepts(sessionId, session.userId, aiResult.knowledgePoints || []);
          
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
            phase: 'teaching-response',
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
              'teaching',
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
            await this.updateTeachingStatePreservingControlFlags(sessionId, checkpointLearningState);
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
                      from: 'teaching',
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
                } catch (err: unknown) {
                  logger.warn('[simulation-coordinator] 生成 wrapup 失败', { sessionId, error: asErrorLike(err).message });
                  logs.push({
                    timestamp: new Date().toISOString(),
                    phase: 'error',
                    details: {
                      error: asErrorLike(err).message || 'wrapup generation failed'
                    }
                  });
                }
              }

              await this.addSessionLogs(sessionId, logs).catch((logError: unknown) => {
                logger.warn('[simulation-coordinator] 记录任务完成日志失败', {
                  sessionId,
                  error: asErrorLike(logError).message || String(logError)
                });
              });
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
        } catch (err: unknown) {
          logger.warn('[simulation-coordinator] AI教学响应失败，已停止当前学习步骤', {
            sessionId,
            error: asErrorLike(err).message
          });
          learningStepError = asErrorLike(err).message || '教学响应失败';
          aiResponse = `当前教学会话不可继续：${learningStepError}。请重新开始当前 task 或人工检查。`;
          logs.push({
            timestamp: new Date().toISOString(),
            phase: 'error',
            details: {
              error: asErrorLike(err).message || '教学响应失败',
              output: {
                currentTask: currentTask.title,
                currentMilestone: currentMilestone.title,
                action: 'teaching-step-stopped'
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
              action: 'teaching-step-stopped'
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
        learnerState: this.mergeLearnerState(profile, (virtualReplyResult.learnerState || virtualReplyResult.internal?.learnerState) as Partial<LearnerLatentState> | undefined, 'teaching', this.parseStoryContextFromStageResults(stageResults)),
        latestLearnerFeedback: virtualReplyResult.learnerFeedback || virtualReplyResult.internal?.learnerFeedback || null,
        closureDecision,
        taskRuntime: {
          ...((learningState.taskRuntime ?? {}) as Record<string, unknown>),
          status: learningStepError
            ? 'error'
            : closureDecision?.teacherReady && !closureDecision?.learnerReady
              ? 'teacher_ready_learner_not_satisfied'
              : closureDecision?.learnerReady && !closureDecision?.teacherReady
                ? 'learner_ready_waiting_teacher'
                : 'active',
          taskId: currentTask.id,
          taskTitle: currentTask.title,
          turns: learningState.taskRuntime?.taskId === currentTask.id
            ? Number(learningState.taskRuntime.turns || 0) + 1
            : 1,
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

      await this.updateTeachingStatePreservingControlFlags(sessionId, nextLearningState);
      await this.assertCurrentSessionLeaseOwned(sessionId);
      await prisma.virtual_sessions.update({
        where: { id: sessionId },
        data: {
          currentTaskId: isPathCompleted ? null : currentTask.id,
          status: learningStepError ? 'failed' : undefined,
          currentStage: learningStepError ? 'teaching' : undefined,
          updatedAt: new Date()
        }
      });

      if (learningStepError) {
        logs.push({
          timestamp: new Date().toISOString(),
          phase: 'stage-transition',
          details: {
            output: {
              from: 'teaching',
              to: 'failed',
              message: 'Learn 上游调用重试耗尽，保留当前 task 供重启 Learn 恢复',
              currentTaskId: currentTask.id
            }
          }
        });
      }
      
      if (isPathCompleted) {
        await this.finalizePathCompletion(sessionId, logs);
      }

      await this.addSessionLogs(sessionId, logs);
      
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
    } catch (error: unknown) {
      const durationMs = Date.now() - startTime;
      
      logger.error('[simulation-coordinator] 学习步骤执行失败', {
        sessionId,
        error: asErrorLike(error).message,
        durationMs
      });
      
      logs.push({
        timestamp: new Date().toISOString(),
        phase: 'error',
        durationMs,
        details: {
          error: asErrorLike(error).message
        }
      });

      await this.persistLearningFailure(sessionId, error, logs);
      
      return {
        success: false,
        logs,
        error: asErrorLike(error).message
      };
    }
  }

  async executeAutoLearning(
    sessionId: string,
    options: { maxMilestones?: number; maxTurns?: number } = {}
  ): Promise<{
    success: boolean;
    totalSteps?: number;
    completedMilestones?: number;
    /** 本课已完成但下一课启动失败（如预算耗尽）：进度已保留，会话为 failed 可续传 */
    taskCompleted?: boolean;
    error?: string;
  }> {
    const maxMilestones = options.maxMilestones || 10;
    
    try {
      let session = await this.getVirtualSession(sessionId);

      if (session.status === 'completed') {
        return { success: true, totalSteps: 0, completedMilestones: 0 };
      }

      const initialStageResults = this.parseStageResultsPayload(session.stageResults)
      if (initialStageResults.teaching?.manualStop || session.status === 'failed' || session.status === 'abandoned') {
        return {
          success: false,
          error: initialStageResults.teaching?.stoppedReason ? `学习已停止: ${initialStageResults.teaching.stoppedReason}` : `学习已停止（${session.status}）`
        }
      }

      if (session.currentStage !== 'teaching') {
        const startResult = await this.startLearningPhase(sessionId);
        if (!startResult.success) {
          return { success: false, error: startResult.error };
        }
        session = await this.getVirtualSession(sessionId)
      }
      
      let steps = 0;
      const maxSteps = options.maxTurns || LEARN_AUTO_TURN_CAP;

      // 入口预检：当前课课时计数已达课时闸门时，第一步 executeLearningStep 就会触发
      // turn_budget_exhausted。直接温和返回（不终态化、本课对话保留）——恢复动作：
      // 调高「回合上限」后再次自动推进（继续同一对话），或手动单步推进。
      {
        const preStageResults = this.parseStageResultsPayload(session.stageResults);
        const preTeaching = (preStageResults.teaching || {}) as Record<string, unknown>;
        const preRuntime = (preTeaching.taskRuntime || {}) as Record<string, unknown>;
        if (preRuntime.taskId) {
          const preTurns = Number(preRuntime.turns || 0);
          const turnBudget = this.resolveLearnTurnBudget(preStageResults, maxSteps);
          if (preTurns >= turnBudget) {
            return {
              success: false,
              totalSteps: 0,
              completedMilestones: 0,
              error: `auto_turn_cap_exhausted：当前课已推进 ${preTurns} 回合达到课时上限（${turnBudget}）。请调高「回合上限」后再次自动推进（对话已保留），或改用手动单步推进`
            };
          }
        }
      }

      for (let i = 0; i < maxSteps; i++) {
        const latestSession = await this.getVirtualSession(sessionId)
        const latestStageResults = this.parseStageResultsPayload(latestSession.stageResults)
        if (latestStageResults.teaching?.manualStop || latestSession.status === 'failed' || latestSession.status === 'abandoned') {
          // 旁路紧急停止（requestStopLearning deferred 路径）：循环退出时就地终态化——
          // 此刻仍持有会话租约，是安全的收口点；避免会话停留在 running + manualStop 的悬挂态。
          // 人为终止记 abandoned（拍板 2026-08-21），不计入系统失败率
          if (latestSession.status !== 'failed' && latestSession.status !== 'abandoned') {
            await this.updateSessionStatus(sessionId, 'abandoned', 'teaching').catch(() => {});
            await this.addSessionLog(sessionId, {
              timestamp: new Date().toISOString(),
              phase: 'error',
              details: { error: `EMERGENCY_STOP:${latestStageResults.teaching?.stoppedReason || 'admin-emergency-stop'}` }
            }).catch(() => {});
          }
          return {
            success: false,
            totalSteps: steps,
            error: latestStageResults.teaching?.stoppedReason ? `学习已停止: ${latestStageResults.teaching.stoppedReason}` : '学习已停止'
          }
        }
        // 自动驾驶停止请求（autopilot.stopRequested）：管理员在驾驶舱点了「停止自动驾驶」，
        // 与 teaching.manualStop 不同源（前者在 stageResults.autopilot，后者在 teaching），
        // 循环内需单独检测，否则僵死为「自动驾驶 · 0 步」悬挂态
        if ((latestStageResults.autopilot as Record<string, unknown> | undefined)?.stopRequested === true) {
          logger.info('[simulation-coordinator] 检测到自动驾驶停止请求，退出自动学习', { sessionId, steps });
          return { success: true, totalSteps: steps, completedMilestones: 0 };
        }
        // 暂停检查：管理员手动暂停时，停止自动循环（不标记失败，可恢复）
        if (latestStageResults.teaching?.paused === true) {
          logger.info('[simulation-coordinator] 检测到暂停标志，停止自动学习', { sessionId, steps });
          return { success: true, totalSteps: steps, completedMilestones: 0 };
        }

        const stepResult = await this.executeLearningStep(sessionId, { turnBudget: maxSteps });
        steps++;

        if (stepResult.isPathCompleted) {
          logger.info('[simulation-coordinator] 自动学习完成', {
            sessionId,
            totalSteps: steps
          });

          // 真实完成数：路径完成即全部里程碑完成，取学习态中的实际总数而非请求上限
          const doneSession = await this.getVirtualSession(sessionId);
          const doneTeaching = this.parseStageResultsPayload(doneSession.stageResults).teaching || {};
          const actualMilestones = Number((doneTeaching as Record<string, unknown>).totalMilestones) || maxMilestones;

          return {
            success: true,
            totalSteps: steps,
            completedMilestones: actualMilestones
          };
        }

        if (!stepResult.success) {
          const stepErr = stepResult.error || '学习步骤失败';
          // 本课已完成但下一课启动失败（如预算耗尽）：不是循环可重试的错误，
          // 直接返回带 taskCompleted 标记的结果——本课进度已保留，会话已由
          // executeLearningStep 终态化为 failed（可调高预算后重试续传）。
          if (stepResult.taskCompleted) {
            return {
              success: false,
              totalSteps: steps,
              completedMilestones: 1,
              taskCompleted: true,
              error: stepErr
            };
          }
          // Provider 不稳定时自动重试（最多 3 次，间隔递增），而非直接 throw
          if (isProviderRetryable(stepErr) && i < maxSteps - 1) {
            const retryDelay = 3000 * (i === 0 ? 1 : 2);
            logger.warn('[simulation-coordinator] 教学步骤失败，自动重试', {
              sessionId, step: i, error: stepErr.substring(0, 80), retryDelayMs: retryDelay
            });
            await new Promise(r => setTimeout(r, retryDelay));
            // 重试前检查是否需要 restart-learning（会话可能变成 failed）
            const retrySession = await this.getVirtualSession(sessionId);
            if (retrySession.status === 'failed') {
              try {
                await this.restartLearningPhase(sessionId);
                logger.info('[simulation-coordinator] restart-learning 成功，继续自动学习', { sessionId });
              } catch {
                return { success: false, totalSteps: steps, error: stepErr };
              }
            }
            continue; // 重试当前步骤
          }
          throw new Error(stepErr);
        }

        // “自动完成本课”以课界为终点：本课完成即返回；状态机已自动开下一课，但不代跑。
        if (stepResult.taskCompleted) {
          return {
            success: true,
            totalSteps: steps,
            completedMilestones: 1
          };
        }

        if (stepResult.currentTaskStopped) {
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
      
      // 回合上限耗尽 ≠ 完成：诚实返回失败，不再虚报 completedMilestones
      // 注意：会话仍为 running、本课教学对话仍 active——恢复动作是「调高上限后再次自动推进」或「手动推进对话」，
      // 不应引导「重试」（重试=重开本课教学会话，会丢本课已推进的对话轮次）
      return {
        success: false,
        totalSteps: steps,
        completedMilestones: 0,
        error: `auto_turn_cap_exhausted：已自动推进 ${steps} 回合，本课仍未收束。可先调高「回合上限」后再次自动推进，或改用手动单步推进`
      };
    } catch (error: unknown) {
      logger.error('[simulation-coordinator] 自动学习失败', {
        sessionId,
        error: asErrorLike(error).message
      });
      
      return {
        success: false,
        error: asErrorLike(error).message
      };
    }
  }

  async emergencyStopLearning(sessionId: string, reason = 'admin-emergency-stop'): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      const session = await this.getVirtualSession(sessionId);

      const stageResults: StageResults = safeJsonParse<StageResults>(session.stageResults, {});

      const learningState = stageResults.teaching || {};
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

      await this.updateStageResults(sessionId, 'teaching', {
        ...learningState,
        manualStop: true,
        stoppedAt: new Date().toISOString(),
        stoppedReason: reason
      });

      // 人为终止统一记 abandoned（拍板 2026-08-21）：failed 只留给系统/上游失败，
      // 避免管理员主动停止污染失败率口径。abandoned 仍可经「重启学习」恢复
      await this.updateSessionStatus(sessionId, 'abandoned', 'teaching');

      await this.addSessionLog(sessionId, {
        timestamp: new Date().toISOString(),
        phase: 'error',
        details: {
          error: `EMERGENCY_STOP:${reason}`
        }
      });

      return { success: true };
    } catch (error: unknown) {
      logger.error('[simulation-coordinator] 紧急停止学习失败', {
        sessionId,
        error: asErrorLike(error).message
      });

      return {
        success: false,
        error: asErrorLike(error).message
      };
    }
  }

  /**
   * 紧急停止（旁路版）：不经租约队列，避免被正在运行的 auto-learning（整循环持一次租约）
   * 阻塞到自然结束——紧急语义要求立即生效。
   * 流程：① 旁路合并写入 manualStop 标志（循环每轮开头检查后自行退出）；
   * ② 尝试无排队获取 DB 租约：拿到说明没有活跃循环，就地复用 emergencyStopLearning 终态化；
   *    拿不到说明循环在跑，返回 deferred，由循环退出时就地终态化（见 executeAutoLearning）。
   */
  async requestStopLearning(sessionId: string, reason = 'admin-emergency-stop'): Promise<{
    success: boolean;
    deferred?: boolean;
    alreadyStopped?: boolean;
    error?: string;
  }> {
    try {
      const session = await this.getVirtualSession(sessionId);
      if (['completed', 'failed', 'abandoned'].includes(session.status)) {
        return { success: true, alreadyStopped: true };
      }

      // ① 旁路写停止标志（保留 teaching 其余键；已在停止流程中则不重复写）
      const stageResults = this.parseStageResultsPayload(session.stageResults);
      const teaching: Record<string, unknown> = { ...(stageResults.teaching || {}) };
      if (teaching.manualStop !== true) {
        teaching.manualStop = true;
        teaching.stoppedAt = new Date().toISOString();
        teaching.stoppedReason = reason;
        await this.updateStageResults(sessionId, 'teaching', teaching);
      }

      // ② 无排队尝试获取租约
      const ownerId = `stop_${uuidv4()}`;
      try {
        await this.acquireSessionLease(sessionId, ownerId);
      } catch (error) {
        if (error instanceof VirtualSessionLeaseBusyError) {
          logger.info('[simulation-coordinator] 停止标志已写入，运行中的学习循环将自行退出并终态化', { sessionId });
          return { success: true, deferred: true };
        }
        throw error;
      }

      try {
        const result = await this.emergencyStopLearning(sessionId, reason);
        return result.success ? { success: true } : result;
      } finally {
        await this.releaseSessionLease(sessionId, ownerId).catch(() => {});
      }
    } catch (error: unknown) {
      logger.error('[simulation-coordinator] 旁路紧急停止失败', {
        sessionId,
        error: asErrorLike(error).message
      });
      return { success: false, error: asErrorLike(error).message };
    }
  }

  async restartPathPhase(sessionId: string): Promise<{
    success: boolean;
    learningPathId?: string;
    error?: string;
  }> {
    try {
      const session = await this.getVirtualSession(sessionId)

      const stageResults: StageResults = safeJsonParse<StageResults>(session.stageResults, {});

      const learningState = stageResults.teaching || {}
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
        removeStageResults: ['path', 'path_review', 'teaching'],
        logPhasesToRemove: ['teaching-start', 'teaching-step', 'stage-transition'],
        // 重启课堂不重置 Path 上已完成 task 的真实进度。
        resetTaskProgress: false,
        clearCompletedAt: true
      })

      return await this.advanceToPathGeneration(sessionId)
    } catch (error: unknown) {
      logger.error('[simulation-coordinator] 重建路径失败', {
        sessionId,
        error: asErrorLike(error).message
      })

      return {
        success: false,
        error: asErrorLike(error).message
      }
    }
  }

  async restartLearningPhase(sessionId: string, options: { taskId?: string } = {}): Promise<{
    success: boolean;
    teachingSessionId?: string;
    welcomeMessage?: string;
    milestones?: SimulationMilestone[];
    selectedTaskId?: string;
    error?: string;
  }> {
    try {
      const session = await this.getVirtualSession(sessionId)

      if (session.status === 'completed') {
        throw new Error('学习会话已完成，不能重新开始学习')
      }

      const stageResults: StageResults = safeJsonParse<StageResults>(session.stageResults, {});

      const learningState = stageResults.teaching || {}
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
        nextStage: 'teaching',
        nextStatus: 'running',
        removeStageResults: ['teaching'],
        logPhasesToRemove: ['teaching-start', 'teaching-step', 'teaching-reply', 'teaching-response', 'stage-transition'],
        // 保留已完成课程进度：重试/自动恢复从「第一个未完成课程」续传，
        // 只重开失败的本课（learning_paths 上已完成的 subtask 状态不受影响）。
        resetTaskProgress: false,
        clearCompletedAt: true
      })

      const restartResult = await this.startLearningPhase(sessionId, preferredTaskId ? { taskId: preferredTaskId } : {})
      if (restartResult.success) {
        const restartedSession = await this.getVirtualSession(sessionId)
        const restartedStageResults = this.parseStageResultsPayload(restartedSession.stageResults)
        await this.updateStageResults(sessionId, 'teaching', {
          ...(restartedStageResults.teaching || {}),
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

      // 保留进度后的续传兜底：当前任务缺失/第一个里程碑无可启动任务时，
      // 从「第一个存在可启动任务的里程碑」定位续传点，避免「全部清零重头学」与
      // 「第一里程碑已完成则报错」两个极端。
      if (['第一个里程碑没有可用任务', '指定任务当前不可启动'].includes(String(restartResult.error || ''))) {
        const resumeTaskId = await this.findFirstRunnableTaskId(sessionId)
        if (resumeTaskId) {
          logger.info('[simulation-coordinator] 从第一个未完成里程碑续传学习', { sessionId, resumeTaskId })
          return await this.startLearningPhase(sessionId, { taskId: resumeTaskId })
        }
        return restartResult
      }

      return restartResult
    } catch (error: unknown) {
      logger.error('[simulation-coordinator] 重开学习失败', {
        sessionId,
        error: asErrorLike(error).message
      })

      return {
        success: false,
        error: asErrorLike(error).message
      }
    }
  }

  /** 扫描全部里程碑，返回第一个「当前可启动」任务 id（保留进度后重试的续传定位） */
  private async findFirstRunnableTaskId(sessionId: string): Promise<string | null> {
    const session = await this.getVirtualSession(sessionId)
    if (!session.learningPathId) return null
    const learningPath = await prisma.learning_paths.findUnique({
      where: { id: session.learningPathId },
      include: {
        milestones: {
          orderBy: { stageNumber: 'asc' },
          include: { subtasks: { orderBy: { order: 'asc' } } }
        }
      }
    })
    if (!learningPath) return null
    for (const ms of learningPath.milestones as SimulationMilestone[]) {
      const runnable = this.getRunnableTasks(ms.subtasks || [])
      if (runnable.length) return runnable[0].id
    }
    return null
  }

  /**
   * 学习完成后生成 wrapup 总结 (调用 skill:session-wrapup)
   * 将结果写入 stageResults.teaching.wrapup
   */
  async generateWrapupForSession(sessionId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const session = await this.getVirtualSession(sessionId);
      const stageResults = this.parseStageResultsPayload(session.stageResults);
      const learning = stageResults.teaching || {};
      const storyContext = (stageResults.story || stageResults.storyContext || null) as SimulationContext['storyContext'];

      // 已经生成过就不重复
      if (learning.wrapup) {
        return { success: true };
      }

      const conversation = Array.isArray(learning.conversationHistory) ? learning.conversationHistory : [];
      const messages = conversation.map((m: { role?: string; isLearner?: boolean; content?: string; text?: string; timestamp?: string; createdAt?: string }) => ({
        role: m.role || (m.isLearner ? 'user' : 'assistant'),
        content: m.content || m.text || '',
        timestamp: m.timestamp || m.createdAt || undefined
      }));

      const userMessageCount = messages.filter(m => m.role === 'user').length;
      const assistantMessageCount = messages.filter(m => m.role === 'assistant').length;

      // 业务闸门（拍板 2026-08-21）：课堂总结是「课程学完」的产物。
      // 任务已结算（completed / task_completion_pending）或整路径完成才允许生成，
      // 防止 goal/path 阶段的空对话产出假完成信号、点亮驾驶舱的 wrapup 阶段条
      const runtimeStatus = String(((learning.taskRuntime || {}) as Record<string, unknown>).status || '');
      const taskSettled = runtimeStatus === 'completed' || runtimeStatus === 'task_completion_pending';
      if (session.status !== 'completed' && !taskSettled) {
        return { success: false, error: '课堂总结在课程完成后才会生成：当前任务尚未结算完成' };
      }
      if (userMessageCount < 1 || assistantMessageCount < 1) {
        return { success: false, error: '课堂对话为空，没有可总结的内容' };
      }

      const createdAt = session.createdAt ? new Date(session.createdAt).getTime() : Date.now();
      const completedAt = Date.now();
      const durationMinutes = Math.max(1, Math.round((completedAt - createdAt) / 60000));

      // 知识点: 从 learnerState 抽取
      const learnerState = (learning.learnerState && typeof learning.learnerState === 'object' ? learning.learnerState : {}) as Record<string, unknown>;
      const knowledgePoints: SessionWrapupInput['knowledgePoints'] = Array.isArray(learnerState.knowledgePoints)
        ? learnerState.knowledgePoints.map((kp: { name?: string; label?: string; status?: string; progress?: number }) => ({
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
              lss: Number(learnerState.lss) || 5,
              ktl: Number(learnerState.ktl) || 5,
              lf: Number(learnerState.lf) || 5,
              lsb: Number(learnerState.lsb) || 5,
              recentTrend: typeof learnerState.recentTrend === 'string' ? learnerState.recentTrend : undefined,
              recommendedPacing: typeof learnerState.recommendedPacing === 'string' ? learnerState.recommendedPacing : undefined
            }
          : undefined
      };

      const result = await sessionWrapupAgent.generate(wrapupInput);

      // 写回 stageResults.teaching.wrapup
      await this.updateStageResults(sessionId, 'teaching', {
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
    } catch (error: unknown) {
      logger.error('[simulation-coordinator] generateWrapupForSession 失败', { sessionId, error });
      return { success: false, error: asErrorLike(error).message || 'unknown' };
    }
  }
}

const simulationOrchestrator = new SimulationOrchestrator();

export default simulationOrchestrator;
export { SimulationOrchestrator };
