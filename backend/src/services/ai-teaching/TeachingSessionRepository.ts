import { randomUUID } from 'crypto';
import prisma from '../../config/database';
import type { DurableDomainEvent } from '../../events/contracts';
import { enqueueDomainEvent } from '../../events/outbox.repository';
import {
  type FinalizeAction,
  getSessionFinalizationState,
  updateSessionFinalizationState
} from './SessionFinalizationPolicy';

const TEACHING_OPERATION_LEASE_MS = 30 * 60 * 1000;
const RECOVERABLE_SESSION_STATUSES = ['active', 'paused', 'timeout'] as const;

export class TeachingSessionConflictError extends Error {
  readonly status = 409;

  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
    this.name = 'TeachingSessionConflictError';
  }
}

export function isTeachingSessionConflictError(error: unknown): error is TeachingSessionConflictError {
  return error instanceof TeachingSessionConflictError
    || (typeof error === 'object'
      && error !== null
      && (error as any).status === 409
      && typeof (error as any).code === 'string'
      && (error as any).code.startsWith('TEACHING_'));
}

export interface TeachingSessionMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  analysis?: Record<string, any>;
  strategies?: string[];
  knowledgePoint?: string | null;
  knowledgePoints?: TeachingKnowledgePointState[];
  promptDebug?: Record<string, any> | null;
  peerTriggered?: boolean;
  peerMessage?: string | null;
  peerDebug?: Record<string, any> | null;
}

export interface TeachingKnowledgePointState {
  name: string;
  status: 'pending' | 'learning' | 'mastered' | 'review';
  progress: number;
}

export interface TeachingSessionRecord {
  id: string;
  userId: string;
  taskId: string;
  learningPathId?: string | null;
  milestoneId?: string | null;
  subject: string;
  topic: string;
  taskType: string;
  mode: string;
  status: string;
  messages: TeachingSessionMessage[];
  knowledgeState: TeachingKnowledgePointState[];
  teachingState: Record<string, any> | null;
  wrapup: Record<string, any> | null;
  advisory: Record<string, any> | null;
  startTime: Date;
  endTime: Date | null;
  duration: number | null;
  revision: number;
  openKey: string | null;
  operationId: string | null;
  operationKind: string | null;
  operationLeaseExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TeachingSessionOperationClaim {
  operationId: string;
  session: TeachingSessionRecord;
}

export interface TeachingLearningStateCommit {
  userId: string;
  expectedRevision: number;
  sourceKey: string;
  data: Record<string, any>;
}

export type TeachingFinalizationClaim =
  | { status: 'completed'; session: TeachingSessionRecord }
  | { status: 'processing'; operationId: string; session: TeachingSessionRecord }
  | { status: 'claimed'; operationId: string; session: TeachingSessionRecord };

interface CreateTeachingSessionInput {
  id: string;
  userId: string;
  taskId: string;
  learningPathId?: string | null;
  milestoneId?: string | null;
  subject: string;
  topic: string;
  taskType: string;
  mode?: string;
  messages?: TeachingSessionMessage[];
  knowledgeState?: TeachingKnowledgePointState[];
  teachingState?: Record<string, any> | null;
}

function parseJsonSafe<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function mapRecord(record: any): TeachingSessionRecord {
  return {
    id: record.id,
    userId: record.userId,
    taskId: record.taskId,
    learningPathId: record.learningPathId,
    milestoneId: record.milestoneId,
    subject: record.subject,
    topic: record.topic,
    taskType: record.taskType,
    mode: record.mode,
    status: record.status,
    messages: parseJsonSafe(record.messages, []),
    knowledgeState: parseJsonSafe(record.knowledgeState, []),
    teachingState: parseJsonSafe(record.teachingState, null),
    wrapup: parseJsonSafe(record.wrapup, null),
    advisory: parseJsonSafe(record.advisory, null),
    startTime: record.startTime,
    endTime: record.endTime,
    duration: record.duration,
    revision: record.revision || 0,
    openKey: record.openKey || null,
    operationId: record.operationId || null,
    operationKind: record.operationKind || null,
    operationLeaseExpiresAt: record.operationLeaseExpiresAt || null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function buildOpenKey(userId: string, taskId: string): string {
  return `${userId}:${taskId}`;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'P2002';
}

export class TeachingSessionRepository {
  async reserve(
    input: CreateTeachingSessionInput,
    recoveryWindowMs?: number
  ): Promise<{ session: TeachingSessionRecord; created: boolean; operationId: string | null }> {
    const now = new Date();
    const operationId = randomUUID();
    const openKey = buildOpenKey(input.userId, input.taskId);

    try {
      return await prisma.$transaction(async (tx) => {
        const task = await tx.subtasks.findFirst({
          where: { id: input.taskId, userId: input.userId },
          select: { id: true }
        });
        if (!task) throw new Error('任务不存在');
        const lockedTask = await tx.subtasks.updateMany({
          where: { id: input.taskId, userId: input.userId },
          data: { updatedAt: now }
        });
        if (lockedTask.count !== 1) throw new Error('任务不存在');

        let existing = await tx.teaching_sessions.findUnique({
          where: { openKey }
        });
        if (existing) {
          const finalizationLeaseExpired = existing.status === 'finalizing'
            && (!existing.operationLeaseExpiresAt || existing.operationLeaseExpiresAt <= now);
          if (finalizationLeaseExpired) {
            const recovered = await tx.teaching_sessions.updateMany({
              where: {
                id: existing.id,
                revision: existing.revision,
                status: 'finalizing',
                OR: [
                  { operationId: null },
                  { operationLeaseExpiresAt: { lte: now } }
                ]
              },
              data: {
                status: 'finalization_failed',
                operationId: null,
                operationKind: null,
                operationLeaseExpiresAt: null,
                updatedAt: now
              }
            });
            if (recovered.count !== 1) {
              throw new TeachingSessionConflictError('课堂状态已变化，请重试', 'TEACHING_SESSION_STATE_CHANGED');
            }
            existing = await tx.teaching_sessions.findUnique({ where: { id: existing.id } });
            if (!existing) throw new Error('会话不存在');
          }

          const recoveryExpired = recoveryWindowMs !== undefined
            && RECOVERABLE_SESSION_STATUSES.includes(existing.status as any)
            && existing.updatedAt < new Date(now.getTime() - recoveryWindowMs);
          const initializingLeaseExpired = existing.status === 'initializing'
            && (!existing.operationLeaseExpiresAt || existing.operationLeaseExpiresAt <= now);
          const canSupersede = existing.status !== 'finalizing'
            && (recoveryExpired || initializingLeaseExpired);

          if (!canSupersede) {
            return { session: mapRecord(existing), created: false, operationId: null };
          }

          const superseded = await tx.teaching_sessions.updateMany({
            where: {
              id: existing.id,
              revision: existing.revision,
              openKey
            },
            data: {
              status: 'superseded',
              openKey: null,
              operationId: null,
              operationKind: null,
              operationLeaseExpiresAt: null,
              endTime: existing.endTime || now,
              revision: { increment: 1 },
              updatedAt: now
            }
          });
          if (superseded.count !== 1) {
            throw new TeachingSessionConflictError('课堂状态已变化，请重试', 'TEACHING_SESSION_STATE_CHANGED');
          }
        }

        const record = await tx.teaching_sessions.create({
          data: {
            id: input.id,
            userId: input.userId,
            taskId: input.taskId,
            learningPathId: input.learningPathId || null,
            milestoneId: input.milestoneId || null,
            subject: input.subject,
            topic: input.topic,
            taskType: input.taskType,
            mode: input.mode || 'tutor',
            status: 'initializing',
            messages: JSON.stringify(input.messages || []),
            knowledgeState: JSON.stringify(input.knowledgeState || []),
            teachingState: input.teachingState ? JSON.stringify(input.teachingState) : null,
            openKey,
            operationId,
            operationKind: 'start',
            operationLeaseExpiresAt: new Date(now.getTime() + TEACHING_OPERATION_LEASE_MS),
            updatedAt: now,
          }
        });

        return { session: mapRecord(record), created: true, operationId };
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const existing = await prisma.teaching_sessions.findUnique({ where: { openKey } });
      if (!existing) throw error;
      return { session: mapRecord(existing), created: false, operationId: null };
    }
  }

  async completeInitialization(
    sessionId: string,
    operationId: string,
    payload: {
      messages: TeachingSessionMessage[];
      knowledgeState: TeachingKnowledgePointState[];
      teachingState: Record<string, any>;
    }
  ): Promise<TeachingSessionRecord> {
    const updated = await prisma.teaching_sessions.updateMany({
      where: {
        id: sessionId,
        status: 'initializing',
        operationId,
        operationKind: 'start'
      },
      data: {
        status: 'active',
        messages: JSON.stringify(payload.messages),
        knowledgeState: JSON.stringify(payload.knowledgeState),
        teachingState: JSON.stringify(payload.teachingState),
        operationId: null,
        operationKind: null,
        operationLeaseExpiresAt: null,
        revision: { increment: 1 },
        updatedAt: new Date()
      }
    });
    if (updated.count !== 1) {
      throw new TeachingSessionConflictError('课堂启动状态已变化，请重试', 'TEACHING_SESSION_STATE_CHANGED');
    }

    const session = await this.getById(sessionId);
    if (!session) throw new Error('会话不存在');
    return session;
  }

  async failInitialization(sessionId: string, operationId: string): Promise<void> {
    await prisma.teaching_sessions.updateMany({
      where: { id: sessionId, status: 'initializing', operationId },
      data: {
        status: 'failed',
        openKey: null,
        operationId: null,
        operationKind: null,
        operationLeaseExpiresAt: null,
        endTime: new Date(),
        revision: { increment: 1 },
        updatedAt: new Date()
      }
    });
  }

  async getById(sessionId: string): Promise<TeachingSessionRecord | null> {
    const record = await prisma.teaching_sessions.findUnique({
      where: { id: sessionId }
    });

    return record ? mapRecord(record) : null;
  }

  async assertOwnership(sessionId: string, userId: string): Promise<TeachingSessionRecord> {
    const session = await this.getById(sessionId);
    if (!session) {
      throw new Error('会话不存在');
    }
    if (session.userId !== userId) {
      throw new Error('无权访问此会话');
    }
    return session;
  }

  async getActiveByTask(userId: string, taskId: string): Promise<TeachingSessionRecord | null> {
    const record = await prisma.teaching_sessions.findFirst({
      where: {
        userId,
        taskId,
        status: 'active'
      },
      orderBy: { startTime: 'desc' }
    });

    return record ? mapRecord(record) : null;
  }

  async getRecoverableByTask(
    userId: string,
    taskId: string,
    recoveryWindowMs: number,
  ): Promise<TeachingSessionRecord | null> {
    const record = await prisma.teaching_sessions.findFirst({
      where: {
        userId,
        taskId,
        status: { in: [...RECOVERABLE_SESSION_STATUSES] },
        updatedAt: {
          gte: new Date(Date.now() - recoveryWindowMs),
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return record ? mapRecord(record) : null;
  }

  async claimOperation(
    sessionId: string,
    operationKind: string,
    allowedStatuses: string[] = ['active', 'timeout'],
    expectedRevision?: number
  ): Promise<TeachingSessionOperationClaim> {
    const now = new Date();
    const operationId = randomUUID();
    const claimed = await prisma.teaching_sessions.updateMany({
      where: {
        id: sessionId,
        status: { in: allowedStatuses },
        ...(expectedRevision === undefined ? {} : { revision: expectedRevision }),
        OR: [
          { operationId: null },
          { operationLeaseExpiresAt: { lte: now } }
        ]
      },
      data: {
        operationId,
        operationKind,
        operationLeaseExpiresAt: new Date(now.getTime() + TEACHING_OPERATION_LEASE_MS),
        updatedAt: now
      }
    });

    if (claimed.count !== 1) {
      const current = await this.getById(sessionId);
      if (!current) throw new Error('会话不存在或已结束');
      if (expectedRevision !== undefined && current.revision !== expectedRevision) {
        throw new TeachingSessionConflictError('课堂已在其他页面更新，请刷新后继续', 'TEACHING_SESSION_STALE');
      }
      if (current.operationId && current.operationLeaseExpiresAt && current.operationLeaseExpiresAt > now) {
        throw new TeachingSessionConflictError('课堂正在处理另一项操作，请稍后重试', 'TEACHING_SESSION_BUSY');
      }
      throw new TeachingSessionConflictError('当前课堂状态不允许此操作', 'TEACHING_SESSION_STATE_CHANGED');
    }

    const session = await this.getById(sessionId);
    if (!session) throw new Error('会话不存在或已结束');
    return { operationId, session };
  }

  async releaseOperation(sessionId: string, operationId: string): Promise<void> {
    await prisma.teaching_sessions.updateMany({
      where: { id: sessionId, operationId },
      data: {
        operationId: null,
        operationKind: null,
        operationLeaseExpiresAt: null,
        updatedAt: new Date()
      }
    });
  }

  async listByUser(userId: string, limit: number = 50): Promise<TeachingSessionRecord[]> {
    const records = await prisma.teaching_sessions.findMany({
      where: { userId },
      orderBy: { startTime: 'desc' },
      take: limit,
    });

    return records.map(mapRecord);
  }

  async commitTurnState(
    sessionId: string,
    operationId: string,
    payload: {
      messages: TeachingSessionMessage[];
      knowledgeState: TeachingKnowledgePointState[];
      teachingState?: Record<string, any> | null;
      taskId?: string;
      userId?: string;
      markTaskInProgress?: boolean;
      allowedStatuses?: string[];
    }
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.teaching_sessions.updateMany({
        where: {
          id: sessionId,
          operationId,
          status: { in: payload.allowedStatuses || ['active', 'timeout'] }
        },
        data: {
          status: 'active',
          endTime: null,
          duration: null,
          messages: JSON.stringify(payload.messages),
          knowledgeState: JSON.stringify(payload.knowledgeState),
          teachingState: payload.teachingState === undefined
            ? undefined
            : payload.teachingState === null ? null : JSON.stringify(payload.teachingState),
          operationId: null,
          operationKind: null,
          operationLeaseExpiresAt: null,
          revision: { increment: 1 },
          updatedAt: new Date(),
        }
      });
      if (updated.count !== 1) {
        throw new TeachingSessionConflictError('课堂状态已变化，本次结果未覆盖新状态', 'TEACHING_SESSION_STATE_CHANGED');
      }

      if (payload.markTaskInProgress && payload.taskId && payload.userId) {
        await tx.subtasks.updateMany({
          where: {
            id: payload.taskId,
            userId: payload.userId,
            status: 'todo'
          },
          data: {
            status: 'in_progress',
            updatedAt: new Date()
          }
        });
      }
    });
  }

  async commitLifecycleState(
    sessionId: string,
    operationId: string,
    payload: {
      status: string;
      teachingState?: Record<string, any> | null;
      endTime?: Date | null;
      duration?: number | null;
      clearOpenKey?: boolean;
    }
  ): Promise<void> {
    const updated = await prisma.teaching_sessions.updateMany({
      where: { id: sessionId, operationId },
      data: {
        status: payload.status,
        teachingState: payload.teachingState === undefined
          ? undefined
          : payload.teachingState === null ? null : JSON.stringify(payload.teachingState),
        endTime: payload.endTime === undefined ? undefined : payload.endTime,
        duration: payload.duration === undefined ? undefined : payload.duration,
        openKey: payload.clearOpenKey ? null : undefined,
        operationId: null,
        operationKind: null,
        operationLeaseExpiresAt: null,
        revision: { increment: 1 },
        updatedAt: new Date(),
      }
    });
    if (updated.count !== 1) {
      throw new TeachingSessionConflictError('课堂状态已变化，请刷新后重试', 'TEACHING_SESSION_STATE_CHANGED');
    }
  }

  async claimFinalization(
    sessionId: string,
    action: FinalizeAction = 'end_only',
    operationId: string = randomUUID(),
    expectedRevision?: number
  ): Promise<TeachingFinalizationClaim> {
    const now = new Date();

    return prisma.$transaction(async (tx) => {
      const currentRecord = await tx.teaching_sessions.findUnique({ where: { id: sessionId } });
      if (!currentRecord) throw new Error('会话不存在或已结束');
      const current = mapRecord(currentRecord);
      const currentFinalization = getSessionFinalizationState(current.teachingState);
      const step = action === 'complete_task'
        ? 'taskCompletion'
        : action === 'complete_review' ? 'reviewCompletion' : 'sessionClosure';
      const stepCompleted = action === 'end_only'
        ? current.status === 'completed' && !!current.wrapup
        : currentFinalization?.[step] === 'completed';
      if (stepCompleted) {
        return { status: 'completed' as const, session: current };
      }
      if (expectedRevision !== undefined && current.revision !== expectedRevision) {
        throw new TeachingSessionConflictError('课堂已在其他页面更新，请刷新后继续', 'TEACHING_SESSION_STALE');
      }

      const leaseActive = current.operationId
        && current.operationLeaseExpiresAt
        && current.operationLeaseExpiresAt > now;
      if (leaseActive) {
        if (!current.operationKind?.startsWith('finalize:')) {
          throw new TeachingSessionConflictError('课堂正在处理另一项操作，请稍后重试', 'TEACHING_SESSION_BUSY');
        }
        return {
          status: 'processing' as const,
          operationId: current.operationId!,
          session: current
        };
      }
      const allowedStatuses = action === 'end_only'
        ? ['active', 'paused', 'timeout', 'finalizing', 'finalization_failed']
        : ['completed'];
      if (!allowedStatuses.includes(current.status)) {
        throw new TeachingSessionConflictError('当前课堂状态无法结束', 'TEACHING_SESSION_STATE_CHANGED');
      }

      const baseTeachingState = !currentFinalization && current.status === 'completed' && current.wrapup
        ? {
            ...(current.teachingState || {}),
            finalization: {
              sessionClosure: 'completed',
              taskCompletion: 'not_started',
              reviewCompletion: 'not_started',
              lastAction: 'end_only',
              lastOperationId: '',
              lastRequestedAt: current.updatedAt.toISOString(),
              lastCompletedAt: (current.endTime || current.updatedAt).toISOString()
            }
          }
        : current.teachingState;
      const nextTeachingState = updateSessionFinalizationState(
        baseTeachingState,
        action,
        operationId,
        step,
        'processing',
        { requestedAt: now.toISOString() }
      );
      const claimed = await tx.teaching_sessions.updateMany({
        where: {
          id: sessionId,
          revision: current.revision,
          status: current.status,
          OR: [
            { operationId: null },
            { operationLeaseExpiresAt: { lte: now } }
          ]
        },
        data: {
          status: action === 'end_only' ? 'finalizing' : current.status,
          teachingState: JSON.stringify(nextTeachingState),
          operationId,
          operationKind: `finalize:${action}`,
          operationLeaseExpiresAt: new Date(now.getTime() + TEACHING_OPERATION_LEASE_MS),
          updatedAt: now
        }
      });
      if (claimed.count !== 1) {
        throw new TeachingSessionConflictError('课堂状态已变化，请重试', 'TEACHING_SESSION_STATE_CHANGED');
      }

      const claimedRecord = await tx.teaching_sessions.findUnique({ where: { id: sessionId } });
      if (!claimedRecord) throw new Error('会话不存在或已结束');
      return {
        status: 'claimed' as const,
        operationId,
        session: mapRecord(claimedRecord)
      };
    });
  }

  async failFinalization(
    sessionId: string,
    operationId: string,
    action: FinalizeAction,
    errorCode: string
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const currentRecord = await tx.teaching_sessions.findUnique({ where: { id: sessionId } });
      if (!currentRecord || currentRecord.operationId !== operationId) return;
      const current = mapRecord(currentRecord);
      const step = action === 'complete_task'
        ? 'taskCompletion'
        : action === 'complete_review' ? 'reviewCompletion' : 'sessionClosure';
      const teachingState = updateSessionFinalizationState(
        current.teachingState,
        action,
        operationId,
        step,
        'failed',
        { errorCode }
      );
      await tx.teaching_sessions.updateMany({
        where: { id: sessionId, operationId },
        data: {
          status: action === 'end_only' ? 'finalization_failed' : current.status,
          teachingState: JSON.stringify(teachingState),
          operationId: null,
          operationKind: null,
          operationLeaseExpiresAt: null,
          revision: { increment: 1 },
          updatedAt: new Date()
        }
      });
    });
  }

  async completeFinalizationStep(
    sessionId: string,
    operationId: string,
    action: Exclude<FinalizeAction, 'end_only'>
  ): Promise<TeachingSessionRecord> {
    return prisma.$transaction(async (tx) => {
      const currentRecord = await tx.teaching_sessions.findUnique({ where: { id: sessionId } });
      if (!currentRecord || currentRecord.operationId !== operationId) {
        throw new TeachingSessionConflictError('课堂完成状态已变化，请刷新后重试', 'TEACHING_SESSION_STATE_CHANGED');
      }
      const current = mapRecord(currentRecord);
      const step = action === 'complete_task' ? 'taskCompletion' : 'reviewCompletion';
      const teachingState = updateSessionFinalizationState(
        current.teachingState,
        action,
        operationId,
        step,
        'completed',
        { completedAt: new Date().toISOString() }
      );
      const updated = await tx.teaching_sessions.updateMany({
        where: { id: sessionId, operationId },
        data: {
          teachingState: JSON.stringify(teachingState),
          operationId: null,
          operationKind: null,
          operationLeaseExpiresAt: null,
          revision: { increment: 1 },
          updatedAt: new Date()
        }
      });
      if (updated.count !== 1) {
        throw new TeachingSessionConflictError('课堂完成状态已变化，请刷新后重试', 'TEACHING_SESSION_STATE_CHANGED');
      }
      const result = await tx.teaching_sessions.findUnique({ where: { id: sessionId } });
      if (!result) throw new Error('会话不存在');
      return mapRecord(result);
    });
  }

  async completeWithEvent(
    sessionId: string,
    operationId: string,
    payload: {
      messages: TeachingSessionMessage[];
      knowledgeState: TeachingKnowledgePointState[];
      teachingState?: Record<string, any> | null;
      wrapup?: Record<string, any> | null;
      advisory?: Record<string, any> | null;
      duration?: number | null;
    },
    event: DurableDomainEvent,
    metricCommit?: TeachingLearningStateCommit | null
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      if (metricCommit) {
        const claimedState = await tx.users.updateMany({
          where: {
            id: metricCommit.userId,
            learningStateRevision: metricCommit.expectedRevision,
          },
          data: {
            learningStateRevision: { increment: 1 },
          }
        });
        if (claimedState.count !== 1) {
          throw new TeachingSessionConflictError(
            '学习状态已被其他课堂更新，正在重新计算',
            'TEACHING_LEARNING_STATE_STALE'
          );
        }
        await tx.learning_metrics.deleteMany({ where: { sourceKey: metricCommit.sourceKey } });
        await tx.learning_metrics.create({ data: metricCommit.data as any });
      }

      const completed = await tx.teaching_sessions.updateMany({
        where: { id: sessionId, status: 'finalizing', operationId },
        data: {
          status: 'completed',
          endTime: new Date(),
          duration: payload.duration ?? null,
          messages: JSON.stringify(payload.messages),
          knowledgeState: JSON.stringify(payload.knowledgeState),
          teachingState: JSON.stringify(updateSessionFinalizationState(
            payload.teachingState,
            'end_only',
            operationId,
            'sessionClosure',
            'completed',
            { completedAt: new Date().toISOString() }
          )),
          wrapup: payload.wrapup ? JSON.stringify(payload.wrapup) : null,
          advisory: payload.advisory ? JSON.stringify(payload.advisory) : null,
          openKey: null,
          operationId: null,
          operationKind: null,
          operationLeaseExpiresAt: null,
          revision: { increment: 1 },
          updatedAt: new Date()
        }
      });
      if (completed.count !== 1) {
        throw new TeachingSessionConflictError('课堂结束状态已变化，请刷新后重试', 'TEACHING_SESSION_STATE_CHANGED');
      }
      await enqueueDomainEvent(tx, event);
    });
  }

  async timeoutIfIdle(sessionId: string, expectedRevision: number, cutoff: Date): Promise<boolean> {
    const result = await prisma.teaching_sessions.updateMany({
      where: {
        id: sessionId,
        revision: expectedRevision,
        status: 'active',
        updatedAt: { lte: cutoff },
        OR: [
          { operationId: null },
          { operationLeaseExpiresAt: { lte: new Date() } }
        ]
      },
      data: {
        status: 'timeout',
        endTime: new Date(),
        operationId: null,
        operationKind: null,
        operationLeaseExpiresAt: null,
        updatedAt: new Date()
      }
    });
    return result.count === 1;
  }
}

export const teachingSessionRepository = new TeachingSessionRepository();
