/**
 * 网页抓取编排服务（外挂能力 web-fetch 的运行时入口）。
 *
 * 职责：校验入参 → 按 FETCH_PROVIDER 顺序逐个 provider 尝试 → 失败自动降级 →
 * 返回统一结构（含实际命中的 provider 与尝试链）。
 *
 * 降级语义与 services/search 的关键差异：
 * search 是「整体成功/失败」，而 fetch 在 provider 内部就是「部分成功」——
 * 某条 URL 失败不影响其余。因此这里把「一条都没抓到」视为该 provider 未达成目标，
 * 继续尝试下一个 provider（不同 provider 的抓取能力确实不同），
 * 并把最后一次的部分失败明细作为错误细节带出，而不是静默返回空结果。
 */

import { logger } from '../../utils/logger';
import { createFetchProviders, resolveFetchProviderOrder } from './providers';
import { FetchError } from './types';
import type {
  FetchProvider,
  FetchProviderId,
  FetchProviderResult,
  FetchRequest,
  FetchResponse,
} from './types';
import { normalizeFetchRequest } from './validate';

export interface FetchWebOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** 覆盖 FETCH_PROVIDER 的 provider 顺序（测试 / 内部编排用） */
  providerOrder?: FetchProviderId[];
  /** 覆盖 provider 实例（测试注入用） */
  providers?: Partial<Record<FetchProviderId, FetchProvider>>;
}

/** 把部分失败明细压成一行，避免把整批 URL 原样塞进错误消息 */
function summarizeErrors(result: FetchProviderResult): string {
  return result.errors
    .slice(0, 3)
    .map((item) => `${item.url}(${item.code})`)
    .join(', ');
}

/** 可选优化参数（尽力而为语义，非抓取硬能力）不被支持时：剥掉参数重试同一 provider */
const OPTIONAL_PARAM_UNSUPPORTED = /缓存 ttl|单URL超时/;

function stripOptionalFetchParams(request: FetchRequest): FetchRequest {
  const stripped = { ...request };
  delete stripped.ttl;
  delete stripped.perUrlTimeoutMs;
  return stripped;
}

export async function fetchWeb(request: FetchRequest, options: FetchWebOptions = {}): Promise<FetchResponse> {
  const normalized = normalizeFetchRequest(request);
  const providers = options.providers ?? createFetchProviders();
  const order = options.providerOrder ?? resolveFetchProviderOrder();

  const startedAt = Date.now();
  const attempts: FetchProviderId[] = [];
  let lastError: unknown;
  let lastPartial: FetchProviderResult | undefined;

  for (const id of order) {
    const provider = providers[id];
    // 未在当前构建中实现的 provider 直接跳过，不产生噪声
    if (!provider) continue;
    if (!provider.isConfigured()) continue;

    attempts.push(id);
    try {
      const result = await provider.fetch(normalized, {
        signal: options.signal,
        timeoutMs: options.timeoutMs,
      });
      // 抓到至少一条即视为成功（其余条目可能在 errors 里，属正常的部分失败）
      if (result.results.length > 0) {
        return {
          results: result.results,
          errors: result.errors,
          provider: id,
          attempts,
          latencyMs: Date.now() - startedAt,
        };
      }
      // 一条都没抓到：保留明细，继续尝试下一个 provider
      lastPartial = result;
    } catch (error) {
      // 可选优化参数（缓存 ttl / 单 URL 超时）不被支持 ≠ 抓取能力不匹配：剥掉参数在同一 provider
      // 上重试一次，而不是把整个 provider 踢出降级链。
      // （2026-09-26 真实数据：TinyFish fetch 上游不可用时，Tavily 因 ttl 直接拒跑，降级链上
      // 再无 provider → 抓取全链断，联网采集全体退化为 not_found。）
      if (
        error instanceof FetchError &&
        error.code === 'FETCH_PROVIDER_UNSUPPORTED' &&
        OPTIONAL_PARAM_UNSUPPORTED.test(error.message)
      ) {
        logger.warn('[web-fetch] provider 不支持可选优化参数，剥离后重试', {
          provider: id,
          message: error.message,
        });
        try {
          const retryResult = await provider.fetch(stripOptionalFetchParams(normalized), {
            signal: options.signal,
            timeoutMs: options.timeoutMs,
          });
          if (retryResult.results.length > 0) {
            return {
              results: retryResult.results,
              errors: retryResult.errors,
              provider: id,
              attempts,
              latencyMs: Date.now() - startedAt,
            };
          }
          lastPartial = retryResult;
        } catch (retryError) {
          lastError = retryError;
          logger.warn('[web-fetch] 剥离可选参数重试仍失败，尝试降级', {
            provider: id,
            message: retryError instanceof Error ? retryError.message : String(retryError),
          });
        }
        continue;
      }
      lastError = error;
      logger.warn('[web-fetch] provider 调用失败，尝试降级', {
        provider: id,
        code: error instanceof FetchError ? error.code : undefined,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (attempts.length === 0) {
    throw new FetchError(
      'FETCH_PROVIDER_NOT_CONFIGURED',
      '没有可用的抓取 provider：请在 backend/.env 配置 FETCH_API_KEY（或复用 SEARCH_API_KEY，TinyFish Fetch 免费）'
    );
  }
  if (lastPartial) {
    throw new FetchError(
      'FETCH_ALL_URLS_FAILED',
      `所有 URL 均抓取失败（provider=${attempts[attempts.length - 1]}）：${summarizeErrors(lastPartial) || '上游未返回结果'}`
    );
  }
  if (lastError instanceof FetchError) throw lastError;
  throw new FetchError('FETCH_ALL_PROVIDERS_FAILED', '所有抓取 provider 均调用失败');
}
