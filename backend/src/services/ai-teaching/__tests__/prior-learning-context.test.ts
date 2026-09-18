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
import { buildPriorMilestoneMastery } from '../TeachingContextBuilder';

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
