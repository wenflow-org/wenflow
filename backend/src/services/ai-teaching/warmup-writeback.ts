/**
 * 课内温故结果回写记忆引擎（复习事件链）——**叶子模块**。
 *
 * 为什么单独成模块（18 号报告 N10）：这段逻辑原先只存在于 `SessionFinalizationService` 的私有方法里，
 * 而该服务 `import` 了 `AITeachingCoordinator`（协调器），协调器**不能**反向 import 它（会成环）。
 * 于是"超时兜底"路径没法复用，课上作答后直接超时 → 温故结果永不落地。
 * 抽成不依赖协调器的叶子模块后，收束服务与超时兜底都能用同一实现。
 *
 * 语义：与复习课同源（review:completed → ReviewCompletedConsumer：写 learner_evidence + FSRS 重排 dueAt），
 * 同时闭合两个环：① 调度（下次什么时候再捞）② 动态负担预算（成功率高低影响带几个）。
 * 只处理"教学回合真的报告了结果"的点；没接上的点留在计划里，下次课继续。
 */
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import { createDomainEvent } from '../../events/contracts';
import { enqueueDomainEvent } from '../../events/outbox.repository';
import { mapReviewStatusToRating } from '../learner/ReviewCompletedConsumer';
import type { TeachingSessionRecord } from './TeachingSessionRepository';

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

export async function enqueueReviewCompletedEvent(
  session: TeachingSessionRecord,
  items: WarmupReviewItem[],
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
    logger.info('[warmup-writeback] review:completed 事件已入队', {
      sessionId: session.id,
      userId: session.userId,
      itemCount: items.length,
    });
  } catch (error) {
    logger.warn('[warmup-writeback] review:completed 事件入队失败（不影响收束）', {
      sessionId: session.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * 课内温故结果回写记忆引擎。
 *
 * 由**所有**课堂收束路径调用（正常 end_only / complete_task，以及 18 号报告 N10 修好的**超时兜底**）——
 * 否则课上作答后直接超时/放弃，结果永不落地。
 */
export async function applyWarmupExtractionForSession(session: TeachingSessionRecord): Promise<void> {
  try {
    const teachingState = session.teachingState as Record<string, unknown> | null | undefined;
    const sessionArtifacts = teachingState?.sessionArtifacts as Record<string, unknown> | undefined;
    const plan = sessionArtifacts?.memoryWarmup as { items?: unknown } | undefined;
    const items = Array.isArray(plan?.items) ? (plan.items as PersistedWarmupItem[]) : [];
    const payload = collectWarmupReviewItems(items, (iso) => hasLearnerTurnAfter(session, iso));
    if (payload.length === 0) return;
    await enqueueReviewCompletedEvent(session, payload);
    logger.info('[warmup-writeback] 课内温故结果已回写记忆引擎', {
      sessionId: session.id,
      userId: session.userId,
      itemCount: payload.length,
    });
  } catch (error) {
    logger.warn('[warmup-writeback] 课内温故回写失败（不影响收束）', {
      sessionId: session.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
