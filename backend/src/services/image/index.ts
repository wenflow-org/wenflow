/**
 * 文生图服务公开入口。
 *
 * 用法：
 *   import { generateImages } from '../services/image';
 *   const res = await generateImages({ prompt: '一只红苹果，白底棚拍' });
 */

export * from './types';
export { normalizeImageRequest } from './validate';
export { generateImages } from './image.service';
export type { GenerateImageOptions } from './image.service';
export {
  createImageProviders,
  resolveImageProviderOrder,
  KNOWN_PROVIDERS,
  IMPLEMENTED_PROVIDERS,
} from './providers';
