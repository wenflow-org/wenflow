/**
 * 瞬时故障静默重试的回归（走查 N3）：
 * - 5xx / 网络层错误 → 重试一次；
 * - 4xx → 不重试（别把"真的没有/无权限"拖成慢失败）；
 * - 第二次仍失败 → 抛出（不吞错）。
 */
import { describe, expect, it, vi } from 'vitest';
import { isTransientServerError, retryOnceOnTransient } from '../retry';

describe('utils/retry', () => {
  it('5xx 与网络层错误算瞬时；4xx 不算', () => {
    expect(isTransientServerError({ response: { status: 500 } })).toBe(true);
    expect(isTransientServerError({ response: { status: 503 } })).toBe(true);
    expect(isTransientServerError({ message: 'Network Error' })).toBe(true);
    expect(isTransientServerError({ response: { status: 404 } })).toBe(false);
    expect(isTransientServerError({ response: { status: 401 } })).toBe(false);
    expect(isTransientServerError({ response: { status: 409 } })).toBe(false);
    expect(isTransientServerError(null)).toBe(false);
  });

  it('首次 5xx → 重试一次并成功（不打扰用户）', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce({ response: { status: 500 } })
      .mockResolvedValueOnce('ok');
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(retryOnceOnTransient(fn, 1, sleep)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('4xx 直接抛，不重试', async () => {
    const fn = vi.fn().mockRejectedValue({ response: { status: 404 } });
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(retryOnceOnTransient(fn, 1, sleep)).rejects.toEqual({ response: { status: 404 } });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('两次都 5xx → 抛出第二次错误（不吞）', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce({ response: { status: 500 } })
      .mockRejectedValueOnce({ response: { status: 502 } });
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(retryOnceOnTransient(fn, 1, sleep)).rejects.toEqual({ response: { status: 502 } });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('首次成功则只调用一次', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(retryOnceOnTransient(fn, 1, vi.fn())).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
