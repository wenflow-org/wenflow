/**
 * 文生图入参校验与归一化。
 *
 * 约束按 OpenAI 兼容 /v1/images/generations 的公开契约收敛，保证调用方在
 * provider 之间切换时行为一致：
 * - prompt 必填，1~4000 字符
 * - size 为档位式 1K/2K/3K/4K（推荐）或形如 1024x1024（只做格式校验，不做精确像素保证）
 * - ratio 为官方宽高比档位，与档位式 size 配合（不传 = provider 默认 1:1）
 * - n 为 1~4 整数（是否真支持多张由 adapter 判定，不支持会让 provider 降级）
 * - responseFormat 仅 url / b64_json
 *
 * 上游对未知字段是静默忽略的，因此这里用 .strict() 自己把关，
 * 避免调用方拼错参数却被悄悄丢掉。
 */

import { z } from 'zod';
import { ImageError, IMAGE_RATIOS } from './types';
import type { ImageRequest } from './types';

const MAX_PROMPT_CHARS = 4000;
const MAX_N = 4;

const imageRequestSchema = z
  .object({
    prompt: z
      .string({ required_error: 'prompt 必填', invalid_type_error: 'prompt 必须是字符串' })
      .trim()
      .min(1, 'prompt 不能为空')
      .max(MAX_PROMPT_CHARS, `prompt 不能超过 ${MAX_PROMPT_CHARS} 个字符`),
    model: z
      .string({ invalid_type_error: 'model 必须是字符串' })
      .trim()
      .min(1, 'model 不能为空')
      .max(128, 'model 不能超过 128 个字符')
      .optional(),
    size: z
      .string({ invalid_type_error: 'size 必须是字符串' })
      .trim()
      .regex(/^([1-4]K|\d{2,5}x\d{2,5})$/i, 'size 必须是档位 1K/2K/3K/4K 或形如 1024x1024')
      .optional(),
    ratio: z
      .enum(IMAGE_RATIOS, {
        errorMap: () => ({ message: 'ratio 仅支持 1:1/3:4/4:3/16:9/9:16/2:3/3:2/21:9' }),
      })
      .optional(),
    n: z
      .number({ invalid_type_error: 'n 必须是数字' })
      .int('n 必须是整数')
      .min(1, 'n 不能小于 1')
      .max(MAX_N, `n 不能超过 ${MAX_N}`)
      .optional(),
    responseFormat: z
      .enum(['url', 'b64_json'], {
        errorMap: () => ({ message: 'responseFormat 仅支持 url 或 b64_json' }),
      })
      .optional(),
    purpose: z
      .string({ invalid_type_error: 'purpose 必须是字符串' })
      .trim()
      .max(2000, 'purpose 不能超过 2000 个字符')
      .optional(),
  })
  .strict('文生图参数包含不支持的字段');

/** 校验并归一化；不合法时抛 ImageError('IMAGE_REQUEST_INVALID') */
export function normalizeImageRequest(input: ImageRequest): ImageRequest {
  const parsed = imageRequestSchema.safeParse(input ?? {});
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message || '文生图参数无效';
    throw new ImageError('IMAGE_REQUEST_INVALID', message);
  }
  return parsed.data as ImageRequest;
}
