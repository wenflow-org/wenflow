import { derivePlanningHints, type TriageHint } from '../path-planning-hints';

/**
 * 出口不变量 B（2026-09-21）：Goal 层判为「低可迁移 × 低复现」的一次性操作/事务，
 * 必须被压到"一节"量级——这是对"教育通胀"的**代码级边界**。
 *
 * 依据（60 例混合数据集实测）：一次性操作类产出 2.3–7.4h，构成为
 *   「阶段数 × 每段任务数(2–3) × 单任务分钟」，而单任务中位 37 分钟恰是 standard 档
 *   `defaultMinutesRange=[30,90]` 的下沿 ⇒ 学时是模板产物，不是"这件事要多久"的估计。
 *
 * 关键约束：钳制**只收上界、不拍死数字**，且**不得把区间塌成单点**
 * （与不变量 A「区间永不为单点」兼容——塌成单点会让 validator 退化成精确校验）。
 */
function hintsWith(triage?: TriageHint | null) {
  return derivePlanningHints(null, null, null, null, [], null, null, null, triage);
}

describe('分流钳制（出口不变量 B）', () => {
  it('低可迁移 × 一次性 → 压到一节量级，且区间不塌成单点', () => {
    const h = hintsWith({ transferable: false, recurrence: 'once' });

    expect(h.milestoneRange[1]).toBeLessThanOrEqual(2);
    expect(h.milestoneRange[0]).toBeLessThan(h.milestoneRange[1]);   // 不变量 A：两端不等
    expect(h.subtasksPerStageRange[1]).toBeLessThanOrEqual(2);
    expect(h.subtaskMinutesRange[1]).toBeLessThanOrEqual(15);
    expect(h.maxWeeks).toBeLessThanOrEqual(1);

    // 最坏量级（上界 × 上界 × 上界）≤ 60 分钟 = "一节课"
    const worstMinutes = h.milestoneRange[1] * h.subtasksPerStageRange[1] * h.subtaskMinutesRange[1];
    expect(worstMinutes).toBeLessThanOrEqual(60);

    // targetMilestones 被同步收住（否则提示词会与区间自相矛盾）
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

  it('缺省 triage / 字段缺失 → 行为与今天完全一致', () => {
    const base = hintsWith(null);
    expect(hintsWith(undefined).milestoneRange).toEqual(base.milestoneRange);
    expect(hintsWith({} as TriageHint).milestoneRange).toEqual(base.milestoneRange);
  });

  it('钳制仍然只给边界：区间有宽度，数字由 LLM 在区间内定', () => {
    const h = hintsWith({ transferable: false, recurrence: 'once' });
    const width = (r: [number, number]) => r[1] - r[0];
    expect(width(h.milestoneRange)).toBeGreaterThanOrEqual(1);
    expect(width(h.subtasksPerStageRange)).toBeGreaterThanOrEqual(1);
  });
});
