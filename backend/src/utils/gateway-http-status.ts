/**
 * 网关执行错误 → 对外 HTTP 状态映射。
 *
 * 背景：上游 LLM 限流（429）/ 额度耗尽若一律落 500，会污染服务端错误率，
 * 并让客户端把「可重试的限流」误判为「服务端故障」。这里把网关已分类的错误
 * （GatewayExecutionError.category/code/statusCode）透传为语义正确的状态码。
 *
 * 返回 null 表示「不是可识别的网关错误」——调用方保持原有 500 兜底。
 */
export interface GatewayHttpStatus {
  status: number;
  code: string;
  message: string;
}

export function gatewayErrorHttpStatus(error: unknown): GatewayHttpStatus | null {
  if (!error || typeof error !== 'object') return null;
  const e = error as { category?: unknown; code?: unknown; statusCode?: unknown };
  const category = typeof e.category === 'string' ? e.category : '';
  const code = typeof e.code === 'string' ? e.code : '';
  const statusCode = typeof e.statusCode === 'number' ? e.statusCode : undefined;

  if (code === 'RATE_LIMITED' || category === 'rate_limit' || statusCode === 429) {
    return { status: 429, code: 'RATE_LIMITED', message: '上游模型限流，请稍后重试' };
  }
  if (code === 'QUOTA_EXHAUSTED' || category === 'quota') {
    return { status: 503, code: 'QUOTA_EXHAUSTED', message: '上游模型额度不足，请稍后重试' };
  }
  return null;
}
