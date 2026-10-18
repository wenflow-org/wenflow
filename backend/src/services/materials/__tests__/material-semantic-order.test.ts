/**
 * #119 优化项 2：阶段资料窗口的窗口内语义排序。
 *
 * 验收点：
 * 1) 排序规则=与阶段查询的余弦相似度降序，平局按原始位次（稳定性）；
 * 2) fail-open：query 为空 / 章节不足 2 节 / embedding 报错 / 向量条数不齐 → null；
 * 3) 投影侧只重排**已切窗口内**的顺序：成员与数量不变，窗口外章节不会被拉进来，未知 id 排后。
 */
import {
  buildSectionSemanticOrder,
  rankSectionIndexes,
} from '../material-semantic-order';
import { buildPromptFriendlyMaterials, STAGE_MATERIAL_LIMITS } from '../material-prompt-projection';

const section = (id: string, title: string, summary = '') => ({ id, title, summary });

describe('rankSectionIndexes', () => {
  it('按余弦降序；平局保持原始位次', () => {
    const query = [1, 0];
    const vectors = [[0, 1], [1, 0], [0.5, 0.5]]; // 0 / 1 / 0.707
    expect(rankSectionIndexes(query, vectors)).toEqual([1, 2, 0]);
    expect(rankSectionIndexes([1, 0], [[1, 0], [1, 0], [0, 1]])).toEqual([0, 1, 2]);
  });

  it('非法 query 向量 → 原序（不制造随机排序）', () => {
    expect(rankSectionIndexes([], [[1, 0], [0, 1]])).toEqual([0, 1]);
    expect(rankSectionIndexes(undefined as unknown as number[], [[1, 0], [0, 1]])).toEqual([0, 1]);
  });
});

describe('buildSectionSemanticOrder', () => {
  const embedWith = (vectors: number[][]) => async () => vectors;

  it('相关章节排到前面（直接用注入向量，不打网络）', async () => {
    const order = await buildSectionSemanticOrder({
      query: '导数与变化率',
      sections: [section('s-1', '绪论'), section('s-2', '导数'), section('s-3', '积分')],
      embed: embedWith([[1, 0], [0, 1], [1, 0.1], [0.2, 1]]),
    });
    expect(order).not.toBeNull();
    expect(order!.get('s-2')).toBe(0);
    expect(order!.get('s-1')).toBe(2);
  });

  it('query 为空 / 章节不足 2 节 / 空标题 → null（fail-open）', async () => {
    expect(await buildSectionSemanticOrder({ query: '  ', sections: [section('s-1', 'A'), section('s-2', 'B')], embed: embedWith([]) })).toBeNull();
    expect(await buildSectionSemanticOrder({ query: '导数', sections: [section('s-1', 'A')], embed: embedWith([]) })).toBeNull();
    expect(await buildSectionSemanticOrder({
      query: '导数',
      sections: [section('s-1', 'A'), section('', 'B'), section('s-3', '   ')],
      embed: embedWith([]),
    })).toBeNull();
  });

  it('embedding 抛错或向量条数不齐 → null（生成链按原序继续）', async () => {
    const sections = [section('s-1', 'A'), section('s-2', 'B')];
    expect(await buildSectionSemanticOrder({
      query: '导数',
      sections,
      embed: async () => { throw new Error('upstream down'); },
    })).toBeNull();
    expect(await buildSectionSemanticOrder({ query: '导数', sections, embed: embedWith([[1, 0], [1, 0]]) })).toBeNull();
  });
});

describe('投影侧窗口内重排（成员/数量不变）', () => {
  function packWith(sectionCount: number) {
    return [{
      pack: {
        title: '指南',
        sourceUrl: 'attachment://guide.txt',
        materialId: 'm1',
        tldr: '概述',
        sections: Array.from({ length: sectionCount }, (_, index) => ({
          id: `s-${index + 1}`,
          title: `第 ${index + 1} 节`,
          summary: '',
        })),
        keyPoints: [],
      },
    }];
  }

  it('窗口内按名次重排；窗口外章节不会被拉进来', () => {
    // 6 节、每份 3 节、stage 1/2 → 窗口 s-1..s-3
    const rank = new Map([['s-4', 0], ['s-3', 1], ['s-1', 2]]);
    const out = buildPromptFriendlyMaterials(packWith(6), { ...STAGE_MATERIAL_LIMITS, maxSections: 3 }, { stageNumber: 1, stageCount: 2 }, rank);
    const ids = out![0].sections.map((item) => item.id);
    expect(ids).toEqual(['s-3', 's-1', 's-2']); // s-4 在窗口外，不进；s-2 无名次排后
    expect(ids).toHaveLength(3);
  });

  it('无名次映射时行为与改动前一致（原位次）', () => {
    const out = buildPromptFriendlyMaterials(packWith(6), { ...STAGE_MATERIAL_LIMITS, maxSections: 3 }, { stageNumber: 1, stageCount: 2 }, null);
    expect(out![0].sections.map((item) => item.id)).toEqual(['s-1', 's-2', 's-3']);
  });
});
