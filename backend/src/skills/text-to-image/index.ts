/**
 * 文生图 Skill（外挂能力，handler-only / 无 LLM prompt）。
 *
 * 定位：把 backend/src/services/image 的 provider 抽象（Agnes + 降级链）
 * 暴露为统一的 Skill 入口，供 Capability Runtime / 平台工具调用。
 *
 * 与 web-search / web-fetch 并列，不合并：search 负责"找到"，fetch 负责"读到"，
 * text-to-image 负责"画出来"——入参契约（prompt vs query vs urls）与降级链各自独立。
 *
 * 配置：backend/.env 的 IMAGE_PROVIDER / IMAGE_API_URL / IMAGE_API_KEY / IMAGE_MODEL。
 */

import { generateImages } from '../../services/image';
import { ImageError } from '../../services/image/types';
import type { GeneratedImage, ImageResponseFormat } from '../../services/image/types';
import { SkillDefinition, SkillExecutionResult } from '../protocol';

export interface TextToImageInput {
  prompt: string;
  model?: string;
  size?: string;
  n?: number;
  responseFormat?: ImageResponseFormat;
  purpose?: string;
  signal?: AbortSignal;
}

export interface TextToImageOutput {
  provider: string;
  attempts: string[];
  model: string;
  latencyMs: number;
  images: GeneratedImage[];
}

export const textToImageDefinition: SkillDefinition = {
  name: 'text-to-image',
  displayName: '文生图 Skill',
  version: '1.0.0',
  category: 'generation',
  description: '调用外部文生图 provider（Agnes / OpenAI 兼容端点）按 prompt 生成图片',
  status: 'working',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: '画面描述（必填，1~4000 字符）', required: true },
      model: { type: 'string', description: '模型 id（不传 = provider 默认，如 agnes-image-2.5-flash）' },
      size: { type: 'string', description: '目标尺寸如 1024x1024（部分 provider 只当宽高比提示，不做精确像素保证）' },
      n: { type: 'number', description: '生成张数（默认 1；不支持多张的 provider 传 >1 会失败）' },
      responseFormat: { type: 'string', description: 'url | b64_json（默认 url）' },
      purpose: { type: 'string', description: '生成意图说明，provider 可忽略' },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      provider: { type: 'string' },
      attempts: { type: 'array' },
      model: { type: 'string' },
      latencyMs: { type: 'number' },
      images: { type: 'array', description: '生成的图片（url 或 b64Json）' },
    },
  },
  capabilities: ['text-to-image', 'image-generation', 'external-generation', 'provider-fallback'],
  stats: { callCount: 0, successRate: 1, avgLatency: 0 },
};

const TEXT_TO_IMAGE_ERROR_MESSAGES: Record<string, string> = {
  TEXT_TO_IMAGE_PROMPT_REQUIRED: 'text-to-image prompt 不能为空',
  TEXT_TO_IMAGE_EXECUTION_FAILED: '文生图执行失败',
  IMAGE_REQUEST_INVALID: '文生图参数无效',
  IMAGE_PROVIDER_NOT_CONFIGURED: '文生图 provider 未配置（请在 backend/.env 配置 IMAGE_API_URL 与 IMAGE_API_KEY）',
  IMAGE_PROVIDER_UNKNOWN: '文生图 provider 配置无效',
  IMAGE_PROVIDER_UNSUPPORTED: '当前 provider 不支持该生图参数',
  IMAGE_UPSTREAM_HTTP_ERROR: '文生图上游返回错误',
  IMAGE_UPSTREAM_UNAVAILABLE: '文生图上游暂时不可用',
  IMAGE_UPSTREAM_TIMEOUT: '文生图上游响应超时',
  IMAGE_EMPTY_RESULT: '文生图上游未返回可用图片',
  IMAGE_ALL_PROVIDERS_FAILED: '所有文生图 provider 均调用失败',
};

export async function executeTextToImage(
  input: TextToImageInput
): Promise<SkillExecutionResult<TextToImageOutput>> {
  const startedAt = Date.now();
  const prompt = typeof input?.prompt === 'string' ? input.prompt.trim() : '';

  if (!prompt) {
    return {
      success: false,
      error: {
        code: 'TEXT_TO_IMAGE_PROMPT_REQUIRED',
        message: TEXT_TO_IMAGE_ERROR_MESSAGES.TEXT_TO_IMAGE_PROMPT_REQUIRED,
      },
      duration: Date.now() - startedAt,
    };
  }

  try {
    const response = await generateImages(
      {
        prompt,
        model: input.model,
        size: input.size,
        n: input.n,
        responseFormat: input.responseFormat,
        purpose: input.purpose,
      },
      { signal: input.signal }
    );

    return {
      success: true,
      output: {
        provider: response.provider,
        attempts: response.attempts,
        model: response.model,
        latencyMs: response.latencyMs,
        images: response.images,
      },
      duration: Date.now() - startedAt,
    };
  } catch (error) {
    const isKnown = error instanceof ImageError && Boolean(TEXT_TO_IMAGE_ERROR_MESSAGES[error.code]);
    const code = isKnown ? (error as ImageError).code : 'TEXT_TO_IMAGE_EXECUTION_FAILED';
    return {
      success: false,
      error: {
        code,
        message: TEXT_TO_IMAGE_ERROR_MESSAGES[code]
          || (error instanceof Error ? error.message : TEXT_TO_IMAGE_ERROR_MESSAGES.TEXT_TO_IMAGE_EXECUTION_FAILED),
      },
      duration: Date.now() - startedAt,
    };
  }
}
