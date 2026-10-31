/**
 * core 里程碑学时硬夹（2026-10-27 外部审查，R9 候选提前）。
 *
 * 背景：R7 冒烟实证 E02——planningHints 目标 12h，path-planning core 却排出 23.9h
 * （单阶段 9h）。stageDesign 拿到的是 milestone 自身学时，于是 540 分钟预算下发，
 * 膨胀一路传导到任务层。此前服务层只夹 stage 分钟，不夹 core 的 milestone 学时。
 *
 * 纪律：只下压不上抬；sum > target×1.15 时按 target/sum 等比缩放（每阶段保底 0.5h）。
 * target 缺失/0 时零行为变化。
 */
import { logger } from '../../../utils/logger';

/** 生成入参里与本函数相关的最小形状（planningHints 可能出现在三处；其余字段不关心，缺字段容忍）。 */
interface TargetHoursPlanningInput {
  planningHints?: { targetTotalHours?: unknown } | null;
}
interface TargetHoursProfile {
  normalizedInput?: TargetHoursPlanningInput | null;
  pathSceneFraming?: { normalizedInput?: TargetHoursPlanningInput | null } | null;
  pathSceneFramingInput?: TargetHoursPlanningInput | null;
}

/** 从生成入参里取目标总学时（planningHints 在定帧快照或编排快照里，两处都兼容）。 */
export function resolveTargetTotalHoursFromData(data: unknown): number | null {
  const profile = (data as { userProfile?: TargetHoursProfile | null } | null | undefined)?.userProfile || {};
  const candidates = [
    profile?.normalizedInput?.planningHints?.targetTotalHours,
    profile?.pathSceneFraming?.normalizedInput?.planningHints?.targetTotalHours,
    profile?.pathSceneFramingInput?.planningHints?.targetTotalHours,
  ];
  for (const candidate of candidates) {
    const n = Number(candidate);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

export function clampMilestoneHoursToBudget<T extends { estimatedHours?: unknown }>(
  milestones: T[],
  targetTotalHours: number | null,
): { milestones: T[]; info: { before: number; after: number; scaled: boolean } | null } {
  if (!targetTotalHours || targetTotalHours <= 0) return { milestones, info: null };
  const round1 = (v: number): number => Math.round(v * 10) / 10;
  const sum = milestones.reduce((acc, m) => acc + (Number(m?.estimatedHours) || 0), 0);
  if (!(sum > targetTotalHours * 1.15)) {
    return { milestones, info: { before: round1(sum), after: round1(sum), scaled: false } };
  }
  const scale = targetTotalHours / sum;
  const scaled = milestones.map((m) => ({
    ...m,
    estimatedHours: Math.max(0.5, round1((Number(m?.estimatedHours) || 0) * scale)),
  }));
  const after = scaled.reduce((acc, m) => acc + (Number(m?.estimatedHours) || 0), 0);
  return { milestones: scaled as T[], info: { before: round1(sum), after: round1(after), scaled: true } };
}

/** persistGeneratedPath 用的一体化入口：按 data 里的目标学时夹取并留痕（调用点保持一行）。 */
export function clampMilestonesWithLog<T>(milestones: T[], data: unknown, runId?: string): T[] {
  const targetTotalHours = resolveTargetTotalHoursFromData(data);
  const result = clampMilestoneHoursToBudget(
    milestones as unknown as Array<{ estimatedHours?: unknown }>,
    targetTotalHours,
  );
  if (result.info?.scaled) {
    logger.warn('[path-budget-clamp] core 里程碑学时超目标，已等比夹取', {
      runId,
      beforeHours: result.info.before,
      afterHours: result.info.after,
      targetHours: targetTotalHours,
    });
  }
  return result.milestones as unknown as T[];
}
