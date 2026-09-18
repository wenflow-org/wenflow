/**
 * 文生图编排服务（外挂能力 text-to-image 的运行时入口）。
 *
 * 职责：校验入参 → 按 IMAGE_PROVIDER 顺序逐个 provider 尝试 → 失败自动降级 →
 * 返回统一结构（含实际命中的 provider 与尝试链）。
 *
 * 与 fetch 的差异：生图是「整体成功/失败」语义（一次请求产出一批图片，不存在
 * 部分成功），因此「provider 返回 0 张可用图片」直接由 adapter 抛
 * IMAGE_EMPTY_RESULT，与上游报错走同一条降级路径，无需 lastPartial 分支。
 */

import { logger } from '../../utils/logger';
import { createImageProviders, resolveImageProviderOrder } from './providers';
import { ImageError } from './types';
import type { ImageProvider, ImageProviderId, ImageRequest, ImageResponse } from './types';
import { normalizeImageRequest } from './validate';

export interface GenerateImageOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** 覆盖 IMAGE_PROVIDER 的 provider 顺序（测试 / 内部编排用） */
  providerOrder?: ImageProviderId[];
  /** 覆盖 provider 实例（测试注入用） */
  providers?: Partial<Record<ImageProviderId, ImageProvider>>;
}

export async function generateImages(
  request: ImageRequest,
  options: GenerateImageOptions = {}
): Promise<ImageResponse> {
  const normalized = normalizeImageRequest(request);
  const providers = options.providers ?? createImageProviders();
  const order = options.providerOrder ?? resolveImageProviderOrder();

  const startedAt = Date.now();
  const attempts: ImageProviderId[] = [];
  let lastError: unknown;

  for (const id of order) {
    const provider = providers[id];
    // 未在当前构建中实现的 provider 直接跳过，不产生噪声
    if (!provider) continue;
    if (!provider.isConfigured()) continue;

    attempts.push(id);
    try {
      const result = await provider.generate(normalized, {
        signal: options.signal,
        timeoutMs: options.timeoutMs,
      });
      return {
        images: result.images,
        model: result.model,
        provider: id,
        attempts,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      lastError = error;
      logger.warn('[text-to-image] provider 调用失败，尝试降级', {
        provider: id,
        code: error instanceof ImageError ? error.code : undefined,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (attempts.length === 0) {
    throw new ImageError(
      'IMAGE_PROVIDER_NOT_CONFIGURED',
      '没有可用的文生图 provider：请在 backend/.env 配置 IMAGE_API_URL 与 IMAGE_API_KEY'
    );
  }
  // 单 provider 时保留上游原始错误码（超时 / HTTP / 不支持），不要压成笼统的 ALL_FAILED
  if (lastError instanceof ImageError) throw lastError;
  throw new ImageError('IMAGE_ALL_PROVIDERS_FAILED', '所有文生图 provider 均调用失败');
}
