/**
 * 逻辑图字段命中率 join 纯函数单测（Q9 后半程）
 * 覆盖：fieldRoot 口径、字段节点状态推导（produced/dead/drift）、totalCalls 透传、
 * 死边判定（声明零命中 / 根未观测 / 豁免根）、死边清单排序、per-skill 摘要、确定性。
 */
import {
  aggregateFieldHitRates,
  type FieldHitLogRow,
} from '../field-hit-rates';
import {
  attachFieldStats,
  collectDeadRoutingEdges,
  fieldRoot,
  markRoutingEdges,
  toSkillSummaries,
  type FieldNodeLike,
  type RoutingEdgeLike,
} from '../topology-field-stats';

const row = (agentId: string, extractedJson: string | null): FieldHitLogRow => ({ agentId, extractedJson });

/** x：a 命中 2/2，b 声明零命中，c 未声明但观测到 → 漂移 */
function ratesOf() {
  return aggregateFieldHitRates(
    [
      row('skill:x', '{"a":1,"c":1}'),
      row('skill:x', '{"a":2,"c":2}'),
      row('skill:y', '{"only":1}'),
    ],
    { declaredFieldsBySkill: { x: ['a', 'b'], y: ['only'] } },
  );
}

describe('fieldRoot', () => {
  it('取首段；去数组后缀 []；无点号整体', () => {
    expect(fieldRoot('cognitiveCore.cognitiveDomain')).toBe('cognitiveCore');
    expect(fieldRoot('milestones[].estimatedHours')).toBe('milestones');
    expect(fieldRoot('personaSeed')).toBe('personaSeed');
  });

  it('空值 / 空白 → 空串', () => {
    expect(fieldRoot('')).toBe('');
    expect(fieldRoot('   ')).toBe('');
    expect(fieldRoot(undefined as unknown as string)).toBe('');
  });
});

describe('attachFieldStats', () => {
  const nodes: FieldNodeLike[] = [
    { agentId: 'skill:x', fieldId: 'a.sub' },
    { agentId: 'skill:x', fieldId: 'b' },
    { agentId: 'skill:x', fieldId: 'c' },
    { agentId: 'skill:x', fieldId: 'ghostRoot' },
    { agentId: 'skill:unknown', fieldId: 'a' },
    { agentId: 'path-agent', fieldId: 'a' },
  ];

  it('按 producer skill + fieldId 首段配对，推导 status 并透传命中率 / totalCalls', () => {
    const joined = attachFieldStats(nodes, ratesOf());

    expect(joined[0].fieldStats).toEqual({
      skillId: 'x', root: 'a', declared: true, hits: 2, hitRate: 1, totalCalls: 2, status: 'produced',
    });
    expect(joined[1].fieldStats.status).toBe('dead');
    expect(joined[1].fieldStats.declared).toBe(true);
    expect(joined[1].fieldStats.hits).toBe(0);
    expect(joined[2].fieldStats).toEqual({
      skillId: 'x', root: 'c', declared: false, hits: 2, hitRate: 1, totalCalls: 2, status: 'drift',
    });
  });

  it('routing 根未声明且未观测 → dead；非 skill 产出方 / 未声明 skill → dead 且 skillId 正确', () => {
    const joined = attachFieldStats(nodes, ratesOf());

    expect(joined[3].fieldStats).toMatchObject({ root: 'ghostRoot', declared: false, hits: 0, status: 'dead' });
    expect(joined[4].fieldStats).toMatchObject({ skillId: 'unknown', hits: 0, totalCalls: 0, status: 'dead' });
    expect(joined[5].fieldStats).toMatchObject({ skillId: null, root: 'a', hits: 0, status: 'dead' });
  });

  it('保留入参原始字段，输出顺序与入参一致，且缺省 rates 不抛错', () => {
    const joined = attachFieldStats(nodes, ratesOf());
    expect(joined.map((n) => n.fieldId)).toEqual(nodes.map((n) => n.fieldId));
    expect(joined[0]).toMatchObject({ agentId: 'skill:x', fieldId: 'a.sub' });
    expect(joinCount(attachFieldStats(nodes, null))).toBe(nodes.length);
    expect(attachFieldStats(nodes, null)[0].fieldStats.status).toBe('dead');
  });

  it('确定性：同一输入重复调用深相等', () => {
    expect(attachFieldStats(nodes, ratesOf())).toEqual(attachFieldStats(nodes, ratesOf()));
  });
});

function joinCount(list: Array<{ fieldStats: unknown }>): number {
  return list.filter((item) => item.fieldStats != null).length;
}

describe('markRoutingEdges / collectDeadRoutingEdges', () => {
  const edges: RoutingEdgeLike[] = [
    { id: 'x-a', agentId: 'skill:x', fieldId: 'a', handoff: ['skill:z'], stage: 'path' },
    { id: 'x-b', agentId: 'skill:x', fieldId: 'b', handoff: ['teaching'], stage: 'path' },
    { id: 'x-c', agentId: 'skill:x', fieldId: 'c', handoff: [], stage: 'path' },
    { id: 'x-ghost', agentId: 'skill:x', fieldId: 'ghostRoot', handoff: ['profile'], stage: 'path' },
    { id: 'x-path', agentId: 'skill:x', fieldId: 'path.name', handoff: ['teaching'], stage: 'path' },
  ];
  const exempt = new Set(['path']);

  it('produced / drift 存活；声明零命中 → declared-field-zero-hits', () => {
    const marked = markRoutingEdges(edges, ratesOf(), exempt);
    expect(marked[0].routingStats).toEqual({ dead: false, status: 'produced', reason: null });
    expect(marked[2].routingStats).toEqual({ dead: false, status: 'drift', reason: null });
    expect(marked[1].routingStats).toEqual({ dead: true, status: 'dead', reason: 'declared-field-zero-hits' });
  });

  it('未观测且非豁免根 → routing-root-not-observed；豁免根存活', () => {
    const marked = markRoutingEdges(edges, ratesOf(), exempt);
    expect(marked[3].routingStats).toEqual({ dead: true, status: 'dead', reason: 'routing-root-not-observed' });
    expect(marked[4].routingStats).toEqual({ dead: false, status: 'dead', reason: null });
  });

  it('collectDeadRoutingEdges 仅返回死边，handoff 归一化，按 skillId/fieldId 排序', () => {
    const dead = collectDeadRoutingEdges(
      [
        ...edges,
        { id: 'z-a', agentId: 'skill:z', fieldId: 'a', handoff: [' path ', ''], stage: 'goal' },
      ],
      ratesOf(),
      exempt,
    );
    expect(dead.map((edge) => edge.id)).toEqual(['x-b', 'x-ghost', 'z-a']);
    expect(dead[0]).toMatchObject({
      skillId: 'x', agentId: 'skill:x', fieldId: 'b', root: 'b', stage: 'path',
      reason: 'declared-field-zero-hits',
    });
    expect(dead[2].handoff).toEqual(['path']);
  });

  it('空 rates：所有非豁免根均为死边；空输入返回空', () => {
    expect(markRoutingEdges(edges, null).filter((e) => e.routingStats.dead)).toHaveLength(5);
    expect(collectDeadRoutingEdges([], ratesOf(), exempt)).toEqual([]);
  });
});

describe('toSkillSummaries', () => {
  it('汇总声明 / 产出 / 死字段 / 漂移字段计数', () => {
    const summaries = toSkillSummaries(ratesOf());
    expect(summaries.map((s) => s.skillId)).toEqual(['x', 'y']);
    expect(summaries[0]).toEqual({
      skillId: 'x', agentId: 'skill:x', totalCalls: 2, parsedCalls: 2, unparsedCalls: 0,
      declaredFieldCount: 2, producedFieldCount: 2, deadFields: ['b'], driftFields: ['c'],
    });
    expect(summaries[1].driftFields).toEqual([]);
    expect(toSkillSummaries(null)).toEqual([]);
  });
});
