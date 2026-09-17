/**
 * Tavily Extract adapter。
 *
 * POST https://api.tavily.com/extract，认证 Authorization: Bearer <TAVILY_API_KEY>。
 * 也可指向 Tavily 兼容代理（TAVILY_API_URL 换成 .../extract 即可，与 search 同源）。
 * 文档：https://docs.tavily.com/documentation/api-reference/endpoint/extract
 *
 * 能力差异（相对统一 FetchRequest）：
 * - 仅支持 markdown 输出（无 html / json）→ format 为 html/json 时抛 FETCH_PROVIDER_UNSUPPORTED，service 降级。
 * - 无 CSS 选择器、无缓存 ttl、无条件请求、无单URL超时预算 → 对应参数一律抛 FETCH_PROVIDER_UNSUPPORTED，
 *   避免"传了但没生效"的静默偏差。
 * - links（页面外链抽取）无对应能力，且属附加信息不影响正文，静默忽略。
 * - imageLinks 映射为 include_images。
 * - 按 URL 失败出现在 failed_results[]，与成功项同批返回（与统一模型的部分成功语义一致）。
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
import { asString, isSuspiciousContent, toUpstreamError, unsupported } from './shared';

const DEFAULT_ENDPOINT = 'https://api.tavily.com/extract';
const DEFAULT_TIMEOUT_MS = 60_000;
/** 网页正文可能很大，放宽到 8MB */
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const PROVIDER_LABEL = 'Tavily';

export interface TavilyFetchConfig {
  endpoint: string;
  apiKey: string;
  timeoutMs: number;
}

export function readTavilyFetchConfig(): TavilyFetchConfig {
  const timeout = Number(process.env.FETCH_TIMEOUT_MS || process.env.SEARCH_TIMEOUT_MS);
  return {
    endpoint: (process.env.TAVILY_EXTRACT_URL || '').trim() || DEFAULT_ENDPOINT,
    apiKey: (process.env.TAVILY_API_KEY || '').trim(),
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? Math.floor(timeout) : DEFAULT_TIMEOUT_MS,
  };
}

/** 该 adapter 无法表达的能力，在发请求前就失败（service 会降级到下一个 provider） */
export function assertTavilyFetchSupported(request: FetchRequest): void {
  if (request.format && request.format !== 'markdown') {
    throw unsupported(PROVIDER_LABEL, `format=${request.format}（仅支持 markdown）`);
  }
  if (request.includeSelectors?.length || request.excludeSelectors?.length) {
    throw unsupported(PROVIDER_LABEL, 'CSS 选择器（includeSelectors / excludeSelectors）');
  }
  if (request.ttl !== undefined) {
    throw unsupported(PROVIDER_LABEL, '缓存 ttl');
  }
  if (request.perUrlTimeoutMs !== undefined) {
    throw unsupported(PROVIDER_LABEL, 'perUrlTimeoutMs');
  }
  if (request.ifNoneMatch || request.ifModifiedSince || request.includeValidators) {
    throw unsupported(PROVIDER_LABEL, '条件请求（ifNoneMatch / ifModifiedSince / includeValidators）');
  }
}

export function buildTavilyFetchBody(request: FetchRequest): Record<string, unknown> {
  assertTavilyFetchSupported(request);

  const body: Record<string, unknown> = {
    urls: request.urls,
    extract_depth: 'basic',
  };
  if (request.imageLinks) body.include_images = true;

  return body;
}

interface TavilyRawResult {
  url?: unknown;
  title?: unknown;
  raw_content?: unknown;
  images?: unknown;
}

interface TavilyRawFailed {
  url?: unknown;
  error?: unknown;
}

interface TavilyRawResponse {
  results?: unknown;
  failed_results?: unknown;
}

export function normalizeTavilyFetchResults(raw: TavilyRawResponse): FetchProviderResult {
  const list = Array.isArray(raw?.results) ? (raw.results as TavilyRawResult[]) : [];
  const results: FetchContentItem[] = [];

  for (const item of list) {
    const url = asString(item?.url);
    if (!url) continue;
    const text = asString(item?.raw_content);
    const images = Array.isArray(item?.images)
      ? item.images.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      : [];

    results.push({
      url,
      title: asString(item?.title),
      text,
      format: 'markdown',
      suspicious: isSuspiciousContent(text) || undefined,
      imageLinks: images.length > 0 ? images : undefined,
      provider: 'tavily',
    });
  }

  const failed = Array.isArray(raw?.failed_results) ? (raw.failed_results as TavilyRawFailed[]) : [];
  const errors: FetchItemError[] = [];
  for (const item of failed) {
    const url = asString(item?.url) || '';
    const code = asString(item?.error) || 'failed';
    errors.push({ url, code, message: code });
  }

  return { results, errors };
}

export class TavilyFetchProvider implements FetchProvider {
  readonly id = 'tavily' as const;
  private readonly config: TavilyFetchConfig;

  constructor(config: TavilyFetchConfig = readTavilyFetchConfig()) {
    this.config = config;
  }

  isConfigured(): boolean {
    return Boolean(this.config.apiKey);
  }

  async fetch(request: FetchRequest, options: FetchCallOptions = {}): Promise<FetchProviderResult> {
    if (!this.isConfigured()) {
      throw new FetchError('FETCH_PROVIDER_NOT_CONFIGURED', 'Tavily 抓取未配置 TAVILY_API_KEY');
    }

    const body = buildTavilyFetchBody(request);

    let response;
    try {
      response = await safeHttpRequest<TavilyRawResponse>(this.config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
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
        `Tavily 抓取返回 HTTP ${response.status}`,
        response.status
      );
    }

    return normalizeTavilyFetchResults(response.data);
  }
}
