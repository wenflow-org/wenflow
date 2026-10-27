import { derivePlanningHints } from '../path-planning-hints';

/**
 * R7-4 / R7-5a 回归：锚污染检测、漏发兜底、总量浮点收尾。
 * 数据取自 R6 实测（E02 锚 22≈cap 24、E04 锚 null 42/42、B19 null 54/54、真实大预算 45/84）。
 */
function hintsOf(td: Record<string, number | null>, keyStages: number, narrowScopeSignal?: boolean) {
  return derivePlanningHints(
    null,
    null,
    null,
    null,
    Array.from({ length: keyStages }, (_, i) => `阶段${i + 1}`),
    td,
    null,
    null,
    null,
    narrowScopeSignal,
  );
}

describe('R7-4 锚污染检测', () => {
  it('锚 ≈ 日历容量（≤20%）⇒ 判污染，按未提供处理并走兜底', () => {
    const hints = hintsOf({ estimatedHours: 22, calendarCapacityHours: 24, scopeAnchorHours: 22 }, 3);
    expect(hints.budgetDerivation?.scopeAnchorPolluted).toBe(true);
    expect(hints.budgetDerivation?.effectiveScopeAnchorHours).toBe(7.5); // 3 × 2.5
    expect(hints.targetTotalHours).toBe(11.3); // 7.5 × 1.5
  });

  it('锚显著小于日历容量 ⇒ 不判污染，按原锚硬夹', () => {
    const hints = hintsOf({ estimatedHours: 15, calendarCapacityHours: 78, scopeAnchorHours: 15 }, 4);
    expect(hints.budgetDerivation?.scopeAnchorPolluted).toBe(false);
    expect(hints.budgetDerivation?.effectiveScopeAnchorHours).toBe(15);
    expect(hints.targetTotalHours).toBe(15);
  });
});

describe('R7-4 漏发兜底（仅窄目标/日历驱动触发）', () => {
  it('无锚 + 自报学时 ≈ 日历容量（54/54）⇒ 兜底 10h，夹到 15h', () => {
    const hints = hintsOf({ estimatedHours: 54, calendarCapacityHours: 54 }, 4);
    expect(hints.budgetDerivation?.scopeAnchorFallbackHours).toBe(10);
    expect(hints.targetTotalHours).toBe(15);
  });

  it('无锚 + 窄目标措辞信号（42/42）⇒ 兜底 10h，夹到 15h', () => {
    const hints = hintsOf({ estimatedHours: 42, calendarCapacityHours: 42 }, 4, true);
    expect(hints.budgetDerivation?.effectiveScopeAnchorHours).toBe(10);
    expect(hints.targetTotalHours).toBe(15);
  });

  it('无锚 + 无窄目标信号 + 真实大预算（45/84）⇒ 不兜底，预算不被误伤', () => {
    const hints = hintsOf({ estimatedHours: 45, calendarCapacityHours: 84 }, 8, false);
    expect(hints.budgetDerivation?.scopeAnchorFallbackHours).toBe(null);
    expect(hints.targetTotalHours).toBe(45);
  });

  it('兜底只下压不上抬：真实需求 6h 时保持 6h', () => {
    const hints = hintsOf({ estimatedHours: 6, calendarCapacityHours: 24 }, 3, true);
    expect(hints.targetTotalHours).toBe(6);
  });
});

describe('R7-5a 浮点收尾', () => {
  it('总学时保留 1 位小数（不出现 IEEE754 尾巴）', () => {
    const hints = hintsOf({ estimatedHours: 5.500000000000001 }, 2);
    expect(hints.targetTotalHours).toBe(5.5);
  });
});
