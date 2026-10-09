/**
 * 连续学习天数推进规则（2026-10-07 从 task-completion.service 抽出，行为不变）。
 *
 * 为什么抽出来：这段规则原本内联在 `updateStreakDays` 的大 try 块里（service 内），
 * 整段逻辑都在日界上，却没有任何测试——而它决定用户看到的「连续 N 天」。
 * 抽成纯函数后可以独立锁住，也避免以后有人把 day-boundary 换成 UTC 切日而无人察觉。
 *
 * 口径与 day-boundary 一致：日界一律走应用时区（`dayKeyOf` / `dayDiffInDays`），
 * 不用 UTC 切日，也不用服务器机器本地时区。
 */
import { dayKeyOf, parseDayKeyStart, dayDiffInDays } from '../../time/day-boundary';

export interface StreakSnapshot {
  /** 当前连续天数（库里存的快照） */
  streakDays: number;
  /** 上一次计入连续的那一天（绝对时刻；空 = 从未学过） */
  streakLastDate?: Date | null;
  /** 历史最长连续天数 */
  longestStreak: number;
}

export interface StreakAdvance {
  /** 今天是否要改写快照（同一天重复完成不重复计数） */
  changed: boolean;
  /** 新的连续天数 */
  streakDays: number;
  /** 新的最长连续 */
  longestStreak: number;
  /** 写回库里的「上次学习日」（绝对时刻，取今天） */
  streakLastDate: Date;
}

/**
 * 完成一次学习后推进连续天数。
 *
 * 规则（与抽取前逐字一致）：
 * - 同一天（应用时区本地日）再次完成 → 不改写，天数不变（幂等）。
 * - 从未学过（无 lastDate）→ 从 1 开始。
 * - 上次是「昨天」（本地日差 1）→ 天数 +1。
 * - 上次更早（差 ≥2，含跨月/跨年）→ 重新从 1 开始。
 * - longestStreak 取 max(新天数, 原最长)。
 */
export function advanceStreak(snapshot: StreakSnapshot, asOf: Date): StreakAdvance {
  const todayStr = dayKeyOf(asOf);
  const lastDate = snapshot.streakLastDate ? dayKeyOf(snapshot.streakLastDate) : undefined;

  if (lastDate === todayStr) {
    return {
      changed: false,
      streakDays: snapshot.streakDays,
      longestStreak: snapshot.longestStreak,
      streakLastDate: asOf,
    };
  }

  let newStreak: number;
  if (!lastDate) {
    newStreak = 1;
  } else {
    const diffDays = dayDiffInDays(parseDayKeyStart(lastDate), parseDayKeyStart(todayStr));
    newStreak = diffDays === 1 ? snapshot.streakDays + 1 : 1;
  }

  return {
    changed: true,
    streakDays: newStreak,
    longestStreak: Math.max(newStreak, snapshot.longestStreak),
    streakLastDate: asOf,
  };
}