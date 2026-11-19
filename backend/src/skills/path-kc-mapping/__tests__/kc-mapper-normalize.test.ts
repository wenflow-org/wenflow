/**
 * path-kc-mapping 契约归一回归（2026-11-18 外评）：
 * 1) rules 曾写 linkedKC（单数），归一化只认 linkedKCs → 链接会被静默丢掉（实测 196 条路径 0 例，属潜在契约坑）；
 * 2) kcGraph 与 prerequisiteKCs 重复表达同一组前置边 → 改为后端派生，模型不再手抄；
 * 3) 悬空前置（只被引用、没有完整 KC 定义）过去在物化时静默 skip，现在显式告警。
 */
import { coerceKcMapperParsed, deriveKcGraph, auditKcGranularity } from '../index';

const conceptKcs = [
  {
    conceptId: 'concept-1',
    kcs: [
      { kcId: 'kc-1a-prereq', name: '分辨会话上下文与长期记忆', taxonomy: 'conceptual' },
      { kcId: 'kc-1a', name: '识别ReAct推理步', taxonomy: 'conceptual', prerequisiteKCs: ['kc-1a-prereq'] },
      { kcId: 'kc-1b', name: '区分短期与长期记忆', taxonomy: 'conceptual', prerequisiteKCs: ['kc-1a'] },
    ],
  },
];

describe('coerceKcMapperParsed', () => {
  it('linkedKC（单数）归一为 linkedKCs', () => {
    const out = coerceKcMapperParsed({
      conceptKcs,
      taskKcLinks: [{ taskKey: 'task-1-0', taskTitle: 't', linkedKC: ['kc-1a'] }],
    });
    expect(out.taskKcLinks[0].linkedKCs).toEqual(['kc-1a']);
  });

  it('模型不输出 kcGraph 时，从 prerequisiteKCs 派生节点与边', () => {
    const out = coerceKcMapperParsed({ conceptKcs, taskKcLinks: [] });
    expect(out.kcGraph.nodes).toHaveLength(3);
    expect(out.kcGraph.edges).toEqual([
      { from: 'kc-1a-prereq', to: 'kc-1a', relation: 'prerequisite' },
      { from: 'kc-1a', to: 'kc-1b', relation: 'prerequisite' },
    ]);
  });

  it('派生图方向固定为 from=前置、to=后继（与 prerequisiteKCs 的子→父相反）', () => {
    const { edges } = deriveKcGraph(conceptKcs);
    expect(edges).toContainEqual({ from: 'kc-1a', to: 'kc-1b', relation: 'prerequisite' });
    expect(edges).not.toContainEqual({ from: 'kc-1b', to: 'kc-1a', relation: 'prerequisite' });
  });

  it('旧载荷 kcGraph 的节点会并入，已有派生边不重复', () => {
    const out = coerceKcMapperParsed({
      conceptKcs,
      kcGraph: {
        nodes: [{ kcId: 'kc-legacy', name: '旧节点', taxonomy: 'factual' }],
        edges: [{ from: 'kc-1a', to: 'kc-1b', relation: 'prerequisite' }],
      },
    });
    expect(out.kcGraph.nodes.some((n: any) => n.kcId === 'kc-legacy')).toBe(true);
    expect(out.kcGraph.edges).toHaveLength(2);
  });
});

describe('悬空前置', () => {
  const dangling = [
    {
      conceptId: 'concept-1',
      kcs: [{ kcId: 'kc-1a', name: '识别ReAct推理步', taxonomy: 'conceptual', prerequisiteKCs: ['kc-missing'] }],
    },
  ];

  it('派生图丢掉悬空边，并给出 danglingKcIds', () => {
    const { edges, danglingKcIds } = deriveKcGraph(dangling);
    expect(edges).toEqual([]);
    expect(danglingKcIds).toEqual(['kc-missing']);
  });

  it('粒度审计显式报 KC_DANGLING_PREREQ', () => {
    const warnings = auditKcGranularity({ conceptKcs: dangling, taskKcLinks: [] }, { subtasks: [] });
    expect(warnings.some((w) => w.startsWith('KC_DANGLING_PREREQ'))).toBe(true);
  });

  it('关联审计按 taskKey 对齐：同名任务不会互相顶替', () => {
    const warnings = auditKcGranularity(
      {
        conceptKcs,
        taskKcLinks: [{ taskKey: 't1', taskTitle: '同名任务', linkedKCs: ['kc-a'] }],
      },
      {
        subtasks: [
          { taskKey: 't1', title: '同名任务' },
          { taskKey: 't2', title: '同名任务' },
        ],
      },
    );
    const unlinked = warnings.filter((w) => w.startsWith('KC_TASK_UNLINKED'));
    expect(unlinked).toHaveLength(1);
    expect(unlinked[0]).toContain('taskKey=t2');
  });

  it('无 taskKey 的旧输出回退按标题对齐（兼容）', () => {
    const warnings = auditKcGranularity(
      {
        conceptKcs,
        taskKcLinks: [{ taskTitle: '旧任务', linkedKCs: ['kc-a'] }],
      },
      { subtasks: [{ title: '旧任务' }] },
    );
    expect(warnings.some((w) => w.startsWith('KC_TASK_UNLINKED'))).toBe(false);
  });
});
