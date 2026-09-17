/**
 * provider 共用的解析 / 归一化 / 错误映射工具。
 *
 * 目标：各 adapter 只写"该 provider 自己的请求体与响应字段映射"，
 * 通用逻辑（类型收敛、上游错误分类、hostname 提取）集中在此，避免三份重复。
 */

import { UnsafeUrlError } from '../../../utils/safe-http';
import { SearchError } from '../types';

/** 非空字符串才返回；否则 undefined（统一处理上游 null/空串/非字符串） */
export function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** 从 URL 提取站点名（Tavily / Exa 不返回 site_name，统一由 URL 派生） */
export function hostnameOf(url: string): string | undefined {
  try {
    return new URL(url).hostname || undefined;
  } catch {
    return undefined;
  }
}

/** 上游网络 / SSRF 策略错误 → 统一 SearchError（超时 vs 不可用可区分） */
export function toUpstreamError(error: unknown, providerLabel: string): SearchError {
  const code = (error as { code?: string } | null)?.code;
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') {
    return new SearchError('SEARCH_UPSTREAM_TIMEOUT', `${providerLabel} 搜索接口响应超时`);
  }
  if (error instanceof UnsafeUrlError) {
    return new SearchError('SEARCH_UPSTREAM_UNAVAILABLE', `${providerLabel} 搜索接口地址不被允许访问`);
  }
  return new SearchError('SEARCH_UPSTREAM_UNAVAILABLE', `${providerLabel} 搜索接口暂时不可用`);
}

/** 该 provider 无法表达此查询（service 会据此降级到下一个 provider） */
export function unsupported(providerLabel: string, reason: string): SearchError {
  return new SearchError('SEARCH_PROVIDER_UNSUPPORTED', `${providerLabel} 不支持 ${reason}`);
}
