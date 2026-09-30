import {
  buildSupplementRequest,
  mergeSupplementTasks,
  needsLessonSupplement,
} from '../stage-task-supplement';

const task = (title: string, minutes = 90, type?: string) => ({ title, estimatedMinutes: minutes, taskType: type });

describe('needsLessonSupplement', () => {
  it('不足锚的 70% 才触发（留 30% 容差）', () => {
    // 锚 10：7 个 = 70% → 不补；6 个 = 60% → 补
    expect(needsLessonSupplement(Array.from({ length: 7 }, (_, i) => task(`课${i}`)), 10)).toBe(false);
    expect(needsLessonSupplement(Array.from({ length: 6 }, (_, i) => task(`课${i}`)), 10)).toBe(true);
  });

  it('锚小于 2 不触发（一节课量级不该补）', () => {
    expect(needsLessonSupplement([task('唯一课')], 1)).toBe(false);
  });

  it('空产出不补（交由 assertStageTasksPresent 走重试链）', () => {
    expect(needsLessonSupplement([], 10)).toBe(false);
  });
});

describe('mergeSupplementTasks', () => {
  it('并入清单外的新方向', () => {
    const existing = [task('民法总则：民事法律关系三要素')];
    const incoming = [task('民法总则：请求权基础检索方法')];
    const { merged, added, dropped } = mergeSupplementTasks(existing, incoming, { upper: 10 });
    expect(merged).toHaveLength(2);
    expect(added).toHaveLength(1);
    expect(dropped).toHaveLength(0);
  });

  it('同阶段换皮课（标题近似 ≥0.7，与 stage-filler 同口径）被丢弃，不并回清单', () => {
    const existing = [task('串联并联电功率计算的综合自测与查漏')];
    const incoming = [
      task('串联并联电功率计算的综合自测与查漏巩固'), // 实测 0.875：纯换皮 → 丢
      task('串并联电路电功率计算的综合自测与查漏练习'), // 实测 0.632：换了对象词 → 留
    ];
    const { merged, added, dropped } = mergeSupplementTasks(existing, incoming, { upper: 10 });
    expect(merged).toHaveLength(2);
    expect(added).toHaveLength(1);
    expect(dropped).toHaveLength(1);
    expect(merged[1].title).toBe('串并联电路电功率计算的综合自测与查漏练习');
  });

  it('补课任务之间也互相去重', () => {
    const existing = [task('刑法：犯罪构成四要件初识')];
    const incoming = [task('刑法：罪名判断映射训练'), task('刑法：罪名判断映射练习')];
    const { merged, added } = mergeSupplementTasks(existing, incoming, { upper: 10 });
    // 训练/练习对实测 0.636，低于 0.7 判据——两条都留（阈值语义见 merge 注释）
    expect(merged).toHaveLength(3);
    expect(added).toHaveLength(2);
  });

  it('显式抬高阈值可拦下改写对（0.8 时 0.875 拦、0.632 仍放行）', () => {
    const existing = [task('串联并联电功率计算的综合自测与查漏')];
    const incoming = [
      task('串联并联电功率计算的综合自测与查漏巩固'),
      task('串并联电路电功率计算的综合自测与查漏练习'),
    ];
    const { merged } = mergeSupplementTasks(existing, incoming, { upper: 10, dupThreshold: 0.8 });
    expect(merged).toHaveLength(2);
    expect(merged[1].title).toBe('串并联电路电功率计算的综合自测与查漏练习');
  });
});

describe('补课动作族闸（requireTypeNovelty）', () => {
  // 2026-09-30 评审实证：补课新增课把首轮整个认知弧原样重跑（acquire→deconstruct→…→consolidate
  // 逐族重复），字面相似度却 <0.5（去重闸门完全放行）——学习者感知为「同一件事换说法」。
  const arc = ['acquire', 'deconstruct', 'diagnose', 'model', 'execute', 'refine', 'consolidate'];

  it('首轮已有的动作族被拦下（换皮重跑进不来）', () => {
    const existing = arc.map((t, i) => task(`第${i}个不同方向的课`, 60, t));
    const incoming = arc.map((t, i) => task(`同一主题的第${i}种换说法`, 60, t));
    const { merged, added, dropReasons } = mergeSupplementTasks(existing, incoming, {
      upper: 20,
      requireTypeNovelty: 'taskType',
    });
    expect(added).toHaveLength(0);
    expect(merged).toHaveLength(existing.length);
    expect(dropReasons.typeRepeat).toBe(7);
  });

  it('首轮缺失的动作族放行（真缺口能补上）', () => {
    const existing = [task('建立基础认知', 60, 'acquire'), task('拆解操作链', 60, 'deconstruct')];
    const incoming = [
      task('把规则讲给想象中的初学者听', 60, 'consolidate'),
      task('再刷一遍基础认知', 60, 'acquire'),
    ];
    const { added, dropReasons } = mergeSupplementTasks(existing, incoming, {
      upper: 10,
      requireTypeNovelty: 'taskType',
    });
    expect(added).toHaveLength(1);
    expect(added[0].taskType).toBe('consolidate');
    expect(dropReasons.typeRepeat).toBe(1);
  });

  it('未标注类型的补课任务不被动作族闸误杀', () => {
    const existing = [task('建立基础认知', 60, 'acquire')];
    const incoming = [task('无类型的新方向课', 60)];
    const { added, dropReasons } = mergeSupplementTasks(existing, incoming, {
      upper: 10,
      requireTypeNovelty: 'taskType',
    });
    expect(added).toHaveLength(1);
    expect(dropReasons.typeRepeat).toBe(0);
  });

  it('不传 requireTypeNovelty 时行为与只查重一致（向后兼容）', () => {
    const existing = [task('建立基础认知', 60, 'acquire')];
    const incoming = [task('另一个方向的建立任务', 60, 'acquire')];
    const { added } = mergeSupplementTasks(existing, incoming, { upper: 10 });
    expect(added).toHaveLength(1);
  });

  it('dropReasons 汇总三类丢弃', () => {
    const existing = [task('串联并联电功率计算的综合自测与查漏', 60, 'consolidate')];
    const incoming = [
      task('串联并联电功率计算的综合自测与查漏巩固', 60, 'acquire'), // 近似重复
      task('换个说法的复盘', 60, 'consolidate'), // 动作族已有
      { estimatedMinutes: 30 }, // 脏数据
      task('全新的方向', 60, 'diagnose'), // 应放行
    ];
    const { added, dropReasons } = mergeSupplementTasks(existing, incoming, {
      upper: 10,
      requireTypeNovelty: 'taskType',
    });
    expect(added).toHaveLength(1);
    expect(dropReasons).toEqual({ duplicate: 1, typeRepeat: 1, invalid: 1 });
  });

  it('补课后总数不超过结构上界', () => {
    const existing = [task('阶段一基础认知建立')];
    const incoming = [task('方向A'), task('方向B'), task('方向C')];
    const { merged } = mergeSupplementTasks(existing, incoming, { upper: 2 });
    expect(merged).toHaveLength(2);
  });

  it('无标题的脏数据被丢弃', () => {
    const existing = [task('有效课')];
    const incoming = [{ estimatedMinutes: 30 }, task('新课')];
    const { merged, dropped } = mergeSupplementTasks(existing, incoming, { upper: 10 });
    expect(merged).toHaveLength(2);
    expect(dropped).toHaveLength(1);
  });

  it('输入数组不被原地修改', () => {
    const existing = [task('原课1')];
    const incoming = [task('新课1')];
    const snapshot = JSON.stringify([existing, incoming]);
    mergeSupplementTasks(existing, incoming, { upper: 10 });
    expect(JSON.stringify([existing, incoming])).toBe(snapshot);
  });
});

describe('buildSupplementRequest', () => {
  it('差额按锚-既有计，既有标题与分钟档随请求带给模型', () => {
    const req = buildSupplementRequest([task('课A', 60)], 5, 2, [30, 120]);
    expect(req.needed).toBe(4);
    expect(req.stageNumber).toBe(2);
    expect(req.minutesRange).toEqual([30, 120]);
    expect(req.existing).toEqual([{ title: '课A', type: undefined }]);
  });
});
