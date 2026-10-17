/**
 * 阶段预算不变量（#56 / I3）：阶段预算必须**按内容反推**，不能恒等复制上游总量。
 *
 * 现状病灶（HORIZONTAL-EXPANSION 审计）：某些路径的每个阶段 `estimatedHours` 都等于目标层给出的
 * 总预算（或阶段之间完全等分），阶段层的「按本阶段内容估时」退化成了复制；同时容量对表算出的
 * 可用时间只落日志，没有回灌到预算。结果：读者看到的是一份「总量看着对、阶段全一样」的计划。
 *
 * 本模块只做**可见化**（纯函数）：把退化形态判成 violations，由生成链 warn 并落 aiPromptTemplate，
 * 由 `scripts/audit-stage-budget.ts` 对存量路径出比例。修法（怎么分配）是产品决策，不在本模块里替它决定。
 */
export interface StageBudgetInvariantStage {
  stageNumber: number;
  title?: string | null;
  estimatedHours: number | null | undefined;
}

export interface StageBudgetInvariantInput {
  /** 路径落库的总学时（阶段回写后的汇总） */
  pathEstimatedHours?: number | null;
  /** 上游（目标层）给出的总预算；缺省视为与 pathEstimatedHours 同值 */
  upstreamBudgetHours?: number | null;
  stages: StageBudgetInvariantStage[];
  /** 容量对表：学习者可用时间（分钟）。给出且路径总量超出时记 capacity_overload。 */
  capacityMinutes?: number | null;
  /** 总量超出容量的容忍比（默认 1.05，与 stage-enrichment 口径一致） */
  capacityTolerance?: number;
}

export type StageBudgetViolationKind =
  | 'stage_equals_upstream'
  | 'all_stages_identical'
  | 'stage_hours_missing'
  | 'stage_sum_mismatch'
  | 'capacity_overload';

export interface StageBudgetViolation {
  kind: StageBudgetViolationKind;
  stageNumber?: number;
  detail: string;
}

export interface StageBudgetInvariantReport {
  ok: boolean;
  stageCount: number;
  totalStageHours: number;
  upstreamBudgetHours: number | null;
  violations: StageBudgetViolation[];
}

const HOURS_EPSILON = 1e-6;

export function auditStageBudget(input: StageBudgetInvariantInput): StageBudgetInvariantReport {
  const stages = Array.isArray(input.stages) ? input.stages : [];
  const upstream = Number.isFinite(Number(input.upstreamBudgetHours))
    ? Number(input.upstreamBudgetHours)
    : (Number.isFinite(Number(input.pathEstimatedHours)) ? Number(input.pathEstimatedHours) : null);
  const violations: StageBudgetViolation[] = [];

  const hours = stages.map((stage) => {
    const value = Number(stage.estimatedHours);
    return Number.isFinite(value) && value > 0 ? value : null;
  });
  const totalStageHours = Math.round(hours.reduce((sum, value) => sum + (value || 0), 0) * 100) / 100;

  // 单阶段路径（含一次性操作）：阶段=总量是正确形态，不判退化
  const multiStage = stages.length >= 2;

  for (let i = 0; i < stages.length; i += 1) {
    const value = hours[i];
    if (value === null) {
      violations.push({
        kind: 'stage_hours_missing',
        stageNumber: stages[i].stageNumber,
        detail: `阶段 ${stages[i].stageNumber} 没有可用的 estimatedHours（0 / null / 非法值）`,
      });
      continue;
    }
    if (multiStage && upstream !== null && upstream > 0 && Math.abs(value - upstream) <= HOURS_EPSILON) {
      violations.push({
        kind: 'stage_equals_upstream',
        stageNumber: stages[i].stageNumber,
        detail: `阶段 ${stages[i].stageNumber} 的 ${value}h 等于上游总预算 ${upstream}h——阶段预算退化成了复制`,
      });
    }
  }

  const distinct = new Set(hours.filter((value): value is number => value !== null));
  // 等分只在「多阶段 + 每阶段超过 1 小时」时才算退化：短路径里每阶段恰好 1 节课（N×1h）是
  // 正常形态（30 条样本里 13 条属此类），把它们算失败只会制造噪音。
  const identicalValue = distinct.size === 1 ? [...distinct][0] : null;
  if (multiStage && identicalValue !== null && identicalValue >= 2 && hours.filter((value) => value !== null).length >= 3) {
    violations.push({
      kind: 'all_stages_identical',
      detail: `全部 ${hours.length} 个阶段同为 ${identicalValue}h——阶段等分，未按内容反推`,
    });
  }

  if (multiStage && totalStageHours > 0 && upstream !== null && upstream > 0) {
    // 阶段汇总与路径总量应一致（阶段回写后 pathEstimatedHours 即汇总）；差 >5% 说明有阶段没写回
    const drift = Math.abs(totalStageHours - upstream) / upstream;
    if (drift > 0.05) {
      violations.push({
        kind: 'stage_sum_mismatch',
        detail: `阶段合计 ${totalStageHours}h 与总量 ${upstream}h 差 ${Math.round(drift * 100)}%（>5%）`,
      });
    }
  }

  const capacity = Number(input.capacityMinutes);
  const tolerance = Number.isFinite(Number(input.capacityTolerance)) ? Number(input.capacityTolerance) : 1.05;
  if (Number.isFinite(capacity) && capacity > 0 && totalStageHours * 60 > capacity * tolerance) {
    violations.push({
      kind: 'capacity_overload',
      detail: `路径总量 ${Math.round(totalStageHours * 60)} 分钟超出可用容量 ${capacity} 分钟的 ${Math.round((totalStageHours * 60 / capacity - 1) * 100)}%`,
    });
  }

  const ok = violations.every((violation) => violation.kind === 'capacity_overload');
  return {
    ok,
    stageCount: stages.length,
    totalStageHours,
    upstreamBudgetHours: upstream,
    violations,
  };
}
