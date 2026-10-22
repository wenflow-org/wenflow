import type { DurableDomainEvent, DurableEventType } from './contracts';
import { logger } from '../utils/logger';

export type DurableEventConsumer = (event: DurableDomainEvent) => Promise<void>;

export class DurableEventConsumerRegistry {
  private consumers = new Map<DurableEventType, DurableEventConsumer[]>();

  register(types: DurableEventType[], consumer: DurableEventConsumer): void {
    for (const type of types) {
      this.consumers.set(type, [...(this.consumers.get(type) || []), consumer]);
    }
  }

  async dispatch(event: DurableDomainEvent): Promise<void> {
    const consumers = this.consumers.get(event.type) || [];
    const failures: Array<{ index: number; error: unknown }> = [];

    // per-consumer 隔离（2026-10-22 审计 P1-6）：一个消费者失败不得阻止同事件的其他消费者。
    // 失败仍向上抛，让 outbox 按既有退避/死信策略重试；消费者需保持幂等。
    for (let index = 0; index < consumers.length; index += 1) {
      try {
        await consumers[index](event);
      } catch (error) {
        failures.push({ index, error });
        logger.error('[outbox] 持久事件消费者失败（继续执行其余消费者）', {
          eventId: event.id,
          eventType: event.type,
          consumerIndex: index,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (failures.length > 0) {
      const error = new Error(
        `DURABLE_EVENT_CONSUMER_FAILED: ${event.type} (${failures.length}/${consumers.length} consumers failed)`
      );
      (error as Error & { cause?: unknown }).cause = failures[0].error;
      throw error;
    }
  }
}
