/**
 * BKT 按概念难度分档（Slice 3a 的扩展点）
 * 语义：同一个"好消息"对难点的证据强度弱于对简单点——不分档会把"难点上蒙对一次"当成已掌握。
 */
import {
  BKT_PARAM_TIERS,
  DEFAULT_BKT_PARAMS,
  conceptBeliefService,
  resolveBktParamsForDifficulty,
  updateBelief,
} from '../concept-belief.service';

const learnerProjections = (require('../../../config/database').default as any).learner_projections;

describe('resolveBktParamsForDifficulty（LLM 出档位 → 代码出数值）', () => {
  it('low → easy 档；high → hard 档；medium/unknown/缺失 → 默认档', () => {
    expect(resolveBktParamsForDifficulty('low')).toEqual({ params: BKT_PARAM_TIERS.easy, tier: 'easy' });
    expect(resolveBktParamsForDifficulty('high')).toEqual({ params: BKT_PARAM_TIERS.hard, tier: 'hard' });
    expect(resolveBktParamsForDifficulty('medium').tier).toBe('medium');
    expect(resolveBktParamsForDifficulty('unknown').params).toEqual(DEFAULT_BKT_PARAMS);
    expect(resolveBktParamsForDifficulty(null).params).toEqual(DEFAULT_BKT_PARAMS);
    expect(resolveBktParamsForDifficulty(undefined).tier).toBe('medium');
  });

  it('档位参数的方向符合语义：简单点起点更高/学得更快/更少蒙对；难点相反', () => {
    const { easy, hard } = BKT_PARAM_TIERS;
    expect(easy.pL0).toBeGreaterThan(hard.pL0);
    expect(easy.pT).toBeGreaterThan(hard.pT);
    expect(easy.pG).toBeLessThan(hard.pG);
    expect(easy.pS).toBeLessThan(hard.pS);
  });
});

describe('难度分档对信念更新的实际影响', () => {
  it('同样答对一次：难点后验明显低于简单点（难点上"蒙对"不该被当成掌握）', () => {
    const prior = 0.5;
    const easy = updateBelief(prior, true, BKT_PARAM_TIERS.easy);
    const medium = updateBelief(prior, true, DEFAULT_BKT_PARAMS);
    const hard = updateBelief(prior, true, BKT_PARAM_TIERS.hard);
    expect(easy).toBeGreaterThan(medium);
    expect(medium).toBeGreaterThan(hard);
  });

  it('同样答错一次：难点的后验反而更高（难点噪声大，坏消息也更弱，不该一次就判没掌握）', () => {
    const prior = 0.6;
    const easy = updateBelief(prior, false, BKT_PARAM_TIERS.easy);
    const hard = updateBelief(prior, false, BKT_PARAM_TIERS.hard);
    expect(hard).toBeGreaterThan(easy);
    // 两个方向都比 easy 移动得少 → 难点更新更保守
    expect(Math.abs(hard - prior)).toBeLessThan(Math.abs(easy - prior));
  });

  it('参数缺省时行为与旧版一致（回归）', () => {
    expect(updateBelief(0.5, true)).toBe(updateBelief(0.5, true, DEFAULT_BKT_PARAMS));
  });
});

describe('applyObservations：按观测自带的档位参数更新，并记录所用档位', () => {
  function build() {
    const stored: any[] = [];
    // 只替换落库与读取，BKT 公式仍走真实实现（避免把逻辑测成替身）
    jest.spyOn(conceptBeliefService, 'getBeliefs').mockResolvedValue(null);
    jest.spyOn(learnerProjections, 'upsert').mockImplementation((async (args: any) => {
      stored.push(JSON.parse(args.create.payload));
      return {};
    }) as any);
    return { service: conceptBeliefService, stored };
  }

  it('难点概念用 hard 档且写入 tier；未带档位的概念沿用批次参数', async () => {
    const { service, stored } = build();
    await service.applyObservations('u1', 'p1', [
      { conceptKey: '难点概念', observed: true, params: BKT_PARAM_TIERS.hard, tier: 'hard' },
      { conceptKey: '普通概念', observed: true },
    ]);
    const payload = stored[0];
    expect(payload.beliefs['难点概念'].tier).toBe('hard');
    expect(payload.beliefs['普通概念'].tier).toBeUndefined();
    // 难点起点先验更低（pL0 0.2）+ 学习率更低 → 答对一次的后验低于普通概念
    expect(payload.beliefs['难点概念'].pKnowL).toBeLessThan(payload.beliefs['普通概念'].pKnowL);
    expect(payload.beliefs['难点概念'].observations).toBe(1);
  });
});
