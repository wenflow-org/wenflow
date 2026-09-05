import { normalizePathHoursFromTasks } from '../learning.service';

/**
 * 「预计投入」归一试：展示时长必须以任务分钟汇总为准（ceil 整小时），
 * 骨架期 path-planning 的 LLM 粗估只保留在 estimatedHoursRaw 供内部参考。
 */
describe('normalizePathHoursFromTasks', () => {
  it('路径小时 = Σ阶段任务分钟汇总（ceil），LLM 粗估保留在 raw', () => {
    const path = {
      estimatedHours: 40,
      milestones: [
        {
          id: 'm1',
          stageNumber: 1,
          estimatedHours: 24,
          subtasks: [
            { id: 't1', estimatedMinutes: 60 },
            { id: 't2', estimatedMinutes: 90 },
            { id: 't3', estimatedMinutes: 45 },
          ],
        },
        {
          id: 'm2',
          stageNumber: 2,
          estimatedHours: 16,
          subtasks: [
            { id: 't4', estimatedMinutes: 120 },
            { id: 't5', estimatedMinutes: 90 },
          ],
        },
      ],
    };

    const result = normalizePathHoursFromTasks(path as any);

    // 阶段1: (60+90+45)=195min → ceil(3.25)=4h；阶段2: (120+90)=210min → ceil(3.5)=4h
    expect(result.milestones[0].estimatedHours).toBe(4);
    expect(result.milestones[1].estimatedHours).toBe(4);
    // 路径 = Σ阶段 = 8h（不再是 LLM 粗估 40h）
    expect(result.estimatedHours).toBe(8);
    // LLM 粗估保留供内部参考
    expect(result.estimatedHoursRaw).toBe(40);
    expect(result.milestones[0].estimatedHoursRaw).toBe(24);
    expect(result.milestones[1].estimatedHoursRaw).toBe(16);
  });

  it('分钟数向上取整到整小时（至少 1h）', () => {
    const path = {
      estimatedHours: 3,
      milestones: [
        {
          id: 'm1',
          estimatedHours: 2,
          subtasks: [
            { id: 't1', estimatedMinutes: 30 },
            { id: 't2', estimatedMinutes: 25 },
          ],
        },
      ],
    };
    const result = normalizePathHoursFromTasks(path as any);
    // 55min → 1h（ceil）
    expect(result.milestones[0].estimatedHours).toBe(1);
    expect(result.estimatedHours).toBe(1);
  });

  it('无任务（骨架期/生成中）时保留 LLM 原值', () => {
    const path = {
      estimatedHours: 12,
      milestones: [
        { id: 'm1', estimatedHours: 6, subtasks: [] },
        { id: 'm2', estimatedHours: 6, subtasks: [] },
      ],
    };
    const result = normalizePathHoursFromTasks(path as any);
    expect(result.estimatedHours).toBe(12);
    expect(result.milestones[0].estimatedHours).toBe(6);
    expect(result.estimatedHoursRaw).toBe(12);
  });

  it('部分阶段有任务时只归一有任务的阶段，路径按已归一阶段求和', () => {
    const path = {
      estimatedHours: 30,
      milestones: [
        {
          id: 'm1',
          estimatedHours: 10,
          subtasks: [
            { id: 't1', estimatedMinutes: 30 },
            { id: 't2', estimatedMinutes: 30 },
          ],
        },
        { id: 'm2', estimatedHours: 20, subtasks: [] },
      ],
    };
    const result = normalizePathHoursFromTasks(path as any);
    // m1: 60min → 1h；m2 无任务保留 20h；路径 = 1 + 20 = 21h
    expect(result.milestones[0].estimatedHours).toBe(1);
    expect(result.milestones[1].estimatedHours).toBe(20);
    expect(result.estimatedHours).toBe(21);
  });

  it('任务缺省分钟按 0 处理，全 0 时阶段至少 1h', () => {
    const path = {
      estimatedHours: 5,
      milestones: [
        {
          id: 'm1',
          estimatedHours: 5,
          subtasks: [{ id: 't1' }, { id: 't2', estimatedMinutes: 0 }],
        },
      ],
    };
    const result = normalizePathHoursFromTasks(path as any);
    expect(result.milestones[0].estimatedHours).toBe(1);
    expect(result.estimatedHours).toBe(1);
  });
});
