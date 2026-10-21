import {
  bucketCalibration,
  resolveCheckpointPrediction,
  summarizeCalibration,
} from '../checkpoint-prediction';

describe('resolveCheckpointPrediction（#96 判分前预测）', () => {
  it('按概念名命中 ktEstimate：优先于知识看板', () => {
    const prediction = resolveCheckpointPrediction({
      conceptName: ' 向量组线性无关 ',
      knowledgePoints: [{ name: '向量组线性无关', progress: 100 }],
      ktConceptMastery: [{ conceptKey: '向量组线性无关', mastery: 0.42 }],
      understanding: 0.7,
    });
    expect(prediction).toEqual({ predictedMastery: 0.42, source: 'kt-estimate', understanding: 0.7 });
  });

  it('名称不同但 kcId 一致时命中 ktEstimate', () => {
    const prediction = resolveCheckpointPrediction({
      conceptName: '秩与极大无关组',
      knowledgePoints: [{ name: '秩与极大无关组', progress: 60, kcId: 'kc-7' }],
      ktConceptMastery: [{ conceptKey: '极大线性无关组', kcId: 'kc-7', mastery: 0.65 }],
    });
    expect(prediction.predictedMastery).toBeCloseTo(0.65);
    expect(prediction.source).toBe('kt-estimate');
    expect(prediction.understanding).toBeNull();
  });

  it('无 ktEstimate 时回落到知识看板 progress/100', () => {
    const prediction = resolveCheckpointPrediction({
      conceptName: '分母为 0 的判定',
      knowledgePoints: [{ name: '分母为0的判定', progress: 79 }],
      ktConceptMastery: [],
      understanding: 0.5,
    });
    expect(prediction).toEqual({ predictedMastery: 0.79, source: 'knowledge-state', understanding: 0.5 });
  });

  it('两者都没有 → null（不猜），understanding 单独保留', () => {
    const prediction = resolveCheckpointPrediction({
      conceptName: '未在看板上的点',
      knowledgePoints: [{ name: '别的点', progress: 100 }],
      ktConceptMastery: [{ conceptKey: '别的点', mastery: 0.9 }],
      understanding: 0.3,
    });
    expect(prediction).toEqual({ predictedMastery: null, source: 'none', understanding: 0.3 });
  });

  it('非法 mastery 跳过，越界值收敛到 0–1', () => {
    const invalid = resolveCheckpointPrediction({
      conceptName: 'A',
      ktConceptMastery: [{ conceptKey: 'A', mastery: Number.NaN }],
      knowledgePoints: [],
    });
    expect(invalid.predictedMastery).toBeNull();
    const clamped = resolveCheckpointPrediction({
      conceptName: 'A',
      ktConceptMastery: [{ conceptKey: 'A', mastery: 1.7 }],
    });
    expect(clamped.predictedMastery).toBe(1);
  });
});

describe('bucketCalibration（校准表）', () => {
  it('左闭右开分桶，1.0 归入最后一桶，并给出 gap', () => {
    const buckets = bucketCalibration(
      [
        { predictedMastery: 0, passed: false },
        { predictedMastery: 0.19, passed: false },
        { predictedMastery: 0.2, passed: false },
        { predictedMastery: 0.79, passed: true },
        { predictedMastery: 0.8, passed: true },
        { predictedMastery: 1, passed: true },
      ],
      5,
    );
    expect(buckets).toHaveLength(5);
    expect(buckets[0].sample).toBe(2);
    expect(buckets[1].sample).toBe(1);
    expect(buckets[3].sample).toBe(1);
    expect(buckets[4].sample).toBe(2);
    // 最后一桶：预测均值 0.9，实际 1.0 → gap = +0.1
    expect(buckets[4].predictedMean).toBeCloseTo(0.9);
    expect(buckets[4].observedRate).toBe(1);
    expect(buckets[4].gap).toBeCloseTo(0.1);
    // 空桶指标为 null，不伪造 0
    expect(buckets[2].sample).toBe(0);
    expect(buckets[2].predictedMean).toBeNull();
    expect(buckets[2].gap).toBeNull();
  });
});

describe('summarizeCalibration（证据行汇总）', () => {
  it('只把 code 裁决 + 非简答 + 有预测的样本放进校准表', () => {
    const rows = [
      { payload: JSON.stringify({ type: 'single_choice', judgedBy: 'code', passed: true, predictedMastery: 0.85, predictionSource: 'kt-estimate', understanding: 0.8 }) },
      { payload: JSON.stringify({ type: 'single_choice', judgedBy: 'code', passed: false, predictedMastery: 0.55, predictionSource: 'knowledge-state' }) },
      // 简答题：进通过率统计，但不进校准表
      { payload: JSON.stringify({ type: 'short_answer', judgedBy: 'code', passed: true, predictedMastery: 0.9 }) },
      // 模型自评：一律不进校准表
      { payload: JSON.stringify({ type: 'single_choice', judgedBy: 'model-reference', passed: true, predictedMastery: 0.9 }) },
      // 旧行：无预测
      { payload: JSON.stringify({ type: 'single_choice', judgedBy: 'code', passed: true }) },
      { payload: 'not-json' },
    ];
    const summary = summarizeCalibration(rows);
    expect(summary.totalRows).toBe(6);
    expect(summary.codeJudged).toBe(4);
    expect(summary.usable).toBe(2);
    // 非简答的 code 裁决 = 3 条（含无预测那条）→ 覆盖率 2/3
    expect(summary.predictionCoverage).toBeCloseTo(2 / 3);
    expect(summary.bySource).toEqual({ 'kt-estimate': 1, 'knowledge-state': 1 });
    const single = summary.byType.find((item) => item.type === 'single_choice');
    expect(single).toMatchObject({ total: 4, code: 3, usable: 2 });
    expect(single?.passRate).toBeCloseTo(2 / 3);
    // understanding 对照表只收有 understanding 的 code 非简答样本
    expect(summary.understandingBuckets.reduce((sum, bucket) => sum + bucket.sample, 0)).toBe(1);
  });
});
