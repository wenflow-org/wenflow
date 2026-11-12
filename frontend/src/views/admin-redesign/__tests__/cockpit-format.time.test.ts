/**
 * 会话座舱时间口径（2026-11-11 全站审计）：
 * 头部「开始于」与右侧会话日志必须同一套绝对时间 `YYYY-MM-DD HH:mm`，
 * 不得再出现 `2026/11/11 18:32:59`（toLocaleString）或 `11-09 23:53:47`（缺年份的日志短格式）。
 */
import { describe, expect, it } from 'vitest';
import { conversationMessages, formatLogTime, formatTime } from '../cockpitFormat';

/** 用本地时刻构造，避免用例依赖运行机器时区 */
function localIso(y: number, m: number, d: number, h: number, min: number, s = 0): string {
  return new Date(y, m - 1, d, h, min, s).toISOString();
}

describe('cockpitFormat 时间口径', () => {
  it('formatTime 输出 YYYY-MM-DD HH:mm（不带斜杠、不带秒）', () => {
    expect(formatTime(localIso(2026, 11, 11, 18, 32, 59))).toBe('2026-11-11 18:32');
    expect(formatTime(localIso(2026, 1, 5, 7, 8))).toBe('2026-01-05 07:08');
  });

  it('formatLogTime 与 formatTime 同口径：跨天不再只给 MM-DD，也不再只给时分秒', () => {
    const stamp = localIso(2026, 11, 9, 23, 53, 47);
    expect(formatLogTime(stamp)).toBe('2026-11-09 23:53');
    expect(formatLogTime(stamp)).not.toMatch(/^\d{2}-\d{2}/);
    expect(formatLogTime(stamp)).not.toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('空值与非法值不被伪装成时间', () => {
    expect(formatTime('')).toBe('');
    expect(formatLogTime(null)).toBe('');
    expect(formatTime('not-a-date')).toBe('not-a-date');
  });

  it('conversationMessages 保留每条消息的原始时间（time 优先，兼容 timestamp/createdAt）', () => {
    const rows = conversationMessages([
      { role: 'assistant', content: '老师', time: '2026-11-11T10:33:07.329Z' },
      { role: 'user', content: '学员', timestamp: '2026-11-11T10:33:08.000Z' },
      { role: 'user', content: '老数据', createdAt: '2026-11-09T23:53:47.000Z' },
      { role: 'user', content: '无时间' }
    ]);
    expect(rows.map((r) => r.at)).toEqual([
      '2026-11-11T10:33:07.329Z',
      '2026-11-11T10:33:08.000Z',
      '2026-11-09T23:53:47.000Z',
      ''
    ]);
  });
});
