import { applyPlanningMaterialScope, collectPlanningMaterialIds } from '../stage-enrichment';

function material(id: string) {
  return { status: 'ok', pack: { materialId: id, title: id } };
}

describe('资料按 path-planning 引用收口', () => {
  it('规划引用过的资料保留，未被引用的剥离（经济路径挂物理附件的形态）', () => {
    const normalizedInput: any = { resources: { materials: [material('physics'), material('econ-textbook')] } };
    const template = {
      suggestedMilestones: [
        { stage: 1, materialRefs: [{ materialId: 'econ-textbook', sectionId: 's-1' }] },
      ],
    };
    expect([...collectPlanningMaterialIds(template)]).toEqual(['econ-textbook']);
    applyPlanningMaterialScope(normalizedInput, template);
    expect(normalizedInput.resources.materials.map((m: any) => m.pack.materialId)).toEqual(['econ-textbook']);
  });

  it('规划零引用 → 下游资料清空（上游文案说无关、代码真的不注入）', () => {
    const normalizedInput: any = { resources: { materials: [material('physics'), material('paper')] } };
    applyPlanningMaterialScope(normalizedInput, { suggestedMilestones: [{ stage: 1 }, { stage: 2 }] });
    expect(normalizedInput.resources.materials).toEqual([]);
  });

  it('物理教材路径逐阶段引用 → 全部保留', () => {
    const normalizedInput: any = { resources: { materials: [material('outline')] } };
    const template = {
      suggestedMilestones: [1, 2, 3, 4].map((stage) => ({
        stage,
        materialRefs: [{ materialId: 'outline', sectionId: `s-${stage}` }],
      })),
    };
    applyPlanningMaterialScope(normalizedInput, template);
    expect(normalizedInput.resources.materials).toHaveLength(1);
  });

  it('没有资料包时不动（不造空壳 resources）', () => {
    const normalizedInput: any = { resources: {} };
    applyPlanningMaterialScope(normalizedInput, { suggestedMilestones: [] });
    expect(normalizedInput.resources.materials).toBeUndefined();
  });
});
