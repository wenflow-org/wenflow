/**
 * 本课知识范围（L3 断点修复 · 2026-09-23）
 *
 * 修复前：`buildTaskKnowledgeSeeds` 是恒返回 `[]` 的空桩，而 `subtasks.learningObjectives` 全库为空
 * （实测 2037/2037），两者叠加使 `primaryConcepts` 恒为 `[]`；`prerequisiteConcepts` 又按
 * `primaryConcepts` 过滤 → **结构性永远为空**。整条"图 → 上游闭包 → 教学上下文"的链在这里断掉。
 *
 * 修复后：种子取自 `kcAnnotation.taskKcLinks`（kc-mapper 产出，含契约漂移归一），
 * 取不到时回落任务自身的 canonical 概念；前置筛选改为按 `source` 区分真上游与回落口径。
 */
import { buildTaskKnowledgeSeeds, pickPrerequisiteConcepts } from '../TeachingContextBuilder';

const pathWithKcs = {
  aiPromptTemplate: JSON.stringify({
    kcAnnotation: {
      taskKcLinks: [{ taskTitle: '圈出内层函数', linkedKCs: ['kc-1a', 'kc-1b'] }],
      kcGraph: {
        nodes: [
          { kcId: 'kc-1a', name: '识别复合结构', taxonomy: 'conceptual' },
          { kcId: 'kc-1b', name: '验证导数配对', taxonomy: 'procedural' },
        ],
      },
    },
  }),
};

const resolved = { id: null, name: '被积函数中的复合结构', description: null };

describe('buildTaskKnowledgeSeeds（本课知识组件种子）', () => {
  it('从 taskKcLinks 取到 KC 名（不再返回空数组）', () => {
    const seeds = buildTaskKnowledgeSeeds({ task: { title: '圈出内层函数' }, path: pathWithKcs, resolvedConcept: resolved });
    expect(seeds.map((s) => s.name)).toEqual(['识别复合结构', '验证导数配对']);
    expect(seeds.every((s) => s.status === 'pending' && s.progress === 0)).toBe(true);
  });

  it('契约漂移：linkedKCs 缺失时认 kcIds / linkedKcIds / kcs', () => {
    const mk = (key: string) => ({
      aiPromptTemplate: JSON.stringify({
        kcAnnotation: {
          taskKcLinks: [{ taskTitle: 'T', [key]: ['kc-9'] }],
          kcGraph: { nodes: [{ kcId: 'kc-9', name: '漂移字段KC' }] },
        },
      }),
    });
    for (const key of ['kcIds', 'linkedKcIds', 'kcs']) {
      const seeds = buildTaskKnowledgeSeeds({ task: { title: 'T' }, path: mk(key), resolvedConcept: resolved });
      expect(seeds.map((s) => s.name)).toEqual(['漂移字段KC']);
    }
  });

  it('任务标题对不上 / 无 kcAnnotation → 回落任务自身的 canonical 概念', () => {
    const noAnn = { aiPromptTemplate: JSON.stringify({}) };
    expect(buildTaskKnowledgeSeeds({ task: { title: '圈出内层函数' }, path: noAnn, resolvedConcept: resolved }).map((s) => s.name))
      .toEqual(['被积函数中的复合结构']);
    // 标题不匹配
    expect(buildTaskKnowledgeSeeds({ task: { title: '别的任务' }, path: pathWithKcs, resolvedConcept: resolved }).map((s) => s.name))
      .toEqual(['被积函数中的复合结构']);
  });

  it('两处都没有 → 空数组（不编造）', () => {
    const noAnn = { aiPromptTemplate: JSON.stringify({}) };
    expect(buildTaskKnowledgeSeeds({ task: { title: 'T' }, path: noAnn, resolvedConcept: { id: null, name: null, description: null } }))
      .toEqual([]);
  });
});

describe('pickPrerequisiteConcepts（前置概念筛选）', () => {
  it('source=graph 的真上游前置直接采用——即使与本课概念不同名', () => {
    // 这正是修复前被名字子串过滤全滤掉的情形：上游概念按定义就与本课概念不同名
    const picked = pickPrerequisiteConcepts(
      [{ label: '被积结构与微分元的配对关系识别', source: 'graph' }],
      ['在混合积分题上按判断清单选定换元或分部并标记卡点'],
    );
    expect(picked).toEqual(['被积结构与微分元的配对关系识别']);
  });

  it('source=fallback（实为本课自身薄弱概念）不是前置 → 只保留能对上锚点的', () => {
    expect(pickPrerequisiteConcepts(
      [{ label: '某本课概念', source: 'fallback' }, { label: '毫不相干的东西', source: 'fallback' }],
      ['某本课概念'],
    )).toEqual(['某本课概念']);
  });

  it('无 source 的旧数据 → 走旧口径（锚点子串匹配）', () => {
    expect(pickPrerequisiteConcepts([{ label: '多源报表对齐' }], ['多源报表对齐'])).toEqual(['多源报表对齐']);
    expect(pickPrerequisiteConcepts([{ label: '多源报表对齐' }], ['完全不同的锚点'])).toEqual([]);
  });

  it('去重且最多 2 条', () => {
    const picked = pickPrerequisiteConcepts([
      { label: 'A', source: 'graph' }, { label: 'A', source: 'graph' },
      { label: 'B', source: 'graph' }, { label: 'C', source: 'graph' },
    ], []);
    expect(picked).toEqual(['A', 'B']);
  });

  it('label 为空 / gaps 为空 → 空数组', () => {
    expect(pickPrerequisiteConcepts([], ['x'])).toEqual([]);
    expect(pickPrerequisiteConcepts([{ label: '', source: 'graph' }], ['x'])).toEqual([]);
  });
});
