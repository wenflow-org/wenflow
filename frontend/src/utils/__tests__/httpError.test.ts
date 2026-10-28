import { describe, expect, it } from 'vitest';
import { describeRequestError, retryAfterSeconds } from '../httpError';

describe('describeRequestError', () => {
  it('429 明说请求过于频繁，并带 Retry-After 秒数', () => {
    const error = { status: 429, response: { headers: { 'retry-after': '534' } } };
    expect(retryAfterSeconds(error)).toBe(534);
    expect(describeRequestError(error)).toBe('请求过于频繁，请等待 534 秒后重试。');
  });

  it('兼容 AxiosHeaders 的 get() 读取方式', () => {
    const headers = { get: (name: string) => (name === 'retry-after' ? '42' : undefined) };
    expect(retryAfterSeconds({ status: 429, response: { headers } })).toBe(42);
  });

  it('429 没有 Retry-After 时仍给出准确原因', () => {
    expect(describeRequestError({ status: 429 })).toBe('请求过于频繁，请稍后重试。');
  });

  it('5xx 不再伪装成网络问题', () => {
    expect(describeRequestError({ status: 503 })).toBe('服务暂时不可用，请稍后重试。');
  });

  it('传输层错误原样透出，未知错误回退默认文案', () => {
    expect(describeRequestError({ message: '网络错误，请检查连接' })).toBe('网络错误，请检查连接');
    expect(describeRequestError({ message: 'boom' })).toBe('网络似乎不太稳定，检查连接后可以重试。');
  });
});
