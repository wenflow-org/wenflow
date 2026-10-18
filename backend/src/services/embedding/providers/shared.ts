/**
 * embedding / rerank provider 共用的解析 / 归一化 / 错误映射工具。
 * 与 services/search / services/fetch / services/image 的 providers/shared.ts 同构，
 * 仅错误码域不同。
 */

import { UnsafeUrlError } from '../../../utils/safe-http';
import { EmbeddingError } from '../types';

/** 非空字符串才返回；否则 undefined（统一处理上游 null/空串/非字符串） */
export function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/** 有限数字才返回；否则 undefined */
export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** 上游网络 / SSRF 策略错误 → 统一 EmbeddingError（超时 vs 不可用可区分） */
export function toUpstreamError(error: unknown, providerLabel: string): EmbeddingError {
  const code = (error as { code?: string } | null)?.code;
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') {
    return new EmbeddingError('EMBEDDING_UPSTREAM_TIMEOUT', `${providerLabel} 向量化接口响应超时`);
  }
  if (error instanceof UnsafeUrlError) {
    return new EmbeddingError('EMBEDDING_UPSTREAM_UNAVAILABLE', `${providerLabel} 向量化接口地址不被允许访问`);
  }
  return new EmbeddingError('EMBEDDING_UPSTREAM_UNAVAILABLE', `${providerLabel} 向量化接口暂时不可用`);
}

/**
 * 归一化向量数组：把上游返回值收敛成「逐条 index 对齐」的结构。
 * 上游可能返回乱序（用 index 字段）或就按顺序；此处一律以返回的 index 为准做对齐，
 * 缺失 index 时按数组顺序。
 */
export function normalizeVectors(
  raw: Array<{ index?: unknown; embedding?: unknown }>,
  expectedCount: number,
  providerLabel: string
): Array<{ index: number; embedding: number[] }> {
  const out: Array<{ index: number; embedding: number[] }> = [];
  raw.forEach((item, fallbackIndex) => {
    const embedding = item?.embedding;
    if (!Array.isArray(embedding) || embedding.length === 0) return;
    const vec = embedding.map((value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0));
    const idx = typeof item?.index === 'number' && Number.isFinite(item.index) ? Math.trunc(item.index) : fallbackIndex;
    out.push({ index: idx, embedding: vec });
  });
  if (out.length !== expectedCount) {
    throw new EmbeddingError(
      'EMBEDDING_UPSTREAM_MALFORMED',
      `${providerLabel} 返回向量数（${out.length}）与入参条数（${expectedCount}）不一致`
    );
  }
  return out.sort((a, b) => a.index - b.index);
}
