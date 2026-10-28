import { clampMilestoneHoursToBudget } from '../generation/path-budget-clamp';

/**
 * R8 外部审查修复：core 里程碑学时等比夹取（E02 实证 12h 目标 → core 23.9h）。
 */
describe('clampMilestoneHoursToBudget', () => {
  it('总量超目标 1.15 倍 ⇒ 等比缩回 target（每阶段保底 0.5h）', () => {
    const milestones = [
      { stageNumber: 1, estimatedHours: 4.3 },
      { stageNumber: 2, estimatedHours: 9.0 },
      { stageNumber: 3, estimatedHours: 6.8 },
      { stageNumber: 4, estimatedHours: 3.8 },
    ];
    const { milestones: out, info } = clampMilestoneHoursToBudget(milestones, 12);
    expect(info?.scaled).toBe(true);
    expect(info?.before).toBe(23.9);
    expect(out.reduce((s, m) => s + Number(m.estimatedHours), 0)).toBeCloseTo(12, 1);
    expect(out.every((m) => Number(m.estimatedHours) >= 0.5)).toBe(true);
  });

  it('总量在目标 1.15 倍内 ⇒ 不动', () => {
    const milestones = [{ estimatedHours: 6 }, { estimatedHours: 7 }];
    const { milestones: out, info } = clampMilestoneHoursToBudget(milestones, 12);
    expect(info?.scaled).toBe(false);
    expect(out.map((m) => m.estimatedHours)).toEqual([6, 7]);
  });

  it('target 缺失 ⇒ 零行为变化', () => {
    const milestones = [{ estimatedHours: 30 }];
    const { milestones: out, info } = clampMilestoneHoursToBudget(milestones, null);
    expect(info).toBe(null);
    expect(out).toBe(milestones);
  });
});
