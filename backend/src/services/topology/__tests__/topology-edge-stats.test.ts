/**
 * 拓扑隶属边用量 join 纯函数单测（Q9 后续）
 * 覆盖：精确 caller→callee 配对、保留原始字段、未使用边零值/死边、成功率与 lastSeenAt 透传、
 * 相邻边不误配、输入顺序确定性。
 */
import {
  aggregateHandoffEdgeUsage,
  type HandoffLogRow,
} from '../handoff-edge-usage';
import { attachEdgeStats, type MembershipEdgeLike } from '../topology-edge-stats';

const at = (iso: string, success: boolean, caller: string, callee: string): HandoffLogRow => ({
  callerAgent: caller,
  agentId: callee,
  success,
  calledAt: iso,
});

describe('attachEdgeStats', () => {
  const edges: MembershipEdgeLike[] = [
    { id: 'path-agent__skill:path-planning', source: 'path-agent', target: 'skill:path-planning' },
    { id: 'path-agent__skill:stage-designer', source: 'path-agent', target: 'skill:stage-designer' },
    { id: 'teaching-agent__skill:teaching-turn', source: 'teaching-agent', target: 'skill:teaching-turn' },
  ];

  const usage = aggregateHandoffEdgeUsage([
    at('2026-09-01T10:00:00Z', false, 'path-agent', 'skill:path-planning'),
    at('2026-09-01T12:00:00Z', true, 'path-agent', 'skill:path-planning'),
    at('2026-09-02T08:00:00Z', true, 'path-agent', 'skill:path-planning'),
    at('2026-09-02T09:00:00Z', true, 'teaching-agent', 'skill:teaching-turn'),
    // 相邻边：同 callee 不同 caller，不应误配到 path-agent 的边
    at('2026-09-03T00:00:00Z', true, 'goal-agent', 'skill:path-planning'),
  ]).edges;

  it('按 (source, target) 精确配对并透传调用/失败/成功率/末次时间', () => {
    const result = attachEdgeStats(edges, usage, '7d');
    const pp = result[0];
    const tt = result[2];

    expect(pp.stats).toEqual({
      totalCalls: 3,
      failed: 1,
      successRate: 66.7,
      lastSeenAt: new Date('2026-09-02T08:00:00.000Z'),
      dead: false,
      source: 'agent_call_logs',
      range: '7d',
    });
    expect(tt.stats.totalCalls).toBe(1);
    expect(tt.stats.failed).toBe(0);
    expect(tt.stats.successRate).toBe(100);
  });

  it('未使用边默认零值 / null / dead，且不误配来自其它 caller 的相邻边', () => {
    const result = attachEdgeStats(edges, usage, 'all');
    const sd = result[1];

    // goal-agent → skill:path-planning 有流量，但不是 path-agent__stage-designer 这条边
    expect(sd.stats).toEqual({
      totalCalls: 0,
      failed: 0,
      successRate: null,
      lastSeenAt: null,
      dead: true,
      source: 'agent_call_logs',
      range: 'all',
    });
    expect(sd.stats.lastSeenAt).toBeNull();
  });

  it('保留入参边的全部原始字段（如 type），仅新增 stats', () => {
    const withType = [{ id: 'a', source: 'A', target: 'B', type: 'membership' as const }];
    const [edge] = attachEdgeStats(withType, [], '30d');

    expect(edge).toMatchObject({ id: 'a', source: 'A', target: 'B', type: 'membership' });
    expect(edge.stats.dead).toBe(true);
  });

  it('输出顺序与入参一致（确定性），空 usage 全部为死边', () => {
    const result = attachEdgeStats(edges, [], '24h');

    expect(result.map((e) => e.id)).toEqual(edges.map((e) => e.id));
    expect(result.every((e) => e.stats.dead && e.stats.totalCalls === 0)).toBe(true);
  });

  it('端点空白容错：trim 后仍能配对', () => {
    const [edge] = attachEdgeStats(
      [{ id: 'x', source: ' path-agent ', target: ' skill:path-planning ' }],
      usage,
      'all',
    );
    expect(edge.stats.totalCalls).toBe(3);
  });
});
