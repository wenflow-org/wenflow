/**
 * TinyFish Search adapter。
 *
 * 免费（$0，余额为 0 也可用），REST：GET https://api.search.tinyfish.ai?query=...
 * 认证：请求头 X-API-Key。
 * 文档：https://docs.tinyfish.ai/search-api
 *
 * 该 provider 能力最全（日期/时效/分页/论文年份/地域/语言全覆盖），默认排在降级链首位。
 */

import { safeHttpRequest } from '../../../utils/safe-http';
import { SearchError } from '../types';
import type {
  SearchCallOptions,
  SearchProvider,
  SearchProviderResult,
  SearchQuery,
  SearchResultItem,
} from '../types';
import { asNumber, asString, hostnameOf, toUpstreamError } from './shared';

const DEFAULT_ENDPOINT = 'https://api.search.tinyfish.ai';
const DEFAULT_TIMEOUT_MS = 20_000;
/** TinyFish 未公开 max_results 参数，统一在客户端截断，避免超量返回 */
const MAX_RESULTS = 50;
const PROVIDER_LABEL = 'TinyFish';

export interface TinyFishProviderConfig {
  endpoint: string;
  apiKey: string;
  timeoutMs: number;
}

/** 从环境变量读取配置；缺 SEARCH_API_KEY 时 isConfigured() 为 false（service 会跳过） */
export function readTinyFishConfig(): TinyFishProviderConfig {
  const timeout = Number(process.env.SEARCH_TIMEOUT_MS);
  return {
    endpoint: (process.env.SEARCH_API_URL || '').trim() || DEFAULT_ENDPOINT,
    apiKey: (process.env.SEARCH_API_KEY || '').trim(),
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? Math.floor(timeout) : DEFAULT_TIMEOUT_MS,
  };
}

interface TinyFishRawResult {
  position?: unknown;
  site_name?: unknown;
  title?: unknown;
  snippet?: unknown;
  url?: unknown;
}

interface TinyFishRawResponse {
  results?: unknown;
  total_results?: unknown;
  page?: unknown;
}

/** 构造 GET 请求 URL；只映射 TinyFish 支持且调用方显式给出的参数 */
export function buildTinyFishRequestUrl(config: TinyFishProviderConfig, query: SearchQuery): string {
  const url = new URL(config.endpoint);
  const params = url.searchParams;

  params.set('query', query.query);
  if (query.location) params.set('location', query.location);
  if (query.language) params.set('language', query.language);
  if (query.recencyMinutes !== undefined) params.set('recency_minutes', String(query.recencyMinutes));
  if (query.afterDate) params.set('after_date', query.afterDate);
  if (query.beforeDate) params.set('before_date', query.beforeDate);
  if (query.domainType) params.set('domain_type', query.domainType);
  if (query.includeDomains?.length) params.set('include_domains', query.includeDomains.join(','));
  if (query.excludeDomains?.length) params.set('exclude_domains', query.excludeDomains.join(','));
  if (query.page !== undefined) params.set('page', String(query.page));
  if (query.purpose) params.set('purpose', query.purpose);
  if (query.pubYearMin !== undefined) params.set('pub_year_min', String(query.pubYearMin));
  if (query.pubYearMax !== undefined) params.set('pub_year_max', String(query.pubYearMax));

  return url.toString();
}

/** 原始结果 → 统一模型；丢弃无 URL 的噪声项 */
export function normalizeTinyFishResults(raw: TinyFishRawResponse, limit?: number): SearchResultItem[] {
  const list = Array.isArray(raw?.results) ? (raw.results as TinyFishRawResult[]) : [];
  const items: SearchResultItem[] = [];

  list.forEach((item, index) => {
    const url = asString(item?.url);
    if (!url) return;
    const position = asNumber(item?.position);
    items.push({
      position: position && position > 0 ? position : index + 1,
      title: asString(item?.title) || url,
      url,
      snippet: asString(item?.snippet) || '',
      siteName: asString(item?.site_name) || hostnameOf(url),
      provider: 'tinyfish',
    });
  });

  const capped = limit !== undefined ? Math.min(limit, MAX_RESULTS) : MAX_RESULTS;
  return items.slice(0, capped);
}

export class TinyFishSearchProvider implements SearchProvider {
  readonly id = 'tinyfish' as const;
  private readonly config: TinyFishProviderConfig;

  constructor(config: TinyFishProviderConfig = readTinyFishConfig()) {
    this.config = config;
  }

  isConfigured(): boolean {
    return Boolean(this.config.apiKey);
  }

  async search(query: SearchQuery, options: SearchCallOptions = {}): Promise<SearchProviderResult> {
    if (!this.isConfigured()) {
      throw new SearchError('SEARCH_PROVIDER_NOT_CONFIGURED', 'TinyFish 搜索未配置 SEARCH_API_KEY');
    }

    const requestUrl = buildTinyFishRequestUrl(this.config, query);

    let response;
    try {
      response = await safeHttpRequest<TinyFishRawResponse>(requestUrl, {
        method: 'GET',
        headers: { 'X-API-Key': this.config.apiKey },
        timeoutMs: options.timeoutMs ?? this.config.timeoutMs,
        privateNetworkPolicy: 'public-only',
        signal: options.signal,
      });
    } catch (error) {
      throw toUpstreamError(error, PROVIDER_LABEL);
    }

    if (response.status < 200 || response.status >= 300) {
      throw new SearchError(
        'SEARCH_UPSTREAM_HTTP_ERROR',
        `TinyFish 搜索返回 HTTP ${response.status}`,
        response.status
      );
    }

    const results = normalizeTinyFishResults(response.data, query.maxResults);
    const page = asNumber(response.data?.page);
    return {
      results,
      totalResults: asNumber(response.data?.total_results),
      page: page !== undefined ? page : query.page ?? 0,
    };
  }
}
