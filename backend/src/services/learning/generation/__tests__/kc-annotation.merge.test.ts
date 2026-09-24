/**
 * 渐进式 stage 设计单测（活的 path 批次 D）：
 * mergeKcStageAnnotation（v1→v2 升级 / 追加幂等 / 不丢他阶段 / 读侧并集兼容）。
 */
import { mergeKcStageAnnotation, type KcAnnotation } from '../kc-annotation';

const stage1Output: KcAnnotation = {
  conceptKcs: [{ conceptId: 'c-1', name: '领域框架' }],
  taskKcLinks: [{ taskTitle: '从目录重建骨架', linkedKCs: ['kc-1a'] }],
  kcGraph: {
    nodes: [{ kcId: 'kc-1a', name: '五领域边界', taxonomy: 'concept' }],
    edges: [{ from: 'kc-1a', to: 'kc-1b', type: 'prerequisite' }],
  },
  gapCoverage: { covered: ['领域边界'], missing: [] },
};

const stage2Output: KcAnnotation = {
  conceptKcs: [{ conceptId: 'c-2', name: '可观察表现' }],
  taskKcLinks: [{ taskTitle: '把目标读成行为', linkedKCs: ['kc-2a'] }],
  kcGraph: {
    nodes: [{ kcId: 'kc-2a', name: '行为转写', taxonomy: 'procedure' }],
    edges: [{ from: 'kc-1a', to: 'kc-2a', type: 'prerequisite' }],
  },
  gapCoverage: { covered: ['行为转写'], missing: [] },
};

describe('mergeKcStageAnnotation 增量合并契约（批次 D3）', () => {
  const nodesOf = (annotation: KcAnnotation) =>
    (((annotation.kcGraph as Record<string, unknown>)?.nodes) as unknown[] | undefined) ?? [];
  const edgesOf = (annotation: KcAnnotation) =>
    (((annotation.kcGraph as Record<string, unknown>)?.edges) as unknown[] | undefined) ?? [];

  it('首合并：v2 结构 + byStage 快照', () => {
    const merged = mergeKcStageAnnotation(null, 1, stage1Output);
    expect(merged.version).toBe(2);
    expect(merged.byStage?.['1']).toEqual(stage1Output);
    expect(merged.conceptKcs).toHaveLength(1);
    expect(merged.taskKcLinks).toHaveLength(1);
  });

  it('追加 stage 2：不丢 stage 1 条目，并集含两段', () => {
    const stage1 = mergeKcStageAnnotation(null, 1, stage1Output);
    const merged = mergeKcStageAnnotation(stage1, 2, stage2Output);
    expect(Object.keys(merged.byStage || {}).sort()).toEqual(['1', '2']);
    expect(merged.conceptKcs).toHaveLength(2);
    expect(merged.taskKcLinks).toHaveLength(2);
    expect(nodesOf(merged)).toHaveLength(2);
    expect(edgesOf(merged)).toHaveLength(2);
  });

  it('幂等：同阶段同输出重复合并，结果不变', () => {
    const once = mergeKcStageAnnotation(null, 1, stage1Output);
    const twice = mergeKcStageAnnotation(once, 1, stage1Output);
    expect(twice.conceptKcs).toHaveLength(1);
    expect(twice.taskKcLinks).toHaveLength(1);
    expect(nodesOf(twice)).toHaveLength(1);
    expect(edgesOf(twice)).toHaveLength(1);
  });

  it('v1 旧标注升级：旧条目进并集 + 整包快照为 legacy（读侧不丢）', () => {
    const legacy: KcAnnotation = {
      conceptKcs: [{ conceptId: 'c-old', name: '旧概念' }],
      taskKcLinks: [{ taskTitle: '旧任务', linkedKCs: ['kc-old'] }],
      kcGraph: { nodes: [{ kcId: 'kc-old', name: '旧KC', taxonomy: 'fact' }], edges: [] },
    };
    const merged = mergeKcStageAnnotation(legacy, 1, stage1Output);
    expect(merged.version).toBe(2);
    expect((merged.byStage as Record<string, unknown>)?.legacy).toEqual(legacy);
    // 读侧（并集匹配 taskTitle）仍能读到旧任务与旧 KC
    const titles = (merged.taskKcLinks || []).map((link) => link.taskTitle);
    expect(titles).toContain('旧任务');
    const nodeIds = nodesOf(merged).map((node) => String((node as Record<string, unknown>).kcId ?? ''));
    expect(nodeIds).toContain('kc-old');
  });

  it('taskKcLinks 同名任务不同 KC：两条都保留（跨阶段同名任务的既有语义）', () => {
    const a = mergeKcStageAnnotation(null, 1, {
      taskKcLinks: [{ taskTitle: '复述清单', linkedKCs: ['kc-a'] }],
    });
    const b = mergeKcStageAnnotation(a, 2, {
      taskKcLinks: [{ taskTitle: '复述清单', linkedKCs: ['kc-b'] }],
    });
    expect(b.taskKcLinks).toHaveLength(2);
  });
});
