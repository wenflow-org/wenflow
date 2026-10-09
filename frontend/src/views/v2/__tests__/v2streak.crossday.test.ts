/**
 * 跨日连续学习天数回归（2026-10-07）。
 *
 * 为什么单独锁这个函数：`computeStreakDays` 是全站「连续 N 天」的唯一口径
 * （学习台 / 学习状态 / 账户页三处消费，见 streak.ts 文件头），但它此前**没有任何测试**——
 * 而它整段逻辑都在日界上：今天没学要从昨天数、断档要归零、跨月跨年要连续、闰年 2/29 不能算断。
 * 学习系统里这几条每天都会被走到，错了会直接显示成「我明明天天学，连续天数却断了」。
 *
 * 测试全部用「本地时间构造 → 本地日期键」的往返不变量，不写死时区：
 * 只要实现里混进 `toISOString().slice(0,10)` 这类 UTC 切日，UTC+8 的 00:00–08:00 就会断档，
 * 下面「跨日宽限」与「凌晨连续」两组会立刻失败（与 utils/date 的既有护栏同一手法）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeStreakDays } from '../streak';

/** 把「当前时刻」钉在某天某点，用于驱动 computeStreakDays 里那个 new Date() */
function freezeAt(y: number, m: number, d: number, h = 12, min = 0) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(y, m - 1, d, h, min, 0, 0));
}

/**
 * 本地日期键——**故意不调用被测链路上的 localDateKey**。
 * 若两边都用被测实现，实现一旦退化成 UTC 切日，构造的键和函数里算的「今天」会一起前移，
 * 测试仍然全绿（这就是「测试与被测同错」）。这里自己格式化，测出来的差异才是真的差异。
 */
function localKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 从「今天」往回第 n 天（本地）的日期键；n=0 是今天 */
function dayKeyBefore(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localKey(d);
}

/** 用「往回第几天」列表构造 minutesByDate */
function minutes(...daysAgo: number[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const n of daysAgo) m.set(dayKeyBefore(n), 30);
  return m;
}

beforeEach(() => vi.useRealTimers());
afterEach(() => vi.useRealTimers());

describe('computeStreakDays 跨日口径', () => {
  it('空数据 → 0', () => {
    expect(computeStreakDays(new Map())).toBe(0);
  });

  it('只有今天学了 → 1', () => {
    expect(computeStreakDays(minutes(0))).toBe(1);
  });

  it('今天没学但昨天学了 → 仍算连续（当天的宽限，还没到零点就不算断）', () => {
    expect(computeStreakDays(minutes(1))).toBe(1);
    expect(computeStreakDays(minutes(1, 2))).toBe(2);
    expect(computeStreakDays(minutes(1, 2, 3))).toBe(3);
  });

  it('今天学了且昨天学了 → 累加', () => {
    expect(computeStreakDays(minutes(0, 1, 2))).toBe(3);
  });

  it('断档归零：前天有、昨天没有 → 只从今天起算', () => {
    expect(computeStreakDays(minutes(0, 2))).toBe(1);
    // 今天也没学、昨天也没有 → 0
    expect(computeStreakDays(minutes(2, 3))).toBe(0);
  });

  it('分钟为 0 的一天等同没学（0 分不算连续）', () => {
    const m = new Map<string, number>([
      [dayKeyBefore(0), 25],
      [dayKeyBefore(1), 0],
      [dayKeyBefore(2), 40],
    ]);
    expect(computeStreakDays(m)).toBe(1);
  });

  it('跨月连续：月末连到月初不断档', () => {
    freezeAt(2026, 11, 1, 12); // 11/1 周日
    const m = new Map<string, number>([
      ['2026-11-01', 20], ['2026-10-31', 20], ['2026-10-30', 20], ['2026-10-29', 20],
    ]);
    expect(computeStreakDays(m)).toBe(4);
  });

  it('跨年连续：12/31 → 1/1 不断档', () => {
    freezeAt(2026, 1, 1, 12); // 元旦当天
    const m = new Map<string, number>([
      ['2026-01-01', 20], ['2025-12-31', 20], ['2025-12-30', 20],
    ]);
    expect(computeStreakDays(m)).toBe(3);
  });

  it('闰年 2/29 算作正常一天，不因不存在的 2/30 断档', () => {
    freezeAt(2028, 3, 1, 12); // 2028 是闰年，3/1 往前是 2/29
    const m = new Map<string, number>([
      ['2028-03-01', 20], ['2028-02-29', 20], ['2028-02-28', 20],
    ]);
    expect(computeStreakDays(m)).toBe(3);
  });

  it('本地凌晨学习算当天，不因 UTC 切日被算进昨天（UTC+8 00:00–08:00 档）', () => {
    // 本地 00:11 学习：本地日期键必须是「今天」
    freezeAt(2026, 10, 7, 0, 11);
    // 键由测试自己按本地年月日写死，不走被测实现——若函数内部改用 UTC 切日，
    // 它会去找 2026-10-06 这一格（本地 00:11 在 UTC 还是 10/6），这条立刻失败
    const todayOnly = new Map<string, number>([['2026-10-07', 30]]);
    expect(computeStreakDays(todayOnly)).toBe(1);

    // 今天（本地 10/7 凌晨）与昨天都有：必须数成 2
    const twoDays = new Map<string, number>([
      ['2026-10-07', 30],
      ['2026-10-06', 30],
    ]);
    expect(computeStreakDays(twoDays)).toBe(2);

    // 反证：把分钟只挂在 UTC 会认的「昨天」上，本地口径下今天就等于没学 → 只能是 1
    const utcShifted = new Map<string, number>([['2026-10-06', 30]]);
    expect(computeStreakDays(utcShifted)).toBe(1);
  });

  it('本地深夜学习算当天（23:59 不越到次日）', () => {
    freezeAt(2026, 10, 7, 23, 59);
    const m = new Map<string, number>([
      ['2026-10-07', 30], ['2026-10-06', 30],
    ]);
    expect(computeStreakDays(m)).toBe(2);
  });

  it('跨零点前后各学一次 = 两天连续（不是一天）', () => {
    // 10/6 23:50 与 10/7 00:10 两次学习：本地口径下属于两个不同的日子
    freezeAt(2026, 10, 7, 0, 20);
    const m = new Map<string, number>([
      ['2026-10-07', 15], ['2026-10-06', 15],
    ]);
    expect(computeStreakDays(m)).toBe(2);
  });

  it('长连续（90 天）能一路数到底', () => {
    const days: number[] = [];
    for (let i = 0; i < 90; i++) days.push(i);
    expect(computeStreakDays(minutes(...days))).toBe(90);
  });

  it('未来日期不参与计数（时钟偏差不虚增连续天数）', () => {
    freezeAt(2026, 10, 7, 12);
    const m = new Map<string, number>([
      [dayKeyBefore(0), 30],
      [dayKeyBefore(-1), 30], // 明天（数据里不该有，但真出现了也不能算）
    ]);
    expect(computeStreakDays(m)).toBe(1);
  });
});