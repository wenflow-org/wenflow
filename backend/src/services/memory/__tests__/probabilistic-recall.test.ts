/**
 * 概率化回忆（Q4）单元测试
 * ============================================================
 * 覆盖：
 *   1. 可复现性（同输入同输出；stepIndex 换流）
 *   2. 单调性（Monte Carlo：R 越低 CLEAR 均值越低）
 *   3. 无易混项 → 永不 CONFUSED
 *   4. 低相似度易混项被忽略（结果 == 无易混项）
 *   5. FAILED 仍可达（不被混淆竞争吞掉）
 *   6. 高相似度易混项在 VAGUE 档产生非零 CONFUSED
 *   7. 边界安全（R→0 / R→1 不产生 NaN）
 */

import {
  SplitMix64PRNG,
  probabilisticRecall,
  computeBaseActivation,
  buildRecallSeed,
  DEFAULT_RECALL_OPTIONS,
  SIMILARITY_GATE,
  CONFUSION_GAIN,
  CONFUSION_PENALTY,
} from '../probabilistic-recall';
import type { ProbabilisticRecallParams, ProbabilisticRecallResult } from '../probabilistic-recall';

function makeParams(overrides: Partial<ProbabilisticRecallParams> = {}): ProbabilisticRecallParams {
  return {
    experimentRunSeed: 'exp-001',
    virtualLearnerId: 'vl-42',
    sessionId: 'sess-7',
    stepIndex: 3,
    targetConceptKey: 'concept.fractions',
    retrievability: 0.5,
    ...overrides,
  };
}

function clearFraction(retrievability: number, seeds: number, prefix: string): number {
  let clear = 0;
  for (let i = 0; i < seeds; i++) {
    const res = probabilisticRecall(
      makeParams({ retrievability, experimentRunSeed: `${prefix}-${i}` }),
    );
    if (res.status === 'CLEAR') clear++;
  }
  return clear / seeds;
}

describe('probabilistic-recall: PRNG 基础', () => {
  it('SplitMix64 同种子序列一致，nextFloat ∈ [0,1)', () => {
    const a = new SplitMix64PRNG('same-seed');
    const b = new SplitMix64PRNG('same-seed');
    for (let i = 0; i < 50; i++) {
      const va = a.nextFloat();
      const vb = b.nextFloat();
      expect(va).toBe(vb);
      expect(va).toBeGreaterThanOrEqual(0);
      expect(va).toBeLessThan(1);
    }
  });

  it('不同种子产生不同序列', () => {
    const a = new SplitMix64PRNG('seed-a');
    const b = new SplitMix64PRNG('seed-b');
    const seqA = Array.from({ length: 5 }, () => a.nextFloat());
    const seqB = Array.from({ length: 5 }, () => b.nextFloat());
    expect(seqA).not.toEqual(seqB);
  });

  it('nextLogistic 输出有限（含极端 draw）', () => {
    const prng = new SplitMix64PRNG('logistic');
    for (let i = 0; i < 1000; i++) {
      const v = prng.nextLogistic(0.4);
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('buildRecallSeed 拼接五元组', () => {
    expect(buildRecallSeed(makeParams())).toBe('exp-001:vl-42:sess-7:3:concept.fractions');
  });

  it('缺省参数与提案一致', () => {
    expect(DEFAULT_RECALL_OPTIONS.deltaClear).toBe(0.6);
    expect(DEFAULT_RECALL_OPTIONS.deltaVague).toBe(0.8);
    expect(DEFAULT_RECALL_OPTIONS.threshold).toBe(0);
    expect(DEFAULT_RECALL_OPTIONS.alpha).toBe(0.8);
    expect(DEFAULT_RECALL_OPTIONS.noiseScale).toBe(0.4);
    expect(DEFAULT_RECALL_OPTIONS.cueMatchLevel).toBe(0.5);
    expect(DEFAULT_RECALL_OPTIONS.softmaxTemperature).toBe(0.8);
    expect(SIMILARITY_GATE).toBe(0.75);
    expect(CONFUSION_GAIN).toBe(0.8);
    expect(CONFUSION_PENALTY).toBe(0.7);
  });
});

describe('probabilistic-recall: 可复现性', () => {
  it('相同输入 → 逐字节相同结果', () => {
    const first = probabilisticRecall(makeParams());
    const second = probabilisticRecall(makeParams());
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('confusables 输入不改变同种子序列的确定性', () => {
    const withPool = makeParams({
      retrievability: 0.4,
      confusables: [
        { conceptKey: 'concept.decimals', similarity: 0.9 },
        { conceptKey: 'concept.percentages', similarity: 0.8 },
      ],
    });
    expect(probabilisticRecall(withPool)).toEqual(probabilisticRecall(withPool));
  });

  it('改变 stepIndex → 独立随机流（至少一个探测步产生不同结果）', () => {
    const base = probabilisticRecall(makeParams({ stepIndex: 0 }));
    let differs = false;
    for (let step = 1; step < 20; step++) {
      const probe = probabilisticRecall(makeParams({ stepIndex: step }));
      if (
        probe.sampledActivation !== base.sampledActivation ||
        probe.noiseValue !== base.noiseValue ||
        probe.status !== base.status
      ) {
        differs = true;
      }
    }
    expect(differs).toBe(true);
  });
});

describe('probabilistic-recall: 单调性（Monte Carlo）', () => {
  it('R 越低 CLEAR 均值越低（0.99 > 0.9 > 0.7 > 0.5 > 0.3）', () => {
    const seeds = 2000;
    const rValues = [0.99, 0.9, 0.7, 0.5, 0.3];
    const fractions = rValues.map((r) => clearFraction(r, seeds, `mono-${r}`));
    for (let i = 0; i < fractions.length - 1; i++) {
      expect(fractions[i]).toBeGreaterThan(fractions[i + 1]);
    }
    // 端点还应满足绝对关系：R=0.99 几乎必中，R=0.3 明显更低
    expect(fractions[0]).toBeGreaterThan(0.95);
    expect(fractions[fractions.length - 1]).toBeLessThan(0.5);
  });
});

describe('probabilistic-recall: 混淆竞争边界', () => {
  it('无易混项 → CONFUSED 永不出现', () => {
    let vague = 0;
    for (let i = 0; i < 1000; i++) {
      const res = probabilisticRecall(
        makeParams({ retrievability: 0.4, experimentRunSeed: `none-${i}` }),
      );
      expect(res.status).not.toBe('CONFUSED');
      if (res.status === 'VAGUE') vague++;
    }
    expect(vague).toBeGreaterThan(0);
  });

  it('低相似度（sim=0.5 < gate）被忽略：结果等于无易混项', () => {
    for (let i = 0; i < 200; i++) {
      const p = makeParams({ retrievability: 0.4, experimentRunSeed: `low-${i}` });
      const without: ProbabilisticRecallResult = probabilisticRecall(p);
      const withLow = probabilisticRecall({
        ...p,
        confusables: [{ conceptKey: 'concept.decimals', similarity: 0.5 }],
      });
      expect(withLow).toEqual(without);
    }
  });

  it('FAILED 仍可达（不被混淆竞争吞掉）', () => {
    let failed = 0;
    for (let i = 0; i < 2000; i++) {
      const res = probabilisticRecall(
        makeParams({ retrievability: 0.05, experimentRunSeed: `failed-${i}` }),
      );
      if (res.status === 'FAILED') failed++;
    }
    expect(failed).toBeGreaterThan(0);
  });

  it('高相似度（sim=0.9）在 VAGUE 档产生非零 CONFUSED，且输出易混项', () => {
    let vague = 0;
    let confused = 0;
    for (let i = 0; i < 2000; i++) {
      const res = probabilisticRecall(
        makeParams({
          retrievability: 0.5,
          experimentRunSeed: `conf-${i}`,
          options: { cueMatchLevel: 0.1 },
          confusables: [{ conceptKey: 'concept.decimals', similarity: 0.9 }],
        }),
      );
      if (res.status === 'VAGUE') vague++;
      if (res.status === 'CONFUSED') {
        confused++;
        expect(res.outputConceptKey).toBe('concept.decimals');
      }
    }
    expect(vague).toBeGreaterThan(0);
    expect(confused).toBeGreaterThan(0);
  });

  it('CONFUSED 仅发生在 VAGUE 档（竞争轨迹仅出现在 vague）', () => {
    for (let i = 0; i < 300; i++) {
      const res = probabilisticRecall(
        makeParams({
          retrievability: 0.5,
          experimentRunSeed: `trace-${i}`,
          options: { cueMatchLevel: 0.1 },
          confusables: [{ conceptKey: 'concept.decimals', similarity: 0.9 }],
        }),
      );
      if (res.status === 'CONFUSED') {
        expect(res.derivationTrace.band).toBe('vague');
        expect(res.derivationTrace.competition).toBeDefined();
      }
      if (res.status !== 'VAGUE' && res.status !== 'CONFUSED') {
        expect(res.derivationTrace.competition).toBeUndefined();
      }
    }
  });

  it('CONFUSED 胜者得分必须 >= threshold', () => {
    for (let i = 0; i < 500; i++) {
      const res = probabilisticRecall(
        makeParams({
          retrievability: 0.5,
          experimentRunSeed: `winner-${i}`,
          options: { cueMatchLevel: 0.1 },
          confusables: [{ conceptKey: 'concept.decimals', similarity: 0.9 }],
        }),
      );
      if (res.status === 'CONFUSED' && res.derivationTrace.competition) {
        expect(res.derivationTrace.competition.winnerScore).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('probabilistic-recall: 边界安全', () => {
  it('R→0 与 R→1 不产生 NaN', () => {
    for (const r of [0, 1, 1e-12, 1 - 1e-12, Number.NaN]) {
      const res = probabilisticRecall(makeParams({ retrievability: r }));
      expect(Number.isNaN(res.sampledActivation)).toBe(false);
      expect(Number.isNaN(res.noiseValue)).toBe(false);
      expect(Number.isNaN(res.derivationTrace.baseActivation)).toBe(false);
      expect(Number.isFinite(res.sampledActivation)).toBe(true);
    }
  });

  it('computeBaseActivation 端点有限', () => {
    expect(Number.isFinite(computeBaseActivation(0))).toBe(true);
    expect(Number.isFinite(computeBaseActivation(1))).toBe(true);
    expect(Number.isFinite(computeBaseActivation(Number.NaN))).toBe(true);
  });
});
