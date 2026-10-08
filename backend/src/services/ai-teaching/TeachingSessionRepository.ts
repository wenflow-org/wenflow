import { randomUUID } from 'crypto';
import prisma from '../../config/database';
import { withTransaction } from '../../utils/with-transaction';
import { simulatedNowOr } from '../virtual-lab/simulation-clock-context';
import {
  commitTeachingMessages,
  hydrateTeachingSessionMessages,
  appendTeachingMessages,
  TeachingMessageBaseStaleError,
  type TeachingMessageStoreClient
} from './teaching-session-message-store';
import type { DurableDomainEvent } from '../../events/contracts';
import { enqueueDomainEvent } from '../../events/outbox.repository';
import {
  type FinalizeAction,
  getSessionFinalizationState,
  updateSessionFinalizationState
} from './SessionFinalizationPolicy';

/**
 * 课堂操作租约（P2）：原为 30 分钟且无心跳——进程重启/请求挂起会把这个会话锁死很久
 * （实测 BUSY 卡住 10+ 分钟）。改为「短租期 + 心跳续租」：在途回合由
 * TeachingOperationLeaseGuard 每 30s 续一次，最长孤儿窗口从 30 分钟降到 2 分钟。
 */
export const TEACHING_OPERATION_LEASE_MS = 2 * 60 * 1000;
export const TEACHING_OPERATION_RENEW_MS = 30 * 1000;
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
  // promptDebug/peerDebug 已停写（2026-10-08 数据还债 B1：调试信封占 tsm payload 99.75%、
  // 日增 465MB，且与 prompt_call_logs 冗余）——存量行由 teaching-storage-reclaim.ts 清洗，
  // 字段保留为可选以兼容历史 payload 反序列化，新消息不再携带。
  /** @deprecated 仅历史数据兼容，勿写入 */
  promptDebug?: Record<string, any> | null;
  peerTriggered?: boolean;
  peerMessage?: string | null;
  peerStrategy?: string | null;
  peerFollowUpQuestions?: string[];
  /** @deprecated 仅历史数据兼容，勿写入 */
  peerDebug?: Record<string, any> | null;
  /** 检查点合成消息标记：不参与学生行为证据统计 */
  checkpoint?: boolean;
  /** 伴学对话消息标记：不属于正式教学回合 */
  peer?: boolean;
  /**
   * 教学配图（owner 口径 2026-09-23：图片是一种特殊的文字）——**内联在消息流里**，
   * 由老师给的一段文字描述生成（`prompt` 即原文，可回溯）。文本脱离图仍成立。
   */
  images?: TeachingImage[];
  /**
   * 课堂结构图（2026-09-27 双通道重构）——**内联在消息流里**，老师给的 mermaid 源码，
   * 由前端确定性渲染。与 images 的本质区别：不是生成物而是代码——零乱码、毫秒渲染、
   * **图内可写中文标签**（标签即教学信息）。
   */
  diagrams?: TeachingDiagram[];
  /**
   * 位置线图（2026-09-27 双通道重构 Scope B）——**内联在消息流里**，老师给的结构化数值域 +
   * 对象/区间/参考线，由前端确定性渲染成 SVG。真实语料实证：追及题的学习对象本身就是
   * "把文字关系摆成一条位置线"，这类空间关系 mermaid 的节点-边表达不了。
   */
  figures?: TeachingFigure[];
}

/**
 * 教学配图（owner 口径 2026-09-23：图片是一种特殊的文字）。
 * 由老师给的一段**文字描述**生成——`prompt` 即那段文字的最终形态，可回溯"图 = 哪段文字"。
 */
export interface TeachingImage {
  url: string;
  caption: string | null;
  prompt: string;
  provider: string;
  model: string;
  kind: string | null;
  createdAt: string;
}

/**
 * 课堂结构图（2026-09-27 双通道重构，owner 终审：扩散生图停用，结构类走代码渲染）。
 * 老师给的 mermaid 源码（出口过滤见 skill normalizeDiagram），前端 securityLevel:'strict' 渲染。
 */
export interface TeachingDiagram {
  engine: string;
  code: string;
  caption: string | null;
}

/**
 * 位置线图（2026-09-27 双通道重构 Scope B）：空间位置关系的确定性渲染载荷。
 * 数值域由 skill normalizeFigure 统一推导（保证覆盖所有取值），前端只做坐标映射——
 * 渲染是纯函数，无生成、无乱码、无联网。
 */
export interface TeachingFigure {
  /** 归一化后恒为 'svg' */
  engine: string;
  /** 归一化后恒为 'position-line'（v1 唯一图型） */
  kind: string;
  axis: {
    min: number;
    max: number;
    unit: string | null;
    ticks: Array<{ at: number; label: string | null }>;
  };
  marks: Array<{ at: number; label: string; dir: 'right' | 'left' | 'none' }>;
  spans: Array<{ from: number; to: number; label: string }>;
  guides: Array<{ at: number; label: string | null }>;
  caption: string | null;
}

export interface TeachingKnowledgePointState {
  name: string;
  status: 'pending' | 'learning' | 'mastered' | 'review';
  progress: number;
}export interface TeachingSessionRecord {
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
  /** 消息快照基线（水合后的权威消息条数）：commit 校验后仅落 slice(baseCount) 新增 */
  messagesBaseCount: number;
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

/**
 * 教师补充槽 materialId 抢救合并（全量测试报告 #28 竞态）：后台采集完成回写槽位与回合提交
 *（整包重写 teachingState）无锁竞争——回合「读取早于回写、提交晚于回写」的顺序会把刚回写的
 * id 覆盖掉。合并只在「外发槽位是同一笔 requested 且缺 materialId、库中同笔槽位已有 materialId」
 * 时生效，其余键一律不动。
 */
function mergeSupplementMaterialId(
  outgoing: Record<string, any> | null | undefined,
  current: Record<string, any> | null | undefined
): boolean {
  const outSlot = outgoing?.sessionArtifacts?.supplement;
  if (!outSlot || outSlot.status !== 'requested' || outSlot.materialId) return false;
  const curSlot = current?.sessionArtifacts?.supplement;
  if (!curSlot || curSlot.status !== 'requested' || !curSlot.materialId) return false;
  if (String(curSlot.requestedAt || '') !== String(outSlot.requestedAt || '')) return false;
  outgoing.sessionArtifacts = {
    ...outgoing.sessionArtifacts,
    supplement: {
      ...outSlot,
      materialId: curSlot.materialId,
      sourceUrl: curSlot.sourceUrl ?? outSlot.sourceUrl ?? null,
    },
  };
  return true;
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

/**
 * 行 → 记录 + 消息子表水合（大 JSON 增量化 #2）。
 * - 单会话读点（getById/claim）：始终水合——claim 的快照基线必须取自权威侧表；
 * - 列表读点（listByUser 等）：懒规则（列解析为空才查侧表），省 N×1 查询。
 * 旧会话（列有内容、侧表无行）解析结果即权威，行为与子表化前一致。
 */
async function mapRecordHydrated(
  record: any,
  options: { lazy?: boolean } = {}
): Promise<TeachingSessionRecord> {
  const session = mapRecord(record);
  if (!options.lazy || session.messages.length === 0) {
    await hydrateTeachingSessionMessages(session);
  }
  return session;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'P2002';
}

export class TeachingSessionRepository {
  async reserve(
    input: CreateTeachingSessionInput,
    recoveryWindowMs?: number
  ): Promise<{ session: TeachingSessionRecord; created: boolean; operationId: string | null }> {
    const now = simulatedNowOr();
    const operationId = randomUUID();
    const openKey = buildOpenKey(input.userId, input.taskId);

    try {
      return await withTransaction(async (tx) => {
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
          // failed：开课失败的行保留 openKey，允许直接回收重开（复用行而非累积脏数据）
          const failedRecoverable = existing.status === 'failed'
            && (!existing.operationLeaseExpiresAt || existing.operationLeaseExpiresAt <= now);
          const canSupersede = existing.status !== 'finalizing'
            && (recoveryExpired || initializingLeaseExpired || finalizationFailedRecoverable || failedRecoverable);

          if (!canSupersede) {
            return { session: await mapRecordHydrated(existing, { lazy: true }), created: false, operationId: null };
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
            // 业务时间戳：模拟时钟上下文内 = 模拟日（默认 new Date()，现网不变）
            startTime: now,
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

        return { session: await mapRecordHydrated(record, { lazy: true }), created: true, operationId };
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const existing = await prisma.teaching_sessions.findUnique({ where: { openKey } });
      if (!existing) throw error;
      return { session: await mapRecordHydrated(existing, { lazy: true }), created: false, operationId: null };
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
        // 数据还债 B1（2026-10-08）：开场基线不再经 messages 大列中转（原先写列、
        // 首回合惰性播种搬侧表）——直接落侧表，列保持 reserve 时的空数组不动。
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
    if (payload.messages.length > 0) {
      await appendTeachingMessages(sessionId, payload.messages);
    }

    const session = await this.getById(sessionId);
    if (!session) throw new Error('会话不存在');
    return session;
  }

  async failInitialization(sessionId: string, operationId: string): Promise<void> {
    // 保留 openKey：failed 行可被下次 reserve 回收复用（supersede），避免每次失败累积新行
    await prisma.teaching_sessions.updateMany({
      where: { id: sessionId, status: 'initializing', operationId },
      data: {
        status: 'failed',
        operationId: null,
        operationKind: null,
        operationLeaseExpiresAt: null,
        endTime: simulatedNowOr(),
        revision: { increment: 1 },
        updatedAt: new Date()
      }
    });
  }

  async getById(sessionId: string): Promise<TeachingSessionRecord | null> {
    const record = await prisma.teaching_sessions.findUnique({
      where: { id: sessionId }
    });

    // 始终水合：claim 的消息快照基线必须取自权威侧表
    return record ? mapRecordHydrated(record) : null;
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

  /**
   * 调整建议处置埋点：记录学习者对「保留 / 稍后再看 / 预览」的轻动作。
   * 只追加 advisory.learnerResponse，不改任何执行语义（真调整动作走 replan 链）。
   * 审计口径：建议生成后是「没处置 / 保留 / 推迟 / 预览过 / 真执行」，此前只可见最后一项。
   */
  async recordAdvisoryResponse(
    sessionId: string,
    userId: string,
    action: 'keep' | 'later' | 'preview'
  ): Promise<{ status: 'ok' | 'not_found' | 'no_advisory'; advisory?: Record<string, any> }> {
    const session = await this.getById(sessionId);
    if (!session || session.userId !== userId) {
      return { status: 'not_found' };
    }
    const advisory = session.advisory;
    if (!advisory || advisory.shouldSuggest !== true) {
      return { status: 'no_advisory' };
    }
    const merged = {
      ...advisory,
      learnerResponse: { action, at: new Date().toISOString() },
    };
    await prisma.teaching_sessions.update({
      where: { id: sessionId },
      data: { advisory: JSON.stringify(merged) },
    });
    return { status: 'ok', advisory: merged };
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

    return record ? mapRecordHydrated(record, { lazy: true }) : null;
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

    return record ? mapRecordHydrated(record, { lazy: true }) : null;
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
    return { operationId, session, messagesBaseCount: session.messages.length };
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

  /**
   * P2：在途回合心跳续租课堂操作租约。
   * 只在仍持有租约（operationId 匹配且未过期）时续，返回是否续成功；返回 false 表示
   * 租约已被并发请求接管/回收，调用方应停止续租。
   */
  async renewOperationLease(sessionId: string, operationId: string): Promise<boolean> {
    const now = new Date();
    const updated = await prisma.teaching_sessions.updateMany({
      where: {
        id: sessionId,
        operationId,
        operationLeaseExpiresAt: { gt: now }
      },
      data: {
        operationLeaseExpiresAt: new Date(now.getTime() + TEACHING_OPERATION_LEASE_MS),
        updatedAt: now
      }
    });
    return updated.count === 1;
  }

  /**
   * P3：查找同一任务下「因完成结算而自动关课、但 complete_task 未落地」的最近一次会话。
   *
   * 背景：complete_task 遇到未收束课堂时会先自动 end_only 关课，若随后的 complete_task
   * 失败/中断，会话就停在 completed + taskCompletion=not_started；重进页面时 reserve 因
   * openKey 已清空而新建课堂，任务永远卡在 in_progress。
   *
   * 只用明确标记区分：自动关课（为完成结算）会把 sessionArtifacts.endReason 记为
   * 'task-completed'；用户主动「结束学习（不计入完成）」是 'manual-end'，不会被误结算。
   */
  async findCompletionPendingSession(
    userId: string,
    taskId: string
  ): Promise<TeachingSessionRecord | null> {
    const records = await prisma.teaching_sessions.findMany({
      where: { userId, taskId, status: 'completed' },
      orderBy: { updatedAt: 'desc' },
      take: 5
    });
    for (const record of records) {
      const session = await mapRecordHydrated(record, { lazy: true });
      const artifacts = (session.teachingState as Record<string, any> | null)?.sessionArtifacts;
      const finalization = getSessionFinalizationState(session.teachingState);
      if (artifacts?.endReason === 'task-completed' && finalization?.taskCompletion !== 'completed') {
        return session;
      }
    }
    return null;
  }

  /**
   * 卡死在 finalizing 的会话（2026-10-02 完课死锁自愈）：finalization op 仍标 processing
   * 但租约已过期——持有者（首个 finalize 请求）已死且无人认领，重进课堂时由开课路由
   * 补跑结算（claimFinalization 对过期租约放行 supersede）。租约仍有效 = 持有者还在
   * 推进，不算死局，返回 null。
   */
  async findStuckFinalizingSession(
    userId: string,
    taskId: string
  ): Promise<TeachingSessionRecord | null> {
    const record = await prisma.teaching_sessions.findFirst({
      where: { userId, taskId, status: 'finalizing' },
      orderBy: { updatedAt: 'desc' }
    });
    if (!record) return null;
    const op = await prisma.session_finalization_operations.findFirst({
      where: { sessionId: record.id, status: 'processing' },
      orderBy: { createdAt: 'desc' }
    });
    if (!op?.leaseExpiresAt || op.leaseExpiresAt > new Date()) return null;
    return mapRecordHydrated(record, { lazy: true });
  }

  /** 最近一次指定状态的会话（默认不限状态）；用于已完成任务重定向到学习反馈。 */
  async findLatestSession(
    userId: string,
    taskId: string,
    status?: string
  ): Promise<TeachingSessionRecord | null> {
    const record = await prisma.teaching_sessions.findFirst({
      where: { userId, taskId, ...(status ? { status } : {}) },
      orderBy: { updatedAt: 'desc' }
    });
    return record ? mapRecordHydrated(record, { lazy: true }) : null;
  }

  async listByUser(userId: string, limit: number = 50): Promise<TeachingSessionRecord[]> {
    // 已知限制（L5）：固定 take 50，无分页；历史消息较多的用户只返回最近 50 条。
    // 完整历史需引入游标/offset 分页，且需同步调整调用方（getSessionHistory / getLatestTaskEvaluation）。
    const records = await prisma.teaching_sessions.findMany({
      where: { userId },
      orderBy: { startTime: 'desc' },
      take: limit,
    });

    return Promise.all(records.map((record) => mapRecordHydrated(record, { lazy: true })));
  }

  async commitTurnState(
    sessionId: string,
    operationId: string,
    payload: {
      messages: TeachingSessionMessage[];
      /** 消息快照基线（claim 时侧表行数）：校验一致后仅落 slice(baseCount) 的新增 */
      messagesBaseCount: number;
      knowledgeState: TeachingKnowledgePointState[];
      teachingState?: Record<string, any> | null;
      taskId?: string;
      userId?: string;
      markTaskInProgress?: boolean;
      allowedStatuses?: string[];
    }
  ): Promise<void> {
    await withTransaction(async (tx) => {
      // 补充槽 materialId 抢救合并（报告 #28）：仅在外发状态存在「待回写的 requested 槽位」时
      // 多读一次当前行走窄合并——等待窗口外零成本；把并发回写的 id 并入本次整包写入。
      if (
        payload.teachingState
        && (payload.teachingState as any)?.sessionArtifacts?.supplement?.status === 'requested'
        && !(payload.teachingState as any)?.sessionArtifacts?.supplement?.materialId
      ) {
        const currentRow = await tx.teaching_sessions.findUnique({
          where: { id: sessionId },
          select: { teachingState: true },
        });
        mergeSupplementMaterialId(payload.teachingState, parseJsonSafe(currentRow?.teachingState ?? null, null));
      }
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

      // 消息增量落子表（大 JSON 增量化 #2）：基线一致才 INSERT slice(baseCount)，
      // 替代旧「整包覆写」的 last-write-wins；基线漂移按可重试冲突拒绝
      try {
        await commitTeachingMessages(
          sessionId,
          payload.messagesBaseCount,
          payload.messages,
          tx as unknown as TeachingMessageStoreClient
        );
      } catch (error) {
        if (error instanceof TeachingMessageBaseStaleError) {
          throw new TeachingSessionConflictError('课堂消息已变化，请刷新后重试', 'TEACHING_MESSAGE_BASE_STALE');
        }
        throw error;
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
   * 教师补充槽 materialId 回写（活的 path 批次 E / 全量测试报告 #28）：后台采集任务成功后调用。
   * 不持 operation 租约——事务内重读当前 teachingState，只合并 sessionArtifacts.supplement 的
   * materialId/sourceUrl（requestedAt 对得上、状态仍是 requested 才写）。与 commitTurnState 的
   * 抢救合并互为兜底：无论回写与回合提交谁先谁后，id 都不丢。
   */
  async patchSessionSupplementMaterial(
    sessionId: string,
    request: { requestedAt: string },
    patch: { materialId: string; sourceUrl?: string | null }
  ): Promise<boolean> {
    return withTransaction(async (tx) => {
      const row = await tx.teaching_sessions.findUnique({
        where: { id: sessionId },
        select: { teachingState: true },
      });
      const teachingState = parseJsonSafe(row?.teachingState ?? null, null as Record<string, any> | null);
      const slot = teachingState?.sessionArtifacts?.supplement;
      if (!teachingState || !slot || slot.status !== 'requested') return false;
      if (String(slot.requestedAt || '') !== String(request.requestedAt || '')) return false;
      if (slot.materialId === patch.materialId) return true;
      const next = {
        ...teachingState,
        sessionArtifacts: {
          ...teachingState.sessionArtifacts,
          supplement: {
            ...slot,
            materialId: patch.materialId,
            sourceUrl: patch.sourceUrl ?? slot.sourceUrl ?? null,
          },
        },
      };
      await tx.teaching_sessions.update({
        where: { id: sessionId },
        data: { teachingState: JSON.stringify(next), updatedAt: new Date() },
      });
      return true;
    }, { label: 'teaching.patchSupplementMaterial' });
  }

  /**
   * 追加伴学对话消息（revision 乐观锁）：不参与教学回合的 knowledgeState/teachingState 变更，
   * 仅在 active/timeout 会话上生效，避免与 commitTurnState 并发覆盖。
   * 消息进子表（首写惰性播种旧列），行更新不再整包重写 messages 列。
   */
  async appendPeerMessages(sessionId: string, messages: TeachingSessionMessage[]): Promise<void> {
    const session = await prisma.teaching_sessions.findUnique({
      where: { id: sessionId },
      select: { revision: true, status: true, operationId: true }
    });
    if (!session) {
      throw new Error('会话不存在或已结束');
    }
    if (session.status !== 'active' && session.status !== 'timeout') {
      throw new TeachingSessionConflictError('课堂已结束，无法继续伴学对话', 'TEACHING_SESSION_STATE_CHANGED');
    }
    // 教学回合在途（operationId 非空）：commitTurnState 会带回合快照基线落增量，
    // 此时插入新行会破坏基线对账——拒绝并让客户端重试（回合提交后 revision 变更，重试自然通过）。
    if (session.operationId) {
      throw new TeachingSessionConflictError('教学回合进行中，伴学消息稍后重试', 'TEACHING_TURN_IN_PROGRESS');
    }
    await withTransaction(async (tx) => {
      await appendTeachingMessages(sessionId, messages, tx as unknown as TeachingMessageStoreClient);
      const updated = await tx.teaching_sessions.updateMany({
        where: { id: sessionId, revision: session.revision, status: { in: ['active', 'timeout'] } },
        data: {
          updatedAt: new Date()
        }
      });
      if (updated.count !== 1) {
        throw new TeachingSessionConflictError('课堂状态已变化，伴学消息未保存', 'TEACHING_SESSION_STATE_CHANGED');
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
    action: FinalizeAction,
    idempotencyKey: string,
    requestHash: string,
    requestJson: string,
    expectedRevision?: number
  ): Promise<TeachingFinalizationClaim> {
    const now = new Date();
    const leaseOwner = randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + FINALIZATION_LEASE_MS);

    return withTransaction(async (tx) => {
      const currentRecord = await tx.teaching_sessions.findUnique({ where: { id: sessionId } });
      if (!currentRecord) throw new Error('会话不存在或已结束');
      const current = await mapRecordHydrated(currentRecord, { lazy: true });
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
        session: await mapRecordHydrated(claimedRecord, { lazy: true })
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
    await withTransaction(async (tx) => {
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
    await withTransaction(async (tx) => {
      const currentRecord = await tx.teaching_sessions.findUnique({ where: { id: sessionId } });
      if (!currentRecord || currentRecord.operationId !== leaseOwner) return;
      const current = await mapRecordHydrated(currentRecord, { lazy: true });
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
    return withTransaction(async (tx) => {
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
      const current = await mapRecordHydrated(currentRecord, { lazy: true });
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
      return mapRecordHydrated(updatedSession, { lazy: true });
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
    await withTransaction(async (tx) => {
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
          endTime: simulatedNowOr(),
          duration: payload.duration ?? null,
          // 数据还债 B1（2026-10-08）：不再完结时全量回写 messages 大列——
          // 实测 722 个完结会话与侧表逐字节双存 1.67GB（侧表为准，读路径双读已就绪）；
          // 老会话回退仍读列（teaching-storage-reclaim.ts 只清「有侧表行」的完结会话）。
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
      const result = await withTransaction(async (tx) => {
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
        const session = await mapRecordHydrated(sessionRecord, { lazy: true });
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
        endTime: simulatedNowOr(),
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
        endTime: simulatedNowOr(),
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
