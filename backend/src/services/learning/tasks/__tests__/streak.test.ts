/**
 * 后端连续学习天数推进规则回归（2026-10-07）。
 *
 * 这段规则原先内联在 task-completion.service 的大 try 块里，整段逻辑都在日界上却无测试。
 * 现抽为 ./streak.ts 的纯函数，这里锁住它的分支：同日幂等 / 首次从 1 起 / 昨天 +1 /
 * 更早归 1 / 跨月 / 跨年 / 闰日 / 本地凌晨，以及 longestStreak 的刷新。
 *
 * **构造绝对时刻不用被测实现**：Asia/Shanghai 无夏令时，固定 +08:00，
 * 直接由 UTC 时刻算出（`localInstant`）。若哪天有人把日界换成 UTC 切日，
 * 「本地凌晨」那组会立刻失败——用 `parseDayKeyStart` 构造的话两边会一起偏移，测试就白写了。
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { advanceStreak } from '../streak';
import { dayKeyOf, getAppTimeZone, setAppTimeZone } from '../../../time/day-boundary';

const TZ = 'Asia/Shanghai';
const OFFSET_MS = 8 * 3_600_000; // Asia/Shanghai 全年 UTC+8，无 DST

/** 应用时区（UTC+8）下某天某点的绝对时刻——只做算术，不调被测的日界函数 */
function localInstant(y: number, m: number, d: number, h = 12, min = 0): Date {
  return new Date(Date.UTC(y, m - 1, d, h, min) - OFFSET_MS);
}

let originalTz = '';
beforeAll(() => {
  originalTz = getAppTimeZone();
  setAppTimeZone(TZ);
});
afterAll(() => setAppTimeZone(originalTz));

describe('advanceStreak：连续天数推进规则', () => {
  it('从未学过 → 从 1 开始，并记下今天', () => {
    const r = advanceStreak({ streakDays: 0, streakLastDate: null, longestStreak: 0 }, localInstant(2026, 10, 7));
    expect(r.changed).toBe(true);
    expect(r.streakDays).toBe(1);
    expect(r.longestStreak).toBe(1);
    expect(dayKeyOf(r.streakLastDate)).toBe('2026-10-07');
  });

  it('同一天重复完成 → 幂等：天数不变、不写库', () => {
    const r = advanceStreak(
      { streakDays: 4, streakLastDate: localInstant(2026, 10, 7, 8), longestStreak: 9 },
      localInstant(2026, 10, 7, 22),
    );
    expect(r.changed).toBe(false);
    expect(r.streakDays).toBe(4);
    expect(r.longestStreak).toBe(9);
  });

  it('上次是昨天 → 天数 +1', () => {
    const r = advanceStreak(
      { streakDays: 4, streakLastDate: localInstant(2026, 10, 6), longestStreak: 9 },
      localInstant(2026, 10, 7),
    );
    expect(r.changed).toBe(true);
    expect(r.streakDays).toBe(5);
    expect(r.longestStreak).toBe(9); // 未超过历史最长
  });

  it('断档（隔 ≥2 天）→ 归 1，历史最长保留', () => {
    const r = advanceStreak(
      { streakDays: 30, streakLastDate: localInstant(2026, 10, 4), longestStreak: 30 },
      localInstant(2026, 10, 7),
    );
    expect(r.streakDays).toBe(1);
    expect(r.longestStreak).toBe(30);
  });

  it('刷新纪录时 longestStreak 跟着涨', () => {
    const r = advanceStreak(
      { streakDays: 9, streakLastDate: localInstant(2026, 10, 6), longestStreak: 9 },
      localInstant(2026, 10, 7),
    );
    expect(r.streakDays).toBe(10);
    expect(r.longestStreak).toBe(10);
  });

  it('跨月：月末 → 月初算连续（不是断档）', () => {
    const r = advanceStreak(
      { streakDays: 7, streakLastDate: localInstant(2026, 10, 31), longestStreak: 7 },
      localInstant(2026, 11, 1),
    );
    expect(r.streakDays).toBe(8);
  });

  it('跨年：12/31 → 1/1 算连续', () => {
    const r = advanceStreak(
      { streakDays: 3, streakLastDate: localInstant(2025, 12, 31), longestStreak: 3 },
      localInstant(2026, 1, 1),
    );
    expect(r.streakDays).toBe(4);
  });

  it('闰日：2/29 → 3/1 算连续', () => {
    const r = advanceStreak(
      { streakDays: 2, streakLastDate: localInstant(2028, 2, 29), longestStreak: 2 },
      localInstant(2028, 3, 1),
    );
    expect(r.streakDays).toBe(3);
  });

  it('本地凌晨完成算当天：UTC+8 的 00:30 不能被判成「昨天已学」', () => {
    // 本地 10/7 00:30（= 10/6 16:30Z），上次本地 10/6
    // 若日界退化成 UTC 切日：今天会算成 10/6，与 lastDate 同日 → changed=false，这条失败
    const r = advanceStreak(
      { streakDays: 5, streakLastDate: localInstant(2026, 10, 6), longestStreak: 5 },
      localInstant(2026, 10, 7, 0, 30),
    );
    expect(r.changed).toBe(true);
    expect(r.streakDays).toBe(6);
    expect(dayKeyOf(r.streakLastDate)).toBe('2026-10-07');
  });

  it('同一天两次完成（凌晨一次 + 晚上一次）只算一天', () => {
    const first = advanceStreak(
      { streakDays: 5, streakLastDate: localInstant(2026, 10, 6), longestStreak: 5 },
      localInstant(2026, 10, 7, 0, 30),
    );
    const second = advanceStreak(
      {
        streakDays: first.streakDays,
        streakLastDate: first.streakLastDate,
        longestStreak: first.longestStreak,
      },
      localInstant(2026, 10, 7, 23, 30),
    );
    expect(first.streakDays).toBe(6);
    expect(second.changed).toBe(false);
    expect(second.streakDays).toBe(6);
  });
});