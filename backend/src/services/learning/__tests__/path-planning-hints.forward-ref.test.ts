import { repairForwardReferences } from '../path-planning-hints';

/**
 * R4 外部评审：拓扑重排后残留「T3 基于任务4」「T1 用任务2底稿」。
 * 修法只做两件保守的事：靠后的 acquire 前移；其余前向数字改成标题引用。
 */
describe('repairForwardReferences（前向任务引用）', () => {
  it('T1 deconstruct 引用后面的 acquire → acquire 前移并按新顺序重编号', () => {
    const tasks = [
      { title: '拆 R̂ 与发散计数', type: 'deconstruct', description: '用任务2整理出的三信号现状底稿做拆解' },
      { title: '整理三信号现状底稿', type: 'acquire', description: '逐项写清三个信号' },
      { title: '合成判读卡', type: 'model', description: '把前两步合成判读卡' },
    ];
    const out = repairForwardReferences(tasks);
    expect(out.tasks.map((t) => t.type)).toEqual(['acquire', 'deconstruct', 'model']);
    expect(out.tasks[1].description).toContain('任务1');
    expect(out.tasks[1].description).not.toContain('任务2');
    expect(out.repaired.some((x) => x.startsWith('move-acquire'))).toBe(true);
  });

  it('T3 model 引用后面的 refine → 不改动顺序，数字改写为标题', () => {
    const tasks = [
      { title: '拆要件', type: 'deconstruct', description: '拆五类要件' },
      { title: '核依据', type: 'diagnose', description: '逐条核对依据' },
      { title: '补初稿', type: 'model', description: '基于任务4标出的缺口与错数补初稿' },
      { title: '标缺口', type: 'refine', description: '对照现有协议标出缺口与错数' },
    ];
    const out = repairForwardReferences(tasks);
    expect(out.tasks.map((t) => t.type)).toEqual(['deconstruct', 'diagnose', 'model', 'refine']);
    expect(out.tasks[2].description).toContain('「标缺口」');
    expect(out.tasks[2].description).not.toContain('任务4');
  });

  it('已经正序的引用不动（零行为变化）', () => {
    const tasks = [
      { title: '收集', type: 'acquire', description: '收集材料' },
      { title: '建模', type: 'model', description: '基于任务1的材料建模' },
    ];
    const out = repairForwardReferences(tasks);
    expect(out.tasks).toEqual(tasks);
    expect(out.repaired).toEqual([]);
  });
});
