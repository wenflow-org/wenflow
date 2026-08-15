/**
 * adminApi 黑盒命令 Idempotency-Key 会话级复用测试（P0-1 死锁修复）：
 * 同一 (sessionId, command) 在命令终态前复用同一 key，使后端「同 key 重试对账」路径可用；
 * 成功或不可重试失败后清除，下次操作使用新 key。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { postMock, createMock } = vi.hoisted(() => {
  const postMock = vi.fn();
  const createMock = vi.fn(() => ({
    post: postMock,
    interceptors: { response: { use: vi.fn() } },
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
  }));
  return { postMock, createMock };
});

vi.mock('axios', () => ({ default: { create: createMock } }));

import {
  adminVirtualLearnersApi,
  resetBlackboxCommandKeyCache,
  isRetryableBlackboxCommandError,
} from '../adminApi';

function idempotencyKeyOf(callIndex: number): string {
  return postMock.mock.calls[callIndex][2].headers['Idempotency-Key'];
}

describe('adminApi 黑盒命令 Idempotency-Key 会话级复用', () => {
  beforeEach(() => {
    resetBlackboxCommandKeyCache();
    postMock.mockReset();
  });

  it('同会话同命令可重试失败后重试复用同一 Idempotency-Key（死锁修复核心）', async () => {
    postMock
      .mockRejectedValueOnce({
        response: { status: 503, data: { retryable: true, code: 'BLACKBOX_RECONCILIATION_PENDING' } },
      })
      .mockResolvedValueOnce({ data: { success: true } });

    await expect(
      adminVirtualLearnersApi.executeBlackboxVirtualAction(
        'vs1', { type: 'abandon', reason: 'operator_abandon' }, 3
      )
    ).rejects.toMatchObject({ response: expect.objectContaining({ status: 503 }) });
    await adminVirtualLearnersApi.executeBlackboxVirtualAction(
      'vs1', { type: 'abandon', reason: 'operator_abandon' }, 3
    );

    expect(postMock).toHaveBeenCalledTimes(2);
    expect(idempotencyKeyOf(1)).toBe(idempotencyKeyOf(0));
    expect(postMock.mock.calls[0][2].headers['X-Expected-Trace-Count']).toBe('3');
    expect(postMock.mock.calls[0][1]).toEqual({ type: 'abandon', reason: 'operator_abandon' });
  });

  it('命令成功后清除缓存，下一次同命令使用新 key（不误复用终态命令）', async () => {
    postMock.mockResolvedValue({ data: { success: true } });

    await adminVirtualLearnersApi.executeBlackboxVirtualAction('vs1', { type: 'abandon', reason: 'x' }, 1);
    await adminVirtualLearnersApi.executeBlackboxVirtualAction('vs1', { type: 'abandon', reason: 'x' }, 1);

    expect(postMock).toHaveBeenCalledTimes(2);
    expect(idempotencyKeyOf(1)).not.toBe(idempotencyKeyOf(0));
  });

  it('不可重试失败（如轨迹序号过期）清除缓存，重试换新 key', async () => {
    postMock
      .mockRejectedValueOnce({
        response: { status: 409, data: { code: 'BLACKBOX_TRACE_SEQUENCE_MISMATCH' } },
      })
      .mockResolvedValueOnce({ data: { success: true } });

    await expect(
      adminVirtualLearnersApi.executeBlackboxVirtualAction('vs1', { type: 'abandon', reason: 'x' }, 2)
    ).rejects.toMatchObject({ response: expect.objectContaining({ status: 409 }) });
    await adminVirtualLearnersApi.executeBlackboxVirtualAction('vs1', { type: 'abandon', reason: 'x' }, 2);

    expect(idempotencyKeyOf(1)).not.toBe(idempotencyKeyOf(0));
  });

  it('不同动作命令与不同会话使用不同 key', async () => {
    postMock.mockResolvedValue({ data: { success: true } });

    await adminVirtualLearnersApi.executeBlackboxVirtualAction('vs1', { type: 'abandon', reason: 'a' }, 1);
    await adminVirtualLearnersApi.executeBlackboxVirtualAction('vs1', { type: 'abandon', reason: 'b' }, 1);
    await adminVirtualLearnersApi.executeBlackboxVirtualAction('vs2', { type: 'abandon', reason: 'a' }, 1);

    expect(postMock).toHaveBeenCalledTimes(3);
    const keys = postMock.mock.calls.map((call) => call[2].headers['Idempotency-Key']);
    expect(new Set(keys).size).toBe(3);
  });

  it('可重试判定：retryable=true 或 503 保留 key，其余清除', () => {
    expect(isRetryableBlackboxCommandError({ response: { status: 503 } })).toBe(true);
    expect(isRetryableBlackboxCommandError({ response: { status: 409, data: { retryable: true } } })).toBe(true);
    expect(isRetryableBlackboxCommandError({ response: { status: 409, data: { retryable: false } } })).toBe(false);
    expect(isRetryableBlackboxCommandError(new Error('network'))).toBe(false);
  });
});
