export type DurableEventType =
  | 'goal:understanding:updated'
  | 'task:completed'
  | 'lesson:completed'
  | 'path:created'
  | 'path:generated'
  | 'path:adjusted'
  | 'path:completed'
  | 'review:completed'
  /**
   * 课后知识增强（#144/#145/#146）：一次 10–20s 的 LLM 调用，不是快照刷新的依赖。
   * 由 `lesson:completed` 的消费**登记**（见 events/lesson-enrichment-event.ts），
   * 在 outbox 的**独立泳道**里消费——既不占住有序事件的关键路径，失败也不阻塞同用户后续事件。
   */
  | 'lesson:knowledge-enrichment';

export interface DurableDomainEvent<T = Record<string, any>> {
  id: string;
  type: DurableEventType;
  schemaVersion: number;
  aggregateType: 'goal' | 'task' | 'lesson' | 'path' | 'review';
  aggregateId: string;
  aggregateVersion?: number | null;
  userId?: string | null;
  source: string;
  data: T;
  metadata?: Record<string, any> | null;
  occurredAt: Date;
  /**
   * 排期（#106②，2026-10-19）：事件何时可以被消费，NULL = 无排期、立即可用。
   * 显式给值即排期；缺省时由 enqueueDomainEvent 按「未来 occurredAt」落成排期
   * （模拟日历按未来模拟日写入的事件照旧延后到那一天）。业务时间仍以 occurredAt 为准。
   */
  scheduledAt?: Date | null;
}

export function createDomainEvent<T>(input: Omit<DurableDomainEvent<T>, 'id' | 'schemaVersion' | 'occurredAt'> & {
  id?: string;
  schemaVersion?: number;
  occurredAt?: Date;
}): DurableDomainEvent<T> {
  const occurredAt = input.occurredAt || new Date();
  return {
    ...input,
    id: input.id || `evt_${occurredAt.getTime()}_${Math.random().toString(36).slice(2, 11)}`,
    schemaVersion: input.schemaVersion || 1,
    occurredAt
  };
}
