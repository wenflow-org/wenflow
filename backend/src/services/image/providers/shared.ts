/**
 * image provider 共用的解析 / 归一化 / 错误映射工具。
 * 与 services/search / services/fetch 的 providers/shared.ts 同构，仅错误码域不同。
 */

import { UnsafeUrlError } from '../../../utils/safe-http';
import { ImageError } from '../types';

/** 非空字符串才返回；否则 undefined（统一处理上游 null/空串/非字符串） */
export function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/** 上游网络 / SSRF 策略错误 → 统一 ImageError（超时 vs 不可用可区分） */
export function toUpstreamError(error: unknown, providerLabel: string): ImageError {
  const code = (error as { code?: string } | null)?.code;
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') {
    return new ImageError('IMAGE_UPSTREAM_TIMEOUT', `${providerLabel} 生图接口响应超时`);
  }
  if (error instanceof UnsafeUrlError) {
    return new ImageError('IMAGE_UPSTREAM_UNAVAILABLE', `${providerLabel} 生图接口地址不被允许访问`);
  }
  return new ImageError('IMAGE_UPSTREAM_UNAVAILABLE', `${providerLabel} 生图接口暂时不可用`);
}

/** 该 provider 无法表达此请求（service 会据此降级到下一个 provider） */
export function unsupported(providerLabel: string, reason: string): ImageError {
  return new ImageError('IMAGE_PROVIDER_UNSUPPORTED', `${providerLabel} 不支持 ${reason}`);
}
