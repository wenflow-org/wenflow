import { resolveSchoolAnchorForPathDesign, schoolAnchorCoverage } from '../school-anchor';

const profile = (over: Record<string, unknown> = {}) => ({
  surfaceGoal: '',
  currentBaseline: { evidence: '' },
  painPoints: [],
  backgroundExperience: '',
  constraintsAndBoundaries: '',
  ...over,
});

describe('resolveSchoolAnchorForPathDesign', () => {
  it('抽到教材册次+单元、考试范围、学校进度三类要素', () => {
    const anchor = resolveSchoolAnchorForPathDesign({
      learnerProfile: profile({
        backgroundExperience: '孩子三年级，人教版上册，这次单元测验考了82分',
        surfaceGoal: '想把计算补起来',
        currentBaseline: { evidence: '两位数乘一位数进位老出错' },
      }),
    });
    expect(anchor).not.toBeNull();
    expect(anchor!.textbook).toContain('三年级');
    expect(anchor!.textbook).toContain('上册');
    expect(anchor!.examScope).toMatch(/单元测验/);
  });

  it('第五单元/学校进度（下周开）可抽到', () => {
    const anchor = resolveSchoolAnchorForPathDesign({
      learnerProfile: profile({
        backgroundExperience: '人教版三年级上册第五单元，老师下周开第六单元',
      }),
    });
    expect(anchor!.textbook).toContain('第五单元');
    expect(anchor!.schoolPace).toMatch(/下周开/);
  });

  it('高中选科/高考场景抽到册次与考试范围', () => {
    const anchor = resolveSchoolAnchorForPathDesign({
      learnerProfile: profile({
        surfaceGoal: '高三一轮复习，想把数学函数这块补起来',
        backgroundExperience: '人教版高中数学必修一，学校一轮复习刚开始',
      }),
    });
    expect(anchor!.textbook).toContain('高中数学');
    expect(anchor!.textbook).toContain('必修一');
    expect(anchor!.examScope).toMatch(/高考|一轮/);
  });

  it('不带版本号只说「三年级上册」也算锚（口语常态）', () => {
    const anchor = resolveSchoolAnchorForPathDesign({
      learnerProfile: profile({ backgroundExperience: '孩子三年级上册，计算老出错' }),
    });
    expect(anchor!.textbook).toContain('三年级上册');
  });

  it('只有学段词（初三）没有册次 → textbook 为 null（不误触发）', () => {
    const anchor = resolveSchoolAnchorForPathDesign({
      learnerProfile: profile({
        surfaceGoal: '初三学生，函数是薄弱环节',
        backgroundExperience: '初三，学过一次函数',
        currentBaseline: { evidence: '' },
      }),
    });
    expect(anchor?.textbook ?? null).toBeNull();
  });

  it('月考也算考试范围线索', () => {
    const anchor = resolveSchoolAnchorForPathDesign({
      learnerProfile: profile({ backgroundExperience: '八年级，月考数学 72 分' }),
    });
    expect(anchor!.examScope).toMatch(/月考/);
  });

  it('非校内人设（无任何教材/考试线索）→ null，不注入', () => {
    expect(resolveSchoolAnchorForPathDesign({
      learnerProfile: profile({
        surfaceGoal: '想转行做数据分析',
        backgroundExperience: '电商公司做运营四年，天天看报表',
      }),
    })).toBeNull();
  });

  it('输入为空/非对象不抛错', () => {
    expect(resolveSchoolAnchorForPathDesign(null)).toBeNull();
    expect(resolveSchoolAnchorForPathDesign(undefined)).toBeNull();
    expect(resolveSchoolAnchorForPathDesign({})).toBeNull();
  });

  it('原文证据随附（供提示词引用而不编造）', () => {
    const anchor = resolveSchoolAnchorForPathDesign({
      learnerProfile: profile({ backgroundExperience: '北师大版二年级下册' }),
    });
    expect(anchor!.evidence).toContain('北师大版二年级下册');
    expect(anchor!.evidence.length).toBeLessThanOrEqual(400);
  });
});

describe('schoolAnchorCoverage', () => {
  const anchor = {
    textbook: '人教版三年级上册第五单元',
    examScope: '校内单元测与期中期末',
    schoolPace: '每周约1个单元',
    evidence: '人教版三年级上册第五单元，校内单元测',
  };

  it('阶段目标引用了册次与考试范围 → referenced', () => {
    const r = schoolAnchorCoverage(anchor, ['对照人教版三年级上册第五单元补进位乘法', '校内单元测计算专项']);
    expect(r.referenced).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it('完全没提教材与考试 → 缺两项', () => {
    const r = schoolAnchorCoverage(anchor, ['打好计算基础', '多做练习']);
    expect(r.referenced).toBe(false);
    expect(r.missing).toContain('教材册次');
    expect(r.missing).toContain('考试范围');
  });

  it('无锚时恒 referenced（不误报非校内路径）', () => {
    expect(schoolAnchorCoverage(null, ['随便什么'])).toEqual({ referenced: true, missing: [] });
  });
});
