import type { DurableDomainEvent, DurableEventType } from './contracts';

export type DurableEventConsumer = (event: DurableDomainEvent) => Promise<void>;

export class DurableEventConsumerRegistry {
  private consumers = new Map<DurableEventType, DurableEventConsumer[]>();

  register(types: DurableEventType[], consumer: DurableEventConsumer): void {
    for (const type of types) {
      this.consumers.set(type, [...(this.consumers.get(type) || []), consumer]);
    }
  }

  async dispatch(event: DurableDomainEvent): Promise<void> {
    for (const consumer of this.consumers.get(event.type) || []) {
      await consumer(event);
    }
  }
}
