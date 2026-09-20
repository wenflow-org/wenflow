/**
 * Simulation Orchestrator - 模拟流程协调器
 * 
 * 负责协调虚拟用户模拟的完整流程：
 * - Goal对话阶段：VirtualLearnerSimulationAgent ↔ GoalConversationService
 * - Path生成阶段：调用PathOrchestrator
 * - Learning阶段：调用AITeachingService
 */

import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID as uuidv4 } from 'crypto';
import { logger } from '../utils/logger';
import prisma from '../config/database';
import { withTransaction } from '../utils/with-transaction';
import { type GoalPathRequest } from './path.coordinator';
import goalConversationService from '../services/learning/goal-conversation.service';
import learningService from '../services/learning/learning.service';
import aiTeachingOrchestrator from '../services/ai-teaching/AITeachingCoordinator';
import {
  getSimulationAgentConfig
} from '../services/agentConfig.service';
import { executeSkill, virtualLearnerGoalDialogueSimulatorDefinition } from '../skills';
import { type FrictionBudget } from '../skills/virtual-learner-shared';
import {
  resolveStorySessionDemand,
} from '../virtual-lab/story-demand';
import { safeJsonParse } from '../utils/safe-json';
import { asErrorLike } from '../virtual-lab/vlab-types';
import { resolveSessionBudget } from '../virtual-lab/session-budget';
import { appendSimulationLog, boundSimulationLog } from '../services/virtual-lab/simulation-log-buffer';
import { simulatedNowOr } from '../services/virtual-lab/simulation-clock-context';
import { isSimulatedClockActive } from '../services/virtual-lab/simulation-clock-context';
import type { LeaseClientLike } from '../virtual-lab/vlab-types';
import type {
  SimulationMilestone,
  StageResults,
  VirtualSessionWithProfile
} from '../virtual-lab/vlab-types';
import type { 
  SimulationContext,
  SimulationStepResult,
  SimulationLogEntry,
  VirtualLearnerProfile,
  VirtualLearnerProfileData,
  LearnerLatentState,
  AssistedLeaseContext,
  SimulationOrchestratorInput,
  AutoLoopOptions,
  RunFullOptions
} from './simulation.types';
import {
  COORDINATOR_ID,
  ASSISTED_SESSION_LEASE_MS,
  ASSISTED_SESSION_LEASE_RENEW_MS,
  LEARN_UPSTREAM_RETRY_ATTEMPTS,
  LEARN_UPSTREAM_RETRY_DELAY_MS,
  WORK_SETTLE_TIMEOUT_MS
} from './simulation.constants';
import {
  buildProgressAfterTaskCompletion,
  countTaskProgress,
  findTaskInPath,
  resolveSimLearnerState,
  isRetryableLearnUpstreamError,
  isRequestAborted,
  boundTaskCompletionError,
  isGoalConverged,
  parseProfileData,
  mapGoalStageToLearnerPhase,
  parseStageResultsPayload,
  parseStoryContextFromStageResults,
  buildGoalVisibleContext,
  finalizeGoalLearnerState,
  inferDisclosedGoalConcerns,
  getSessionFrictionBudget,
  getSessionPromptOverrides
} from './simulation.helpers';
import {
  parseGoalConversationHistory,
  resolveGoalTurnState,
  buildGoalStepResult
} from './simulation.goal.steps';
import {
  detectStaleRunningSession,
  renewSessionLease,
  acquireSessionLease,
  releaseSessionLease
} from './simulation.lease';
import {
  buildAssistedLearnerMemory,
  persistAssistedLearnerMemory
} from './simulation.memory';
import {
  waitForPathReady as pathPhaseWaitForPathReady,
  buildGoalPathRequest as pathPhaseBuildGoalPathRequest,
  advanceToPathGeneration as pathPhaseAdvanceToPathGeneration,
  retryPathGeneration as pathPhaseRetryPathGeneration,
  reviewPathProposal as pathPhaseReviewPathProposal,
  acceptPathReview as pathPhaseAcceptPathReview,
  replanPathFromReview as pathPhaseReplanPathFromReview,
  resolvePathReview as pathPhaseResolvePathReview,
} from './simulation.path-phase';
import {
  startLearningPhase as learnPhaseStartLearningPhase,
  finalizePathCompletion as learnPhaseFinalizePathCompletion,
  executeLearningStep as learnPhaseExecuteLearningStep,
  executeAutoLearning as learnPhaseExecuteAutoLearning,
  emergencyStopLearning as learnPhaseEmergencyStopLearning,
  requestStopLearning as learnPhaseRequestStopLearning,
  restartPathPhase as learnPhaseRestartPathPhase,
  restartLearningPhase as learnPhaseRestartLearningPhase,
  findFirstRunnableTaskId as learnPhaseFindFirstRunnableTaskId,
  generateWrapupForSession as learnPhaseGenerateWrapupForSession,
} from './simulation.learn-phase';
import { isTeachingTurnHiccupError } from './simulation.learn-phase';
export {
  VirtualSessionLeaseBusyError,
  VirtualSessionLeaseLostError,
  VirtualSessionDatabaseBusyError
} from './simulation.errors';
export type {
  SimulationOrchestratorInput,
  AutoLoopOptions,
  RunFullOptions,
  AssistedLeaseContext
} from './simulation.types';

/** Path 评审护栏（MAX_PATH_REPLANS / shouldForceAcceptPathReview）已迁至 simulation.path-phase，此处 re-export 维持既有 import 路径 */
export { shouldForceAcceptPathReview } from './simulation.path-phase';

/**
 * 教学回合「模型抖动」的步骤级兜底重试参数（新发现问题 #3）。
 *
 * 背景：`TEACHING_TURN_REPLY_MISSING` 之类结构化校验失败在 prompt 级已重试 2 次
 * （见 skills/teaching-turn 的 retryStrategy），失败后抛出的错误**不匹配**
 * `isRetryableLearnUpstreamError` 的正则，于是 `retryLearnUpstream` 一次即抛 →
 * 整个助手会话被标记 `failed`（终局，需人工续跑）。实测约 1/3 跑数受影响。
 *
 * 处置：在步骤层再做至多 2 次短退避重试；仍失败则**暂停本回合（不终局）**，
 * 保留同一 task 供下一次 `advance-day runTasks` 重试。
 */
const TEACHING_TURN_STEP_RETRY_ATTEMPTS = 2;
const TEACHING_TURN_STEP_RETRY_DELAY_MS = 1500;

export { isTeachingTurnHiccupError } from './simulation.learn-phase';

/**
 * 教学检查点消费（assisted 链路）——纯函数决策 + 结果归一化。
 *
 * 背景：`executeLearningStep`（`POST /advance-day` 的 `runTasks:true` 路径）此前只把学习者的
 * 聊天回复交给 `processStudentMessage`，**从不读取** `getSessionDetail` 暴露的
 * `pendingCheckpoint`、也从不调用 `submitCheckpoint`。结果：一旦教学系统出题，
 * 待答检查点永远挂着，`learner_evidence(type='checkpoint:result')`（成功带传感器的输入）
 * 一条也不会写。黑盒链路已用 `buildCheckpointAction` 做对了（见 virtual-lab/blackbox-*），
 * 这里按同思路抽出纯函数，便于单测覆盖 assisted 路径。
 */

type ProcessTeachingTurnResult = Awaited<ReturnType<typeof aiTeachingOrchestrator.processStudentMessage>>;
type CheckpointSubmitOutcome = Awaited<ReturnType<typeof aiTeachingOrchestrator.submitCheckpoint>>;

/** getSessionDetail 返回的待答检查点（答案键已被教学协调器剥离）。 */
export interface PendingTeachingCheckpoint {
  id: string;
  type?: 'single_choice' | 'multi_choice' | 'short_answer' | string;
  question?: string;
  options?: Array<{ id: string; text: string }>;
  allowSkip?: boolean;
  [key: string]: unknown;
}

/** 模拟器返回的检查点作答草案。 */
export interface SimulatorCheckpointAnswer {
  selectedOptionIds?: string[];
  answerText?: string;
  confidence?: number;
}

/** 提交检查点的载荷（与 CheckpointSubmitPayload 的字段一致）。 */
export interface CheckpointSubmitPayloadLike {
  selectedOptionIds?: string[];
  answerText?: string;
}

export type CheckpointSubmitDecision =
  | { kind: 'submit'; checkpointId: string; payload: CheckpointSubmitPayloadLike }
  | { kind: 'process-message' };

/**
 * 纯决策：本轮该「提交检查点」还是「走普通聊天回合」。
 *
 * 仅当同时满足「存在待答检查点」且「模拟器给出可用作答」时才提交；否则一律走原路径，
 * 保证无检查点时的行为与改动前一致。作答归一化对齐 `submitCheckpoint` 的校验：
 * - 选择题：只保留题目里真实存在的选项 id（非法 id 丢弃）；单选只取一个；
 * - 简答题：只认 `answerText`（选择题答案键对简答无效）；
 * - 无有效载荷（空选项/空文本）→ 退回聊天，避免提交必然失败的 payload。
 */
export function resolveCheckpointSubmitAction(params: {
  pendingCheckpoint?: PendingTeachingCheckpoint | null;
  checkpointAnswer?: SimulatorCheckpointAnswer | null;
}): CheckpointSubmitDecision {
  const checkpoint = params.pendingCheckpoint;
  const answer = params.checkpointAnswer;
  if (!checkpoint || typeof checkpoint.id !== 'string' || checkpoint.id.length === 0) {
    return { kind: 'process-message' };
  }
  if (!answer || typeof answer !== 'object') {
    return { kind: 'process-message' };
  }

  const answerText = typeof answer.answerText === 'string' && answer.answerText.trim().length > 0
    ? answer.answerText.trim()
    : undefined;

  if (checkpoint.type === 'short_answer') {
    return answerText
      ? { kind: 'submit', checkpointId: checkpoint.id, payload: { answerText } }
      : { kind: 'process-message' };
  }

  const optionIds = new Set(
    (Array.isArray(checkpoint.options) ? checkpoint.options : [])
      .map((option) => option?.id)
      .filter((id): id is string => typeof id === 'string')
  );
  const validSelected = (Array.isArray(answer.selectedOptionIds) ? answer.selectedOptionIds : [])
    .filter((id): id is string => typeof id === 'string' && id.length > 0 && (optionIds.size === 0 || optionIds.has(id)));
  const selectedOptionIds = checkpoint.type === 'single_choice' ? validSelected.slice(0, 1) : validSelected;

  if (selectedOptionIds.length > 0) {
    return { kind: 'submit', checkpointId: checkpoint.id, payload: { selectedOptionIds } };
  }
  if (answerText) {
    return { kind: 'submit', checkpointId: checkpoint.id, payload: { answerText } };
  }
  return { kind: 'process-message' };
}

/**
 * 教学回合结果的归一化形状：普通聊天回合与检查点提交回合共用同一套字段读取，
 * 避免调用方为两条路径各写一份日志/收束逻辑。
 */
export interface NormalizedTeachingTurn {
  aiResponse: string;
  revision: number;
  knowledgePoints: any[];
  isCompletion: boolean;
  autoEnded: boolean;
  cognitiveLevel: unknown;
  knowledgePoint: unknown;
  strategies: string[];
  peerTriggered: boolean;
  peerMessage: unknown;
  currentState: unknown;
  promptDebug: unknown;
  /** 供 computeClosureDecision 使用的教师侧信号（字段与 processStudentMessage 结果一致）。 */
  closureSignal: {
    isCompletion: boolean;
    autoEnded: boolean;
    promptDebug?: any;
  };
}

/** runTeachingTurn 及其步骤级重试包装共用的入参。 */
interface RunTeachingTurnParams {
  sessionId: string;
  teachingSessionId: string;
  learnerMessage: string;
  teachingRevision: number | undefined;
  pendingCheckpoint: PendingTeachingCheckpoint | null;
  checkpointAnswer: SimulatorCheckpointAnswer | null;
}

/** 普通聊天回合 → 归一化结果（字段与改动前逐字一致）。 */
export function normalizeProcessTeachingTurn(result: ProcessTeachingTurnResult): NormalizedTeachingTurn {
  return {
    aiResponse: result.aiResponse || '',
    revision: result.revision,
    knowledgePoints: result.knowledgePoints || [],
    isCompletion: result.isCompletion,
    autoEnded: result.autoEnded || false,
    cognitiveLevel: result.analysis?.cognitiveLevel,
    knowledgePoint: result.knowledgePoint || null,
    strategies: result.strategies || [],
    peerTriggered: result.peerTriggered || false,
    peerMessage: result.peerMessage || null,
    currentState: result.currentState || null,
    promptDebug: result.promptDebug || null,
    closureSignal: {
      isCompletion: result.isCompletion,
      autoEnded: result.autoEnded || false,
      promptDebug: result.promptDebug,
    }
  };
}

/**
 * 检查点提交结果 → 归一化结果。
 *
 * `CheckpointSubmitResult` 只暴露 `{ passed, feedback, hint, nextAction, revision }`，
 * 没有聊天回合的 `isCompletion` / `autoEnded` / `analysis` 等字段（内部教学回合的这些信号
 * 未透出）。这里如实降为「未收束」并只带代码裁决诊断，绝不伪造教师收束信号——
 * 宁可不在本回合结束 task，也不让检查点提交误触发收束。
 */
export function normalizeCheckpointSubmitTurn(result: CheckpointSubmitOutcome): NormalizedTeachingTurn {
  return {
    aiResponse: result.feedback || '',
    revision: result.revision,
    knowledgePoints: [],
    isCompletion: false,
    autoEnded: false,
    cognitiveLevel: undefined,
    knowledgePoint: null,
    strategies: [],
    peerTriggered: false,
    peerMessage: null,
    currentState: null,
    promptDebug: {
      checkpoint: {
        passed: result.passed === true,
        nextAction: result.nextAction,
        hint: result.hint || null,
      }
    },
    closureSignal: {
      isCompletion: false,
      autoEnded: false,
      promptDebug: {
        checkpoint: {
          passed: result.passed === true,
          nextAction: result.nextAction,
          hint: result.hint || null,
        }
      }
    }
  };
}

class SimulationOrchestrator {  readonly id = COORDINATOR_ID;
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
      acquiredExpiresAt = await acquireSessionLease(sessionId, ownerId);
    } catch (error) {
      releaseQueue();
      if (this.sessionLocks.get(sessionId) === queued) this.sessionLocks.delete(sessionId);
      throw error;
    }
    await detectStaleRunningSession(sessionId);

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
      await releaseSessionLease(sessionId, ownerId);
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

  // 测试直接调用入口：保持与原实例方法同名，委托给抽离后的模块函数
  private async renewSessionLease(
    sessionId: string,
    ownerId: string,
    knownExpiresAt = Date.now() + ASSISTED_SESSION_LEASE_MS,
    leaseClient: LeaseClientLike = prisma
  ) {
    return renewSessionLease(sessionId, ownerId, knownExpiresAt, leaseClient);
  }

  private async renewAssistedLease(context: AssistedLeaseContext, leaseClient: LeaseClientLike = prisma) {
    const renewal = context.renewal.then(async () => {
      if (context.failureError) throw context.failureError;
      const expiresAt = await renewSessionLease(
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

  async assertCurrentSessionLeaseOwned(sessionId: string) {
    const context = this.sessionLeaseContext.getStore();
    if (context?.sessionId === sessionId) await context.assertLeaseOwned();
  }

  async retryLearnUpstream<T>(sessionId: string, operation: string, execute: () => Promise<T>): Promise<T> {
    // 预算来源：故事级覆盖（storyContext.budget）优先，否则角色级（profile.simulationBudget）。
    // 语义：maxRetriesPerStep = 单次上游调用的重试次数；costCeiling = 单会话累计 AI 调用
    // 上限（防无限跑的成本护栏，含重试）；两者任一耗尽即终止。解析统一走 resolveSessionBudget。
    let maxRetries = LEARN_UPSTREAM_RETRY_ATTEMPTS;
    let maxTotalCalls: number | null = null;
    try {
      const session = await this.getVirtualSession(sessionId);
      const profileData = safeJsonParse<VirtualLearnerProfileData>(session.virtual_learner_profiles.profile, {});
      const stageResults = parseStageResultsPayload(session.stageResults);
      const budget = resolveSessionBudget({ stageResults, profileData });
      maxRetries = budget.maxRetriesPerStep;
      maxTotalCalls = budget.costCeiling;
    } catch {
      // 会话尚不可用或 profile 无预算配置：沿用默认值
    }
    let lastError: unknown;
    let attempts = 0;
    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      attempts = attempt;
      // 请求级取消（客户端断开 / 上层 abort）：不再发起或重试上游调用，避免白烧预算。
      // 自动驾驶路径的 runWithContext 已剥离 abortSignal，故这里对其无影响。
      if (isRequestAborted()) {
        const err = new Error('request_aborted：请求已取消，停止 Learn 上游调用');
        (err as Error & { code?: string }).code = 'REQUEST_ABORTED';
        throw err;
      }
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
        if (!isRetryableLearnUpstreamError(error) || attempt === maxRetries) break;
        // 失败后若已取消，不再等待/重试
        if (isRequestAborted()) break;
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
      const stageResults = parseStageResultsPayload(session.stageResults);
      return Number((stageResults.runtimeStats as Record<string, unknown> | undefined)?.aiCalls) || 0;
    } catch {
      return 0;
    }
  }

  /** 原子累计该会话 AI 调用次数（并发安全：事务内读-改-写） */
  private async consumeAiCall(sessionId: string, count: number): Promise<void> {
    if (!Number.isFinite(count) || count < 1) return;
    try {
      await withTransaction(async (tx) => {
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

  /**
   * 同一虚拟会话可以跨多个 Path task。完成当前 task 后，立即为下一 task 建立新课堂，
   * 不让已完成 taskRuntime 阻塞后续 executeLearningStep。
   */
  private async transitionToNextLearningTask(
    sessionId: string,
    session: VirtualSessionWithProfile,
    learningState: Record<string, unknown>,
    completedTaskRuntime: Record<string, unknown>,
    nextProgress: ReturnType<typeof buildProgressAfterTaskCompletion>,
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
    const now = simulatedNowOr().toISOString();
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

  async resolveTeachingRevision(
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

  /**
   * 执行一个教学回合：有待答检查点且模拟器给出作答 → 提交检查点（消费 pendingCheckpoint，
   * 由教学协调器写 `learner_evidence(checkpoint:result)`）；否则走原聊天路径。
   *
   * 提交失败（revision 冲突 / 检查点已失效 / 作答非法等）→ 记警告并**回退**到
   * `processStudentMessage`，绝不阻断学习循环（与黑盒链路的兜底语义一致）。
   */
  private async runTeachingTurn(params: RunTeachingTurnParams): Promise<NormalizedTeachingTurn> {
    const action = resolveCheckpointSubmitAction({
      pendingCheckpoint: params.pendingCheckpoint,
      checkpointAnswer: params.checkpointAnswer,
    });

    if (action.kind === 'submit') {
      try {
        const submitResult = await this.retryLearnUpstream(params.sessionId, 'submit-checkpoint', () =>
          aiTeachingOrchestrator.submitCheckpoint(
            params.teachingSessionId,
            action.checkpointId,
            action.payload,
            params.teachingRevision
          )
        );
        return normalizeCheckpointSubmitTurn(submitResult);
      } catch (checkpointError) {
        logger.warn('[simulation-coordinator] 提交理解检查点失败，回退到普通教学回合', {
          sessionId: params.sessionId,
          teachingSessionId: params.teachingSessionId,
          checkpointId: action.checkpointId,
          error: asErrorLike(checkpointError).message || String(checkpointError),
        });
      }
    }

    const turn = await this.retryLearnUpstream(params.sessionId, 'process-teaching-turn', () =>
      aiTeachingOrchestrator.processStudentMessage(
        params.teachingSessionId,
        params.learnerMessage,
        { expectedRevision: params.teachingRevision }
      )
    );
    return normalizeProcessTeachingTurn(turn);
  }

  /**
   * 教学回合的步骤级有界重试（新发现问题 #3）。
   *
   * 仅对「模型抖动」类错误（`isTeachingTurnHiccupError`）追加至多
   * `TEACHING_TURN_STEP_RETRY_ATTEMPTS` 次短退避尝试；其余错误原样抛出，交给上层按既有
   * 语义处理（中止/预算/终局）。每次尝试仍复用 `runTeachingTurn` → `retryLearnUpstream`
   * （含单次 300s wall-clock 超时约束），不改变 prompt 级 `maxAttempts: 2`。
   *
   * 边界（**禁止伪造教师回复**）：本方法只在失败之间重试，**不**生成、**不**合成任何教师
   * `reply`。若重试全部耗尽，调用方（`executeLearningStep`）把会话降级为可续跑暂停，
   * 绝不产出兜底教师话术冒充教学。
   */
  async runTeachingTurnWithStepRetry(params: RunTeachingTurnParams): Promise<NormalizedTeachingTurn> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= TEACHING_TURN_STEP_RETRY_ATTEMPTS; attempt += 1) {
      if (attempt > 0) {
        if (isRequestAborted()) break;
        logger.warn('[simulation-coordinator] 教学回合失败，步骤级额外重试（非终局）', {
          sessionId: params.sessionId,
          teachingSessionId: params.teachingSessionId,
          attempt,
          maxExtraAttempts: TEACHING_TURN_STEP_RETRY_ATTEMPTS,
          error: asErrorLike(lastError).message || String(lastError),
        });
        await new Promise(resolve => setTimeout(resolve, TEACHING_TURN_STEP_RETRY_DELAY_MS * attempt));
      }
      try {
        await this.assertCurrentSessionLeaseOwned(params.sessionId);
        return await this.runTeachingTurn(params);
      } catch (error: unknown) {
        lastError = error;
        if (!isTeachingTurnHiccupError(error) || attempt === TEACHING_TURN_STEP_RETRY_ATTEMPTS) break;
      }
    }
    throw lastError;
  }

  async getVirtualSession(sessionId: string): Promise<VirtualSessionWithProfile> {
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
  
  async getGoalConversation(conversationId: string, userId: string) {
    const conversation = await prisma.goal_conversations.findFirst({
      where: { id: conversationId, userId }
    });
    
    return conversation;
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
      ? await buildAssistedLearnerMemory(params.userId)
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
      visibleContext: buildGoalVisibleContext(params.conversationHistory, params.lastAssistantMessage),
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

  async addSessionLog(sessionId: string, log: SimulationLogEntry) {
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

    // 按**字节预算**封顶（实测出现过单行 31.9 MB：765 条 teaching-response，单条最大 123 KB）
    logs = appendSimulationLog(logs, log);

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
   * 统计会话日志里某个 phase 的条数（只读 logs 列，避开 stageResults 大字段）。
   * 用于收敛护栏：`path-replan`（重规划次数）。
   */
  async countSessionLogsByPhase(sessionId: string, phase: string): Promise<number> {
    const session = await prisma.virtual_sessions.findUnique({
      where: { id: sessionId },
      select: { logs: true }
    });
    if (!session) return 0;
    let logs: SimulationLogEntry[] = [];
    try {
      logs = JSON.parse(session.logs || '[]');
    } catch { /* 解析失败按 0 计 */ }
    return logs.filter((entry) => entry?.phase === phase).length;
  }

  /**
   * 批量追加日志：一次读-改-写落多条。
   * 背景：调用方曾普遍 `for (const log of logs) await addSessionLog(...)`，
   * 每条日志都全量 parse/stringify 整个 logs 数组，形成 O(n²) 写放大
   * （单会话累计冗余写可达 MB 级）。批量入口把 n 次读写收敛为 1 次。
   */
  async addSessionLogs(sessionId: string, entries: SimulationLogEntry[]) {
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
  
  async updateSessionStatus(
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
  
  async updateStageResults(sessionId: string, stage: string, result: Record<string, unknown>) {
    await this.assertCurrentSessionLeaseOwned(sessionId);
    // 事务内原子读-改-写，防止并发覆盖（step 更新 goal 与 advanceToPathGeneration 更新 path 同时写入）
    await withTransaction(async (tx) => {
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
  async updateTeachingStatePreservingControlFlags(sessionId: string, incoming: Record<string, unknown>) {
    try {
      const session = await this.getVirtualSession(sessionId);
      const latestTeaching = parseStageResultsPayload(session.stageResults).teaching || {};
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
  async persistLearningFailure(sessionId: string, error: unknown, _logs: SimulationLogEntry[]) {
    const message = boundTaskCompletionError(error);
    try {
      const session = await this.getVirtualSession(sessionId);
      const stageResults = parseStageResultsPayload(session.stageResults);
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

  /**
   * 教学回合因「模型抖动」暂停（新发现问题 #3）：落可重试标记，**不把会话打成 failed**。
   *
   * 会话 status 枚举（created/running/completed/failed/abandoned）**无法表达 paused**，
   * 且 `teaching.paused` 已被管理员手动暂停占用（语义完全不同，误用会让 UI 显示"已暂停"）。
   * 因此这里保持 `running`，以 `runtimeStats.lastError`（`retryable:true`）作为可续跑暂停的
   * 权威标记：下一次 `advance-day runTasks` 见到同一 task 会重新推进该回合。
   *
   * 边界：**不写入任何教师 reply**，本方法只记录错误标记。
   */
  async persistTeachingPauseMarker(sessionId: string, error: unknown): Promise<void> {
    const message = boundTaskCompletionError(error);
    const at = new Date().toISOString();
    try {
      await withTransaction(async (tx) => {
        const session = await tx.virtual_sessions.findUnique({
          where: { id: sessionId },
          select: { stageResults: true }
        });
        if (!session) return;
        const stageResults: StageResults = safeJsonParse<StageResults>(session.stageResults, {});
        const stats = (stageResults.runtimeStats || {}) as Record<string, unknown>;
        stageResults.runtimeStats = {
          ...stats,
          lastError: {
            code: 'TEACHING_TURN_STEP_PAUSED',
            message,
            stage: 'teaching',
            retryable: true,
            at
          }
        };
        await tx.virtual_sessions.update({
          where: { id: sessionId },
          data: { stageResults: JSON.stringify(stageResults), updatedAt: new Date() }
        });
      });
    } catch (markError: unknown) {
      logger.warn('[simulation-coordinator] 写入教学暂停标记失败（会话仍为 running，可续跑）', {
        sessionId,
        error: asErrorLike(markError).message || String(markError)
      });
    }
  }

  /**
   * 清除上一次教学暂停标记（仅当存在时写库）。
   *
   * 无标记时**零写入**，保证正常成功路径与改动前逐字节一致；有标记时在本次步骤开始时清除，
   * 若本回合再次抖动则由 `persistTeachingPauseMarker` 重新写入，避免陈旧标记污染 harness 判定。
   */
  async clearTeachingPauseMarker(sessionId: string): Promise<void> {
    try {
      await withTransaction(async (tx) => {
        const session = await tx.virtual_sessions.findUnique({
          where: { id: sessionId },
          select: { stageResults: true }
        });
        if (!session) return;
        const stageResults: StageResults = safeJsonParse<StageResults>(session.stageResults, {});
        const stats = (stageResults.runtimeStats || {}) as Record<string, unknown>;
        if (!stats.lastError) return;
        const nextStats = { ...stats };
        delete nextStats.lastError;
        stageResults.runtimeStats = nextStats;
        await tx.virtual_sessions.update({
          where: { id: sessionId },
          data: { stageResults: JSON.stringify(stageResults), updatedAt: new Date() }
        });
      });
    } catch (clearError: unknown) {
      logger.warn('[simulation-coordinator] 清除教学暂停标记失败（不阻断主流程）', {
        sessionId,
        error: asErrorLike(clearError).message || String(clearError)
      });
    }
  }

  async resetSessionRuntime(
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
        logs: JSON.stringify(boundSimulationLog(nextLogs)),
        completedAt: options.clearCompletedAt ? null : session.completedAt,
        updatedAt: new Date()
      }
    })
  }

  async completeCheckpointedSimulationTask(
    sessionId: string,
    session: VirtualSessionWithProfile,
    learningState: Record<string, unknown>,
    milestones: SimulationMilestone[],
    taskRuntime: Record<string, unknown>,
    logs: SimulationLogEntry[]
  ) {
    const taskMatch = findTaskInPath(milestones, typeof taskRuntime.taskId === 'string' ? taskRuntime.taskId : undefined);
    if (!taskMatch) return null;

    let taskCompletionResult: Awaited<ReturnType<typeof learningService.completeTask>> | undefined;
    try {
      await this.assertCurrentSessionLeaseOwned(sessionId);
      taskCompletionResult = await learningService.completeTask({
        taskId: taskMatch.task.id,
        userId: session.userId,
        actualMinutes: taskMatch.task.estimatedMinutes || 30,
        notes: '虚拟学习者完成当前 task 的教学会话',
        rating: 5,
        // 日期模拟：台账/streak 落在模拟日（无模拟上下文时不传 → 现网行为不变）
        ...(isSimulatedClockActive() ? { asOf: simulatedNowOr() } : {}),
      });
      // 记忆回写：画像概念 + 成果物登记（best-effort，失败不阻断）
      await persistAssistedLearnerMemory(sessionId, session, taskMatch.task);
    } catch (error: unknown) {
      const boundedError = boundTaskCompletionError(error);
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
    const nextProgress = buildProgressAfterTaskCompletion(milestones, taskMatch.task.id);
    const latestSession = await prisma.virtual_sessions.findUnique({ where: { id: sessionId } });
    const latestStageResults = parseStageResultsPayload(latestSession?.stageResults);
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
    const currentProgress = countTaskProgress(milestones, taskMatch.task.id);

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
        const rawMessage = boundTaskCompletionError(error);
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

  async executeSingleStep(input: SimulationOrchestratorInput): Promise<SimulationStepResult> {
    const startTime = Date.now();
    const logs: SimulationLogEntry[] = [];
    
    try {
      logger.info('[simulation-coordinator] 执行单步模拟', {
        sessionId: input.sessionId,
        userId: input.userId
      });
      
      const session = await this.getVirtualSession(input.sessionId);
      const profile = parseProfileData(session.virtual_learner_profiles);
      const initialStageResults: StageResults = safeJsonParse<StageResults>(session.stageResults, {});
      const storyContext = parseStoryContextFromStageResults(initialStageResults);
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
            frictionBudget: getSessionFrictionBudget(session)
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
              learnerState: finalizeGoalLearnerState(
                profile,
                resolveSimLearnerState(openingResult.output, openingResult.learnerStateFromEnvelope || {}),
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
        // 负荷画像：仅在画像确实带信号时才附加选项（无信号时 options 形状与改动前逐字节一致）。
        // 随 Goal 会话落库（collectedData.learnerLoadProfile），让"生成路径"的真实入口
        // （goal-conversation.service.buildGoalPathRequest）也能拿到并收紧体量。
        const learnerAvailableTime = profile.profile.availableTime ?? null;
        const learnerLoadTolerance = profile.profile.cognitiveLoadTolerance ?? null;
        // goal agent 开场回应是真实 LLM 调用，计入会话 AI 调用预算
        const goalResult = await this.retryLearnUpstream(input.sessionId, 'goal-opening-turn', () =>
          goalConversationService.startConversation(
            input.userId,
            openingReply,
            {
              systemPromptOverrides: getSessionPromptOverrides(session),
              ...(learnerAvailableTime || learnerLoadTolerance
                ? { learnerLoadProfile: { availableTime: learnerAvailableTime, loadTolerance: learnerLoadTolerance } }
                : {}),
            }
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
              // 分诊命中率遥测：goal 结果透出的 responseTriage.mode（缺失为 null，默认行为不变）
              responseTriageMode: goalResult.internal.ext?.goalConversation?.responseTriage?.mode ?? null,
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
          goalReady: isGoalConverged(goalResult.internal.core.stage),
          logs
        };
      }
      
      const conversation = await this.getGoalConversation(session.goalConversationId, input.userId);
      
      if (!conversation) {
        throw new Error('Goal对话不存在');
      }
      
      const { history: conversationHistory, lastAssistantMessage } = parseGoalConversationHistory(conversation.collectedData);

      const {
        stageResults,
        goalState,
        existingGoalState,
        activeStoryContext,
        concernPool,
        disclosedConcerns
      } = resolveGoalTurnState({
        profile,
        stageResultsRaw: session.stageResults,
        collectedData: conversation.collectedData
      });
      
      const virtualReplyStart = Date.now();
      const virtualReplyResult = await this.retryLearnUpstream(input.sessionId, 'simulate-goal-reply', () =>
        this.simulateGoalLearnerReply({
          profile,
          storyContext: activeStoryContext,
          conversationHistory,
          lastAssistantMessage,
          currentPhase: mapGoalStageToLearnerPhase(goalState?.stage || existingGoalState.stage as string | undefined),
          previousLearnerState: stageResults.goal?.learnerState,
          goalState,
          userId: input.userId,
          frictionBudget: getSessionFrictionBudget(session)
        })
      );
      
      if (!virtualReplyResult.success || !virtualReplyResult.output?.reply) {
        throw new Error('虚拟用户回复生成失败');
      }

      const currentGoalLearnerState = finalizeGoalLearnerState(
        profile,
        resolveSimLearnerState(
          virtualReplyResult.output,
          virtualReplyResult.learnerStateFromEnvelope || {}
        ),
        activeStoryContext,
        // 优先取本次对话的实时 stage；stageResults.goal 的 finalStage/stage 仅作兜底，
        // 避免历史落库字段遮蔽实时进度（issue #4 健壮性观察）
        goalState?.stage || (existingGoalState.finalStage as string | undefined) || (existingGoalState.stage as string | undefined)
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

      const nextDisclosedConcerns = inferDisclosedGoalConcerns(
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
            systemPromptOverrides: getSessionPromptOverrides(session),
            // 平台硬规则：proposing 阶段只有显式确认动作才会收束并触发 Path 生成。
            // 黑盒有 confirm_proposal 动作映射；辅助模式由协调器根据虚拟学习者
            // 自评的 readyToAdvance 代发确认，否则 Goal 会永远停在 proposing。
            confirmProposal: currentGoalLearnerState.readyToAdvance === true
          }
        )
      );
      
      // 分诊命中率遥测：goal 结果透出的 responseTriage（缺失为 null，默认行为不变）
      // continueConversation 返回联合形状，部分分支不带该字段，故按可选读取。
      const goalResponseTriage = (goalResult.internal.ext?.goalConversation as
        | { responseTriage?: { mode?: string } | null }
        | undefined)?.responseTriage ?? null;

      logs.push({
        timestamp: new Date().toISOString(),
        phase: 'goal-response',
        durationMs: Date.now() - goalResponseStart,
        details: {
          output: {
            userVisible: goalResult.userVisible,
            stage: goalResult.internal.core.stage,
            confidence: goalResult.internal.core.confidence,
            responseTriageMode: goalResponseTriage?.mode ?? null,
            quickReplies: goalResult.internal.ext?.goalConversation?.quickReplies?.map(q =>
              typeof q === 'string' ? q : q.text
            ) || []
          }
        }
      });

      const goalReady = isGoalConverged(goalResult.internal.core.stage);
      const finalGoalLearnerState = finalizeGoalLearnerState(
        profile,
        // 与 currentGoalLearnerState 同口径（含 envelope 回退），否则最终落库会丢掉
        // envelope.contextUpdate.nextState（issue #4 一致性观察）
        resolveSimLearnerState(virtualReplyResult.output, virtualReplyResult.learnerStateFromEnvelope || {}),
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
          disclosedConcerns: nextDisclosedConcerns,
          // 分诊命中率遥测：落 stageResults.goal.responseTriage（无迁移）
          responseTriage: goalResponseTriage
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
      
      const goalQuickReplies = goalResult.internal.ext?.goalConversation?.quickReplies?.map(q =>
        typeof q === 'string' ? q : q.text
      );

      return buildGoalStepResult({
        virtualUserReply: virtualReplyResult.output.reply,
        goalResponse: {
          userVisible: goalResult.userVisible,
          stage: goalResult.internal.core.stage,
          confidence: goalResult.internal.core.confidence,
          quickReplies: goalQuickReplies
        },
        goalReady,
        logs
      });
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
          const paused = parseStageResultsPayload(after.stageResults).teaching?.paused === true;
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

  async waitForPathReady(
    sessionId: string,
    learningPathId: string | null,
    timeoutMs = 600_000
  ) {
    return pathPhaseWaitForPathReady(this, sessionId, learningPathId, timeoutMs);
  }

  private buildGoalPathRequest(
    session: VirtualSessionWithProfile,
    conversation: { collectedData: string | null; description: string | null }
  ): { request: GoalPathRequest; rawGoalSource: string | undefined } {
    return pathPhaseBuildGoalPathRequest(session, conversation);
  }

  async advanceToPathGeneration(sessionId: string) {
    return pathPhaseAdvanceToPathGeneration(this, sessionId);
  }

  async retryPathGeneration(sessionId: string) {
    return pathPhaseRetryPathGeneration(this, sessionId);
  }

  async reviewPathProposal(sessionId: string) {
    return pathPhaseReviewPathProposal(this, sessionId);
  }

  async acceptPathReview(sessionId: string, options: { force?: boolean } = {}) {
    return pathPhaseAcceptPathReview(this, sessionId, options);
  }

  async replanPathFromReview(sessionId: string) {
    return pathPhaseReplanPathFromReview(this, sessionId);
  }

  async resolvePathReview(sessionId: string, options: { startLearning?: boolean } = {}) {
    return pathPhaseResolvePathReview(this, sessionId, options);
  }
  async startLearningPhase(sessionId: string, options: { taskId?: string } = {}): Promise<{
    success: boolean;
    teachingSessionId?: string;
    welcomeMessage?: string;
    milestones?: SimulationMilestone[];
    selectedTaskId?: string;
    error?: string;
  }> {
    return learnPhaseStartLearningPhase(this, sessionId, options);
  }

  async finalizePathCompletion(sessionId: string, logs: SimulationLogEntry[]) {
    return learnPhaseFinalizePathCompletion(this, sessionId, logs);
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
    return learnPhaseExecuteLearningStep(this, sessionId, options);
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
    return learnPhaseExecuteAutoLearning(this, sessionId, options);
  }

  async emergencyStopLearning(sessionId: string, reason = 'admin-emergency-stop'): Promise<{
    success: boolean;
    error?: string;
  }> {
    return learnPhaseEmergencyStopLearning(this, sessionId, reason);
  }

  async requestStopLearning(sessionId: string, reason = 'admin-emergency-stop'): Promise<{
    success: boolean;
    deferred?: boolean;
    alreadyStopped?: boolean;
    error?: string;
  }> {
    return learnPhaseRequestStopLearning(this, sessionId, reason);
  }

  async restartPathPhase(sessionId: string): Promise<{
    success: boolean;
    learningPathId?: string;
    error?: string;
  }> {
    return learnPhaseRestartPathPhase(this, sessionId);
  }

  async restartLearningPhase(sessionId: string, options: { taskId?: string } = {}): Promise<{
    success: boolean;
    teachingSessionId?: string;
    welcomeMessage?: string;
    milestones?: SimulationMilestone[];
    selectedTaskId?: string;
    error?: string;
  }> {
    return learnPhaseRestartLearningPhase(this, sessionId, options);
  }

  async findFirstRunnableTaskId(sessionId: string): Promise<string | null> {
    return learnPhaseFindFirstRunnableTaskId(this, sessionId);
  }

  async generateWrapupForSession(sessionId: string): Promise<{ success: boolean; error?: string }> {
    return learnPhaseGenerateWrapupForSession(this, sessionId);
  }
}

const simulationOrchestrator = new SimulationOrchestrator();

export default simulationOrchestrator;
export { SimulationOrchestrator };
