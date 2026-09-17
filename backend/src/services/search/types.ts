/**
 * 网页搜索统一类型（外挂能力 web-search）。
 *
 * 设计目标：调用方只依赖本文件，provider（TinyFish / Tavily / Exa）可替换、可降级。
 * 新增 provider 只需实现 SearchProvider 并在 providers/index.ts 注册，调用方零改动。
 */

export type SearchProviderId = 'tinyfish' | 'tavily' | 'exa';

export type SearchDomainType = 'web' | 'news' | 'research_paper';

export interface SearchQuery {
  /** 查询词（必填） */
  query: string;
  /** 期望返回条数；provider 各自的硬上限由 adapter 负责钳制 */
  maxResults?: number;
  /** 地域（ISO 国家码，如 US / CN） */
  location?: string;
  /** 语言（ISO 语言码，如 en / zh） */
  language?: string;
  /** 时效窗口（分钟，1 ~ 5256000）；与 afterDate / beforeDate 互斥 */
  recencyMinutes?: number;
  /** 起始日期 YYYY-MM-DD；与 recencyMinutes 互斥 */
  afterDate?: string;
  /** 结束日期 YYYY-MM-DD；与 recencyMinutes 互斥 */
  beforeDate?: string;
  /** 内容类型；research_paper 不支持日期过滤，改用 pubYearMin / pubYearMax */
  domainType?: SearchDomainType;
  /** 仅包含的域名（白名单） */
  includeDomains?: string[];
  /** 排除的域名（黑名单） */
  excludeDomains?: string[];
  /** 分页（0 起） */
  page?: number;
  /** 搜索意图说明（为什么搜），用于提升结果质量 */
  purpose?: string;
  /** 论文发表年份下界（domainType=research_paper 时使用） */
  pubYearMin?: number;
  /** 论文发表年份上界（domainType=research_paper 时使用） */
  pubYearMax?: number;
}

export interface SearchResultItem {
  position: number;
  title: string;
  url: string;
  snippet: string;
  siteName?: string;
  publishedAt?: string;
  score?: number;
  provider: SearchProviderId;
}

/** adapter 归一化后的结果（provider / attempts / latency 由 service 补齐） */
export interface SearchProviderResult {
  results: SearchResultItem[];
  totalResults?: number;
  page: number;
}

export interface SearchResponse extends SearchProviderResult {
  query: string;
  /** 实际返回结果的 provider */
  provider: SearchProviderId;
  /** 本次尝试过的 provider 顺序（含失败降级过程），用于排障 */
  attempts: SearchProviderId[];
  latencyMs: number;
}

export interface SearchCallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface SearchProvider {
  readonly id: SearchProviderId;
  /** 是否具备调用条件（key / endpoint 已配置）；未配置的 provider 会被 service 跳过 */
  isConfigured(): boolean;
  search(query: SearchQuery, options?: SearchCallOptions): Promise<SearchProviderResult>;
}

export type SearchErrorCode =
  | 'SEARCH_QUERY_INVALID'
  | 'SEARCH_PROVIDER_NOT_CONFIGURED'
  | 'SEARCH_PROVIDER_UNKNOWN'
  | 'SEARCH_UPSTREAM_HTTP_ERROR'
  | 'SEARCH_UPSTREAM_UNAVAILABLE'
  | 'SEARCH_UPSTREAM_TIMEOUT'
  | 'SEARCH_PROVIDER_UNSUPPORTED'
  | 'SEARCH_ALL_PROVIDERS_FAILED';

export class SearchError extends Error {
  readonly code: SearchErrorCode;
  readonly status?: number;

  constructor(code: SearchErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'SearchError';
    this.code = code;
    this.status = status;
  }
}
