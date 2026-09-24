/**
 * 学习状态的**跨天恢复**：自然衰减的精确值 + "恢复窗口"（几天后阈值不再触发）
 *
 * 日界口径（2026-09-22 拍板，见 services/time/day-boundary）：所有"按天"判断走**应用时区
 * 本地日**（默认 Asia/Shanghai），不用 UTC 切日、也不用服务器机器本地日。因此本文件的
 * 期望值全部用 day-boundary 的 helper 构造——口径是显式的，机器在哪个时区都一样。
 */
import learningStateService from '../learning-state.service';
import { runWithSimulatedClock } from '../../virtual-lab/simulation-clock-context';
import { getAppTimeZone, dayKeyOf, startOfDay, dayDiffInDays, DAY_BOUNDARY_DAY_MS } from '../../time/day-boundary';

/** 本地日 + 小时 → 绝对时刻（例：localAt('2026-08-01', 9) = 本地 08-01 09:00） */
const localAt = (dayKey: string, hour: number) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey)!;
  const midnight = startOfDay(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)));
  return new Date(midnight.getTime() + hour * 3600 * 1000);
};

const state = {
  lss: 7.2,
  ktl: 3.7,
  lf: 2.4,
  lsb: 1.3,
  timestamp: localAt('2026-08-01', 9),
};

describe('自然衰减（restoreMetrics）', () => {
  it('同一天不衰减（日差按**应用时区本地日**，与配额/当日课量/日模拟同口径）', () => {
    const same = learningStateService.restoreMetrics(state, localAt('2026-08-01', 20));
    expect(same.lss).toBeCloseTo(7.2, 6);
    expect(same.ktl).toBeCloseTo(3.7, 6);
    expect(same.lf).toBeCloseTo(2.4, 6);
  });

  it('跨本地日界即算一天（本地 23:59 → 次日 00:01）', () => {
    const beforeMidnight = localAt('2026-08-01', 23);
    const afterMidnight = new Date(localAt('2026-08-02', 0).getTime() + 60 * 1000);
    expect(dayDiffInDays(beforeMidnight, afterMidnight)).toBe(1);
    expect(learningStateService.restoreMetrics({ ...state, timestamp: beforeMidnight }, afterMidnight).lss)
      .toBeCloseTo(7.2 * 0.82, 6);
  });

  it('LSS ×0.82^d、KTL ×0.99^d、LF 向基线 1.2 回落（×0.74^d）', () => {
    const days = dayDiffInDays(state.timestamp, localAt('2026-08-04', 9));
    expect(days).toBe(3);
    const decayed = learningStateService.restoreMetrics(state, localAt('2026-08-04', 9));
    expect(decayed.lss).toBeCloseTo(7.2 * 0.82 ** days, 6);
    expect(decayed.ktl).toBeCloseTo(3.7 * 0.99 ** days, 6);
    expect(decayed.lf).toBeCloseTo(1.2 + (2.4 - 1.2) * 0.74 ** days, 6);
  });

  it('LF 收敛到基线而不是归零（"休息够了仍有一点负荷"）', () => {
    const far = learningStateService.restoreMetrics(state, localAt('2026-10-30', 9));
    expect(far.lf).toBeCloseTo(1.2, 3);
    expect(far.lss).toBeLessThan(0.01);          // 单课压力可以归零
    expect(far.ktl).toBeGreaterThan(0);          // 训练负荷衰减慢（0.99/天）
    expect(far.lsb).toBeCloseTo(far.ktl - far.lf, 6);
  });

  it('恢复窗口：高疲劳与高单课压力都是"隔一天就出阈值"（但疲劳留尾、压力几乎清空）', () => {
    const nextDay = localAt('2026-08-02', 9);

    const tired = { ...state, lf: 7 };
    expect(tired.lf).toBeGreaterThanOrEqual(6);                                   // 当天：判"该慢下来"
    expect(learningStateService.restoreMetrics(tired, nextDay).lf).toBeLessThan(6); // 隔天：不再判慢
    expect(learningStateService.restoreMetrics(tired, nextDay).lf).toBeGreaterThan(5); // 但仍在基线之上（留尾）

    const stressed = { ...state, lss: 7.2 };
    expect(stressed.lss).toBeGreaterThanOrEqual(6);                                // 当天：课内压力高
    const decayedLss = learningStateService.restoreMetrics(stressed, nextDay).lss;
    expect(decayedLss).toBeLessThan(6);                                            // 隔天：出阈值
    expect(decayedLss).toBeGreaterThan(5);                                         // 只降一档（0.82/天）
  });

  it('日界由**显式时区**决定，与机器时区无关（同一瞬时在不同 tz 下归属不同日）', () => {
    // 2026-08-01T20:00Z：Asia/Shanghai 是 08-02 04:00（次日），UTC 还是 08-01
    const instant = new Date('2026-08-01T20:00:00Z');
    expect(dayKeyOf(instant, 'Asia/Shanghai')).toBe('2026-08-02');
    expect(dayKeyOf(instant, 'UTC')).toBe('2026-08-01');
    // 默认走应用时区（Asia/Shanghai）：与显式传入一致 ⇒ 口径不依赖机器
    expect(dayKeyOf(instant)).toBe(dayKeyOf(instant, getAppTimeZone()));
    expect(dayDiffInDays(state.timestamp, instant, 'Asia/Shanghai')).toBe(1);
    expect(dayDiffInDays(state.timestamp, instant, 'UTC')).toBe(0);
  });

  it('train 负荷衰减明显慢于压力/疲劳（这是"知识练过就留得住"的口径）', () => {
    const d = 10;
    const decayed = learningStateService.restoreMetrics(state, localAt('2026-08-11', 9));
    const ktlRatio = decayed.ktl / 3.7;
    const lssRatio = decayed.lss / 7.2;
    const lfRatio = (decayed.lf - 1.2) / (2.4 - 1.2);
    expect(ktlRatio).toBeGreaterThan(lssRatio);
    expect(ktlRatio).toBeGreaterThan(lfRatio);
    expect(ktlRatio).toBeCloseTo(0.99 ** d, 6);
  });
});

describe('自然衰减的时钟域（模拟日 vs 真实墙钟）', () => {
  it('模拟时钟内：缺省 asOf 走**模拟日**——跨日模拟的隔日恢复不再按真实墙钟差计算', () => {
    // 08-01 的课，模拟推进到 08-03（2 个本地日）。此前读取侧用真实 new Date()：
    // 模拟推进只隔几十真实秒 → 日差 0 → 疲劳完全不恢复；baseDate 在过去 → 日差夸张 → 过度恢复。
    const simAsOf = new Date(localAt('2026-08-03', 12).getTime());
    runWithSimulatedClock(simAsOf, () => {
      const decayed = learningStateService.restoreMetrics(state);
      expect(decayed.lss).toBeCloseTo(7.2 * 0.82 ** 2, 6);
      expect(decayed.ktl).toBeCloseTo(3.7 * 0.99 ** 2, 6);
      expect(decayed.lf).toBeCloseTo(1.2 + (2.4 - 1.2) * 0.74 ** 2, 6);
    });
  });

  it('模拟时钟内：coerceMetrics 的缺省时间戳也落在模拟日', () => {
    const simAsOf = new Date('2026-08-03T23:59:59.999Z');
    runWithSimulatedClock(simAsOf, () => {
      const coerced = learningStateService.coerceMetrics({ lss: 4, ktl: 3, lf: 2, lsb: 1 });
      expect(coerced?.timestamp.toISOString()).toBe('2026-08-03T23:59:59.999Z');
    });
  });

  it('续课恢复语义：teachingState 形状的扁平对象按间隔衰减（同日零衰减、隔日出阈值）', () => {
    // 跨日恢复未结课的课时，课内 runtime 值必须按日折算后才是先验（修复前是原样直读）
    const teachingState = { lss: 6.4, ktl: 3.2, lf: 6.2, lsb: -3.0, timestamp: localAt('2026-08-01', 10).toISOString() };
    const resumed = learningStateService.coerceMetrics(teachingState);
    expect(resumed).not.toBeNull();

    const sameDay = learningStateService.restoreMetrics(resumed!, localAt('2026-08-01', 20));
    expect(sameDay.lf).toBeCloseTo(6.2, 6); // 同日续课：课内连续性不变

    const nextDay = learningStateService.restoreMetrics(resumed!, localAt('2026-08-02', 10));
    expect(nextDay.lf).toBeCloseTo(1.2 + (6.2 - 1.2) * 0.74, 6);
    expect(nextDay.lf).toBeLessThan(6); // 隔天不再判"该慢下来"
  });
});

describe('day-boundary 契约（本地日界的单一真理源）', () => {
  it('startOfDay/endOfDay 覆盖整日，且 endOfDay + 1ms = 次日 startOfDay', () => {
    const at = new Date('2026-08-01T20:00:00Z'); // 本地 08-02 04:00
    const start = startOfDay(at);
    const end = new Date(start.getTime() + DAY_BOUNDARY_DAY_MS - 1);
    expect(dayKeyOf(start)).toBe('2026-08-02');
    expect(dayKeyOf(end)).toBe('2026-08-02');
    expect(dayKeyOf(new Date(end.getTime() + 1))).toBe('2026-08-03');
  });

  it('非法时区名被拒绝（不静默改成别的口径）', () => {
    expect(() => dayKeyOf(new Date(), 'Not/AZone')).toThrow();
  });
});
