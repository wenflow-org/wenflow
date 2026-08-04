import { createDomainEvent } from '../contracts';
import { enqueueDomainEvent, mapOutboxRecord } from '../outbox.repository';

describe('durable event outbox repository', () => {
  it('writes an event through the supplied transaction client', async () => {
    const tx = { domain_event_outbox: { create: jest.fn().mockResolvedValue({}) } };
    const occurredAt = new Date('2026-07-16T12:00:00.000Z');
    const event = createDomainEvent({
      id: 'evt-1',
      type: 'task:completed',
      aggregateType: 'task',
      aggregateId: 'task-1',
      userId: 'user-1',
      source: 'test',
      occurredAt,
      data: { taskId: 'task-1' }
    });

    await enqueueDomainEvent(tx, event);

    expect(tx.domain_event_outbox.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: 'evt-1',
        eventType: 'task:completed',
        aggregateId: 'task-1',
        payload: JSON.stringify({ taskId: 'task-1' }),
        occurredAt
      })
    });
  });

  it('maps a persisted record back to a domain event', () => {
    const occurredAt = new Date('2026-07-16T12:00:00.000Z');
    expect(mapOutboxRecord({
      id: 'evt-1',
      eventType: 'path:generated',
      schemaVersion: 1,
      aggregateType: 'path',
      aggregateId: 'path-1',
      aggregateVersion: null,
      userId: 'user-1',
      source: 'test',
      payload: '{"pathId":"path-1"}',
      metadata: null,
      occurredAt
    })).toMatchObject({
      id: 'evt-1',
      type: 'path:generated',
      data: { pathId: 'path-1' },
      occurredAt
    });
  });
});
