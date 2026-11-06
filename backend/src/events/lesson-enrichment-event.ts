/**
 * 课后知识增强的独立事件（#144 / #145 / #146）。
 *
 * 背景：课后增强（`lesson-knowledge-enricher`）是一次 10–20s 量级的 LLM 调用，原先在
 * `handleLearnerEvent` 里被同步 `await`，而同一条 `lesson:completed` 又受「同用户队头保护」约束。
 * 三处代价叠在一起：
 *
 * - #144：单 worker 单批串行 → 任一用户的课收尾会在 LLM 全程占住唯一 worker，其他用户的学习者线
 *   事件排队；
 * - #145：增强失败时整条 `lesson:completed` 保持 pending 退避重投（2+4+8+16+32+60+60 ≈ 182s），
 *   该用户的**所有**后续学习者线事件都卡在这条队头之后；
 * - #146：`handleLearnerEvent` 把增强异常吞下、刷新完快照再在链尾重抛 → 每次重投都从头重跑
 *   证据投影 → 课后增强 → 清缓存 → 快照重算。
 *
 * 修法：增强**不再与快照刷新同源**。`lesson:completed` 的消费只负责快路径（证据投影 + 清缓存 +
 * 快照刷新），然后登记一条独立的 `lesson:knowledge-enrichment` 事件；该事件由独立的 worker
 * 泳道消费（见 outbox.worker.ts 的 include/exclude 与 concurrency），它既不在
 * `ORDERED_EVENT_TYPES` 里，也不与主泳道共享批处理时间。
 *
 * 载荷只引用源事件 id：`lesson:completed` 的 payload（wrapup / 对话上下文）可能有数十 KB，
 * 再复制一份到增强行没有意义——消费时按 id 回查源 outbox 行（published 后行仍在）。
 */
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { notifyOutboxActivity } from './outbox-wake';
import type { DurableDomainEvent } from './contracts';

export const LESSON_ENRICHMENT_EVENT_TYPE = 'lesson:knowledge-enrichment' as const;

export interface LessonEnrichmentEventData {
  /** 源 `lesson:completed` 事件 id（增强产物仍按源事件 id 做 inbox receipt 幂等） */
  lessonEventId: string;
}

/** 增强事件 id 由源事件派生：同一节课重投时不会重复登记（幂等 upsert 的键） */
export function lessonEnrichmentEventId(lessonEventId: string): string {
  return `enr_${lessonEventId}`;
}

/**
 * 登记一节课的课后增强事件。
 *
 * 幂等：id 确定 + upsert 空更新——同一 `lesson:completed` 被重投（投影/刷新失败）时不会重复入队。
 * 已存在（含已 published / dead）时保持原状：增强是否重试由它自己的尝试计数决定，不受源事件影响。
 */
export async function enqueueLessonEnrichmentEvent(lessonEvent: DurableDomainEvent): Promise<void> {
  if (lessonEvent.type !== 'lesson:completed' || !lessonEvent.userId) return;
  const id = lessonEnrichmentEventId(lessonEvent.id);
  const payload: LessonEnrichmentEventData = { lessonEventId: lessonEvent.id };
  await prisma.domain_event_outbox.upsert({
    where: { id },
    create: {
      id,
      eventType: LESSON_ENRICHMENT_EVENT_TYPE,
      schemaVersion: 1,
      aggregateType: 'lesson',
      aggregateId: lessonEvent.aggregateId,
      aggregateVersion: lessonEvent.aggregateVersion ?? null,
      userId: lessonEvent.userId,
      source: lessonEvent.source,
      payload: JSON.stringify(payload),
      metadata: null,
      status: 'pending',
      availableAt: new Date(),
      // 增强不参与业务排期：能走到这里说明源事件已到点（模拟日历的未来事件在拾取前不会消费）。
      scheduledAt: null,
      occurredAt: lessonEvent.occurredAt
    },
    update: {}
  });
  notifyOutboxActivity();
  logger.debug('[lesson-knowledge-enrichment] 已登记课后增强事件', {
    lessonEventId: lessonEvent.id,
    enrichmentEventId: id
  });
}
