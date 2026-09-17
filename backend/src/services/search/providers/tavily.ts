/**
 * Tavily Search adapter。
 *
 * POST https://api.tavily.com/search，认证 Authorization: Bearer <TAVILY_API_KEY>。
 * 文档：https://docs.tavily.com/documentation/api-reference/endpoint/search
 *
 * 能力差异（相对统一 SearchQuery）：
 * - 不支持 domainType=research_paper（无学术论文类别）、page 分页 → 抛 SEARCH_PROVIDER_UNSUPPORTED，
 *   service 会据此降级到下一个 provider。
 * - location / purpose 无对应参数，作为"尽力而为的提示"忽略（不阻断请求）。
 * - recencyMinutes 映射为粗粒度 time_range（day/week/month/year）。
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
import { asNumber, asString, hostnameOf, toUpstreamError, unsupported } from './shared';

const DEFAULT_ENDPOINT = 'https://api.tavily.com/search';
const DEFAULT_TIMEOUT_MS = 20_000;
/** Tavily max_results 上限 20 */
const MAX_RESULTS = 20;
const DEFAULT_LIMIT = 10;
/** 未显式指定 depth 时的检索深度（advanced = 2 credits，basic = 1） */
const DEFAULT_SEARCH_DEPTH = 'advanced';
const PROVIDER_LABEL = 'Tavily';

export interface TavilyProviderConfig {
  endpoint: string;
  apiKey: string;
  timeoutMs: number;
}

export function readTavilyConfig(): TavilyProviderConfig {
  const timeout = Number(process.env.SEARCH_TIMEOUT_MS);
  return {
    endpoint: (process.env.TAVILY_API_URL || '').trim() || DEFAULT_ENDPOINT,
    apiKey: (process.env.TAVILY_API_KEY || '').trim(),
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? Math.floor(timeout) : DEFAULT_TIMEOUT_MS,
  };
}

/** recencyMinutes → Tavily time_range（该 API 仅提供 day/week/month/year 四档） */
export function toTavilyTimeRange(recencyMinutes: number): string {
  if (recencyMinutes <= 1440) return 'day';
  if (recencyMinutes <= 10_080) return 'week';
  if (recencyMinutes <= 43_200) return 'month';
  return 'year';
}

interface TavilyRawResult {
  title?: unknown;
  url?: unknown;
  content?: unknown;
  score?: unknown;
  published_date?: unknown;
}

interface TavilyRawResponse {
  results?: unknown;
}

export function buildTavilyRequestBody(query: SearchQuery): Record<string, unknown> {
  if (query.domainType === 'research_paper') {
    throw unsupported(PROVIDER_LABEL, 'domainType=research_paper（请用 TinyFish Search 或 Exa）');
  }
  if (query.page !== undefined && query.page > 0) {
    throw unsupported(PROVIDER_LABEL, 'page 分页');
  }

  const body: Record<string, unknown> = {
    query: query.query,
    // 默认 advanced：basic 对实体型查询相关性显著劣化（实测 "Tavily search API" 会返回 api.org 等无关结果）
    search_depth: query.depth || DEFAULT_SEARCH_DEPTH,
    max_results: Math.min(query.maxResults ?? DEFAULT_LIMIT, MAX_RESULTS),
  };
  if (query.domainType === 'news') body.topic = 'news';
  if (query.recencyMinutes !== undefined) body.time_range = toTavilyTimeRange(query.recencyMinutes);
  if (query.afterDate) body.start_date = query.afterDate;
  if (query.beforeDate) body.end_date = query.beforeDate;
  if (query.afterDate || query.beforeDate) body.include_published_date = true;
  if (query.includeDomains?.length) body.include_domains = query.includeDomains;
  if (query.excludeDomains?.length) body.exclude_domains = query.excludeDomains;
  // language 统一用 ISO 639-1，Tavily 可直接接收
  if (query.language) body.language = query.language;

  return body;
}

export function normalizeTavilyResults(raw: TavilyRawResponse, limit?: number): SearchResultItem[] {
  const list = Array.isArray(raw?.results) ? (raw.results as TavilyRawResult[]) : [];
  const items: SearchResultItem[] = [];

  list.forEach((item, index) => {
    const url = asString(item?.url);
    if (!url) return;
    items.push({
      position: index + 1,
      title: asString(item?.title) || url,
      url,
      snippet: asString(item?.content) || '',
      siteName: hostnameOf(url),
      publishedAt: asString(item?.published_date),
      score: asNumber(item?.score),
      provider: 'tavily',
    });
  });

  const capped = limit !== undefined ? Math.min(limit, MAX_RESULTS) : MAX_RESULTS;
  return items.slice(0, capped);
}

export class TavilySearchProvider implements SearchProvider {
  readonly id = 'tavily' as const;
  private readonly config: TavilyProviderConfig;

  constructor(config: TavilyProviderConfig = readTavilyConfig()) {
    this.config = config;
  }

  isConfigured(): boolean {
    return Boolean(this.config.apiKey);
  }

  async search(query: SearchQuery, options: SearchCallOptions = {}): Promise<SearchProviderResult> {
    if (!this.isConfigured()) {
      throw new SearchError('SEARCH_PROVIDER_NOT_CONFIGURED', 'Tavily 搜索未配置 TAVILY_API_KEY');
    }

    // 能力不匹配在发请求前就失败，避免无谓的上游调用
    const body = buildTavilyRequestBody(query);

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
        privateNetworkPolicy: 'public-only',
        signal: options.signal,
      });
    } catch (error) {
      throw toUpstreamError(error, PROVIDER_LABEL);
    }

    if (response.status < 200 || response.status >= 300) {
      throw new SearchError(
        'SEARCH_UPSTREAM_HTTP_ERROR',
        `Tavily 搜索返回 HTTP ${response.status}`,
        response.status
      );
    }

    return {
      results: normalizeTavilyResults(response.data, query.maxResults),
      page: 0,
    };
  }
}
