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
import { fsrsSchedule, fsrsStateFromLegacy, type FsrsGradeCode, type FsrsMemoryState } from '../memory/fsrs';
import { getActiveForConcepts } from './misconception-ledger.service';

const CONSUMER_ID = 'review-completed-consumer-v1';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 活跃误解对稳定性的惩罚（与旧直写路径 bumpReviewInterval 同值）：下次复习更早，做对比式纠错 */
const MISCONCEPTION_STABILITY_MULTIPLIER = 0.85;

/** rating → FSRS grade（again=Again, hard=Hard, good=Good, easy=Easy） */
const RATING_TO_GRADE: Record<ReviewRating, FsrsGradeCode> = {
  again: 1,
  hard: 2,
  good: 3,
  easy: 4,
};

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

      // 本次复习发生的路径（会话 → 路径）：只在**首次创建**痕迹时写入，
      // 已有痕迹保留最早来源（originPathTitle = "最早出现的路径"）
      const sessionPathId = data.sessionId
        ? (await tx.teaching_sessions.findUnique({
            where: { id: data.sessionId },
            select: { learningPathId: true },
          }))?.learningPathId ?? null
        : null;

      for (const item of items) {
        const conceptKey = String(item.conceptKey || '').trim();
        if (!conceptKey) continue;

        // 现有记忆状态：既是 FSRS 前值，也是 elapsedDays 的来源（必须在写证据前读到）
        const existing = await tx.memory_traces.findUnique({
          where: { userId_conceptKey: { userId: event.userId, conceptKey } }
        });
        // 距**上一次接触**的间隔（天）：这是"保持率 × 间隔"曲线的横轴。
        // 此前证据里只有结果、没有间隔 → 无法回答"隔多久还记不记得"，也就无法本地校准调度参数。
        // 无前次记录（首次）为 null，不参与曲线。
        const elapsedDays = existing
          ? Math.round(((event.occurredAt.getTime() - existing.lastSeenAt.getTime()) / DAY_MS) * 100) / 100
          : null;

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
              masteryScore: item.masteryScore,
              elapsedDays
            }),
            confidence: item.rating === 'again' ? 0.6 : 0.9,
            occurredAt: event.occurredAt
          }
        });

        // 2) 调度数据源 → memory_traces（FSRS-6 DSR 调度：按成绩更新稳定性/难度/到期时间）
        const now = new Date();
        const grade = RATING_TO_GRADE[item.rating];
        const prev: FsrsMemoryState | null = existing
          ? (existing.fsrsStability !== null && existing.fsrsStability !== undefined
            ? {
                stability: existing.fsrsStability,
                difficulty: existing.fsrsDifficulty ?? 5,
                reps: existing.extractionCount,
                lapses: existing.fsrsLapses ?? 0,
                lastReviewAt: existing.lastSeenAt,
              }
            : fsrsStateFromLegacy(existing.masteryScore, existing.extractionCount, existing.lastSeenAt))
          : null;
        const result = fsrsSchedule(prev, grade, now);
        // 语义干扰矩阵（2026-09-17 自旧直写路径 bumpReviewInterval 下移，保持"单一写入者"）：
        // 活跃误解 → 稳定性 ×0.85、到期更早。复习课与课内温故两条来路行为一致。
        const activeMisconceptions = await getActiveForConcepts(event.userId, [conceptKey], 1).catch(() => []);
        const interferenceMultiplier = activeMisconceptions.length > 0 ? MISCONCEPTION_STABILITY_MULTIPLIER : 1;
        const adjustedStability = result.state.stability * interferenceMultiplier;
        const dueAt = new Date(now.getTime() + Math.round(result.intervalDays * interferenceMultiplier) * DAY_MS);
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
            stability: item.status === 'mastered' ? 'stable' : 'fragile',
            lastSeenAt: now,
            extractionCount: 1,
            source: 'review-event',
            pathId: sessionPathId,
            dueAt,
            fsrsStability: adjustedStability,
            fsrsDifficulty: result.state.difficulty,
            fsrsLapses: result.state.lapses,
          },
          update: {
            label: item.label ?? undefined,
            masteryScore: clamp01(item.masteryScore),
            stability: item.status === 'mastered' ? 'stable' : 'fragile',
            lastSeenAt: now,
            extractionCount: { increment: 1 },
            source: 'review-event',
            dueAt,
            fsrsStability: adjustedStability,
            fsrsDifficulty: result.state.difficulty,
            fsrsLapses: result.state.lapses,
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
