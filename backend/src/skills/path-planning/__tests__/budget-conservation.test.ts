/**
 * 量级守恒硬执行（enforceBudgetConservation）单元测试：
 * 欠填放大 / 超填收缩 / 容量钳制 / 缺口声明 / 缺失学时补锚 / 无预算锚跳过。
 * 根因案例：mastery-eng 90h 预算产出 37h（2026-09-28）。
 */
import { enforceBudgetConservation } from '../index';

function milestones(hours: (number | null)[]) {
  return hours.map((h, i) => ({ stageNumber: i + 1, title: `M${i + 1}`, estimatedHours: h as any }));
}

describe('enforceBudgetConservation（量级守恒硬执行）', () => {
  it('欠填放大：90h 预算产出 37h → 拉到结构容量（8×14×30min=56h），无缺口声明', () => {
    const ms = milestones([4, 3, 4, 4, 7, 4, 4, 7]); // sum=37
    const hints = {
      targetTotalHours: 90,
      targetHoursPerMilestone: 7,
      subtasksPerStageRange: [8, 14],
      subtaskMinutesRange: [15, 30],
    };
    const r = enforceBudgetConservation(ms, hints);
    expect(r.report!.before).toBe(37);
    expect(r.report!.capacitySum).toBe(56);
    expect(r.totalAfter).toBeGreaterThan(53.9); // ≥ 0.6×90=54
    expect(r.totalAfter).toBeLessThanOrEqual(56);
    expect(r.gapNote).toBeNull(); // 容量 56 ≥ 下限 54，诚实可达
    // 逐阶段学时被改写（一位小数、不超每阶段容量 7）
    for (const m of ms) {
      expect(m.estimatedHours).toBeGreaterThan(0);
      expect(m.estimatedHours).toBeLessThanOrEqual(7);
    }
  });

  it('容量低于守恒下限 → 放大到容量并产出缺口声明（heavy-fp 形态：540h 预算 / 56h 容量）', () => {
    const ms = milestones([7, 7, 7, 7, 7, 7, 7, 7]); // sum=56=容量
    const hints = {
      targetTotalHours: 540,
      targetHoursPerMilestone: 7,
      subtasksPerStageRange: [8, 14],
      subtaskMinutesRange: [15, 30],
    };
    const r = enforceBudgetConservation(ms, hints);
    expect(r.totalAfter).toBe(56);
    expect(r.gapNote).toBeTruthy();
    expect(r.gapNote).toMatch(/540/);
    expect(r.gapNote).toMatch(/56/);
  });

  it('超填收缩：10h 预算产出 25h → 压回 [0.6,1.8]×10 带内（受容量钳制）', () => {
    const ms = milestones([5, 5, 5, 5, 5]);
    const hints = {
      targetTotalHours: 10,
      targetHoursPerMilestone: 2,
      subtasksPerStageRange: [3, 6],
      subtaskMinutesRange: [15, 30],
    };
    const r = enforceBudgetConservation(ms, hints);
    expect(r.totalAfter).toBeLessThanOrEqual(18); // 1.8×10
    expect(r.totalAfter).toBeGreaterThanOrEqual(6); // 0.6×10
  });

  it('缺失学时补每阶段锚后再参与守恒', () => {
    const ms = milestones([null as any, null as any, null as any, null as any]);
    const hints = {
      targetTotalHours: 40,
      targetHoursPerMilestone: 10,
      subtasksPerStageRange: [4, 8],
      subtaskMinutesRange: [30, 60],
    };
    const r = enforceBudgetConservation(ms, hints);
    expect(r.totalAfter).toBeGreaterThan(0);
    for (const m of ms) expect(m.estimatedHours).toBeGreaterThan(0);
  });

  it('无预算锚（hints 空/targetTotalHours 缺失）→ 只汇总不校正', () => {
    const ms = milestones([3, 4, 5]);
    const r = enforceBudgetConservation(ms, null);
    expect(r.totalAfter).toBe(12);
    expect(r.gapNote).toBeNull();
    expect(ms.map((m) => m.estimatedHours)).toEqual([3, 4, 5]);
  });

  it('垃圾锚防护：≥3 阶段但 target<2h（推导污染）→ 不执行守恒，按模型原样汇总（exam-12 型：target=1 把 70h 合规输出夹到 4.9h）', () => {
    const ms = milestones([14, 14, 14, 14, 14]);
    const hints = {
      targetTotalHours: 1,
      targetHoursPerMilestone: 0.2,
      subtasksPerStageRange: [3, 14],
      subtaskMinutesRange: [15, 90],
    };
    const r = enforceBudgetConservation(ms, hints);
    expect(r.totalAfter).toBe(70);
    expect(r.gapNote).toBeNull();
    expect(ms.map((m) => m.estimatedHours)).toEqual([14, 14, 14, 14, 14]);
  });

  it('一节课路径（1-2 阶段）的 <2h 锚仍照常执行（规则 43 一次性操作形态合法）', () => {
    const ms = milestones([3, 4]);
    const hints = {
      targetTotalHours: 1,
      subtasksPerStageRange: [1, 2],
      subtaskMinutesRange: [10, 15],
    };
    const r = enforceBudgetConservation(ms, hints);
    // 容量 = 2 阶段 × 2 任务 × 15min = 1h；ceiling = min(1.8, 1) = 1 → 收缩
    expect(r.totalAfter).toBeLessThanOrEqual(1);
    expect(ms.map((m) => m.estimatedHours).reduce((a, b) => a + b, 0)).toBeCloseTo(r.totalAfter, 1);
  });
});

/**
 * 决策留痕（2026-09-29 I6-2）：报告要能回答「是谁把学时夹下来的」。
 * 此前 report 只进日志（且仅在有 gapNote 时打），路径落库后无从复核。
 */
describe('enforceBudgetConservation · 决策留痕（I6-2）', () => {
  it('容量顶住 → clampReason=capacity，并逐阶段留痕（可核对哪几个阶段顶到容量）', () => {
    const ms = milestones([7, 7, 7, 7, 7, 7, 7, 7]);
    const r = enforceBudgetConservation(ms, {
      targetTotalHours: 540,
      targetHoursPerMilestone: 7,
      subtasksPerStageRange: [8, 14],
      subtaskMinutesRange: [15, 30],
    });
    expect(r.report!.clampReason).toBe('capacity');
    expect(r.report!.perStageCapHours).toBe(7); // 14 × 30min / 60
    expect(r.report!.perStage).toHaveLength(8);
    // 逐阶段 before→after 与落库学时逐条对得上（留痕不是另算一套）
    r.report!.perStage.forEach((s, i) => expect(s.after).toBe(ms[i].estimatedHours));
  });

  it('欠填但容量够 → clampReason=floor（是补预算，不是装不下）', () => {
    const ms = milestones([4, 3, 4, 4, 7, 4, 4, 7]);
    const r = enforceBudgetConservation(ms, {
      targetTotalHours: 90,
      targetHoursPerMilestone: 7,
      subtasksPerStageRange: [8, 14],
      subtaskMinutesRange: [15, 30],
    });
    expect(r.report!.clampReason).toBe('floor');
  });

  it('超填且非容量所致 → clampReason=ceiling（1.8× 上限，不是结构装不下）', () => {
    const ms = milestones([5, 5, 5, 5, 5]);
    const r = enforceBudgetConservation(ms, {
      targetTotalHours: 10,
      targetHoursPerMilestone: 2,
      subtasksPerStageRange: [3, 8], // 容量 8×30min/60 = 4h/阶段 → 5 阶段共 20h > 1.8×10
      subtaskMinutesRange: [15, 30],
    });
    expect(r.report!.clampReason).toBe('ceiling');
  });

  it('带内未动 → clampReason=none（不制造假的夹痕）', () => {
    const ms = milestones([2, 2, 2]);
    const r = enforceBudgetConservation(ms, {
      targetTotalHours: 10,
      targetHoursPerMilestone: 3,
      subtasksPerStageRange: [4, 8],
      subtaskMinutesRange: [30, 60],
    });
    expect(r.report!.scaled).toBe(false);
    expect(r.report!.clampReason).toBe('none');
  });

  it('无预算锚 → report 为 null（缺信号时不编造留痕）', () => {
    expect(enforceBudgetConservation(milestones([3, 4, 5]), null).report).toBeNull();
  });
});
