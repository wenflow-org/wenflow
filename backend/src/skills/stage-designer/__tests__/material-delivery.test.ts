/**
 * stage-designer 的资料投递（审计 P1 §2.3b / §2.3c）。
 *
 *  §2.3b：无资料时此前直接放行模型给的 materialRefs ⇒ 编造引用落库给学习者看（违反"宁缺勿编"），
 *          与 path-planning 口径不一致。
 *  §2.3c：`normalizedInput.resources.materials`（全量原文）与顶层 `materials`（投影）同进载荷
 *          ⇒ token 浪费 + "模型看到投影外内容却被核对丢弃"的口径不一致。
 */
import { withMaterialRefs, stripNestedMaterials } from '../index';
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

describe('withMaterialRefs', () => {
  it('无资料：模型编造的引用被删除（与 path-planning 同口径）', () => {
    const out = withMaterialRefs(
      [{ title: 't1', materialRefs: [{ quote: '模型编的引用' }] }, { title: 't2' }],
      null,
    );
    expect(out[0].materialRefs).toBeUndefined();
    expect(out[1].materialRefs).toBeUndefined();
  });

  it('无资料（空数组）：同样删除，不留空数组', () => {
    const out = withMaterialRefs([{ materialRefs: [{ quote: 'x' }] }], []);
    expect(out[0].materialRefs).toBeUndefined();
  });

  it('有资料：可核对引用保留并定位章节；编造引用删除', () => {
    const out = withMaterialRefs(
      [
        { materialRefs: [{ quote: '先给结论，再给依据', sectionId: 's-1' }] },
        { materialRefs: [{ quote: '资料里没有这句' }] },
      ],
      MATERIALS,
    );
    expect(out[0].materialRefs[0].quote).toBe('先给结论，再给依据');
    expect(out[0].materialRefs[0].sectionTitle).toBe('第一章 结论先行');
    expect(out[1].materialRefs).toBeUndefined();
  });

  it('脏输入不抛错（非数组 / 非对象任务）', () => {
    expect(withMaterialRefs(null as unknown as unknown[], MATERIALS)).toEqual([]);
    const out = withMaterialRefs(['not-an-object', null], MATERIALS);
    expect(out).toEqual(['not-an-object', null]);
  });
});

describe('stripNestedMaterials', () => {
  it('剥掉 normalizedInput.resources.materials，保留 resources 其他字段', () => {
    const out = stripNestedMaterials({
      learnerProfile: { surfaceGoal: 'g' },
      resources: { timeBudget: '每周5小时', materials: MATERIALS },
    });
    expect(out.resources.materials).toBeUndefined();
    expect(out.resources.timeBudget).toBe('每周5小时');
    expect(out.learnerProfile.surfaceGoal).toBe('g');
  });

  it('无 materials 时原样返回（不制造新对象差异）', () => {
    const input = { resources: { timeBudget: 'x' } };
    expect(stripNestedMaterials(input)).toBe(input);
  });

  it('脏输入不抛错', () => {
    expect(stripNestedMaterials(null)).toBeNull();
    expect(stripNestedMaterials(undefined)).toBeNull();
    expect(stripNestedMaterials('x')).toBe('x');
  });
});
