import prisma from '../../config/database';
import { logger } from '../../utils/logger';

/**
 * 会话事件统一日志（2026-10-21）。
 *
 * 为什么需要：开课/回合/暂停/恢复/检查点/收束/工具/错误 此前分散在 6 处载体——
 * `teaching_sessions.status` 字段、`teachingState.classroomEventHistory`（只留最近 40 条）、
 * `domain_event_outbox`（只在收束后外发一次）、`agent_call_logs`、`prompt_call_logs`、
 * `llm_execution_attempts`。想回答「这个会话按时间发生了什么」需要跨表拼凑，且课堂
 * 事件历史会被裁剪。
 *
 * 本表是并列的**按会话可查询时间线**：旧写入一律保持不动（前端课堂事件仍读
 * classroomEventHistory，跨模块事件仍走 outbox），因此接入新表不改变任何现有行为。
 *
 * 写入语义：
 * - 可传入事务客户端（`db`），与业务写入同事务提交——回合提交、开课初始化都用这条路径，
 *   避免「业务写成功但事件缺失」。
 * - 未传客户端时独立自动提交，失败只 warn，不影响业务结果（遥测类写入的既有口径）。
 */
export type SessionEventKind =
  | 'session.created'
  | 'session.initialized'
  | 'session.paused'
  | 'session.resumed'
  | 'session.completed'
  | 'turn.started'
  | 'turn.committed'
  | 'turn.failed'
  | 'checkpoint.submitted'
  | 'tool.invoked'
  | 'tool.failed'
  | 'error';

export type SessionEventStatus = 'ok' | 'failed' | 'info';

export interface SessionEventInput {
  sessionId: string;
  kind: SessionEventKind;
  actor?: 'user' | 'system' | 'model';
  status?: SessionEventStatus;
  revision?: number | null;
  payload?: Record<string, unknown> | null;
  occurredAt?: Date;
}

/** 事务客户端最小面（与 withTransaction 的 TransactionClient 兼容） */
export interface SessionEventClient {
  session_events: {
    create(args: { data: any }): Promise<any>;
  };
}

type SessionEventDb = SessionEventClient | undefined;

const PAYLOAD_MAX_CHARS = 8192;

/** 事件载荷裁剪：超长 JSON 截断并标注，保证单行不随大对象膨胀。 */
export function trimSessionEventPayload(payload: Record<string, unknown> | null | undefined): string | null {
  if (!payload) return null;
  let json: string;
  try {
    json = JSON.stringify(payload);
  } catch {
    return JSON.stringify({ __unserializable: true });
  }
  if (json.length <= PAYLOAD_MAX_CHARS) return json;
  return JSON.stringify({ __truncated: true, bytes: Buffer.byteLength(json), head: json.slice(0, PAYLOAD_MAX_CHARS - 160) });
}

export async function recordSessionEvent(input: SessionEventInput, db?: SessionEventDb): Promise<void> {
  const data = {
    sessionId: input.sessionId,
    kind: input.kind,
    actor: input.actor ?? null,
    status: input.status ?? 'info',
    revision: typeof input.revision === 'number' ? input.revision : null,
    payload: trimSessionEventPayload(input.payload),
    occurredAt: input.occurredAt ?? new Date(),
  };
  try {
    // 事务内必须用事务客户端：*不要*在 tx 缺该委托时回落到全局 prisma——
    // 那是另一条连接，会在 SQLite 下与该事务抢锁。缺表时直接跳过并告警（迁移未应用）。
    const delegate = db ? db.session_events : (prisma as any).session_events;
    if (!delegate?.create) {
      logger.warn('[session-events] 目标表不可用，跳过写入（迁移未应用？）', {
        sessionId: input.sessionId,
        kind: input.kind,
        inTransaction: Boolean(db),
      });
      return;
    }
    await delegate.create({ data });
  } catch (error) {
    // 事件日志是旁路审计面：写失败不能让回合/开课/收束失败
    logger.warn('[session-events] 写入失败', {
      sessionId: input.sessionId,
      kind: input.kind,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export interface SessionEventRow {
  id: number;
  kind: string;
  actor: string | null;
  status: string | null;
  revision: number | null;
  payload: string | null;
  occurredAt: Date;
}

export async function listSessionEvents(
  sessionId: string,
  options: { limit?: number; sinceId?: number; kinds?: SessionEventKind[] } = {}
): Promise<SessionEventRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 1000);
  return (prisma as any).session_events.findMany({
    where: {
      sessionId,
      ...(options.sinceId ? { id: { gt: options.sinceId } } : {}),
      ...(options.kinds?.length ? { kind: { in: options.kinds } } : {}),
    },
    orderBy: { id: 'asc' },
    take: limit,
    select: { id: true, kind: true, actor: true, status: true, revision: true, payload: true, occurredAt: true },
  });
}
