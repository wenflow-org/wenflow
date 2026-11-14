import { buildMissingFieldQuestion, hasThinProposalPayload } from '../index';

/**
 * 修复批 17-①（u19 GOAL_STUCK_LOOP critical）：硬字段压回后若让模型自然续写，它会重发方案
 * 再要确认，学员确认又被 stage 门挡在裁决外——双向死锁 10 分钟。压回时把缺失字段转成
 * 确定性收集提问，把对话强制转向「补字段」。
 */
describe('buildMissingFieldQuestion（压回死锁破解）', () => {
  it('病历单形态：time_budget/time_horizon 缺失 → 时间安排收集提问', () => {
    expect(buildMissingFieldQuestion(['available_resources.time_budget/time_horizon(缺失)']))
      .toContain('每周练几天');
    expect(buildMissingFieldQuestion(['available_resources.time_budget/time_horizon(未明确)']))
      .toContain('时间安排');
  });

  it('时间锚点类字段 → 截止时间提问', () => {
    expect(buildMissingFieldQuestion(['constraints.deadline(缺失)'])).toContain('截止时间');
  });

  it('未映射字段 → 通用模板带字段名；空数组 → null', () => {
    expect(buildMissingFieldQuestion(['learner_profile.goal_intensity(缺失)'])).toContain('learner_profile.goal_intensity');
    expect(buildMissingFieldQuestion([])).toBeNull();
  });

  it('hasThinProposalPayload 联动：缺 time_budget 时 missing 含该字段', () => {
    const check = hasThinProposalPayload({
      understanding: { available_resources: {} },
      confirmedProposal: { learning_direction: '汇报表达' },
      structuredData: {},
    });
    expect(check.missing.some((m) => /time_budget/i.test(m))).toBe(true);
  });
});
