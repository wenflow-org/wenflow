/**
 * 本地 per-模型 并发闸门（P2 ④）。
 *
 * 设计依据：doc/MODEL_GATEWAY_DESIGN.md §4.6
 * - 上游网关的 429 有相当一部分来自**我方并发突发**；在本地先按模型限流可减少触发概率
 * - 与上游 429 **同构**：超限抛 `rate_limit` 错误，交回统一的退避/降级链路处理
 *   （配合 P1 的 fallback，饱和的主模型可自动让位给另一部署）
 * - **默认不限**（未配置 `maxParallelRequests` 即不生效）——限值是运维决策，
 *   不靠猜；成熟参照：LiteLLM 的 `max_parallel_requests`（由 rpm/tpm 推导或显式配置）
 *
 * 进程内实现（与 deployment-health 一致，不引入 Redis）。
 */
import { getModelDefinition } from '../../config/models.config';

const inFlight = new Map<string, number>();

/** 取模型的并发上限；未配置 / 非正数 → null（不限）。 */
export function getModelMaxParallelRequests(modelId: string): number | null {
  const limit = getModelDefinition(modelId)?.maxParallelRequests;
  return typeof limit === 'number' && Number.isFinite(limit) && limit > 0
    ? Math.floor(limit)
    : null;
}

export function getInFlight(key: string): number {
  return inFlight.get(key) ?? 0;
}

/**
 * 尝试占用一个槽位。
 * 未配置上限（limit == null）时恒为 true 且不计数（保持零开销、零行为变化）。
 */
export function tryAcquireSlot(key: string, limit: number | null | undefined): boolean {
  if (limit === null || limit === undefined || limit <= 0) return true;
  const current = inFlight.get(key) ?? 0;
  if (current >= limit) return false;
  inFlight.set(key, current + 1);
  return true;
}

export function releaseSlot(key: string): void {
  const current = inFlight.get(key) ?? 0;
  if (current <= 0) return;
  if (current === 1) inFlight.delete(key);
  else inFlight.set(key, current - 1);
}

/** 仅供测试与运维重置使用。 */
export function resetModelConcurrency(): void {
  inFlight.clear();
}
