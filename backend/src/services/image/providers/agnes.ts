/**
 * Agnes（new-api 网关）文生图 adapter。
 *
 * POST <IMAGE_API_URL>（OpenAI 兼容 /v1/images/generations），
 * 认证 Authorization: Bearer <IMAGE_API_KEY>。
 * 文档：OpenAI Images API（本网关为兼容实现）。
 *
 * 能力差异（相对统一 ImageRequest）：
 * - n 仅支持 1（上游明确报 `n must be 1`）→ n>1 时抛 IMAGE_PROVIDER_UNSUPPORTED，由 service 降级，
 *   而不是把多张悄悄压成一张。
 * - size 被接受但只决定宽高比档位（实测 512x512→1024x1024，1024x1792→736x1312），
 *   原样透传、不做精确像素保证（语义已在 types.ts 的 size 注释写明）。
 * - purpose 为纯提示字段，无对应参数，静默忽略。
 * - 响应同时带 url 与 b64_json（未请求的一侧为空串），按非空侧归一化。
 */

import { safeHttpRequest } from '../../../utils/safe-http';
import { ImageError } from '../types';
import type {
  GeneratedImage,
  ImageCallOptions,
  ImageProvider,
  ImageProviderResult,
  ImageRequest,
} from '../types';
import { asString, toUpstreamError, unsupported } from './shared';

const DEFAULT_ENDPOINT = '';
const DEFAULT_MODEL = 'agnes-image-2.5-flash';
/** 生图比搜索/抓取慢得多（实测单张约 10s），超时预算放宽到 180s */
const DEFAULT_TIMEOUT_MS = 180_000;
/** b64_json 单张可达数 MB，放宽到 32MB */
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const PROVIDER_LABEL = 'Agnes';

export interface AgnesImageConfig {
  endpoint: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

export function readAgnesImageConfig(): AgnesImageConfig {
  const timeout = Number(process.env.IMAGE_TIMEOUT_MS);
  return {
    endpoint: (process.env.IMAGE_API_URL || DEFAULT_ENDPOINT).trim(),
    apiKey: (process.env.IMAGE_API_KEY || '').trim(),
    model: (process.env.IMAGE_MODEL || '').trim() || DEFAULT_MODEL,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? Math.floor(timeout) : DEFAULT_TIMEOUT_MS,
  };
}

/** 该 adapter 无法表达的能力，在发请求前就失败（service 会降级到下一个 provider） */
export function assertAgnesImageSupported(request: ImageRequest): void {
  if (request.n !== undefined && request.n > 1) {
    throw unsupported(PROVIDER_LABEL, `n>1（上游仅支持 n=1，多图请并发多次调用）`);
  }
}

export function buildAgnesImageBody(request: ImageRequest, model: string): Record<string, unknown> {
  assertAgnesImageSupported(request);

  const body: Record<string, unknown> = {
    model: request.model || model,
    prompt: request.prompt,
    n: 1,
  };
  if (request.size) body.size = request.size;
  if (request.responseFormat) body.response_format = request.responseFormat;

  return body;
}

interface AgnesRawImage {
  url?: unknown;
  b64_json?: unknown;
  revised_prompt?: unknown;
}

interface AgnesRawResponse {
  data?: unknown;
}

export function normalizeAgnesImageResult(raw: AgnesRawResponse): GeneratedImage[] {
  const list = Array.isArray(raw?.data) ? (raw.data as AgnesRawImage[]) : [];
  const images: GeneratedImage[] = [];

  for (const item of list) {
    const url = asString(item?.url);
    const b64Json = asString(item?.b64_json);
    // 两侧都空视为无效条目（上游可能对失败项回空占位）
    if (!url && !b64Json) continue;

    images.push({
      url,
      b64Json,
      revisedPrompt: asString(item?.revised_prompt),
      provider: 'agnes',
    });
  }

  return images;
}

export class AgnesImageProvider implements ImageProvider {
  readonly id = 'agnes' as const;
  private readonly config: AgnesImageConfig;

  constructor(config: AgnesImageConfig = readAgnesImageConfig()) {
    this.config = config;
  }

  isConfigured(): boolean {
    return Boolean(this.config.endpoint && this.config.apiKey);
  }

  async generate(request: ImageRequest, options: ImageCallOptions = {}): Promise<ImageProviderResult> {
    if (!this.isConfigured()) {
      throw new ImageError(
        'IMAGE_PROVIDER_NOT_CONFIGURED',
        'Agnes 生图未配置 IMAGE_API_URL / IMAGE_API_KEY'
      );
    }

    const model = request.model || this.config.model;
    const body = buildAgnesImageBody(request, this.config.model);

    let response;
    try {
      response = await safeHttpRequest<AgnesRawResponse>(this.config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body,
        timeoutMs: options.timeoutMs ?? this.config.timeoutMs,
        maxResponseBytes: MAX_RESPONSE_BYTES,
        privateNetworkPolicy: 'public-only',
        signal: options.signal,
      });
    } catch (error) {
      throw toUpstreamError(error, PROVIDER_LABEL);
    }

    if (response.status < 200 || response.status >= 300) {
      const upstreamMessage = asString((response.data as { error?: { message?: unknown } } | undefined)?.error?.message);
      throw new ImageError(
        'IMAGE_UPSTREAM_HTTP_ERROR',
        `Agnes 生图返回 HTTP ${response.status}${upstreamMessage ? `：${upstreamMessage}` : ''}`,
        response.status
      );
    }

    const images = normalizeAgnesImageResult(response.data);
    if (images.length === 0) {
      throw new ImageError('IMAGE_EMPTY_RESULT', 'Agnes 生图未返回任何可用图片');
    }

    return { images, model };
  }
}
