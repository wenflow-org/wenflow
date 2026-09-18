/**
 * 复习选点质量度量的单元测试（Q1）。
 *
 * 原则：
 * - 只测**纯函数**（无 DB / 无时钟）：夹具全部内联，期望值手算；
 * - 每个指标覆盖：空输入、边界（缺失/非法值）、单调性/合理性、一个手算样例；
 * - 快照式断言用 round4 后的确定值，避免浮点尾差。
 */
import {
  DEFAULT_TARGET_RETENTION,
  REVIEW_QUALITY_METRIC_DEFINITIONS,
  computeConceptCoverageEntropy,
  computeDueCoverage,
  computeInterleavingProxy,
  computeRepetitionSummary,
  computeRetrievabilityRegret,
  computeReviewOutcomeSummary,
  summarizeQuotaUtilization,
  summarizeReviewQuality,
} from '../review-quality-metrics';

describe('computeRetrievabilityRegret（可提取性后悔）', () => {
  it('空输入：无有效样本，均值为 null，目标保留率回显默认值', () => {
    const result = computeRetrievabilityRegret([]);
    expect(result).toEqual({
      validCount: 0,
      missingCount: 0,
      meanRetention: null,
      meanRegret: null,
      maxRegret: null,
      overTargetRate: null,
      targetRetention: DEFAULT_TARGET_RETENTION,
    });
  });

  it('全缺失：validCount=0、missingCount 计数、均值 null', () => {
    const result = computeRetrievabilityRegret([
      { conceptKey: 'A', retention: null },
      { conceptKey: 'B', retention: undefined },
      { conceptKey: 'C', retention: Number.NaN },
    ]);
    expect(result.validCount).toBe(0);
    expect(result.missingCount).toBe(3);
    expect(result.meanRegret).toBeNull();
  });

  it('手算样例：target=0.9，retention=[0.5, 0.95]', () => {
    // regrets = [max(0,0.5-0.9)=0, max(0,0.95-0.9)=0.05]
    // meanRetention = (0.5+0.95)/2 = 0.725；meanRegret = 0.05/2 = 0.025
    // maxRegret = 0.05；overTargetRate = 1/2 = 0.5
    const result = computeRetrievabilityRegret([
      { conceptKey: 'A', retention: 0.5 },
      { conceptKey: 'B', retention: 0.95 },
    ]);
    expect(result).toEqual({
      validCount: 2,
      missingCount: 0,
      meanRetention: 0.725,
      meanRegret: 0.025,
      maxRegret: 0.05,
      overTargetRate: 0.5,
      targetRetention: 0.9,
    });
  });

  it('单调性：加入一个"过早复习"点，meanRegret 不降', () => {
    const before = computeRetrievabilityRegret([{ conceptKey: 'A', retention: 0.5 }]);
    const after = computeRetrievabilityRegret([
      { conceptKey: 'A', retention: 0.5 },
      { conceptKey: 'B', retention: 1.0 },
    ]);
    expect(before.meanRegret).toBe(0);
    expect(after.meanRegret).toBeGreaterThan(before.meanRegret as number);
  });

  it('非法/越界 retention 被 clamp 到 [0,1]，非有限值算缺失', () => {
    const result = computeRetrievabilityRegret([
      { conceptKey: 'A', retention: 1.2 },   // → 1.0，regret 0.1
      { conceptKey: 'B', retention: -0.5 },  // → 0，regret 0
      { conceptKey: 'C', retention: Number.POSITIVE_INFINITY }, // 缺失
    ]);
    expect(result.validCount).toBe(2);
    expect(result.missingCount).toBe(1);
    expect(result.maxRegret).toBe(0.1);
    expect(result.meanRetention).toBe(0.5);
  });

  it('自定义 target 生效', () => {
    const result = computeRetrievabilityRegret(
      [{ conceptKey: 'A', retention: 0.9 }],
      { targetRetention: 0.8 },
    );
    expect(result.targetRetention).toBe(0.8);
    expect(result.meanRegret).toBe(0.1);
    expect(result.overTargetRate).toBe(1);
  });
});

describe('computeDueCoverage（到期覆盖）', () => {
  it('正常：selected=5 / due=8', () => {
    expect(computeDueCoverage({ selectedCount: 5, dueCount: 8 })).toEqual({
      selectedCount: 5,
      dueCount: 8,
      rawCoverage: 0.625,
      coverage: 0.625,
      backlog: 3,
      overSelected: 0,
    });
  });

  it('无到期：coverage 为 null（不是 0%），backlog=0', () => {
    expect(computeDueCoverage({ selectedCount: 0, dueCount: 0 })).toEqual({
      selectedCount: 0,
      dueCount: 0,
      rawCoverage: null,
      coverage: null,
      backlog: 0,
      overSelected: 0,
    });
  });

  it('完全未覆盖：selected=0 / due=4', () => {
    const result = computeDueCoverage({ selectedCount: 0, dueCount: 4 });
    expect(result.coverage).toBe(0);
    expect(result.backlog).toBe(4);
  });

  it('selected > due：coverage 截断为 1，用 overSelected 暴露口径异常', () => {
    const result = computeDueCoverage({ selectedCount: 10, dueCount: 8 });
    expect(result.coverage).toBe(1);
    expect(result.rawCoverage).toBe(1.25);
    expect(result.backlog).toBe(0);
    expect(result.overSelected).toBe(2);
  });

  it('负值/非整数被安全规整为 0', () => {
    const result = computeDueCoverage({ selectedCount: -3, dueCount: Number.NaN });
    expect(result.selectedCount).toBe(0);
    expect(result.dueCount).toBe(0);
    expect(result.coverage).toBeNull();
  });
});

describe('computeConceptCoverageEntropy（概念覆盖熵）', () => {
  it('空输入：熵为 null，未传全集时 unreviewedUniverseCount 为 null', () => {
    const result = computeConceptCoverageEntropy([]);
    expect(result.totalReviews).toBe(0);
    expect(result.distinctConcepts).toBe(0);
    expect(result.entropyBits).toBeNull();
    expect(result.normalizedEntropy).toBeNull();
    expect(result.unreviewedUniverseCount).toBeNull();
    expect(result.universeCoverage).toBeNull();
  });

  it('手算样例：[A,A,B,C]（p = 0.5/0.25/0.25）', () => {
    // H = -(0.5·log2 0.5 + 0.25·log2 0.25 + 0.25·log2 0.25) = 1.5 bit
    // max = log2(3) = 1.5849625 → 1.585
    // normalized = 1.5 / 1.5849625 = 0.946394... → 0.9464
    // HHI = 0.25 + 0.0625 + 0.0625 = 0.375；effective = 1/0.375 = 2.6667
    const result = computeConceptCoverageEntropy([
      { conceptKey: 'A' },
      { conceptKey: 'A' },
      { conceptKey: 'B' },
      { conceptKey: 'C' },
    ]);
    expect(result.totalReviews).toBe(4);
    expect(result.distinctConcepts).toBe(3);
    expect(result.entropyBits).toBe(1.5);
    expect(result.maxEntropyBits).toBe(1.585);
    expect(result.normalizedEntropy).toBe(0.9464);
    expect(result.topShare).toBe(0.5);
    expect(result.topConceptKey).toBe('A');
    expect(result.herfindahl).toBe(0.375);
    expect(result.effectiveConcepts).toBe(2.6667);
  });

  it('单调性：均匀分布熵 > 集中分布熵', () => {
    const uniform = computeConceptCoverageEntropy([
      { conceptKey: 'A' },
      { conceptKey: 'B' },
      { conceptKey: 'C' },
      { conceptKey: 'D' },
    ]);
    const skewed = computeConceptCoverageEntropy([
      { conceptKey: 'A' },
      { conceptKey: 'A' },
      { conceptKey: 'A' },
      { conceptKey: 'D' },
    ]);
    expect(uniform.entropyBits).toBe(2);
    expect(uniform.normalizedEntropy).toBe(1);
    expect(skewed.entropyBits as number).toBeLessThan(uniform.entropyBits as number);
    expect(skewed.topShare).toBe(0.75);
  });

  it('单概念：熵为 0、归一化为 0、HHI 为 1', () => {
    const result = computeConceptCoverageEntropy([
      { conceptKey: 'A' },
      { conceptKey: 'A' },
    ]);
    expect(result.entropyBits).toBe(0);
    expect(result.maxEntropyBits).toBe(0);
    expect(result.normalizedEntropy).toBe(0);
    expect(result.herfindahl).toBe(1);
    expect(result.effectiveConcepts).toBe(1);
  });

  it('概念全集：检测窗口内未复习到的概念（饥饿）', () => {
    const result = computeConceptCoverageEntropy(
      [{ conceptKey: 'A' }, { conceptKey: 'B' }],
      { universeConceptKeys: ['A', 'B', 'C', 'D'] },
    );
    expect(result.unreviewedUniverseCount).toBe(2);
    expect(result.universeCoverage).toBe(0.5);
  });

  it('全集为空数组：unreviewed=0、coverage 为 null', () => {
    const result = computeConceptCoverageEntropy([{ conceptKey: 'A' }], { universeConceptKeys: [] });
    expect(result.unreviewedUniverseCount).toBe(0);
    expect(result.universeCoverage).toBeNull();
  });

  it('空白概念键被跳过', () => {
    const result = computeConceptCoverageEntropy([{ conceptKey: '' }, { conceptKey: '   ' }, { conceptKey: 'A' }]);
    expect(result.totalReviews).toBe(1);
    expect(result.distinctConcepts).toBe(1);
  });
});

describe('computeInterleavingProxy（交错代理）', () => {
  it('空输入：比例为 null，最长连续段为 0', () => {
    const result = computeInterleavingProxy([]);
    expect(result).toEqual({
      totalItems: 0,
      transitions: 0,
      sameConceptTransitions: 0,
      sameConceptAdjacencyRate: null,
      longestSameConceptRun: 0,
      distinctConcepts: 0,
    });
  });

  it('单项：无相邻对，比例为 null，最长连续段为 1', () => {
    const result = computeInterleavingProxy([{ conceptKey: 'A' }]);
    expect(result.transitions).toBe(0);
    expect(result.sameConceptAdjacencyRate).toBeNull();
    expect(result.longestSameConceptRun).toBe(1);
  });

  it('手算样例：[A,A,B,A,C]', () => {
    // 相邻对：A=A 同、A→B 异、B→A 异、A→C 异 → 1/4 = 0.25；最长连续段 2
    const result = computeInterleavingProxy([
      { conceptKey: 'A' },
      { conceptKey: 'A' },
      { conceptKey: 'B' },
      { conceptKey: 'A' },
      { conceptKey: 'C' },
    ]);
    expect(result).toEqual({
      totalItems: 5,
      transitions: 4,
      sameConceptTransitions: 1,
      sameConceptAdjacencyRate: 0.25,
      longestSameConceptRun: 2,
      distinctConcepts: 3,
    });
  });

  it('全同概念：比例 1；完全交替：比例 0', () => {
    const allSame = computeInterleavingProxy([{ conceptKey: 'A' }, { conceptKey: 'A' }, { conceptKey: 'A' }]);
    expect(allSame.sameConceptAdjacencyRate).toBe(1);
    expect(allSame.longestSameConceptRun).toBe(3);

    const alternating = computeInterleavingProxy([
      { conceptKey: 'A' },
      { conceptKey: 'B' },
      { conceptKey: 'A' },
      { conceptKey: 'B' },
    ]);
    expect(alternating.sameConceptAdjacencyRate).toBe(0);
    expect(alternating.longestSameConceptRun).toBe(1);
  });
});

describe('computeReviewOutcomeSummary（复习结果分布）', () => {
  it('空输入：总数为 0，成功率为 null', () => {
    const result = computeReviewOutcomeSummary([]);
    expect(result.total).toBe(0);
    expect(result.strictSuccessRate).toBeNull();
    expect(result.lenientSuccessRate).toBeNull();
    expect(result.counts).toEqual({ again: 0, hard: 0, good: 0, easy: 0, unknown: 0 });
  });

  it('手算样例：[good, easy, hard, again, 空]', () => {
    // 已知 4 条；严 = good+easy = 2 → 0.5；宽 = 非 again = 3 → 0.75
    const result = computeReviewOutcomeSummary([
      { rating: 'good' },
      { rating: 'easy' },
      { rating: 'hard' },
      { rating: 'again' },
      { rating: null },
    ]);
    expect(result.total).toBe(5);
    expect(result.counts).toEqual({ again: 1, hard: 1, good: 1, easy: 1, unknown: 1 });
    expect(result.strictSuccess).toBe(2);
    expect(result.strictSuccessRate).toBe(0.5);
    expect(result.lenientSuccess).toBe(3);
    expect(result.lenientSuccessRate).toBe(0.75);
  });

  it('大小写与空白容错', () => {
    const result = computeReviewOutcomeSummary([{ rating: ' GOOD ' }, { rating: 'Easy' }]);
    expect(result.counts.good).toBe(1);
    expect(result.counts.easy).toBe(1);
    expect(result.strictSuccessRate).toBe(1);
  });
});

describe('computeRepetitionSummary（重复复习）', () => {
  it('空输入：重复占比为 null', () => {
    const result = computeRepetitionSummary([]);
    expect(result.totalReviews).toBe(0);
    expect(result.repeatShare).toBeNull();
    expect(result.mostReviewedConceptKey).toBeNull();
  });

  it('手算样例：[A,A,B]', () => {
    // total 3、distinct 2 → repeat 1 → share = 1/3 = 0.3333；A 出现 2 次
    const result = computeRepetitionSummary([
      { conceptKey: 'A' },
      { conceptKey: 'A' },
      { conceptKey: 'B' },
    ]);
    expect(result.totalReviews).toBe(3);
    expect(result.distinctConcepts).toBe(2);
    expect(result.repeatReviews).toBe(1);
    expect(result.repeatShare).toBe(0.3333);
    expect(result.maxReviewsPerConcept).toBe(2);
    expect(result.mostReviewedConceptKey).toBe('A');
  });

  it('单调性：加入新概念会降低 repeatShare', () => {
    const before = computeRepetitionSummary([{ conceptKey: 'A' }, { conceptKey: 'A' }]);
    const after = computeRepetitionSummary([
      { conceptKey: 'A' },
      { conceptKey: 'A' },
      { conceptKey: 'B' },
    ]);
    expect(before.repeatShare).toBe(0.5);
    expect(after.repeatShare as number).toBeLessThan(before.repeatShare as number);
  });
});

describe('summarizeQuotaUtilization（额度利用，附加）', () => {
  it('空输入：无可度量天', () => {
    const result = summarizeQuotaUtilization([]);
    expect(result).toEqual({
      days: 0,
      measurableDays: 0,
      avgUtilization: null,
      maxUtilization: null,
      overLimitDays: 0,
      totalUsedLoad: 0,
      totalUsedCount: 0,
    });
  });

  it('手算样例：含超额天与 limit=0 的不可度量天', () => {
    // util = 3/6=0.5、6/6=1、7/6=1.1667 → avg=(0.5+1+1.1667)/3=0.8889；max=1.1667；over=1
    const result = summarizeQuotaUtilization([
      { date: '2026-09-01', usedLoad: 3, limitLoad: 6, usedCount: 2 },
      { date: '2026-09-02', usedLoad: 6, limitLoad: 6, usedCount: 3 },
      { date: '2026-09-03', usedLoad: 7, limitLoad: 6, usedCount: 3 },
      { date: '2026-09-04', usedLoad: 0, limitLoad: 0, usedCount: 0 },
    ]);
    expect(result.days).toBe(4);
    expect(result.measurableDays).toBe(3);
    expect(result.avgUtilization).toBe(0.8889);
    expect(result.maxUtilization).toBe(1.1667);
    expect(result.overLimitDays).toBe(1);
    expect(result.totalUsedLoad).toBe(16);
    expect(result.totalUsedCount).toBe(8);
  });
});

describe('summarizeReviewQuality（聚合入口）', () => {
  it('完整输入：各指标组合正确', () => {
    const result = summarizeReviewQuality({
      reviewed: [
        { conceptKey: 'A', retention: 0.5, rating: 'good' },
        { conceptKey: 'B', retention: 0.95, rating: 'again' },
      ],
      dueCount: 3,
      universeConceptKeys: ['A', 'B', 'C'],
    });

    // regret：max(0,0.5-0.9)=0、max(0,0.95-0.9)=0.05 → 0.025
    expect(result.retrievabilityRegret.meanRegret).toBe(0.025);
    expect(result.thresholds.targetRetention).toBe(0.9);

    // due coverage：2/3 = 0.6667，backlog 1
    expect(result.dueCoverage).not.toBeNull();
    expect(result.dueCoverage?.coverage).toBe(0.6667);
    expect(result.dueCoverage?.backlog).toBe(1);

    // 熵：两个概念各 1 次 → H=1、normalized=1；全集 3 个，未覆盖 1
    expect(result.conceptCoverageEntropy.entropyBits).toBe(1);
    expect(result.conceptCoverageEntropy.normalizedEntropy).toBe(1);
    expect(result.conceptCoverageEntropy.unreviewedUniverseCount).toBe(1);
    expect(result.conceptCoverageEntropy.universeCoverage).toBe(0.6667);

    // 交错：A→B 不同概念 → 0
    expect(result.interleaving.sameConceptAdjacencyRate).toBe(0);

    // 结果：good + again → 严 0.5、宽 0.5
    expect(result.outcome.strictSuccessRate).toBe(0.5);
    expect(result.outcome.lenientSuccessRate).toBe(0.5);

    // 重复：无重复
    expect(result.repetition.repeatShare).toBe(0);
  });

  it('dueCount 缺省：dueCoverage 为 null，其余指标仍可算', () => {
    const result = summarizeReviewQuality({
      reviewed: [{ conceptKey: 'A', retention: 0.4, rating: 'good' }],
    });
    expect(result.dueCoverage).toBeNull();
    expect(result.retrievabilityRegret.validCount).toBe(1);
    expect(result.outcome.strictSuccessRate).toBe(1);
  });
});

describe('REVIEW_QUALITY_METRIC_DEFINITIONS（指标字典）', () => {
  it('每个指标都带定义、数据来源与限制（防止口径漂移）', () => {
    expect(REVIEW_QUALITY_METRIC_DEFINITIONS.length).toBeGreaterThanOrEqual(7);
    for (const definition of REVIEW_QUALITY_METRIC_DEFINITIONS) {
      expect(definition.key.length).toBeGreaterThan(0);
      expect(definition.definition.length).toBeGreaterThan(0);
      expect(definition.dataSource.length).toBeGreaterThan(0);
      expect(definition.limitation.length).toBeGreaterThan(0);
    }
  });
});
