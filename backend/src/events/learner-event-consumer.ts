/**
 * 学习者线事件消费者（`goal:understanding:updated` / `task:completed` / `lesson:completed` / `path:*`）。
 *
 * 固定顺序：证据投影 → 课后知识增强 → 清画像缓存 → 快照重算。
 *
 * 关键语义（2026-09-17 审计 §6.1 修复）：课后知识增强是**增强层**，不是快照刷新的依赖。
 * 旧实现把它和「清缓存 + 快照刷新」放在同一个 consumer 回调里顺序 await，增强层一旦 `throw`
 * 就会中断后面两步——快照只能等读路径自愈（`getLatest` 超过 TTL 才重建）才刷新。
 * 现在增强失败被吞下并**在链尾重新抛出**：既保证清缓存/快照照常执行，又保留 outbox 的退避重投语义
 * （增强消费本身按 `domain_event_inbox` receipt 幂等，重投不会重复写证据）。
 */
import { learnerEvidenceProjector } from '../services/learner/LearnerEvidenceProjector';
import { lessonKnowledgeEnrichmentConsumer } from '../services/learner/LessonKnowledgeEnrichmentConsumer';
import { learnerProfileService } from '../services/learner/LearnerProfileService';
import { learnerSnapshotRefreshService } from '../services/learner/LearnerSnapshotRefreshService';
import { logger } from '../utils/logger';
import type { DurableDomainEvent, DurableEventType } from './contracts';

/** 该消费者负责的事件类型（与 outbox 注册保持一致） */
export const LEARNER_EVENT_TYPES: DurableEventType[] = [
  'goal:understanding:updated',
  'task:completed',
  'lesson:completed',
  'path:created',
  'path:generated',
  'path:adjusted',
  'path:completed',
];

export async function handleLearnerEvent(event: DurableDomainEvent): Promise<void> {
  await learnerEvidenceProjector.handle(event);

  let enrichmentError: unknown = null;
  try {
    await lessonKnowledgeEnrichmentConsumer.handle(event);
  } catch (error) {
    enrichmentError = error;
    logger.warn('课后知识增强失败：不阻断画像快照刷新（outbox 将退避重投）', {
      eventId: event.id,
      eventType: event.type,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (event.userId) {
    learnerProfileService.clear(event.userId);
    const data = event.data || {};
    // #147：教学的 task:completed 带 sessionId（见 task-completion.service 的 completionContext）。
    // 它的投影键（teaching:path:milestone:task）与同一次收尾的 lesson:completed 完全相同，而
    // lesson:completed 一定先于它入队（endSession 在 completeTask 之前）且同用户受队头保护，
    // 该行已被 lesson:completed 的消费刷新过——再刷一次是同一 projectionKey 的重复重算。
    // 证据投影仍照做（幂等）；纯路径任务（无 sessionId）不在此列，仍由本消费者刷新。
    const isTeachingTaskCompletion = event.type === 'task:completed' && !!data.sessionId;
    if (!isTeachingTaskCompletion) {
      await learnerSnapshotRefreshService.refresh({
        userId: event.userId,
        pathId: data.pathId || undefined,
        milestoneId: data.milestoneId || undefined,
        taskId: data.taskId || undefined,
        scope: data.pathId ? (data.taskId ? 'teaching' : 'path') : 'global',
        lastEventId: event.id,
        lastEventAt: event.occurredAt,
      });
    }
  }

  // 增强失败在链尾重抛：快照已刷新，但事件仍需重投以补齐增强产物
  if (enrichmentError) throw enrichmentError;
}
