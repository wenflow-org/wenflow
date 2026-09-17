/**
 * 网页搜索服务公开入口。
 *
 * 用法：
 *   import { searchWeb } from '../services/search';
 *   const res = await searchWeb({ query: '...', maxResults: 5 });
 */

export * from './types';
export { normalizeSearchQuery } from './validate';
export { searchWeb } from './web-search.service';
export type { SearchWebOptions } from './web-search.service';
export {
  createSearchProviders,
  resolveProviderOrder,
  KNOWN_PROVIDERS,
  IMPLEMENTED_PROVIDERS,
} from './providers';
