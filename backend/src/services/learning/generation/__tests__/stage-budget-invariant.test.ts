/**
 * #56 / I3 阶段预算不变量：退化形态必须可见（等分 / 全等于上游总量 / 学时缺失 / 合计对不上）。
 */
import { auditStageBudget } from '../stage-budget-invariant';

describe('auditStageBudget（阶段预算不变量）', () => {
  it('正常形态（各阶段按内容不等）通过', () => {
    const report = auditStageBudget({
      pathEstimatedHours: 30,
      stages: [
        { stageNumber: 1, estimatedHours: 6 },
        { stageNumber: 2, estimatedHours: 9 },
        { stageNumber: 3, estimatedHours: 15 },
      ],
    });
    expect(report.ok).toBe(true);
    expect(report.totalStageHours).toBe(30);
    expect(report.violations).toEqual([]);
  });

  it('某阶段学时等于上游总预算 → stage_equals_upstream', () => {
    const report = auditStageBudget({
      pathEstimatedHours: 24,
      upstreamBudgetHours: 24,
      stages: [
        { stageNumber: 1, estimatedHours: 24 },
        { stageNumber: 2, estimatedHours: 8 },
      ],
    });
    expect(report.ok).toBe(false);
    expect(report.violations.map((v) => v.kind)).toContain('stage_equals_upstream');
  });

  it('各阶段完全等分（每阶段 >1h）→ all_stages_identical', () => {
    const report = auditStageBudget({
      pathEstimatedHours: 20,
      stages: [
        { stageNumber: 1, estimatedHours: 5 },
        { stageNumber: 2, estimatedHours: 5 },
        { stageNumber: 3, estimatedHours: 5 },
        { stageNumber: 4, estimatedHours: 5 },
      ],
    });
    expect(report.violations.map((v) => v.kind)).toContain('all_stages_identical');
  });

  it('短路径每阶段 1 节课（N×1h）不算等分退化', () => {
    const report = auditStageBudget({
      pathEstimatedHours: 3,
      stages: [
        { stageNumber: 1, estimatedHours: 1 },
        { stageNumber: 2, estimatedHours: 1 },
        { stageNumber: 3, estimatedHours: 1 },
      ],
    });
    expect(report.violations).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('两阶段等分也不判等分退化（样本不足）', () => {
    const report = auditStageBudget({
      pathEstimatedHours: 10,
      stages: [
        { stageNumber: 1, estimatedHours: 5 },
        { stageNumber: 2, estimatedHours: 5 },
      ],
    });
    expect(report.violations.map((v) => v.kind)).not.toContain('all_stages_identical');
  });

  it('阶段缺学时 → stage_hours_missing', () => {
    const report = auditStageBudget({
      pathEstimatedHours: 10,
      stages: [
        { stageNumber: 1, estimatedHours: 10 },
        { stageNumber: 2, estimatedHours: null },
      ],
    });
    expect(report.violations.map((v) => v.kind)).toContain('stage_hours_missing');
  });

  it('阶段合计与总量差 >5% → stage_sum_mismatch', () => {
    const report = auditStageBudget({
      pathEstimatedHours: 40,
      upstreamBudgetHours: 40,
      stages: [
        { stageNumber: 1, estimatedHours: 6 },
        { stageNumber: 2, estimatedHours: 6 },
      ],
    });
    expect(report.violations.map((v) => v.kind)).toContain('stage_sum_mismatch');
  });

  it('单阶段路径：阶段=总量是正确形态，不判退化', () => {
    const report = auditStageBudget({
      pathEstimatedHours: 3,
      upstreamBudgetHours: 3,
      stages: [{ stageNumber: 1, estimatedHours: 3 }],
    });
    expect(report.ok).toBe(true);
    expect(report.violations).toEqual([]);
  });

  it('容量超载是信息项：单独出现时仍算通过（可见但不判失败）', () => {
    const report = auditStageBudget({
      pathEstimatedHours: 30,
      stages: [
        { stageNumber: 1, estimatedHours: 12 },
        { stageNumber: 2, estimatedHours: 18 },
      ],
      capacityMinutes: 600, // 10 小时容量 vs 30 小时计划
    });
    expect(report.violations.map((v) => v.kind)).toEqual(['capacity_overload']);
    expect(report.ok).toBe(true);
  });
});
