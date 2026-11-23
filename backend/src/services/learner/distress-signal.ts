/**
 * 近期「弃课 / 情绪崩溃」控制信号（2026-11-23 P0-2）。
 *
 * 为什么需要单独一条信号：
 * - 弃课/崩溃的会话按数据卫生**不写 learning_metrics**（避免假负荷污染 PMC）；
 * - 但控制面必须知道"这个人上次是崩着走的"，否则下一节课仍会按 steady/push 加码。
 *
 * 因此事件落 `learner_evidence`（无 schema 变更、按 userId+occurredAt 有索引），
 * 快照读取时只在 **72 小时** 内生效；若该事件之后已有一次正常完成的课，则提前解除。
 * 它只影响控制态（paceMode=recover / cap=low），**不改写任何分数**。
 */
import { randomUUID } from 'crypto';
import prisma from '../../config/database';
import { logger } from '../../utils/logger';

export const DISTRESS_ABANDON_EVIDENCE_TYPE = 'session:distress_abandon';
export const DISTRESS_RECOVER_HOURS = 72;
const DISTRESS_EVIDENCE_KEY = 'distress:abandon';

export interface DistressEventInput {
  userId: string;
  sessionId: string;
  pathId?: string | null;
  taskId?: string | null;
  endReason?: string | null;
  occurredAt?: Date;
}

/**
 * 记录一条弃课事件（幂等）。非 `learner-abandoned` 的异常终态（discarded/superseded/failed）
 * 不在这里落——它们不代表学习者主动崩溃。
 */
export async function recordDistressAbandonEvidence(input: DistressEventInput): Promise<void> {
  const model = (prisma as unknown as { learner_evidence?: { upsert?: Function } }).learner_evidence;
  if (!model?.upsert) return;
  const occurredAt = input.occurredAt ?? new Date();
  const eventId = `session:${input.sessionId}`;
  const payload = JSON.stringify({
    flag: 'abandon',
    endReason: input.endReason ?? 'learner-abandoned',
    occurredAt: occurredAt.toISOString(),
  });
  try {
    await model.upsert({
      where: { eventId_evidenceKey: { eventId, evidenceKey: DISTRESS_EVIDENCE_KEY } },
      create: {
        id: randomUUID(),
        eventId,
        evidenceKey: DISTRESS_EVIDENCE_KEY,
        userId: input.userId,
        pathId: input.pathId ?? null,
        taskId: input.taskId ?? null,
        sessionId: input.sessionId,
        evidenceType: DISTRESS_ABANDON_EVIDENCE_TYPE,
        payload,
        confidence: 1,
        occurredAt,
      },
      update: {
        evidenceType: DISTRESS_ABANDON_EVIDENCE_TYPE,
        payload,
        confidence: 1,
        occurredAt,
      },
    });
  } catch (error) {
    logger.warn('[distress-signal] 弃课事件写入失败（best-effort，不影响收束）', {
      userId: input.userId,
      sessionId: input.sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export interface RecentDistressSignal {
  occurredAt: Date;
  sessionId: string | null;
}

/**
 * 读取仍生效的弃课信号：
 * - 72h 窗口外 → null；
 * - 事件之后已有正常完成的课（startTime > occurredAt）→ null（提前解除）；
 * - 查询失败/旧库无表 → null（不阻塞快照）。
 */
export async function loadRecentDistressSignal(
  userId: string,
  now: Date = new Date(),
): Promise<RecentDistressSignal | null> {
  const evidence = (prisma as unknown as {
    learner_evidence?: { findFirst?: Function };
    teaching_sessions?: { findFirst?: Function };
  }).learner_evidence;
  if (!evidence?.findFirst) return null;
  const cutoff = new Date(now.getTime() - DISTRESS_RECOVER_HOURS * 60 * 60 * 1000);
  try {
    const event = await evidence.findFirst({
      where: {
        userId,
        evidenceType: DISTRESS_ABANDON_EVIDENCE_TYPE,
        occurredAt: { gte: cutoff },
      },
      orderBy: { occurredAt: 'desc' },
    }) as { occurredAt?: Date | string; sessionId?: string | null } | null;
    if (!event?.occurredAt) return null;
    const occurredAt = new Date(event.occurredAt);
    if (!Number.isFinite(occurredAt.getTime())) return null;

    const sessions = (prisma as unknown as { teaching_sessions?: { findFirst?: Function } }).teaching_sessions;
    if (sessions?.findFirst) {
      const later = await sessions.findFirst({
        where: {
          userId,
          status: 'completed',
          startTime: { gt: occurredAt },
          ...(event.sessionId ? { id: { not: event.sessionId } } : {}),
        },
        select: { id: true },
      });
      if (later) return null;
    }
    return { occurredAt, sessionId: event.sessionId ?? null };
  } catch (error) {
    logger.warn('[distress-signal] 读取失败（best-effort，按无信号处理）', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
