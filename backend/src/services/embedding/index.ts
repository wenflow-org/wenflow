/**
 * 向量化 / 重排服务公开入口（外挂能力 embedding / rerank）。
 *
 * 用法：
 *   import { embedTexts, rerankDocuments, cosineSimilarity } from '../services/embedding';
 *   const { vectors } = await embedTexts({ input: ['第一段', '第二段'] });
 *   const { results } = await rerankDocuments({ query: '学习理论', documents: [...] });
 *
 * 定位：为**材料理解层**（开放长语料）提供语义召回/排序。当前**不含向量库**——
 * 存储与检索策略由消费方决定；本量级下 SQLite 落 BLOB + 应用层 cosine 即可。
 */

export * from './types';
export {
  normalizeEmbeddingRequest,
  normalizeRerankRequest,
  toInputArray,
  MAX_TEXT_CHARS,
  MAX_BATCH_SIZE,
  MAX_RERANK_DOCUMENTS,
} from './validate';
export { embedTexts, rerankDocuments, cosineSimilarity } from './embedding.service';
export type { EmbedCallOptions } from './embedding.service';
export {
  createEmbeddingProviders,
  resolveEmbeddingProviderOrder,
  resolveEmbeddingModelId,
  KNOWN_PROVIDERS,
  IMPLEMENTED_PROVIDERS,
} from './providers';
