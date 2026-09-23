/**
 * path-planning 两个此前零测试的导出（审计 P2 测试缺口）：
 *   - coercePathPlanningParsed：契约校验前的容错归一（totalMilestones 补齐 / materialRefs 逐字核对 / 概念描述字段名归一）
 *   - buildPathValidationRepairNotice：校验失败 → 针对性修复提示
 *
 * 二者都在生产主链上（coerce 挂 coerceParsedForContract、repairNotice 用于重试轮），
 * 一旦回归就是「模型输出合规却被判死」或「重试仍犯同一个错」这类静默故障。
 */
import { coercePathPlanningParsed, buildPathValidationRepairNotice } from '../index';
import type { PromptMaterial } from '../../../services/materials/material-prompt-projection';

const MATERIALS: PromptMaterial[] = [
  {
    title: '汇报结构讲义',
    sourceUrl: null,
    materialId: 'mat-1',
    publisher: null,
    sourceTier: null,
    tldr: '汇报结构：结论—依据—请求。',
    sections: [{ id: 's-1', title: '第一章 结论先行' }],
    keyPoints: [{ cite: '先给结论，再给依据', text: '汇报要先给结论，再给依据。' }],
  },
];

describe('coercePathPlanningParsed', () => {
  it('非对象 / 数组 → 原样返回（不构造）', () => {
    expect(coercePathPlanningParsed(null)).toBeNull();
    expect(coercePathPlanningParsed('x')).toBe('x');
    const arr = [1, 2];
    expect(coercePathPlanningParsed(arr)).toBe(arr);
  });

  it('totalMilestones 缺失/非法 → 用 milestones.length 补齐（曾致 missing-required 整轮失败）', () => {
    const out = coercePathPlanningParsed({ milestones: [{}, {}, {}] });
    expect(out.totalMilestones).toBe(3);

    const nonNumeric = coercePathPlanningParsed({ totalMilestones: 'abc', milestones: [{}, {}] });
    expect(nonNumeric.totalMilestones).toBe(2);
  });

  it('totalMilestones 已给合法值 → 不覆盖', () => {
    expect(coercePathPlanningParsed({ totalMilestones: 4, milestones: [{}, {}] }).totalMilestones).toBe(4);
  });

  it('无资料时不动 materialRefs（核对发生在 normalizeOutput / 有资料分支）', () => {
    const out = coercePathPlanningParsed({ milestones: [{ materialRefs: [{ quote: '模型编的引用' }] }] });
    expect(out.milestones[0].materialRefs).toEqual([{ quote: '模型编的引用' }]);
  });

  it('有资料时逐字核对：编造的引用被删、可核对的保留（宁缺勿编）', () => {
    const out = coercePathPlanningParsed({
      milestones: [
        // 给 sectionId 时按其定位章节
        { materialRefs: [{ quote: '先给结论，再给依据', sectionId: 's-1' }] },
        // 不给 sectionId 且引文不含章节标题 → 章节定位不到（sectionId 为 null），但引用仍保留
        { materialRefs: [{ quote: '汇报结构：结论—依据—请求。' }] },
        { materialRefs: [{ quote: '这句话资料里根本没有' }] },
      ],
    }, MATERIALS);

    expect(out.milestones[0].materialRefs[0].quote).toBe('先给结论，再给依据');
    expect(out.milestones[0].materialRefs[0].sectionId).toBe('s-1');
    expect(out.milestones[0].materialRefs[0].sectionTitle).toBe('第一章 结论先行');
    expect(out.milestones[1].materialRefs[0].quote).toBe('汇报结构：结论—依据—请求。');
    expect(out.milestones[1].materialRefs[0].sectionId).toBeNull();
    // 核对不过 → 整个 materialRefs 键被删（不是留空数组）
    expect(out.milestones[2].materialRefs).toBeUndefined();
  });

  it('coreConcepts 的描述字段名归一（understanding/desc → description）', () => {
    const out = coercePathPlanningParsed({
      cognitiveCore: {
        coreConcepts: [
          { id: 'concept-1', name: 'A', role: 'hub', understanding: '写成 understanding 的描述' },
          { id: 'concept-2', name: 'B', role: 'supporting', desc: '写成 desc 的描述' },
          { id: 'concept-3', name: 'C', role: 'supporting', description: '本来就对' },
        ],
      },
    });

    expect(out.cognitiveCore.coreConcepts.map((c: { description?: string }) => c.description))
      .toEqual(['写成 understanding 的描述', '写成 desc 的描述', '本来就对']);
  });
});

describe('buildPathValidationRepairNotice', () => {
  it('totalMilestones 缺失 → 专门提示（含骨架与"必须等于数组长度"）', () => {
    const notice = buildPathValidationRepairNotice('fields contract violation: totalMilestones(missing-required:number)');
    expect(notice).toContain('totalMilestones');
    expect(notice).toContain('必须等于 milestones 数组长度');
    expect(notice).toContain('"milestones"');
  });

  it('已知失败码 → 对应针对性提示（头号失败门 hub 缺失）', () => {
    const hub = buildPathValidationRepairNotice('PATH_PLANNING_HUB_CONCEPT_MISSING');
    expect(hub).toContain('role="hub"');
    expect(hub).toContain('id/name/role/description');

    const legacy = buildPathValidationRepairNotice('PATH_PLANNING_LEGACY_TASK_FIELDS');
    expect(legacy).toContain('subtasks');

    const unbound = buildPathValidationRepairNotice('PATH_PLANNING_MILESTONE_CONCEPT_UNBOUND');
    expect(unbound).toContain('concept-1');
  });

  it('失败码被前缀包裹时仍能命中（真实 failureReason 形态）', () => {
    const notice = buildPathValidationRepairNotice('校验失败：PATH_PLANNING_HUB_CONCEPT_MULTIPLE（上次多个 hub）');
    expect(notice).toContain('多个 role="hub"');
  });

  it('未知原因 / 空值 → 通用骨架（不返回空串）', () => {
    for (const reason of ['SOMETHING_ELSE', '', undefined as unknown as string]) {
      const notice = buildPathValidationRepairNotice(reason);
      expect(notice).toContain('"cognitiveCore"');
      expect(notice.length).toBeGreaterThan(50);
    }
  });
});
