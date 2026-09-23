/**
 * 课堂侧资料接线（下游 learn 的关键一段）。
 *
 * 背景：路径生成时资料只影响 path-planning 的提示词；课堂（teaching-turn）此前完全不读 normalizedInput，
 * 于是"课上讲的"和"路径长在的资料"脱节。这里验收 `resolvePathMaterialsForTeaching`：
 * 能从路径模板里取回资料并投影成**最小集合**，且无资料时返回 null（课堂行为不变）。
 */
import { resolvePathMaterialsForTeaching } from '../TeachingContextBuilder';

function templateWithMaterials(materials: unknown, shape: 'sceneFraming' | 'snapshot' = 'sceneFraming') {
  const normalizedInput = { version: '1.0', resources: { materials } };
  const payload = shape === 'sceneFraming'
    ? { sceneFraming: { normalizedInput } }
    : { normalizedInputSnapshot: { normalizedInput } };
  return JSON.stringify(payload);
}

const PACK = {
  status: 'ok',
  pack: {
    title: '指南',
    sourceUrl: 'attachment://guide.txt',
    publisher: null,
    sourceTier: 'unknown',
    tldr: 'T'.repeat(1000),
    sections: [
      { id: 's-1', title: '健康领域', summary: '' },
      { id: 's-2', title: '语言领域', summary: '' },
      { id: 's-3', title: '社会领域', summary: '' },
      { id: 's-4', title: '科学领域', summary: '' },
      { id: 's-5', title: '艺术领域', summary: '' },
      { id: 's-6', title: '说明', summary: '' },
      { id: 's-7', title: '超出上限', summary: '' },
    ],
    keyPoints: Array.from({ length: 6 }, (_, index) => ({
      text: `要点${index + 1}`,
      cite: `原文片段${index + 1}`,
      sourceUrl: 'attachment://guide.txt',
    })),
  },
  provenance: [],
  coverage: { covered: [], missing: [] },
  notes: [],
};

describe('resolvePathMaterialsForTeaching', () => {
  it('从 sceneFraming 取回资料，并投影到课堂档上限（章节 6 / 要点 4）', () => {
    const materials = resolvePathMaterialsForTeaching(templateWithMaterials([PACK]))!;
    expect(materials).toHaveLength(1);
    expect(materials[0].title).toBe('指南');
    expect(materials[0].sourceUrl).toBe('attachment://guide.txt');
    expect(materials[0].sections).toHaveLength(6);
    expect(materials[0].keyPoints).toHaveLength(4);
    // 引文必须保留（课堂上要引用原文，不得只给转述）
    expect(materials[0].keyPoints[0].cite).toBe('原文片段1');
  });

  it('sceneFraming 缺失时回退持久化快照', () => {
    const materials = resolvePathMaterialsForTeaching(templateWithMaterials([PACK], 'snapshot'))!;
    expect(materials).toHaveLength(1);
  });

  it('无资料 / 模板为空 / 模板损坏 → null（课堂行为与原先一致）', () => {
    expect(resolvePathMaterialsForTeaching(templateWithMaterials([]))).toBeNull();
    expect(resolvePathMaterialsForTeaching(null)).toBeNull();
    expect(resolvePathMaterialsForTeaching('not json at all')).toBeNull();
    expect(resolvePathMaterialsForTeaching(JSON.stringify({ sceneFraming: { normalizedInput: {} } }))).toBeNull();
  });
});
