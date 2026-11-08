/**
 * #185 回归：编排声明边必须跟着「调用归属」走。
 *
 * 病灶：executor 把 skill span 的 callerAgent 归到**当前执行所在的 agent 边界**
 * （teaching-agent 作用域内直调 profile 归属的 learning-predictor），
 * 但编排 YAML 从未声明这条调用边 ⇒ audit-handoff-edges 实跑时
 * `teaching-agent -> skill:learning-predictor` 恒判 usedButUndeclared（幽灵边）。
 *
 * 本测试直接读真实编排文件（prompts/orchestration/*.yaml），断言：
 *   ① 声明边集合含 teaching-agent ↔ skill:learning-predictor（且不是归属扁平化的 profile-agent 边）；
 *   ② 用真实日志形状（callerAgent=teaching-agent, agentId=skill:learning-predictor）跑对账，
 *     该边不再出现在 usedButUndeclared —— 有向/无向两种口径都成立。
 */
import { loadOrchestrationFiles } from '../../field-routing/orchestration-file';
import {
  aggregateHandoffEdgeUsage,
  compareDeclaredVsUsed,
  extractDeclaredHandoffEdges,
  handoffPairKey,
} from '../handoff-edge-usage';

const CALLER = 'teaching-agent';
const CALLEE = 'skill:learning-predictor';

const declaredEdges = () => extractDeclaredHandoffEdges(loadOrchestrationFiles());

/** 真实运行日志形状：executor 写入 agent_call_logs 的 (callerAgent, agentId) */
const runtimeEdge = () =>
  aggregateHandoffEdgeUsage([
    { callerAgent: CALLER, agentId: CALLEE, success: true, calledAt: '2026-11-06T00:00:00Z' },
    { callerAgent: CALLER, agentId: CALLEE, success: false, calledAt: '2026-11-06T00:05:00Z' },
  ]).edges;

describe('#185 调用归属与声明边同步', () => {
  it('声明边含教学链直调预测器这条边（caller = 执行边界 teaching-agent）', () => {
    const edges = declaredEdges();
    expect(edges.length).toBeGreaterThan(0);

    const edge = edges.find(
      (candidate) => handoffPairKey(candidate.caller, candidate.callee) === handoffPairKey(CALLER, CALLEE),
    );
    expect(edge).toBeDefined();
    // 有向声明必须正好是 teaching-agent → skill:learning-predictor（--directed 口径也匹配）
    expect(edge).toMatchObject({ caller: CALLER, callee: CALLEE });

    // 静态归属是 profile-agent；若声明成 profile-agent → skill:learning-predictor，
    // 就又退回「归属扁平化」的假边（#185 已修复的病灶）。
    expect(edges.some((candidate) => candidate.caller === 'profile-agent' && candidate.callee === CALLEE)).toBe(false);
  });

  it.each([
    ['无向配对（默认）', {}],
    ['有向边（--directed）', { undirected: false }],
  ] as const)('%s口径下该运行边不再判 usedButUndeclared', (_label, options) => {
    const comparison = compareDeclaredVsUsed(declaredEdges(), runtimeEdge(), options as any);

    expect(comparison.usedButUndeclared.map((edge) => edge.key)).toEqual([]);
    expect(comparison.matchedEdgeCount).toBe(1);
    // 该声明边确实被运行数据命中，不是「声明了没人用」的死边
    expect(
      comparison.declaredButNeverUsed.some(
        (edge) => handoffPairKey(edge.caller, edge.callee) === handoffPairKey(CALLER, CALLEE),
      ),
    ).toBe(false);
  });
});
