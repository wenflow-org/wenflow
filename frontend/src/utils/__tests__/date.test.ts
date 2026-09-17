/**
 * 本地日期键口径回归（2026-09-18 走查发现：学习历史把刚上完的课归到「昨天」）。
 *
 * 这类 bug 只出现在「本地日期 ≠ UTC 日期」的时段（UTC+8 的 00:00–08:00），
 * 所以断言不写死某个时区，而是用「本地时间构造 → 本地日期键」的往返不变量：
 * 只要实现里出现 `toISOString().slice(0,10)` 这类 UTC 切片，往返就会在跨时区时断裂。
 */
import { describe, expect, it } from 'vitest';
import { localDateKey, localDateKeyFromIso } from '../date';

describe('utils/date（本地日期键）', () => {
  it('localDateKey 用本地年月日（不补时区偏移）', () => {
    expect(localDateKey(new Date(2026, 8, 18, 0, 11, 34))).toBe('2026-09-18');
    expect(localDateKey(new Date(2026, 0, 5, 23, 59, 59))).toBe('2026-01-05');
    expect(localDateKey(new Date(2025, 11, 31, 12, 0, 0))).toBe('2025-12-31');
  });

  it('ISO 时间戳 → 本地日期键：往返必须回到同一个本地日期', () => {
    // 本地凌晨（最容易与 UTC 切日错开一天的时段）
    const lateNight = new Date(2026, 8, 18, 0, 11, 34);
    expect(localDateKeyFromIso(lateNight.toISOString())).toBe('2026-09-18');
    // 本地深夜
    const nearMidnight = new Date(2026, 8, 18, 23, 50, 0);
    expect(localDateKeyFromIso(nearMidnight.toISOString())).toBe('2026-09-18');
  });

  it('空值/非法值返回空串（调用方据此跳过该条）', () => {
    expect(localDateKeyFromIso(null)).toBe('');
    expect(localDateKeyFromIso(undefined)).toBe('');
    expect(localDateKeyFromIso('')).toBe('');
    expect(localDateKeyFromIso('not-a-date')).toBe('');
  });
});
