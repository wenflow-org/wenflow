/**
 * 网页搜索 Skill（外挂能力，handler-only / 无 LLM prompt）。
 *
 * 定位：把 backend/src/services/search 的 provider 抽象（TinyFish / Tavily / Exa + 降级链）
 * 暴露为统一的 Skill 入口，供 Capability Runtime / 平台工具调用。
 *
 * 配置：backend/.env 的 SEARCH_PROVIDER / SEARCH_API_KEY（TinyFish Search 免费）。
 */

import { searchWeb } from '../../services/search';
import { SearchError } from '../../services/search/types';
import type { SearchDomainType, SearchResultItem } from '../../services/search/types';
import { SkillDefinition, SkillExecutionResult } from '../protocol';

export interface WebSearchInput {
  query: string;
  maxResults?: number;
  location?: string;
  language?: string;
  recencyMinutes?: number;
  afterDate?: string;
  beforeDate?: string;
  domainType?: SearchDomainType;
  includeDomains?: string[];
  excludeDomains?: string[];
  page?: number;
  purpose?: string;
  pubYearMin?: number;
  pubYearMax?: number;
  signal?: AbortSignal;
}

export interface WebSearchOutput {
  query: string;
  provider: string;
  attempts: string[];
  latencyMs: number;
  page: number;
  totalResults?: number;
  results: SearchResultItem[];
}

export const webSearchDefinition: SkillDefinition = {
  name: 'web-search',
  displayName: '网页搜索 Skill',
  version: '1.0.0',
  category: 'retrieval',
  description: '调用外部搜索 provider（TinyFish / Tavily / Exa）检索网页并返回结构化结果',
  status: 'working',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索查询词', required: true },
      maxResults: { type: 'number', description: '返回条数（默认 10，上限 50）' },
      location: { type: 'string', description: '地域（ISO 国家码，如 US / CN）' },
      language: { type: 'string', description: '语言（ISO 语言码，如 en / zh）' },
      recencyMinutes: { type: 'number', description: '时效窗口（分钟，与 afterDate/beforeDate 互斥）' },
      afterDate: { type: 'string', description: '起始日期 YYYY-MM-DD' },
      beforeDate: { type: 'string', description: '结束日期 YYYY-MM-DD' },
      domainType: { type: 'string', description: 'web | news | research_paper' },
      includeDomains: { type: 'array', description: '仅包含的域名' },
      excludeDomains: { type: 'array', description: '排除的域名' },
      page: { type: 'number', description: '分页（0 起，仅部分 provider 支持）' },
      purpose: { type: 'string', description: '搜索意图说明，用于提升结果质量' },
      pubYearMin: { type: 'number', description: '论文年份下界（domainType=research_paper）' },
      pubYearMax: { type: 'number', description: '论文年份上界（domainType=research_paper）' },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      provider: { type: 'string' },
      attempts: { type: 'array' },
      latencyMs: { type: 'number' },
      page: { type: 'number' },
      totalResults: { type: 'number' },
      results: { type: 'array' },
    },
  },
  capabilities: ['web-search', 'external-retrieval', 'provider-fallback'],
  stats: { callCount: 0, successRate: 1, avgLatency: 0 },
};

const WEB_SEARCH_ERROR_MESSAGES: Record<string, string> = {
  WEB_SEARCH_QUERY_REQUIRED: 'web-search query 不能为空',
  WEB_SEARCH_EXECUTION_FAILED: '网页搜索执行失败',
  SEARCH_QUERY_INVALID: '搜索参数无效',
  SEARCH_PROVIDER_NOT_CONFIGURED: '搜索 provider 未配置（请在 backend/.env 配置 SEARCH_API_KEY）',
  SEARCH_PROVIDER_UNKNOWN: '搜索 provider 配置无效',
  SEARCH_PROVIDER_UNSUPPORTED: '当前 provider 不支持该查询参数',
  SEARCH_UPSTREAM_HTTP_ERROR: '搜索上游返回错误',
  SEARCH_UPSTREAM_UNAVAILABLE: '搜索上游暂时不可用',
  SEARCH_UPSTREAM_TIMEOUT: '搜索上游响应超时',
  SEARCH_ALL_PROVIDERS_FAILED: '所有搜索 provider 均调用失败',
};

export async function executeWebSearch(
  input: WebSearchInput
): Promise<SkillExecutionResult<WebSearchOutput>> {
  const startedAt = Date.now();
  const query = typeof input?.query === 'string' ? input.query.trim() : '';

  if (!query) {
    return {
      success: false,
      error: {
        code: 'WEB_SEARCH_QUERY_REQUIRED',
        message: WEB_SEARCH_ERROR_MESSAGES.WEB_SEARCH_QUERY_REQUIRED,
      },
      duration: Date.now() - startedAt,
    };
  }

  try {
    const response = await searchWeb(
      {
        query,
        maxResults: input.maxResults,
        location: input.location,
        language: input.language,
        recencyMinutes: input.recencyMinutes,
        afterDate: input.afterDate,
        beforeDate: input.beforeDate,
        domainType: input.domainType,
        includeDomains: input.includeDomains,
        excludeDomains: input.excludeDomains,
        page: input.page,
        purpose: input.purpose,
        pubYearMin: input.pubYearMin,
        pubYearMax: input.pubYearMax,
      },
      { signal: input.signal }
    );

    return {
      success: true,
      output: {
        query: response.query,
        provider: response.provider,
        attempts: response.attempts,
        latencyMs: response.latencyMs,
        page: response.page,
        totalResults: response.totalResults,
        results: response.results,
      },
      duration: Date.now() - startedAt,
    };
  } catch (error) {
    const isKnown = error instanceof SearchError && Boolean(WEB_SEARCH_ERROR_MESSAGES[error.code]);
    const code = isKnown ? (error as SearchError).code : 'WEB_SEARCH_EXECUTION_FAILED';
    return {
      success: false,
      error: {
        code,
        message: WEB_SEARCH_ERROR_MESSAGES[code]
          || (error instanceof Error ? error.message : WEB_SEARCH_ERROR_MESSAGES.WEB_SEARCH_EXECUTION_FAILED),
      },
      duration: Date.now() - startedAt,
    };
  }
}
