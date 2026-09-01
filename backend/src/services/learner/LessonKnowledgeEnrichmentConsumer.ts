import prisma from '../../config/database';
import type { DurableDomainEvent } from '../../events/contracts';
import { executeSkill } from '../../skills';
import { lessonKnowledgeEnricherDefinition, type LessonKnowledgeEnricherOutput } from '../../skills/lesson-knowledge-enricher';
import { logger } from '../../utils/logger';

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
    // 断链修复 P0-5：任务的可迁移目标（由 lesson:completed 事件携带）
    const transferGoal = typeof data.transferGoal === 'string' && data.transferGoal.trim()
      ? data.transferGoal.trim()
      : null;

    // 单次 LLM 调用完成知识台账蒸馏 + 隐性概念抽取（原两个 skill 合并）
    // 隔离语义：enricher 失败 → 不写证据、不写 receipt → 抛错给 outbox worker
    // （指数退避重投，MAX_ATTEMPTS=8 后 dead）；证据 ID 固定 + receipt 与证据同事务 → 重投幂等安全。
    // 快照/投影链不受影响：enricher 未写证据仅少一层 enrichment，确定性基底照常；快照读路径自愈重建。
    let enriched: LessonKnowledgeEnricherOutput | null = null;
    try {
      enriched = await executeSkill(lessonKnowledgeEnricherDefinition, {
        transferGoal,
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
    } catch (error) {
      logger.warn('[lesson-knowledge-enrichment] 课后知识增强失败，跳过本课证据写入（outbox 将退避重投）', {
        eventId: event.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    const sessionKnowledge = {
      conceptLedger: enriched?.conceptLedger || [],
      reusableFoundations: enriched?.reusableFoundations || [],
      blockedFoundations: enriched?.blockedFoundations || [],
      transferSignals: enriched?.transferSignals || [],
      // 知识状态自然语言摘要：供预测器（learning-predictor）与教学决策直接读取
      knowledgeStateSummary: typeof enriched?.knowledgeStateSummary === 'string' ? enriched.knowledgeStateSummary : '',
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
