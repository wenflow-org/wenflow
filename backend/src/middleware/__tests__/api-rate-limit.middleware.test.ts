/**
 * 全局限流拆读/写额度回归（2026-10-23 线上走查 P0-1）：
 * 旧实现所有 /api 请求共用 1200/15min，正常浏览课堂即可耗尽，并把发言/提交一起锁死。
 */
import {
  GLOBAL_API_RATE_LIMIT,
  WRITE_API_RATE_LIMIT,
  isWriteRequest,
  shouldSkipGlobalApiLimit,
  shouldSkipWriteApiLimit,
} from '../api-rate-limit.middleware';

describe('API 限流读写分额', () => {
  it('读请求只占读额度，写请求只占写额度', () => {
    expect(isWriteRequest('GET')).toBe(false);
    expect(isWriteRequest('post')).toBe(true);

    expect(shouldSkipGlobalApiLimit({ method: 'GET', path: '/dashboard' })).toBe(false);
    expect(shouldSkipGlobalApiLimit({ method: 'POST', path: '/ai-teaching/sessions/s1/messages' })).toBe(true);

    expect(shouldSkipWriteApiLimit({ method: 'GET', path: '/dashboard' })).toBe(true);
    expect(shouldSkipWriteApiLimit({ method: 'POST', path: '/ai-teaching/sessions/s1/messages' })).toBe(false);
  });

  it('OPTIONS、健康检查与 admin 不占用户读写额度', () => {
    for (const method of ['OPTIONS', 'GET', 'POST']) {
      expect(shouldSkipGlobalApiLimit({ method, path: '/health' })).toBe(true);
      expect(shouldSkipWriteApiLimit({ method, path: '/health' })).toBe(true);
    }
    expect(shouldSkipGlobalApiLimit({ method: 'GET', path: '/admin/users' })).toBe(true);
    expect(shouldSkipWriteApiLimit({ method: 'POST', path: '/admin/users' })).toBe(true);
  });

  it('读额度高于旧全局限流，写额度保持独立', () => {
    expect(GLOBAL_API_RATE_LIMIT.max).toBeGreaterThan(1200);
    expect(WRITE_API_RATE_LIMIT.max).toBeGreaterThan(0);
    expect(GLOBAL_API_RATE_LIMIT.max).not.toBe(WRITE_API_RATE_LIMIT.max);
  });
});
