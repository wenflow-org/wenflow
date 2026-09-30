import { buildAnchorGoalNote } from '../school-anchor-goal';
import type { PathSchoolAnchor } from '../school-anchor';

const anchor = (over: Partial<PathSchoolAnchor> = {}): PathSchoolAnchor => ({
  textbook: '人教版八年级上册',
  examScope: '期中覆盖 Unit 1-5',
  schoolPace: null,
  evidence: '初二，人教版八年级上册，期中覆盖 Unit 1-5',
  ...over,
});

describe('buildAnchorGoalNote', () => {
  it('goal 没提册次也没提考试 → 追加对照括注', () => {
    expect(buildAnchorGoalNote(anchor(), '能在一篇完形中圈出线索词')).toBe('（对照人教版八年级上册·期中）');
  });

  it('goal 已提册次 → 不补（不重复污染）', () => {
    expect(buildAnchorGoalNote(anchor(), '对照人教版八年级上册 Unit 5 的完形练习')).toBeNull();
  });

  it('goal 只提了册次但没提考试 → 也不补（册次已构成对表）', () => {
    expect(buildAnchorGoalNote(anchor(), '完成八年级上册第五单元阅读')).toBeNull();
  });

  it('goal 已提考试节点 → 不补', () => {
    expect(buildAnchorGoalNote(anchor(), '期中前完形错误控制在 3 个以内')).toBeNull();
  });

  it('goal 只提了考试节点 → 也不补（已挂到校内体系）', () => {
    expect(buildAnchorGoalNote(anchor(), '期中前完形错误控制在 3 个以内')).toBeNull();
  });

  it('无册次只有截止型考试范围 → 补「XX前」括注', () => {
    expect(buildAnchorGoalNote(anchor({ textbook: null }), '把计算补起来')).toBe('（期中前）');
  });

  it('进行型复习节点不带「前」（一轮复习 ≠ 一轮复习前）', () => {
    expect(buildAnchorGoalNote(anchor({ textbook: null, examScope: '一轮复习，按板块推进' }), '把采分点练稳'))
      .toBe('（一轮复习）');
  });

  it('无锚 → null（非校内路径行为不变）', () => {
    expect(buildAnchorGoalNote(null, '任何目标')).toBeNull();
  });
});
