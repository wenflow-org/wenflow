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

  it('#106② 写入侧拆列：排期落 scheduledAt，availableAt 只作技术门（不再直抄 occurredAt）', async () => {
    const tx = { domain_event_outbox: { create: jest.fn().mockResolvedValue({}) } };
    const future = new Date(Date.now() + 60 * 60 * 1000);

    await enqueueDomainEvent(tx, createDomainEvent({
      id: 'evt-future', type: 'task:completed', aggregateType: 'task', aggregateId: 'task-f',
      source: 'test', occurredAt: future, data: {}
    }));
    const futureData = tx.domain_event_outbox.create.mock.calls[0][0].data;
    expect(futureData.scheduledAt.getTime()).toBe(future.getTime());
    expect(futureData.availableAt.getTime()).toBeLessThanOrEqual(Date.now());

    const explicit = new Date(Date.now() + 2 * 60 * 60 * 1000);
    await enqueueDomainEvent(tx, createDomainEvent({
      id: 'evt-explicit', type: 'task:completed', aggregateType: 'task', aggregateId: 'task-e',
      source: 'test', occurredAt: new Date(Date.now() - 1000), scheduledAt: explicit, data: {}
    }));
    expect(tx.domain_event_outbox.create.mock.calls[1][0].data.scheduledAt.getTime()).toBe(explicit.getTime());

    await enqueueDomainEvent(tx, createDomainEvent({
      id: 'evt-normal', type: 'task:completed', aggregateType: 'task', aggregateId: 'task-n',
      source: 'test', occurredAt: new Date(), data: {}
    }));
    expect(tx.domain_event_outbox.create.mock.calls[2][0].data.scheduledAt).toBeNull();
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
