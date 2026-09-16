import {
  buildRetentionCurve,
  isRetrievalSuccess,
  retentionBucketOf,
} from '../retention-curve';

describe('保持率 × 间隔：分桶与曲线（P0-3）', () => {
  it('retentionBucketOf：按调度量级切桶，负值/缺失归 unknown', () => {
    expect(retentionBucketOf(0.3)).toBe('0-0.5d');
    expect(retentionBucketOf(0.5)).toBe('0-0.5d');
    expect(retentionBucketOf(0.51)).toBe('0.5-1d');
    expect(retentionBucketOf(1)).toBe('0.5-1d');
    expect(retentionBucketOf(2.9)).toBe('1-3d');
    expect(retentionBucketOf(7)).toBe('3-7d');
    expect(retentionBucketOf(14)).toBe('7-14d');
    expect(retentionBucketOf(30)).toBe('14-30d');
    expect(retentionBucketOf(31)).toBe('>30d');
    expect(retentionBucketOf(null)).toBe('unknown');
    expect(retentionBucketOf(undefined)).toBe('unknown');
    expect(retentionBucketOf(-1)).toBe('unknown');
    expect(retentionBucketOf(Number.NaN)).toBe('unknown');
  });

  it('检索成功口径与动态预算一致（good/easy 成功，hard/again 失败）', () => {
    expect(isRetrievalSuccess('good')).toBe(true);
    expect(isRetrievalSuccess('easy')).toBe(true);
    expect(isRetrievalSuccess('hard')).toBe(false);
    expect(isRetrievalSuccess('again')).toBe(false);
  });

  it('buildRetentionCurve：分桶统计成功率与平均掌握度，空桶给 null', () => {
    const curve = buildRetentionCurve([
      { elapsedDays: 0.2, rating: 'good', masteryScore: 0.85 },
      { elapsedDays: 0.3, rating: 'again', masteryScore: 0.5 },
      { elapsedDays: 2, rating: 'easy', masteryScore: 0.9 },
      { elapsedDays: 5, rating: 'hard', masteryScore: 0.5 },
      { elapsedDays: 40, rating: 'good', masteryScore: 0.8 },
      { elapsedDays: null, rating: 'good', masteryScore: 0.85 },
    ]);

    const byBucket = Object.fromEntries(curve.map((stat) => [stat.bucket, stat]));
    expect(byBucket['0-0.5d']).toMatchObject({ total: 2, success: 1, successRate: 0.5 });
    expect(byBucket['0-0.5d'].avgMastery).toBe(0.675);
    expect(byBucket['1-3d']).toMatchObject({ total: 1, success: 1, successRate: 1 });
    expect(byBucket['3-7d']).toMatchObject({ total: 1, success: 0, successRate: 0 });
    expect(byBucket['>30d']).toMatchObject({ total: 1, success: 1, successRate: 1 });
    expect(byBucket['unknown']).toMatchObject({ total: 1, success: 1 });
    // 空桶不给假数据
    expect(byBucket['7-14d']).toMatchObject({ total: 0, success: 0, successRate: null, avgMastery: null });
  });

  it('buildRetentionCurve：无样本时全为 0，不抛错', () => {
    for (const stat of buildRetentionCurve([])) {
      expect(stat.total).toBe(0);
      expect(stat.successRate).toBeNull();
    }
  });
});
