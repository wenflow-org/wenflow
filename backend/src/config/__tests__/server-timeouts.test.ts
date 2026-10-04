/**
 * 服务端超时配置（全量测试报告 #59）：默认 15 分钟、env 覆盖、非法回退、下限保护，
 * 以及 apply 后 headersTimeout/keepAliveTimeout 与 requestTimeout 的协调关系。
 */
import {
  applyServerTimeouts,
  resolveServerRequestTimeoutMs,
  DEFAULT_SERVER_REQUEST_TIMEOUT_MS,
  SERVER_HEADERS_TIMEOUT_MS,
  SERVER_KEEP_ALIVE_TIMEOUT_MS,
} from '../server-timeouts';

describe('server-timeouts（报告 #59：/auto 长请求被 300s 默认超时截断）', () => {
  it('默认 15 分钟（远大于 Node 默认 300s 与教学回合 300s 兜底）', () => {
    expect(resolveServerRequestTimeoutMs(undefined)).toBe(DEFAULT_SERVER_REQUEST_TIMEOUT_MS);
    expect(resolveServerRequestTimeoutMs('')).toBe(DEFAULT_SERVER_REQUEST_TIMEOUT_MS);
    expect(DEFAULT_SERVER_REQUEST_TIMEOUT_MS).toBeGreaterThan(300_000);
  });

  it('env 可覆盖；非法值回退默认；低于 1 分钟被抬到下限', () => {
    expect(resolveServerRequestTimeoutMs('600000')).toBe(600_000);
    expect(resolveServerRequestTimeoutMs('abc')).toBe(DEFAULT_SERVER_REQUEST_TIMEOUT_MS);
    expect(resolveServerRequestTimeoutMs('-1')).toBe(DEFAULT_SERVER_REQUEST_TIMEOUT_MS);
    expect(resolveServerRequestTimeoutMs('0')).toBe(DEFAULT_SERVER_REQUEST_TIMEOUT_MS);
    expect(resolveServerRequestTimeoutMs('5000')).toBe(60_000);
  });

  it('apply 后 headersTimeout/keepAliveTimeout 不超过 requestTimeout', () => {
    const server = { requestTimeout: 300_000, headersTimeout: 60_000, keepAliveTimeout: 5_000 };
    applyServerTimeouts(server);
    expect(server.requestTimeout).toBe(DEFAULT_SERVER_REQUEST_TIMEOUT_MS);
    expect(server.headersTimeout).toBe(SERVER_HEADERS_TIMEOUT_MS);
    expect(server.keepAliveTimeout).toBe(SERVER_KEEP_ALIVE_TIMEOUT_MS);
    expect(server.headersTimeout).toBeLessThanOrEqual(server.requestTimeout);
    expect(server.keepAliveTimeout).toBeLessThanOrEqual(server.requestTimeout);
  });
});
