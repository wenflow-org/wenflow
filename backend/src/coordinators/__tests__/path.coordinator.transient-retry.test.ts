import { isProviderTransientPathError } from '../path.coordinator';

/**
 * 修复批 11-①（u04 批 J critical）：路径生成遇中转网关 410「openai_error」——上游渠道池
 * 路由抖动（同分钟内同 skill 其他调用全部成功），必须按瞬态处理走一次延迟重试，
 * 而不是把路径直接打进终态 failed（学习者整课缺失）。
 */
describe('isProviderTransientPathError（路径生成瞬态判定）', () => {
  it('病历单形态命中：410 openai_error', () => {
    expect(isProviderTransientPathError(
      new Error('PATH_GENERATION_FAILED: API request failed with status 410: {"error":{"message":"openai_error"}}'),
    )).toBe(true);
  });

  it('其他上游瞬态形态命中：408/425/429/5xx/超时/网络', () => {
    expect(isProviderTransientPathError(new Error('API request failed with status 408: timeout'))).toBe(true);
    expect(isProviderTransientPathError(new Error('API request failed with status 502: bad gateway'))).toBe(true);
    expect(isProviderTransientPathError(new Error('RATE_LIMITED: too many requests'))).toBe(true);
    expect(isProviderTransientPathError(new Error('request aborted after 300s'))).toBe(true);
    expect(isProviderTransientPathError(new Error('getaddrinfo ECONNREFUSED ...'))).toBe(true);
    expect(isProviderTransientPathError({ retryable: true, message: 'whatever' })).toBe(true);
  });

  it('永久失败不命中：422 内容安全拒绝 / 401 / 400 校验错 / 无关错误', () => {
    expect(isProviderTransientPathError(
      new Error('API request failed with status 422: {"error":{"message":"input rejected by content safety screening"}}'),
    )).toBe(false);
    expect(isProviderTransientPathError(new Error('API request failed with status 401: unauthorized'))).toBe(false);
    expect(isProviderTransientPathError(new Error('SCHEMA_VIOLATION: missing field milestones'))).toBe(false);
    expect(isProviderTransientPathError(null)).toBe(false);
    expect(isProviderTransientPathError(undefined)).toBe(false);
  });
});
