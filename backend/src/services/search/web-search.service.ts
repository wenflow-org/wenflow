/**
 * 网页搜索编排服务（外挂能力 web-search 的运行时入口）。
 *
 * 职责：校验入参 → 按 SEARCH_PROVIDER 顺序逐个 provider 尝试 → 失败自动降级 →
 * 返回统一结构（含实际命中的 provider 与尝试链）。
 *
 * 阶段 1 只绑定 TinyFish；Tavily / Exa 通过 providers/index.ts 注册即可接入，本文件无需改动。
 */

import { logger } from '../../utils/logger';
import { createSearchProviders, resolveProviderOrder } from './providers';
import { SearchError } from './types';
import type {
  SearchProvider,
  SearchProviderId,
  SearchQuery,
  SearchResponse,
  SearchResultItem,
} from './types';
import { normalizeSearchQuery } from './validate';

/** 未显式指定 maxResults 时的默认返回条数（provider 之间保持一致的对外行为） */
const DEFAULT_MAX_RESULTS = 10;

export interface SearchWebOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** 覆盖 SEARCH_PROVIDER 的 provider 顺序（测试 / 内部编排用） */
  providerOrder?: SearchProviderId[];
  /** 覆盖 provider 实例（测试注入用） */
  providers?: Partial<Record<SearchProviderId, SearchProvider>>;
}

function applyMaxResults(results: SearchResultItem[], maxResults?: number): SearchResultItem[] {
  return results.slice(0, maxResults ?? DEFAULT_MAX_RESULTS);
}

export async function searchWeb(input: SearchQuery, options: SearchWebOptions = {}): Promise<SearchResponse> {
  const query = normalizeSearchQuery(input);
  const providers = options.providers ?? createSearchProviders();
  const order = options.providerOrder ?? resolveProviderOrder();

  const startedAt = Date.now();
  const attempts: SearchProviderId[] = [];
  let lastError: unknown;

  for (const id of order) {
    const provider = providers[id];
    // 未在当前构建中实现的 provider（如阶段 3 之前的 tavily）直接跳过，不产生噪声
    if (!provider) continue;
    if (!provider.isConfigured()) continue;

    attempts.push(id);
    try {
      const result = await provider.search(query, {
        signal: options.signal,
        timeoutMs: options.timeoutMs,
      });
      return {
        query: query.query,
        results: applyMaxResults(result.results, query.maxResults),
        totalResults: result.totalResults,
        page: result.page,
        provider: id,
        attempts,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      lastError = error;
      logger.warn('[web-search] provider 调用失败，尝试降级', {
        provider: id,
        code: error instanceof SearchError ? error.code : undefined,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (attempts.length === 0) {
    throw new SearchError(
      'SEARCH_PROVIDER_NOT_CONFIGURED',
      '没有可用的搜索 provider：请在 backend/.env 配置 SEARCH_API_KEY（TinyFish Search 免费）'
    );
  }
  if (lastError instanceof SearchError) throw lastError;
  throw new SearchError('SEARCH_ALL_PROVIDERS_FAILED', '所有搜索 provider 均调用失败');
}
