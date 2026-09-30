import { schoolAnchorCoverage, type PathSchoolAnchor } from '../school-anchor';

const anchor: PathSchoolAnchor = {
  textbook: '人教版八年级上册',
  examScope: '期中覆盖 Unit 1-5',
  schoolPace: '每两周一单元',
  evidence: '初二，人教版八年级上册，期中覆盖 Unit 1-5',
};

describe('schoolAnchorCoverage（引用观测，LLM 锚口径）', () => {
  it('阶段目标引用了册次与考试范围 → referenced', () => {
    const r = schoolAnchorCoverage(anchor, ['对照人教版八年级上册 Unit 5 的完形练习', '期中考前把改错率降下来']);
    expect(r.referenced).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it('只提册次未提考试 → 缺考试范围', () => {
    const r = schoolAnchorCoverage(anchor, ['完成八年级上册第五单元阅读']);
    expect(r.referenced).toBe(false);
    expect(r.missing).toContain('考试范围');
    expect(r.missing).not.toContain('教材册次');
  });

  it('什么都没提 → 两项都缺', () => {
    const r = schoolAnchorCoverage(anchor, ['打好完形基础', '多做练习']);
    expect(r.referenced).toBe(false);
    expect(r.missing).toContain('教材册次');
    expect(r.missing).toContain('考试范围');
  });

  it('无锚时恒 referenced（不误报非校内路径）', () => {
    expect(schoolAnchorCoverage(null, ['随便什么'])).toEqual({ referenced: true, missing: [] });
  });

  it('只抽到考试范围（无册次）时只判考试范围', () => {
    const examOnly: PathSchoolAnchor = { textbook: null, examScope: '期末闭卷', schoolPace: null, evidence: '' };
    const r = schoolAnchorCoverage(examOnly, ['把知识点过一遍']);
    expect(r.referenced).toBe(false);
    expect(r.missing).toEqual(['考试范围']);
  });
});
