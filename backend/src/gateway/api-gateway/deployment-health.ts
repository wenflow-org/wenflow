/**
 * 上游不稳定类失败判定（#177：skill 成功率口径剔除上游/基础设施类失败）。
 *
 * 历史：本文件原是「部署健康度 + 模型降级链 + 部署冷却」三件套；2026-11-05
 * 「模型降级链与部署冷却整体下线」（ui/admin-pc-full-audit-20261031）把前两件撤除，
 * 只剩这套**失败类别分类学**仍有读者——skill 成功率口径（skill-runtime-contract）与
 * skills/executor 的「上游不稳定」判定要区分「skill 逻辑失败」与「上游/基础设施失败」。
 * 因此本模块瘦身为单一真源：类别集合在这里，网关加类别此处自动跟随。
 */
export const FALLBACK_WORTHY_CATEGORIES = ['rate_limit', 'provider_http', 'network', 'provider_timeout'] as const;

export function isFallbackWorthyCategory(category: string | null | undefined): boolean {
  return (FALLBACK_WORTHY_CATEGORIES as readonly string[]).includes(String(category || '').toLowerCase());
}
