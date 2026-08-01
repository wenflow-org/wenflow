import prisma from '../../config/database';
import type { DurableDomainEvent } from '../../events/contracts';
import { executeSkill } from '../../skills';
import { lessonKnowledgeEnricherDefinition } from '../../skills/lesson-knowledge-enricher';

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

    // 单次 LLM 调用完成知识台账蒸馏 + 隐性概念抽取（原两个 skill 合并）
    const enriched = await executeSkill(lessonKnowledgeEnricherDefinition, {
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
      sessionEvidence: data.performance || null,
      visibleDialogueContext,
      classroomEventHistory,
    });

    const sessionKnowledge = {
      conceptLedger: enriched?.conceptLedger || [],
      reusableFoundations: enriched?.reusableFoundations || [],
      blockedFoundations: enriched?.blockedFoundations || [],
      transferSignals: enriched?.transferSignals || [],
    };
    const dialogueKnowledge = {
      recurringConfusions: enriched?.recurringConfusions || [],
      transferSignals: enriched?.transferSignals || [],
    };

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
