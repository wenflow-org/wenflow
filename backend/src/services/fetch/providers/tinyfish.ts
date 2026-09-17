/**
 * TinyFish Fetch adapter。
 *
 * 免费（$0，余额为 0 也可用），REST：POST https://api.fetch.tinyfish.ai
 * 认证：请求头 X-API-Key。
 * 文档：https://docs.tinyfish.ai/fetch-api
 *
 * 能力最全（格式 / 选择器 / 缓存 ttl / 条件请求 / 链接抽取 / 单URL超时 / 最多10URL），
 * 默认排在降级链首位。
 *
 * 实测注意（决定了 suspicious 标记的存在）：
 * - 老式 OLE2 的 .doc 直链会被当成成功返回：HTTP 200 + 二十余万字节控制字符，
 *   既非报错也非文本，故在归一化阶段用 isSuspiciousContent 标出，交由调用方判断。
 * - PDF 文本提取可用（表格单元格会串行，行内换行），比本机 pdftotext 完整。
 */

import { safeHttpRequest } from '../../../utils/safe-http';
import { FetchError } from '../types';
import type {
  FetchCallOptions,
  FetchContentItem,
  FetchItemError,
  FetchProvider,
  FetchProviderResult,
  FetchRequest,
} from '../types';
import { asNumber, asString, isSuspiciousContent, toUpstreamError, toStringArray } from './shared';

const DEFAULT_ENDPOINT = 'https://api.fetch.tinyfish.ai';
const DEFAULT_TIMEOUT_MS = 60_000;
/** 网页正文可能很大（实测某 PDF 抽取 27KB，页面可达数百 KB），放宽到 8MB */
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const PROVIDER_LABEL = 'TinyFish';

export interface TinyFishFetchConfig {
  endpoint: string;
  apiKey: string;
  timeoutMs: number;
}

/**
 * 从环境变量读取配置。
 * FETCH_API_KEY 未配置时回落到 SEARCH_API_KEY —— 同一把 TinyFish key 同时覆盖两个能力。
 */
export function readTinyFishFetchConfig(): TinyFishFetchConfig {
  const timeout = Number(process.env.FETCH_TIMEOUT_MS || process.env.SEARCH_TIMEOUT_MS);
  return {
    endpoint: (process.env.FETCH_API_URL || '').trim() || DEFAULT_ENDPOINT,
    apiKey: (process.env.FETCH_API_KEY || process.env.SEARCH_API_KEY || '').trim(),
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? Math.floor(timeout) : DEFAULT_TIMEOUT_MS,
  };
}

interface TinyFishRawResult {
  url?: unknown;
  final_url?: unknown;
  title?: unknown;
  description?: unknown;
  language?: unknown;
  author?: unknown;
  published_date?: unknown;
  text?: unknown;
  format?: unknown;
  links?: unknown;
  image_links?: unknown;
  latency_ms?: unknown;
}

interface TinyFishRawError {
  url?: unknown;
  error?: unknown;
  message?: unknown;
}

interface TinyFishRawResponse {
  results?: unknown;
  errors?: unknown;
}

/** 构造请求体；只映射调用方显式给出的参数 */
export function buildTinyFishFetchBody(request: FetchRequest): Record<string, unknown> {
  const body: Record<string, unknown> = { urls: request.urls };

  if (request.format) body.format = request.format;
  if (request.includeSelectors?.length) body.include_selectors = request.includeSelectors;
  if (request.excludeSelectors?.length) body.exclude_selectors = request.excludeSelectors;
  if (request.ttl !== undefined) body.ttl = request.ttl;
  if (request.perUrlTimeoutMs !== undefined) body.per_url_timeout_ms = request.perUrlTimeoutMs;
  if (request.purpose) body.purpose = request.purpose;
  if (request.links !== undefined) body.links = request.links;
  if (request.imageLinks !== undefined) body.image_links = request.imageLinks;
  if (request.ifNoneMatch) body.if_none_match = request.ifNoneMatch;
  if (request.ifModifiedSince) body.if_modified_since = request.ifModifiedSince;
  if (request.includeValidators !== undefined) body.include_etag_and_last_modified = request.includeValidators;

  return body;
}

/** 原始结果 → 统一模型 */
export function normalizeTinyFishFetchResults(raw: TinyFishRawResponse): FetchProviderResult {
  const list = Array.isArray(raw?.results) ? (raw.results as TinyFishRawResult[]) : [];
  const results: FetchContentItem[] = [];

  for (const item of list) {
    const url = asString(item?.url);
    if (!url) continue;

    // format=json 时上游返回结构化文档树（对象），原样透传
    const text = typeof item?.text === 'string' || (item?.text && typeof item.text === 'object')
      ? (item.text as string | Record<string, unknown>)
      : undefined;

    results.push({
      url,
      finalUrl: asString(item?.final_url),
      title: asString(item?.title),
      description: asString(item?.description),
      language: asString(item?.language),
      author: asString(item?.author),
      publishedAt: asString(item?.published_date),
      text,
      format: asString(item?.format),
      suspicious: isSuspiciousContent(text) || undefined,
      links: toStringArray(item?.links),
      imageLinks: toStringArray(item?.image_links),
      provider: 'tinyfish',
      latencyMs: asNumber(item?.latency_ms),
    });
  }

  const rawErrors = Array.isArray(raw?.errors) ? (raw.errors as TinyFishRawError[]) : [];
  const errors: FetchItemError[] = [];
  for (const item of rawErrors) {
    const url = asString(item?.url) || '';
    const code = asString(item?.error) || 'unknown_error';
    errors.push({
      url,
      code,
      message: asString(item?.message) || code,
    });
  }

  return { results, errors };
}

export class TinyFishFetchProvider implements FetchProvider {
  readonly id = 'tinyfish' as const;
  private readonly config: TinyFishFetchConfig;

  constructor(config: TinyFishFetchConfig = readTinyFishFetchConfig()) {
    this.config = config;
  }

  isConfigured(): boolean {
    return Boolean(this.config.apiKey);
  }

  async fetch(request: FetchRequest, options: FetchCallOptions = {}): Promise<FetchProviderResult> {
    if (!this.isConfigured()) {
      throw new FetchError('FETCH_PROVIDER_NOT_CONFIGURED', 'TinyFish 抓取未配置 FETCH_API_KEY / SEARCH_API_KEY');
    }

    const body = buildTinyFishFetchBody(request);

    let response;
    try {
      response = await safeHttpRequest<TinyFishRawResponse>(this.config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.config.apiKey,
        },
        body,
        timeoutMs: options.timeoutMs ?? this.config.timeoutMs,
        maxResponseBytes: MAX_RESPONSE_BYTES,
        privateNetworkPolicy: 'public-only',
        signal: options.signal,
      });
    } catch (error) {
      throw toUpstreamError(error, PROVIDER_LABEL);
    }

    if (response.status < 200 || response.status >= 300) {
      throw new FetchError(
        'FETCH_UPSTREAM_HTTP_ERROR',
        `TinyFish 抓取返回 HTTP ${response.status}`,
        response.status
      );
    }

    return normalizeTinyFishFetchResults(response.data);
  }
}
