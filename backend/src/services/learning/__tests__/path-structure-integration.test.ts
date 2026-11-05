import { reorderStageTasks } from '../generation/path-structure-integration';
import { bindKcLinksToSubtaskIds } from '../generation/kc-annotation';

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
    const edges = reorderStageTasks(stages, annotation);
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
    const edges = reorderStageTasks(stages, annotation);
    expect(edges).toBe(0);
    expect(stages[0].subtasks.map((task) => task.title)).toEqual(['写一遍接收路径', '复述整条解封装路径']);
    expect(stages[0].subtasks[0].description).toBe('用任务2标好的边界');
  });
});

/**
 * issue #179 断点②：稳定键 taskKey 不能挂在对象身份（WeakMap）上——同阶段重排
 * （remapStageTaskReferences/repairForwardReferences）用浅拷贝 `{ ...task }` 换掉任务对象，
 * 身份一换就查不到；键必须作为自身属性随浅拷贝流动，落库后受影响子任务 taskId 才非空。
 */
describe('reorderStageTasks × 稳定键（issue #179）：重排换对象后 taskKey 随数据流动', () => {
  const annotation = {
    kcGraph: { edges: [{ from: 'kc-a', to: 'kc-m' }] },
    taskKcLinks: [
      { taskKey: 'task-1-0', taskTitle: '模型化', linkedKCs: ['kc-m'] },
      { taskKey: 'task-1-1', taskTitle: '收束', linkedKCs: [] },
      { taskKey: 'task-1-2', taskTitle: '建立', linkedKCs: ['kc-a'] },
    ],
  };

  it('前置任务重排换掉任务对象后，各任务的 taskKey 仍随对象流动', () => {
    const stages = [{
      stageNumber: 1,
      subtasks: [
        { title: '模型化', type: 'model', description: '用任务3的结论画图', taskKey: 'task-1-0' },
        { title: '收束', type: 'consolidate', description: '', taskKey: 'task-1-1' },
        { title: '建立', type: 'acquire', description: '', taskKey: 'task-1-2' },
      ],
    }];

    expect(reorderStageTasks(stages, annotation)).toBeGreaterThan(0);
    // 建立从第 3 位前移到第 1 位；对象已被浅拷贝替换，键靠自身属性存活。
    const byTitle = new Map(stages[0].subtasks.map((task) => [task.title, task]));
    expect(byTitle.get('建立')!.taskKey).toBe('task-1-2');
    expect(byTitle.get('模型化')!.taskKey).toBe('task-1-0');
    expect(byTitle.get('收束')!.taskKey).toBe('task-1-1');
  });

  it('重排后把 taskKey 绑到真实 subtasks.id：受影响子任务的 taskId 非空', () => {
    const stages = [{
      stageNumber: 1,
      subtasks: [
        { title: '模型化', type: 'model', description: '用任务3的结论画图', taskKey: 'task-1-0' },
        { title: '收束', type: 'consolidate', description: '', taskKey: 'task-1-1' },
        { title: '建立', type: 'acquire', description: '', taskKey: 'task-1-2' },
      ],
    }];
    reorderStageTasks(stages, annotation);

    // 模拟写侧：按（重排后产生的新对象上的）taskKey 登记真实 id，再绑到 kc 链接。
    const subtaskIdByTaskKey = new Map<string, string>();
    stages[0].subtasks.forEach((task, index) => subtaskIdByTaskKey.set(String(task.taskKey), `st_${index}`));
    const bound = bindKcLinksToSubtaskIds(annotation, subtaskIdByTaskKey)!;

    // 每一条链接都应绑上非空 id（若键依赖对象身份，这里全为 undefined）。
    for (const link of bound.taskKcLinks!) {
      expect(link.taskId).toBeTruthy();
    }
    const establish = bound.taskKcLinks!.find((link) => link.taskKey === 'task-1-2')!;
    expect(establish.taskId).toBe(subtaskIdByTaskKey.get('task-1-2'));
  });
});
