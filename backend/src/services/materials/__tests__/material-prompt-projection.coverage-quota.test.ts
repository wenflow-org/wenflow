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
  it('24 节 / take 8：配额严格等于窗口分布（首版「每三分位 ≥1」地板实测损后半覆盖，已撤）', () => {
    // 4 阶段窗口（与 resolveMaterialWindowRange 同一公式）：[0,8) [5,13) [11,19) [16,24)
    expect(resolveTertileQuota(24, 8, resolveMaterialWindowRange(24, 8, 1, 4))).toEqual([8, 0, 0]);
    expect(resolveTertileQuota(24, 8, resolveMaterialWindowRange(24, 8, 2, 4))).toEqual([3, 5, 0]);
    expect(resolveTertileQuota(24, 8, resolveMaterialWindowRange(24, 8, 3, 4))).toEqual([0, 5, 3]);
    expect(resolveTertileQuota(24, 8, resolveMaterialWindowRange(24, 8, 4, 4))).toEqual([0, 0, 8]);
  });

  it('三分位展示总量与窗口方案逐位一致（后半覆盖不回落的配额侧保证）', () => {
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

  it('退化：take=0 / total=0 为空配额；小文档总量不超过 take', () => {
    expect(resolveTertileQuota(24, 0, [0, 0])).toEqual([0, 0, 0]);
    expect(resolveTertileQuota(0, 8, [0, 0])).toEqual([0, 0, 0]);
    const small = resolveTertileQuota(3, 2, [0, 3]);
    expect(small[0] + small[1] + small[2]).toBe(2);
  });
});

describe('selectSectionsWithCoverageQuota', () => {
  const sections = Array.from({ length: 24 }, (_, index) => ({ id: `s-${index + 1}`, title: `第${index + 1}节` }));
  const ranks = rankByOrdinal(24);

  it('阶段 1/4：配额全在前三分位，成员为区域内语义最优（窗口区间的全集内挑）', () => {
    const picked = selectSectionsWithCoverageQuota(sections, 8, resolveMaterialWindowRange(24, 8, 1, 4), ranks);
    expect(picked.map((section) => section.id)).toEqual([
      's-1', 's-2', 's-3', 's-4', 's-5', 's-6', 's-7', 's-8',
    ]);
  });

  it('阶段 3/4：中/后配额取自各自三分位全体（放开窗口切片 s12–s19）', () => {
    const picked = selectSectionsWithCoverageQuota(sections, 8, resolveMaterialWindowRange(24, 8, 3, 4), ranks);
    // 配额 [0,5,3]：T2 全量 s-9..s-16 取前 5（s-9..s-13）、T3 全量 s-17..s-24 取前 3（s-17..s-19）
    expect(picked.map((section) => section.id)).toEqual([
      's-9', 's-10', 's-11', 's-12', 's-13', 's-17', 's-18', 's-19',
    ]);
  });

  it('阶段 4/4：全尾部（与窗口同分布），成员为尾部区域内语义最优', () => {
    const picked = selectSectionsWithCoverageQuota(sections, 8, resolveMaterialWindowRange(24, 8, 4, 4), ranks);
    expect(picked.map((section) => section.id)).toEqual([
      's-17', 's-18', 's-19', 's-20', 's-21', 's-22', 's-23', 's-24',
    ]);
  });

  it('配额内按语义名次取最优（名次反转时选出的是尾部最优而非头部）', () => {
    const reversed = new Map(Array.from({ length: 24 }, (_, index) => [`s-${index + 1}`, 23 - index]));
    const picked = selectSectionsWithCoverageQuota(sections, 8, resolveMaterialWindowRange(24, 8, 3, 4), reversed);
    // 名次最好的是 s-24、s-23…：T2 配额 5 取 s-16..s-12，T3 配额 3 取 s-24..s-22；输出按名次升序。
    expect(picked.map((section) => section.id)).toEqual([
      's-24', 's-23', 's-22', 's-16', 's-15', 's-14', 's-13', 's-12',
    ]);
  });

  it('未命中名次的章节保持原位次、排在有名次者之后；不因缺名次丢成员', () => {
    const partial = new Map<string, number>([['s-20', 0], ['s-3', 1]]);
    const picked = selectSectionsWithCoverageQuota(sections, 8, resolveMaterialWindowRange(24, 8, 1, 4), partial);
    expect(picked).toHaveLength(8);
    expect(picked[0]?.id).toBe('s-3');
  });

  it('退化：take ≥ total 时原序全量；take=0 为空', () => {
    const pickedAll = selectSectionsWithCoverageQuota(sections, 24, [0, 24], ranks);
    expect(pickedAll.map((section) => section.id)).toEqual(sections.map((section) => section.id));
    expect(selectSectionsWithCoverageQuota(sections, 0, [0, 8], ranks)).toEqual([]);
  });
});

describe('extractPromptMaterials 覆盖约束模式（coverageQuota）', () => {
  const ranks = rankByOrdinal(24);

  it('开启后：数量仍为 8、配额等于窗口分布、成员为区域内语义最优、顺序按名次', () => {
    const materials = extractPromptMaterials(
      buildContainer(24),
      STAGE_MATERIAL_LIMITS,
      { stageNumber: 3, stageCount: 4 },
      ranks,
      true
    );
    expect(materials?.[0]?.sections).toHaveLength(8);
    // 阶段 3/4 配额 [0,5,3]：窗口切片是 s-12..s-19，配额模式下 T2 从 s-9..s-16 取、T3 从 s-17..s-24 取。
    expect(materials?.[0]?.sections.map((section) => section.id)).toEqual([
      's-9', 's-10', 's-11', 's-12', 's-13', 's-17', 's-18', 's-19',
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
