import { reorderStageTasks } from '../generation/path-structure-integration';

/**
 * R7-1 配套回归（独立审查 M3）：边重排改序后必须二次重映射「任务 N / 上一步」引用，
 * 否则会留下 R6 A14 那类自指（"用任务2标好的…" 而任务2正是自己）。
 */
describe('reorderStageTasks（边重排 + 二次引用重映射）', () => {
  it('前置任务前移后，描述里的「任务N」指向新位次', () => {
    const stages = [
      {
        stageNumber: 1,
        subtasks: [
          { title: '模型化', type: 'model', description: '用任务3的结论画图' },
          { title: '收束', type: 'consolidate', description: '' },
          { title: '建立', type: 'acquire', description: '' },
        ],
      },
    ];
    const annotation = {
      kcGraph: { edges: [{ from: 'kc-a', to: 'kc-m' }] },
      taskKcLinks: [
        { taskTitle: '建立', linkedKCs: ['kc-a'] },
        { taskTitle: '模型化', linkedKCs: ['kc-m'] },
      ],
    };
    const edges = reorderStageTasks(stages as any[], annotation as any);
    expect(edges).toBeGreaterThan(0);
    // 建立从第 3 位前移到第 1 位 → [建立, 模型化, 收束]
    expect(stages[0].subtasks.map((task) => task.title)).toEqual(['建立', '模型化', '收束']);
    // 「任务3」原本指「建立」，新位次是 1
    expect(stages[0].subtasks[1].description).toBe('用任务1的结论画图');
  });

  it('守卫拦住收束档前移时，不改顺序也不改引用', () => {
    const stages = [
      {
        stageNumber: 1,
        subtasks: [
          { title: '写一遍接收路径', type: 'deconstruct', description: '用任务2标好的边界' },
          { title: '复述整条解封装路径', type: 'consolidate', description: '' },
        ],
      },
    ];
    const annotation = {
      kcGraph: { edges: [{ from: 'kc-summary', to: 'kc-deconstruct' }] },
      taskKcLinks: [
        { taskTitle: '复述整条解封装路径', linkedKCs: ['kc-summary'] },
        { taskTitle: '写一遍接收路径', linkedKCs: ['kc-deconstruct'] },
      ],
    };
    const edges = reorderStageTasks(stages as any[], annotation as any);
    expect(edges).toBe(0);
    expect(stages[0].subtasks.map((task) => task.title)).toEqual(['写一遍接收路径', '复述整条解封装路径']);
    expect(stages[0].subtasks[0].description).toBe('用任务2标好的边界');
  });
});
