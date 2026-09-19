import {
  aggregateCallCosts,
  describePricingStatus,
  groupCosts,
  summarizeCallCosts,
  UNATTRIBUTED_KEY,
  NO_SESSION_KEY,
  type CostInputRow,
} from '../call-cost-aggregation';
import type { PricingTable } from '../model-cost';

/** 单元测试用单价表（覆盖默认空表；不写入 models.config） */
const PRICED: PricingTable = [
  { id: 'test-model', provider: 'deepseek', pricing: { inputPer1M: 1, cachedInputPer1M: 0.25, outputPer1M: 2 } },
  { id: 'no-price-model', provider: 'agnes' },
];

function row(partial: Partial<CostInputRow> & Pick<CostInputRow, 'model'>): CostInputRow {
  return {
    promptTokens: 0,
    completionTokens: 0,
    ...partial,
  };
}

describe('summarizeCallCosts', () => {
  it('有单价：金额按 input(含缓存拆分) + output 正确累加', () => {
    const totals = summarizeCallCosts(
      [
        // 1M 未命中输入 @1/1M = $1
        row({ model: 'test-model', promptTokens: 1_000_000 }),
        // 1M 输出 @2/1M = $2
        row({ model: 'test-model', completionTokens: 1_000_000 }),
        // 800k 命中缓存 @0.25/1M = $0.2，200k 未命中 @1/1M = $0.2
        row({ model: 'test-model', promptTokens: 1_000_000, cachedTokens: 800_000 }),
      ],
      { pricingTable: PRICED },
    );

    expect(totals.calls).toBe(3);
    expect(totals.pricedCalls).toBe(3);
    expect(totals.callsMissingPricing).toBe(0);
    expect(totals.pricingKnown).toBe(true);
    expect(totals.usd).toBeCloseTo(3.4, 12);
    expect(totals.promptTokens).toBe(2_000_000);
    expect(totals.completionTokens).toBe(1_000_000);
  });

  it('无单价：usd=null / pricingKnown=false / callsMissingPricing 计数正确（绝不用 0 冒充）', () => {
    const totals = summarizeCallCosts(
      [
        row({ model: 'no-price-model', promptTokens: 100, completionTokens: 50 }),
        row({ model: 'ghost-model', promptTokens: 10, completionTokens: 5 }),
        row({ model: '', promptTokens: 1, completionTokens: 1 }),
      ],
      { pricingTable: PRICED },
    );

    expect(totals.calls).toBe(3);
    expect(totals.pricedCalls).toBe(0);
    expect(totals.callsMissingPricing).toBe(3);
    expect(totals.usd).toBeNull();
    expect(totals.pricingKnown).toBe(false);
  });

  it('混合：usd 只含已定价调用（部分金额），pricingKnown=false 且计数正确', () => {
    const totals = summarizeCallCosts(
      [
        row({ model: 'test-model', promptTokens: 1_000_000 }), // $1
        row({ model: 'ghost-model', promptTokens: 500_000 }),
      ],
      { pricingTable: PRICED },
    );
    expect(totals.usd).toBeCloseTo(1, 12);
    expect(totals.pricedCalls).toBe(1);
    expect(totals.callsMissingPricing).toBe(1);
    expect(totals.pricingKnown).toBe(false);
  });

  it('缺 cachedInputPer1M 时缓存部分回退按输入全价（与 model-cost 既有语义一致）', () => {
    const totals = summarizeCallCosts(
      [row({ model: 'fallback-model', promptTokens: 1_000_000, cachedTokens: 500_000 })],
      {
        pricingTable: [
          { id: 'fallback-model', provider: 'deepseek', pricing: { inputPer1M: 1, outputPer1M: 0 } },
        ],
      },
    );
    expect(totals.pricingKnown).toBe(true);
    expect(totals.usd).toBeCloseTo(1, 12);
  });

  it('空行数组返回零值（usd=null，不是 0）', () => {
    const totals = summarizeCallCosts([], { pricingTable: PRICED });
    expect(totals).toEqual({
      calls: 0,
      promptTokens: 0,
      completionTokens: 0,
      usd: null,
      pricingKnown: true,
      callsMissingPricing: 0,
      pricedCalls: 0,
    });
  });
});

describe('groupCosts', () => {
  it('按 key 分组，空 key 归入 fallbackKey（默认未归因）', () => {
    const groups = groupCosts(
      [
        row({ model: 'test-model', promptTokens: 1_000_000, skillId: 'teaching-turn' }),
        row({ model: 'test-model', promptTokens: 1_000_000, skillId: 'teaching-turn' }),
        row({ model: 'test-model', promptTokens: 1_000_000, skillId: null }),
      ],
      (r) => r.skillId,
      { pricingTable: PRICED },
    );

    expect(groups.map((g) => g.key)).toEqual(['teaching-turn', UNATTRIBUTED_KEY]);
    const teaching = groups[0];
    expect(teaching.calls).toBe(2);
    expect(teaching.usd).toBeCloseTo(2, 12);
    expect(teaching.pricingKnown).toBe(true);

    const unattributed = groups[1];
    expect(unattributed.calls).toBe(1);
    expect(unattributed.usd).toBeCloseTo(1, 12);
  });
});

describe('aggregateCallCosts（按模型 / 会话 / 技能 / 节点分组）', () => {
  const rows: CostInputRow[] = [
    row({
      model: 'test-model',
      promptTokens: 1_000_000,
      completionTokens: 0,
      sessionId: 's1',
      skillId: 'teaching-turn',
      agentId: 'skill:teaching-turn',
      userId: 'u1',
    }),
    row({
      model: 'test-model',
      promptTokens: 0,
      completionTokens: 1_000_000,
      sessionId: 's1',
      skillId: 'teaching-turn',
      agentId: 'skill:teaching-turn',
      userId: 'u1',
    }),
    row({
      model: 'no-price-model',
      promptTokens: 100,
      completionTokens: 50,
      sessionId: 's2',
      skillId: 'goal-conversation',
      agentId: 'skill:goal-conversation',
      userId: 'u2',
    }),
    row({
      model: null,
      promptTokens: 10,
      completionTokens: 5,
      sessionId: null,
      skillId: null,
      agentId: null,
      userId: null,
    }),
  ];

  it('总量：已定价 $3，1 次未定价，pricingKnown=false', () => {
    const agg = aggregateCallCosts(rows, { pricingTable: PRICED });
    expect(agg.totals.calls).toBe(4);
    expect(agg.totals.pricedCalls).toBe(2);
    expect(agg.totals.callsMissingPricing).toBe(2);
    expect(agg.totals.usd).toBeCloseTo(3, 12);
    expect(agg.totals.pricingKnown).toBe(false);
  });

  it('按模型分组正确：金额 / 计数 / token 合计', () => {
    const agg = aggregateCallCosts(rows, { pricingTable: PRICED });
    const byModel = new Map(agg.byModel.map((b) => [b.key, b]));

    const priced = byModel.get('test-model')!;
    expect(priced.calls).toBe(2);
    expect(priced.usd).toBeCloseTo(3, 12);
    expect(priced.pricingKnown).toBe(true);
    expect(priced.promptTokens).toBe(1_000_000);
    expect(priced.completionTokens).toBe(1_000_000);

    const unpriced = byModel.get('no-price-model')!;
    expect(unpriced.calls).toBe(1);
    expect(unpriced.usd).toBeNull();
    expect(unpriced.pricingKnown).toBe(false);
    expect(unpriced.callsMissingPricing).toBe(1);

    expect(byModel.get(UNATTRIBUTED_KEY)!.usd).toBeNull();
  });

  it('按会话分组正确：s1 已定价 / s2 未定价 / 无会话归入 (无会话)', () => {
    const agg = aggregateCallCosts(rows, { pricingTable: PRICED });
    const bySession = new Map(agg.bySession.map((b) => [b.key, b]));

    expect(bySession.get('s1')!.calls).toBe(2);
    expect(bySession.get('s1')!.usd).toBeCloseTo(3, 12);
    expect(bySession.get('s1')!.pricingKnown).toBe(true);
    expect(bySession.get('s2')!.calls).toBe(1);
    expect(bySession.get('s2')!.usd).toBeNull();
    expect(bySession.get(NO_SESSION_KEY)!.calls).toBe(1);
  });

  it('按技能 / 节点分组正确：skillId 与 agentId 各自分摊', () => {
    const agg = aggregateCallCosts(rows, { pricingTable: PRICED });
    const bySkill = new Map(agg.bySkill.map((b) => [b.key, b]));
    const byAgent = new Map(agg.byAgent.map((b) => [b.key, b]));

    expect(bySkill.get('teaching-turn')!.calls).toBe(2);
    expect(bySkill.get('teaching-turn')!.usd).toBeCloseTo(3, 12);
    expect(bySkill.get('goal-conversation')!.usd).toBeNull();
    expect(bySkill.get(UNATTRIBUTED_KEY)!.calls).toBe(1);

    expect(byAgent.get('skill:teaching-turn')!.usd).toBeCloseTo(3, 12);
    expect(byAgent.get('skill:goal-conversation')!.calls).toBe(1);
  });

  it('pricingStatus：出现过的已配置 / 待补模型（原始名去重）', () => {
    const agg = aggregateCallCosts(rows, { pricingTable: PRICED });
    expect(agg.pricingStatus.configuredModels).toEqual(['test-model']);
    expect(agg.pricingStatus.missingPricingModels).toEqual(['no-price-model']);
  });
});

describe('describePricingStatus', () => {
  it('使用默认（占位空）单价表时，所有出现过的模型都进入待补清单', () => {
    const status = describePricingStatus(['deepseek-v4-flash', 'deepseek-v4-flash', 'agnes-3.0-flash']);
    expect(status.configuredModels).toEqual([]);
    expect(status.missingPricingModels).toEqual(['deepseek-v4-flash', 'agnes-3.0-flash']);
  });

  it('空对象 pricing: {} 视为未配置', () => {
    const status = describePricingStatus(['empty-pricing'], [
      { id: 'empty-pricing', provider: 'agnes', pricing: {} },
    ]);
    expect(status.configuredModels).toEqual([]);
    expect(status.missingPricingModels).toEqual(['empty-pricing']);
  });
});
