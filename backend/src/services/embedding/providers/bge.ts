/**
 * BGE（new-api 兼容网关）向量化 + 重排 adapter。
 *
 * 同一网关（平台配置 infraModels 优先，backend/.env 回落）提供两类能力：
 *   POST <EMBEDDING_API_URL>  OpenAI 兼容 /v1/embeddings —— body { model, input }
 *   POST <RERANK_API_URL>     常见 rerank 契约 /v1/rerank     —— body { model, query, documents, top_n }
 * 认证 Authorization: Bearer <key>：优先 provider_secrets 密文，缺省回落环境变量。
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
import { getInfraModelConfigSync } from '../infra-config.service';

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
  /** rerank 独立密钥；未配置时沿用 embedding key（当前 BGE 网关两接口共用一把） */
  rerankApiKey: string;
  model: string;
  rerankModel: string;
  timeoutMs: number;
  rerankTimeoutMs: number;
}

/**
 * 运行时读取顺序：平台配置（platform_settings.infraModels）→ 环境变量。
 * 同步契约不变：平台配置在启动/管理端保存时水合进进程内快照。
 */
export function readBgeConfig(): BgeEmbeddingConfig {
  const runtime = getInfraModelConfigSync();
  return {
    embeddingEndpoint: runtime.embedding.endpoint,
    rerankEndpoint: runtime.rerank.endpoint,
    apiKey: runtime.embedding.apiKey,
    rerankApiKey: runtime.rerank.apiKey || runtime.embedding.apiKey,
    model: runtime.embedding.model || DEFAULT_MODEL,
    rerankModel: runtime.rerank.model || DEFAULT_RERANK_MODEL,
    timeoutMs: runtime.embedding.timeoutMs || DEFAULT_TIMEOUT_MS,
    rerankTimeoutMs: runtime.rerank.timeoutMs || DEFAULT_TIMEOUT_MS,
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
    return Boolean(this.config.apiKey || this.config.rerankApiKey)
      && Boolean(this.config.embeddingEndpoint || this.config.rerankEndpoint);
  }

  private assertEndpoint(endpoint: string, kind: string): void {
    if (!endpoint) {
      throw new EmbeddingError(
        'EMBEDDING_PROVIDER_NOT_CONFIGURED',
        `BGE ${kind}未配置地址（请在「模型与接入 → 接入与模型 → 基础设施模型」或 backend/.env 配置 ${kind === '向量化' ? 'EMBEDDING_API_URL' : 'RERANK_API_URL'}）`
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
          Authorization: `Bearer ${this.config.rerankApiKey || this.config.apiKey}`,
        },
        body: buildRerankBody(request, model),
        timeoutMs: options.timeoutMs ?? this.config.rerankTimeoutMs,
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
