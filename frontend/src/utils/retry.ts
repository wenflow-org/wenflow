/**
 * 瞬时故障的静默重试（走查 N3）。
 *
 * 背景：后端在**启动/重启窗口**内会对用户请求返回 5xx，而同一接口稍后就是 200
 * （实测：路径详情拿到 500 → 页面直接进「加载失败 + 重试」，用户以为坏了）。
 * 这里只对**瞬时**错误做**一次**重试，避免把"真的没有/无权限"（4xx）也拖成慢失败。
 *
 * 判据：
 * - 5xx（服务端错误，含启动窗口未就绪）→ 瞬时；
 * - 无 response 的错误（网络中断 / DNS / 连接被拒）→ 瞬时；
 * - 4xx（含 401/403/404/409/422）→ **不是**瞬时，直接抛。
 */

interface AxiosishError {
  response?: { status?: number } | null;
  code?: string;
  message?: string;
}

/** 是否为「可能自己会好」的瞬时错误 */
export function isTransientServerError(err: unknown): boolean {
  const e = err as AxiosishError | null | undefined;
  const status = e?.response?.status;
  if (typeof status === 'number') return status >= 500;
  // 没有 response ⇒ 请求根本没到服务端（网络层）
  if (e && !e.response) return true;
  return false;
}

/** 失败即等一小段再试一次；仍失败则抛出（第二次的错误） */
export async function retryOnceOnTransient<T>(
  fn: () => Promise<T>,
  delayMs = 1200,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isTransientServerError(err)) throw err;
    await sleep(delayMs);
    return await fn();
  }
}
