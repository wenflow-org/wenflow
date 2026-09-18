/**
 * 前序学习上下文口径回归（走查 P3）。
 *
 * 现象：全新用户第一个任务的开场就说「前面关于环境配置和数据读取的基础
 * 已经建立好，现在我们…」。
 * 根因：`buildPriorMilestoneMastery` 把**当前路径上所有阶段**都收进
 * priorMilestoneMastery（全新学习者 = completedTasks:0 / masteryState:'unknown'），
 * 于是 `priorLearningContext` 恒为真值，开场提示词第 45 条便指示模型
 * 「开场可自然带一句'前面 X 已经稳了'」。
 */
import { buildPriorMilestoneMastery, readRecentFrustrationStreak } from '../TeachingContextBuilder';

const snapshotWith = (milestoneProgress: unknown) => ({
  knowledgeMemory: { currentPath: { milestoneProgress } },
});

describe('buildPriorMilestoneMastery（前序阶段掌握汇总）', () => {
  it('全新学习者：所有阶段未开始 → 空（不得让开场声称「前面已经建立好」）', () => {
    const result = buildPriorMilestoneMastery(snapshotWith([
      { stageNumber: 1, title: '建立环境', masteryState: 'unknown', completedTasks: 0, totalTasks: 2 },
      { stageNumber: 2, title: '核心技能', masteryState: 'unknown', completedTasks: 0, totalTasks: 2 },
      { stageNumber: 3, title: '异常处理', masteryState: 'unknown', completedTasks: 0, totalTasks: 2 },
    ]));
    expect(result).toEqual([]);
  });

  it('有已学阶段时保留该阶段（含掌握状态与完成数）', () => {
    const result = buildPriorMilestoneMastery(snapshotWith([
      { stageNumber: 1, title: '建立环境', masteryState: 'stable', completedTasks: 2, totalTasks: 2 },
      { stageNumber: 2, title: '核心技能', masteryState: 'partial', completedTasks: 1, totalTasks: 2 },
      { stageNumber: 3, title: '异常处理', masteryState: 'unknown', completedTasks: 0, totalTasks: 2 },
    ]));
    expect(result.map((m) => m.stageNumber)).toEqual([1, 2]);
    expect(result[0]).toMatchObject({ masteryState: 'stable', completedTasks: 2, totalTasks: 2 });
  });

  it('缺字段/非数组时安全返回空', () => {
    expect(buildPriorMilestoneMastery(null)).toEqual([]);
    expect(buildPriorMilestoneMastery({})).toEqual([]);
    expect(buildPriorMilestoneMastery(snapshotWith('not-an-array'))).toEqual([]);
    expect(buildPriorMilestoneMastery(snapshotWith([null, { stageNumber: 'x' }]))).toEqual([]);
  });
});

/**
 * 情感闭环（§4.5）的取数口：连续受挫轮数来自上一节课的会话状态。
 * 只读且必须防御式——"读不到"不能被当成"受挫"（否则会莫名降档）。
 */
describe('readRecentFrustrationStreak（上一节课的连续受挫轮数）', () => {
  it('对象形态：取 learnerStateContext.frustratedStreak', () => {
    expect(readRecentFrustrationStreak({ teachingState: { learnerStateContext: { frustratedStreak: 3 } } })).toBe(3);
  });

  it('字符串形态（JSON 列）同样能取', () => {
    expect(readRecentFrustrationStreak({
      teachingState: JSON.stringify({ learnerStateContext: { frustratedStreak: 2 } }),
    })).toBe(2);
  });

  it('缺失/非法/负数一律 0（读不到 ≠ 受挫）', () => {
    expect(readRecentFrustrationStreak(null)).toBe(0);
    expect(readRecentFrustrationStreak(undefined)).toBe(0);
    expect(readRecentFrustrationStreak({})).toBe(0);
    expect(readRecentFrustrationStreak({ teachingState: 'not-json' })).toBe(0);
    expect(readRecentFrustrationStreak({ teachingState: { learnerStateContext: {} } })).toBe(0);
    expect(readRecentFrustrationStreak({ teachingState: { learnerStateContext: { frustratedStreak: -1 } } })).toBe(0);
    expect(readRecentFrustrationStreak({ teachingState: { learnerStateContext: { frustratedStreak: 'x' } } })).toBe(0);
  });
});
