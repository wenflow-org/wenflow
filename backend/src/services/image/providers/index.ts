/**
 * 文生图 provider 注册表。
 *
 * - KNOWN_PROVIDERS：协议已定义的全部 provider（IMAGE_PROVIDER 取值白名单）
 * - IMPLEMENTED_PROVIDERS：当前代码里真正可用的 provider（默认降级链）
 * 与 services/search / services/fetch 的 providers/index.ts 同构。
 */

import { ImageError } from '../types';
import type { ImageProvider, ImageProviderId } from '../types';
import { readPluginChannelOrder } from '../../plugin-providers.service';
import { AgnesImageProvider } from './agnes';

export const KNOWN_PROVIDERS: readonly ImageProviderId[] = ['agnes'];

export const IMPLEMENTED_PROVIDERS: readonly ImageProviderId[] = ['agnes'];

/** 实例化已实现的 provider；未配置 endpoint/key 的 provider 由 service 依据 isConfigured() 跳过 */
export function createImageProviders(): Partial<Record<ImageProviderId, ImageProvider>> {
  return {
    agnes: new AgnesImageProvider(),
  };
}

/**
 * 解析 provider 顺序（逗号分隔 = 降级链）。
 * 无显式入参走「平台配置 → 环境变量 → 默认」，显式入参保持原语义（未知 id 报错）。
 */
export function resolveImageProviderOrder(serialized?: string): ImageProviderId[] {
  if (serialized === undefined) {
    const configured = readPluginChannelOrder('image', 'image').filter(
      (id): id is ImageProviderId => KNOWN_PROVIDERS.includes(id as ImageProviderId)
    );
    return configured.length ? configured : [...IMPLEMENTED_PROVIDERS];
  }
  const raw = serialized.trim();
  if (!raw) return [...IMPLEMENTED_PROVIDERS];

  const known = new Set<string>(KNOWN_PROVIDERS);
  const order: ImageProviderId[] = [];
  for (const part of raw.split(',')) {
    const id = part.trim().toLowerCase();
    if (!id) continue;
    if (!known.has(id)) {
      throw new ImageError('IMAGE_PROVIDER_UNKNOWN', `未知的文生图 provider: ${id}`);
    }
    const typed = id as ImageProviderId;
    if (!order.includes(typed)) order.push(typed);
  }

  return order.length > 0 ? order : [...IMPLEMENTED_PROVIDERS];
}
