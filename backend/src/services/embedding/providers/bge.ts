/**
 * BGE（new-api 兼容网关）向量化 + 重排 adapter。
 *
 * 同一网关（backend/.env 的 EMBEDDING_API_URL / RERANK_API_URL）提供两类能力：
 *   POST <EMBEDDING_API_URL>  OpenAI 兼容 /v1/embeddings —— body { model, input }
 *   POST <RERANK_API_URL>     常见 rerank 契约 /v1/rerank     —— body { model, query, documents, top_n }
 * 认证统一 Authorization: Bearer <EMBEDDING_API_KEY>（两接口共用一把 key）。
 *
 * 注意（实测 2026-10-16）：rerank **必须带 /v1 前缀**，裸 /rerank 会命中网关前端页面（返回 HTML）。
 *
 * 能力差异（相对统一请求类型）：
 * - embedding.input 单条与批量都支持（string / string[]）。批量返回须逐条对齐，条数不符判上游异常。
 * - rerank 返回 relevance_score 尺度**不保证 0-1**（bge-reranker 实测约 0.03~0.05 量级），
 *   调用方只可据其**排序**，不可当概率用。
 * - 两接口均不支持「维度裁剪 / 归一化」等参数，静默忽略。
 */

import { safeHttpRequest } from '../../../utils/safe-http';
import { EmbeddingError } from '../types';
import type {
  EmbeddedVector,
  EmbeddingCallOptions,
  EmbeddingProvider,
  EmbeddingProviderResult,
  EmbeddingRequest,
  RerankProvider,
  RerankProviderResult,
  RerankRequest,
  RerankedDocument,
} from '../types';
import { asNumber, asString, normalizeVectors, toUpstreamError } from './shared';

const DEFAULT_MODEL = 'BAAI/bge-m3';
const DEFAULT_RERANK_MODEL = 'BAAI/bge-reranker-v2-m3';
/** 向量化是「一次一批」的短请求，超时预算与 search 同档 */
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const PROVIDER_LABEL = 'BGE';

export interface BgeEmbeddingConfig {
  embeddingEndpoint: string;
  rerankEndpoint: string;
  apiKey: string;
  model: string;
  rerankModel: string;
  timeoutMs: number;
}

export function readBgeConfig(): BgeEmbeddingConfig {
  const timeout = Number(process.env.EMBEDDING_TIMEOUT_MS);
  return {
    embeddingEndpoint: (process.env.EMBEDDING_API_URL || '').trim(),
    rerankEndpoint: (process.env.RERANK_API_URL || '').trim(),
    apiKey: (process.env.EMBEDDING_API_KEY || '').trim(),
    model: (process.env.EMBEDDING_MODEL || '').trim() || DEFAULT_MODEL,
    rerankModel: (process.env.RERANK_MODEL || '').trim() || DEFAULT_RERANK_MODEL,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? Math.floor(timeout) : DEFAULT_TIMEOUT_MS,
  };
}

export function buildEmbeddingBody(request: EmbeddingRequest, model: string): Record<string, unknown> {
  return { model: request.model || model, input: request.input };
}

export function buildRerankBody(request: RerankRequest, model: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model || model,
    query: request.query,
    documents: request.documents,
  };
  if (request.topN !== undefined) body.top_n = request.topN;
  return body;
}

interface RawEmbeddingResponse {
  data?: Array<{ index?: unknown; embedding?: unknown }>;
  model?: unknown;
}

interface RawRerankResponse {
  results?: Array<{ index?: unknown; relevance_score?: unknown; score?: unknown }>;
  model?: unknown;
}

export function normalizeRerankResults(raw: RawRerankResponse): RerankedDocument[] {
  const list = Array.isArray(raw?.results) ? raw.results : [];
  const out: RerankedDocument[] = [];
  list.forEach((item, fallbackIndex) => {
    const score = asNumber(item?.relevance_score) ?? asNumber(item?.score);
    if (score === undefined) return;
    const idx = typeof item?.index === 'number' && Number.isFinite(item.index) ? Math.trunc(item.index) : fallbackIndex;
    out.push({ index: idx, relevanceScore: score });
  });
  // 上游多数已降序；此处显式再排一次，保证调用方拿到的顺序确定
  return out.sort((a, b) => b.relevanceScore - a.relevanceScore);
}

export class BgeProvider implements EmbeddingProvider, RerankProvider {
  readonly id = 'bge' as const;
  private readonly config: BgeEmbeddingConfig;

  constructor(config: BgeEmbeddingConfig = readBgeConfig()) {
    this.config = config;
  }

  isConfigured(): boolean {
    return Boolean(this.config.apiKey) && Boolean(this.config.embeddingEndpoint || this.config.rerankEndpoint);
  }

  private assertEndpoint(endpoint: string, kind: string): void {
    if (!endpoint) {
      throw new EmbeddingError(
        'EMBEDDING_PROVIDER_NOT_CONFIGURED',
        `BGE ${kind}未配置地址（请在 backend/.env 配置 ${kind === '向量化' ? 'EMBEDDING_API_URL' : 'RERANK_API_URL'}）`
      );
    }
  }

  async embed(request: EmbeddingRequest, options: EmbeddingCallOptions = {}): Promise<EmbeddingProviderResult> {
    this.assertEndpoint(this.config.embeddingEndpoint, '向量化');
    const expected = Array.isArray(request.input) ? request.input.length : 1;
    const model = request.model || this.config.model;

    let response;
    try {
      response = await safeHttpRequest<RawEmbeddingResponse>(this.config.embeddingEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: buildEmbeddingBody(request, model),
        timeoutMs: options.timeoutMs ?? this.config.timeoutMs,
        maxResponseBytes: MAX_RESPONSE_BYTES,
        privateNetworkPolicy: 'public-only',
        signal: options.signal,
      });
    } catch (error) {
      throw toUpstreamError(error, PROVIDER_LABEL);
    }

    if (response.status < 200 || response.status >= 300) {
      throw new EmbeddingError('EMBEDDING_UPSTREAM_HTTP_ERROR', `BGE 向量化返回 HTTP ${response.status}`, response.status);
    }

    const rawList = Array.isArray(response.data?.data) ? response.data.data : [];
    const vectors: EmbeddedVector[] = normalizeVectors(rawList, expected, PROVIDER_LABEL).map((v) => ({
      index: v.index,
      embedding: v.embedding,
    }));

    return {
      vectors,
      model: asString(response.data?.model) || model,
      dimensions: vectors[0]?.embedding.length ?? 0,
    };
  }

  async rerank(request: RerankRequest, options: EmbeddingCallOptions = {}): Promise<RerankProviderResult> {
    this.assertEndpoint(this.config.rerankEndpoint, '重排');
    const model = request.model || this.config.rerankModel;

    let response;
    try {
      response = await safeHttpRequest<RawRerankResponse>(this.config.rerankEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: buildRerankBody(request, model),
        timeoutMs: options.timeoutMs ?? this.config.timeoutMs,
        maxResponseBytes: MAX_RESPONSE_BYTES,
        privateNetworkPolicy: 'public-only',
        signal: options.signal,
      });
    } catch (error) {
      throw toUpstreamError(error, PROVIDER_LABEL);
    }

    if (response.status < 200 || response.status >= 300) {
      throw new EmbeddingError('RERANK_UPSTREAM_HTTP_ERROR', `BGE 重排返回 HTTP ${response.status}`, response.status);
    }

    const results = normalizeRerankResults(response.data ?? {});
    if (results.length === 0) {
      throw new EmbeddingError('RERANK_UPSTREAM_MALFORMED', 'BGE 重排未返回任何有效结果');
    }
    return { results, model: asString(response.data?.model) || model };
  }
}
