import { clampHintsToOneSitting, derivePlanningHints, type TriageHint } from '../path-planning-hints';

/**
 * 体量边界（2026-09-21）：
 *   A. 出口不变量 A：里程碑区间**永不为单点**（防塌缩）
 *   B. 出口不变量 B：**一节课**量级边界（防通胀）——两个触发源
 *      · Goal 层 triage（transferable=false × recurrence=once）
 *      · 用户承受力锚（availableTime=minimal **或完全没有时长信号**）
 *
 * 依据（本地重放复现生产）：学时 = 段数 × 每段任务数(4–6) × 单任务分钟(37–45)，
 * 与"这件事需要多久"无关 —— availableTime=minimal 的学习者被排了 7.4 小时。
 */
const RICH_TIME_BUDGET = '每周 300 分钟';
const RICH_TIME_DIMENSIONS = { totalWeeks: 12, sessionsPerWeek: 3, sessionsLengthMin: 60 } as const;

/** 基线：**有充裕时长信号**（否则会被"无信号 ⇒ 一节课"的锚钳住，断言就失去意义） */
function hintsWith(triage?: TriageHint | null, loadProfile?: { availableTime?: string | null } | null) {
  return derivePlanningHints(
    null, null, RICH_TIME_BUDGET, 'per_week', [],
    { ...RICH_TIME_DIMENSIONS }, null,
    loadProfile ? { availableTime: loadProfile.availableTime ?? null } : null,
    triage,
  );
}

/** 无任何时长信号（未知 = 按最小兜底） */
function hintsNoTimeSignal(triage?: TriageHint | null) {
  return derivePlanningHints(null, null, null, null, [], null, null, null, triage);
}

const width = (r: [number, number]) => r[1] - r[0];
const worstMinutes = (h: ReturnType<typeof hintsWith>) =>
  h.milestoneRange[1] * h.subtasksPerStageRange[1] * h.subtaskMinutesRange[1];

describe('分流钳制（出口不变量 B）· Goal 层 triage 触发', () => {
  it('低可迁移 × 一次性 → 压到一节量级，且区间不塌成单点', () => {
    const h = hintsWith({ transferable: false, recurrence: 'once' });
    expect(h.milestoneRange[1]).toBeLessThanOrEqual(2);
    expect(h.milestoneRange[0]).toBeLessThan(h.milestoneRange[1]);
    expect(h.subtasksPerStageRange[1]).toBeLessThanOrEqual(2);
    expect(h.subtaskMinutesRange[1]).toBeLessThanOrEqual(15);
    expect(h.maxWeeks).toBeLessThanOrEqual(1);
    expect(worstMinutes(h)).toBeLessThanOrEqual(60);
    expect(h.targetMilestones ?? 0).toBeLessThanOrEqual(2);
  });

  it('可迁移 → 不钳制（capability 类必须保持原样）', () => {
    const base = hintsWith(null);
    const h = hintsWith({ transferable: true, recurrence: 'once' });
    expect(h.milestoneRange).toEqual(base.milestoneRange);
    expect(h.subtaskMinutesRange).toEqual(base.subtaskMinutesRange);
    expect(h.maxWeeks).toEqual(base.maxWeeks);
  });

  it('反复发生 → 不钳制（environment_tooling × recurring 会误杀）', () => {
    const base = hintsWith(null);
    const h = hintsWith({ transferable: false, recurrence: 'recurring' });
    expect(h.milestoneRange).toEqual(base.milestoneRange);
    expect(h.subtasksPerStageRange).toEqual(base.subtasksPerStageRange);
  });

  it('缺省 triage / 字段缺失 → 行为与今天一致', () => {
    const base = hintsWith(null);
    expect(hintsWith(undefined).milestoneRange).toEqual(base.milestoneRange);
    expect(hintsWith({} as TriageHint).milestoneRange).toEqual(base.milestoneRange);
  });
});

describe('分流钳制（出口不变量 B）· 用户承受力锚触发', () => {
  it('availableTime=minimal → 压到一节量级（实测：这类学习者曾被排 7.4 小时）', () => {
    const h = hintsWith(null, { availableTime: 'minimal' });
    expect(h.milestoneRange[1]).toBeLessThanOrEqual(2);
    expect(h.subtaskMinutesRange[1]).toBeLessThanOrEqual(15);
    expect(worstMinutes(h)).toBeLessThanOrEqual(60);
    // 与 triage 触发共用同一份边界（单一口径）
    expect(h.subtaskMinutesRange).toEqual(hintsWith({ transferable: false, recurrence: 'once' }).subtaskMinutesRange);
  });

  it('完全没有时长信号（未知）→ 按最小兜底，而不是按最大', () => {
    const h = hintsNoTimeSignal(null);
    expect(h.milestoneRange[1]).toBeLessThanOrEqual(2);
    expect(worstMinutes(h)).toBeLessThanOrEqual(60);
  });

  it('availableTime=moderate / abundant 且时长信号充裕 → **不钳制**（局限要说清）', () => {
    for (const level of ['moderate', 'abundant']) {
      const h = hintsWith(null, { availableTime: level });
      expect(h.milestoneRange[1]).toBeGreaterThan(2);
      expect(h.subtaskMinutesRange[1]).toBeGreaterThan(15);
    }
  });
});

describe('clampHintsToOneSitting（Path 层自检 → stage-designer 的 hints）', () => {
  it('把任意 hints 收到一节课量级（只收上界，区间不塌成单点）', () => {
    const clamped = clampHintsToOneSitting(hintsWith(null));
    expect(clamped.milestoneRange[1]).toBeLessThanOrEqual(2);
    expect(clamped.milestoneRange[0]).toBeLessThan(clamped.milestoneRange[1]);
    expect(clamped.subtasksPerStageRange[1]).toBeLessThanOrEqual(2);
    expect(clamped.subtaskMinutesRange[1]).toBeLessThanOrEqual(15);
    expect(clamped.maxWeeks).toBeLessThanOrEqual(1);
    expect(worstMinutes(clamped)).toBeLessThanOrEqual(60);
    expect(clamped.targetMilestones ?? 0).toBeLessThanOrEqual(2);
    expect(clamped.targetSubtasksPerStage ?? 0).toBeLessThanOrEqual(2);
  });

  it('与"承受力锚 / triage"走同一份边界常量（单一口径）', () => {
    const byTriage = hintsWith({ transferable: false, recurrence: 'once' });
    const byAvailability = hintsWith(null, { availableTime: 'minimal' });
    const bySelfCheck = clampHintsToOneSitting(hintsWith(null));
    expect(bySelfCheck.milestoneRange).toEqual(byTriage.milestoneRange);
    expect(bySelfCheck.milestoneRange).toEqual(byAvailability.milestoneRange);
    expect(bySelfCheck.subtaskMinutesRange).toEqual(byTriage.subtaskMinutesRange);
    expect(bySelfCheck.subtasksPerStageRange).toEqual(byTriage.subtasksPerStageRange);
  });

  it('钳制仍只给边界：区间有宽度，数字由 LLM 在区间内定', () => {
    const h = clampHintsToOneSitting(hintsWith(null));
    expect(width(h.milestoneRange)).toBeGreaterThanOrEqual(1);
    expect(width(h.subtasksPerStageRange)).toBeGreaterThanOrEqual(1);
  });
});
