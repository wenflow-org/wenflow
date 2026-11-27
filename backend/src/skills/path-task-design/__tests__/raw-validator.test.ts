import {
  extractStageChecklist,
  extractStageSections,
  validateStageChecklistCoverage,
  validateStageDesignerOutput,
} from '../index'

describe('path-task-design raw validator', () => {
  it('accepts a subtasks array and leaves item defaults to the normalizer', () => {
    expect(validateStageDesignerOutput({ subtasks: [{}] })).toEqual({ valid: true })
  })

  it('rejects an object without subtasks before normalization', () => {
    expect(validateStageDesignerOutput({})).toEqual({
      valid: false,
      failureReason: 'STAGE_DESIGNER_SUBTASKS_MISSING',
    })
  })
})

describe('单元清单抽取', () => {
  const milestone = {
    stageNumber: 1,
    title: '绪言与机械运动：从刻度尺读数到平均速度的测量判断',
    description: '以绪言的科学探究七环节和第一章 1.1–1.4 为内容，先立住全书的数据地基。',
  }

  it('区间写法展开成逐节清单，小数（1.5 倍）不当小节', () => {
    expect(extractStageSections(milestone)).toEqual(['1.1', '1.2', '1.3', '1.4'])
    expect(extractStageSections({ description: '放大 1.5 倍，误差 0.2 以内' })).toEqual([])
  })

  it('逐条列举的「节号+小节名」也能解析（数学教材实跑形态）', () => {
    expect(extractStageSections({
      description: '本章小节：1.1 集合的概念；1.2 集合间的基本关系；1.3 集合的基本运算；1.4 充分条件与必要条件；1.5 全称量词与存在量词。先直面头号误区。',
    })).toEqual(['1.1', '1.2', '1.3', '1.4', '1.5'])
    expect(extractStageSections({
      description: '第1章 集合与常用逻辑用语。小节清单：1.1 集合的概念；1.2 集合间的基本关系；1.3 集合的基本运算；1.4 充分条件与必要条件；1.5 全称量词与存在量词。本单元透镜：…',
    })).toEqual(['1.1', '1.2', '1.3', '1.4', '1.5'])
  })

  it('①②③ 条目的清单优先于节号解析', () => {
    const items = extractStageChecklist({
      description: '第1章 函数与极限：① 映射与函数 ② 数列的极限 ③ 函数的极限 ④ 无穷小与无穷大 ⑤ 极限运算法则 ⑥ 连续性与闭区间性质。先拆 ε-δ。',
    })
    expect(items).toHaveLength(6)
    expect(items[0]).toBe('映射与函数')
    expect(items[5]).toContain('连续性与闭区间性质')
  })

  it('非教材语境的 ①②③（工作步骤）不当单元清单', () => {
    expect(extractStageChecklist({
      description: '① 先拆案例 ② 再定位责任 ③ 最后写结论。整节课围绕一个真实工单。',
    })).toEqual([])
  })
})

describe('清单覆盖（covers 契约）', () => {
  const milestone = {
    stageNumber: 1,
    description: '第1章 函数与极限：① 映射与函数 ② 数列的极限 ③ 函数的极限 ④ 无穷小与无穷大 ⑤ 极限运算法则 ⑥ 连续性与闭区间性质。',
  }

  it('covers 没认领全部条目 → 指出缺失序号', () => {
    const result = validateStageChecklistCoverage({
      subtasks: [
        { title: 't1', description: '对应 ①', covers: [1] },
        { title: 't2', description: '对应 ②③', covers: [2, 3] },
      ],
    }, { milestone });
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.failureReason).toContain('STAGE_CHECKLIST_UNCOVERED(missing=4,5,6)');
  })

  it('每个条目都被 covers 认领 → 通过（合并课写多个序号）', () => {
    const result = validateStageChecklistCoverage({
      subtasks: [
        { title: 't1', covers: [1, 2] },
        { title: 't2', covers: [3] },
        { title: 't3', covers: ['4', '5', '6'] },
      ],
    }, { milestone });
    expect(result.valid).toBe(true);
  })

  it('没有 covers 数组 → 直接要求补 covers，不做文本猜测', () => {
    const result = validateStageChecklistCoverage({
      subtasks: [{ title: '1.1 映射与函数', description: '正文里写了一堆节号 ①②③' }],
    }, { milestone });
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.failureReason).toContain('STAGE_CHECKLIST_COVERS_MISSING');
  })

  it('没有清单的路径不检查（普通 builder/diagnostic 不受影响）', () => {
    expect(validateStageChecklistCoverage({ subtasks: [{ title: 't' }] }, {
      milestone: { description: '围绕一个真实案例做判断，不按教材章节。' },
    }).valid).toBe(true);
  })
})
