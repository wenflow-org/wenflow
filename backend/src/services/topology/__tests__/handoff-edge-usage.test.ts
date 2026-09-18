/**
 * 交接边用量聚合纯函数单测（Q9）
 * 覆盖：边键、排序、失败计数、窗口过滤、缺失口径、声明边提取（阶段别名/字段合并）、声明 vs 运行对比。
 */
import {
  aggregateHandoffEdgeUsage,
  compareDeclaredVsUsed,
  extractDeclaredHandoffEdges,
  handoffEdgeKey,
  handoffPairKey,
  type HandoffDeclaredStage,
  type HandoffLogRow,
} from '../handoff-edge-usage';

const at = (iso: string, success = true, caller: string | null = 'A', callee = 'B'): HandoffLogRow => ({
  callerAgent: caller,
  agentId: callee,
  success,
  calledAt: iso,
});

describe('handoffEdgeKey', () => {
  it('用 ` -> ` 连接 caller/callee，保持可读且无歧义', () => {
    expect(handoffEdgeKey('teaching-agent', 'skill:teaching-turn')).toBe('teaching-agent -> skill:teaching-turn');
  });

  it('无向配对键对两端排序，方向无关', () => {
    expect(handoffPairKey('goal-agent', 'skill:goal-conversation')).toBe('goal-agent <-> skill:goal-conversation');
    expect(handoffPairKey('skill:goal-conversation', 'goal-agent')).toBe('goal-agent <-> skill:goal-conversation');
  });
});

describe('aggregateHandoffEdgeUsage', () => {
  it('排序：calls 降序 → failures 降序 → key 升序', () => {
    const rows: HandoffLogRow[] = [
      at('2026-09-01T00:00:00Z', true, 'A', 'B'),
      at('2026-09-01T00:00:01Z', false, 'A', 'B'),
      at('2026-09-01T00:00:02Z', true, 'A', 'B'),
      at('2026-09-02T00:00:00Z', false, 'A', 'C'),
      at('2026-09-02T00:00:01Z', false, 'A', 'C'),
      at('2026-09-02T00:00:02Z', true, 'A', 'C'),
      at('2026-09-03T00:00:00Z', false, 'B', 'A'),
      at('2026-09-03T00:00:01Z', true, 'B', 'A'),
      at('2026-09-03T00:00:02Z', true, 'B', 'A'),
      at('2026-09-04T00:00:00Z', true, 'A', 'D'),
      at('2026-09-04T00:00:01Z', true, 'A', 'D'),
    ];
    const result = aggregateHandoffEdgeUsage(rows);

    expect(result.edges.map((e) => e.key)).toEqual(['A -> C', 'A -> B', 'B -> A', 'A -> D']);
    expect(result.edges[0].calls).toBe(3);
    expect(result.edges[0].failures).toBe(2);
  });

  it('失败计数 / 成功率 / 首末次出现时间', () => {
    const rows: HandoffLogRow[] = [
      at('2026-09-01T10:00:00Z', false, 'A', 'B'),
      at('2026-09-01T12:00:00Z', true, 'A', 'B'),
      at('2026-09-02T08:00:00Z', true, 'A', 'B'),
      { callerAgent: 'A', agentId: 'B', success: null, calledAt: '2026-09-03T00:00:00Z' },
    ];
    const [edge] = aggregateHandoffEdgeUsage(rows).edges;

    expect(edge.calls).toBe(4);
    expect(edge.failures).toBe(1);
    expect(edge.successRate).toBe(75);
    expect(edge.firstSeenAt?.toISOString()).toBe('2026-09-01T10:00:00.000Z');
    expect(edge.lastSeenAt?.toISOString()).toBe('2026-09-03T00:00:00.000Z');
  });

  it('窗口过滤为闭区间：恰好落在 since/until 计入，窗口外与非法时间剔除', () => {
    const since = new Date('2026-09-10T00:00:00Z');
    const until = new Date('2026-09-10T00:00:10Z');
    const rows: HandoffLogRow[] = [
      at('2026-09-09T23:59:59.999Z'),
      at('2026-09-10T00:00:00Z'),
      at('2026-09-10T00:00:10Z'),
      at('2026-09-10T00:00:10.001Z'),
      { callerAgent: 'A', agentId: 'B', success: true, calledAt: 'not-a-date' },
    ];
    const result = aggregateHandoffEdgeUsage(rows, { since, until });

    expect(result.consideredRows).toBe(2);
    expect(result.edges[0].calls).toBe(2);
    expect(result.skippedOutOfWindow).toBe(2);
    expect(result.skippedInvalidTime).toBe(1);
  });

  it('缺 caller/callee 分别计数且不成边；空输入返回空边集', () => {
    const rows: HandoffLogRow[] = [
      at('2026-09-01T00:00:00Z', true, null, 'B'),
      at('2026-09-01T00:00:00Z', true, '   ', 'B'),
      at('2026-09-01T00:00:00Z', true, 'A', null),
      at('2026-09-01T00:00:00Z', true, 'A', ''),
    ];
    const result = aggregateHandoffEdgeUsage(rows);

    expect(result.skippedMissingCaller).toBe(2);
    expect(result.skippedMissingCallee).toBe(2);
    expect(result.edges).toHaveLength(0);
    expect(result.totalRows).toBe(4);
  });
});

describe('extractDeclaredHandoffEdges', () => {
  const stages: HandoffDeclaredStage[] = [
    {
      stage: 'teaching',
      contracts: [{ agentId: 'teaching-agent' }, { agentId: 'skill:teaching-turn' }],
      routings: [
        { agentId: 'teaching-agent', fieldId: 'f1', handoff: ['skill:teaching-turn'] },
        { agentId: 'teaching-agent', fieldId: 'f2', handoff: ['skill:teaching-turn', 'profile'] },
      ],
    },
    {
      stage: 'profile',
      contracts: [{ agentId: 'profile-agent' }],
      routings: [{ agentId: 'profile-agent', fieldId: 'p1', handoff: [] }],
    },
  ];

  it('阶段别名归一化 + 同边多字段合并 + 稳定排序', () => {
    const edges = extractDeclaredHandoffEdges(stages);

    expect(edges).toHaveLength(2);
    // 排序：caller 相同按 callee 升序 → profile-agent 在 skill:teaching-turn 前
    expect(edges[0]).toMatchObject({
      caller: 'teaching-agent',
      callee: 'profile-agent',
      calleeRaw: 'profile',
      stage: 'teaching',
      fields: ['f2'],
    });
    expect(edges[1]).toMatchObject({
      caller: 'teaching-agent',
      callee: 'skill:teaching-turn',
      calleeRaw: 'skill:teaching-turn',
      fields: ['f1', 'f2'],
    });
  });

  it('空 handoff 不产边', () => {
    const edges = extractDeclaredHandoffEdges([{ stage: 'goal', contracts: [{ agentId: 'goal-agent' }], routings: [{ agentId: 'goal-agent', fieldId: 'x', handoff: [] }] }]);
    expect(edges).toHaveLength(0);
  });
});

describe('compareDeclaredVsUsed', () => {
  it('区分命中 / 声明未用 / 运行未声明', () => {
    const declared = extractDeclaredHandoffEdges([
      {
        stage: 'teaching',
        contracts: [{ agentId: 'teaching-agent' }],
        routings: [
          { agentId: 'teaching-agent', fieldId: 'f1', handoff: ['skill:teaching-turn'] },
          { agentId: 'teaching-agent', fieldId: 'f2', handoff: ['profile-agent'] },
        ],
      },
    ]);
    const used = aggregateHandoffEdgeUsage([
      at('2026-09-01T00:00:00Z', true, 'teaching-agent', 'skill:teaching-turn'),
      at('2026-09-01T00:00:01Z', true, 'ghost-agent', 'skill:ghost'),
    ]).edges;

    const comparison = compareDeclaredVsUsed(declared, used);

    expect(comparison.matchedEdgeCount).toBe(1);
    expect(comparison.declaredButNeverUsed.map((e) => handoffEdgeKey(e.caller, e.callee))).toEqual(['teaching-agent -> profile-agent']);
    expect(comparison.usedButUndeclared.map((e) => e.key)).toEqual(['ghost-agent -> skill:ghost']);
  });

  it('默认无向配对：声明方向与运行方向相反也算命中', () => {
    const declared = extractDeclaredHandoffEdges([
      {
        stage: 'goal',
        contracts: [{ agentId: 'goal-agent' }],
        routings: [{ agentId: 'skill:goal-conversation', fieldId: 'userVisible', handoff: ['goal-agent'] }],
      },
    ]);
    const used = aggregateHandoffEdgeUsage([
      at('2026-09-01T00:00:00Z', true, 'goal-agent', 'skill:goal-conversation'),
    ]).edges;

    const comparison = compareDeclaredVsUsed(declared, used);

    expect(comparison.matchedEdgeCount).toBe(1);
    expect(comparison.declaredButNeverUsed).toHaveLength(0);
    expect(comparison.usedButUndeclared).toHaveLength(0);
  });

  it('--directed 口径：方向相反则计为声明未用 + 运行未声明', () => {
    const declared = extractDeclaredHandoffEdges([
      {
        stage: 'goal',
        contracts: [{ agentId: 'goal-agent' }],
        routings: [{ agentId: 'skill:goal-conversation', fieldId: 'userVisible', handoff: ['goal-agent'] }],
      },
    ]);
    const used = aggregateHandoffEdgeUsage([
      at('2026-09-01T00:00:00Z', true, 'goal-agent', 'skill:goal-conversation'),
    ]).edges;

    const comparison = compareDeclaredVsUsed(declared, used, { undirected: false });

    expect(comparison.matchedEdgeCount).toBe(0);
    expect(comparison.declaredButNeverUsed).toHaveLength(1);
    expect(comparison.usedButUndeclared).toHaveLength(1);
  });
});
