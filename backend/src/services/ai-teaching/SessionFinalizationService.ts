import { createHash, randomUUID } from 'crypto';
import learningService from '../learning/learning.service';
import aiTeachingCoordinator from './AITeachingCoordinator';
import { classifyFinalizationError } from './FinalizationErrors';
import {
  getSessionFinalizationState,
  type FinalizeAction,
  type SessionFinalizationState
} from './SessionFinalizationPolicy';
import {
  teachingSessionRepository,
  type TeachingSessionRecord
} from './TeachingSessionRepository';
import { logger } from '../../utils/logger';
import { FinalizationLeaseGuard } from './FinalizationLeaseGuard';
import { memoryTraceService } from '../memory/memory-trace.service';
import { mapReviewStatusToRating } from '../learner/ReviewCompletedConsumer';
import { createDomainEvent } from '../../events/contracts';
import { enqueueDomainEvent } from '../../events/outbox.repository';
import prisma from '../../config/database';

export interface FinalizeSessionInput {
  sessionId: string;
  userId: string;
  action: FinalizeAction;
  operationId?: string;
  revision?: number;
  actualMinutes?: number;
  subjectiveDifficulty?: number;
  endReason?: 'manual-end' | 'learner-abandoned' | 'task-completed';
}

function finalizationState(session: TeachingSessionRecord): SessionFinalizationState | null {
  const stored = getSessionFinalizationState(session.teachingState);
  if (stored) return stored;
  if (session.status !== 'completed' || !session.wrapup) return null;
  return {
    sessionClosure: 'completed',
    taskCompletion: 'not_started',
    reviewCompletion: 'not_started',
    lastAction: 'end_only',
    lastOperationId: '',
    lastRequestedAt: session.updatedAt.toISOString(),
    lastCompletedAt: (session.endTime || session.updatedAt).toISOString()
  };
}

function finalizationRequest(input: FinalizeSessionInput): Record<string, unknown> {
  return {
    action: input.action,
    actualMinutes: input.actualMinutes ?? null,
    subjectiveDifficulty: input.subjectiveDifficulty ?? null,
    endReason: input.endReason ?? null
  };
}

function finalizationRequestIdentity(input: FinalizeSessionInput) {
  const requestJson = JSON.stringify(finalizationRequest(input));
  return {
    requestJson,
    requestHash: createHash('sha256').update(requestJson).digest('hex')
  };
}

/**
 * 同一次 finalize(complete_task) 内部会先自动 end_only（关课堂）再 complete_task（任务结算）。
 * 两步若共用同一个客户端 Idempotency-Key，会撞 session_finalization_operations 的
 * (sessionId, idempotencyKey) 唯一键：第二步被幂等守卫判为「同 key 不同请求」而 409
 * FINALIZATION_IDEMPOTENCY_KEY_REUSED，导致课堂关了但任务不结算。
 * 这里派生出确定性的独立键——同一次客户端请求重放仍幂等，同时与 complete_task 的键隔离。
 */
function derivedClosureOperationId(operationId: string): string {
  return `${operationId}#closure`;
}

export interface WarmupReviewItem {
  conceptKey: string;
  label: string | null;
  status: string;
  progress: number;
  masteryScore: number;
  rating: ReturnType<typeof mapReviewStatusToRating>['rating'];
}

/** 温故点在会话里的持久化子集（ReviewPlanItem 的收束侧视图） */
interface PersistedWarmupItem {
  conceptKey?: string;
  label?: string;
  outcome?: { status?: string; progress?: number } | null;
  askedAt?: string;
}

/**
 * 收集要回写记忆引擎的温故点（收束时）：
 * 1. **有结果**的点（mastered / learning）→ 按结果映射评分；
 * 2. **问过了但始终没推进**（有 `askedAt`、无 `outcome`）且学习者在该点之后**还有发言**
 *    → 判为**没答出**（again）。这是"失败"唯一的入库通道：不记失败，成功率与保持曲线就只剩上界，
 *    leech（连续答不出）与队列自净也永远不会触发（审计 §3.9 / §3.11）。
 *    若该点是最后一轮才问出来的（其后没有学习者发言），不计——那是"没来得及答"，不是"答不出"。
 */
export function collectWarmupReviewItems(
  items: PersistedWarmupItem[] | null | undefined,
  hasLearnerTurnAfter: (iso: string) => boolean,
): WarmupReviewItem[] {
  const result: WarmupReviewItem[] = [];
  for (const item of items || []) {
    const conceptKey = String(item?.conceptKey || '').trim();
    if (!conceptKey) continue;
    const label = typeof item?.label === 'string' ? item.label : null;

    if (item?.outcome?.status) {
      const status = String(item.outcome.status);
      const progress = Number(item.outcome.progress) || 0;
      const { rating, masteryScore } = mapReviewStatusToRating(status, progress);
      result.push({ conceptKey, label, status, progress, masteryScore, rating });
      continue;
    }

    if (item?.askedAt && hasLearnerTurnAfter(String(item.askedAt))) {
      // 'not-recalled' 不是看板状态，只是回写口径：映射器对未知状态回落为 again
      const { rating, masteryScore } = mapReviewStatusToRating('not-recalled', 0);
      result.push({ conceptKey, label, status: 'not-recalled', progress: 0, masteryScore, rating });
    }
  }
  return result;
}

/** 该时刻之后学习者是否还有发言（= 确实给了作答机会） */
export function hasLearnerTurnAfter(session: TeachingSessionRecord, iso: string): boolean {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return false;
  const messages = Array.isArray(session.messages) ? session.messages : [];
  return messages.some((message) => {
    if ((message as { role?: string })?.role !== 'user') return false;
    const ts = Date.parse(String((message as { timestamp?: string })?.timestamp || ''));
    return Number.isFinite(ts) && ts > at;
  });
}

export class SessionFinalizationService {
  async finalize(input: FinalizeSessionInput) {
    const session = await teachingSessionRepository.assertOwnership(input.sessionId, input.userId);
    const operationId = input.operationId || randomUUID();
    const requestIdentity = finalizationRequestIdentity(input);

    if (input.action === 'complete_review') {
      // 复习课完成：走标准收束（wrapup + lesson:completed），随后把看板中已推进
      // （非 review/pending）的复习点回写记忆引擎（复习即提取，extractionCount+1、lastSeenAt 刷新）
      const result = await aiTeachingCoordinator.endSession(
        input.sessionId,
        input.endReason || 'review-completed',
        input.revision,
        operationId,
        requestIdentity.requestHash,
        requestIdentity.requestJson
      );
      if (result.status === 'processing') {
        return {
          operationId: result.operationId,
          status: 'processing' as const,
          pollAfterMs: 1500,
          revision: result.revision
        };
      }
      const completedSession = await teachingSessionRepository.assertOwnership(input.sessionId, input.userId);
      // 复习课完成标记：前端以 reviewCompletion==='completed' 判定收束完成（否则永远走兜底文案）
      if (completedSession.status === 'completed' && completedSession.wrapup) {
        await teachingSessionRepository.markReviewCompleted(input.sessionId).catch((error) => {
          logger.warn('[finalize] 复习课完成标记写入失败（不影响收束）:', error);
        });
      }
      // 断链修复 P0-1/2：复习结果回写记忆引擎（fire-and-forget 保留）+ 事件化（走 outbox 事件链）
      const reviewItems = await this.applyReviewExtraction(completedSession);
      if (reviewItems.length > 0) {
        await this.enqueueReviewCompletedEvent(completedSession, reviewItems);
      }
      return this.completedResponse(completedSession, result.operationId, {
        status: 'skipped',
        alreadyCompleted: false
      });
    }

    if (input.action === 'end_only') {
      const result = await aiTeachingCoordinator.endSession(
        input.sessionId,
        input.endReason || 'manual-end',
        input.revision,
        operationId,
        requestIdentity.requestHash,
        requestIdentity.requestJson
      );
      if (result.status === 'processing') {
        return {
          operationId: result.operationId,
          status: 'processing' as const,
          pollAfterMs: 1500,
          revision: result.revision
        };
      }
      const completedSession = await teachingSessionRepository.assertOwnership(input.sessionId, input.userId);
      await this.applyWarmupExtraction(completedSession);
      return this.completedResponse(completedSession, result.operationId, {
        status: 'skipped',
        alreadyCompleted: false
      });
    }

    if (session.mode === 'review') {
      const error = new Error('复习课堂不能完成原任务');
      (error as any).code = 'FINALIZATION_ACTION_MODE_MISMATCH';
      (error as any).status = 409;
      throw error;
    }
    const activeFinalization = session.operationId
      && session.operationKind?.startsWith('finalize:')
      && session.operationLeaseExpiresAt
      && session.operationLeaseExpiresAt > new Date();
    if ((session.status !== 'completed' || !session.wrapup) && !activeFinalization) {
      // complete_task 前置要求会话已结束（completed + wrapup），但前端 finish('complete_task')
      // 不会先调 end——这里与 end_only/complete_review 一致，自动先结束课堂生成 wrapup，
      // 否则教学完成后的自动收束必然 409 FINALIZATION_SESSION_NOT_CLOSED（真实用户高频场景）
      const endResult = await aiTeachingCoordinator.endSession(
        input.sessionId,
        // 固定记为 task-completed：这是「为完成任务而自动关课」，同时作为重进补结算的标记
        // （用户主动「结束学习（不计入完成）」走 end_only 分支，reason 仍是 manual-end，不会被误结算）
        'task-completed',
        input.revision,
        // 关键：自动 end_only 用派生键，不能与下面的 complete_task 共用客户端 Idempotency-Key，
        // 否则 (sessionId,key) 唯一键冲突 → FINALIZATION_IDEMPOTENCY_KEY_REUSED。
        // 不传 requestHash/requestJson：交由 endSession 生成 end_only 自身的请求身份，
        // 避免该行出现「action=end_only、requestJson 却是 complete_task」的记录。
        derivedClosureOperationId(operationId)
      );
      if (endResult.status === 'processing') {
        return {
          operationId: endResult.operationId,
          status: 'processing' as const,
          pollAfterMs: 1500,
          revision: endResult.revision
        };
      }
      const ended = await teachingSessionRepository.assertOwnership(input.sessionId, input.userId);
      if (ended.status !== 'completed' || !ended.wrapup) {
        const error = new Error('请先结束课堂并生成学习反馈');
        (error as any).code = 'FINALIZATION_SESSION_NOT_CLOSED';
        (error as any).status = 409;
        throw error;
      }
    }

    const claim = await teachingSessionRepository.claimFinalization(
      input.sessionId,
      'complete_task',
      operationId,
      requestIdentity.requestHash,
      requestIdentity.requestJson,
      input.revision
    );
    if (claim.status === 'processing') {
      return {
        operationId: claim.operationId,
        status: 'processing' as const,
        pollAfterMs: 1500,
        revision: claim.session.revision
      };
    }
    if (claim.status === 'completed') {
      const replayedTaskCompletion = claim.result?.taskCompletion;
      return this.completedResponse(claim.session, operationId, {
        status: 'completed',
        alreadyCompleted: replayedTaskCompletion?.alreadyCompleted !== false
      });
    }

    const leaseGuard = new FinalizationLeaseGuard(input.sessionId, claim.operationId, claim.leaseOwner);
    leaseGuard.start();
    try {
      const completion = await learningService.completeTask({
        taskId: session.taskId,
        userId: session.userId,
        actualMinutes: input.actualMinutes,
        subjectiveDifficulty: input.subjectiveDifficulty
      });
      await leaseGuard.assertOwned();
      const completedSession = await teachingSessionRepository.completeFinalizationStep(
        input.sessionId,
        claim.operationId,
        claim.leaseOwner,
        'complete_task'
        , {
          taskCompletion: {
            status: 'completed',
            alreadyCompleted: completion.alreadyCompleted === true
          }
        }
      );
      await this.applyWarmupExtraction(completedSession);
      return this.completedResponse(completedSession, claim.operationId, {
        status: 'completed',
        alreadyCompleted: completion.alreadyCompleted === true
      });
    } catch (error) {
      const info = classifyFinalizationError(error);
      try {
        await teachingSessionRepository.failFinalization(
          input.sessionId,
          claim.operationId,
          claim.leaseOwner,
          'complete_task',
          info.code === 'FINALIZATION_PERSISTENCE_FAILED' ? 'TASK_COMPLETION_FAILED' : info.code,
          info.retryable
        );
      } catch (markError) {
        logger.error('[Finalization] 任务完成失败状态持久化失败', {
          sessionId: input.sessionId,
          operationId: claim.operationId,
          error: markError instanceof Error ? markError.message : String(markError)
        });
      }
      throw error;
    } finally {
      await leaseGuard.stop();
    }
  }

  async getStatus(sessionId: string, userId: string) {
    let session = await teachingSessionRepository.assertOwnership(sessionId, userId);
    if (
      session.operationId
      && session.operationKind?.startsWith('finalize:')
      && (!session.operationLeaseExpiresAt || session.operationLeaseExpiresAt <= new Date())
    ) {
      await teachingSessionRepository.recoverExpiredFinalizations(1, sessionId, session.operationId);
      session = await teachingSessionRepository.assertOwnership(sessionId, userId);
    }
    const state = finalizationState(session);
    const isProcessing = !!(
      session.operationId
      && session.operationKind?.startsWith('finalize:')
      && session.operationLeaseExpiresAt
      && session.operationLeaseExpiresAt > new Date()
    );
    return {
      operationId: state?.lastOperationId || null,
      status: isProcessing
        ? 'processing'
        : session.status === 'finalization_failed' || state?.taskCompletion === 'failed'
          ? 'failed'
          : session.status === 'completed' ? 'completed' : 'not_started',
      revision: session.revision,
      session: {
        id: session.id,
        status: session.status,
        mode: session.mode
      },
      finalization: state,
      wrapup: session.wrapup,
      advisory: session.advisory,
      projectionStatus: session.status === 'completed' ? 'pending' : 'not_started'
    };
  }

  private completedResponse(
    session: TeachingSessionRecord,
    operationId: string,
    taskCompletion: { status: 'completed' | 'skipped'; alreadyCompleted: boolean }
  ) {
    return {
      operationId,
      status: 'completed' as const,
      revision: session.revision,
      session: {
        id: session.id,
        status: session.status,
        mode: session.mode
      },
      taskCompletion,
      wrapup: session.wrapup,
      advisory: session.advisory,
      reviewItems: [],
      projectionStatus: 'pending' as const,
      finalization: finalizationState(session)
    };
  }

  /**
   * 复习课完成回写：看板中已推进（非 review/pending）的复习点 → 记忆引擎 recordExtraction
   * （复习即提取：extractionCount+1、lastSeenAt 刷新；best-effort，失败不阻断收束）
   * 返回已推进的复习点列表（供 review:completed 事件发出）。
   */
  private async applyReviewExtraction(session: TeachingSessionRecord): Promise<Array<{
    conceptKey: string;
    label: string | null;
    status: string;
    progress: number;
    masteryScore: number;
    rating: 'again' | 'hard' | 'good' | 'easy';
  }>> {
    try {
      const points = Array.isArray(session.knowledgeState)
        ? session.knowledgeState
        : (() => {
            try {
              const parsed = typeof session.knowledgeState === 'string' ? JSON.parse(session.knowledgeState) : session.knowledgeState;
              return Array.isArray(parsed) ? parsed : [];
            } catch {
              return [];
            }
          })();
      const progressed = points.filter(
        (p: any) => p && typeof p.name === 'string' && p.status && p.status !== 'review' && p.status !== 'pending'
      );
      if (progressed.length === 0) return [];
      const items: Array<{
        conceptKey: string;
        label: string | null;
        status: string;
        progress: number;
        masteryScore: number;
        rating: 'again' | 'hard' | 'good' | 'easy';
      }> = [];
      for (const p of progressed) {
        const mastery = p.status === 'mastered' ? (Number(p.progress) >= 100 ? 0.9 : 0.85) : 0.5;
        const rating = p.status === 'mastered' ? (Number(p.progress) >= 100 ? 'easy' : 'good') : 'hard';
        const fsrsGrade = rating === 'easy' ? 4 : rating === 'good' ? 3 : rating === 'hard' ? 2 : 1;
        items.push({
          conceptKey: p.name,
          label: p.name,
          status: p.status,
          progress: Number(p.progress) || 0,
          masteryScore: mastery,
          rating: rating as 'again' | 'hard' | 'good' | 'easy',
        });
        await memoryTraceService.recordExtraction({
          userId: session.userId,
          conceptKey: p.name,
          label: p.name,
          masteryScore: mastery,
          stability: p.status === 'mastered' ? 'stable' : 'fragile',
          source: 'derived',
          pathId: session.learningPathId ?? null,
          fsrsGrade: fsrsGrade as 1 | 2 | 3 | 4,
        });
        // FSRS-6 DSR 调度：复习成功按成绩更新 stability/difficulty
        await memoryTraceService.bumpReviewInterval(session.userId, p.name, fsrsGrade as 1 | 2 | 3 | 4);
      }
      logger.info('[SessionFinalization] 复习完成回写记忆引擎', {
        sessionId: session.id,
        userId: session.userId,
        extractionCount: progressed.length,
      });
      return items;
    } catch (error) {
      logger.warn('[SessionFinalization] 复习回写失败（不影响收束）', {
        sessionId: session.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * 复习结果事件化（断链修复 P0-1）：复习课收束后发出 review:completed 事件，
   * 让复习结果走 outbox 事件链（可追溯、可重放、可幂等），替代纯旁路直写。
   */
  /**
   * 课内温故回写（记忆层闭环）：把本堂课内温故的实测结果送进复习事件链。
   * 与复习课同源（review:completed → ReviewCompletedConsumer：写 learner_evidence + FSRS 重排 dueAt），
   * 于是同时闭合两个环：① 调度（下次什么时候再捞）② 动态负担预算（成功率高就多带一个、低就收缩）。
   * 只处理「教学回合真的报告了结果」的点；没接上的点留在计划里，下次课继续。
   */
  private async applyWarmupExtraction(session: TeachingSessionRecord): Promise<void> {
    try {
      const plan = (session.teachingState as Record<string, any> | null)?.sessionArtifacts?.memoryWarmup;
      const items: any[] = Array.isArray(plan?.items) ? plan.items : [];
      const payload = collectWarmupReviewItems(items, (iso) => hasLearnerTurnAfter(session, iso));
      if (payload.length === 0) return;
      await this.enqueueReviewCompletedEvent(session, payload);
      logger.info('[SessionFinalization] 课内温故结果已回写记忆引擎', {
        sessionId: session.id,
        userId: session.userId,
        itemCount: payload.length,
      });
    } catch (error) {
      logger.warn('[SessionFinalization] 课内温故回写失败（不影响收束）', {
        sessionId: session.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async enqueueReviewCompletedEvent(
    session: TeachingSessionRecord,
    items: Array<{
      conceptKey: string;
      label: string | null;
      status: string;
      progress: number;
      masteryScore: number;
      rating: 'again' | 'hard' | 'good' | 'easy';
    }>,
  ): Promise<void> {
    if (items.length === 0) return;
    try {
      const event = createDomainEvent({
        type: 'review:completed',
        aggregateType: 'review',
        aggregateId: session.id,
        userId: session.userId,
        source: 'session-finalization',
        data: {
          sessionId: session.id,
          mode: session.mode || 'review',
          reviewItems: items,
        },
      });
      await prisma.$transaction(async (tx) => {
        await enqueueDomainEvent(tx, event);
      });
      logger.info('[SessionFinalization] review:completed 事件已入队', {
        sessionId: session.id,
        userId: session.userId,
        itemCount: items.length,
      });
    } catch (error) {
      logger.warn('[SessionFinalization] review:completed 事件入队失败（不影响收束）', {
        sessionId: session.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export const sessionFinalizationService = new SessionFinalizationService();
