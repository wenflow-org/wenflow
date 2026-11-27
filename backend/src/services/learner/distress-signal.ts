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
import { getSimulatedAsOf, simulatedNowOr } from '../virtual-lab/simulation-clock-context';
import { resolveUserSimulatedNow } from '../virtual-lab/simulation-clock-resolver';

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
  const model = (prisma as unknown as { learner_evidence?: { upsert?: (...args: unknown[]) => unknown } }).learner_evidence;
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
 * - 事件之后已有正常完成的课（endTime > occurredAt）→ null（提前解除）；
 * - 查询失败/旧库无表 → null（不阻塞快照）。
 *
 * 时钟域（2026-11-24）：模拟学习者不在 advance-day 上下文里读快照时，用该 VL 实例的
 * 模拟钟（resolveUserSimulatedNow）算 72h 窗口，不能拿真墙钟去比业务日。
 */
export async function loadRecentDistressSignal(
  userId: string,
  now?: Date,
): Promise<RecentDistressSignal | null> {
  const evidence = (prisma as unknown as {
    learner_evidence?: { findFirst?: (...args: unknown[]) => Promise<unknown> };
    teaching_sessions?: { findFirst?: (...args: unknown[]) => Promise<unknown> };
  }).learner_evidence;
  if (!evidence?.findFirst) return null;
  try {
    // 先取最近一条事件（无时间过滤，避免在无事件时白算模拟钟）；命中后再做窗口判定。
    const event = await evidence.findFirst({
      where: { userId, evidenceType: DISTRESS_ABANDON_EVIDENCE_TYPE },
      orderBy: { occurredAt: 'desc' },
    }) as { occurredAt?: Date | string; sessionId?: string | null } | null;
    if (!event?.occurredAt) return null;
    const occurredAt = new Date(event.occurredAt);
    if (!Number.isFinite(occurredAt.getTime())) return null;
    const effectiveNow = now
      ?? (getSimulatedAsOf() ? simulatedNowOr() : await resolveUserSimulatedNow(userId))
      ?? new Date();
    const cutoff = new Date(effectiveNow.getTime() - DISTRESS_RECOVER_HOURS * 60 * 60 * 1000);
    // 未来事件（> now + 5min）视为时钟错位/脏数据：不据此锁人，避免造出无法解除的锁。
    const futureLimit = new Date(effectiveNow.getTime() + 5 * 60 * 1000);
    if (occurredAt < cutoff || occurredAt > futureLimit) return null;

    const sessions = (prisma as unknown as { teaching_sessions?: { findFirst?: (...args: unknown[]) => Promise<unknown> } }).teaching_sessions;
    if (sessions?.findFirst) {
      const later = await sessions.findFirst({
        where: {
          userId,
          status: 'completed',
          // 2026-11-24 真跑复盘：解锁条件是「完成一节正常课」，不是「开了一节正常课」。
          // 旧口径只看 startTime → 事件发生前开课、事件后正常结课的课无法解锁；
          // 改看 endTime（完课时刻），endTime 缺失的旧行仍回退 startTime。
          // lte: now 排除「未来时间」的假完成（模拟课次用业务日、手工事件用真墙钟时会出现这种错位）。
          OR: [
            { endTime: { gt: occurredAt, lte: effectiveNow } },
            { endTime: null, startTime: { gt: occurredAt, lte: effectiveNow } },
          ],
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
