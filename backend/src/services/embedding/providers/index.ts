/**
 * 向量化 / 重排 provider 注册表。
 *
 * - KNOWN_PROVIDERS：协议已定义的全部 provider（EMBEDDING_PROVIDER 取值白名单）
 * - IMPLEMENTED_PROVIDERS：当前代码里真正可用的 provider（默认降级链）
 * 与 services/search / services/fetch / services/image 的 providers/index.ts 同构。
 *
 * 注：本能力只有「一个网关」的形态（bge 系模型都挂在同一 new-api 网关上），
 * 增加第二个 provider（如 qwen embedding）时在此登记即可——service 会按
 * EMBEDDING_PROVIDER 逗号分隔顺序逐级降级。
 */

import { EmbeddingError } from '../types';
import type { EmbeddingProvider, EmbeddingProviderId, RerankProvider, RerankProviderId } from '../types';
import { BgeProvider, readBgeConfig } from './bge';

export const KNOWN_PROVIDERS: readonly EmbeddingProviderId[] = ['bge'];

export const IMPLEMENTED_PROVIDERS: readonly EmbeddingProviderId[] = ['bge'];

/**
 * 主 provider 的向量模型 id（EMBEDDING_MODEL，缺省=BGE 默认）。
 * 供消费方在建索引时做**模型失效判定**——换模型即索引作废，避免跨模型向量混算。
 * 与 provider 实际使用的模型**同源**（都走 readBgeConfig），不会两处漂移。
 */
export function resolveEmbeddingModelId(): string {
  return readBgeConfig().model;
}

/** 实例化已实现的 provider；未配置 endpoint/key 的 provider 由 service 依据 isConfigured() 跳过 */
export function createEmbeddingProviders(): Partial<Record<EmbeddingProviderId, EmbeddingProvider & Partial<RerankProvider>>> {
  return {
    bge: new BgeProvider(),
  };
}

/** rerank 与 embedding 共用 provider 集合（同网关两类能力），单独导出便于类型收窄 */
export function asRerankProvider(provider: Partial<RerankProvider> | undefined): RerankProvider | undefined {
  return provider && typeof provider.rerank === 'function' ? (provider as RerankProvider) : undefined;
}

export type { RerankProviderId };

/**
 * 解析 provider 顺序（EMBEDDING_PROVIDER，逗号分隔 = 降级链）。
 * 未配置时退回已实现 provider 的默认顺序；配置了未知 id 直接报错，避免静默走错 provider。
 */
export function resolveEmbeddingProviderOrder(serialized: string = process.env.EMBEDDING_PROVIDER || ''): EmbeddingProviderId[] {
  const raw = serialized.trim();
  if (!raw) return [...IMPLEMENTED_PROVIDERS];

  const known = new Set<string>(KNOWN_PROVIDERS);
  const order: EmbeddingProviderId[] = [];
  for (const part of raw.split(',')) {
    const id = part.trim().toLowerCase();
    if (!id) continue;
    if (!known.has(id)) {
      throw new EmbeddingError('EMBEDDING_PROVIDER_UNKNOWN', `未知的向量化 provider: ${id}`);
    }
    const typed = id as EmbeddingProviderId;
    if (!order.includes(typed)) order.push(typed);
  }

  return order.length > 0 ? order : [...IMPLEMENTED_PROVIDERS];
}
