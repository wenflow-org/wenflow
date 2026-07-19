import { randomUUID } from 'crypto';
import learningService from '../learning/learning.service';
import aiTeachingCoordinator from './AITeachingCoordinator';
import {
  getSessionFinalizationState,
  type FinalizeAction,
  type SessionFinalizationState
} from './SessionFinalizationPolicy';
import {
  teachingSessionRepository,
  type TeachingSessionRecord
} from './TeachingSessionRepository';

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

export class SessionFinalizationService {
  async finalize(input: FinalizeSessionInput) {
    const session = await teachingSessionRepository.assertOwnership(input.sessionId, input.userId);
    const operationId = input.operationId || randomUUID();

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
        operationId
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
      return this.completedResponse(claim.session, operationId, {
        status: 'completed',
        alreadyCompleted: true
      });
    }

    try {
      const completion = await learningService.completeTask({
        taskId: session.taskId,
        userId: session.userId,
        actualMinutes: input.actualMinutes,
        subjectiveDifficulty: input.subjectiveDifficulty
      });
      const completedSession = await teachingSessionRepository.completeFinalizationStep(
        input.sessionId,
        claim.operationId,
        'complete_task'
      );
      return this.completedResponse(completedSession, claim.operationId, {
        status: 'completed',
        alreadyCompleted: completion.alreadyCompleted === true
      });
    } catch (error) {
      const code = typeof (error as any)?.code === 'string'
        ? (error as any).code
        : 'TASK_COMPLETION_FAILED';
      await teachingSessionRepository.failFinalization(
        input.sessionId,
        claim.operationId,
        'complete_task',
        code
      );
      throw error;
    }
  }

  async getStatus(sessionId: string, userId: string) {
    let session = await teachingSessionRepository.assertOwnership(sessionId, userId);
    if (
      session.operationId
      && session.operationKind?.startsWith('finalize:')
      && (!session.operationLeaseExpiresAt || session.operationLeaseExpiresAt <= new Date())
    ) {
      const action = session.operationKind.slice('finalize:'.length) as FinalizeAction;
      if (action === 'end_only' || action === 'complete_task' || action === 'complete_review') {
        await teachingSessionRepository.failFinalization(
          session.id,
          session.operationId,
          action,
          'FINALIZATION_LEASE_EXPIRED'
        );
        session = await teachingSessionRepository.assertOwnership(sessionId, userId);
      }
    }
    const state = finalizationState(session);
    return {
      operationId: session.operationId || state?.lastOperationId || null,
      status: session.operationId && session.operationKind?.startsWith('finalize:')
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
