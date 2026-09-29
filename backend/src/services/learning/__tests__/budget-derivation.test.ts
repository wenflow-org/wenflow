/**
 * 预算派生链留痕（2026-09-29 I6-3）。
 *
 * 动机（实审原话）：`targetHoursPerMilestone=22.4` 与 `targetTotalHours/targetMilestones=69.3`
 * 相差 68%，两个字段都不带来源，评审只能记「hints 内部不自洽」而判不了是谁造成的。
 * 真实成因是**容量夹**（22.4h = 14 课 × 96min / 60），不是推导错。
 *
 * 本字段把「总锚从哪来（哪一级 fallback）→ 均摊请求值 → 容量上界 → 落地锚 → 是否被夹」
 * 一次记全，使这类判语从「存疑」变为「可判」。
 *
 * 口径分工（刻意不合并，合并即掩盖分歧）：
 *   · 本字段的 structureStageCapacityHours 用 effectiveSubtasksPerStageRange[1]（与 targetHoursPerMilestone 同源）；
 *   · 交付侧的夹是 skills/path-planning 的 enforceBudgetConservation，用 subtasksPerStageRange[1]。
 */
import { derivePlanningHints, type BudgetDerivation } from '../path-planning-hints';

/** 大预算长周期（CPA 型）：900h / 5 阶段 ⇒ 每阶段请求 180h，远超结构容量 */
const BIG = { estimatedHours: 900 };
/** 小预算：36h / 5 阶段 ⇒ 每阶段 7.2h，装得下 */
const FITS = { estimatedHours: 36 };

function hints(td: Record<string, number> | null) {
  return derivePlanningHints(null, null, null, null, [], td ? { ...td } : null, null, null, null);
}

const expectSelfConsistent = (d: BudgetDerivation) => {
  // 落地锚 == min(容量上界, 请求值)（与 targetHoursPerMilestone 逐字同式）
  if (d.perMilestoneRequested !== null && d.structureStageCapacityHours !== null) {
    expect(Math.abs(d.perMilestoneAnchored! - Math.min(d.structureStageCapacityHours, d.perMilestoneRequested)))
      .toBeLessThan(0.05);
  }
  // 夹的判据 == anchored < requested
  expect(d.anchorClamped).toBe(
    d.perMilestoneRequested !== null
      && d.perMilestoneAnchored !== null
      && d.perMilestoneAnchored < d.perMilestoneRequested - 0.05,
  );
};

describe('预算派生链 budgetDerivation', () => {
  it('大预算：请求值被结构容量夹住，夹的判据与两值自洽', () => {
    const d = hints(BIG).budgetDerivation!;
    expect(d).toBeTruthy();
    expect(d.totalHours).toBe(900);
    expect(d.perMilestoneRequested).toBeGreaterThan(d.structureStageCapacityHours!);
    expect(d.anchorClamped).toBe(true);
    expectSelfConsistent(d);
  });

  it('装得下时：不报夹（anchorClamped=false），锚等于均摊请求值', () => {
    const d = hints(FITS).budgetDerivation!;
    expect(d.anchorClamped).toBe(false);
    expect(d.perMilestoneAnchored).toBeCloseTo(d.perMilestoneRequested!, 1);
    expectSelfConsistent(d);
  });

  it('来源可辨：timeDimensions.estimatedHours → structured_estimated_hours', () => {
    expect(hints(BIG).budgetDerivation!.source).toBe('structured_estimated_hours');
  });

  it('来源可辨：仅给会话频率 → structured_sessions', () => {
    const h = derivePlanningHints(
      null, null, null, null, [],
      { totalWeeks: 12, sessionsPerWeek: 3, sessionsLengthMin: 60 }, null, null, null,
    );
    expect(h.budgetDerivation!.source).toBe('structured_sessions');
    expect(h.budgetDerivation!.totalHours).toBe(36); // 12×3×60/60
  });

  it('来源可辨：无结构化字段、由「每日分钟×周期」兜底 → inferred_daily_minutes', () => {
    // timeHorizon='3个月' + timePerSession='每天1小时' ⇒ 兜底 90h
    const h = derivePlanningHints('3个月', '每天1小时', null, null, [], null, null, null, null);
    const d = h.budgetDerivation!;
    expect(d.source).toBe('inferred_daily_minutes');
    expect(d.structuredHours).toBeNull();
    expect(d.inferredCapHours).toBeGreaterThan(0);
  });

  it('完全无时长信号：hints 无锚，派生链为 null（不编造来源）', () => {
    const h = derivePlanningHints(null, null, null, null, [], null, null, null, null);
    expect(h.budgetDerivation).toBeNull();
    expect(h.targetTotalHours).toBeNull();
  });

  it('落库口径：budgetDerivation 可 JSON 序列化且随 hints 一起走', () => {
    const round = JSON.parse(JSON.stringify(hints(BIG)));
    expect(round.budgetDerivation).toBeTruthy();
    expect(round.budgetDerivation.perMilestoneAnchored).toBe(round.targetHoursPerMilestone);
    expect(round.budgetDerivation.totalHours).toBe(round.targetTotalHours);
  });
});
