/**
 * #114 回归：课堂消息偶发未送达时，只有「确定没送达」的错误才允许自动重发。
 * 判错方向的两个代价不对称：该重发没重发 = 用户手动点；不该重发却重发 = 用户看到两段回复 / 重复消费。
 */
import { describe, expect, it } from 'vitest';
import { isAutoRetryableSendError } from '../learningChat';

describe('#114 消息自动重发判据', () => {
  it('传输层失败（无 status）→ 可重试', () => {
    expect(isAutoRetryableSendError(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('429 与 5xx → 可重试', () => {
    expect(isAutoRetryableSendError({ status: 429 })).toBe(true);
    expect(isAutoRetryableSendError({ status: 500 })).toBe(true);
    expect(isAutoRetryableSendError({ status: 503 })).toBe(true);
    expect(isAutoRetryableSendError({ response: { status: 502 } })).toBe(true);
  });

  it('4xx 业务失败 → 不重试', () => {
    expect(isAutoRetryableSendError({ serverError: true, status: 400 })).toBe(false);
    expect(isAutoRetryableSendError({ serverError: true, status: 409 })).toBe(false);
  });

  it('已收到部分内容 → 不重试（否则两段回复）', () => {
    expect(isAutoRetryableSendError({ partialStream: true })).toBe(false);
  });

  it('用户主动取消 → 不重试', () => {
    expect(isAutoRetryableSendError({ cancelled: true })).toBe(false);
  });
});
