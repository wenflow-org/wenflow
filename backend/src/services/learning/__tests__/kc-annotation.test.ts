/**
 * KC 映射持久化契约回归（2026-09-22 事故修复）：
 *
 * 事故：stage-enrichment 曾用 `executeSkill`（返回 output 本体）却按
 * `executeSkillWithResult` 的 `{ success, output }` 判空，条件恒 false——
 * KC 图每次路径生成都算完即弃，全库 252 条路径 kcAnnotation 实测全为 null。
 *
 * 本测试锁死三件事：
 * 1. 走 executeSkillWithResult 契约（不是 executeSkill）；
 * 2. 有 success+output 才落库，success:false / 抛错 / 空 output 都不落库且不抛；
 * 3. skill 输入带 cognitiveCore 与 prerequisiteTree（kc-mapper 的缺口覆盖校验输入）。
 */
import { mapAndPersistKcAnnotation } from '../generation/kc-annotation';
import * as skills from '../../../skills';

jest.mock('../../../skills', () => ({
  executeSkillWithResult: jest.fn(),
  executeSkill: jest.fn(),
}));

const template = {
  cognitiveCore: {
    cognitiveDomain: '测试域',
    coreConcepts: [{ id: 'concept-1', name: '识别半联动点', role: 'hub' }],
    prerequisiteTree: {
      rootConcept: '半联动',
      knownConcepts: [],
      unknownConcepts: [{ concept: '半联动', depth: 1 }],
    },
  },
};
const milestones = [
  { stageNumber: 1, title: '阶段一', coreConcept: 'concept-1', description: 'desc', goal: 'goal' },
];
const subtasks = [
  { title: '识别半联动点', type: 'diagnose', linkedConcept: 'concept-1', knowledgeType: 'procedural', cognitiveLevel: 'apply' },
];
const goodOutput = {
  conceptKcs: [{
    conceptId: 'concept-1',
    kcs: [{ kcId: 'kc-1a', name: '识别半联动点', taxonomy: 'procedural', prerequisiteKCs: ['kc-0'] }],
  }],
  taskKcLinks: [{ taskTitle: '识别半联动点', linkedKCs: ['kc-1a'] }],
  kcGraph: {
    nodes: [{ kcId: 'kc-1a', name: '识别半联动点', taxonomy: 'procedural' }],
    edges: [{ from: 'kc-0', to: 'kc-1a', relation: 'prerequisite' }],
  },
};

const withResultMock = () => skills.executeSkillWithResult as jest.Mock;

describe('mapAndPersistKcAnnotation（契约事故回归）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('success+output 时走 WithResult 契约、落库并返回标注', async () => {
    withResultMock().mockResolvedValue({ success: true, output: goodOutput, quality: 'model' });
    const persist = jest.fn();

    const ann = await mapAndPersistKcAnnotation({ pathId: 'lp_1', userId: 'u_1', template, milestones, subtasks, persist });

    expect(withResultMock()).toHaveBeenCalledTimes(1);
    expect(skills.executeSkill).not.toHaveBeenCalled();
    expect(persist).toHaveBeenCalledWith('lp_1', goodOutput);
    expect(ann).toBe(goodOutput);
  });

  it('success:false 不落库、返回 null、不抛错', async () => {
    withResultMock().mockResolvedValue({ success: false, quality: 'failed' });
    const persist = jest.fn();

    const ann = await mapAndPersistKcAnnotation({ pathId: 'lp_1', template, milestones, subtasks, persist });

    expect(persist).not.toHaveBeenCalled();
    expect(ann).toBeNull();
  });

  it('skill 抛错只吞不抛（best-effort 不阻断路径生成）', async () => {
    withResultMock().mockRejectedValue(new Error('response does not contain valid JSON object'));
    const persist = jest.fn();

    const ann = await mapAndPersistKcAnnotation({ pathId: 'lp_1', template, milestones, subtasks, persist });

    expect(persist).not.toHaveBeenCalled();
    expect(ann).toBeNull();
  });

  it('成功但 output 为空不落库', async () => {
    withResultMock().mockResolvedValue({ success: true, output: undefined });
    const persist = jest.fn();

    const ann = await mapAndPersistKcAnnotation({ pathId: 'lp_1', template, milestones, subtasks, persist });

    expect(persist).not.toHaveBeenCalled();
    expect(ann).toBeNull();
  });

  it('skill 输入透传 cognitiveCore / prerequisiteTree / milestones / subtasks', async () => {
    withResultMock().mockResolvedValue({ success: true, output: goodOutput });

    await mapAndPersistKcAnnotation({ pathId: 'lp_1', template, milestones, subtasks, persist: jest.fn() });

    const [definition, input] = withResultMock().mock.calls[0];
    expect(definition.name).toBe('kc-mapper');
    expect(input.cognitiveCore).toBe(template.cognitiveCore);
    expect(input.prerequisiteTree).toBe(template.cognitiveCore.prerequisiteTree);
    expect(input.milestones).toEqual([
      { stageNumber: 1, title: '阶段一', coreConcept: 'concept-1', description: 'desc', goal: 'goal' },
    ]);
    expect(input.subtasks).toEqual([{
      title: '识别半联动点', type: 'diagnose', linkedConcept: 'concept-1', knowledgeType: 'procedural', cognitiveLevel: 'apply',
    }]);
  });

  it('cognitiveCore 缺失时降级为 null（不编造概念）', async () => {
    withResultMock().mockResolvedValue({ success: true, output: goodOutput });

    await mapAndPersistKcAnnotation({ pathId: 'lp_2', template: null, milestones, subtasks, persist: jest.fn() });

    const [, input] = withResultMock().mock.calls[0];
    expect(input.cognitiveCore).toBeNull();
    expect(input.prerequisiteTree).toBeNull();
  });
});

/**
 * 等价变体归一回归（2026-09-22 生产事故）：
 * 模型稳定产出合法 JSON 却因字段名/形态偏离契约被判死或下游读空。
 * coerceKcMapperParsed 把实测变体收敛到契约形态，normalizeOutput 亦复用同一函数。
 */
import { coerceKcMapperParsed } from '../../../skills/kc-mapper';

describe('coerceKcMapperParsed（契约等价变体归一）', () => {
  it('空 gapCoverage（[]/{}）移除，非空归为 {covered,uncovered}', () => {
    expect(coerceKcMapperParsed({ conceptKcs: [], gapCoverage: [] }).gapCoverage).toBeUndefined();
    expect(coerceKcMapperParsed({ conceptKcs: [], gapCoverage: {} }).gapCoverage).toBeUndefined();
    const r = coerceKcMapperParsed({
      conceptKcs: [],
      gapCoverage: [{ conceptId: 'c1', coveredKCs: ['kc-1'], gaps: [] }, { conceptId: 'c2', gaps: ['没覆盖'] }],
    });
    expect(r.gapCoverage).toEqual({ covered: ['c1'], uncovered: [{ concept: 'c2', reason: '没覆盖' }] });
  });

  it('单条明细对象也归为契约形态', () => {
    const r = coerceKcMapperParsed({ conceptKcs: [], gapCoverage: { conceptId: 'c1', gaps: [] } });
    expect(r.gapCoverage).toEqual({ covered: ['c1'], uncovered: [] });
  });

  it('taskKcLinks 的 kcIds 别名补出 linkedKCs（保留原字段）', () => {
    const r = coerceKcMapperParsed({ conceptKcs: [], taskKcLinks: [{ taskTitle: 't', kcIds: ['kc-1'] }] });
    expect(r.taskKcLinks[0].linkedKCs).toEqual(['kc-1']);
  });

  it('edges 缺 relation 补 prerequisite，type 别名转正', () => {
    const r = coerceKcMapperParsed({
      conceptKcs: [],
      kcGraph: { nodes: [], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c', type: 'prerequisite' }] },
    });
    expect(r.kcGraph.edges).toEqual([
      { from: 'a', to: 'b', relation: 'prerequisite' },
      { from: 'b', to: 'c', type: 'prerequisite', relation: 'prerequisite' },
    ]);
  });

  it('节点为纯字符串或缺少 name/taxonomy 时从 conceptKcs 回填', () => {
    const r = coerceKcMapperParsed({
      conceptKcs: [{ conceptId: 'c1', kcs: [{ kcId: 'kc-1', name: '识别半联动点', taxonomy: 'procedural' }] }],
      kcGraph: { nodes: ['kc-1', { kcId: 'kc-1' }], edges: [] },
    });
    expect(r.kcGraph.nodes).toEqual([
      { kcId: 'kc-1', name: '识别半联动点', taxonomy: 'procedural' },
      { kcId: 'kc-1', name: '识别半联动点', taxonomy: 'procedural' },
    ]);
  });

  it('已合规输入保持不变（幂等）', () => {
    const input = {
      conceptKcs: [{ conceptId: 'c1', kcs: [{ kcId: 'kc-1', name: 'n', taxonomy: 'factual' }] }],
      taskKcLinks: [{ taskTitle: 't', linkedKCs: ['kc-1'] }],
      kcGraph: { nodes: [{ kcId: 'kc-1', name: 'n', taxonomy: 'factual' }], edges: [{ from: 'a', to: 'b', relation: 'prerequisite' }] },
      gapCoverage: { covered: ['c1'], uncovered: [] },
    };
    const once = coerceKcMapperParsed(input);
    expect(once).toEqual(input);
    expect(coerceKcMapperParsed(once)).toEqual(input);
  });
});
