/**
 * KC 跨阶段偷跑回归：渐进式只设计当前阶段，prerequisiteTree 必须按阶段文本收窄，
 * 否则 kc-mapping 会为后序阶段概念造 KC 并硬挂到当前任务上（l01 实证）。
 */
import { scopePrerequisiteTreeToStage } from '../stage-enrichment';

const STAGE1_TEXT = [
  '用 Posner 与 Petersen 的注意三网络拆开「名字被叫到就应、听讲却飘走」',
  '鸡尾酒会效应：没被要求留意的那一路，名字怎么还能被听见',
  '判自己那场会：手机弹窗带走后接不上，断在定向还是执行控制',
  '执行控制的维持：主动维持注意，抗干扰',
  '警觉网络的待命反应 定向网络的注意转向 执行控制的抗干扰维持',
].join(' ');

const FULL_TREE = {
  rootConcept: '注意与记忆',
  knownConcepts: ['注意的基本分类', '长时记忆'],
  unknownConcepts: [
    { concept: '警觉与定向网络', depth: 1, note: '先分清自动捕获' },
    { concept: '执行控制的维持', depth: 2, note: '主动维持注意' },
    { concept: '编码、巩固与提取', depth: 2, note: '阶段 2 才讲' },
    { concept: '工作记忆容量', depth: 3, note: '阶段 3 才讲' },
  ],
  gapChain: ['警觉与定向网络', '执行控制的维持', '编码、巩固与提取', '工作记忆容量'],
  maxDepth: 3,
};

describe('scopePrerequisiteTreeToStage', () => {
  it('只保留当前阶段文本里出现过的前置概念，后序阶段的编码/记忆被剔除', () => {
    const scoped = scopePrerequisiteTreeToStage(FULL_TREE, STAGE1_TEXT);
    expect(scoped).not.toBeNull();
    expect(scoped.unknownConcepts.map((item: any) => item.concept)).toEqual([
      '警觉与定向网络',
      '执行控制的维持',
    ]);
    expect(scoped.gapChain).toEqual(['警觉与定向网络', '执行控制的维持']);
    expect(scoped.unknownConcepts.some((item: any) => item.concept.includes('编码'))).toBe(false);
    expect(scoped.unknownConcepts.some((item: any) => item.concept.includes('工作记忆'))).toBe(false);
  });

  it('一个都没命中 → 整棵不发（prerequisiteTree 可选，不拿全量兜底）', () => {
    expect(scopePrerequisiteTreeToStage(FULL_TREE, '完全无关的阶段文本')).toBeNull();
    expect(scopePrerequisiteTreeToStage(null, STAGE1_TEXT)).toBeNull();
  });

  it('保留命中的 knownConcepts 与 rootConcept，不改写原树字段', () => {
    const scoped = scopePrerequisiteTreeToStage(FULL_TREE, `${STAGE1_TEXT} 长时记忆`);
    expect(scoped.rootConcept).toBe('注意与记忆');
    expect(scoped.knownConcepts).toContain('长时记忆');
    expect(scoped.knownConcepts).not.toContain('注意的基本分类');
  });
});
