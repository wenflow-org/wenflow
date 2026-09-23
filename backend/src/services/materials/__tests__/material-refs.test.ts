/**
 * `materialRefs` 的**逐字核对**（可自动验收的基石）：核对不过一律丢弃，宁缺勿编。
 */
import {
  MAX_MATERIAL_REFS,
  describeMaterialRef,
  isQuoteVerbatim,
  normalizeMaterialRefs,
} from '../material-refs';
import type { PromptMaterial } from '../material-prompt-projection';

function material(overrides: Partial<PromptMaterial> = {}): PromptMaterial {
  return {
    title: 'MIT 6.006 第12讲',
    sourceUrl: 'attachment://deck.pptx',
    materialId: '11111111-2222-3333-4444-555555555555',
    publisher: null,
    sourceTier: 'unknown',
    tldr: '本讲讲图算法：BFS、DFS、拓扑排序。',
    sections: [
      { id: 's-1', title: 'Graphs' },
      { id: 's-2', title: 'Breadth-First Search' },
      { id: 's-3', title: 'Pocket Cube' },
    ],
    keyPoints: [
      { text: 'BFS 的适用条件｜广度优先搜索用于无权图的最短路径', cite: 'Breadth-First Search computes shortest paths in unweighted graphs' },
      { text: 'DFS 的适用条件｜深度优先搜索用于连通性与拓扑排序', cite: 'Depth-First Search is used for connectivity and topological sort' },
    ],
    ...overrides,
  };
}

describe('isQuoteVerbatim（逐字核对）', () => {
  it('引文逐字出现在要点/章节/tldr 中 → true（空白归一后比对）', () => {
    expect(isQuoteVerbatim('Breadth-First Search computes shortest paths in unweighted graphs', material())).toBe(true);
    expect(isQuoteVerbatim('Graphs', material())).toBe(true);
    expect(isQuoteVerbatim('  本讲讲图算法：BFS、DFS、拓扑排序。  ', material())).toBe(true);
  });

  it('编造的引文 → false（宁缺勿编）', () => {
    expect(isQuoteVerbatim('Dijkstra 算法适用于带权图的最短路径', material())).toBe(false);
    expect(isQuoteVerbatim('BFS 适用于加权图', material())).toBe(false);
  });

  it('过短的引文无鉴别力 → false', () => {
    expect(isQuoteVerbatim('图', material())).toBe(false);
    expect(isQuoteVerbatim('', material())).toBe(false);
  });
});

describe('normalizeMaterialRefs', () => {
  it('保留可核对的引用，补全 sectionTitle 与 packIndex', () => {
    const refs = normalizeMaterialRefs(
      [{ packIndex: 0, sectionId: 's-2', quote: 'Breadth-First Search computes shortest paths in unweighted graphs' }],
      [material()]
    );
    expect(refs).toHaveLength(1);
    expect(refs[0].sectionId).toBe('s-2');
    expect(refs[0].sectionTitle).toBe('Breadth-First Search');
    expect(refs[0].packIndex).toBe(0);
    // 附件 id 贯通到引用（前端据此"点开看原文"）
    expect(refs[0].materialId).toBe('11111111-2222-3333-4444-555555555555');
  });

  it('编造引文被丢弃；可核对的留下（混合输入）', () => {
    const refs = normalizeMaterialRefs(
      [
        { packIndex: 0, quote: '这段引文是模型编的，资料里没有' },
        { packIndex: 0, sectionId: 's-1', quote: 'Graphs' },
      ],
      [material()]
    );
    expect(refs).toHaveLength(1);
    expect(refs[0].quote).toBe('Graphs');
  });

  it('packIndex 缺失时按引文跨资料定位', () => {
    const other = material({ title: '指南', sections: [{ id: 'g-1', title: '健康领域' }], keyPoints: [{ text: '健康', cite: '健康包括身心状况与动作发展' }] });
    const refs = normalizeMaterialRefs([{ quote: '健康包括身心状况与动作发展' }], [material(), other]);
    expect(refs).toHaveLength(1);
    expect(refs[0].packIndex).toBe(1);
    // 引文不含章节标题原文 → 不硬编 sectionId（宁缺勿编）
    expect(refs[0].sectionId).toBeNull();
  });

  it('引文包含章节标题原文时自动定位到该章节', () => {
    const refs = normalizeMaterialRefs([{ packIndex: 0, quote: 'Breadth-First Search computes shortest paths in unweighted graphs' }], [material()]);
    expect(refs[0].sectionId).toBe('s-2');
    expect(refs[0].sectionTitle).toBe('Breadth-First Search');
  });

  it('sectionId 不存在时按引文命中章节标题，命不中则留空（不编造）', () => {
    const refs = normalizeMaterialRefs(
      [
        { packIndex: 0, sectionId: 's-999', quote: 'Breadth-First Search' },
        { packIndex: 0, quote: 'Breadth-First Search computes shortest paths in unweighted graphs' },
      ],
      [material()]
    );
    // 第一条 sectionId 不存在（s-999），按引文命中章节标题 → 纠正为真实 id
    expect(refs[0].sectionId).toBe('s-2');
    // 第二条引文包含章节标题原文 → 同样能定位
    expect(refs[1].sectionId).toBe('s-2');
  });

  it('去重 + 截断到上限', () => {
    const many = Array.from({ length: MAX_MATERIAL_REFS + 3 }, (_, index) => ({
      packIndex: 0,
      quote: `Breadth-First Search computes shortest paths in unweighted graphs #${index}`,
    }));
    // 全部不可核对（加了 #n 后缀）→ 空
    expect(normalizeMaterialRefs(many, [material()])).toHaveLength(0);
    const dup = [
      { packIndex: 0, quote: 'Graphs' },
      { packIndex: 0, quote: 'Graphs' },
      { packIndex: 0, quote: 'Pocket Cube' },
      { packIndex: 0, quote: 'Breadth-First Search' },
      { packIndex: 0, quote: 'Depth-First Search is used for connectivity and topological sort' },
    ];
    const refs = normalizeMaterialRefs(dup, [material()]);
    expect(refs.length).toBeLessThanOrEqual(MAX_MATERIAL_REFS);
    expect(new Set(refs.map((r) => `${r.sectionId}|${r.quote}`)).size).toBe(refs.length);
  });

  it('联网资料（无 materialId）→ 引用里 materialId 为 null，不误指附件', () => {
    const web = material({ materialId: null, title: '联网资料' });
    const refs = normalizeMaterialRefs([{ packIndex: 0, quote: 'Graphs' }], [web]);
    expect(refs).toHaveLength(1);
    expect(refs[0].materialId).toBeNull();
  });

  it('无资料 / 非数组输入 → 空数组（不出现该键）', () => {
    expect(normalizeMaterialRefs([{ quote: 'Graphs' }], null)).toEqual([]);
    expect(normalizeMaterialRefs([{ quote: 'Graphs' }], [])).toEqual([]);
    expect(normalizeMaterialRefs('not-an-array', [material()])).toEqual([]);
    expect(normalizeMaterialRefs(null, [material()])).toEqual([]);
  });
});

describe('describeMaterialRef（前端标签）', () => {
  it('优先章节标题', () => {
    expect(describeMaterialRef({ packIndex: 0, materialId: null, sectionId: 's-2', sectionTitle: 'Breadth-First Search', quote: 'x' }))
      .toBe('Breadth-First Search');
  });

  it('无标题时截断引文', () => {
    const label = describeMaterialRef({ packIndex: 0, materialId: null, sectionId: null, sectionTitle: null, quote: '一二三四五六七八九十一二三四五六七八九十一二三四五六' });
    expect(label.length).toBeLessThanOrEqual(25);
    expect(label.endsWith('…')).toBe(true);
  });
});
