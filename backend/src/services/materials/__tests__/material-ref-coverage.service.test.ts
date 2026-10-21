import {
  assessMaterialRefCoverage,
  materialsHaveLexicalOverlap,
} from '../material-ref-coverage.service';
import type { PromptMaterial } from '../material-prompt-projection';

function material(overrides: Partial<PromptMaterial> = {}): PromptMaterial {
  return {
    title: '公司合规手册',
    sourceUrl: 'attachment://%E5%90%88%E8%A7%84',
    materialId: 'm1',
    publisher: null,
    sourceTier: 'unknown',
    tldr: '公司合规风险管理与员工行为准则',
    sections: [{ id: 's1', title: '合规风险管理' }],
    keyPoints: [{ text: '员工行为准则', cite: '员工应当遵守礼品与招待规定' }],
    brief: null,
    ...overrides,
  };
}

describe('materialsHaveLexicalOverlap', () => {
  it('单个通用 bigram 不足以认定相关，两个以上才算', () => {
    const healthGuide = material({
      title: '3-6岁儿童学习与发展指南',
      tldr: '健康领域',
      sections: [{ id: 's1', title: '健康' }],
      keyPoints: [],
    });
    // “健康”只命中通用词，不构成 4 字连续片段
    expect(materialsHaveLexicalOverlap([healthGuide], '健康管理师报考')).toBe(false);
    expect(materialsHaveLexicalOverlap([healthGuide], '儿童学习与发展')).toBe(true);
  });
});

describe('assessMaterialRefCoverage', () => {
  it('资料与目标相关且所有节点零引用 → 软校验失败', () => {
    const result = assessMaterialRefCoverage({
      materials: [material()],
      nodes: [
        { label: '里程碑 1「风险识别」', refs: [] },
        { label: '里程碑 2「合规处置」', refs: undefined },
      ],
      text: '公司合规风险管理与员工行为准则',
      scope: 'PATH',
    });

    expect(result.relevant).toBe(true);
    expect(result.valid).toBe(false);
    expect(result.covered).toBe(0);
    expect(result.failureReason).toContain('MATERIAL_REFS_MISSING_PATH');
    expect(result.violations).toEqual([
      '里程碑 1「风险识别」 未给出逐字可核对的资料引用',
      '里程碑 2「合规处置」 未给出逐字可核对的资料引用',
    ]);
  });

  it('逐字引用章节标题 → 覆盖成立', () => {
    const result = assessMaterialRefCoverage({
      materials: [material()],
      nodes: [
        {
          label: '里程碑 1「风险识别」',
          refs: [{ materialId: 'm1', sectionId: 's1', quote: '合规风险管理' }],
        },
      ],
      text: '公司合规风险管理与员工行为准则',
      scope: 'PATH',
    });

    expect(result.relevant).toBe(true);
    expect(result.valid).toBe(true);
    expect(result.covered).toBe(1);
    expect(result.missing).toEqual([]);
  });

  it('资料与目标明显无关时，零引用也算通过（不硬塞无关附件）', () => {
    const photo = material({
      title: '摄影构图笔记',
      tldr: '三分法 景深 光圈',
      sections: [{ id: 's1', title: '摄影构图' }],
      keyPoints: [],
    });
    const result = assessMaterialRefCoverage({
      materials: [photo],
      nodes: [{ label: '里程碑 1「税务申报」', refs: [] }],
      text: '个人所得税年度汇算申报',
      scope: 'PATH',
    });

    expect(result.relevant).toBe(false);
    expect(result.valid).toBe(true);
  });

  it('相关资料但只有部分任务有引用（如 1/4）→ 部分覆盖不重试，只记录缺失', () => {
    const coveredRefs = [{ materialId: 'm1', sectionId: 's1', quote: '合规风险管理' }];
    const result = assessMaterialRefCoverage({
      materials: [material()],
      nodes: [
        { label: '任务 1「风险识别」', refs: coveredRefs },
        { label: '任务 2「合规处置」', refs: [] },
        { label: '任务 3「访谈整理」', refs: undefined },
        { label: '任务 4「风险清单」', refs: [] },
      ],
      text: '公司合规风险管理与员工行为准则',
      scope: 'STAGE',
    });

    expect(result.relevant).toBe(true);
    expect(result.valid).toBe(true);
    expect(result.covered).toBe(1);
    expect(result.total).toBe(4);
    expect(result.missing).toEqual([
      '任务 2「合规处置」',
      '任务 3「访谈整理」',
      '任务 4「风险清单」',
    ]);
    expect(result.failureReason).toBeUndefined();
  });

  it('无资料或无节点时直接通过', () => {
    expect(assessMaterialRefCoverage({
      materials: [],
      nodes: [{ label: '里程碑 1', refs: [] }],
      text: '任意目标',
      scope: 'PATH',
    }).valid).toBe(true);
    expect(assessMaterialRefCoverage({
      materials: [material()],
      nodes: [],
      text: '任意目标',
      scope: 'STAGE',
    }).valid).toBe(true);
  });
});
