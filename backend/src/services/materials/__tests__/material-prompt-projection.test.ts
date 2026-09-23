/**
 * 资料 → 提示词投影（三处消费方的**单源**）：path / stage / teaching 共用。
 *
 * 验收点：
 *   1) 只保留可核对的最小集合（章节 id/title + 带引文要点），tldr 截断；
 *   2) 上限按消费方不同（path 最全、teaching 最小）；
 *   3) 无资料/空资料 → null（调用方据此"不出现该键"，冷启动行为不变）；
 *   4) `extractPromptMaterials` 能识别三种容器形态。
 */
import {
  PATH_MATERIAL_LIMITS,
  STAGE_MATERIAL_LIMITS,
  TEACHING_MATERIAL_LIMITS,
  buildPromptFriendlyMaterials,
  extractPromptMaterials,
} from '../material-prompt-projection';

function pack(overrides: Record<string, unknown> = {}) {
  return {
    status: 'ok',
    pack: {
      title: '指南',
      publisher: null,
      sourceTier: 'unknown',
      sourceUrl: 'attachment://guide.txt',
      version: null,
      fetchedAt: '2026-09-22T00:00:00.000Z',
      license: null,
      tldr: 'T'.repeat(2000),
      sections: Array.from({ length: 20 }, (_, index) => ({ id: `s-${index + 1}`, title: `章节${index + 1}`, summary: '' })),
      keyPoints: Array.from({ length: 20 }, (_, index) => ({ text: `要点${index + 1}`, cite: `原文${index + 1}`, sourceUrl: 'attachment://guide.txt' })),
      ...overrides,
    },
    provenance: [],
    coverage: { covered: [], missing: [] },
    notes: [],
  };
}

describe('buildPromptFriendlyMaterials', () => {
  it('只保留 title/sourceUrl/sections/keyPoints，并按上限截断', () => {
    const result = buildPromptFriendlyMaterials([pack()], PATH_MATERIAL_LIMITS)!;
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('指南');
    expect(result[0].sourceUrl).toBe('attachment://guide.txt');
    expect(result[0].sections).toHaveLength(PATH_MATERIAL_LIMITS.maxSections);
    expect(result[0].keyPoints).toHaveLength(PATH_MATERIAL_LIMITS.maxKeyPoints);
    expect(result[0].tldr!.length).toBe(PATH_MATERIAL_LIMITS.maxTldrChars);
    // 章节 id 必须保留（里程碑/任务要按 id 引用资料条目）
    expect(result[0].sections[0]).toEqual({ id: 's-1', title: '章节1' });
  });

  it('课堂档比路径档更小（每轮都进上下文）', () => {
    const path = buildPromptFriendlyMaterials([pack()], PATH_MATERIAL_LIMITS)!;
    const teaching = buildPromptFriendlyMaterials([pack()], TEACHING_MATERIAL_LIMITS)!;
    expect(teaching[0].sections.length).toBeLessThan(path[0].sections.length);
    expect(teaching[0].keyPoints.length).toBeLessThan(path[0].keyPoints.length);
    expect(teaching[0].tldr!.length).toBeLessThan(path[0].tldr!.length);
    expect(STAGE_MATERIAL_LIMITS.maxSections).toBeLessThan(PATH_MATERIAL_LIMITS.maxSections);
  });

  it('无资料 / 空数组 / 只有 not_found 包 → null', () => {
    expect(buildPromptFriendlyMaterials(null)).toBeNull();
    expect(buildPromptFriendlyMaterials([])).toBeNull();
    expect(buildPromptFriendlyMaterials([{ status: 'not_found', pack: null }])).toBeNull();
  });

  it('包内既无章节也无要点 → 跳过（不产生空壳）', () => {
    expect(buildPromptFriendlyMaterials([pack({ sections: [], keyPoints: [] })])).toBeNull();
  });

  it('最多带 maxMaterials 份（附件在前、联网在后的顺序由上游决定）', () => {
    const many = Array.from({ length: 5 }, (_, index) => pack({ title: `资料${index}` }));
    expect(buildPromptFriendlyMaterials(many, PATH_MATERIAL_LIMITS)).toHaveLength(PATH_MATERIAL_LIMITS.maxMaterials);
  });
});

describe('extractPromptMaterials（容器形态兼容）', () => {
  const normalizedInput = { resources: { materials: [pack()] } };

  it('直接传 normalizedInput', () => {
    expect(extractPromptMaterials(normalizedInput)).toHaveLength(1);
  });

  it('传 { normalizedInput }', () => {
    expect(extractPromptMaterials({ normalizedInput })).toHaveLength(1);
  });

  it('传 { resources: { materials } }', () => {
    expect(extractPromptMaterials({ resources: { materials: [pack()] } })).toHaveLength(1);
  });

  it('拿不到资料 → null（不抛错）', () => {
    expect(extractPromptMaterials(null)).toBeNull();
    expect(extractPromptMaterials({})).toBeNull();
    expect(extractPromptMaterials({ normalizedInput: {} })).toBeNull();
  });
});
