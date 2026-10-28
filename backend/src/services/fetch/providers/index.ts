/**
 * 抓取 provider 注册表。
 *
 * - KNOWN_PROVIDERS：协议已定义的全部 provider（FETCH_PROVIDER 取值白名单）
 * - IMPLEMENTED_PROVIDERS：当前代码里真正可用的 provider（默认降级链）
 * 与 services/search/providers/index.ts 同构。
 */

import { FetchError } from '../types';
import type { FetchProvider, FetchProviderId } from '../types';
import { readPluginChannelOrder } from '../../plugin-providers.service';
import { TinyFishFetchProvider } from './tinyfish';
import { TavilyFetchProvider } from './tavily';
import { ExaFetchProvider } from './exa';

export const KNOWN_PROVIDERS: readonly FetchProviderId[] = ['tinyfish', 'tavily', 'exa'];

export const IMPLEMENTED_PROVIDERS: readonly FetchProviderId[] = ['tinyfish', 'tavily', 'exa'];

/** 实例化已实现的 provider；未配置 key 的 provider 由 service 依据 isConfigured() 跳过 */
export function createFetchProviders(): Partial<Record<FetchProviderId, FetchProvider>> {
  return {
    tinyfish: new TinyFishFetchProvider(),
    tavily: new TavilyFetchProvider(),
    exa: new ExaFetchProvider(),
  };
}

/**
 * 解析 provider 顺序（逗号分隔 = 降级链）。
 * 与 search 同判例：无显式入参走「平台配置 → 环境变量 → 默认」，显式入参保持原语义。
 */
export function resolveFetchProviderOrder(serialized?: string): FetchProviderId[] {
  if (serialized === undefined) {
    const configured = readPluginChannelOrder('web', 'fetch').filter(
      (id): id is FetchProviderId => KNOWN_PROVIDERS.includes(id as FetchProviderId)
    );
    return configured.length ? configured : [...IMPLEMENTED_PROVIDERS];
  }
  const raw = serialized.trim();
  if (!raw) return [...IMPLEMENTED_PROVIDERS];

  const known = new Set<string>(KNOWN_PROVIDERS);
  const order: FetchProviderId[] = [];
  for (const part of raw.split(',')) {
    const id = part.trim().toLowerCase();
    if (!id) continue;
    if (!known.has(id)) {
      throw new FetchError('FETCH_PROVIDER_UNKNOWN', `未知的抓取 provider: ${id}`);
    }
    const typed = id as FetchProviderId;
    if (!order.includes(typed)) order.push(typed);
  }

  return order.length > 0 ? order : [...IMPLEMENTED_PROVIDERS];
}
