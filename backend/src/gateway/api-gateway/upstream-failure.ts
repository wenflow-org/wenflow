/**
 * 上游/基础设施类失败的类别表（2026-11-06 合并时从已下线的 deployment-health.ts 拆出）。
 *
 * 降级链与部署冷却整体下线后（用户「去掉降级这个功能，不要」），`deployment-health.ts` 已删除；
 * 但这张类别表还有两个与「要不要换模型」无关的消费者：
 * - `services/skill-runtime-contract.service.ts`：skill 成功率口径要剔除上游类失败；
 * - `skills/executor.ts`：`isUpstreamFailure` 判这次失败算不算上游的。
 * 所以它作为单一真源留在这里，不再挂在冷却注册表下。
 *
 * - rate_limit：限流（通常在部署/账号粒度）
 * - provider_http / network / provider_timeout：上游不稳定
 * - 不含 quota（账号/余额级）、authentication、configuration、protocol 等调用方或配置类
 */
export const UPSTREAM_FAILURE_CATEGORIES = ['rate_limit', 'provider_http', 'network', 'provider_timeout'] as const;

export function isUpstreamFailureCategory(category: string | null | undefined): boolean {
  return (UPSTREAM_FAILURE_CATEGORIES as readonly string[]).includes(String(category || '').toLowerCase());
}
