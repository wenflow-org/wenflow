export type DurableEventType =
  | 'goal:understanding:updated'
  | 'task:completed'
  | 'lesson:completed'
  | 'path:created'
  | 'path:generated'
  | 'path:adjusted'
  | 'path:completed'
  | 'review:completed';

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
