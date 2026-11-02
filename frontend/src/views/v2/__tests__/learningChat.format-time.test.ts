/**
 * 气泡时间标签：必须用后端时间戳，不能一律 nowTime()（2026-10-31 用户走查 P1-2）。
 *
 * 事故原貌：课堂刷新后 7 条消息（真实 04:23→05:05，跨 42 分钟）全部显示 05:09，
 * 也就是刷新那一刻的钟点；消息之间的真实间隔被抹平，且 05:09 不等于任何一条消息的时间。
 */
import { describe, expect, it } from 'vitest';
import { formatMsgTime } from '../learningChat';

describe('formatMsgTime：气泡时间标签的口径', () => {
  it('后端 ISO 时间戳 → 本地 HH:mm（不是当前时刻）', () => {
    // 用本地时间构造再转 ISO，避免测试依赖机器时区
    const local = new Date(2026, 9, 31, 20, 23, 15);
    expect(formatMsgTime(local.toISOString())).toBe('20:23');
  });

  it('已经是 HH:mm 的字符串原样保留', () => {
    expect(formatMsgTime('05:09')).toBe('05:09');
  });

  it('拿不到时间戳时才退回当前时刻（形状仍是 HH:mm）', () => {
    expect(formatMsgTime(undefined)).toMatch(/^\d{2}:\d{2}$/);
    expect(formatMsgTime('')).toMatch(/^\d{2}:\d{2}$/);
  });

  it('回归点：同一会话的两条不同时刻必须显示成两个值', () => {
    const a = new Date(2026, 9, 31, 20, 23, 15).toISOString();
    const b = new Date(2026, 9, 31, 21, 5, 57).toISOString();
    expect(formatMsgTime(a)).toBe('20:23');
    expect(formatMsgTime(b)).toBe('21:05');
  });
});
