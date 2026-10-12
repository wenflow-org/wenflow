import { sanitizeUserFacingText, detectBoilerplateClause } from '../user-facing-text';

describe('sanitizeUserFacingText', () => {
  it('把内部流程术语替换为学习者语言', () => {
    const r = sanitizeUserFacingText('回捞学科全景框架并校准理论映射');
    expect(r.text).toBe('回顾学科全景框架并校准理论映射');
    expect(r.replaced).toEqual(['回捞']);
  });

  it('多词命中按词表顺序去重记录', () => {
    const r = sanitizeUserFacingText('回捞前一阶段，再回捞核心概念');
    expect(r.text).toBe('回顾前一阶段，再回顾核心概念');
    expect(r.replaced).toEqual(['回捞']);
  });

  it('未命中时原样返回且 replaced 为空', () => {
    const r = sanitizeUserFacingText('整理动机差异与学习机制的对照清单');
    expect(r.text).toBe('整理动机差异与学习机制的对照清单');
    expect(r.replaced).toEqual([]);
  });

  it('幂等：对已清洗文本再跑不变', () => {
    const once = sanitizeUserFacingText('回捞框架').text;
    const twice = sanitizeUserFacingText(once);
    expect(twice.text).toBe('回顾框架');
    expect(twice.replaced).toEqual([]);
  });

  it('非字符串/空值原样透传（交给调用方空值兜底）', () => {
    expect(sanitizeUserFacingText(undefined)).toEqual({ text: '', replaced: [] });
    expect(sanitizeUserFacingText(null)).toEqual({ text: '', replaced: [] });
    expect(sanitizeUserFacingText(42 as unknown)).toEqual({ text: '', replaced: [] });
  });
});

describe('detectBoilerplateClause', () => {
  it('命中「回捞…关系」模板复读句', () => {
    expect(detectBoilerplateClause('从学习理论出发回捞教育心理学原理与AI教育决策的映射验证关系，聚焦行为主义'))
      .toBe('回捞教育心理学原理与AI教育决策的映射验证关系');
  });

  it('回捞与关系相距过远/换行则不命中', () => {
    expect(detectBoilerplateClause('回捞一下上一节，然后再讨论学习与教学的关系')).toBeNull();
  });

  it('非字符串返回 null', () => {
    expect(detectBoilerplateClause(undefined)).toBeNull();
    expect(detectBoilerplateClause('')).toBeNull();
  });
});
