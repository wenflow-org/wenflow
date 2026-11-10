/**
 * thinCheck 压回判据单测（2026-11-08 判据升级 + 补锁定——此前 hasThinProposalPayload
 * 未导出、proposing→understanding 压回分支零测试）。
 *
 * 判据口径：硬必需字段缺失（routing 表驱动，缓存冷回落硬编码）+ real_problem 实质性
 * （<6 字 = 症状级；与 surface_goal 二字组重叠率 ≥0.6 = 同义改写）。
 * 压回动作：proposing → understanding、confidence 钳 ≤0.78（parseGoalConversationResponse）。
 */
import { hasThinProposalPayload, parseGoalConversationResponse } from '../index';

function payloadWith(overrides: {
  real_problem?: string;
  surface_goal?: string;
  time_budget?: string;
  learning_direction?: string;
  first_deliverable?: string;
  key_stages?: string[];
}) {
  return {
    understanding: {
      surface_goal: overrides.surface_goal ?? '学会用函数把月度报表自动汇总',
      real_problem: overrides.real_problem ?? '每次拼月报都要手工对数，费时还容易错',
      available_resources: { time_budget: overrides.time_budget ?? '每天晚上半小时' },
      success_criteria: { observable_result: '打开模板即自动完成汇总与对数' },
    },
    confirmedProposal: {
      learning_direction: overrides.learning_direction ?? '把手工月报改造成公式自动汇总的模板',
      first_deliverable: overrides.first_deliverable ?? '一张能用的月报汇总模板雏形',
      key_stages: overrides.key_stages ?? ['统一汇总结构', '公式自动抓数', '模板固化复用'],
      out_of_scope: [],
    },
    structuredData: {},
  };
}

describe('hasThinProposalPayload：real_problem 实质性（二字组重叠）', () => {
  it('完整诊断 → 不 thin', () => {
    expect(hasThinProposalPayload(payloadWith({})).thin).toBe(false);
  });

  it('real_problem <6 字 = 症状级 → thin', () => {
    const result = hasThinProposalPayload(payloadWith({ real_problem: '写不好' }));
    expect(result.thin).toBe(true);
    expect(result.missing.join('；')).toContain('real_problem');
  });

  it('real_problem 是 surface_goal 的复述（二字组全含）→ thin（同义改写）', () => {
    const result = hasThinProposalPayload(payloadWith({
      surface_goal: '月度复盘总是抓不住重点',
      real_problem: '复盘总是抓不住重点',
    }));
    expect(result.thin).toBe(true);
    expect(result.missing.join('；')).toContain('real_problem');
  });

  it('真换说法的诊断（二字组重叠低）→ 不 thin（旧单字口径会误判）', () => {
    const result = hasThinProposalPayload(payloadWith({
      surface_goal: '学会用函数把月度报表自动汇总',
      real_problem: '每次拼月报都要在几个表之间来回复制粘贴，公式一改全乱',
    }));
    expect(result.thin).toBe(false);
  });
});

describe('hasThinProposalPayload：硬必需字段缺失', () => {
  it('时间是「未明确」→ thin', () => {
    const result = hasThinProposalPayload(payloadWith({ time_budget: '未明确' }));
    expect(result.thin).toBe(true);
    expect(result.missing.join('；')).toContain('time_budget/time_horizon');
  });

  it('key_stages 只有 1 条 → thin（需 ≥2）', () => {
    const result = hasThinProposalPayload(payloadWith({ key_stages: ['只有一个阶段'] }));
    expect(result.thin).toBe(true);
    expect(result.missing.join('；')).toContain('key_stages');
  });
});

describe('parseGoalConversationResponse：proposing 载荷过薄 → 压回 understanding', () => {
  const buildModelOutput = (understanding: Record<string, unknown>) => JSON.stringify({
    reply: '这版方向先聚焦复盘结论提炼。',
    state: { stage: 'proposing', confidence: 0.9, done: false },
    understanding,
    nextQuestions: [],
    quickReplies: [],
    confirmedProposal: {
      learning_direction: '把手工月报改造成公式自动汇总的模板',
      first_deliverable: '一张能用的月报汇总模板雏形',
      key_stages: ['统一汇总结构', '公式自动抓数', '模板固化复用'],
      out_of_scope: [],
    },
  });

  it('real_problem 症状级 → stage 压回 understanding、confidence 钳 ≤0.78', () => {
    const result = parseGoalConversationResponse(buildModelOutput({
      surface_goal: '学会用函数把月度报表自动汇总',
      real_problem: '写不好',
      available_resources: { time_budget: '每天晚上半小时' },
      success_criteria: { observable_result: '打开模板即自动完成汇总与对数' },
    }));
    expect(result.internal.core.stage).toBe('understanding');
    expect(result.internal.core.confidence).toBeLessThanOrEqual(0.78);
  });

  it('载荷齐备 → 维持 proposing、confidence 不被钳', () => {
    const result = parseGoalConversationResponse(buildModelOutput({
      surface_goal: '学会用函数把月度报表自动汇总',
      real_problem: '每次拼月报都要手工对数，费时还容易错',
      available_resources: { time_budget: '每天晚上半小时' },
      success_criteria: { observable_result: '打开模板即自动完成汇总与对数' },
    }));
    expect(result.internal.core.stage).toBe('proposing');
    expect(result.internal.core.confidence).toBe(0.9);
  });
});
