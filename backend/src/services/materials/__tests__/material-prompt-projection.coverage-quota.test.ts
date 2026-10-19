/**
 * 覆盖约束的语义重排（#119 优化项 3，2026-10-19）：
 * 放开位置窗口的成员约束（候选为全文），但以「三分位配额（前/中/后各 ≥1，配额取自窗口分布）+
 * 语义名次 rerank 填槽」保持覆盖——验收口径：引用语义分位向窗口内上限靠拢、后半覆盖不回落。
 */
import {
  extractPromptMaterials,
  resolveMaterialWindowRange,
  resolveTertileQuota,
  selectSectionsWithCoverageQuota,
  STAGE_MATERIAL_LIMITS,
} from '../material-prompt-projection';

/** 24 节：按 index/(total-1) 分三分位 → T1 s-1..s-8、T2 s-9..s-16、T3 s-17..s-24。 */
function buildContainer(sectionCount: number) {
  const pack = {
    title: '测试资料',
    sourceUrl: 'https://example.com/doc',
    materialId: null,
    tldr: '摘要',
    sections: Array.from({ length: sectionCount }, (_, index) => ({
      id: `s-${index + 1}`,
      title: `第${index + 1}节`,
    })),
    keyPoints: Array.from({ length: 6 }, (_, index) => ({ text: `要点${index + 1}`, cite: `引文${index + 1}` })),
  };
  return { resources: { materials: [{ pack }] } };
}

/** 名次 = 原始序号（越靠前名次越好），便于手算期望。 */
function rankByOrdinal(sectionCount: number): Map<string, number> {
  return new Map(Array.from({ length: sectionCount }, (_, index) => [`s-${index + 1}`, index]));
}

function tertileOf(id: string): 0 | 1 | 2 {
  const ordinal = Number(id.slice(2));
  if (ordinal <= 8) return 0;
  if (ordinal <= 16) return 1;
  return 2;
}

describe('resolveTertileQuota', () => {
  it('24 节 / take 8：配额取自窗口分布 + 每个非空三分位 ≥1（总量恒为 take）', () => {
    // 4 阶段窗口（与 resolveMaterialWindowRange 同一公式）：[0,8) [5,13) [11,19) [16,24)
    expect(resolveTertileQuota(24, 8, resolveMaterialWindowRange(24, 8, 1, 4))).toEqual([6, 1, 1]);
    expect(resolveTertileQuota(24, 8, resolveMaterialWindowRange(24, 8, 2, 4))).toEqual([3, 4, 1]);
    expect(resolveTertileQuota(24, 8, resolveMaterialWindowRange(24, 8, 3, 4))).toEqual([1, 4, 3]);
    expect(resolveTertileQuota(24, 8, resolveMaterialWindowRange(24, 8, 4, 4))).toEqual([1, 1, 6]);
  });

  it('三分位展示总量与窗口方案一致（后半覆盖不回落的配额侧保证）', () => {
    const quotaTotals = [0, 0, 0];
    const windowTotals = [0, 0, 0];
    for (let stage = 1; stage <= 4; stage += 1) {
      const anchor = resolveMaterialWindowRange(24, 8, stage, 4);
      const quota = resolveTertileQuota(24, 8, anchor);
      for (const t of [0, 1, 2] as const) quotaTotals[t] += quota[t];
      for (let index = anchor[0]; index < anchor[1]; index += 1) {
        windowTotals[tertileOf(`s-${index + 1}`)] += 1;
      }
    }
    expect(quotaTotals).toEqual(windowTotals);
    expect(quotaTotals).toEqual([11, 10, 11]);
  });

  it('退化：take=0 / total=0 为空配额；小文档总量仍不超过 take', () => {
    expect(resolveTertileQuota(24, 0, [0, 0])).toEqual([0, 0, 0]);
    expect(resolveTertileQuota(0, 8, [0, 0])).toEqual([0, 0, 0]);
    const small = resolveTertileQuota(3, 2, [0, 3]);
    expect(small[0] + small[1] + small[2]).toBe(2);
  });
});

describe('selectSectionsWithCoverageQuota', () => {
  const sections = Array.from({ length: 24 }, (_, index) => ({ id: `s-${index + 1}`, title: `第${index + 1}节` }));
  const ranks = rankByOrdinal(24);

  it('阶段 1/4：选满 8 节，成员放开到窗口外（窗口 [0,8) 之外出现 s-9 与 s-17）', () => {
    const picked = selectSectionsWithCoverageQuota(sections, 8, resolveMaterialWindowRange(24, 8, 1, 4), ranks);
    expect(picked.map((section) => section.id)).toEqual([
      's-1', 's-2', 's-3', 's-4', 's-5', 's-6', 's-9', 's-17',
    ]);
  });

  it('阶段 4/4：尾部为主体，同时保留前/中锚点（前/中/后=1/1/6）', () => {
    const picked = selectSectionsWithCoverageQuota(sections, 8, resolveMaterialWindowRange(24, 8, 4, 4), ranks);
    expect(picked.map((section) => section.id)).toEqual([
      's-1', 's-9', 's-17', 's-18', 's-19', 's-20', 's-21', 's-22',
    ]);
  });

  it('配额内按语义名次取最优（名次反转时选出的是尾部最优而非头部）', () => {
    const reversed = new Map(Array.from({ length: 24 }, (_, index) => [`s-${index + 1}`, 23 - index]));
    const picked = selectSectionsWithCoverageQuota(sections, 8, resolveMaterialWindowRange(24, 8, 1, 4), reversed);
    // 名次最好的是 s-24、s-23…：T3 配额 1 取 s-24，T2 取 s-16，T1 取 s-8..s-3；输出按名次升序。
    expect(picked.map((section) => section.id)).toEqual([
      's-24', 's-16', 's-8', 's-7', 's-6', 's-5', 's-4', 's-3',
    ]);
  });

  it('未命中名次的章节保持原位次、排在有名次者之后；不因缺名次丢成员', () => {
    const partial = new Map<string, number>([['s-20', 0], ['s-3', 1]]);
    const picked = selectSectionsWithCoverageQuota(sections, 8, resolveMaterialWindowRange(24, 8, 1, 4), partial);
    expect(picked).toHaveLength(8);
    expect(picked[0]?.id).toBe('s-20');
    expect(picked[1]?.id).toBe('s-3');
  });

  it('退化：take ≥ total 时原序全量；take=0 为空', () => {
    const pickedAll = selectSectionsWithCoverageQuota(sections, 24, [0, 24], ranks);
    expect(pickedAll.map((section) => section.id)).toEqual(sections.map((section) => section.id));
    expect(selectSectionsWithCoverageQuota(sections, 0, [0, 8], ranks)).toEqual([]);
  });
});

describe('extractPromptMaterials 覆盖约束模式（coverageQuota）', () => {
  const ranks = rankByOrdinal(24);

  it('开启后：成员为配额集合（跨窗口）、数量仍为 8、顺序按名次', () => {
    const materials = extractPromptMaterials(
      buildContainer(24),
      STAGE_MATERIAL_LIMITS,
      { stageNumber: 1, stageCount: 4 },
      ranks,
      true
    );
    expect(materials?.[0]?.sections).toHaveLength(8);
    expect(materials?.[0]?.sections.map((section) => section.id)).toEqual([
      's-1', 's-2', 's-3', 's-4', 's-5', 's-6', 's-9', 's-17',
    ]);
  });

  it('fail-open：无（或空）名次映射时退回窗口切片路径（与旧行为逐字一致）', () => {
    const expected = extractPromptMaterials(buildContainer(24), STAGE_MATERIAL_LIMITS, { stageNumber: 2, stageCount: 4 }, ranks);
    const windowOnly = extractPromptMaterials(buildContainer(24), STAGE_MATERIAL_LIMITS, { stageNumber: 2, stageCount: 4 });
    const quotaWithoutRank = extractPromptMaterials(
      buildContainer(24),
      STAGE_MATERIAL_LIMITS,
      { stageNumber: 2, stageCount: 4 },
      null,
      true
    );
    const quotaEmptyRank = extractPromptMaterials(
      buildContainer(24),
      STAGE_MATERIAL_LIMITS,
      { stageNumber: 2, stageCount: 4 },
      new Map<string, number>(),
      true
    );
    expect(quotaWithoutRank?.[0]?.sections).toEqual(windowOnly?.[0]?.sections);
    expect(quotaEmptyRank?.[0]?.sections).toEqual(windowOnly?.[0]?.sections);
    // 窗口 + 名次但未开配额：仍是窗口成员的语义重排（不放大候选）
    expect(expected?.[0]?.sections?.map((section) => section.id)).toEqual(
      windowOnly?.[0]?.sections?.map((section) => section.id)
    );
  });

  it('不传 coverageQuota 时保持优化项 2 的窗口内重排（成员与数量不变）', () => {
    const windowIds = extractPromptMaterials(buildContainer(24), STAGE_MATERIAL_LIMITS, { stageNumber: 3, stageCount: 4 })?.[0]
      ?.sections.map((section) => section.id);
    const reordered = extractPromptMaterials(
      buildContainer(24),
      STAGE_MATERIAL_LIMITS,
      { stageNumber: 3, stageCount: 4 },
      ranks
    )?.[0]?.sections.map((section) => section.id);
    expect([...(reordered || [])].sort()).toEqual([...(windowIds || [])].sort());
  });

  it('单阶段/条目不足时退化为全量原序（与窗口路径一致）', () => {
    const materials = extractPromptMaterials(
      buildContainer(6),
      STAGE_MATERIAL_LIMITS,
      { stageNumber: 1, stageCount: 1 },
      rankByOrdinal(6),
      true
    );
    expect(materials?.[0]?.sections.map((section) => section.id)).toEqual(['s-1', 's-2', 's-3', 's-4', 's-5', 's-6']);
  });
});
