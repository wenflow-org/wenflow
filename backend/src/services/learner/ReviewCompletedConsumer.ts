/**
 * ReviewCompletedConsumer —— 复习结果事件消费者（断链修复 P0-1/2）
 *
 * 背景：复习课收束后，复习结果此前只通过 applyReviewExtraction 旁路直写
 * memory_traces（fire-and-forget，失败静默丢失，不进事件链，不可追溯）。
 * 本消费者把复习结果沉淀为可追溯、可重放、幂等的领域数据：
 *   - learner_evidence：复习观测（review:completed 类型），供画像聚合与未来 BKT 使用
 *   - memory_traces：复习调度数据源（rating 语义：mastered→Good、推进→Hard、未推进→Again）
 *
 * 幂等：domain_event_inbox 记录（consumerId=review-completed-consumer-v1 + eventId 唯一）。
 * 事件 payload：
 *   {
 *     sessionId, mode: 'review', reviewItems: [
 *       { conceptKey, label, status, progress, masteryScore, rating: 'again'|'hard'|'good'|'easy' }
 *     ]
 *   }
 */
import prisma from '../../config/database';
import type { DurableDomainEvent } from '../../events/contracts';
import { logger } from '../../utils/logger';
import { clamp01 } from '../memory/actr';

const CONSUMER_ID = 'review-completed-consumer-v1';

export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';

export interface ReviewCompletedItem {
  conceptKey: string;
  label?: string | null;
  status: string;
  progress: number;
  masteryScore: number;
  rating: ReviewRating;
}

export interface ReviewCompletedPayload {
  sessionId: string;
  mode: string;
  reviewItems: ReviewCompletedItem[];
}

/** knowledgeState status → rating（与 SessionFinalizationService.applyReviewExtraction 语义对齐） */
export function mapReviewStatusToRating(
  status: string,
  progress: number,
): { rating: ReviewRating; masteryScore: number } {
  switch (status) {
    case 'mastered':
      return { rating: Number(progress) >= 100 ? 'easy' : 'good', masteryScore: Number(progress) >= 100 ? 0.9 : 0.85 };
    case 'learning':
      return { rating: 'hard', masteryScore: 0.5 };
    default:
      return { rating: 'again', masteryScore: 0.5 };
  }
}

export class ReviewCompletedConsumer {
  async handle(event: DurableDomainEvent): Promise<void> {
    if (!event.userId) return;

    const data = (event.data || {}) as ReviewCompletedPayload;
    const items = Array.isArray(data.reviewItems) ? data.reviewItems : [];
    if (items.length === 0) return;

    await prisma.$transaction(async (tx) => {
      const consumed = await tx.domain_event_inbox.findUnique({
        where: { consumerId_eventId: { consumerId: CONSUMER_ID, eventId: event.id } }
      });
      if (consumed) return;

      for (const item of items) {
        const conceptKey = String(item.conceptKey || '').trim();
        if (!conceptKey) continue;

        // 1) 复习观测 → learner_evidence（可追溯、可重放，供画像/BKT）
        await tx.learner_evidence.create({
          data: {
            id: `lev_${event.id}_${conceptKey.slice(0, 40)}`,
            eventId: event.id,
            evidenceKey: `review:result:${conceptKey}`,
            userId: event.userId,
            sessionId: data.sessionId || null,
            evidenceType: 'review:completed',
            payload: JSON.stringify({
              conceptKey,
              rating: item.rating,
              status: item.status,
              progress: item.progress,
              masteryScore: item.masteryScore
            }),
            confidence: item.rating === 'again' ? 0.6 : 0.9,
            occurredAt: event.occurredAt
          }
        });

        // 2) 调度数据源 → memory_traces（rating 语义更新，幂等；dueAt 物化：again 不延后、good/easy 延后）
        const now = new Date();
        const dueAt = item.rating === 'again'
          ? new Date(now.getTime() + 24 * 60 * 60 * 1000) // 复习失败：1 天后重试
          : new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000 * 2); // 复习成功：7 天 ×2（间隔递增，后续可换 FSRS）
        await tx.memory_traces.upsert({
          where: {
            userId_conceptKey: { userId: event.userId, conceptKey }
          },
          create: {
            id: `mt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
            userId: event.userId,
            conceptKey,
            label: item.label ?? null,
            masteryScore: clamp01(item.masteryScore),
            stability: item.rating === 'again' ? 'fragile' : 'stable',
            lastSeenAt: now,
            extractionCount: 1,
            source: 'review-event',
            dueAt,
          },
          update: {
            label: item.label ?? undefined,
            masteryScore: clamp01(item.masteryScore),
            stability: item.rating === 'again' ? 'fragile' : 'stable',
            lastSeenAt: now,
            extractionCount: { increment: 1 },
            source: 'review-event',
            dueAt,
            // rating 语义：again 不放大间隔（复习失败，下次更快到期）
            ...(item.rating !== 'again' ? { intervalFactor: { multiply: 2 } } : {}),
          }
        });
      }

      await tx.domain_event_inbox.create({
        data: {
          id: `inbox_${CONSUMER_ID}_${event.id}`,
          consumerId: CONSUMER_ID,
          eventId: event.id
        }
      });

      logger.info('[ReviewCompletedConsumer] 复习结果已落库', {
        userId: event.userId,
        sessionId: data.sessionId,
        itemCount: items.length,
      });
    });
  }
}

export const reviewCompletedConsumer = new ReviewCompletedConsumer();
