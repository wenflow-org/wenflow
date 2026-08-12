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
export const FINALIZATION_LEASE_MS = 3 * 60 * 1000;
export const FINALIZATION_LEASE_RENEW_MS = 45 * 1000;
const RECOVERABLE_SESSION_STATUSES = ['active', 'paused', 'timeout'] as const;

export class TeachingSessionConflictError extends Error {
  readonly status = 409;
  readonly retryable = true;
  readonly category = 'conflict';

  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
    this.name = 'TeachingSessionConflictError';
  }
}

export class FinalizationOperationError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly category: 'validation' | 'conflict' | 'lease' | 'upstream' | 'persistence'
  ) {
    super(message);
    this.name = 'FinalizationOperationError';
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
  /** 前端交互特征（认知负荷量测 · 前端情报层）：随消息落库，供后续轮次对比 */
  meta?: Record<string, number> | null;
  analysis?: Record<string, any>;
  strategies?: string[];
  knowledgePoint?: string | null;
  knowledgePoints?: TeachingKnowledgePointState[];
  promptDebug?: Record<string, any> | null;
  peerTriggered?: boolean;
  peerMessage?: string | null;
  peerDebug?: Record<string, any> | null;
  /** 检查点合成消息标记：不参与学生行为证据统计 */
  checkpoint?: boolean;
  /** 伴学对话消息标记：不属于正式教学回合 */
  peer?: boolean;
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
  | { status: 'completed'; operationId: string; session: TeachingSessionRecord; result: Record<string, any> | null }
  | { status: 'processing'; operationId: string; session: TeachingSessionRecord }
  | { status: 'claimed'; operationId: string; leaseOwner: string; session: TeachingSessionRecord };

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
          // finalization_failed：最终化失败且无活跃 lease 时允许回收重开，避免 openKey 被永久锁死
          const finalizationFailedRecoverable = existing.status === 'finalization_failed'
            && (!existing.operationLeaseExpiresAt || existing.operationLeaseExpiresAt <= now);
          const canSupersede = existing.status !== 'finalizing'
            && (recoveryExpired || initializingLeaseExpired || finalizationFailedRecoverable);

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
    // 已知限制（L5）：固定 take 50，无分页；历史消息较多的用户只返回最近 50 条。
    // 完整历史需引入游标/offset 分页，且需同步调整调用方（getSessionHistory / getLatestTaskEvaluation）。
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
  ): Promise<void> {    await prisma.$transaction(async (tx) => {
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

  /**
   * 追加伴学对话消息（revision 乐观锁）：不参与教学回合的 knowledgeState/teachingState 变更，
   * 仅在 active/timeout 会话上生效，避免与 commitTurnState 并发覆盖。
   */
  async appendPeerMessages(sessionId: string, messages: TeachingSessionMessage[]): Promise<void> {
    const session = await prisma.teaching_sessions.findUnique({
      where: { id: sessionId },
      select: { messages: true, revision: true, status: true, operationId: true }
    });
    if (!session) {
      throw new Error('会话不存在或已结束');
    }
    if (session.status !== 'active' && session.status !== 'timeout') {
      throw new TeachingSessionConflictError('课堂已结束，无法继续伴学对话', 'TEACHING_SESSION_STATE_CHANGED');
    }
    // 教学回合在途（operationId 非空）：commitTurnState 会用回合开始时快照整包覆写 messages，
    // 此时写入会被静默覆盖丢失——拒绝并让客户端重试（回合提交后 revision 变更，重试自然通过）。
    if (session.operationId) {
      throw new TeachingSessionConflictError('教学回合进行中，伴学消息稍后重试', 'TEACHING_TURN_IN_PROGRESS');
    }
    const current: TeachingSessionMessage[] = JSON.parse(session.messages || '[]');
    const updated = await prisma.teaching_sessions.updateMany({
      where: { id: sessionId, revision: session.revision, status: { in: ['active', 'timeout'] } },
      data: {
        messages: JSON.stringify([...current, ...messages]),
        updatedAt: new Date()
      }
    });
    if (updated.count !== 1) {
      throw new TeachingSessionConflictError('课堂状态已变化，伴学消息未保存', 'TEACHING_SESSION_STATE_CHANGED');
    }
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
    action: FinalizeAction,
    idempotencyKey: string,
    requestHash: string,
    requestJson: string,
    expectedRevision?: number
  ): Promise<TeachingFinalizationClaim> {
    const now = new Date();
    const leaseOwner = randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + FINALIZATION_LEASE_MS);

    return prisma.$transaction(async (tx) => {
      const currentRecord = await tx.teaching_sessions.findUnique({ where: { id: sessionId } });
      if (!currentRecord) throw new Error('会话不存在或已结束');
      const current = mapRecord(currentRecord);
      const existingOperation = await tx.session_finalization_operations.findUnique({
        where: { sessionId_idempotencyKey: { sessionId, idempotencyKey } }
      });
      if (
        existingOperation
        && (
          existingOperation.action !== action
          || existingOperation.requestHash !== requestHash
          || existingOperation.requestJson !== requestJson
        )
      ) {
        throw new FinalizationOperationError(
          'Idempotency-Key 已用于不同的课堂结束请求',
          'FINALIZATION_IDEMPOTENCY_KEY_REUSED',
          409,
          false,
          'conflict'
        );
      }
      if (existingOperation?.status === 'completed') {
        return {
          status: 'completed' as const,
          operationId: idempotencyKey,
          session: current,
          result: parseJsonSafe(existingOperation.resultJson, null)
        };
      }
      if (
        existingOperation?.status === 'processing'
        && existingOperation.leaseOwner
        && existingOperation.leaseExpiresAt
        && existingOperation.leaseExpiresAt > now
      ) {
        return { status: 'processing' as const, operationId: idempotencyKey, session: current };
      }
      if (existingOperation?.status === 'failed' && existingOperation.retryable === false) {
        throw new FinalizationOperationError(
          '相同课堂结束请求此前发生不可重试错误',
          existingOperation.errorCode || 'FINALIZATION_PREVIOUSLY_FAILED',
          409,
          false,
          'conflict'
        );
      }
      const currentFinalization = getSessionFinalizationState(current.teachingState);
      const step = action === 'complete_task'
        ? 'taskCompletion'
        : action === 'complete_review' ? 'reviewCompletion' : 'sessionClosure';
      const stepCompleted = action === 'end_only'
        ? current.status === 'completed' && !!current.wrapup
        : currentFinalization?.[step] === 'completed';
      if (stepCompleted) {
        if (!existingOperation) {
          await tx.session_finalization_operations.create({
            data: {
              sessionId,
              idempotencyKey,
              action,
              requestHash,
              requestJson,
              status: 'completed',
              attemptCount: 1,
              completedAt: current.endTime || now,
              updatedAt: now
            }
          });
        }
        return { status: 'completed' as const, operationId: idempotencyKey, session: current, result: null };
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
        const activeOperation = await tx.session_finalization_operations.findFirst({
          where: { sessionId, leaseOwner: current.operationId, status: 'processing' }
        });
        return {
          status: 'processing' as const,
          operationId: activeOperation?.idempotencyKey || idempotencyKey,
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
        idempotencyKey,
        step,
        'processing',
        { requestedAt: now.toISOString() }
      );

      if (existingOperation) {
        const reclaimed = await tx.session_finalization_operations.updateMany({
          where: {
            id: existingOperation.id,
            requestHash,
            OR: [
              { status: 'failed', retryable: { not: false } },
              { status: 'processing', leaseExpiresAt: { lte: now } },
              { status: 'processing', leaseExpiresAt: null }
            ]
          },
          data: {
            status: 'processing',
            leaseOwner,
            leaseExpiresAt,
            attemptCount: { increment: 1 },
            errorCode: null,
            retryable: null,
            resultJson: null,
            startedAt: now,
            completedAt: null,
            updatedAt: now
          }
        });
        if (reclaimed.count !== 1) {
          throw new TeachingSessionConflictError('课堂结束操作已被其他请求接管', 'FINALIZATION_LEASE_LOST');
        }
      } else {
        await tx.session_finalization_operations.create({
          data: {
            sessionId,
            idempotencyKey,
            action,
            requestHash,
            requestJson,
            status: 'processing',
            leaseOwner,
            leaseExpiresAt,
            attemptCount: 1,
            startedAt: now,
            updatedAt: now
          }
        });
      }
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
          operationId: leaseOwner,
          operationKind: `finalize:${action}`,
          operationLeaseExpiresAt: leaseExpiresAt,
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
        operationId: idempotencyKey,
        leaseOwner,
        session: mapRecord(claimedRecord)
      };
    });
  }

  async renewFinalizationLease(
    sessionId: string,
    idempotencyKey: string,
    leaseOwner: string
  ): Promise<Date> {
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + FINALIZATION_LEASE_MS);
    await prisma.$transaction(async (tx) => {
      const operation = await tx.session_finalization_operations.updateMany({
        where: {
          sessionId,
          idempotencyKey,
          leaseOwner,
          status: 'processing',
          leaseExpiresAt: { gt: now }
        },
        data: { leaseExpiresAt, updatedAt: now }
      });
      const session = await tx.teaching_sessions.updateMany({
        where: {
          id: sessionId,
          operationId: leaseOwner,
          operationKind: { startsWith: 'finalize:' },
          operationLeaseExpiresAt: { gt: now }
        },
        data: { operationLeaseExpiresAt: leaseExpiresAt, updatedAt: now }
      });
      if (operation.count !== 1 || session.count !== 1) {
        throw new FinalizationOperationError(
          '课堂结束执行租约已失效',
          'FINALIZATION_LEASE_LOST',
          409,
          true,
          'lease'
        );
      }
    });
    return leaseExpiresAt;
  }

  async failFinalization(
    sessionId: string,
    idempotencyKey: string,
    leaseOwner: string,
    action: FinalizeAction,
    errorCode: string,
    retryable = true
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const currentRecord = await tx.teaching_sessions.findUnique({ where: { id: sessionId } });
      if (!currentRecord || currentRecord.operationId !== leaseOwner) return;
      const current = mapRecord(currentRecord);
      const step = action === 'complete_task'
        ? 'taskCompletion'
        : action === 'complete_review' ? 'reviewCompletion' : 'sessionClosure';
      const teachingState = updateSessionFinalizationState(
        current.teachingState,
        action,
        idempotencyKey,
        step,
        'failed',
        { errorCode }
      );
      const operation = await tx.session_finalization_operations.updateMany({
        where: { sessionId, idempotencyKey, leaseOwner, status: 'processing' },
        data: {
          status: 'failed',
          leaseOwner: null,
          leaseExpiresAt: null,
          errorCode,
          retryable,
          completedAt: new Date(),
          updatedAt: new Date()
        }
      });
      const session = await tx.teaching_sessions.updateMany({
        where: { id: sessionId, operationId: leaseOwner },
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
      if (operation.count !== 1 || session.count !== 1) {
        throw new FinalizationOperationError(
          '课堂结束失败状态未能通过租约校验',
          'FINALIZATION_LEASE_LOST',
          409,
          true,
          'lease'
        );
      }
    });
  }

  /**
   * 复习课收束标记：complete_review 走 end_only 收束（wrapup 已落库）后，
   * 幂等补记 reviewCompletion=completed，供前端 finalizationStepCompleted 判定收束完成。
   */
  async markReviewCompleted(sessionId: string): Promise<void> {
    const session = await this.getById(sessionId);
    if (!session) return;
    const teachingState = updateSessionFinalizationState(
      session.teachingState,
      'complete_review',
      `review-${sessionId}`,
      'reviewCompletion',
      'completed',
      { completedAt: new Date().toISOString() }
    );
    await prisma.teaching_sessions.updateMany({
      where: { id: sessionId },
      data: { teachingState: JSON.stringify(teachingState) }
    });
  }

  async completeFinalizationStep(
    sessionId: string,
    idempotencyKey: string,
    leaseOwner: string,
    action: Exclude<FinalizeAction, 'end_only'>,
    result: Record<string, any>
  ): Promise<TeachingSessionRecord> {
    return prisma.$transaction(async (tx) => {
      const now = new Date();
      const currentRecord = await tx.teaching_sessions.findUnique({ where: { id: sessionId } });
      if (
        !currentRecord
        || currentRecord.operationId !== leaseOwner
        || !currentRecord.operationLeaseExpiresAt
        || currentRecord.operationLeaseExpiresAt <= now
      ) {
        throw new FinalizationOperationError('课堂完成执行租约已失效', 'FINALIZATION_LEASE_LOST', 409, true, 'lease');
      }
      const current = mapRecord(currentRecord);
      const step = action === 'complete_task' ? 'taskCompletion' : 'reviewCompletion';
      const teachingState = updateSessionFinalizationState(
        current.teachingState,
        action,
        idempotencyKey,
        step,
        'completed',
        { completedAt: now.toISOString() }
      );
      const updated = await tx.teaching_sessions.updateMany({
        where: {
          id: sessionId,
          operationId: leaseOwner,
          operationLeaseExpiresAt: { gt: now }
        },
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
        throw new FinalizationOperationError('课堂完成执行租约已失效', 'FINALIZATION_LEASE_LOST', 409, true, 'lease');
      }
      const operation = await tx.session_finalization_operations.updateMany({
        where: {
          sessionId,
          idempotencyKey,
          leaseOwner,
          status: 'processing',
          leaseExpiresAt: { gt: now }
        },
        data: {
          status: 'completed',
          resultJson: JSON.stringify(result),
          leaseOwner: null,
          leaseExpiresAt: null,
          errorCode: null,
          retryable: null,
          completedAt: now,
          updatedAt: now
        }
      });
      if (operation.count !== 1) {
        throw new FinalizationOperationError('课堂完成执行租约已失效', 'FINALIZATION_LEASE_LOST', 409, true, 'lease');
      }
      const updatedSession = await tx.teaching_sessions.findUnique({ where: { id: sessionId } });
      if (!updatedSession) throw new Error('会话不存在');
      return mapRecord(updatedSession);
    });
  }

  async completeWithEvent(
    sessionId: string,
    idempotencyKey: string,
    leaseOwner: string,
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
      const now = new Date();
      const operation = await tx.session_finalization_operations.findFirst({
        where: {
          sessionId,
          idempotencyKey,
          leaseOwner,
          action: 'end_only',
          status: 'processing',
          leaseExpiresAt: { gt: now }
        }
      });
      if (!operation) {
        throw new FinalizationOperationError('课堂结束执行租约已失效', 'FINALIZATION_LEASE_LOST', 409, true, 'lease');
      }
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
        where: {
          id: sessionId,
          status: 'finalizing',
          operationId: leaseOwner,
          operationLeaseExpiresAt: { gt: now }
        },
        data: {
          status: 'completed',
          endTime: new Date(),
          duration: payload.duration ?? null,
          messages: JSON.stringify(payload.messages),
          knowledgeState: JSON.stringify(payload.knowledgeState),
          teachingState: JSON.stringify(updateSessionFinalizationState(
            payload.teachingState,
            'end_only',
            idempotencyKey,
            'sessionClosure',
            'completed',
            { completedAt: new Date().toISOString() }
          )),
          wrapup: payload.wrapup ? JSON.stringify(payload.wrapup) : null,
          // M2：仅落库「建议生效」的 advisory（shouldSuggest=true）；无建议时写 null，
          // 避免 NO_ADVISORY 空对象占据 advisory 列（admin onlyWithAdvisory 过滤也依赖此语义）。
          advisory: payload.advisory?.shouldSuggest ? JSON.stringify(payload.advisory) : null,
          openKey: null,
          operationId: null,
          operationKind: null,
          operationLeaseExpiresAt: null,
          revision: { increment: 1 },
          updatedAt: new Date()
        }
      });
      if (completed.count !== 1) {
        throw new FinalizationOperationError('课堂结束执行租约已失效', 'FINALIZATION_LEASE_LOST', 409, true, 'lease');
      }
      await enqueueDomainEvent(tx, event);
      const completedOperation = await tx.session_finalization_operations.updateMany({
        where: {
          id: operation.id,
          leaseOwner,
          status: 'processing',
          leaseExpiresAt: { gt: now }
        },
        data: {
          status: 'completed',
          resultJson: JSON.stringify({ sessionClosure: 'completed' }),
          leaseOwner: null,
          leaseExpiresAt: null,
          errorCode: null,
          retryable: null,
          completedAt: now,
          updatedAt: now
        }
      });
      if (completedOperation.count !== 1) {
        throw new FinalizationOperationError('课堂结束执行租约已失效', 'FINALIZATION_LEASE_LOST', 409, true, 'lease');
      }
    });
  }

  async recoverExpiredFinalizations(
    limit = 100,
    sessionId?: string,
    leaseOwner?: string
  ): Promise<number> {
    const now = new Date();
    const operations = await prisma.session_finalization_operations.findMany({
      where: {
        sessionId,
        leaseOwner,
        status: 'processing',
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }]
      },
      orderBy: { updatedAt: 'asc' },
      take: limit
    });
    let recovered = 0;
    for (const operation of operations) {
      const result = await prisma.$transaction(async (tx) => {
        const claimed = await tx.session_finalization_operations.updateMany({
          where: {
            id: operation.id,
            status: 'processing',
            leaseOwner: operation.leaseOwner,
            leaseExpiresAt: operation.leaseExpiresAt
          },
          data: {
            status: 'failed',
            leaseOwner: null,
            leaseExpiresAt: null,
            errorCode: 'FINALIZATION_LEASE_EXPIRED',
            retryable: true,
            completedAt: now,
            updatedAt: now
          }
        });
        if (claimed.count !== 1) return false;
        const sessionRecord = await tx.teaching_sessions.findUnique({ where: { id: operation.sessionId } });
        if (!sessionRecord || sessionRecord.operationId !== operation.leaseOwner) return true;
        const session = mapRecord(sessionRecord);
        const step = operation.action === 'complete_task'
          ? 'taskCompletion'
          : operation.action === 'complete_review' ? 'reviewCompletion' : 'sessionClosure';
        const teachingState = updateSessionFinalizationState(
          session.teachingState,
          operation.action as FinalizeAction,
          operation.idempotencyKey,
          step,
          'failed',
          { errorCode: 'FINALIZATION_LEASE_EXPIRED' }
        );
        await tx.teaching_sessions.updateMany({
          where: {
            id: operation.sessionId,
            operationId: operation.leaseOwner,
            operationLeaseExpiresAt: operation.leaseExpiresAt
          },
          data: {
            status: operation.action === 'end_only' ? 'finalization_failed' : session.status,
            teachingState: JSON.stringify(teachingState),
            operationId: null,
            operationKind: null,
            operationLeaseExpiresAt: null,
            revision: { increment: 1 },
            updatedAt: now
          }
        });
        return true;
      });
      if (result) recovered += 1;
    }
    return recovered;
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

  /**
   * M4：长时间未恢复的 paused 会话（pausedAt 超过阈值）降级为 timeout，
   * 复用与 active 超时相同的兜底路径；会话仍可通过下一轮教学回合恢复为 active。
   */
  async timeoutIfPaused(sessionId: string, expectedRevision: number, cutoff: Date): Promise<boolean> {
    const result = await prisma.teaching_sessions.updateMany({
      where: {
        id: sessionId,
        revision: expectedRevision,
        status: 'paused',
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
