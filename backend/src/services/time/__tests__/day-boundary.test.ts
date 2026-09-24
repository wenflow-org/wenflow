/**
 * day-boundary（日界单一真理源）契约测试
 *
 * 口径：所有"按天归组/比较"走**应用时区本地日**（默认 Asia/Shanghai），不用 UTC 切日、
 * 也不用服务器机器本地日。本文件同时锁定"显式时区参数 ⇒ 结果与机器时区无关"。
 */
import {
  DEFAULT_APP_TIME_ZONE,
  getAppTimeZone,
  normalizeTimeZone,
  setAppTimeZone,
  dayKeyOf,
  hourKeyOf,
  parseDayKeyStart,
  startOfDay,
  endOfDay,
  dayDiffInDays,
  formatLocal,
  DAY_BOUNDARY_DAY_MS,
} from '../day-boundary';

const SH = 'Asia/Shanghai';
const NY = 'America/New_York';

describe('day-boundary：日界口径', () => {
  it('默认应用时区是 Asia/Shanghai（可由平台设置覆盖）', () => {
    expect(DEFAULT_APP_TIME_ZONE).toBe('Asia/Shanghai');
    expect(getAppTimeZone()).toBe(DEFAULT_APP_TIME_ZONE);
  });

  it('dayKeyOf：同一瞬时在不同时区归属不同日（UTC+8 下 16:00Z 已是次日）', () => {
    const at = new Date('2026-09-16T16:00:00Z');
    expect(dayKeyOf(at, SH)).toBe('2026-09-17');
    expect(dayKeyOf(at, 'UTC')).toBe('2026-09-16');
    expect(dayKeyOf(new Date('2026-09-16T15:59:59.999Z'), SH)).toBe('2026-09-16');
  });

  it('startOfDay/endOfDay：覆盖本地整日，且相邻日首尾相接', () => {
    const at = new Date('2026-09-16T10:00:00Z'); // 本地 18:00
    const start = startOfDay(at, SH);
    const end = endOfDay(at, SH);
    expect(start.toISOString()).toBe('2026-09-15T16:00:00.000Z'); // 本地 09-16 00:00
    expect(end.toISOString()).toBe('2026-09-16T15:59:59.999Z');
    expect(dayKeyOf(end, SH)).toBe('2026-09-16');
    expect(dayKeyOf(new Date(end.getTime() + 1), SH)).toBe('2026-09-17');
    expect(startOfDay(new Date(end.getTime() + 1), SH).getTime()).toBe(end.getTime() + 1);
  });

  it('parseDayKeyStart ↔ dayKeyOf 往返一致（多时区）', () => {
    for (const tz of [SH, 'UTC', NY]) {
      for (const key of ['2026-01-01', '2026-06-15', '2026-12-31']) {
        expect(dayKeyOf(parseDayKeyStart(key, tz), tz)).toBe(key);
      }
    }
  });

  it('DST：夏令时切换日的本地日长不是 24h（America/New_York 2026-03-08 为 23h）', () => {
    const start = parseDayKeyStart('2026-03-08', NY);
    const nextStart = parseDayKeyStart('2026-03-09', NY);
    expect((nextStart.getTime() - start.getTime()) / 3600000).toBe(23);
    // endOfDay 仍落在同一天内（不越界到次日）
    expect(dayKeyOf(endOfDay(start, NY), NY)).toBe('2026-03-08');
  });

  it('dayDiffInDays：按本地日差，且负差钳到 0', () => {
    const a = new Date('2026-09-15T20:00:00Z'); // 本地 09-16 04:00
    const b = new Date('2026-09-16T20:00:00Z'); // 本地 09-17 04:00
    expect(dayDiffInDays(a, b, SH)).toBe(1);
    expect(dayDiffInDays(a, b, 'UTC')).toBe(1);
    expect(dayDiffInDays(b, a, SH)).toBe(0);
    // 跨 3 个本地日
    expect(dayDiffInDays(new Date('2026-09-13T20:00:00Z'), b, SH)).toBe(3);
  });

  it('formatLocal：展示用本地可读时间', () => {
    expect(formatLocal(new Date('2026-09-15T16:00:00Z'), SH)).toContain('2026/09/16');
    expect(formatLocal(new Date('2026-09-15T16:00:00Z'), SH)).toContain('00:00');
  });

  it('时区名校验：非法值被拒绝，不静默换口径', () => {
    expect(normalizeTimeZone('Asia/Shanghai')).toBe('Asia/Shanghai');
    expect(normalizeTimeZone('Not/AZone')).toBeNull();
    expect(normalizeTimeZone('')).toBeNull();
    expect(setAppTimeZone('Not/AZone')).toBe(false);
    expect(getAppTimeZone()).toBe(DEFAULT_APP_TIME_ZONE); // 未被非法值污染
    expect(() => dayKeyOf(new Date(), 'Not/AZone')).toThrow();
  });

  it('脏数据容错：非法日期返回空键（落不进任何桶），不抛错', () => {
    const bad = new Date('not-a-date');
    expect(dayKeyOf(bad)).toBe('');
    expect(hourKeyOf(bad)).toBe('');
    expect(dayKeyOf(new Date(NaN))).toBe('');
  });

  it('应用时区可切换（平台设置用），切回默认不影响显式传参的调用', () => {
    try {
      expect(setAppTimeZone('UTC')).toBe(true);
      expect(getAppTimeZone()).toBe('UTC');
      expect(dayKeyOf(new Date('2026-09-16T20:00:00Z'))).toBe('2026-09-16'); // 跟随应用时区
      expect(dayKeyOf(new Date('2026-09-16T20:00:00Z'), SH)).toBe('2026-09-17'); // 显式参数不受影响
    } finally {
      setAppTimeZone(DEFAULT_APP_TIME_ZONE);
    }
    expect(getAppTimeZone()).toBe(DEFAULT_APP_TIME_ZONE);
  });

  it('DAY_BOUNDARY_DAY_MS 与本地日界的配合（endOfDay = start + 24h - 1ms，非 DST 日）', () => {
    const start = startOfDay(new Date('2026-09-16T10:00:00Z'), SH);
    expect(endOfDay(new Date('2026-09-16T10:00:00Z'), SH).getTime()).toBe(start.getTime() + DAY_BOUNDARY_DAY_MS - 1);
  });
});
