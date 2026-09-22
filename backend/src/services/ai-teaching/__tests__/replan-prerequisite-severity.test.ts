/**
 * 前置缺口 severity → 重规划风险（L3 · S4c 契约）
 *
 * S4b 把 `prerequisiteGaps` 改成"上游未掌握的前置"，severity 按**缺口深度**定：
 * 一跳（直接阻塞当前任务）= high、两跳 = medium。
 * `ReplanAdvisoryService.build` 的 `highRisk` 直接消费 `severity === 'high'`，
 * 故深度语义会一路影响到**用户可见的重规划建议是否弹出**。本测试把这个契约钉死，
 * 避免以后有人把 severity 改成"只看 fragile"又悄悄改变触发率。
 */
import { ReplanAdvisoryService } from '../ReplanAdvisoryService';

const service = new ReplanAdvisoryService();

/** 最小 wrapup：无高指标、无 movedToReview —— 让 highRisk 只能由 prerequisiteGaps 触发 */
const wrapup = {
  evaluation: { sessionKtl: 4, sessionLss: 3, sessionLf: 3, confidence: 0.9, metricTiers: {} },
  progress: { movedToReview: [], stillLearning: [] },
  evidence: { topConfusionPoints: [] },
} as never;

function projectionWith(gaps: Array<{ label: string; reason: string; severity: string }>) {
  return {
    path: { currentPosition: { milestoneId: 'm1' } },
    mastery: { fragileConcepts: [], strugglingConcepts: [] },
    risk: { prerequisiteGaps: gaps },
    evidence: { milestoneStates: [{ milestoneId: 'm1', totalTasks: 3, completedTasks: 3 }] },
    signal: null,
  } as never;
}

const nextMilestone = { milestoneId: 'm2', title: '下一阶段', totalTasks: 3 };

describe('前置缺口 severity → highRisk（S4c 契约）', () => {
  it('一跳缺口（severity=high）→ 触发重规划建议', () => {
    const advisory = service.build({
      wrapup,
      learnerReplanProjection: projectionWith([
        { label: '分组键唯一性', reason: '直接前置未掌握', severity: 'high' },
      ]),
      nextMilestone,
    });
    expect(advisory.shouldSuggest).toBe(true);
    // highRisk 分支的 reason code 是 high_risk（不是 prerequisite_gaps）
    expect(advisory.reasonCodes).toContain('high_risk');
  });

  it('只有两跳缺口（severity=medium）→ 不因它触发建议', () => {
    const advisory = service.build({
      wrapup,
      learnerReplanProjection: projectionWith([
        { label: '数据结构基础', reason: '间接前置掌握不稳', severity: 'medium' },
      ]),
      nextMilestone,
    });
    expect(advisory.shouldSuggest).toBe(false);
  });

  it('无缺口 + 无其它风险 → 不建议', () => {
    const advisory = service.build({
      wrapup,
      learnerReplanProjection: projectionWith([]),
      nextMilestone,
    });
    expect(advisory.shouldSuggest).toBe(false);
  });
});
