/**
 * 真实侧时间信号（Q19 真实侧）回归：跨会话「时间维度」。
 *
 * 现象：真实链路已有跨会话内容承接（previousSession / lastLessonRecap），但不带时间——
 * 长间隔回归时教学按"无间隔"处理，与记忆衰减脱节。
 * 修法：由同路径最近一节已完成课的 endTime 算出 daysSinceLastSession/isLongGap，
 * 经 controls.temporalGap 注入 teaching-turn；无前序 → null（字段省略，行为不变）。
 */
import {
  computeTemporalGap,
  resolveTemporalLongGapThresholdDays,
  fetchLatestPriorSessionEndTime,
  DEFAULT_TEMPORAL_LONG_GAP_DAYS,
} from '../TeachingContextBuilder';

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    teaching_sessions: { findFirst: jest.fn() },
  },
}));

const prisma = require('../../../config/database').default as {
  teaching_sessions: { findFirst: jest.Mock };
};

const NOW = new Date('2026-09-19T00:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

describe('computeTemporalGap（间隔/阈值判定，纯函数）', () => {
  it('无前序会话（null/undefined/非法）→ null（省略字段，行为不变）', () => {
    expect(computeTemporalGap(null, NOW)).toBeNull();
    expect(computeTemporalGap(undefined, NOW)).toBeNull();
    expect(computeTemporalGap('not-a-date', NOW)).toBeNull();
  });

  it('默认阈值 14 天：3 天前 → 非长间隔', () => {
    expect(computeTemporalGap(daysAgo(3), NOW)).toEqual({
      daysSinceLastSession: 3,
      isLongGap: false,
    });
  });

  it('默认阈值 14 天：30 天前 → 长间隔', () => {
    expect(computeTemporalGap(daysAgo(30), NOW)).toEqual({
      daysSinceLastSession: 30,
      isLongGap: true,
    });
  });

  it('边界：恰好 14 天视为长间隔（>= 阈值）', () => {
    expect(computeTemporalGap(daysAgo(14), NOW)).toEqual({
      daysSinceLastSession: 14,
      isLongGap: true,
    });
  });

  it('接受 ISO 字符串 endTime', () => {
    expect(computeTemporalGap(daysAgo(3).toISOString(), NOW)?.isLongGap).toBe(false);
  });

  it('时钟漂移（endTime 晚于 now）→ 归零、不产生负数', () => {
    expect(computeTemporalGap(daysAgo(-1), NOW)).toEqual({
      daysSinceLastSession: 0,
      isLongGap: false,
    });
  });

  it('阈值可覆盖（参数优先）；非法阈值回退默认', () => {
    expect(computeTemporalGap(daysAgo(10), NOW, 7)?.isLongGap).toBe(true);
    expect(computeTemporalGap(daysAgo(3), NOW, 7)?.isLongGap).toBe(false);
    expect(computeTemporalGap(daysAgo(10), NOW, 0)?.isLongGap).toBe(false);
    expect(computeTemporalGap(daysAgo(14), NOW, Number.NaN)?.isLongGap).toBe(true);
  });

  it('天数保留 1 位小数', () => {
    const gap = computeTemporalGap(new Date(NOW.getTime() - 3.5 * 24 * 60 * 60 * 1000), NOW);
    expect(gap?.daysSinceLastSession).toBe(3.5);
  });
});

describe('resolveTemporalLongGapThresholdDays（env 覆盖）', () => {
  it('缺失/空/非法/非正 → 默认 14', () => {
    expect(DEFAULT_TEMPORAL_LONG_GAP_DAYS).toBe(14);
    expect(resolveTemporalLongGapThresholdDays(undefined)).toBe(14);
    expect(resolveTemporalLongGapThresholdDays(null)).toBe(14);
    expect(resolveTemporalLongGapThresholdDays('')).toBe(14);
    expect(resolveTemporalLongGapThresholdDays('abc')).toBe(14);
    expect(resolveTemporalLongGapThresholdDays('0')).toBe(14);
    expect(resolveTemporalLongGapThresholdDays('-3')).toBe(14);
  });

  it('合法数值 → 覆盖', () => {
    expect(resolveTemporalLongGapThresholdDays('30')).toBe(30);
    expect(resolveTemporalLongGapThresholdDays('7.5')).toBe(7.5);
  });
});

describe('fetchLatestPriorSessionEndTime（同路径最近已完成课的 endTime）', () => {
  beforeEach(() => {
    prisma.teaching_sessions.findFirst.mockReset();
  });

  it('返回最近完成课的 endTime，并把当前会话排除条件传入 where', async () => {
    const endTime = daysAgo(5);
    prisma.teaching_sessions.findFirst.mockResolvedValue({ endTime });

    const result = await fetchLatestPriorSessionEndTime({
      userId: 'user-1',
      learningPathId: 'path-1',
      excludeSessionId: 'sess-current',
    });

    expect(result).toBe(endTime);
    const arg = prisma.teaching_sessions.findFirst.mock.calls[0][0];
    expect(arg.where).toMatchObject({
      userId: 'user-1',
      learningPathId: 'path-1',
      status: 'completed',
      id: { not: 'sess-current' },
    });
    expect(arg.orderBy).toEqual({ endTime: 'desc' });
  });

  it('无 excludeSessionId 时不加 id 排除条件', async () => {
    prisma.teaching_sessions.findFirst.mockResolvedValue(null);
    await fetchLatestPriorSessionEndTime({ userId: 'user-1', learningPathId: 'path-1' });
    const arg = prisma.teaching_sessions.findFirst.mock.calls[0][0];
    expect(arg.where.id).toBeUndefined();
  });

  it('无前序 → null；查询异常 → 静默 null', async () => {
    prisma.teaching_sessions.findFirst.mockResolvedValue(null);
    await expect(fetchLatestPriorSessionEndTime({ userId: 'u', learningPathId: 'p' })).resolves.toBeNull();

    prisma.teaching_sessions.findFirst.mockRejectedValue(new Error('db down'));
    await expect(fetchLatestPriorSessionEndTime({ userId: 'u', learningPathId: 'p' })).resolves.toBeNull();
  });
});
