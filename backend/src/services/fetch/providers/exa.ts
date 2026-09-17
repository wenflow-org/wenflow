/**
 * Exa Contents adapter。
 *
 * POST https://api.exa.ai/contents，认证请求头 x-api-key。
 * 也可指向 Exa 兼容代理（EXA_API_URL 换成 .../contents 即可）。
 * 文档：https://docs.exa.ai/reference/get-contents
 *
 * 能力差异（相对统一 FetchRequest）：
 * - 无 markdown 输出：markdown 映射到 Exa 的 text（纯文本，非真正 markdown，已在 format 字段如实回报），
 *   html 映射到 Exa 的 html；json 无对应能力 → 抛 FETCH_PROVIDER_UNSUPPORTED。
 * - 无 CSS 选择器、无缓存 ttl、无条件请求、无单URL超时预算、无图片抽取 → 抛 FETCH_PROVIDER_UNSUPPORTED。
 * - links（页面外链抽取）无对应能力，属附加信息，静默忽略。
 * - 结果中 status 非 success 的条目归入 errors[]。
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

const DEFAULT_ENDPOINT = 'https://api.exa.ai/contents';
const DEFAULT_TIMEOUT_MS = 60_000;
/** 网页正文可能很大，放宽到 8MB */
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const PROVIDER_LABEL = 'Exa';

export interface ExaFetchConfig {
  endpoint: string;
  apiKey: string;
  timeoutMs: number;
}

export function readExaFetchConfig(): ExaFetchConfig {
  const timeout = Number(process.env.FETCH_TIMEOUT_MS || process.env.SEARCH_TIMEOUT_MS);
  return {
    endpoint: (process.env.EXA_CONTENTS_URL || '').trim() || DEFAULT_ENDPOINT,
    apiKey: (process.env.EXA_API_KEY || '').trim(),
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? Math.floor(timeout) : DEFAULT_TIMEOUT_MS,
  };
}

export function assertExaFetchSupported(request: FetchRequest): void {
  if (request.format === 'json') {
    throw unsupported(PROVIDER_LABEL, 'format=json');
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
  if (request.imageLinks) {
    throw unsupported(PROVIDER_LABEL, 'imageLinks');
  }
}

export function buildExaFetchBody(request: FetchRequest): Record<string, unknown> {
  assertExaFetchSupported(request);

  // markdown 走 text（Exa 无 markdown 概念，text 为纯文本）；html 走 html
  const body: Record<string, unknown> = { urls: request.urls };
  if (request.format === 'html') {
    body.html = true;
  } else {
    body.text = true;
  }

  return body;
}

interface ExaRawResult {
  url?: unknown;
  title?: unknown;
  text?: unknown;
  html?: unknown;
  author?: unknown;
  publishedDate?: unknown;
  status?: unknown;
  error?: unknown;
}

interface ExaRawResponse {
  results?: unknown;
}

export function normalizeExaFetchResults(raw: ExaRawResponse, requestedFormat?: string): FetchProviderResult {
  const list = Array.isArray(raw?.results) ? (raw.results as ExaRawResult[]) : [];
  const results: FetchContentItem[] = [];
  const errors: FetchItemError[] = [];

  for (const item of list) {
    const url = asString(item?.url);
    if (!url) continue;

    const status = asString(item?.status);
    if (status && status !== 'success') {
      const code = asString(item?.error) || status;
      errors.push({ url, code, message: code });
      continue;
    }

    const useHtml = requestedFormat === 'html';
    const text = asString(useHtml ? item?.html : item?.text) ?? asString(item?.text);

    results.push({
      url,
      title: asString(item?.title),
      author: asString(item?.author),
      publishedAt: asString(item?.publishedDate),
      text,
      // 如实回报：markdown 请求实际拿到的是 Exa 的纯文本
      format: useHtml ? 'html' : 'text',
      suspicious: isSuspiciousContent(text) || undefined,
      provider: 'exa',
    });
  }

  return { results, errors };
}

export class ExaFetchProvider implements FetchProvider {
  readonly id = 'exa' as const;
  private readonly config: ExaFetchConfig;

  constructor(config: ExaFetchConfig = readExaFetchConfig()) {
    this.config = config;
  }

  isConfigured(): boolean {
    return Boolean(this.config.apiKey);
  }

  async fetch(request: FetchRequest, options: FetchCallOptions = {}): Promise<FetchProviderResult> {
    if (!this.isConfigured()) {
      throw new FetchError('FETCH_PROVIDER_NOT_CONFIGURED', 'Exa 抓取未配置 EXA_API_KEY');
    }

    const body = buildExaFetchBody(request);

    let response;
    try {
      response = await safeHttpRequest<ExaRawResponse>(this.config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
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
        `Exa 抓取返回 HTTP ${response.status}`,
        response.status
      );
    }

    return normalizeExaFetchResults(response.data, request.format);
  }
}
