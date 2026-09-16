import { buildDefaultPlan, lessonsForDay, parseArgs } from '../simulate-learner-days';

describe('simulate-learner-days（日期模拟验证脚手架）', () => {
  it('默认剧本覆盖三条断言所需的场景', () => {
    const plan = buildDefaultPlan();
    expect(plan.days).toBe(3);
    // 第 1 天：路径 A 两节难课（触发"路径隔离"与"单课难"）
    expect(lessonsForDay(plan, 0).map((lesson) => `${lesson.pathKey}${lesson.difficulty}`)).toEqual(['A9', 'A9']);
    // 第 2 天：路径 B 两节常规课（B 的第 2 节必须接 B 的第 1 节）
    expect(lessonsForDay(plan, 1).map((lesson) => lesson.pathKey)).toEqual(['B', 'B']);
    // 第 3 天：一天三节、跨两条路径（触发"当日课量"）
    const day3 = lessonsForDay(plan, 2);
    expect(day3).toHaveLength(3);
    expect(new Set(day3.map((lesson) => lesson.pathKey)).size).toBe(2);
  });

  it('必须显式 --user，默认 dry-run，--keep 才保留数据', () => {
    expect(parseArgs([])).toEqual({ apply: false, keep: false, user: null });
    expect(parseArgs(['--user=u1'])).toEqual({ apply: false, keep: false, user: 'u1' });
    expect(parseArgs(['--user=u1', '--apply']).apply).toBe(true);
    expect(parseArgs(['--user=u1', '--apply', '--keep']).keep).toBe(true);
    expect(() => parseArgs(['--user=u1', '--applyy'])).toThrow(/未知参数/);
  });
});
