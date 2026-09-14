import { gatewayErrorHttpStatus } from '../gateway-http-status';

describe('gatewayErrorHttpStatus', () => {
  it('rate_limit 分类 / RATE_LIMITED / 429 都映射为 429', () => {
    expect(gatewayErrorHttpStatus({ category: 'rate_limit' })?.status).toBe(429);
    expect(gatewayErrorHttpStatus({ code: 'RATE_LIMITED' })?.status).toBe(429);
    expect(gatewayErrorHttpStatus({ statusCode: 429 })?.status).toBe(429);
  });

  it('quota 分类 / QUOTA_EXHAUSTED 映射为 503', () => {
    expect(gatewayErrorHttpStatus({ category: 'quota' })?.status).toBe(503);
    expect(gatewayErrorHttpStatus({ code: 'QUOTA_EXHAUSTED' })?.status).toBe(503);
  });

  it('非网关错误返回 null（调用方保持 500 兜底）', () => {
    expect(gatewayErrorHttpStatus(new Error('boom'))).toBeNull();
    expect(gatewayErrorHttpStatus({ category: 'protocol' })).toBeNull();
    expect(gatewayErrorHttpStatus(null)).toBeNull();
    expect(gatewayErrorHttpStatus('nope')).toBeNull();
  });
});
