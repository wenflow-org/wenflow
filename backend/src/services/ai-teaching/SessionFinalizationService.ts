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

export class SessionFinalizationService {
  async finalize(input: FinalizeSessionInput) {
    const session = await teachingSessionRepository.assertOwnership(input.sessionId, input.userId);
    const operationId = input.operationId || randomUUID();
    const requestIdentity = finalizationRequestIdentity(input);

    if (input.action === 'complete_review') {
      const error = new Error('当前版本尚未开放复习完成操作');
      (error as any).code = 'FINALIZATION_ACTION_UNSUPPORTED';
      (error as any).status = 409;
      throw error;
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
      const error = new Error('请先结束课堂并生成学习反馈');
      (error as any).code = 'FINALIZATION_SESSION_NOT_CLOSED';
      (error as any).status = 409;
      throw error;
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
}

export const sessionFinalizationService = new SessionFinalizationService();
