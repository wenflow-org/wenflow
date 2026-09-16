/**
 * 学习状态的**跨天恢复**：自然衰减的精确值 + "恢复窗口"（几天后阈值不再触发）
 *
 * 为什么值得单独测：这三个日因子（LSS 0.82 / KTL 0.99 / LF 0.74 向基线 1.2 回落）决定了
 * "累了一天之后多久回到正常节奏"——是产品语义，但此前只有 ACT-R/FSRS 的记忆衰减有测试，
 * 状态本身的恢复没有任何断言（错一个因子就会静默改变课堂节奏）。
 */
import learningStateService from '../learning-state.service';

const at = (iso: string) => new Date(iso);
const state = {
  lss: 7.2,
  ktl: 3.7,
  lf: 2.4,
  lsb: 1.3,
  timestamp: at('2026-08-01T09:00:00Z'),
};

describe('自然衰减（restoreMetrics）', () => {
  it('同一天不衰减（日差按 **UTC 日界**，与配额/当日课量/日模拟同口径）', () => {
    const same = learningStateService.restoreMetrics(state, at('2026-08-01T20:00:00Z'));
    expect(same.lss).toBeCloseTo(7.2, 6);
    expect(same.ktl).toBeCloseTo(3.7, 6);
    expect(same.lf).toBeCloseTo(2.4, 6);
  });

  it('LSS ×0.82^d、KTL ×0.99^d、LF 向基线 1.2 回落（×0.74^d）', () => {
    const days = 3;
    const decayed = learningStateService.restoreMetrics(state, at('2026-08-04T09:00:00Z'));
    expect(decayed.lss).toBeCloseTo(7.2 * 0.82 ** days, 6);
    expect(decayed.ktl).toBeCloseTo(3.7 * 0.99 ** days, 6);
    expect(decayed.lf).toBeCloseTo(1.2 + (2.4 - 1.2) * 0.74 ** days, 6);
  });

  it('LF 收敛到基线而不是归零（"休息够了仍有一点负荷"）', () => {
    const far = learningStateService.restoreMetrics(state, at('2026-10-30T09:00:00Z'));
    expect(far.lf).toBeCloseTo(1.2, 3);
    expect(far.lss).toBeLessThan(0.01);          // 单课压力可以归零
    expect(far.ktl).toBeGreaterThan(0);          // 训练负荷衰减慢（0.99/天）
    expect(far.lsb).toBeCloseTo(far.ktl - far.lf, 6);
  });

  it('恢复窗口：高疲劳与高单课压力都是"隔一天就出阈值"（但疲劳留尾、压力几乎清空）', () => {
    const nextDay = at('2026-08-02T09:00:00Z');

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

  it('日差按 UTC 日界（机器在哪个时区都一样）', () => {
    const utcMidnight = (value: Date) => Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
    const asOf = at('2026-08-02T23:59:59.999Z');
    const expectedUtcDays = Math.round((utcMidnight(asOf) - utcMidnight(state.timestamp)) / 86400000);
    expect(learningStateService.restoreMetrics(state, asOf).lss)
      .toBeCloseTo(7.2 * 0.82 ** expectedUtcDays, 6);
  });

  it('回归：用日期模拟的规范 asOf（UTC 日末）读"当天的课"，不再白多衰减一天', () => {
    // 这是把衰减统一到 UTC 日界的直接动机：此前 UTC+8 下 09:00Z 的课在当天 23:59:59.999Z 读会多算一天
    const asOfSameDay = at('2026-08-01T23:59:59.999Z');
    const sameDay = learningStateService.restoreMetrics(state, asOfSameDay);
    expect(sameDay.lss).toBeCloseTo(7.2, 6);
    expect(sameDay.lf).toBeCloseTo(2.4, 6);

    // 次日读：恰好一天衰减
    const nextDay = learningStateService.restoreMetrics(state, at('2026-08-02T00:00:00.000Z'));
    expect(nextDay.lss).toBeCloseTo(7.2 * 0.82, 6);
  });

  it('train 负荷衰减明显慢于压力/疲劳（这是"知识练过就留得住"的口径）', () => {
    const d = 10;
    const decayed = learningStateService.restoreMetrics(state, at('2026-08-11T09:00:00Z'));
    const ktlRatio = decayed.ktl / 3.7;
    const lssRatio = decayed.lss / 7.2;
    const lfRatio = (decayed.lf - 1.2) / (2.4 - 1.2);
    expect(ktlRatio).toBeGreaterThan(lssRatio);
    expect(ktlRatio).toBeGreaterThan(lfRatio);
    expect(ktlRatio).toBeCloseTo(0.99 ** d, 6);
  });
});
