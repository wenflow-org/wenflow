/**
 * #55 交付比纯函数用例（2026-10-18）。
 * 口径陷阱是本模块的全部意义：计划口径（bc.after/锚）与实路口径（Σ任务分钟/锚）必须分开，
 * 否则「容量装不下」会被读成「交付塌方」，或者反过来把 5 条真缺口漏成 0 条。
 */
import {
  computeDeliveryRatio,
  detectShortfallDeclaration,
  summarizeDeliveryRatios,
  summarizeGapDeclarations,
  type DeliveryRatioRow,
} from '../delivery-ratio';

describe('computeDeliveryRatio 口径', () => {
  it('无预算锚 / 锚为 0 / 负数 → 不可算（null），不当 0 参与统计', () => {
    expect(computeDeliveryRatio({ targetHours: null, capacityHours: 10, plannedHours: 10, deliveredHours: 5 })).toBeNull();
    expect(computeDeliveryRatio({ targetHours: 0, capacityHours: 10, plannedHours: 10, deliveredHours: 5 })).toBeNull();
    expect(computeDeliveryRatio({ targetHours: -3, capacityHours: 10, plannedHours: 10, deliveredHours: 5 })).toBeNull();
  });

  it('实际口径 = Σ任务分钟/锚；计划口径 = after/锚，两者不混用', () => {
    const row = computeDeliveryRatio({ targetHours: 240, capacityHours: 150, plannedHours: 127.5, deliveredHours: 62.1 });
    expect(row).not.toBeNull();
    expect(row!.ratioPlanned).toBe(0.531);
    expect(row!.ratioActual).toBe(0.259);
    expect(row!.ratioCap).toBe(0.414);
    expect(row!.actualVsPlanned).toBe(0.487);
  });

  it('真缺口判据：ratio<0.6 且 cap<0.8', () => {
    // 容量装不下（cap ≥ 0.8）→ 设计性缩水，不是真缺口
    expect(computeDeliveryRatio({ targetHours: 240, capacityHours: 150, plannedHours: 127.5, deliveredHours: 127.5 })!.trueGap).toBe(false);
    // 装得下却没交付（cap < 0.8）→ 真缺口
    expect(computeDeliveryRatio({ targetHours: 240, capacityHours: 300, plannedHours: 240, deliveredHours: 120 })!.trueGap).toBe(true);
    // cap 恰好 0.8 不算「<0.8」
    expect(computeDeliveryRatio({ targetHours: 10, capacityHours: 10, plannedHours: 10, deliveredHours: 8 })!.trueGap).toBe(false);
  });

  it('无 cap 时按「装得下却没交付」处理（ratio<0.6 即真缺口）', () => {
    const row = computeDeliveryRatio({ targetHours: 100, capacityHours: null, plannedHours: 100, deliveredHours: 50 });
    expect(row!.ratioCap).toBeNull();
    expect(row!.trueGap).toBe(true);
  });

  it('交付超过锚（>1）不算塌方', () => {
    const row = computeDeliveryRatio({ targetHours: 80, capacityHours: 80, plannedHours: 80, deliveredHours: 96 });
    expect(row!.ratioActual).toBe(1.2);
    expect(row!.trueGap).toBe(false);
  });
});

describe('summarizeDeliveryRatios 汇总', () => {
  const row = (target: number, cap: number, planned: number, delivered: number): DeliveryRatioRow =>
    computeDeliveryRatio({ targetHours: target, capacityHours: cap, plannedHours: planned, deliveredHours: delivered })!;

  it('分档边界与中位数', () => {
    const rows = [
      row(100, 100, 100, 30),   // lt04
      row(100, 100, 100, 50),   // b04_06
      row(100, 100, 100, 70),   // b06_08
      row(100, 100, 100, 90),   // b08_10
      row(100, 100, 100, 120),  // gt10
    ];
    const summary = summarizeDeliveryRatios(rows);
    expect(summary.computable).toBe(5);
    expect(summary.bands).toEqual({ lt04: 1, b04_06: 1, b06_08: 1, b08_10: 1, gt10: 1 });
    expect(summary.medianActual).toBe(0.7);
  });

  it('计划→实际兑现率 <0.8 计入 plannedShortfall（守恒层说排了、任务没排到）', () => {
    const rows = [
      row(240, 150, 127.5, 62.1),  // 0.487 → 计入
      row(100, 100, 100, 95),      // 0.95 → 不计
    ];
    expect(summarizeDeliveryRatios(rows).plannedShortfall).toBe(1);
  });

  it('判据：真缺口率 >40% 成立，否则不成立', () => {
    const gaps = [row(100, 300, 100, 50), row(100, 300, 100, 40), row(100, 300, 100, 30)]; // 3/3 真缺口
    expect(summarizeDeliveryRatios(gaps).verdict).toBe('成立');
    const mixed = [...gaps, row(100, 100, 100, 95)]; // 3/4 = 75% 仍成立
    expect(summarizeDeliveryRatios(mixed).verdict).toBe('成立');
    const sparse = [row(100, 300, 100, 50), ...Array.from({ length: 9 }, () => row(100, 100, 100, 95))];
    expect(summarizeDeliveryRatios(sparse).trueGapRate).toBe(0.1);
    expect(summarizeDeliveryRatios(sparse).verdict).toBe('不成立');
  });

  it('空输入不产 NaN', () => {
    const summary = summarizeDeliveryRatios([]);
    expect(summary.computable).toBe(0);
    expect(summary.medianActual).toBeNull();
    expect(summary.trueGapRate).toBe(0);
    expect(summary.verdict).toBe('不成立');
  });
});

describe('缺口声明分档（#55 两镜头：有声明=自觉缩水，无声明=静默缺陷）', () => {
  it('路径级【课时说明】优先识别为 path', () => {
    expect(detectShortfallDeclaration({
      pathDescription: '描述\n\n【课时说明】按你的时间预算……',
      milestoneDescriptions: ['时间说明：这一阶段……'],
    })).toBe('path');
  });

  it('仅阶段级声明识别为 stage（兼容存量「容量说明」旧文案）', () => {
    expect(detectShortfallDeclaration({
      pathDescription: '普通描述',
      milestoneDescriptions: ['阶段描述', '时间说明：这一阶段按你的时间预算约 30 小时……'],
    })).toBe('stage');
    expect(detectShortfallDeclaration({
      milestoneDescriptions: ['容量说明：本阶段按你的时间预算约 6 小时……'],
    })).toBe('stage');
  });

  it('无任何声明识别为 none（静默缺陷）', () => {
    expect(detectShortfallDeclaration({ pathDescription: '普通描述', milestoneDescriptions: [null, undefined, ''] })).toBe('none');
    expect(detectShortfallDeclaration({})).toBe('none');
  });

  it('只统计真缺口；declared + silent === trueGap', () => {
    const counts = summarizeGapDeclarations([
      { trueGap: true, declaration: 'path' },
      { trueGap: true, declaration: 'stage' },
      { trueGap: true, declaration: 'none' },
      { trueGap: false, declaration: 'none' }, // 非真缺口不计
    ]);
    expect(counts).toEqual({ declared: 2, silent: 1 });
    expect(counts.declared + counts.silent).toBe(3);
  });
});
