import { randomUUID } from 'crypto';
import type { TeachingScenarioContext, InteractionMetaRecord } from './TeachingContextBuilder';
import { logger } from '../../utils/logger';
import prisma from '../../config/database';
import {
  teachingSessionRepository,
  type TeachingSessionOperationClaim,
} from './TeachingSessionRepository';
import {
} from '../learner/anchor-probe';
import {
} from './anchor-probe-emit';
import {
} from './teaching-classroom-flow';
import {
} from './teaching-knowledge-state';
import {
} from './teaching-session-views';
import {
} from './teaching-turn-shared';
import { generateOpening as generateOpeningImpl, processStudentMessage as processStudentMessageImpl } from './teaching-turn-engine';
import {
  recordTaskDifficultyAnchor as recordTaskDifficultyAnchorImpl,
  startSession as startSessionImpl,
  endSession as endSessionImpl,
  loadRetrievabilityHints as loadRetrievabilityHintsImpl,
} from './teaching-session-lifecycle';
import {
  getSessionHistory as getSessionHistoryImpl,
  getSessionDetail as getSessionDetailImpl,
  submitCheckpoint as submitCheckpointImpl,
  judgeCheckpointSubmission as judgeCheckpointSubmissionImpl,
  pauseSession as pauseSessionImpl,
  resumeSession as resumeSessionImpl,
  resetSession as resetSessionImpl,
  syncVirtualSessionTimeout as syncVirtualSessionTimeoutImpl,
  getLatestTaskEvaluation as getLatestTaskEvaluationImpl,
  applyTimeoutWrapupFallback as applyTimeoutWrapupFallbackImpl,
  processPeerMessage as processPeerMessageImpl,
} from './teaching-session-ops';
export {buildSessionOpeningScene, buildReplanAttributionEvidence, RECOVERY_WINDOW_MS } from './teaching-session-lifecycle';
export {pickPeerStrategy, computeSessionEvidence } from './teaching-session-views';
export {KnowledgePointStatus } from './teaching-knowledge-state';
import { parseSessionArtifacts } from './checkpoint-shared';
export {WARMUP_FUZZY_MIN_LENGTH, WARMUP_FUZZY_OVERLAP_MIN } from './teaching-warmup';
export {CHECKPOINT_MIN_TURNS, CHECKPOINT_TRIGGER_MIN_UNDERSTANDING, parseSessionArtifacts } from './checkpoint-shared';
import {
  CheckpointSubmitPayload,
  CheckpointSubmitResult,
  CheckpointCodeJudgement,
} from './teaching-checkpoint';

export {
  matchWarmupItem,
  pendingWarmupForModel,
  resolveTurnMemoryWarmup,
  extractWarmupOutcomes,
  stripWarmupPoints,
  markWarmupAsked,
  mergeWarmupOutcomes,
} from './teaching-warmup';
export {
  TeachingCheckpoint,
  CheckpointSubmitPayload,
  CheckpointSubmitResult,
  CheckpointCodeJudgement,
  judgeCheckpointAnswer,
  stripCheckpointAnswerKeys,
  getPendingCheckpoint,
  checkpointForMessageResult,
  inheritTeachingState,
  shouldEmitCheckpoint,
  summarizeCheckpointHistory,
  resolveAnchorProbeTarget,
  recordCheckpointResultEvidence,
  recordAnchorProbeResult,
} from './teaching-checkpoint';

export type TeachingMode = 'tutor' | 'peer' | 'debate';

export interface TeachingSessionStartInput {
  userId: string;
  taskId: string;
  /** 会话模式：tutor（默认教学）/ review（复习课，knowledgeState 注入到期复习点） */
  mode?: 'tutor' | 'review';
}

export interface TeachingOpening {
  message: string;
  question: string;
  quickReplies: Array<{ text: string }>;
  mode: 'self-assess' | 'predict' | 'example-first';
}

export type SessionResumeMode = 'new' | 'resumed';

/** 开场景卡片元数据（供前端开场 UI 结构化渲染，区分首课/续课/重学/恢复/复习） */
export interface SessionOpeningScene {
  kind: 'first' | 'continuation' | 'relearn' | 'resume' | 'review';
  /** 卡片主标题（面向学习者的人话，如「这节课是 X 的延续」） */
  title: string;
  /** 衔接素材：上一课的摘要 / 卡点（有则展示在卡片上） */
  recap?: {
    topic: string | null;
    summary: string | null;
    retrievalCue: string | null;
    unresolved: string[];
    /** 位置关系：same-milestone-prev-task / prev-milestone / same-task / last-any */
    relation?: string | null;
    sourceStage?: number | null;
    sourceTitle?: string | null;
  } | null;
  /** 同任务重学次数（≥2 表示这是重学） */
  attempt?: number;
  /** 前序阶段掌握度（供"基础稳不稳"提示） */
  mastery?: Array<{ stage: number; title: string; state: 'unknown' | 'partial' | 'stable' | 'at-risk' }>;
}

export interface ProcessStudentMessageOptions {
  operationClaim?: TeachingSessionOperationClaim;
  checkpointId?: string;
  /** 检查点的**代码裁决**结果（提交侧按答案键算出；缺省 = 无答案键，退回模型派生判定） */
  checkpointJudgement?: CheckpointCodeJudgement | null;
  /** 原始作答（供检查点结果留痕；不含答案键） */
  checkpointSubmission?: { selectedOptionIds?: string[]; answerText?: string };
  expectedRevision?: number;
  /** 前端交互特征（认知负荷量测 · 前端情报层）：随学生消息落库并注入教学上下文 */
  interactionMeta?: InteractionMetaRecord | null;
  /**
   * 回合类型：默认 message（学生真实输入）；'resume-continue' = 断线恢复后的纯续讲回合——
   * 无学生新输入，不落库伪 user 消息，teaching-turn 仅凭历史 + session-resumed 事件自然接续。
   */
  kind?: 'message' | 'resume-continue';
}

export class AITeachingOrchestrator {
  private idleTimeoutMs = 120 * 60 * 1000;
  /** 长时间未恢复的 paused 会话视为放弃：超过该阈值按超时兜底处理（用户可随时通过下一轮教学回合恢复） */
  private pausedSessionTimeoutMs = 24 * 60 * 60 * 1000;
  /** 终态脏数据保留期：failed/superseded/discarded 行超过该时长后由 idle 巡检清理 */
  private terminalSessionRetentionMs = 30 * 24 * 60 * 60 * 1000;
  /** 收束失败自愈（报告 #3）：失败后到自动重试的冷却期，避免与用户重试/在途租约打架 */
  private finalizationRetryCooldownMs = 2 * 60 * 1000;
  /** 收束失败自愈的自动重试次数上限（记在 operation.attemptCount） */
  private finalizationAutoRetryCap = 3;
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
        // 防御：巡检失败时日志器本身也可能被替换/不完整（测试替身），日志失败不应拖垮进程
        logger.warn?.('[AITeaching] idle session scan failed', {
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

  /**
   * 难度调整锚点：开课时把本节难度判定留痕，供"这个调整到底有没有用"与下一条同路径状态对账。
   *
   * 为什么放生产：此前 `recordTaskDifficultyAdjustment` 的唯一调用者是模拟脚本，
   * 于是效果度量（`relieved` / `still_triggered`）在真实课上从未运行过——只能看过程，不能审计。
   *
   * 口径（诚实边界，与台账注释一致）：
   * - 只留"有调整理由"的锚点（无理由即无调整，无从度量）；
   * - `applied` = 档位**真的变了**（`adjusted !== baseline`）。生产把档位注入提示词，学生看到的
   *   就是调整后的难度；生产**没有随机对照组**，因此 `applied=false` 的自然对照只来自
   *   "理由触发但被地板/上限吃掉、档位没动"这类情形——它同样进对照统计，不是假对照；
   * - 幂等键 = `taskId`（重复开课/恢复只更新同一条锚点）；
   * - `occurredAt` 用模拟时钟（虚拟实验室回放历史日期时必须与状态写入同一时钟）。
   */
  private async recordTaskDifficultyAnchor(
    context: TeachingScenarioContext,
    sessionId: string,
  ): Promise<void> {
    return recordTaskDifficultyAnchorImpl(context, sessionId);
  }

  async startSession(input: TeachingSessionStartInput) {
    return startSessionImpl(input);
  }

  async endSession(
    sessionId: string,
    endReason = 'manual-end',
    expectedRevision?: number,
    requestedOperationId: string = randomUUID(),
    requestedRequestHash?: string,
    requestedRequestJson?: string
  ) {
    return endSessionImpl(sessionId, endReason, expectedRevision, requestedOperationId, requestedRequestHash, requestedRequestJson);
  }

  private async loadRetrievabilityHints(userId: string): Promise<Array<{ concept: string; retrievability: number }>> {
    return loadRetrievabilityHintsImpl(userId);
  }

  private async generateOpening(context: TeachingScenarioContext): Promise<TeachingOpening> {
    return generateOpeningImpl(context);
  }

  async processStudentMessage(
    sessionId: string,
    message: string,
    options: ProcessStudentMessageOptions = {},
  ) {
    return processStudentMessageImpl(sessionId, message, options);
  }


  async getSessionHistory(userId: string) {
    return getSessionHistoryImpl(userId);
  }

  async getSessionDetail(sessionId: string, userId: string) {
    return getSessionDetailImpl(sessionId, userId);
  }

  async submitCheckpoint(
    sessionId: string,
    checkpointId: string,
    payload: CheckpointSubmitPayload,
    expectedRevision?: number,
  ): Promise<CheckpointSubmitResult> {
    return submitCheckpointImpl(sessionId, checkpointId, payload, expectedRevision);
  }

  async judgeCheckpointSubmission(
    sessionId: string,
    checkpointId: string,
    payload: { selectedOptionIds?: string[]; answerText?: string }
  ): Promise<{ passed: boolean; judgedBy: string; detail: string | null } | null> {
    return judgeCheckpointSubmissionImpl(sessionId, checkpointId, payload);
  }

  async pauseSession(
    sessionId: string,
    userId: string,
    reason: 'manual' | 'pagehide' | 'hidden' = 'manual',
    expectedRevision?: number
  ): Promise<number> {
    return pauseSessionImpl(sessionId, userId, reason, expectedRevision);
  }

  async resumeSession(
    sessionId: string,
    userId: string,
    expectedRevision?: number
  ): Promise<number> {
    return resumeSessionImpl(sessionId, userId, expectedRevision);
  }

  async resetSession(sessionId: string, userId: string, expectedRevision?: number): Promise<number> {
    return resetSessionImpl(sessionId, userId, expectedRevision);
  }

  private async syncVirtualSessionTimeout(sessionId: string): Promise<void> {
    return syncVirtualSessionTimeoutImpl(sessionId);
  }

  async getLatestTaskEvaluation(taskId: string, userId: string) {
    return getLatestTaskEvaluationImpl(taskId, userId);
  }

  private async applyTimeoutWrapupFallback(sessionId: string): Promise<void> {
    return applyTimeoutWrapupFallbackImpl(sessionId);
  }

  async processPeerMessage(
    sessionId: string,
    message: string
  ) {
    return processPeerMessageImpl(sessionId, message);
  }

  /**
   * 收束失败有界自愈（全量测试报告 #3）。
   *
   * 候选：status='finalization_failed' 且距上次写入超过冷却期（默认 2 分钟）的会话；
   * 预算：自动重试使用稳定幂等键 `auto-finalize-retry:<sessionId>`——claimFinalization 的
   * re-claim 路径会自增 attemptCount，天然做持久化计数；attemptCount ≥ 上限（3）或最近一次
   * 失败被标记 retryable=false（如持久化失败）时放弃，交给「下次开课 supersede」与人工。
   * 幂等与并发：收束受理后会话转 finalizing（不再是候选），不会重复触发；失败则由本方法
   * 下一轮巡检在冷却后接续。
   */
  private async retryFailedFinalizations(): Promise<number> {
    const candidates = await prisma.teaching_sessions.findMany({
      where: {
        status: 'finalization_failed',
        updatedAt: { lte: new Date(Date.now() - this.finalizationRetryCooldownMs) },
      },
      orderBy: { updatedAt: 'asc' },
      take: 5,
      select: { id: true, userId: true, revision: true, teachingState: true },
    });
    if (candidates.length === 0) return 0;

    let retried = 0;
    for (const session of candidates) {
      const retryKey = `auto-finalize-retry:${session.id}`;
      try {
        const [retryLedger, latestFailure] = await Promise.all([
          prisma.session_finalization_operations.findUnique({
            where: { sessionId_idempotencyKey: { sessionId: session.id, idempotencyKey: retryKey } },
            select: { status: true, attemptCount: true, retryable: true },
          }),
          prisma.session_finalization_operations.findFirst({
            where: { sessionId: session.id },
            orderBy: { createdAt: 'desc' },
            select: { status: true, retryable: true, errorCode: true },
          }),
        ]);
        if (latestFailure?.status === 'failed' && latestFailure.retryable === false) continue;
        const usedAttempts = retryLedger?.attemptCount || 0;
        const exhausted = retryLedger?.status === 'failed' && usedAttempts >= this.finalizationAutoRetryCap;
        if (exhausted) continue;

        const artifacts = (() => {
          // prisma select 返回的是 JSON 字符串（与 paused 巡检同口径先解析）
          let teachingState: Record<string, any> | null = null;
          try {
            teachingState = session.teachingState ? JSON.parse(String(session.teachingState)) : null;
          } catch {
            teachingState = null;
          }
          return parseSessionArtifacts(teachingState);
        })();
        const endReason = typeof artifacts.endReason === 'string' && artifacts.endReason
          ? artifacts.endReason
          : 'manual-end';
        // 动态导入：SessionFinalizationService 反向依赖本模块的实例（endSession），静态导入成环
        const { sessionFinalizationService } = await import('./SessionFinalizationService');
        const result: { status?: string } = await sessionFinalizationService.finalize({
          sessionId: session.id,
          userId: session.userId,
          action: 'end_only',
          operationId: retryKey,
          revision: session.revision,
          endReason,
        } as never);
        retried += 1;
        logger.info('[AITeaching] 收束失败已自动重试', {
          sessionId: session.id,
          attempt: usedAttempts + 1,
          status: result?.status ?? 'ok',
          lastErrorCode: latestFailure?.errorCode ?? null,
        });
      } catch (error) {
        // 预检失败（revision 竞争/租约占用等）不产生 operation 行：推进冷却时间窗，避免热循环
        await prisma.teaching_sessions
          .updateMany({ where: { id: session.id }, data: { updatedAt: new Date() } })
          .catch(() => undefined);
        logger.warn('[AITeaching] 收束失败自动重试未受理（冷却后下一轮再试）', {
          sessionId: session.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return retried;
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

    // M4 兜底：paused 是客户端主动暂停，不短时打断；但 pausedAt 超过阈值（如 24h）视为放弃，
    // 走与 active 超时相同的兜底路径（状态转 timeout + summary-only wrapup）。
    // 用户之后可通过下一轮教学回合恢复（active/paused/timeout 均可），正常收束会覆盖兜底 wrapup。
    const pausedCutoff = new Date(Date.now() - this.pausedSessionTimeoutMs);
    const pausedSessions = await prisma.teaching_sessions.findMany({
      where: { status: 'paused' },
      select: {
        id: true,
        revision: true,
        teachingState: true,
      }
    });

    for (const session of pausedSessions) {
      let teachingState: Record<string, any> | null = null;
      try {
        teachingState = JSON.parse(session.teachingState || '{}');
      } catch {
        teachingState = null;
      }
      const artifacts = parseSessionArtifacts(teachingState);
      const pausedAt = typeof artifacts.pausedAt === 'string'
        ? new Date(artifacts.pausedAt).getTime()
        : NaN;
      if (!Number.isFinite(pausedAt) || pausedAt > pausedCutoff.getTime()) continue;
      const timedOut = await teachingSessionRepository.timeoutIfPaused(session.id, session.revision, pausedCutoff);
      if (timedOut) {
        logger.info('[AITeaching] 长时间未恢复的暂停会话按超时兜底处理', {
          sessionId: session.id,
          pausedAt: new Date(pausedAt).toISOString(),
        });
        await this.syncVirtualSessionTimeout(session.id);
        await this.applyTimeoutWrapupFallback(session.id);
      }
    }

    // 收束失败自愈（全量测试报告 #3）：finalization_failed 且失败可重试的会话，冷却后自动走
    // 应用自己的收束路径重试（预算 ≤3 次，记在 session_finalization_operations.attemptCount）。
    // 此前只有「下次开课 supersede」一条出路：课堂 wrapup/endTime 永久为空，前端提示「重新进入」
    // 也不改变状态（真实案例 teaching_7d44d6de…：end_only 收束上游超时 FINALIZATION_PROVIDER_TIMEOUT，
    // retryable=true，挂 45 分钟无人接）。
    try {
      await this.retryFailedFinalizations();
    } catch (error) {
      logger.warn('[AITeaching] 收束失败自愈巡检出错（不影响其它巡检）', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // 终态脏数据治理：failed/superseded/discarded 行无业务价值（开课失败已改为复用 openKey），
    // 超过保留期后删除，避免会话表无限累积
    try {
      const terminalCutoff = new Date(Date.now() - this.terminalSessionRetentionMs);
      const cleaned = await prisma.teaching_sessions.deleteMany({
        where: {
          status: { in: ['failed', 'superseded', 'discarded'] },
          updatedAt: { lte: terminalCutoff }
        }
      });
      if (cleaned.count > 0) {
        logger.info('[AITeaching] 清理过期终态会话行', {
          count: cleaned.count,
          cutoff: terminalCutoff.toISOString(),
        });
      }
    } catch (error) {
      logger.warn('[AITeaching] 终态会话清理失败（不影响巡检）', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

// 辅助函数：将扩展的 taskType 映射到基础的 4 种类型（用于学习状态指标计算）
export function normalizeTaskTypeForMetrics(
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
