import { resolveScenarioBudget, buildTimeDimensionsFromBudget } from '../simulation.helpers';

/**
 * 场景卡预算锚（XIAOCHEN-REVIEW-20261002 P0-2）：
 * budget 只躺在 profile JSON ⇒ 锚链塌光，60h 预算排出 101h 且无声明。
 * 修法 = 解析 budget → 映射成 goal 层 time_dimensions 形状注入 path 生成链。
 */
describe('resolveScenarioBudget（场景卡预算解析，层级容错）', () => {
  it('从 personaSeed.scenarioCard.budget 读取（研一学生小陈的存储形状）', () => {
    const profile = {
      personaSeed: {
        scenarioCard: {
          budget: { dailyMinutes: 60, horizonDays: 60, expectedHours: 60 },
        },
      },
    };
    expect(resolveScenarioBudget(profile)).toEqual({ dailyMinutes: 60, horizonDays: 60, expectedHours: 60 });
  });

  it('顶层 scenarioCard.budget 兜底', () => {
    const profile = { scenarioCard: { budget: { dailyMinutes: 45, horizonDays: 30, expectedHours: 22 } } };
    expect(resolveScenarioBudget(profile)).toEqual({ dailyMinutes: 45, horizonDays: 30, expectedHours: 22 });
  });

  it('无 budget / 字段全非法时返回 null', () => {
    expect(resolveScenarioBudget({})).toBeNull();
    expect(resolveScenarioBudget({ personaSeed: { scenarioCard: {} } })).toBeNull();
    expect(resolveScenarioBudget({
      personaSeed: { scenarioCard: { budget: { dailyMinutes: 'abc', horizonDays: -5, expectedHours: null } } },
    })).toBeNull();
  });

  it('部分字段非法时保留可用的字段', () => {
    const result = resolveScenarioBudget({
      personaSeed: { scenarioCard: { budget: { dailyMinutes: 60, horizonDays: 'x', expectedHours: 60 } } },
    });
    expect(result).toEqual({ dailyMinutes: 60, horizonDays: null, expectedHours: 60 });
  });
});

describe('buildTimeDimensionsFromBudget（预算 → time_dimensions 映射）', () => {
  it('小陈预算：60min × 60h → 60 课 × 60min，9 周', () => {
    const result = buildTimeDimensionsFromBudget({ dailyMinutes: 60, horizonDays: 60, expectedHours: 60 });
    expect(result).toEqual({
      totalSessions: 60,
      sessionsLengthMin: 60,
      totalWeeks: 9, // ceil(60/7)
      estimatedHours: 60,
    });
  });

  it('缺 dailyMinutes 或无法推课数时返回 null', () => {
    expect(buildTimeDimensionsFromBudget({ dailyMinutes: null, horizonDays: 30, expectedHours: 20 })).toBeNull();
  });

  it('缺 horizonDays 时 totalWeeks 为 null 但仍有课次锚', () => {
    const result = buildTimeDimensionsFromBudget({ dailyMinutes: 30, horizonDays: null, expectedHours: 10 });
    expect(result).toEqual({ totalSessions: 20, sessionsLengthMin: 30, totalWeeks: null, estimatedHours: 10 });
  });
});
