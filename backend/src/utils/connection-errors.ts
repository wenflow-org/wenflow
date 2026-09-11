/**
 * 传输层连接噪声判定（QA ISSUE-006）
 *
 * 客户端在服务端仍写响应时断开（切页 / 中止请求 / 网络中断）会产生 EPIPE、
 * ECONNRESET 等 socket 错误。这些是连接噪声而非程序缺陷，不应触发进程级
 * 受控关闭——否则一次浏览器操作即可让整个后端退出，并中断所有运行中的
 * 虚拟实验会话（曾观测到 EPIPE 导致进程退出、3 个虚拟会话被置为 failed）。
 */
const BENIGN_CONNECTION_ERROR_CODES = new Set([
  'EPIPE',
  'ECONNRESET',
  'ECONNABORTED',
  'ERR_STREAM_DESTROYED',
  'ERR_STREAM_WRITE_AFTER_END',
  'EPROTO',
]);

/** 是否为「客户端断开」类传输层错误（应忽略、不触发进程关闭） */
export function isBenignConnectionError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' && BENIGN_CONNECTION_ERROR_CODES.has(code);
}

export { BENIGN_CONNECTION_ERROR_CODES };
