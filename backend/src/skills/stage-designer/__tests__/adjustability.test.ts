/**
 * 任务可调整性（动态规划，2026-10-17）：
 * stage-designer 必须把 core|flexible 落到任务上，重排压缩才有「保护骨干、优先删减」的语义。
 * 模型未标注时按任务类型确定性兜底（建立/拆解/诊断=flexible，其余=core）。
 */
import { normalizeSubtasks } from '../index';

describe('stage-designer adjustability', () => {
  it('保留模型显式标注的 core/flexible', () => {
    const tasks = normalizeSubtasks(
      [
        { title: '真实交付：写出第一版方案', type: 'execute', adjustability: 'core' },
        { title: '背景补读', type: 'acquire', adjustability: 'flexible' },
      ],
      null,
    );
    expect(tasks.map((task) => task.adjustability)).toEqual(['core', 'flexible']);
  });

  it('未标注时按任务类型兜底：acquire/deconstruct/diagnose=flexible，其余=core', () => {
    const tasks = normalizeSubtasks(
      [
        { title: 'A', type: 'acquire' },
        { title: 'B', type: 'deconstruct' },
        { title: 'C', type: 'diagnose' },
        { title: 'D', type: 'model' },
        { title: 'E', type: 'execute' },
        { title: 'F', type: 'refine' },
        { title: 'G', type: 'consolidate' },
      ],
      null,
    );
    expect(tasks.map((task) => task.adjustability)).toEqual([
      'flexible', 'flexible', 'flexible', 'core', 'core', 'core', 'core',
    ]);
  });

  it('非法标注值按类型兜底，不把未知字符串写进输出', () => {
    const tasks = normalizeSubtasks(
      [
        { title: 'A', type: 'acquire', adjustability: 'optional' },
        { title: 'B', type: 'execute', adjustability: 'CORE' },
      ],
      null,
    );
    expect(tasks.map((task) => task.adjustability)).toEqual(['flexible', 'core']);
  });
});
