/**
 * Exa Search adapter。
 *
 * POST https://api.exa.ai/search，认证请求头 x-api-key。
 * 文档：https://docs.exa.ai/reference/search
 *
 * 能力差异（相对统一 SearchQuery）：
 * - 不支持 page 分页 → 抛 SEARCH_PROVIDER_UNSUPPORTED，service 会降级到下一个 provider。
 * - language / purpose 无对应参数（Exa 无语言过滤），作为提示忽略。
 * - domainType=research_paper 映射为 category=publication（Exa 的学术论文类别）。
 * - 日期统一转 ISO 8601；recencyMinutes 换算为 startPublishedDate。
 * - 会请求 contents.text（取正文片段作为 snippet），有额外计费，仅作降级 provider 使用。
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

const DEFAULT_ENDPOINT = 'https://api.exa.ai/search';
const DEFAULT_TIMEOUT_MS = 20_000;
/** Exa numResults 上限 100 */
const MAX_RESULTS = 100;
const DEFAULT_LIMIT = 10;
/** snippet 截断长度（Exa 返回正文，需收敛以免污染 LLM payload） */
const SNIPPET_MAX_CHARS = 600;
/** 请求正文片段的字符预算，控制生成成本 */
const CONTENT_MAX_CHARS = 1200;
const PROVIDER_LABEL = 'Exa';

export interface ExaProviderConfig {
  endpoint: string;
  apiKey: string;
  timeoutMs: number;
}

export function readExaConfig(): ExaProviderConfig {
  const timeout = Number(process.env.SEARCH_TIMEOUT_MS);
  return {
    endpoint: (process.env.EXA_API_URL || '').trim() || DEFAULT_ENDPOINT,
    apiKey: (process.env.EXA_API_KEY || '').trim(),
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? Math.floor(timeout) : DEFAULT_TIMEOUT_MS,
  };
}

function toIsoStart(date: string): string {
  return `${date}T00:00:00.000Z`;
}

function toIsoEnd(date: string): string {
  return `${date}T23:59:59.999Z`;
}

export function buildExaRequestBody(query: SearchQuery, now: Date = new Date()): Record<string, unknown> {
  if (query.page !== undefined && query.page > 0) {
    throw unsupported(PROVIDER_LABEL, 'page 分页');
  }

  const body: Record<string, unknown> = {
    query: query.query,
    type: 'auto',
    numResults: Math.min(query.maxResults ?? DEFAULT_LIMIT, MAX_RESULTS),
    contents: { text: { maxCharacters: CONTENT_MAX_CHARS } },
  };

  if (query.domainType === 'news') body.category = 'news';
  if (query.domainType === 'research_paper') body.category = 'publication';
  if (query.includeDomains?.length) body.includeDomains = query.includeDomains;
  if (query.excludeDomains?.length) body.excludeDomains = query.excludeDomains;
  // location 统一为 ISO 国家码，Exa 的 userLocation 正好是两位国家码
  if (query.location) body.userLocation = query.location.toUpperCase();

  if (query.afterDate) body.startPublishedDate = toIsoStart(query.afterDate);
  if (query.beforeDate) body.endPublishedDate = toIsoEnd(query.beforeDate);
  if (query.recencyMinutes !== undefined) {
    body.startPublishedDate = new Date(now.getTime() - query.recencyMinutes * 60_000).toISOString();
  }
  if (query.pubYearMin !== undefined) body.startPublishedDate = toIsoStart(`${query.pubYearMin}-01-01`);
  if (query.pubYearMax !== undefined) body.endPublishedDate = toIsoEnd(`${query.pubYearMax}-12-31`);

  return body;
}

interface ExaRawResult {
  title?: unknown;
  url?: unknown;
  text?: unknown;
  publishedDate?: unknown;
  score?: unknown;
}

interface ExaRawResponse {
  results?: unknown;
}

export function normalizeExaResults(raw: ExaRawResponse, limit?: number): SearchResultItem[] {
  const list = Array.isArray(raw?.results) ? (raw.results as ExaRawResult[]) : [];
  const items: SearchResultItem[] = [];

  list.forEach((item, index) => {
    const url = asString(item?.url);
    if (!url) return;
    const text = asString(item?.text) || '';
    items.push({
      position: index + 1,
      title: asString(item?.title) || url,
      url,
      snippet: text.length > SNIPPET_MAX_CHARS ? `${text.slice(0, SNIPPET_MAX_CHARS)}...` : text,
      siteName: hostnameOf(url),
      publishedAt: asString(item?.publishedDate),
      score: asNumber(item?.score),
      provider: 'exa',
    });
  });

  const capped = limit !== undefined ? Math.min(limit, MAX_RESULTS) : MAX_RESULTS;
  return items.slice(0, capped);
}

export class ExaSearchProvider implements SearchProvider {
  readonly id = 'exa' as const;
  private readonly config: ExaProviderConfig;

  constructor(config: ExaProviderConfig = readExaConfig()) {
    this.config = config;
  }

  isConfigured(): boolean {
    return Boolean(this.config.apiKey);
  }

  async search(query: SearchQuery, options: SearchCallOptions = {}): Promise<SearchProviderResult> {
    if (!this.isConfigured()) {
      throw new SearchError('SEARCH_PROVIDER_NOT_CONFIGURED', 'Exa 搜索未配置 EXA_API_KEY');
    }

    const body = buildExaRequestBody(query);

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
        privateNetworkPolicy: 'public-only',
        signal: options.signal,
      });
    } catch (error) {
      throw toUpstreamError(error, PROVIDER_LABEL);
    }

    if (response.status < 200 || response.status >= 300) {
      throw new SearchError(
        'SEARCH_UPSTREAM_HTTP_ERROR',
        `Exa 搜索返回 HTTP ${response.status}`,
        response.status
      );
    }

    return {
      results: normalizeExaResults(response.data, query.maxResults),
      page: 0,
    };
  }
}
