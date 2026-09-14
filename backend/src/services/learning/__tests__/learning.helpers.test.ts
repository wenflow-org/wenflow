/**
 * resolvePathSubject 回归：
 * path-planning 的 analyzeInput 用 input.goal 当 subject，会把几百字目标原文写进
 * learning_paths.subject，进而污染教学 prompt、管理端内容列表与 Dashboard 路径卡副标题。
 * 口径：subject 简洁则沿用，过长/缺失用清洗后的路径名兜底。
 */
import { MAX_PATH_SUBJECT_LENGTH, resolvePathSubject, cleanPathTitle } from '../learning.helpers';

describe('resolvePathSubject（路径 subject 兜底）', () => {
  it('简洁 subject 原样保留', () => {
    expect(resolvePathSubject('TypeScript', 'TypeScript 入门')).toBe('TypeScript');
    expect(resolvePathSubject('  Python  ', 'Python 入门')).toBe('Python');
  });

  it('目标原文（超长）改用清洗后的路径名兜底', () => {
    const rawGoal = '偏离后没有「最小重启标准」，且该标准在崩溃当下无法被主动想起、也无法被外部形式有效承载。'.repeat(5);
    expect(resolvePathSubject(rawGoal, '二战在家备考偏离重启入门')).toBe('二战在家备考偏离重启入门');
  });

  it('缺失/空白/非字符串 subject 用路径名兜底', () => {
    expect(resolvePathSubject(undefined, '兜底名')).toBe('兜底名');
    expect(resolvePathSubject('', '兜底名')).toBe('兜底名');
    expect(resolvePathSubject('   ', '兜底名')).toBe('兜底名');
    expect(resolvePathSubject(123, '兜底名')).toBe('兜底名');
  });

  it('边界：<= 24 字沿用，> 24 字兜底', () => {
    const justFit = '一'.repeat(MAX_PATH_SUBJECT_LENGTH);
    expect(resolvePathSubject(justFit, '兜底名')).toBe(justFit);
    expect(resolvePathSubject('一'.repeat(MAX_PATH_SUBJECT_LENGTH + 1), '兜底名')).toBe('兜底名');
  });
});

describe('cleanPathTitle', () => {
  it('去掉结尾的「学习路径」等后缀', () => {
    expect(cleanPathTitle('Python 自动化 Excel 学习路径')).toBe('Python 自动化 Excel');
    expect(cleanPathTitle('摄影入门学习计划')).toBe('摄影入门');
  });

  it('无后缀时原样返回', () => {
    expect(cleanPathTitle('二战在家备考偏离重启入门')).toBe('二战在家备考偏离重启入门');
  });
});
