/**
 * 前置探测题作答结果接线（审计 P0 §1.1）：
 *   collectedData.understanding.prerequisiteCheckResults → GoalPathRequest.prerequisiteCheckResults
 *
 * 该字段由 goal skill 产出、path-planning 的规则与代码都消费（防自评虚高），
 * 但 `buildGoalPathRequest` 此前从未把它放进请求 ⇒ 主流程拿不到，只有旁路路由生效。
 * 本文件锁定承载读取这一纯函数 seam；消费端（normalizedInputV1）由
 * `coordinators/__tests__/path.coordinator.handoff.test.ts` 覆盖。
 */
import { resolvePrerequisiteCheckResultsFromUnderstanding } from '../learner-load-profile';

describe('resolvePrerequisiteCheckResultsFromUnderstanding', () => {
  it('缺失 / 非对象 / 非数组 / 空数组 → null（下游按「无探测」处理）', () => {
    expect(resolvePrerequisiteCheckResultsFromUnderstanding(undefined)).toBeNull();
    expect(resolvePrerequisiteCheckResultsFromUnderstanding(null)).toBeNull();
    expect(resolvePrerequisiteCheckResultsFromUnderstanding('probe-1')).toBeNull();
    expect(resolvePrerequisiteCheckResultsFromUnderstanding({})).toBeNull();
    expect(resolvePrerequisiteCheckResultsFromUnderstanding({ prerequisiteCheckResults: null })).toBeNull();
    expect(resolvePrerequisiteCheckResultsFromUnderstanding({ prerequisiteCheckResults: {} })).toBeNull();
    expect(resolvePrerequisiteCheckResultsFromUnderstanding({ prerequisiteCheckResults: [] })).toBeNull();
  });

  it('有效数组原样返回（含 probeId/targetConcept/userAnswer/isCorrect）', () => {
    const probes = [
      { probeId: 'probe-1', targetConcept: '变量作用域', userAnswer: 'B', isCorrect: false },
      { probeId: 'probe-2', targetConcept: '闭包', userAnswer: 'A', isCorrect: true },
    ];
    expect(resolvePrerequisiteCheckResultsFromUnderstanding({ prerequisiteCheckResults: probes }))
      .toEqual(probes);
  });

  it('与 understanding 的其他键并存时互不影响（不改动入参）', () => {
    const understanding = {
      realProblem: '报告逻辑乱',
      primary_block_type: 'emotional',
      prerequisiteCheckResults: [{ probeId: 'p1', userAnswer: 'C', isCorrect: false }],
    };
    const snapshot = JSON.parse(JSON.stringify(understanding));
    const resolved = resolvePrerequisiteCheckResultsFromUnderstanding(understanding);
    expect(resolved).toHaveLength(1);
    expect(understanding).toEqual(snapshot);
  });
});
