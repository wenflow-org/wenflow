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
