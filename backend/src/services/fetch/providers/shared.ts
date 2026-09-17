/**
 * fetch provider 共用的解析 / 归一化 / 错误映射工具。
 * 与 services/search/providers/shared.ts 同构，仅错误码域不同。
 */

import { UnsafeUrlError } from '../../../utils/safe-http';
import { FetchError } from '../types';

/** 非空字符串才返回；否则 undefined（统一处理上游 null/空串/非字符串） */
export function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** 字符串数组过滤（links / image_links 等），非法项直接丢弃 */
export function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return items.length > 0 ? items : undefined;
}

/** 上游网络 / SSRF 策略错误 → 统一 FetchError（超时 vs 不可用可区分） */
export function toUpstreamError(error: unknown, providerLabel: string): FetchError {
  const code = (error as { code?: string } | null)?.code;
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') {
    return new FetchError('FETCH_UPSTREAM_TIMEOUT', `${providerLabel} 抓取接口响应超时`);
  }
  if (error instanceof UnsafeUrlError) {
    return new FetchError('FETCH_UPSTREAM_UNAVAILABLE', `${providerLabel} 抓取接口地址不被允许访问`);
  }
  return new FetchError('FETCH_UPSTREAM_UNAVAILABLE', `${providerLabel} 抓取接口暂时不可用`);
}

/** 该 provider 无法表达此请求（service 会据此降级到下一个 provider） */
export function unsupported(providerLabel: string, reason: string): FetchError {
  return new FetchError('FETCH_PROVIDER_UNSUPPORTED', `${providerLabel} 不支持 ${reason}`);
}

/** 内容过短的判定阈值（低于此长度视为空壳页 / 抽取失败） */
const MIN_CONTENT_CHARS = 50;
/** 控制字符占比超过该比例即判为二进制垃圾 */
const CONTROL_CHAR_RATIO = 0.02;
/** 控制字符采样窗口，避免长文本全量扫描 */
const SAMPLE_CHARS = 2_000;

/**
 * 内容可疑启发式：过短，或采样窗口内控制字符占比过高（典型如把 .doc
 * 二进制当正文返回——HTTP 200 但全是 \x00）。json 结构不做此判定。
 */
export function isSuspiciousContent(text: unknown): boolean {
  if (typeof text !== 'string') return false;
  if (text.length < MIN_CONTENT_CHARS) return true;

  const sample = text.length > SAMPLE_CHARS ? text.slice(0, SAMPLE_CHARS) : text;
  let control = 0;
  for (const ch of sample) {
    const codePoint = ch.codePointAt(0) ?? 0;
    // 保留 \t(9) \n(10) \r(13)，其余 C0 控制字符计入
    if (codePoint < 9 || (codePoint > 13 && codePoint < 32)) control += 1;
  }
  return control / sample.length > CONTROL_CHAR_RATIO;
}
