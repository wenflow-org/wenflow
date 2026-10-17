/**
 * 阶段位置窗口（2026-10-17）：stage-designer 每阶段只带 8 个章节，此前恒取前 8 个，
 * 24 章节的包里后 2/3 永远不可见（20 goal A/B：路径引用后半仅 9%）。
 * 修复后按阶段位次切连续窗口：首阶段头、末阶段尾，整条路径才能覆盖全文。
 */
import {
  extractPromptMaterials,
  resolveMaterialWindowRange,
  STAGE_MATERIAL_LIMITS,
} from '../material-prompt-projection';

function buildContainer(sectionCount: number, pointCount: number) {
  const pack = {
    title: '测试资料',
    sourceUrl: 'https://example.com/doc',
    materialId: null,
    tldr: '摘要',
    sections: Array.from({ length: sectionCount }, (_, index) => ({
      id: `s-${index + 1}`,
      title: `第${index + 1}节`,
    })),
    keyPoints: Array.from({ length: pointCount }, (_, index) => ({
      text: `要点${index + 1}`,
      cite: `引文${index + 1}`,
    })),
  };
  return { resources: { materials: [{ pack }] } };
}

describe('resolveMaterialWindowRange', () => {
  it('24 段 / 3 阶段 / 每阶段 8 段 → 头中尾三段不重叠且覆盖全文', () => {
    expect(resolveMaterialWindowRange(24, 8, 1, 3)).toEqual([0, 8]);
    expect(resolveMaterialWindowRange(24, 8, 2, 3)).toEqual([8, 16]);
    expect(resolveMaterialWindowRange(24, 8, 3, 3)).toEqual([16, 24]);
  });

  it('阶段数多于窗口能覆盖的段数时允许重叠，首尾仍锚定两端', () => {
    const first = resolveMaterialWindowRange(24, 8, 1, 5);
    const middle = resolveMaterialWindowRange(24, 8, 3, 5);
    const last = resolveMaterialWindowRange(24, 8, 5, 5);
    expect(first).toEqual([0, 8]);
    expect(middle[0]).toBeGreaterThan(0);
    expect(middle[0]).toBeLessThan(16);
    expect(last).toEqual([16, 24]);
  });

  it('条数不足窗口 / 单阶段 / 序号越界 → 退化为从头取（与改造前一致）', () => {
    expect(resolveMaterialWindowRange(3, 8, 2, 3)).toEqual([0, 3]);
    expect(resolveMaterialWindowRange(24, 8, 1, 1)).toEqual([0, 8]);
    expect(resolveMaterialWindowRange(24, 8, 9, 3)).toEqual([16, 24]);
    expect(resolveMaterialWindowRange(0, 8, 1, 3)).toEqual([0, 0]);
  });
});

describe('extractPromptMaterials 按阶段窗口投影', () => {
  it('3 阶段路径逐段拿到 s-1..s-8 / s-9..s-16 / s-17..s-24', () => {
    const ids = (stageNumber: number) => {
      const materials = extractPromptMaterials(buildContainer(24, 12), STAGE_MATERIAL_LIMITS, {
        stageNumber,
        stageCount: 3,
      });
      return materials?.[0]?.sections.map((section) => section.id);
    };
    expect(ids(1)).toEqual(Array.from({ length: 8 }, (_, i) => `s-${i + 1}`));
    expect(ids(2)).toEqual(Array.from({ length: 8 }, (_, i) => `s-${i + 9}`));
    expect(ids(3)).toEqual(Array.from({ length: 8 }, (_, i) => `s-${i + 17}`));
  });

  it('要点同步按位置窗口切：首阶段前 6 条、末阶段后 6 条', () => {
    const points = (stageNumber: number) => extractPromptMaterials(buildContainer(24, 12), STAGE_MATERIAL_LIMITS, {
      stageNumber,
      stageCount: 3,
    })?.[0]?.keyPoints.map((point) => point.text);
    expect(points(1)).toEqual(['要点1', '要点2', '要点3', '要点4', '要点5', '要点6']);
    expect(points(3)).toEqual(['要点7', '要点8', '要点9', '要点10', '要点11', '要点12']);
  });

  it('不传窗口时保持改造前的「取前 N 条」语义（向后兼容）', () => {
    const materials = extractPromptMaterials(buildContainer(24, 12), STAGE_MATERIAL_LIMITS);
    expect(materials?.[0]?.sections).toHaveLength(8);
    expect(materials?.[0]?.sections[0]?.id).toBe('s-1');
    expect(materials?.[0]?.sections[7]?.id).toBe('s-8');
  });
});
