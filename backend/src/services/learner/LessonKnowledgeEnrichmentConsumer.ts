import prisma from '../../config/database';
import { withTransaction } from '../../utils/with-transaction';
import type { DurableDomainEvent } from '../../events/contracts';
import { executeSkill } from '../../skills';
import { lessonKnowledgeEnricherDefinition, type LessonKnowledgeEnricherOutput } from '../../skills/lesson-knowledge-enricher';
import { mapOutboxRecord } from '../../events/outbox.repository';
import { LESSON_ENRICHMENT_EVENT_TYPE, type LessonEnrichmentEventData } from '../../events/lesson-enrichment-event';
import { learnerProfileService } from './LearnerProfileService';
import { learnerSnapshotRefreshService } from './LearnerSnapshotRefreshService';
import { logger } from '../../utils/logger';

const CONSUMER_ID = 'lesson-knowledge-enrichment-v1';

export class LessonKnowledgeEnrichmentConsumer {
  /**
   * 独立增强事件入口（#144）：`lesson:knowledge-enrichment` 只带源事件 id，这里回查源
   * `lesson:completed` 行（published 后行仍在）再执行增强。
   *
   * 为什么回查而不是复制 payload：源 payload（wrapup / 对话上下文）数十 KB，复制一份到增强行
   * 无意义；且源行不会在本行消费前被清理（虚拟账号清理按 userId 整批删，两行同时消失）。
   */
  async handleEnrichmentEvent(event: DurableDomainEvent): Promise<void> {
    if (event.type !== LESSON_ENRICHMENT_EVENT_TYPE) return;
    const lessonEventId = (event.data as LessonEnrichmentEventData | undefined)?.lessonEventId;
    if (!lessonEventId) {
      logger.warn('[lesson-knowledge-enrichment] 增强事件缺少源事件引用，跳过', { eventId: event.id });
      return;
    }
    const source = await prisma.domain_event_outbox.findUnique({ where: { id: lessonEventId } });
    if (!source) {
      // 源事件行已被清理（如虚拟账号清理）：没有可增强的对象，直接终结，不重试。
      logger.warn('[lesson-knowledge-enrichment] 源 lesson:completed 行不存在，跳过本课增强', {
        eventId: event.id,
        lessonEventId,
      });
      return;
    }

    const lessonEvent = mapOutboxRecord(source);
    await this.handle(lessonEvent);

    // 增强证据刚落库：立刻把增量推进画像。
    // 快路径（learner-event-consumer）刷新时增强证据还不存在，而它的 `lastEventId` 用的是源事件 id；
    // 这里用**增强事件自己的 id**（与源 id 不同）作 lastEventId，因此不会被 refresh 的
    // 「lastEventId 相同直接返回旧投影」短路掉——本课知识增量随增强落地即进入画像，
    // 不再等下一个学习事件或读路径 TTL（#146 的「画像持续落后一节课」）。
    const userId = lessonEvent.userId;
    if (!userId) return;
    const data = lessonEvent.data || {};
    learnerProfileService.clear(userId);
    // #176-2：增强证据刚落库，旧画像算出的快照缓存与画像缓存一起失效，随后立刻重算。
    learnerSnapshotRefreshService.invalidate(userId);
    await learnerSnapshotRefreshService.refresh({
      userId,
      pathId: data.pathId || undefined,
      milestoneId: data.milestoneId || undefined,
      taskId: data.taskId || undefined,
      scope: data.pathId ? (data.taskId ? 'teaching' : 'path') : 'global',
      lastEventId: event.id,
      lastEventAt: event.occurredAt,
    });
  }

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

    // 呈现层投影（B1）：wrapup 里的**执行信封元数据**（runtimeEnvelope/debug）对知识蒸馏无信息量，
    // 实测每次稳定 ~2.4–2.8KB（占单次 payload 的 10~30%），发前剔除。
    const wrapupSource = data.wrapup && typeof data.wrapup === 'object' ? (data.wrapup as Record<string, unknown>) : null;
    const { runtimeEnvelope: _wrapupRuntimeEnvelope, debug: _wrapupDebug, ...wrapup } = (wrapupSource || {}) as Record<string, unknown>;
    const wrapupPayload = wrapupSource && Object.keys(wrapup).length > 0 ? wrapup : null;

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
        wrapup: wrapupPayload,
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

    await withTransaction(async (tx) => {
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
    }, { label: 'learner.lesson-knowledge-enrichment-consumer' });
  }
}

export const lessonKnowledgeEnrichmentConsumer = new LessonKnowledgeEnrichmentConsumer();
