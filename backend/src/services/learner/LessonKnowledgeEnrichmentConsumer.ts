import prisma from '../../config/database';
import type { DurableDomainEvent } from '../../events/contracts';
import { executeSkill } from '../../skills';
import { sessionKnowledgeDistillerDefinition } from '../../skills/session-knowledge-distiller';
import { dialogueConceptExtractorDefinition } from '../../skills/dialogue-concept-extractor';

const CONSUMER_ID = 'lesson-knowledge-enrichment-v1';

export class LessonKnowledgeEnrichmentConsumer {
  async handle(event: DurableDomainEvent): Promise<void> {
    if (event.type !== 'lesson:completed' || !event.userId) return;

    const receipt = await prisma.domain_event_inbox.findUnique({
      where: { consumerId_eventId: { consumerId: CONSUMER_ID, eventId: event.id } }
    });
    if (receipt) return;

    const data = event.data || {};
    const knowledgeState = Array.isArray(data.knowledgeState) ? data.knowledgeState : [];
    const visibleDialogueContext = Array.isArray(data.visibleDialogueContext) ? data.visibleDialogueContext : [];
    const classroomEventHistory = Array.isArray(data.classroomEventHistory)
      ? data.classroomEventHistory
      : Array.isArray(data.wrapup?.sessionStructure?.classroomEventHistory)
        ? data.wrapup.sessionStructure.classroomEventHistory
        : [];

    const [sessionKnowledge, dialogueKnowledge] = await Promise.all([
      executeSkill(sessionKnowledgeDistillerDefinition, {
        knowledgeState,
        knowledgeDelta: data.wrapup?.progress
          ? {
              newlyMastered: data.wrapup.progress.newlyMastered || [],
              movedToReview: data.wrapup.progress.movedToReview || [],
              stillLearning: data.wrapup.progress.stillLearning || [],
              unchangedMastered: data.wrapup.progress.unchangedMastered || []
            }
          : null,
        wrapup: data.wrapup || null,
        taskContext: { learningPathId: data.pathId, taskId: data.taskId },
        sessionEvidence: data.performance || null
      }),
      executeSkill(dialogueConceptExtractorDefinition, {
        visibleDialogueContext,
        classroomEventHistory,
        currentKnowledgeState: knowledgeState
      })
    ]);

    await prisma.$transaction(async (tx) => {
      const consumed = await tx.domain_event_inbox.findUnique({
        where: { consumerId_eventId: { consumerId: CONSUMER_ID, eventId: event.id } }
      });
      if (consumed) return;

      await tx.learner_evidence.createMany({
        data: [
          {
            id: `lev_${event.id}_session_knowledge_v1`,
            eventId: event.id,
            evidenceKey: 'lesson:session-knowledge-distiller:v1',
            userId: event.userId,
            pathId: data.pathId || null,
            milestoneId: data.milestoneId || null,
            taskId: data.taskId || null,
            sessionId: data.sessionId || null,
            evidenceType: 'session-knowledge-distilled',
            payload: JSON.stringify(sessionKnowledge || {}),
            confidence: 0.8,
            occurredAt: event.occurredAt
          },
          {
            id: `lev_${event.id}_dialogue_concepts_v1`,
            eventId: event.id,
            evidenceKey: 'lesson:dialogue-concept-extractor:v1',
            userId: event.userId,
            pathId: data.pathId || null,
            milestoneId: data.milestoneId || null,
            taskId: data.taskId || null,
            sessionId: data.sessionId || null,
            evidenceType: 'dialogue-concepts-extracted',
            payload: JSON.stringify(dialogueKnowledge || {}),
            confidence: 0.72,
            occurredAt: event.occurredAt
          }
        ]
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

export const lessonKnowledgeEnrichmentConsumer = new LessonKnowledgeEnrichmentConsumer();
