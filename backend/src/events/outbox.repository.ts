import type { DurableDomainEvent } from './contracts';

export async function enqueueDomainEvent(tx: any, event: DurableDomainEvent): Promise<void> {
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
      availableAt: event.occurredAt,
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
    occurredAt: record.occurredAt
  };
}
