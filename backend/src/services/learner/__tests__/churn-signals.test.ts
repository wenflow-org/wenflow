import {
  CHURN_SIGNAL_CAVEAT,
  DEFAULT_DORMANCY_THRESHOLDS,
  bucketForDays,
  computeDormancy,
  dormancyRisk,
  resolveDormancyThresholds,
  summarizeChurn,
  type ChurnUserSignal,
} from '../churn-signals';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-30T00:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

describe('computeDormancy · 分档边界', () => {
  it('恰好 0 天 → active、risk 0；未来时间戳也归零', () => {
    expect(computeDormancy({ lastActiveAt: daysAgo(0), now: NOW })).toMatchObject({
      daysSinceActive: 0,
      bucket: 'active',
      risk: 0,
    });
    const future = computeDormancy({ lastActiveAt: new Date(NOW.getTime() + 5 * DAY), now: NOW });
    expect(future.bucket).toBe('active');
    expect(future.daysSinceActive).toBe(0);
    expect(future.risk).toBe(0);
  });

  it('7 / 14 / 30 天为各档下界（恰好等于即进下一档）', () => {
    expect(computeDormancy({ lastActiveAt: daysAgo(6.99), now: NOW }).bucket).toBe('active');
    expect(computeDormancy({ lastActiveAt: daysAgo(7), now: NOW }).bucket).toBe('cooling');
    expect(computeDormancy({ lastActiveAt: daysAgo(13.99), now: NOW }).bucket).toBe('cooling');
    expect(computeDormancy({ lastActiveAt: daysAgo(14), now: NOW }).bucket).toBe('dormant');
    expect(computeDormancy({ lastActiveAt: daysAgo(29.99), now: NOW }).bucket).toBe('dormant');
    expect(computeDormancy({ lastActiveAt: daysAgo(30), now: NOW }).bucket).toBe('lost');
    expect(computeDormancy({ lastActiveAt: daysAgo(365), now: NOW }).bucket).toBe('lost');
  });

  it('自定义阈值改变分档边界', () => {
    const thresholds = { coolingDays: 3, dormantDays: 5, lostDays: 10 };
    expect(computeDormancy({ lastActiveAt: daysAgo(3), now: NOW, thresholds }).bucket).toBe('cooling');
    expect(computeDormancy({ lastActiveAt: daysAgo(5), now: NOW, thresholds }).bucket).toBe('dormant');
    expect(computeDormancy({ lastActiveAt: daysAgo(10), now: NOW, thresholds }).bucket).toBe('lost');
    expect(bucketForDays(2, resolveDormancyThresholds(thresholds))).toBe('active');
  });

  it('阈值非严格递增时抛错（不静默错分档）', () => {
    expect(() => resolveDormancyThresholds({ coolingDays: 10, dormantDays: 5 })).toThrow(/严格递增/);
    expect(() => computeDormancy({ lastActiveAt: daysAgo(5), now: NOW, thresholds: { dormantDays: 7 } })).toThrow();
  });

  it('now 非法时抛错', () => {
    expect(() => computeDormancy({ lastActiveAt: daysAgo(1), now: 'not-a-date' })).toThrow();
  });
});

describe('computeDormancy · 从未活跃 / 非法时间', () => {
  it('null / undefined → daysSinceActive=null、lost、risk=1', () => {
    for (const lastActiveAt of [null, undefined]) {
      expect(computeDormancy({ lastActiveAt, now: NOW })).toEqual({
        daysSinceActive: null,
        bucket: 'lost',
        risk: 1,
      });
    }
  });

  it('非法时间字符串按从未活跃处理', () => {
    expect(computeDormancy({ lastActiveAt: 'not-a-date', now: NOW })).toEqual({
      daysSinceActive: null,
      bucket: 'lost',
      risk: 1,
    });
    expect(computeDormancy({ lastActiveAt: new Date(Number.NaN), now: NOW }).daysSinceActive).toBeNull();
  });

  it('接受 ISO 字符串输入（与 Date 等价）', () => {
    const a = computeDormancy({ lastActiveAt: daysAgo(20).toISOString(), now: NOW });
    const b = computeDormancy({ lastActiveAt: daysAgo(20), now: NOW });
    expect(a).toEqual(b);
    expect(a.bucket).toBe('dormant');
  });
});

describe('dormancyRisk · 曲线性质', () => {
  it('risk 在 0–1 且随天数单调不减（含跨档拼接处）', () => {
    let prev = -Infinity;
    for (let d = 0; d <= 60; d += 0.25) {
      const risk = dormancyRisk(d);
      expect(risk).toBeGreaterThanOrEqual(0);
      expect(risk).toBeLessThan(1);
      expect(risk).toBeGreaterThanOrEqual(prev);
      prev = risk;
    }
  });

  it('锚定各档边界值，且远超 lost 后趋近 1', () => {
    expect(dormancyRisk(0)).toBeCloseTo(0, 6);
    expect(dormancyRisk(7)).toBeCloseTo(0.15, 6);
    expect(dormancyRisk(14)).toBeCloseTo(0.55, 6);
    expect(dormancyRisk(30)).toBeCloseTo(0.9, 6);
    expect(dormancyRisk(365)).toBeGreaterThan(0.9);
    // 渐近趋近但不超过 1：远离 lost 时严格 <1；极远处受浮点下溢饱和到 1.0
    expect(dormancyRisk(60)).toBeLessThan(1);
    expect(dormancyRisk(365)).toBeLessThanOrEqual(1);
  });

  it('与 computeDormancy 使用同一曲线', () => {
    const signal = computeDormancy({ lastActiveAt: daysAgo(21), now: NOW });
    expect(signal.risk).toBeCloseTo(dormancyRisk(21), 12);
    expect(signal.bucket).toBe('dormant');
  });
});

describe('summarizeChurn', () => {
  it('空输入安全：全零、中位数为 null', () => {
    const summary = summarizeChurn([], { now: NOW });
    expect(summary.total).toBe(0);
    expect(summary.byBucket).toEqual({ active: 0, cooling: 0, dormant: 0, lost: 0, neverActive: 0 });
    expect(summary.dormancyRate).toBe(0);
    expect(summary.medianDaysSinceActive).toBeNull();
    expect(summary.atRisk).toEqual([]);
  });

  it('null / undefined 输入也安全', () => {
    expect(summarizeChurn(null, { now: NOW }).total).toBe(0);
    expect(summarizeChurn(undefined, { now: NOW }).atRisk).toEqual([]);
  });

  it('分档计数、dormancyRate 与中位数（偶数个取中间均值）', () => {
    const users: ChurnUserSignal[] = [
      { userId: 'a', lastActiveAt: daysAgo(1) }, // active
      { userId: 'b', lastActiveAt: daysAgo(2) }, // active
      { userId: 'c', lastActiveAt: daysAgo(9) }, // cooling
      { userId: 'd', lastActiveAt: daysAgo(20) }, // dormant
      { userId: 'e', lastActiveAt: daysAgo(40) }, // lost
      { userId: 'f', lastActiveAt: null }, // neverActive
    ];
    const summary = summarizeChurn(users, { now: NOW });
    expect(summary.total).toBe(6);
    expect(summary.byBucket).toEqual({ active: 2, cooling: 1, dormant: 1, lost: 1, neverActive: 1 });
    // (1 + 2 + 9 + 20 + 40) 排序后 [1,2,9,20,40]，中位（奇数）= 9
    expect(summary.medianDaysSinceActive).toBeCloseTo(9, 6);
    // (dormant + lost + neverActive) / 6 = 3/6
    expect(summary.dormancyRate).toBeCloseTo(0.5, 6);
  });

  it('中位数偶数个取中间两值均值，且从未活跃者不参与中位数', () => {
    const users: ChurnUserSignal[] = [
      { userId: 'a', lastActiveAt: daysAgo(1) },
      { userId: 'b', lastActiveAt: daysAgo(3) },
      { userId: 'c', lastActiveAt: daysAgo(5) },
      { userId: 'd', lastActiveAt: daysAgo(7) },
      { userId: 'z', lastActiveAt: null },
    ];
    const summary = summarizeChurn(users, { now: NOW });
    // 有活跃者 [1,3,5,7] → 中位 (3+5)/2 = 4；null 用户(天数为 null)不参与
    expect(summary.medianDaysSinceActive).toBeCloseTo(4, 6);
    expect(summary.byBucket.neverActive).toBe(1);
  });

  it('atRisk 只含 dormant/lost/neverActive，按 risk 降序且确定性排序', () => {
    const users: ChurnUserSignal[] = [
      { userId: 'active', lastActiveAt: daysAgo(1) },
      { userId: 'cooling', lastActiveAt: daysAgo(9) },
      { userId: 'dormant', lastActiveAt: daysAgo(20) },
      { userId: 'lost', lastActiveAt: daysAgo(40) },
      { userId: 'never', lastActiveAt: null },
    ];
    const summary = summarizeChurn(users, { now: NOW });
    expect(summary.atRisk.map((entry) => entry.userId)).toEqual(['never', 'lost', 'dormant']);
    for (let i = 1; i < summary.atRisk.length; i += 1) {
      expect(summary.atRisk[i - 1].risk).toBeGreaterThanOrEqual(summary.atRisk[i].risk);
    }
    expect(summary.atRisk[0]).toMatchObject({ userId: 'never', daysSinceActive: null, bucket: 'lost', risk: 1 });
  });

  it('确定性：同一输入两次结果深相等，且与输入顺序无关', () => {
    const users: ChurnUserSignal[] = [
      { userId: 'u3', lastActiveAt: daysAgo(31) },
      { userId: 'u1', lastActiveAt: daysAgo(2) },
      { userId: 'u2', lastActiveAt: daysAgo(15) },
      { userId: 'u4', lastActiveAt: null },
      { userId: 'u5', lastActiveAt: daysAgo(7) },
    ];
    const first = summarizeChurn(users, { now: NOW });
    const second = summarizeChurn(users, { now: NOW });
    const shuffled = summarizeChurn([...users].reverse(), { now: NOW });
    expect(second).toEqual(first);
    expect(shuffled).toEqual(first);
  });

  it('脏记录（缺 userId）被跳过、不计入分母', () => {
    const users = [
      { userId: 'ok', lastActiveAt: daysAgo(40) },
      { userId: '', lastActiveAt: daysAgo(40) },
      null,
    ] as unknown as ChurnUserSignal[];
    const summary = summarizeChurn(users, { now: NOW });
    expect(summary.total).toBe(1);
    expect(summary.atRisk.map((entry) => entry.userId)).toEqual(['ok']);
  });

  it('自定义阈值影响汇总分档', () => {
    const users: ChurnUserSignal[] = [
      { userId: 'a', lastActiveAt: daysAgo(4) },
      { userId: 'b', lastActiveAt: daysAgo(6) },
    ];
    const strict = summarizeChurn(users, { now: NOW, thresholds: { coolingDays: 3, dormantDays: 5, lostDays: 8 } });
    expect(strict.byBucket).toEqual({ active: 0, cooling: 1, dormant: 1, lost: 0, neverActive: 0 });
    expect(strict.dormancyRate).toBeCloseTo(0.5, 6);
  });

  it('随报告输出的观察性声明非空（防止误当因果/概率）', () => {
    expect(CHURN_SIGNAL_CAVEAT).toContain('非因果');
    expect(CHURN_SIGNAL_CAVEAT.length).toBeGreaterThan(20);
    expect(resolveDormancyThresholds()).toEqual(DEFAULT_DORMANCY_THRESHOLDS);
  });
});
