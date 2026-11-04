/**
 * 生成路径前置分诊闸门（#217）单元测试。
 *
 * 口径（第二次评审后）：闸门不吃文本关键词，只吃 goal 层判定凭证。
 *  - 有凭证 → 跑同一套 `triageGoalResponse` + `isHardBlockResponseTriage`；
 *  - 硬阻断 → 复用目标会话文案；
 *  - 无凭证 → 拒绝（不猜测、不放行）。
 */
import {
  evaluateGoalTriageEvidence,
  assertPathGenerationAllowed,
  PathGenerationBlockedError,
  GoalTriageRequiredError,
  GOAL_TRIAGE_REQUIRED_MESSAGE,
} from '../path-generation-gate';
import { buildHardBlockMessage } from '../goal-conversation.exit';
import { triageGoalResponse } from '../response-triage';

const BLOCKED_UNDERSTANDING = {
  real_problem: '想三个月后在婚礼上自弹自唱一首民谣吉他',
  platform_judgment: 'not_judgeable',
  skill_nature: 'physical_internalized',
};

describe('生成路径前置分诊闸门（#217）', () => {
  it('goal 层判为不可判定 → 拦，且文案与目标会话逐字一致', () => {
    const decision = evaluateGoalTriageEvidence({ understanding: BLOCKED_UNDERSTANDING });

    expect(decision.status).toBe('blocked');
    if (decision.status !== 'blocked') throw new Error('expect blocked');
    expect(decision.triage.mode).toBe('referral');
    expect(decision.message).toBe(buildHardBlockMessage(decision.triage));
    expect(decision.message).toContain('这类目标当前不会生成学习路径');
    expect(decision.message).toContain('平台无法客观判定这类目标的学习效果');
  });

  it('goal 链只带 visibleSummary 投影时同样能拦（platformJudgment × skillNature）', () => {
    const decision = evaluateGoalTriageEvidence({
      visibleSummary: {
        platformJudgment: 'not_judgeable',
        skillNature: 'physical_internalized',
      },
    });

    expect(decision.status).toBe('blocked');
  });

  it('goal 层已有 responseTriage 时优先用它（emotional_support 也拦）', () => {
    const decision = evaluateGoalTriageEvidence({
      responseTriage: { mode: 'emotional_support', confidence: 'high', reasons: [] },
      visibleSummary: { platformJudgment: null, skillNature: null },
    });

    expect(decision.status).toBe('blocked');
  });

  it('可判定的 goal 层产物照常放行', () => {
    const understanding = { primary_block_type: 'capability', recurrence: 'recurring' };
    const decision = evaluateGoalTriageEvidence({ understanding });

    expect(decision.status).toBe('allowed');
    if (decision.status !== 'allowed') throw new Error('expect allowed');
    expect(decision.triage).toEqual(triageGoalResponse(understanding));
  });

  it('没有判定凭证 → unverified（不猜、不放行）', () => {
    for (const evidence of [null, undefined, {}, { understanding: {} }, { responseTriage: null }]) {
      const decision = evaluateGoalTriageEvidence(evidence as never);
      expect(decision.status).toBe('unverified');
      if (decision.status !== 'unverified') throw new Error('expect unverified');
      expect(decision.message).toBe(GOAL_TRIAGE_REQUIRED_MESSAGE);
    }
  });

  it('assert 在硬阻断/无凭证时抛对应错误', () => {
    expect(() => assertPathGenerationAllowed({ understanding: BLOCKED_UNDERSTANDING }))
      .toThrow(PathGenerationBlockedError);
    expect(() => assertPathGenerationAllowed(null)).toThrow(GoalTriageRequiredError);
    expect(() => assertPathGenerationAllowed({ understanding: { primary_block_type: 'capability' } }))
      .not.toThrow();
  });
});
