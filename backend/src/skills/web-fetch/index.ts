/**
 * 网页抓取 Skill（外挂能力，handler-only / 无 LLM prompt）。
 *
 * 定位：把 backend/src/services/fetch 的 provider 抽象（TinyFish / Tavily / Exa + 降级链）
 * 暴露为统一的 Skill 入口，供 Capability Runtime / 平台工具调用。
 *
 * 与 web-search 的分工：search 负责"找到"（返回 URL 列表与摘要），
 * fetch 负责"读到"（给定 URL 返回正文）。二者并列，不合并——
 * 入参契约不同（query vs urls），且搜索与抓取的降级链是两套。
 *
 * 配置：backend/.env 的 FETCH_PROVIDER / FETCH_API_KEY（TinyFish Fetch 免费，缺省复用 SEARCH_API_KEY）。
 */

import { fetchWeb } from '../../services/fetch';
import { FetchError } from '../../services/fetch/types';
import type { FetchFormat, FetchContentItem, FetchItemError } from '../../services/fetch/types';
import { SkillDefinition, SkillExecutionResult } from '../protocol';

export interface WebFetchInput {
  urls: string[];
  format?: FetchFormat;
  includeSelectors?: string[];
  excludeSelectors?: string[];
  ttl?: number;
  perUrlTimeoutMs?: number;
  purpose?: string;
  links?: boolean;
  imageLinks?: boolean;
  ifNoneMatch?: string;
  ifModifiedSince?: string;
  includeValidators?: boolean;
  signal?: AbortSignal;
}

export interface WebFetchOutput {
  provider: string;
  attempts: string[];
  latencyMs: number;
  results: FetchContentItem[];
  /** 部分失败明细（单条 URL 失败不影响其余），需与 results 一并判读 */
  errors: FetchItemError[];
}

export const webFetchDefinition: SkillDefinition = {
  name: 'web-fetch',
  displayName: '网页抓取 Skill',
  version: '1.0.0',
  category: 'retrieval',
  description: '调用外部抓取 provider（TinyFish / Tavily / Exa）取回指定 URL 的正文内容',
  status: 'working',
  inputSchema: {
    type: 'object',
    properties: {
      urls: { type: 'array', description: '待抓取 URL（1~10 条，http/https）', required: true },
      format: { type: 'string', description: 'markdown | html | json（默认 markdown，部分 provider 仅支持 markdown）' },
      includeSelectors: { type: 'array', description: '只抽取匹配这些 CSS 选择器的区域（最多 20 个）' },
      excludeSelectors: { type: 'array', description: '抽取前剔除匹配这些 CSS 选择器的区域（最多 20 个）' },
      ttl: { type: 'number', description: '缓存新鲜度容忍（秒）；0 = 强制实时抓取' },
      perUrlTimeoutMs: { type: 'number', description: '单 URL 墙钟预算（毫秒，上限 120000）' },
      purpose: { type: 'string', description: '抓取意图说明，用于提升抽取质量' },
      links: { type: 'boolean', description: '是否额外抽取页面内链接' },
      imageLinks: { type: 'boolean', description: '是否额外抽取图片链接' },
      ifNoneMatch: { type: 'string', description: '条件请求 ETag（仅单 URL）' },
      ifModifiedSince: { type: 'string', description: '条件请求 Last-Modified（仅单 URL）' },
      includeValidators: { type: 'boolean', description: '是否返回 etag / lastModified 供下次条件请求复用（仅单 URL）' },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      provider: { type: 'string' },
      attempts: { type: 'array' },
      latencyMs: { type: 'number' },
      results: { type: 'array', description: '抓取成功的条目（含正文与 suspicious 标记）' },
      errors: { type: 'array', description: '单条 URL 的失败明细' },
    },
  },
  capabilities: ['web-fetch', 'external-retrieval', 'content-extraction', 'provider-fallback'],
  stats: { callCount: 0, successRate: 1, avgLatency: 0 },
};

const WEB_FETCH_ERROR_MESSAGES: Record<string, string> = {
  WEB_FETCH_URLS_REQUIRED: 'web-fetch urls 不能为空',
  WEB_FETCH_EXECUTION_FAILED: '网页抓取执行失败',
  FETCH_REQUEST_INVALID: '抓取参数无效',
  FETCH_PROVIDER_NOT_CONFIGURED: '抓取 provider 未配置（请在 backend/.env 配置 FETCH_API_KEY 或 SEARCH_API_KEY）',
  FETCH_PROVIDER_UNKNOWN: '抓取 provider 配置无效',
  FETCH_PROVIDER_UNSUPPORTED: '当前 provider 不支持该抓取参数',
  FETCH_UPSTREAM_HTTP_ERROR: '抓取上游返回错误',
  FETCH_UPSTREAM_UNAVAILABLE: '抓取上游暂时不可用',
  FETCH_UPSTREAM_TIMEOUT: '抓取上游响应超时',
  FETCH_ALL_PROVIDERS_FAILED: '所有抓取 provider 均调用失败',
  FETCH_ALL_URLS_FAILED: '所有 URL 均抓取失败',
};

export async function executeWebFetch(
  input: WebFetchInput
): Promise<SkillExecutionResult<WebFetchOutput>> {
  const startedAt = Date.now();
  const urls = Array.isArray(input?.urls)
    ? input.urls.filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
    : [];

  if (urls.length === 0) {
    return {
      success: false,
      error: {
        code: 'WEB_FETCH_URLS_REQUIRED',
        message: WEB_FETCH_ERROR_MESSAGES.WEB_FETCH_URLS_REQUIRED,
      },
      duration: Date.now() - startedAt,
    };
  }

  try {
    const response = await fetchWeb(
      {
        urls,
        format: input.format,
        includeSelectors: input.includeSelectors,
        excludeSelectors: input.excludeSelectors,
        ttl: input.ttl,
        perUrlTimeoutMs: input.perUrlTimeoutMs,
        purpose: input.purpose,
        links: input.links,
        imageLinks: input.imageLinks,
        ifNoneMatch: input.ifNoneMatch,
        ifModifiedSince: input.ifModifiedSince,
        includeValidators: input.includeValidators,
      },
      { signal: input.signal }
    );

    return {
      success: true,
      output: {
        provider: response.provider,
        attempts: response.attempts,
        latencyMs: response.latencyMs,
        results: response.results,
        errors: response.errors,
      },
      duration: Date.now() - startedAt,
    };
  } catch (error) {
    const isKnown = error instanceof FetchError && Boolean(WEB_FETCH_ERROR_MESSAGES[error.code]);
    const code = isKnown ? (error as FetchError).code : 'WEB_FETCH_EXECUTION_FAILED';
    return {
      success: false,
      error: {
        code,
        message: WEB_FETCH_ERROR_MESSAGES[code]
          || (error instanceof Error ? error.message : WEB_FETCH_ERROR_MESSAGES.WEB_FETCH_EXECUTION_FAILED),
      },
      duration: Date.now() - startedAt,
    };
  }
}
