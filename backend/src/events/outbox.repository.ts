import type { DurableDomainEvent } from './contracts';

/**
 * #106②（2026-10-19）：outbox 时间字段拆列。
 *
 * - `scheduledAt` = **业务排期**：事件何时可被处理；NULL = 无排期，立即可用。
 *   模拟日历（runWithSimulatedClock）按未来模拟日写入的事件（VL 课堂结算等）在写入时
 *   落成排期，消费侧不得早于该时刻看到它们。
 * - `availableAt` = **技术可用时刻**：入队即 when-enqueued，失败重投时后移到退避到期。
 *   它不再直抄 occurredAt（旧实现一字段两义：既当发生时间镜像又当拾取门）。
 *
 * 排期解析：调用方显式给 `event.scheduledAt` 优先；否则只把「未来 occurredAt」原样落成排期——
 * 这正是旧实现 `availableAt: event.occurredAt` 对未到点事件的实际效果（行为等价），
 * 区别只在语义不再藏在 occurredAt 的副本里。occurredAt 为过去/当前的行 scheduledAt = NULL。
 */
export function resolveOutboxScheduledAt(
  event: Pick<DurableDomainEvent, 'occurredAt' | 'scheduledAt'>,
  now: Date
): Date | null {
  if (event.scheduledAt !== undefined && event.scheduledAt !== null) return event.scheduledAt;
  return event.occurredAt.getTime() > now.getTime() ? event.occurredAt : null;
}

export async function enqueueDomainEvent(tx: any, event: DurableDomainEvent): Promise<void> {
  const now = new Date();
  await tx.domain_event_outbox.create({
    data: {
      id: event.id,
      eventType: event.type,
      schemaVersion: event.schemaVersion,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      aggregateVersion: event.aggregateVersion ?? null,
      userId: event.userId || null,
      source: event.source,
      payload: JSON.stringify(event.data || {}),
      metadata: event.metadata ? JSON.stringify(event.metadata) : null,
      status: 'pending',
      availableAt: now,
      scheduledAt: resolveOutboxScheduledAt(event, now),
      occurredAt: event.occurredAt
    }
  });
}

export function mapOutboxRecord(record: any): DurableDomainEvent {
  return {
    id: record.id,
    type: record.eventType,
    schemaVersion: record.schemaVersion,
    aggregateType: record.aggregateType,
    aggregateId: record.aggregateId,
    aggregateVersion: record.aggregateVersion,
    userId: record.userId,
    source: record.source,
    data: JSON.parse(record.payload || '{}'),
    metadata: record.metadata ? JSON.parse(record.metadata) : null,
    occurredAt: record.occurredAt,
    scheduledAt: record.scheduledAt ?? null
  };
}
