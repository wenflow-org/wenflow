/**
 * Phase 2（2026-11-20）：path-planning 输出的 rationale 必须穿过
 * analyzePathWithAgent → suggestedMilestones 的白名单边界，落进 aiPromptTemplate。
 *
 * 不钉这条：`MilestoneRationale` 审计读 aiPromptTemplate.suggestedMilestones，
 * rationale 在边界被丢 ⇒ 审计恒报「缺少 rationale」，门禁变成噪音。
 */
import {
  assertClarificationRationalesReadyForPersistence,
  buildSuggestedMilestoneSnapshot,
  normalizeMilestonesWithConcepts,
} from '../path-generation.core';

describe('path-generation · MilestoneRationale 透传', () => {
  const rationale = { serves: 'stopping', evidence: '能解释两者关系并把新案例放进框架' };

  it('白名单快照保留 rationale', () => {
    const snapshot = buildSuggestedMilestoneSnapshot({
      stageNumber: 2,
      title: '争论复盘',
      description: 'd',
      goal: 'g',
      estimatedHours: 3,
      rationale,
      materialRefs: [{ title: 'Sweller 2006' }],
    }, 1);

    expect(snapshot).toMatchObject({
      stage: 2,
      name: '争论复盘',
      rationale,
    });
    expect(snapshot.materialRefs).toEqual([{ title: 'Sweller 2006' }]);
  });

  it('没有 rationale 时不注入空壳键（旧模型输出行为不变）', () => {
    const snapshot = buildSuggestedMilestoneSnapshot({
      stageNumber: 1,
      title: '起点',
      description: 'd',
      goal: 'g',
      estimatedHours: 1,
    }, 0);
    expect('rationale' in snapshot).toBe(false);
  });

  it('normalizeMilestonesWithConcepts 不丢 rationale', () => {
    const [normalized] = normalizeMilestonesWithConcepts([
      {
        stage: 1,
        name: '样例效应',
        description: 'd',
        goal: 'g',
        estimatedHours: 2,
        rationale,
        tasks: [],
      },
    ], { coreConcepts: [] } as never);
    expect(normalized.rationale).toEqual(rationale);
  });

  // Phase 3：重试后仍缺 rationale → 落库前直接阻断，不再是「落库后附回执」。
  const clarification = {
    core: { question: '学习科学与 CLT 的关系', evidence: ['和 clt 之间关系'] },
    baseline: { known: [], unknown: [], misconceptions: [], evidence: ['用户说出 CLT'] },
    stopping: { kind: 'explain', scope: 'class', evidence: 'platform', statement: '能解释两者关系' },
    assumptions: [],
    blockingNeed: 'none',
    unknowns: [],
  };

  it('缺 rationale → 落库前抛 CLARIFICATION_REQUIRED', () => {
    expect(() => assertClarificationRationalesReadyForPersistence([
      { name: '起点', description: 'd', goal: 'g', estimatedHours: 1 },
    ], clarification)).toThrow(/CLARIFICATION_REQUIRED/);
  });

  it('终点没服务 stopping → 同样阻断', () => {
    expect(() => assertClarificationRationalesReadyForPersistence([
      { name: '起点', rationale: { serves: 'core', evidence: '核心问题' } },
      { name: '终点', rationale: { serves: 'baseline', evidence: '补基线' } },
    ], clarification)).toThrow(/CLARIFICATION_REQUIRED/);
  });

  it('每个 milestone 有 rationale 且终点 stopping → 放行', () => {
    expect(() => assertClarificationRationalesReadyForPersistence([
      { name: '起点', rationale: { serves: 'baseline', evidence: '补基线' } },
      { name: '终点', rationale },
    ], clarification)).not.toThrow();
  });

  it('显式关闭开关时不做阻断（回滚口）', () => {
    const previous = process.env.GOAL_CLARIFICATION_ENFORCE;
    process.env.GOAL_CLARIFICATION_ENFORCE = '0';
    try {
      expect(() => assertClarificationRationalesReadyForPersistence([
        { name: '起点' },
      ], clarification)).not.toThrow();
    } finally {
      if (previous === undefined) delete process.env.GOAL_CLARIFICATION_ENFORCE;
      else process.env.GOAL_CLARIFICATION_ENFORCE = previous;
    }
  });
});
