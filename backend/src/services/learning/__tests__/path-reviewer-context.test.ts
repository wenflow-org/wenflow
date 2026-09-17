import { buildPathReviewerGoalContext } from '../path-reviewer-context';

/**
 * 回归（审计 §3.19 P1⑥）：path-reviewer 的 goalContext 必须带 successCriteria
 * （yaml 声明 + Practicality 评分要用），且取自与 path-planning 同一份定帧结果。
 * 另附 P1⑤：stage-designer 的 loadTarget 注入（独立文件见 stage-designer 侧）。
 */
describe('路径评审的目标上下文（P1⑥）', () => {
  it('从 analysis.sceneFraming.normalizedInput 取 successCriteria（与生成侧同一份）', () => {
    const ctx = buildPathReviewerGoalContext({
      description: '学会做咖啡',
      confirmedProposal: { learningDirection: 'd' },
      learnerProfile: { currentBaseline: { level: 'beginner' } },
      analysis: {
        sceneFraming: {
          normalizedInput: {
            successCriteria: { observableResult: '能独立出品', acceptanceCheck: '连续 3 杯稳定' },
          },
        },
      },
    });
    expect(ctx.successCriteria).toEqual({ observableResult: '能独立出品', acceptanceCheck: '连续 3 杯稳定' });
    expect(ctx.surfaceGoal).toBe('学会做咖啡');
    expect(ctx.confirmedProposal).toEqual({ learningDirection: 'd' });
  });

  it('缺少定帧结果时为 null（不编造），也不抛错', () => {
    expect(buildPathReviewerGoalContext({ description: 'g' }).successCriteria).toBeNull();
    expect(buildPathReviewerGoalContext({ analysis: { sceneFraming: null } }).successCriteria).toBeNull();
    expect(buildPathReviewerGoalContext({ analysis: null }).successCriteria).toBeNull();
  });

  it('空/空白目标描述归一为 null', () => {
    expect(buildPathReviewerGoalContext({ description: '   ' }).surfaceGoal).toBeNull();
  });
});
