/**
 * 文生图统一类型（外挂能力 text-to-image）。
 *
 * 与 services/search / services/fetch 同构：调用方只依赖本文件，provider 可替换、
 * 可降级。新增 provider 只需实现 ImageProvider 并在 providers/index.ts 注册。
 *
 * 与 search / fetch 的差异（决定了接口形态）：
 * 1. 入参是 prompt（不是 query / urls），产出是图片（URL 或 base64）——
 *    因此三者并列而不合并：search 找 URL，fetch 取正文，image 生成图片。
 * 2. 单张生成通常 5~30s，超时预算显著高于搜索/抓取（默认 180s）。
 * 3. 上游「字段接受但只有近似语义」的情况真实存在（如 size 只决定宽高比档位），
 *    此类差异在字段注释里写明；凡 adapter 确知**完全不支持**的能力一律抛
 *    IMAGE_PROVIDER_UNSUPPORTED（不静默偏差），仅 purpose 这类纯提示字段允许被忽略。
 */

export type ImageProviderId = 'agnes';

/** 返回形态：直链（默认）或 base64（内联，便于落盘/入库） */
export type ImageResponseFormat = 'url' | 'b64_json';

export interface ImageRequest {
  /** 画面描述（必填） */
  prompt: string;
  /** 模型 id；不传 = provider 默认（IMAGE_MODEL） */
  model?: string;
  /**
   * 目标尺寸，形如 1024x1024 / 1024x1792。
   * 注意：部分 provider 只把它当**宽高比提示**，实际像素会吸附到固定档位
   * （实测 agnes：512x512→1024x1024，1024x1792→736x1312），不做精确保证。
   */
  size?: string;
  /** 生成张数；不传 = 1。不支持多张的 provider 传 >1 时抛 IMAGE_PROVIDER_UNSUPPORTED */
  n?: number;
  /** 返回形态；不传 = url */
  responseFormat?: ImageResponseFormat;
  /** 生成意图说明（为什么画），provider 可忽略 */
  purpose?: string;
}

export interface GeneratedImage {
  /** 图片直链（responseFormat=url 时返回） */
  url?: string;
  /** 图片 base64（responseFormat=b64_json 时返回） */
  b64Json?: string;
  /** 上游对 prompt 的改写（部分模型返回） */
  revisedPrompt?: string;
  provider: ImageProviderId;
  /** provider 自报的单张耗时（毫秒） */
  latencyMs?: number;
}

/** adapter 归一化后的结果（provider / attempts / latency 由 service 补齐） */
export interface ImageProviderResult {
  images: GeneratedImage[];
  /** 实际使用的模型（provider 默认值填充后） */
  model: string;
}

export interface ImageResponse extends ImageProviderResult {
  /** 实际返回结果的 provider */
  provider: ImageProviderId;
  /** 本次尝试过的 provider 顺序（含失败降级过程），用于排障 */
  attempts: ImageProviderId[];
  latencyMs: number;
}

export interface ImageCallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface ImageProvider {
  readonly id: ImageProviderId;
  /** 是否具备调用条件（endpoint / key 已配置）；未配置的 provider 会被 service 跳过 */
  isConfigured(): boolean;
  generate(request: ImageRequest, options?: ImageCallOptions): Promise<ImageProviderResult>;
}

export type ImageErrorCode =
  | 'IMAGE_REQUEST_INVALID'
  | 'IMAGE_PROVIDER_NOT_CONFIGURED'
  | 'IMAGE_PROVIDER_UNKNOWN'
  | 'IMAGE_UPSTREAM_HTTP_ERROR'
  | 'IMAGE_UPSTREAM_UNAVAILABLE'
  | 'IMAGE_UPSTREAM_TIMEOUT'
  | 'IMAGE_PROVIDER_UNSUPPORTED'
  | 'IMAGE_EMPTY_RESULT'
  | 'IMAGE_ALL_PROVIDERS_FAILED';

export class ImageError extends Error {
  readonly code: ImageErrorCode;
  readonly status?: number;

  constructor(code: ImageErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'ImageError';
    this.code = code;
    this.status = status;
  }
}
