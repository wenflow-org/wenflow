/**
 * HTTP 服务端超时配置（全量测试报告 #59 / #53）。
 *
 * Node 的 `server.requestTimeout` 默认 **300 秒**：`POST /auto`（多轮 goal/path/learn 同步驱动）
 * 实测 304s 时被服务端拦腰截断——客户端只看到 `http=0`，且在途的教学轮被取消，需要二次调用
 * 才能收敛。教学回合自身的 wall-clock 兜底也刚好是 300s，默认值下两者贴边，长回合随时可能
 * 被服务端先行掐断。
 *
 * 口径：给**合法长请求**留出余量（默认 15 分钟，可用 SERVER_REQUEST_TIMEOUT_MS 覆盖，
 * 非法值回退默认）；headersTimeout 保持远小于 requestTimeout，避免慢头攻击面。
 * 驱动侧仍应遵守「单次 <5 分钟或自行分片」的协议约束（#53：undici headersTimeout 默认 300s
 * 是客户端计时器，服务端改不动，需要更长时由调用方显式放宽）。
 */

export const DEFAULT_SERVER_REQUEST_TIMEOUT_MS = 15 * 60 * 1000;
/** 请求头接收超时上限：Node 默认 60s；保持其间关系 headersTimeout <= requestTimeout */
export const SERVER_HEADERS_TIMEOUT_MS = 65 * 1000;
/** 保活超时：略大于多数反向代理的 60s，避免代理侧连接复用被服务端提前关闭 */
export const SERVER_KEEP_ALIVE_TIMEOUT_MS = 66 * 1000;

export function resolveServerRequestTimeoutMs(value: string | undefined = process.env.SERVER_REQUEST_TIMEOUT_MS): number {
  if (value === undefined || value.trim() === '') return DEFAULT_SERVER_REQUEST_TIMEOUT_MS;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_SERVER_REQUEST_TIMEOUT_MS;
  }
  // 下限：不得低于 1 分钟（小于任何合法长请求都会把默认行为改坏）
  return Math.max(parsed, 60 * 1000);
}

/** 应用到 http.Server：requestTimeout 放宽，headers/keepAlive 与节点默认协调 */
export function applyServerTimeouts(server: {
  requestTimeout: number;
  headersTimeout: number;
  keepAliveTimeout: number;
}): void {
  server.requestTimeout = resolveServerRequestTimeoutMs();
  server.headersTimeout = Math.min(SERVER_HEADERS_TIMEOUT_MS, server.requestTimeout);
  server.keepAliveTimeout = Math.min(SERVER_KEEP_ALIVE_TIMEOUT_MS, server.requestTimeout);
}
