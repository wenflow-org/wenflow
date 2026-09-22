/**
 * 邻域来源优先级（L3 接入 · S4a）
 *
 * 旧行为：`neighboringConcepts` = `coreConcepts.filter(≠当前).slice(0,3)` —— 任意切片，无语义依据。
 * 新行为：优先用物化后的 `concept_edges` 1-hop 邻居（前置优先）；图缺失/无邻居时**回落旧行为**，
 * 保证未回填的路径行为与改造前一致（可回滚、可灰度）。
 */
import { pickNeighboringConcepts } from '../TeachingContextBuilder';

const coreConcepts = [
  { id: 'concept-1', name: '多源报表对齐' },
  { id: 'concept-2', name: '分组键唯一性' },
  { id: 'concept-3', name: '汇总口径映射' },
];

describe('pickNeighboringConcepts（邻域优先级）', () => {
  it('有图邻居时优先用图（忽略 coreConcepts 的任意切片）', () => {
    const picked = pickNeighboringConcepts({
      graphNeighbors: ['分组键唯一性'],
      coreConcepts,
      currentConceptId: 'concept-1',
      currentConceptName: '多源报表对齐',
    });
    expect(picked).toEqual(['分组键唯一性']);
  });

  it('图邻居为空 → 回落旧行为（取前 3 个其它 coreConcept）', () => {
    const picked = pickNeighboringConcepts({
      graphNeighbors: [],
      coreConcepts,
      currentConceptId: 'concept-1',
      currentConceptName: '多源报表对齐',
    });
    expect(picked).toEqual(['分组键唯一性', '汇总口径映射']);
  });

  it('未提供 graphNeighbors（未接入场景）→ 与旧行为逐字一致', () => {
    const legacy = pickNeighboringConcepts({
      coreConcepts,
      currentConceptId: 'concept-1',
      currentConceptName: '多源报表对齐',
    });
    expect(legacy).toEqual(['分组键唯一性', '汇总口径映射']);
  });

  it('图邻居里含自身/空白/重复 → 过滤去重；全被过滤则回落旧行为', () => {
    const selfOnly = pickNeighboringConcepts({
      graphNeighbors: ['多源报表对齐', '  ', '多源报表对齐'],
      coreConcepts,
      currentConceptId: 'concept-1',
      currentConceptName: '多源报表对齐',
    });
    expect(selfOnly).toEqual(['分组键唯一性', '汇总口径映射']); // 回落

    const withDup = pickNeighboringConcepts({
      graphNeighbors: ['分组键唯一性', '分组键唯一性', '汇总口径映射'],
      coreConcepts,
      currentConceptId: 'concept-1',
      currentConceptName: '多源报表对齐',
    });
    expect(withDup).toEqual(['分组键唯一性', '汇总口径映射']);
  });

  it('图邻居超过 3 个 → 截断到 3（与旧行为同上限）', () => {
    const picked = pickNeighboringConcepts({
      graphNeighbors: ['A', 'B', 'C', 'D', 'E'],
      coreConcepts,
      currentConceptId: 'concept-1',
      currentConceptName: '多源报表对齐',
    });
    expect(picked).toEqual(['A', 'B', 'C']);
  });
});
