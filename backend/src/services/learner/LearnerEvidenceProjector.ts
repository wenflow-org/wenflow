import prisma from '../../config/database';
import type { DurableDomainEvent } from '../../events/contracts';

const CONSUMER_ID = 'learner-evidence-projector-v1';

function projectionKey(event: DurableDomainEvent): string {
  return event.userId ? `learner:${event.userId}:events` : `aggregate:${event.aggregateType}:${event.aggregateId}`;
}

export class LearnerEvidenceProjector {
  async handle(event: DurableDomainEvent): Promise<void> {
    if (!event.userId) return;

    await prisma.$transaction(async (tx) => {
      const consumed = await tx.domain_event_inbox.findUnique({
        where: { consumerId_eventId: { consumerId: CONSUMER_ID, eventId: event.id } }
      });
      if (consumed) return;

      const data = event.data || {};
      await tx.learner_evidence.create({
        data: {
          id: `lev_${event.id}`,
          eventId: event.id,
          evidenceKey: event.type,
          userId: event.userId,
          pathId: data.pathId || null,
          milestoneId: data.milestoneId || null,
          taskId: data.taskId || null,
          sessionId: data.sessionId || null,
          evidenceType: event.type,
          payload: JSON.stringify(data),
          confidence: typeof data.confidence === 'number' ? data.confidence : 1,
          occurredAt: event.occurredAt
        }
      });

      const key = projectionKey(event);
      const existing = await tx.learner_projections.findUnique({ where: { projectionKey: key } });
      const payload = existing ? JSON.parse(existing.payload || '{}') : { eventCounts: {}, latest: {} };
      payload.eventCounts[event.type] = (payload.eventCounts[event.type] || 0) + 1;
      payload.latest[event.type] = { eventId: event.id, occurredAt: event.occurredAt.toISOString(), data };

      await tx.learner_projections.upsert({
        where: { projectionKey: key },
        create: {
          id: `lpr_${event.userId}_events`,
          projectionKey: key,
          userId: event.userId,
          scope: 'events',
          pathId: data.pathId || null,
          version: 1,
          payload: JSON.stringify(payload),
          lastEventId: event.id,
          lastEventAt: event.occurredAt,
          generatedAt: new Date()
        },
        update: {
          version: { increment: 1 },
          payload: JSON.stringify(payload),
          lastEventId: event.id,
          lastEventAt: event.occurredAt,
          generatedAt: new Date()
        }
      });

      await tx.domain_event_inbox.create({
        data: {
          id: `inbox_${CONSUMER_ID}_${event.id}`,
          consumerId: CONSUMER_ID,
          eventId: event.id
        }
      });
    });
  }
}

export const learnerEvidenceProjector = new LearnerEvidenceProjector();
