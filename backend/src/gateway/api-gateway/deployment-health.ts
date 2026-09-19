/**
 * 部署级健康 / 冷却注册表（P1）。
 *
 * 设计依据：doc/MODEL_GATEWAY_DESIGN.md §4.5
 * - 失败按**部署**（provider + endpoint + model）隔离，而不是整组模型
 * - 仅当存在可降级候选时才产生收益：冷却中的候选会被跳过，直接走 fallback
 * - 进程内实现（不引入 Redis）；多实例部署时各自维护，语义安全（最坏是多试几次）
 *
 * 成熟参照：LiteLLM 的 deployment cooldown（429/失败率 → 摘掉该部署）与
 * `allowed_fails` / `cooldown_time`。
 */

/** 默认冷却时长：足够跨过典型的限流窗口，又不至于长时间禁用健康候选 */
export const DEFAULT_COOLDOWN_MS = 30_000;

const cooldowns = new Map<string, number>();

export interface DeploymentIdentity {
  providerId?: string | null;
  endpoint?: string | null;
  model?: string | null;
}

/** 部署键：provider + endpoint + model（与 agent/技能无关，失败隔离到最细粒度） */
export function deploymentKey(parts: DeploymentIdentity): string {
  return `${parts.providerId || '-'}|${parts.endpoint || '-'}|${parts.model || '-'}`;
}

export function isCoolingDown(key: string, now: number = Date.now()): boolean {
  const until = cooldowns.get(key);
  if (until === undefined) return false;
  if (until <= now) {
    cooldowns.delete(key);
    return false;
  }
  return true;
}

export function markCoolingDown(key: string, cooldownMs: number = DEFAULT_COOLDOWN_MS, now: number = Date.now()): void {
  cooldowns.set(key, now + cooldownMs);
}

export function clearCooldown(key: string): void {
  cooldowns.delete(key);
}

/** 仅供测试与运维重置使用。 */
export function resetDeploymentHealth(): void {
  cooldowns.clear();
}

/**
 * 哪些错误类值得「换部署」而不是继续重试：
 * - rate_limit：换模型/端点通常有效（限流常在部署粒度）
 * - provider_http / network / provider_timeout：上游不稳定，换候选可能更好
 * - 不含 quota（账号/余额级，换模型无效）、authentication、configuration、protocol 等
 */
export function isFallbackWorthyCategory(category: string | null | undefined): boolean {
  return category === 'rate_limit'
    || category === 'provider_http'
    || category === 'network'
    || category === 'provider_timeout';
}
