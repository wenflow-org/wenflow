import {
  FORMULA_VERSION,
  aggregateSessionEvaluation,
  aggregateSessionEvaluationFromMessages,
  buildSessionEvaluationShadow,
  extractSessionTurnObservations,
  median,
  worstWindowMean,
  type SessionTurnObservation,
} from '../session-evaluation-aggregate';

const obs = (over: Partial<SessionTurnObservation> = {}): SessionTurnObservation => ({
  understanding: null,
  engagement: null,
  loadIndex: null,
  emotionalState: null,
  confusionCount: null,
  mastery: null,
  taskDifficulty: null,
  ...over,
});

/** 全场吃力：高负荷 + 多困惑 + 负性情绪 + 高难度 + 低理解/低掌握/低参与 */
const allHigh = () => obs({
  loadIndex: 0.9,
  confusionCount: 3,
  emotionalState: 'frustrated',
  engagement: 0.2,
  understanding: 0.2,
  mastery: 0.2,
  taskDifficulty: 0.9,
});

/** 全场顺畅：低负荷 + 无困惑 + 正性情绪 + 高理解/高掌握/高参与 */
const allLow = () => obs({
  loadIndex: 0.1,
  confusionCount: 0,
  emotionalState: 'positive',
  engagement: 0.9,
  understanding: 0.9,
  mastery: 0.9,
  taskDifficulty: 0.1,
});

describe('session-evaluation-aggregate：确定性聚合（纯函数、可重放）', () => {
  it('公式版本随返回值带出', () => {
    const result = aggregateSessionEvaluation([allHigh()]);
    expect(result.formulaVersion).toBe(FORMULA_VERSION);
    expect(FORMULA_VERSION).toBe('session-eval-det-v1');
  });

  it('全 high：压力/疲劳高、知识获得质量低', () => {
    const result = aggregateSessionEvaluation([allHigh(), allHigh(), allHigh(), allHigh()]);
    expect(result.basis).toBe('per-turn-observations');
    expect(result.lss).toBeGreaterThanOrEqual(9);
    expect(result.lf).toBeGreaterThanOrEqual(9);
    expect(result.ktl).toBeLessThanOrEqual(3);
    expect(result.coverage.overall).toBe(1);
  });

  it('全 low：压力/疲劳低、知识获得质量高', () => {
    const result = aggregateSessionEvaluation([allLow(), allLow(), allLow(), allLow()]);
    expect(result.lss).toBeLessThanOrEqual(1.5);
    expect(result.lf).toBeLessThanOrEqual(2);
    expect(result.ktl).toBeGreaterThanOrEqual(8.5);
  });

  it('中途高后低（振荡）：LF 取最差连续窗口，不被后段平静抹平；LSS 取中位数；KTL 兼顾末段', () => {
    const result = aggregateSessionEvaluation([
      allHigh(), allHigh(), allHigh(),
      allLow(), allLow(), allLow(),
    ]);

    // LSS 中位数落在中间
    expect(result.lss).toBeGreaterThan(4);
    expect(result.lss).toBeLessThan(6.5);

    // LF：序列为 [9,9,9,1,1,1]，裸均值 = 5；最差窗口 = 9 → 证明不是裸均值
    expect(result.lf).toBeGreaterThan(7);

    // KTL：中位数 5.5 与末段均值 9 各半 → 7.25
    expect(result.ktl).toBeGreaterThan(6.5);
    expect(result.ktl).toBeLessThan(8);
  });

  it('单轮离群不改变 LSS 中心（中位数而非均值）', () => {
    const result = aggregateSessionEvaluation([allHigh(), allLow(), allLow(), allLow(), allLow()]);
    expect(result.lss).toBeLessThanOrEqual(1.5);
  });

  it('某项信号缺失 ⇒ 该分量权重 0（重新归一），绝不用默认值补', () => {
    // 只有情绪一种信号：LSS/LF 完全由情绪决定（10），不会被"缺失的负荷"稀释
    const result = aggregateSessionEvaluation([obs({ emotionalState: 'frustrated' })]);
    expect(result.lss).toBe(10);
    expect(result.lf).toBe(10);
    // KTL 没有任何信号 ⇒ 保守常量 3，且 coverage 明确暴露缺口
    expect(result.ktl).toBe(3);
    expect(result.coverage.ktl).toBe(0);
    expect(result.diagnostics.ktl.samples).toBe(0);
  });

  it('部分缺失时分母只统计已有分量（loadIndex 缺失不引入默认负荷）', () => {
    // 只剩 emotionalState(neutral=3, w0.25) + taskDifficulty(0.5→5, w0.1)
    const result = aggregateSessionEvaluation([obs({ emotionalState: 'neutral', taskDifficulty: 0.5 })]);
    // (3*0.25 + 5*0.1) / 0.35 = 3.571… → 3.6
    expect(result.lss).toBeCloseTo(3.6, 5);
  });

  it('零证据（无任何观测）⇒ 确定式兜底 3/3/3 + confidence 0.1', () => {
    const result = aggregateSessionEvaluation([]);
    expect(result).toMatchObject({
      lss: 3,
      ktl: 3,
      lf: 3,
      confidence: 0.1,
      basis: 'zero-evidence',
      turnCount: 0,
      formulaVersion: FORMULA_VERSION,
    });
    expect(result.coverage.overall).toBe(0);
  });

  it('confidence 由覆盖率 × 回合量决定，且封顶 0.9（不全信）', () => {
    const full = aggregateSessionEvaluation([allLow(), allLow(), allLow(), allLow(), allLow()]);
    expect(full.coverage.overall).toBe(1);
    expect(full.confidence).toBe(0.9);

    const partial = aggregateSessionEvaluation([obs({ emotionalState: 'frustrated' })]);
    expect(partial.confidence).toBeLessThan(0.2);
  });

  it('辅助统计量：median / worstWindowMean', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(worstWindowMean([1, 9, 9, 9, 1, 1], 3)).toBe(9);
    expect(worstWindowMean([5], 3)).toBe(5);
    expect(worstWindowMean([], 3)).toBeNull();
  });
});

describe('session-evaluation-aggregate：从落库消息抽取逐轮观测', () => {
  it('读取 analysis 的逐轮信号（understanding/engagement/loadIndex/情绪/困惑/ktEstimate）', () => {
    const observations = extractSessionTurnObservations([
      {
        role: 'user',
        analysis: {
          understanding: 0.7,
          engagement: 0.8,
          loadIndex: 0.4,
          emotionalState: 'neutral',
          confusionPoints: ['变量生命周期', '作用域'],
          ktEstimate: {
            conceptMastery: [{ mastery: 0.6 }, { mastery: 0.8 }],
            currentTaskDifficulty: 0.3,
          },
        },
      },
    ]);

    expect(observations).toHaveLength(1);
    expect(observations[0]).toEqual({
      understanding: 0.7,
      engagement: 0.8,
      loadIndex: 0.4,
      emotionalState: 'neutral',
      confusionCount: 2,
      mastery: 0.7,
      taskDifficulty: 0.3,
    });
  });

  it('检查点合成消息与伴学消息不计入（不是学生回合）', () => {
    const observations = extractSessionTurnObservations([
      { role: 'user', analysis: { understanding: 0.5, loadIndex: 0.5 } },
      { role: 'assistant', checkpoint: true, analysis: { understanding: 0.1, loadIndex: 1 } },
      { role: 'assistant', peer: true, analysis: { understanding: 0.9, loadIndex: 0.1 } },
    ]);
    expect(observations).toHaveLength(1);
    expect(observations[0].understanding).toBe(0.5);
  });

  it('缺失字段记 null（不猜默认值），越界值 clamp 到 0-1', () => {
    const observations = extractSessionTurnObservations([
      { role: 'user', analysis: { loadIndex: 1.7, understanding: '0.5' } },
      { role: 'user', analysis: { loadIndex: 'abc' } },
    ]);
    expect(observations[0].loadIndex).toBe(1);
    expect(observations[0].understanding).toBe(0.5);
    expect(observations[0].engagement).toBeNull();
    expect(observations[0].emotionalState).toBeNull();
    expect(observations[0].confusionCount).toBeNull();
    expect(observations[0].mastery).toBeNull();
    expect(observations[1].loadIndex).toBeNull();
  });

  it('无法识别的情绪值记 null，不参与加权', () => {
    const observations = extractSessionTurnObservations([
      { role: 'user', analysis: { emotionalState: 'excited' } },
    ]);
    expect(observations[0].emotionalState).toBeNull();
  });

  it('无 analysis 的消息 ⇒ 无可评估观测 ⇒ 零证据兜底', () => {
    const result = aggregateSessionEvaluationFromMessages([
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '你好' },
    ]);
    expect(result.basis).toBe('zero-evidence');
    expect(result.lss).toBe(3);
    expect(result.confidence).toBe(0.1);
  });
});

describe('session-evaluation-aggregate：影子双写载荷', () => {
  it('并存 LLM 与确定性结果，并给出 delta（不改写任何一方）', () => {
    const deterministic = aggregateSessionEvaluation([allLow(), allLow(), allLow(), allLow()]);
    const shadow = buildSessionEvaluationShadow({
      llm: {
        sessionLss: 2,
        sessionKtl: 7,
        sessionLf: 1,
        confidence: 0.8,
        metricTiers: { sessionLss: 'low', sessionKtl: 'mid', sessionLf: 'low' },
      },
      deterministic,
      recordedAt: '2026-09-22T00:00:00.000Z',
    });

    expect(shadow.formulaVersion).toBe(FORMULA_VERSION);
    expect(shadow.recordedAt).toBe('2026-09-22T00:00:00.000Z');
    expect(shadow.llm).toEqual({
      lss: 2,
      ktl: 7,
      lf: 1,
      confidence: 0.8,
      tiers: { sessionLss: 'low', sessionKtl: 'mid', sessionLf: 'low' },
      tierRanges: {
        sessionLss: { value: 2.5, min: 1, max: 4, uncertainty: 1.5 },
        sessionKtl: { value: 6, min: 5, max: 7, uncertainty: 1 },
        sessionLf: { value: 2.5, min: 1, max: 4, uncertainty: 1.5 },
      },
    });
    expect(shadow.delta).toEqual({
      lss: Math.round((deterministic.lss - 2) * 100) / 100,
      ktl: Math.round((deterministic.ktl - 7) * 100) / 100,
      lf: Math.round((deterministic.lf - 1) * 100) / 100,
    });
    // 确定性结果原样保留
    expect(shadow.deterministic.lss).toBe(deterministic.lss);
    expect(shadow.deterministic.basis).toBe('per-turn-observations');
  });

  it('LLM 缺失（evaluation=null）时 llm/delta 为 null，确定性结果仍记录', () => {
    const shadow = buildSessionEvaluationShadow({
      llm: null,
      deterministic: aggregateSessionEvaluation([allHigh()]),
      recordedAt: '2026-09-22T00:00:00.000Z',
    });
    expect(shadow.llm).toBeNull();
    expect(shadow.delta).toBeNull();
    expect(shadow.deterministic.turnCount).toBe(1);
  });

  it('legacy 数值（无档位）时 tiers / tierRanges 为 null，delta 仍计算', () => {
    const shadow = buildSessionEvaluationShadow({
      llm: { sessionLss: 5, sessionKtl: 5, sessionLf: 5, confidence: 0.5 },
      deterministic: aggregateSessionEvaluation([allLow()]),
      recordedAt: '2026-09-22T00:00:00.000Z',
    });
    expect(shadow.llm?.tiers).toEqual({ sessionLss: null, sessionKtl: null, sessionLf: null });
    expect(shadow.llm?.tierRanges).toEqual({ sessionLss: null, sessionKtl: null, sessionLf: null });
    expect(shadow.delta).not.toBeNull();
  });
});
