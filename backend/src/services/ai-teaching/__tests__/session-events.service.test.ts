const eventCreate = jest.fn();
const eventFindMany = jest.fn();

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    session_events: {
      create: (...args: unknown[]) => eventCreate(...args),
      findMany: (...args: unknown[]) => eventFindMany(...args),
    },
  },
}));

jest.mock('../../../utils/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

import { listSessionEvents, recordSessionEvent, trimSessionEventPayload } from '../session-events.service';

describe('session events service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    eventCreate.mockResolvedValue({});
    eventFindMany.mockResolvedValue([]);
  });

  it('trimSessionEventPayload：空值返回 null，短载荷原样保留', () => {
    expect(trimSessionEventPayload(null)).toBeNull();
    expect(trimSessionEventPayload(undefined)).toBeNull();
    expect(trimSessionEventPayload({ a: 1 })).toBe(JSON.stringify({ a: 1 }));
  });

  it('trimSessionEventPayload：超长载荷截断并标注原始字节数', () => {
    const raw = trimSessionEventPayload({ blob: 'x'.repeat(20000) })!;
    const parsed = JSON.parse(raw);
    expect(parsed.__truncated).toBe(true);
    expect(parsed.bytes).toBeGreaterThan(20000);
    expect(raw.length).toBeLessThanOrEqual(8300);
  });

  it('trimSessionEventPayload：循环引用降级为不可序列化标记', () => {
    const cyclic: Record<string, unknown> = { name: 'loop' };
    cyclic.self = cyclic;
    expect(JSON.parse(trimSessionEventPayload(cyclic)!)).toEqual({ __unserializable: true });
  });

  it('recordSessionEvent：默认写 info 状态并裁剪 revision', async () => {
    await recordSessionEvent({ sessionId: 's1', kind: 'turn.committed', revision: 3, payload: { ok: true } });
    expect(eventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sessionId: 's1',
        kind: 'turn.committed',
        status: 'info',
        revision: 3,
        actor: null,
      }),
    });
  });

  it('recordSessionEvent：传事务客户端时用同一客户端写（事务内事件）', async () => {
    const txCreate = jest.fn().mockResolvedValue({});
    await recordSessionEvent(
      { sessionId: 's1', kind: 'session.initialized', actor: 'system', status: 'ok', revision: 1 },
      { session_events: { create: txCreate } }
    );
    expect(txCreate).toHaveBeenCalledTimes(1);
    expect(eventCreate).not.toHaveBeenCalled();
  });

  it('recordSessionEvent：写失败只告警，不向调用方抛错', async () => {
    eventCreate.mockRejectedValue(new Error('db locked'));
    await expect(recordSessionEvent({ sessionId: 's1', kind: 'error', status: 'failed' })).resolves.toBeUndefined();
  });

  it('listSessionEvents：limit 收敛到 1..1000，参数映射正确', async () => {
    await listSessionEvents('s1', { limit: 5000, sinceId: 10, kinds: ['turn.committed'] });
    const args = eventFindMany.mock.calls[0][0];
    expect(args.where).toEqual({ sessionId: 's1', id: { gt: 10 }, kind: { in: ['turn.committed'] } });
    expect(args.take).toBe(1000);
    expect(args.orderBy).toEqual({ id: 'asc' });

    await listSessionEvents('s1', { limit: 0 });
    expect(eventFindMany.mock.calls[1][0].take).toBe(1);
  });

  it('listSessionEvents：空 kinds 不生成 in 过滤', async () => {
    await listSessionEvents('s1', { kinds: [] });
    expect(eventFindMany.mock.calls[0][0].where).toEqual({ sessionId: 's1' });
  });
});
