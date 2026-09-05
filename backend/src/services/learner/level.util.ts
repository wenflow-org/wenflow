/**
 * 用户等级单点推导（统一化：消除多实现漂移）
 * 权威公式：level = floor(sqrt(xp / 100)) + 1
 */
export function getLevelFromXp(xp: number): number {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1;
}
