/**
 * P1-6 回归（2026-10-22 流程架构审计）：outbox 消费者之间必须隔离。
 *
 * 事故：dispatch 顺序 await 且无 per-consumer try/catch。metrics 消费者先失败会让
 * 证据投影/快照刷新一并跳过；整条事件重试耗尽后同入死信。
 */
jest.mock('../../utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import { DurableEventConsumerRegistry } from '../consumer-registry';
import { createDomainEvent } from '../contracts';

const event = createDomainEvent({
  type: 'task:completed',
  aggregateType: 'task',
  aggregateId: 'task-1',
  userId: 'u1',
  source: 'test',
  data: { taskId: 'task-1' },
});

describe('P1-6 消费者隔离', () => {
  it('前一个消费者失败后，后续消费者仍会执行；dispatch 最终仍抛错以触发重试', async () => {
    const registry = new DurableEventConsumerRegistry();
    const second = jest.fn(async () => undefined);
    registry.register(['task:completed'], async () => {
      throw new Error('metrics write failed');
    });
    registry.register(['task:completed'], second);

    await expect(registry.dispatch(event)).rejects.toThrow(/DURABLE_EVENT_CONSUMER_FAILED/);
    expect(second).toHaveBeenCalledWith(event);
  });

  it('全部消费者成功时 dispatch 正常返回', async () => {
    const registry = new DurableEventConsumerRegistry();
    const first = jest.fn(async () => undefined);
    const second = jest.fn(async () => undefined);
    registry.register(['task:completed'], first);
    registry.register(['task:completed'], second);

    await expect(registry.dispatch(event)).resolves.toBeUndefined();
    expect(first).toHaveBeenCalledWith(event);
    expect(second).toHaveBeenCalledWith(event);
  });
});
