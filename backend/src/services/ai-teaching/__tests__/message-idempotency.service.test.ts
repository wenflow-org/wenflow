const mockFindUnique = jest.fn();
const mockCreate = jest.fn();
const mockUpdateMany = jest.fn();

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    teaching_message_operations: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      create: (...args: unknown[]) => mockCreate(...args),
      updateMany: (...args: unknown[]) => mockUpdateMany(...args),
    },
  },
}));

import {
  completeTeachingOperation,
  failTeachingOperation,
  reserveTeachingOperation,
  teachingOperationRequestHash,
  TeachingIdempotencyConflictError,
  TeachingMessageInFlightError,
} from '../TeachingMessageIdempotencyService';

const input = {
  sessionId: 'session-1',
  idempotencyKey: 'key-1',
  kind: 'message',
  requestHash: 'hash-1',
};

const row = (over: Record<string, unknown> = {}) => ({
  requestHash: 'hash-1',
  status: 'processing',
  resultJson: null,
  revision: null,
  updatedAt: new Date(),
  ...over,
});

describe('TeachingMessageIdempotencyService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate.mockResolvedValue({});
    mockUpdateMany.mockResolvedValue({ count: 1 });
  });

  it('新 key → 建 processing 行并放行', async () => {
    mockFindUnique.mockResolvedValue(null);
    await expect(reserveTeachingOperation(input)).resolves.toEqual({ kind: 'reserved' });
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        sessionId: 'session-1',
        idempotencyKey: 'key-1',
        kind: 'message',
        requestHash: 'hash-1',
        status: 'processing',
      }),
    }));
  });

  it('同 key 同请求且已完成 → 重放结果（含 revision）', async () => {
    mockFindUnique.mockResolvedValue(row({
      status: 'completed',
      resultJson: JSON.stringify({ aiResponse: '已提交', revision: 7 }),
      revision: 7,
    }));
    await expect(reserveTeachingOperation(input)).resolves.toEqual({
      kind: 'replay',
      result: { aiResponse: '已提交', revision: 7 },
      revision: 7,
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('同 key 不同请求 → 409 冲突，绝不返回上一请求结果', async () => {
    mockFindUnique.mockResolvedValue(row({ requestHash: 'other-hash' }));
    await expect(reserveTeachingOperation(input)).rejects.toBeInstanceOf(TeachingIdempotencyConflictError);
  });

  it('同 key 仍在途 → in_flight（不重复执行）', async () => {
    mockFindUnique.mockResolvedValue(row({ updatedAt: new Date() }));
    await expect(reserveTeachingOperation(input)).rejects.toBeInstanceOf(TeachingMessageInFlightError);
  });

  it('同 key 的 processing 行已超时 → 抢回处理权（允许重试）', async () => {
    mockFindUnique.mockResolvedValue(row({ updatedAt: new Date(Date.now() - 20 * 60 * 1000) }));
    await expect(reserveTeachingOperation(input)).resolves.toEqual({ kind: 'reserved' });
    expect(mockUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ sessionId: 'session-1', idempotencyKey: 'key-1', status: 'processing' }),
      data: expect.objectContaining({ status: 'processing', resultJson: null }),
    }));
  });

  it('同 key 上次失败 → 允许重试', async () => {
    mockFindUnique.mockResolvedValue(row({ status: 'failed' }));
    await expect(reserveTeachingOperation(input)).resolves.toEqual({ kind: 'reserved' });
    expect(mockUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'failed' }),
    }));
  });

  it('并发 create 撞唯一索引 → 重读后按同 key 语义归类', async () => {
    mockFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(row({ status: 'completed', resultJson: JSON.stringify({ revision: 2 }), revision: 2 }));
    mockCreate.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
    await expect(reserveTeachingOperation(input)).resolves.toEqual({
      kind: 'replay',
      result: { revision: 2 },
      revision: 2,
    });
  });

  it('complete 只更新 processing 行；fail 标记 failed 且不写结果', async () => {
    await completeTeachingOperation({ sessionId: 'session-1', idempotencyKey: 'key-1', result: { ok: true }, revision: 3 });
    expect(mockUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { sessionId: 'session-1', idempotencyKey: 'key-1', status: 'processing' },
      data: expect.objectContaining({ status: 'completed', resultJson: JSON.stringify({ ok: true }), revision: 3 }),
    }));

    mockUpdateMany.mockClear();
    await failTeachingOperation({ sessionId: 'session-1', idempotencyKey: 'key-1', errorCode: 'BOOM' });
    expect(mockUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'failed', errorCode: 'BOOM' }),
    }));
  });

  it('请求指纹对键序不敏感、对取值敏感', () => {
    const a = teachingOperationRequestHash('message', { message: 'hi', revision: 2, meta: { x: 1, y: 2 } });
    const b = teachingOperationRequestHash('message', { meta: { y: 2, x: 1 }, revision: 2, message: 'hi' });
    const c = teachingOperationRequestHash('message', { message: 'hi', revision: 3, meta: { x: 1, y: 2 } });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
