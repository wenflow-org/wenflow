/**
 * HTTP 错误 → 用户可读文案。
 *
 * 学习台此前把所有整页失败都写成「网络似乎不太稳定」，429 限流也被说成网络问题，
 * 用户会去查 WiFi、排查方向被带偏。这里按状态码给出准确原因，并读取 Retry-After。
 */

type ErrorLike = {
  status?: unknown;
  message?: unknown;
  response?: { headers?: Record<string, unknown> } | null;
};

/** Retry-After 秒数：支持数字秒与 HTTP-date；解析不到返回 null。 */
export function retryAfterSeconds(error: unknown): number | null {
  const headers = (error as ErrorLike | null)?.response?.headers as
    | (Record<string, unknown> & { get?: (name: string) => unknown })
    | null
    | undefined;
  if (!headers || typeof headers !== 'object') return null;
  // AxiosHeaders 用 get() 读取；普通对象/mock 走键值读取。
  const raw = (typeof headers.get === 'function'
    ? (headers.get('retry-after') ?? headers.get('Retry-After'))
    : undefined) ?? headers['retry-after'] ?? headers['Retry-After'];
  if (raw === undefined || raw === null || raw === '') return null;

  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) return Math.ceil(numeric);

  if (typeof raw === 'string') {
    const at = Date.parse(raw);
    if (!Number.isNaN(at)) return Math.max(1, Math.ceil((at - Date.now()) / 1000));
  }
  return null;
}

export function describeRequestError(
  error: unknown,
  fallback = '网络似乎不太稳定，检查连接后可以重试。',
): string {
  const status = typeof (error as ErrorLike | null)?.status === 'number'
    ? (error as ErrorLike).status as number
    : null;
  const message = typeof (error as ErrorLike | null)?.message === 'string'
    ? (error as ErrorLike).message as string
    : '';

  if (status === 429) {
    const seconds = retryAfterSeconds(error);
    return seconds
      ? `请求过于频繁，请等待 ${seconds} 秒后重试。`
      : '请求过于频繁，请稍后重试。';
  }
  if (status !== null && status >= 500) {
    return '服务暂时不可用，请稍后重试。';
  }
  // 传输层错误（断网/超时）本身已经说清楚了，原样透出，不再套一层「网络不稳定」。
  if (message === '网络错误，请检查连接' || message === '请求超时，请稍后重试') {
    return message;
  }
  return fallback;
}
