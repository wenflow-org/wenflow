import { PrismaClient } from '@prisma/client';
import { DurableEventConsumerRegistry } from '../consumer-registry';
import { createDomainEvent } from '../contracts';
import { enqueueDomainEvent } from '../outbox.repository';
import { DurableOutboxWorker } from '../outbox.worker';
import { learnerEvidenceProjector } from '../../services/learner/LearnerEvidenceProjector';

const runIntegration = process.env.RUN_DB_INTEGRATION_TESTS === '1' ? describe : describe.skip;

runIntegration('durable outbox integration', () => {
  const prisma = new PrismaClient();
  const ids = {
    user: 'outbox-integration-user',
    event: 'outbox-integration-event'
  };

  beforeAll(async () => {
    await prisma.users.upsert({
      where: { id: ids.user },
      create: {
        id: ids.user,
        email: 'outbox-integration@wenflow.test',
        name: 'Outbox Integration',
        password: 'not-used',
        updatedAt: new Date()
      },
      update: {}
    });
  });

  afterAll(async () => {
    await prisma.domain_event_inbox.deleteMany({ where: { eventId: ids.event } });
    await prisma.learner_evidence.deleteMany({ where: { eventId: ids.event } });
    await prisma.learner_projections.deleteMany({ where: { userId: ids.user } });
    await prisma.domain_event_outbox.deleteMany({ where: { id: ids.event } });
    await prisma.users.deleteMany({ where: { id: ids.user } });
    await prisma.$disconnect();
  });

  it('publishes an outbox event into inbox, evidence and projection', async () => {
    await prisma.$transaction(async (tx) => {
      await enqueueDomainEvent(tx, createDomainEvent({
        id: ids.event,
        type: 'task:completed',
        aggregateType: 'task',
        aggregateId: 'integration-task',
        userId: ids.user,
        source: 'integration-test',
        data: { taskId: 'integration-task' }
      }));
    });

    const registry = new DurableEventConsumerRegistry();
    registry.register(['task:completed'], (event) => learnerEvidenceProjector.handle(event));
    await new DurableOutboxWorker(registry).runOnce();

    const [outbox, inbox, evidence, projection] = await Promise.all([
      prisma.domain_event_outbox.findUnique({ where: { id: ids.event } }),
      prisma.domain_event_inbox.findFirst({ where: { eventId: ids.event } }),
      prisma.learner_evidence.findFirst({ where: { eventId: ids.event } }),
      prisma.learner_projections.findFirst({ where: { userId: ids.user } })
    ]);

    expect(outbox?.status).toBe('published');
    expect(inbox).not.toBeNull();
    expect(evidence?.evidenceType).toBe('task:completed');
    expect(projection?.lastEventId).toBe(ids.event);
  });
});
