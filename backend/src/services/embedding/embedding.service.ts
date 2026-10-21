/**
 * 向量化 / 重排编排服务（平台基础设施模型 embedding / rerank 的运行时入口）。
 *
 * 职责：校验入参 → 按 EMBEDDING_PROVIDER 顺序逐个 provider 尝试 → 失败自动降级 →
 * 返回统一结构（含实际命中的 provider 与尝试链）。
 *
 * 与 fetch 的「部分成功」语义不同：embedding 是「整批成功/失败」（批内一条不齐即异常，
 * 见 providers/shared.normalizeVectors），因此不设 lastPartial 分支，与 image 同构。
 */

import { logger } from '../../utils/logger';
import { createEmbeddingProviders, asRerankProvider, resolveEmbeddingProviderOrder } from './providers';
import { getInfraModelConfigSync } from './infra-config.service';
import { EmbeddingError } from './types';
import type {
  EmbeddedVector,
  EmbeddingProvider,
  EmbeddingProviderId,
  EmbeddingRequest,
  EmbeddingResponse,
  RerankProvider,
  RerankRequest,
  RerankResponse,
} from './types';
import { MAX_BATCH_SIZE, normalizeEmbeddingRequest, normalizeRerankRequest, toInputArray } from './validate';

export interface EmbedCallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** 覆盖 EMBEDDING_PROVIDER 的 provider 顺序（测试 / 内部编排用） */
  providerOrder?: EmbeddingProviderId[];
  /** 覆盖 provider 实例（测试注入用） */
  providers?: Partial<Record<EmbeddingProviderId, EmbeddingProvider & Partial<RerankProvider>>>;
}

/**
 * 批量分组的**偏好**大小（平台配置 `infraModels.embedding.batchSize`，默认 32，上限 MAX_BATCH_SIZE）。
 * 为什么不是直接用 128 上限：真机实测把整篇文档一次发出去（最多 128 块 × ~900 字 ≈ 11 万字）
 * 会让上游 20s 预算扛不住 —— `EMBEDDING_UPSTREAM_TIMEOUT` 出现过 5 次，每次整篇索引全废。
 * 小批多次对上游更友好，也给了「超时对半拆」足够的降级空间。
 */
const DEFAULT_EMBEDDING_BATCH_SIZE = 32;
/** 超时对半拆的重试深度上限（128 → 64 → 32 → 16，最多 4 轮）。 */
const MAX_TIMEOUT_SPLIT_DEPTH = 3;

function preferredEmbeddingBatchSize(): number {
  const configured = Number(getInfraModelConfigSync().embedding.batchSize);
  const size = Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : DEFAULT_EMBEDDING_BATCH_SIZE;
  return Math.max(1, Math.min(size, MAX_BATCH_SIZE));
}

/** 单批（已按偏好大小切好）的发请求 + 超时自适应对半拆。 */
async function embedWithSplit(
  request: EmbeddingRequest,
  options: EmbedCallOptions,
  depth: number
): Promise<EmbeddingResponse> {
  try {
    return await embedOneBatch(request, options);
  } catch (error) {
    const inputs = toInputArray(request?.input);
    // 超时且批内不止一条 → 对半拆再试（上游扛不住大请求时自动降级为小请求，而不是整篇失败）
    if (
      error instanceof EmbeddingError &&
      error.code === 'EMBEDDING_UPSTREAM_TIMEOUT' &&
      inputs.length > 1 &&
      depth < MAX_TIMEOUT_SPLIT_DEPTH
    ) {
      const mid = Math.ceil(inputs.length / 2);
      logger.warn('[embedding] 批量超时，对半拆分重试', { size: inputs.length, half: mid });
      const startedAt = Date.now();
      const first = await embedWithSplit({ ...request, input: inputs.slice(0, mid) }, options, depth + 1);
      const second = await embedWithSplit({ ...request, input: inputs.slice(mid) }, options, depth + 1);
      return {
        vectors: [
          ...first.vectors,
          ...second.vectors.map((v) => ({ index: mid + v.index, embedding: v.embedding })),
        ],
        model: second.model || first.model,
        dimensions: first.dimensions || second.dimensions,
        provider: first.provider,
        attempts: first.attempts,
        latencyMs: Date.now() - startedAt,
      };
    }
    throw error;
  }
}

/**
 * 文本向量化。input 单条或批量；返回 vectors 与入参顺序严格对齐（index 0..n-1）。
 *
 * **大批量自动分组**（2026-10-16 真机修正）：上游单请求批量上限 `MAX_BATCH_SIZE`（128），
 * 而调用方常常是一整篇文档的所有块（长文档轻易超 128 块）。初版直接整批发出去，
 * 结果是**该资料的整篇索引全部失败**（真机实测 17/30 份长文档踩中）。
 * 现在按偏好大小（默认 32）分组串行发出，把各组 index 按**全局偏移**拼回，对调用方完全透明。
 * 单组失败仍按整体失败处理（不做部分成功——见模块头注释的"整批成功/失败"语义）。
 */
export async function embedTexts(
  request: EmbeddingRequest,
  options: EmbedCallOptions = {}
): Promise<EmbeddingResponse> {
  const inputs = toInputArray(request?.input);
  const batchSize = preferredEmbeddingBatchSize();
  const startedAt = Date.now();
  const vectors: EmbeddedVector[] = [];
  const attempts: EmbeddingProviderId[] = [];
  let model = '';
  let dimensions = 0;
  let provider: EmbeddingProviderId | null = null;

  for (let offset = 0; offset < inputs.length; offset += batchSize) {
    const group = inputs.slice(offset, offset + batchSize);
    const part = await embedWithSplit({ ...request, input: group }, options, 0);
    for (const item of part.vectors) vectors.push({ index: offset + item.index, embedding: item.embedding });
    model = part.model || model;
    dimensions = part.dimensions || dimensions;
    provider = part.provider;
    for (const id of part.attempts) if (!attempts.includes(id)) attempts.push(id);
  }

  return {
    vectors,
    model,
    dimensions,
    provider: provider ?? resolveEmbeddingProviderOrder()[0],
    attempts,
    latencyMs: Date.now() - startedAt,
  };
}

/** 单批请求：校验 → 按 provider 顺序尝试 → 降级链。 */
async function embedOneBatch(
  request: EmbeddingRequest,
  options: EmbedCallOptions = {}
): Promise<EmbeddingResponse> {
  const normalized = normalizeEmbeddingRequest(request);
  const providers = options.providers ?? createEmbeddingProviders();
  const order = options.providerOrder ?? resolveEmbeddingProviderOrder();

  const startedAt = Date.now();
  const attempts: EmbeddingProviderId[] = [];
  let lastError: unknown;

  for (const id of order) {
    const provider = providers[id];
    if (!provider) continue;
    if (!provider.isConfigured()) continue;

    attempts.push(id);
    try {
      const result = await provider.embed(normalized, {
        signal: options.signal,
        timeoutMs: options.timeoutMs,
      });
      return {
        vectors: result.vectors,
        model: result.model,
        dimensions: result.dimensions,
        provider: id,
        attempts,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      lastError = error;
      logger.warn('[embedding] provider 调用失败，尝试降级', {
        provider: id,
        code: error instanceof EmbeddingError ? error.code : undefined,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (attempts.length === 0) {
    throw new EmbeddingError(
      'EMBEDDING_PROVIDER_NOT_CONFIGURED',
      '没有可用的向量化 provider：请在 backend/.env 配置 EMBEDDING_API_URL 与 EMBEDDING_API_KEY'
    );
  }
  // 单 provider 时保留上游原始错误码（超时 / HTTP / 结构异常），不压成笼统的 ALL_FAILED
  if (lastError instanceof EmbeddingError) throw lastError;
  throw new EmbeddingError('EMBEDDING_ALL_PROVIDERS_FAILED', '所有向量化 provider 均调用失败');
}

/**
 * 候选重排。返回按相关分降序的 results（index 回指 documents 下标）。
 * 尺度由模型决定、**不保证 0-1**，调用方只可据其排序。
 */
export async function rerankDocuments(
  request: RerankRequest,
  options: EmbedCallOptions = {}
): Promise<RerankResponse> {
  const normalized = normalizeRerankRequest(request);
  const providers = options.providers ?? createEmbeddingProviders();
  const order = options.providerOrder ?? resolveEmbeddingProviderOrder();

  const startedAt = Date.now();
  const attempts: EmbeddingProviderId[] = [];
  let lastError: unknown;

  for (const id of order) {
    const provider = asRerankProvider(providers[id]);
    if (!provider) continue;
    if (!provider.isConfigured()) continue;

    attempts.push(id);
    try {
      const result = await provider.rerank(normalized, {
        signal: options.signal,
        timeoutMs: options.timeoutMs,
      });
      return {
        results: result.results,
        model: result.model,
        provider: id,
        attempts,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      lastError = error;
      logger.warn('[rerank] provider 调用失败，尝试降级', {
        provider: id,
        code: error instanceof EmbeddingError ? error.code : undefined,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (attempts.length === 0) {
    throw new EmbeddingError(
      'EMBEDDING_PROVIDER_NOT_CONFIGURED',
      '没有可用的重排 provider：请在 backend/.env 配置 RERANK_API_URL 与 EMBEDDING_API_KEY'
    );
  }
  if (lastError instanceof EmbeddingError) throw lastError;
  throw new EmbeddingError('EMBEDDING_ALL_PROVIDERS_FAILED', '所有重排 provider 均调用失败');
}

/**
 * 余弦相似度（**纯函数**，应用层算相似用）。两个向量长度不一致时抛错。
 * 供消费方在「SQLite 落 BLOB + 应用层算余弦」的轻量检索里直接复用，避免各写一份。
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new EmbeddingError('EMBEDDING_REQUEST_INVALID', `余弦相似度要求同维向量（${a.length} vs ${b.length}）`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export type { RerankProvider };
