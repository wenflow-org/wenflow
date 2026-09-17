/**
 * 搜索入参校验与归一化。
 *
 * 约束按 TinyFish Search API 的公开契约收敛（其余 provider 是它的子集或等价能力），
 * 保证调用方在 provider 之间切换时行为一致：
 * - recencyMinutes 与 afterDate / beforeDate 互斥
 * - afterDate <= beforeDate
 * - domainType=research_paper 不支持日期过滤，改用 pubYearMin / pubYearMax
 */

import { z } from 'zod';
import { SearchError } from './types';
import type { SearchQuery } from './types';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const dateSchema = z.string().trim().regex(DATE_PATTERN, '日期格式必须为 YYYY-MM-DD');

const searchQuerySchema = z
  .object({
    query: z
      .string({ required_error: 'query 必填', invalid_type_error: 'query 必须是字符串' })
      .trim()
      .min(1, 'query 不能为空')
      .max(2000, 'query 不能超过 2000 个字符'),
    maxResults: z.number({ invalid_type_error: 'maxResults 必须是数字' }).int('maxResults 必须是整数').min(1, 'maxResults 不能小于 1').max(50, 'maxResults 不能超过 50').optional(),
    location: z.string({ invalid_type_error: 'location 必须是字符串' }).trim().max(64, 'location 不能超过 64 个字符').optional(),
    language: z.string({ invalid_type_error: 'language 必须是字符串' }).trim().max(32, 'language 不能超过 32 个字符').optional(),
    recencyMinutes: z.number({ invalid_type_error: 'recencyMinutes 必须是数字' }).int('recencyMinutes 必须是整数').min(1, 'recencyMinutes 不能小于 1').max(5_256_000, 'recencyMinutes 不能超过 5256000').optional(),
    afterDate: dateSchema.optional(),
    beforeDate: dateSchema.optional(),
    domainType: z.enum(['web', 'news', 'research_paper'], {
      errorMap: () => ({ message: 'domainType 仅支持 web、news 或 research_paper' }),
    }).optional(),
    includeDomains: z.array(z.string().trim().min(1, 'includeDomains 不能包含空字符串').max(255, 'includeDomains 单条不能超过 255 个字符')).max(50, 'includeDomains 不能超过 50 条').optional(),
    excludeDomains: z.array(z.string().trim().min(1, 'excludeDomains 不能包含空字符串').max(255, 'excludeDomains 单条不能超过 255 个字符')).max(50, 'excludeDomains 不能超过 50 条').optional(),
    page: z.number({ invalid_type_error: 'page 必须是数字' }).int('page 必须是整数').min(0, 'page 不能小于 0').max(10, 'page 不能超过 10').optional(),
    purpose: z.string({ invalid_type_error: 'purpose 必须是字符串' }).trim().max(2000, 'purpose 不能超过 2000 个字符').optional(),
    pubYearMin: z.number({ invalid_type_error: 'pubYearMin 必须是数字' }).int('pubYearMin 必须是整数').min(0, 'pubYearMin 不能小于 0').max(9999, 'pubYearMin 不能超过 9999').optional(),
    pubYearMax: z.number({ invalid_type_error: 'pubYearMax 必须是数字' }).int('pubYearMax 必须是整数').min(0, 'pubYearMax 不能小于 0').max(9999, 'pubYearMax 不能超过 9999').optional(),
  })
  .strict('搜索参数包含不支持的字段')
  .superRefine((value, ctx) => {
    if (value.recencyMinutes !== undefined && (value.afterDate || value.beforeDate)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'recencyMinutes 不能与 afterDate / beforeDate 同时使用' });
    }
    if (value.afterDate && value.beforeDate && value.afterDate > value.beforeDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'afterDate 不能晚于 beforeDate' });
    }
    if (value.domainType === 'research_paper') {
      if (value.recencyMinutes !== undefined || value.afterDate || value.beforeDate) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'domainType=research_paper 不支持日期/时效过滤，请改用 pubYearMin / pubYearMax' });
      }
    } else if (value.pubYearMin !== undefined || value.pubYearMax !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'pubYearMin / pubYearMax 仅在 domainType=research_paper 时可用' });
    }
    if (value.pubYearMin !== undefined && value.pubYearMax !== undefined && value.pubYearMin > value.pubYearMax) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'pubYearMin 不能大于 pubYearMax' });
    }
  });

/** 校验并归一化；不合法时抛 SearchError('SEARCH_QUERY_INVALID') */
export function normalizeSearchQuery(input: SearchQuery): SearchQuery {
  const parsed = searchQuerySchema.safeParse(input ?? {});
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message || '搜索参数无效';
    throw new SearchError('SEARCH_QUERY_INVALID', message);
  }
  return parsed.data as SearchQuery;
}
