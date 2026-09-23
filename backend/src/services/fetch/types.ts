/**
 * 网页抓取统一类型（外挂能力 web-fetch）。
 *
 * 与 services/search 同构：调用方只依赖本文件，provider（TinyFish / Tavily / Exa）
 * 可替换、可降级。新增 provider 只需实现 FetchProvider 并在 providers/index.ts 注册。
 *
 * 与 search 的关键差异（决定了接口形态）：
 * 1. 入参是 urls（不是 query），最多 10 条并发抓取；
 * 2. 单个 provider 内部是「部分成功」语义——某条 URL 失败不影响其余，
 *    因此结果里同时带 results 与 errors，而不是整体失败；
 * 3. 抽取结果不可盲信——上游可能把二进制文件当成功返回（HTTP 200 + 乱码），
 *    故引入 suspicious 启发式标记，避免把垃圾静默传进教学内容。
 */

export type FetchProviderId = 'tinyfish' | 'tavily' | 'exa';

export type FetchFormat = 'markdown' | 'html' | 'json';

export interface FetchRequest {
  /** 待抓取 URL（1~10 条，http/https 绝对地址） */
  urls: string[];
  /** 输出格式；默认 markdown。部分 provider 仅支持 markdown（会抛 FETCH_PROVIDER_UNSUPPORTED） */
  format?: FetchFormat;
  /** 只抽取匹配这些 CSS 选择器的区域（最多 20 个） */
  includeSelectors?: string[];
  /** 抽取前先剔除匹配这些 CSS 选择器的区域（最多 20 个） */
  excludeSelectors?: string[];
  /** 缓存新鲜度容忍（秒）；0 = 强制实时抓取 */
  ttl?: number;
  /** 单 URL 墙钟预算（毫秒） */
  perUrlTimeoutMs?: number;
  /** 抓取意图说明（为什么抓），用于提升抽取质量 */
  purpose?: string;
  /**
   * 查询定向抽取（2026-09-22 起支持）：传入目标查询后，provider 只返回**与该查询相关的片段**
   * 而不是整页——这是业界共识（Perplexity 专门建 span-labeling 流水线；Tavily /extract 的
   * query + chunks_per_source）。用于"我要的是某份资料的正文"这类场景，避免整页导航噪声。
   */
  query?: string;
  /** 每源最多返回几个相关片段（1~5；providers 仅在同时给了 query 时才生效） */
  chunksPerSource?: number;
  /**
   * 抽取深度：basic（默认，1 credit）| advanced（更高成功率、更多内容，含表格/嵌入内容，2 credits）
   * provider 不支持时静默忽略。
   */
  extractDepth?: 'basic' | 'advanced';
  /** 是否额外抽取页面内链接（provider 不支持则静默省略该字段） */
  links?: boolean;
  /** 是否额外抽取图片链接（provider 不支持则静默省略该字段） */
  imageLinks?: boolean;
  /** 条件请求：仅单 URL 可用；配合 includeValidators 复用上次拿到的校验器 */
  ifNoneMatch?: string;
  /** 条件请求：仅单 URL 可用 */
  ifModifiedSince?: string;
  /** 是否返回 etag / lastModified 校验器，供下次条件请求使用 */
  includeValidators?: boolean;
}

export interface FetchContentItem {
  url: string;
  finalUrl?: string;
  title?: string;
  description?: string;
  language?: string;
  author?: string;
  publishedAt?: string;
  /** 抽取到的正文；format=json 时为结构化文档树（对象而非字符串） */
  text?: string | Record<string, unknown>;
  /** 实际返回的格式（Tavily 仅 markdown，可能与请求的 format 不同） */
  format?: string;
  /**
   * 内容可疑（过短或含大量控制字符）——通常意味着抓到了二进制文件、
   * 反爬拦截页或空壳页。调用方应先看该标记再决定是否使用 text。
   */
  suspicious?: boolean;
  /** 抽取到的页面内链接（仅当请求 links 且 provider 支持） */
  links?: string[];
  /** 抽取到的图片链接（仅当请求 imageLinks 且 provider 支持） */
  imageLinks?: string[];
  /** 条件请求命中「内容未变」 */
  notModified?: boolean;
  etag?: string;
  lastModified?: string;
  provider: FetchProviderId;
  /** provider 自报的耗时（毫秒） */
  latencyMs?: number;
}

/** 单条 URL 的抓取失败（provider 级部分失败，不影响同批其它 URL） */
export interface FetchItemError {
  url: string;
  /** 上游原始错误码（如 target_http_error / selector_not_matched） */
  code: string;
  message: string;
}

/** adapter 归一化后的结果 */
export interface FetchProviderResult {
  results: FetchContentItem[];
  errors: FetchItemError[];
}

export interface FetchResponse extends FetchProviderResult {
  /** 实际返回结果的 provider */
  provider: FetchProviderId;
  /** 本次尝试过的 provider 顺序（含失败降级过程），用于排障 */
  attempts: FetchProviderId[];
  latencyMs: number;
}

export interface FetchCallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface FetchProvider {
  readonly id: FetchProviderId;
  /** 是否具备调用条件（key / endpoint 已配置）；未配置的 provider 会被 service 跳过 */
  isConfigured(): boolean;
  fetch(request: FetchRequest, options?: FetchCallOptions): Promise<FetchProviderResult>;
}

export type FetchErrorCode =
  | 'FETCH_REQUEST_INVALID'
  | 'FETCH_PROVIDER_NOT_CONFIGURED'
  | 'FETCH_PROVIDER_UNKNOWN'
  | 'FETCH_UPSTREAM_HTTP_ERROR'
  | 'FETCH_UPSTREAM_UNAVAILABLE'
  | 'FETCH_UPSTREAM_TIMEOUT'
  | 'FETCH_PROVIDER_UNSUPPORTED'
  | 'FETCH_ALL_PROVIDERS_FAILED'
  | 'FETCH_ALL_URLS_FAILED';

export class FetchError extends Error {
  readonly code: FetchErrorCode;
  readonly status?: number;

  constructor(code: FetchErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'FetchError';
    this.code = code;
    this.status = status;
  }
}
