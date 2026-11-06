/**
 * 学习者线事件消费者（`goal:understanding:updated` / `task:completed` / `lesson:completed` / `path:*`）。
 *
 * 固定顺序：证据投影 → 清画像缓存 → 快照重算 →（仅 lesson:completed）登记课后知识增强事件。
 *
 * 关键语义（2026-09-17 审计 §6.1 + #144/#145/#146）：
 *
 * 1. 课后知识增强是**增强层**，不是快照刷新的依赖——旧实现把它和「清缓存 + 快照刷新」放在同一个
 *    consumer 回调里顺序 await，增强层一旦 `throw` 就会中断后面两步。
 * 2. 但「吞下异常、刷新完再在链尾重抛」也不对（#146）：outbox 重投会从头再跑整条链（证据投影 →
 *    课后增强 → 清缓存 → 快照重算），最多 8 次；而这 8 次里每一次都不含本课的知识增量。
 * 3. 现在是**拆事件**（#144）：本消费者只跑快路径，然后为 `lesson:completed` 登记一条独立的
 *    `lesson:knowledge-enrichment` 事件（events/lesson-enrichment-event.ts）。增强的 LLM
 *    由 outbox 的独立泳道消费（不在这条有序事件的批处理路径上，失败也不会挡住该用户的后续事件），
 *    成功后由增强消费者自己把增量推进画像。
 *
 * 因此本函数对 `lesson:completed` 的耗时与 LLM 时长无关：一次收课不再占用唯一 worker 的批处理时间。
 */
import { learnerEvidenceProjector } from '../services/learner/LearnerEvidenceProjector';
import { enqueueLessonEnrichmentEvent } from './lesson-enrichment-event';
import { learnerProfileService } from '../services/learner/LearnerProfileService';
import { learnerSnapshotRefreshService } from '../services/learner/LearnerSnapshotRefreshService';
import type { DurableDomainEvent, DurableEventType } from './contracts';

/**
 * #148：只作废画像缓存、不触发快照重算的事件类型。
 *
 * `goal:understanding:updated` 的载荷不含 `pathId` / `taskId`（goal 阶段本就没有路径），
 * 消费侧的 scope 推断恒为 `'global'` —— 于是目标对话每澄清一轮都重建一次用户级全量快照。
 * 该快照在 goal 阶段没有消费方：目标对话本身不读快照，路径生成（path-generation.core）在
 * goal 收尾时会自行 `refresh({ scope: 'global' })` 重建并把学习证据注入首版难度校准；
 * 管理端读路径是 `getLatest`（10 分钟内先用持久化投影、过期才重建）。
 * 画像缓存仍然作废：profile-aggregator 读的正是本事件写入的 goal 证据，需按轮更新（惰性重算）。
 */
const PROFILE_ONLY_EVENT_TYPES: ReadonlySet<DurableEventType> = new Set(['goal:understanding:updated']);

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

  if (event.userId) {
    learnerProfileService.clear(event.userId);
    // #176-2：画像缓存清了，由旧画像算出的快照缓存也必须一起失效，否则读路径继续返回旧画像拼出的快照。
    learnerSnapshotRefreshService.invalidate(event.userId);
    const data = event.data || {};
    // #147：教学的 task:completed 带 sessionId（见 task-completion.service 的 completionContext）。
    // 它的投影键（teaching:path:milestone:task）与同一节课的 lesson:completed 完全相同，本次刷新
    // 由 lesson:completed 的消费承担——该事件在两条链路上都会刷新同一个 projectionKey（真人 finalize
    // 的 auto-end 在 completeTask 之前入队；VL 仿真 completeTask→endSession 反序），故这里与消费顺序
    // 无关地按 sessionId 跳过，避免同一键重复重算。
    // 例外（回归 #204）：本次结算前会话已闭合（end_only 补结算 / complete_task 重试）时不会再产出
    // lesson:completed，刷新改由 completeTask 的 eager 路径补做（sessionClosedBeforeCompletion），
    // 否则该次收尾对投影键 0 次刷新、快照静默陈旧。
    // 证据投影仍照做（幂等）；纯路径任务（无 sessionId）不在此列，仍由本消费者刷新。
    const isTeachingTaskCompletion = event.type === 'task:completed' && !!data.sessionId;
    if (!isTeachingTaskCompletion && !PROFILE_ONLY_EVENT_TYPES.has(event.type)) {
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

  // 快路径落定后再登记课后增强（#144）：登记本身只是一次 outbox upsert（幂等 id），
  // LLM 在独立泳道执行——本事件不必等它，也不会因它失败而重投。
  await enqueueLessonEnrichmentEvent(event);
}
