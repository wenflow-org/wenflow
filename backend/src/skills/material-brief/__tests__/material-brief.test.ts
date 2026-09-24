/**
 * material-brief 输出归一化钳制单测：规模硬约束（toc≤30 去重 / gist≤40 /
 * overview≤200 / concepts≤10 / divisions≤4）与形状容错不依赖模型自觉。
 */
import { normalizeMaterialBrief } from '../index';

function rawBrief(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    docType: '课程标准',
    subject: '某指南',
    audience: '教师',
    overview: '概'.repeat(500),
    toc: Array.from({ length: 50 }, (_, i) => ({ title: `章节${i + 1}`, gist: `要`.repeat(60) })),
    coreConcepts: Array.from({ length: 20 }, (_, i) => `概念${i + 1}`),
    naturalDivisions: Array.from({ length: 6 }, (_, i) => `维度${i + 1}`),
    ...overrides,
  };
}

describe('normalizeMaterialBrief 钳制', () => {
  it('全部字段按上限收敛', () => {
    const brief = normalizeMaterialBrief(rawBrief());
    expect(brief).not.toBeNull();
    expect(brief!.overview).toHaveLength(200);
    expect(brief!.toc).toHaveLength(30);
    expect(brief!.toc[0].gist).toHaveLength(40);
    expect(brief!.coreConcepts).toHaveLength(10);
    expect(brief!.naturalDivisions).toHaveLength(4);
  });

  it('toc 标题去重、空标题丢弃', () => {
    const brief = normalizeMaterialBrief({
      toc: [
        { title: 'A', gist: 'a' },
        { title: 'A', gist: '重复' },
        { title: '', gist: '空' },
        { title: 'B' },
      ],
    });
    expect(brief!.toc.map((entry) => entry.title)).toEqual(['A', 'B']);
    expect(brief!.toc[1].gist).toBe('');
  });

  it('非对象/null 输入 → 空壳 brief（各字段空值，不抛错）', () => {
    const empty = normalizeMaterialBrief(null);
    expect(empty).not.toBeNull();
    expect(empty!.toc).toEqual([]);
    expect(empty!.subject).toBeNull();
  });
});
