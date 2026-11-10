/**
 * 概念掌握度唯一口径（2026-11-09 画像链路核查）
 *
 * 回归目标：画像与概念图谱必须对同一概念给出同一个数。
 * 旧实现里画像取「最近一条有业务时间的证据」，图谱取「所有痕迹的最大值」——
 * 一个概念曾经掌握、后来退化成 fragile 时，两页会长期不一致。
 */
import { pickLatestMasterySignal, resolveMasteryScore } from '../concept-mastery';

describe('resolveMasteryScore：业务时间最新优先', () => {
  it('最新一条覆盖更早的高分（曾经掌握、后来退化 → 取当前状态）', () => {
    const signals = [
      { masteryScore: 0.95, seenAt: '2026-10-01T00:00:00.000Z' },
      { masteryScore: 0.2, seenAt: '2026-11-01T00:00:00.000Z' },
    ];
    expect(resolveMasteryScore(signals)).toBeCloseTo(0.2, 5);
  });

  it('数组顺序不影响结果（不依赖遍历顺序）', () => {
    const a = { masteryScore: 0.1, seenAt: '2026-09-01T00:00:00.000Z' };
    const b = { masteryScore: 0.9, seenAt: '2026-09-02T00:00:00.000Z' };
    expect(resolveMasteryScore([a, b])).toBeCloseTo(0.9, 5);
    expect(resolveMasteryScore([b, a])).toBeCloseTo(0.9, 5);
  });

  it('全部无时间戳（旧数据/测试桩）→ 退回等权均值，行为与历史口径一致', () => {
    expect(resolveMasteryScore([
      { masteryScore: 0.4 },
      { masteryScore: 1.0 },
    ])).toBeCloseTo(0.7, 5);
  });

  it('部分有、部分无时间戳 → 只按有时间戳的最新一条', () => {
    expect(resolveMasteryScore([
      { masteryScore: 0.1, seenAt: '2026-01-01T00:00:00.000Z' },
      { masteryScore: 0.9, seenAt: '2026-02-01T00:00:00.000Z' },
      { masteryScore: 0.5 },
    ])).toBeCloseTo(0.9, 5);
  });

  it('忽略非数值分数；空集合返回 0', () => {
    expect(resolveMasteryScore([
      { masteryScore: Number.NaN, seenAt: '2026-01-01T00:00:00.000Z' },
      { masteryScore: 0.6, seenAt: '2026-02-01T00:00:00.000Z' },
    ])).toBeCloseTo(0.6, 5);
    expect(resolveMasteryScore([])).toBe(0);
  });

  it('结果夹在 0–1（越界输入不放大）', () => {
    expect(resolveMasteryScore([{ masteryScore: 1.7, seenAt: '2026-01-01T00:00:00.000Z' }])).toBe(1);
    expect(resolveMasteryScore([{ masteryScore: -0.3, seenAt: '2026-01-01T00:00:00.000Z' }])).toBe(0);
  });
});

describe('pickLatestMasterySignal：时间并列取先入者', () => {
  it('同一时间戳 → 稳定返回数组里的第一条', () => {
    const first = { id: 'first', masteryScore: 0.3, seenAt: '2026-01-01T00:00:00.000Z' };
    const second = { id: 'second', masteryScore: 0.8, seenAt: '2026-01-01T00:00:00.000Z' };
    expect(pickLatestMasterySignal([first, second])?.id).toBe('first');
  });

  it('接受 Date 与字符串两种时间形态', () => {
    const older = { id: 'older', masteryScore: 0.9, seenAt: new Date('2026-01-01T00:00:00.000Z') };
    const newer = { id: 'newer', masteryScore: 0.2, seenAt: '2026-03-01T00:00:00.000Z' };
    expect(pickLatestMasterySignal([older, newer])?.id).toBe('newer');
  });

  it('无可用时间戳 → null（调用方走均值回退）', () => {
    expect(pickLatestMasterySignal([{ masteryScore: 0.5 }])).toBeNull();
  });
});
