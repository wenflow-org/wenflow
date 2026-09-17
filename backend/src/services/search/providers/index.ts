/**
 * 搜索 provider 注册表。
 *
 * - KNOWN_PROVIDERS：协议已定义的全部 provider（SEARCH_PROVIDER 取值白名单）
 * - IMPLEMENTED_PROVIDERS：当前代码里真正可用的 provider（默认降级链）
 * 阶段 3 接入 Tavily / Exa 时，只需新增 adapter 并加入 IMPLEMENTED_PROVIDERS。
 */

import { SearchError } from '../types';
import type { SearchProvider, SearchProviderId } from '../types';
import { TinyFishSearchProvider } from './tinyfish';
import { TavilySearchProvider } from './tavily';
import { ExaSearchProvider } from './exa';

export const KNOWN_PROVIDERS: readonly SearchProviderId[] = ['tinyfish', 'tavily', 'exa'];

export const IMPLEMENTED_PROVIDERS: readonly SearchProviderId[] = ['tinyfish', 'tavily', 'exa'];

/** 实例化已实现的 provider；未配置 key 的 provider 由 service 依据 isConfigured() 跳过 */
export function createSearchProviders(): Partial<Record<SearchProviderId, SearchProvider>> {
  return {
    tinyfish: new TinyFishSearchProvider(),
    tavily: new TavilySearchProvider(),
    exa: new ExaSearchProvider(),
  };
}

/**
 * 解析 provider 顺序（SEARCH_PROVIDER，逗号分隔 = 降级链）。
 * 未配置时退回已实现 provider 的默认顺序；配置了未知 id 直接报错，避免静默走错 provider。
 */
export function resolveProviderOrder(serialized: string = process.env.SEARCH_PROVIDER || ''): SearchProviderId[] {
  const raw = serialized.trim();
  if (!raw) return [...IMPLEMENTED_PROVIDERS];

  const known = new Set<string>(KNOWN_PROVIDERS);
  const order: SearchProviderId[] = [];
  for (const part of raw.split(',')) {
    const id = part.trim().toLowerCase();
    if (!id) continue;
    if (!known.has(id)) {
      throw new SearchError('SEARCH_PROVIDER_UNKNOWN', `未知的搜索 provider: ${id}`);
    }
    const typed = id as SearchProviderId;
    if (!order.includes(typed)) order.push(typed);
  }

  return order.length > 0 ? order : [...IMPLEMENTED_PROVIDERS];
}
