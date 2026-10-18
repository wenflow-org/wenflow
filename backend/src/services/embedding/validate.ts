/**
 * embedding / rerank 入参校验与归一化。
 *
 * 约束按 OpenAI 兼容 `/v1/embeddings` 与常见 rerank 契约收敛，保证调用方在 provider 之间
 * 切换时行为一致：
 * - embedding.input：string 或 string[]（非空、去空串）；单条与批量共用同一上限
 * - rerank.query：单条必填；rerank.documents：非空数组
 * - 文本长度上限：**按字符**保守钳制。上游的 token 上限（bge-m3=8192 token）无法在
 *   发送前精确计出，而**中文一个字 ≈ 一个 token 甚至更多**，故按字符上限保守取值，
 *   宁可让调用方早些收到「太长」的显式报错，也不让上游静默截断（截断会让尾部语义消失）。
 *
 * 上游对未知字段是静默忽略的，因此这里用 .strict() 自己把关，避免调用方拼错参数却被悄悄丢掉。
 */

import { z } from 'zod';
import { EmbeddingError } from './types';
import type { EmbeddingRequest, RerankRequest } from './types';

/**
 * 单条文本字符上限。bge-m3 上下文 8192 token；中文 ≈1 token/字，留足余量取 6000 字符，
 * 使绝大多数「一章/一段」切片都能整段向量化，同时不越过上游窗口。
 */
export const MAX_TEXT_CHARS = 6000;

/** 单次批量条数上限：一次请求塞太多会拖长尾延迟、逼近上游请求体上限；分片由调用方负责 */
export const MAX_BATCH_SIZE = 128;

/** rerank 单批候选数上限（上游普遍支持较大 batch，但太大单请求易超时） */
export const MAX_RERANK_DOCUMENTS = 128;

const textField = z.string({ invalid_type_error: '文本必须是字符串' }).trim().max(
  MAX_TEXT_CHARS,
  `单条文本不能超过 ${MAX_TEXT_CHARS} 个字符（上游为 token 上限，中文按字粗略换算）`
);

const embeddingRequestSchema = z
  .object({
    input: z.union([
      textField.min(1, '单条文本不能为空'),
      z.array(textField.min(1, '单条文本不能为空')).min(1, 'input 数组不能为空').max(MAX_BATCH_SIZE, `单次批量不能超过 ${MAX_BATCH_SIZE} 条`),
    ]),
    model: z
      .string({ invalid_type_error: 'model 必须是字符串' })
      .trim()
      .min(1, 'model 不能为空')
      .max(128, 'model 不能超过 128 个字符')
      .optional(),
  })
  .strict('embedding 参数包含不支持的字段');

const rerankRequestSchema = z
  .object({
    query: textField.min(1, 'query 不能为空'),
    documents: z
      .array(textField.min(1, '候选文本不能为空'))
      .min(1, 'documents 不能为空')
      .max(MAX_RERANK_DOCUMENTS, `候选不能超过 ${MAX_RERANK_DOCUMENTS} 条`),
    model: z
      .string({ invalid_type_error: 'model 必须是字符串' })
      .trim()
      .min(1, 'model 不能为空')
      .max(128, 'model 不能超过 128 个字符')
      .optional(),
    topN: z
      .number({ invalid_type_error: 'topN 必须是数字' })
      .int('topN 必须是整数')
      .min(1, 'topN 不能小于 1')
      .optional(),
  })
  .strict('rerank 参数包含不支持的字段');

/** 把 string | string[] 统一成数组（保持原始顺序） */
export function toInputArray(input: string | string[]): string[] {
  return Array.isArray(input) ? input : [input];
}

/** 校验并归一化 embedding 入参；不合法时抛 EmbeddingError('EMBEDDING_REQUEST_INVALID') */
export function normalizeEmbeddingRequest(input: EmbeddingRequest): Required<Pick<EmbeddingRequest, 'input'>> & EmbeddingRequest {
  const parsed = embeddingRequestSchema.safeParse(input ?? {});
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message || 'embedding 参数无效';
    throw new EmbeddingError('EMBEDDING_REQUEST_INVALID', message);
  }
  return parsed.data as EmbeddingRequest;
}

/** 校验并归一化 rerank 入参；不合法时抛 EmbeddingError('RERANK_REQUEST_INVALID') */
export function normalizeRerankRequest(input: RerankRequest): RerankRequest {
  const parsed = rerankRequestSchema.safeParse(input ?? {});
  if (!parsed.success) {
    const message = (parsed.error.issues[0]?.message || 'rerank 参数无效').replace(/^documents/, '候选');
    throw new EmbeddingError('RERANK_REQUEST_INVALID', message);
  }
  const data = parsed.data as RerankRequest;
  // topN 超过候选数无意义，夹到候选数
  if (data.topN !== undefined) data.topN = Math.min(data.topN, data.documents.length);
  return data;
}
