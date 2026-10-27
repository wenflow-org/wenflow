import { derivePlanningHints } from '../path-planning-hints';

/**
 * R7-4 / R7-5a 回归：锚污染检测、漏发兜底、总量浮点收尾。
 * 数据取自 R6 实测（E02 锚 22≈cap 24、E04 锚 null 42/42、B19 null 54/54、真实大预算 45/84）
 * 以及独立审查给出的误伤反例（300h/窄词、60h 课次无 estH、74/84 合法锚、90h 污染后丢护栏）。
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

describe('R7-4 锚污染检测（收紧版：≤10% 且 ≤30h 且强窄目标）', () => {
  it('E02：锚 22≈cap 24 + 窄目标 ⇒ 判污染，兜底 7.5h，夹到 11.3h', () => {
    const hints = hintsOf({ estimatedHours: 22, calendarCapacityHours: 24, scopeAnchorHours: 22 }, 3, true);
    expect(hints.budgetDerivation?.scopeAnchorPolluted).toBe(true);
    expect(hints.budgetDerivation?.effectiveScopeAnchorHours).toBe(7.5);
    expect(hints.targetTotalHours).toBe(11.3);
  });

  it('真实锚（显著小于日历容量）⇒ 不判污染，按原锚', () => {
    const hints = hintsOf({ estimatedHours: 15, calendarCapacityHours: 78, scopeAnchorHours: 15 }, 4);
    expect(hints.budgetDerivation?.scopeAnchorPolluted).toBe(false);
    expect(hints.targetTotalHours).toBe(15);
  });

  it('74h 合法内容锚贴近 cap 84 ⇒ 不判污染（体量 >30h），预算不被砍', () => {
    const hints = hintsOf({ estimatedHours: 74, calendarCapacityHours: 84, scopeAnchorHours: 74 }, 8, true);
    expect(hints.budgetDerivation?.scopeAnchorPolluted).toBe(false);
    expect(hints.targetTotalHours).toBe(74);
  });

  it('锚污染但无兜底证据时保留原锚（绝不丢唯一护栏）：90h 课次 vs 锚 45=cap 45 ⇒ 夹到 67.5h', () => {
    const hints = hintsOf(
      { estimatedHours: 30, totalSessions: 90, sessionsLengthMin: 60, scopeAnchorHours: 45, calendarCapacityHours: 45 },
      8,
      true,
    );
    expect(hints.budgetDerivation?.scopeAnchorPolluted).toBe(false); // 45h > 30h 体量门
    expect(hints.targetTotalHours).toBe(67.5);
  });
});

describe('R7-4 漏发兜底（必须同时有日历乘法证据）', () => {
  it('无锚 + 体量与日历精确相等（54/54）⇒ 兜底 10h，夹到 15h', () => {
    const hints = hintsOf({ estimatedHours: 54, calendarCapacityHours: 54 }, 4);
    expect(hints.budgetDerivation?.scopeAnchorFallbackHours).toBe(10);
    expect(hints.targetTotalHours).toBe(15);
  });

  it('无锚 + 强窄目标 + 体量 ≥ 日历 85%（42/42）⇒ 兜底 10h', () => {
    const hints = hintsOf({ estimatedHours: 42, calendarCapacityHours: 42 }, 4, true);
    expect(hints.budgetDerivation?.effectiveScopeAnchorHours).toBe(10);
    expect(hints.targetTotalHours).toBe(15);
  });

  it('无锚 + 无窄目标 + 真实大预算（45/84）⇒ 不兜底，45h 不被误伤', () => {
    const hints = hintsOf({ estimatedHours: 45, calendarCapacityHours: 84 }, 8, false);
    expect(hints.budgetDerivation?.scopeAnchorFallbackHours).toBe(null);
    expect(hints.targetTotalHours).toBe(45);
  });

  it('H1 反例：窄目标措辞 + 300h 无日历容量 ⇒ 不兜底', () => {
    const hints = hintsOf({ estimatedHours: 300 }, 8, true);
    expect(hints.budgetDerivation?.scopeAnchorFallbackHours).toBe(null);
    expect(hints.targetTotalHours).toBe(300);
  });

  it('H2 反例：estH 缺失但课次算术 60h、日历 84h ⇒ 不视为日历驱动，不兜底', () => {
    const hints = hintsOf({ totalSessions: 60, sessionsLengthMin: 60, calendarCapacityHours: 84 }, 8, false);
    expect(hints.budgetDerivation?.scopeAnchorFallbackHours).toBe(null);
    expect(hints.targetTotalHours).toBe(60);
  });

  it('宽目标措辞 + 小体量（6h/24h）⇒ 不兜底、不上抬', () => {
    const hints = hintsOf({ estimatedHours: 6, calendarCapacityHours: 24 }, 3, false);
    expect(hints.targetTotalHours).toBe(6);
  });
});

describe('R7-5a 浮点收尾', () => {
  it('总学时保留 1 位小数（不出现 IEEE754 尾巴）', () => {
    const hints = hintsOf({ estimatedHours: 5.500000000000001 }, 2);
    expect(hints.targetTotalHours).toBe(5.5);
  });
});
