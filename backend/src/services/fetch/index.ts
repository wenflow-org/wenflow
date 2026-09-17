/**
 * 网页抓取服务公开入口。
 *
 * 用法：
 *   import { fetchWeb } from '../services/fetch';
 *   const res = await fetchWeb({ urls: ['https://example.com'] });
 */

export * from './types';
export { normalizeFetchRequest } from './validate';
export { fetchWeb } from './web-fetch.service';
export type { FetchWebOptions } from './web-fetch.service';
export {
  createFetchProviders,
  resolveFetchProviderOrder,
  KNOWN_PROVIDERS,
  IMPLEMENTED_PROVIDERS,
} from './providers';
