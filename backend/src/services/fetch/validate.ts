/**
 * 抓取入参校验与归一化。
 *
 * 约束按 TinyFish Fetch API 的公开契约收敛（其余 provider 是它的子集），
 * 保证调用方在 provider 之间切换时行为一致：
 * - urls 必须为 1~10 条 http/https 绝对地址
 * - format 仅 markdown / html / json
 * - includeSelectors / excludeSelectors 各最多 20 条
 * - ifNoneMatch / ifModifiedSince 仅单 URL 可用（上游会 400）
 *
 * 上游对未知字段是静默忽略的（实测），因此这里用 .strict() 自己把关，
 * 避免调用方拼错参数却被悄悄丢掉。
 */

import { z } from 'zod';
import { FetchError } from './types';
import type { FetchRequest } from './types';

const MAX_URLS = 10;
const MAX_SELECTORS = 20;

const httpUrlSchema = z
  .string({ required_error: 'url 必填', invalid_type_error: 'url 必须是字符串' })
  .trim()
  .min(1, 'url 不能为空')
  .max(2048, 'url 不能超过 2048 个字符')
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'url 必须是 http/https 绝对地址');

const selectorListSchema = z
  .array(z.string().trim().min(1, '选择器不能为空字符串').max(255, '单个选择器不能超过 255 个字符'))
  .max(MAX_SELECTORS, `选择器不能超过 ${MAX_SELECTORS} 条`)
  .optional();

const fetchRequestSchema = z
  .object({
    urls: z
      .array(httpUrlSchema, { required_error: 'urls 必填', invalid_type_error: 'urls 必须是数组' })
      .min(1, 'urls 至少 1 条')
      .max(MAX_URLS, `urls 不能超过 ${MAX_URLS} 条`),
    format: z
      .enum(['markdown', 'html', 'json'], {
        errorMap: () => ({ message: 'format 仅支持 markdown、html 或 json' }),
      })
      .optional(),
    includeSelectors: selectorListSchema,
    excludeSelectors: selectorListSchema,
    ttl: z.number({ invalid_type_error: 'ttl 必须是数字' }).int('ttl 必须是整数').min(0, 'ttl 不能小于 0').optional(),
    perUrlTimeoutMs: z
      .number({ invalid_type_error: 'perUrlTimeoutMs 必须是数字' })
      .int('perUrlTimeoutMs 必须是整数')
      .min(1, 'perUrlTimeoutMs 不能小于 1')
      .max(120_000, 'perUrlTimeoutMs 不能超过 120000')
      .optional(),
    purpose: z.string({ invalid_type_error: 'purpose 必须是字符串' }).trim().max(2000, 'purpose 不能超过 2000 个字符').optional(),
    links: z.boolean({ invalid_type_error: 'links 必须是布尔值' }).optional(),
    imageLinks: z.boolean({ invalid_type_error: 'imageLinks 必须是布尔值' }).optional(),
    ifNoneMatch: z.string({ invalid_type_error: 'ifNoneMatch 必须是字符串' }).trim().min(1, 'ifNoneMatch 不能为空').max(512, 'ifNoneMatch 不能超过 512 个字符').optional(),
    ifModifiedSince: z.string({ invalid_type_error: 'ifModifiedSince 必须是字符串' }).trim().min(1, 'ifModifiedSince 不能为空').max(128, 'ifModifiedSince 不能超过 128 个字符').optional(),
    includeValidators: z.boolean({ invalid_type_error: 'includeValidators 必须是布尔值' }).optional(),
  })
  .strict('抓取参数包含不支持的字段')
  .superRefine((value, ctx) => {
    if ((value.ifNoneMatch || value.ifModifiedSince) && value.urls.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'ifNoneMatch / ifModifiedSince 为条件请求，仅支持单个 URL',
      });
    }
    if (value.includeValidators && value.urls.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'includeValidators 仅支持单个 URL（上游校验器按单条 URL 返回）',
      });
    }
  });

/** 校验并归一化；不合法时抛 FetchError('FETCH_REQUEST_INVALID') */
export function normalizeFetchRequest(input: FetchRequest): FetchRequest {
  const parsed = fetchRequestSchema.safeParse(input ?? {});
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message || '抓取参数无效';
    throw new FetchError('FETCH_REQUEST_INVALID', message);
  }
  return parsed.data as FetchRequest;
}
