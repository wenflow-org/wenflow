/**
 * 难度调整的留痕与效果度量（闭环的最后一环）
 *
 * 问题：`TaskDifficultyAdjustmentService` 只会"决定"，不回答"有没有用"。
 * 这里把每次调整留痕（锚点），再与**该路径的下一条状态**对账。
 *
 * 口径（已确认的默认口径）：
 * - **主指标**：下一条同路径状态**不再触发同类降档理由** = `relieved`；
 * - **辅指标**：`lsb` 是否回升、`lf` 是否回落（数值直接给出，不做判定）；
 * - **诚实边界**：知识类理由（fragile/struggling/prerequisite_gaps）需要学习者快照才能复算，
 *   这里只度量**可由指标复算**的三条（`METRIC_BASED_REASONS`），其余标注 `not_measurable`
 *   而不是假装度量过。
 *
 * 留痕落在 `learner_evidence`（`evidenceType=task:difficulty:adjustment`），
 * 以 `(taskId, evidenceKey)` 幂等：同一任务反复判定不会产生重复锚点。
 */
import prisma from '../../config/database';
import learningStateService from '../learning/learning-state.service';
import type { TaskDifficultyAdjustment } from './TaskDifficultyAdjustmentService';
import { LOAD_BASED_DECREASE_REASONS } from './TaskDifficultyAdjustmentService';

export const ADJUSTMENT_EVIDENCE_TYPE = 'task:difficulty:adjustment';
export const ADJUSTMENT_EVIDENCE_KEY = 'difficulty-adjustment';

/** 可由指标复算的降档理由（= 判定器里的负荷类理由；单一事实源在 TaskDifficultyAdjustmentService） */
export const METRIC_BASED_REASONS = LOAD_BASED_DECREASE_REASONS;

export interface TaskDifficultyMetricsSnapshot {
  lss: number;
  ktl: number;
  lf: number;
  lsb: number;
}

export interface TaskDifficultyAdjustmentRecord {
  userId: string;
  taskId: string;
  pathId: string | null;
  milestoneId?: string | null;
  sessionId?: string | null;
  /** 判定发生的时刻（锚点时间：本节课开始前） */
  occurredAt: Date;
  baseline: number;
  adjusted: number;
  direction: TaskDifficultyAdjustment['direction'];
  reasons: string[];
  /** 是否真的按调整后的难度执行了本次任务（false = 对照：只判定不执行） */
  applied: boolean;
  evidence: Record<string, unknown>;
}

export function serializeAdjustment(record: TaskDifficultyAdjustmentRecord): string {
  return JSON.stringify({
    baseline: record.baseline,
    adjusted: record.adjusted,
    direction: record.direction,
    reasons: record.reasons,
    applied: record.applied,
    evidence: record.evidence,
  });
}

export function parseAdjustment(payload: string | null | undefined): Omit<TaskDifficultyAdjustmentRecord, 'userId' | 'taskId' | 'pathId' | 'occurredAt'> | null {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      baseline: Number(parsed.baseline) || 0,
      adjusted: Number(parsed.adjusted) || 0,
      direction: parsed.direction || 'keep',
      reasons: Array.isArray(parsed.reasons) ? parsed.reasons.map(String) : [],
      applied: parsed.applied === true,
      evidence: parsed.evidence && typeof parsed.evidence === 'object' ? parsed.evidence : {},
    };
  } catch {
    return null;
  }
}

/** 幂等留痕：同一任务只保留一条锚点 */
export async function recordTaskDifficultyAdjustment(
  record: TaskDifficultyAdjustmentRecord
): Promise<void> {
  await prisma.learner_evidence.upsert({
    where: { eventId_evidenceKey: { eventId: record.taskId, evidenceKey: ADJUSTMENT_EVIDENCE_KEY } },
    create: {
      id: `ev_adj_${record.taskId}`,
      eventId: record.taskId,
      evidenceKey: ADJUSTMENT_EVIDENCE_KEY,
      userId: record.userId,
      pathId: record.pathId,
      milestoneId: record.milestoneId ?? null,
      taskId: record.taskId,
      sessionId: record.sessionId ?? null,
      evidenceType: ADJUSTMENT_EVIDENCE_TYPE,
      payload: serializeAdjustment(record),
      confidence: 1,
      occurredAt: record.occurredAt,
    },
    update: {
      pathId: record.pathId,
      milestoneId: record.milestoneId ?? null,
      sessionId: record.sessionId ?? null,
      payload: serializeAdjustment(record),
      occurredAt: record.occurredAt,
    },
  });
}

export async function listTaskDifficultyAdjustments(input: {
  userId: string;
  pathId?: string | null;
  since?: Date;
}): Promise<TaskDifficultyAdjustmentRecord[]> {
  const rows = await prisma.learner_evidence.findMany({
    where: {
      userId: input.userId,
      evidenceType: ADJUSTMENT_EVIDENCE_TYPE,
      ...(input.pathId ? { pathId: input.pathId } : {}),
      ...(input.since ? { occurredAt: { gte: input.since } } : {}),
    },
    orderBy: { occurredAt: 'asc' },
    select: { userId: true, taskId: true, pathId: true, milestoneId: true, sessionId: true, occurredAt: true, payload: true },
  });
  return rows.flatMap((row) => {
    const parsed = parseAdjustment(row.payload);
    if (!parsed || !row.taskId) return [];
    return [{
      userId: row.userId,
      taskId: row.taskId,
      pathId: row.pathId,
      milestoneId: row.milestoneId,
      sessionId: row.sessionId,
      occurredAt: row.occurredAt,
      ...parsed,
    }];
  });
}

/**
 * 用下一条状态复算"同类降档理由是否仍成立"（与判定器同阈值、同层级）：
 * 路径级理由只在拿到**本路径**状态时复算；全局级理由用全局聚合复算。
 */
export function metricReasonsFromState(input: {
  pathState: TaskDifficultyMetricsSnapshot | null;
  globalLf: number | null;
  globalLsb: number | null;
}): string[] {
  const reasons: string[] = [];
  if (input.pathState) {
    if (input.pathState.lss >= 6) reasons.push('lesson_stress_high');
    if (input.pathState.lf >= 6 || input.pathState.lsb < 0) reasons.push('path_load_unbalanced');
  }
  if (input.globalLf != null && input.globalLf >= 6) reasons.push('fatigue_high');
  if (!input.pathState && input.globalLsb != null && input.globalLsb < 0) reasons.push('global_imbalance');
  return reasons;
}

export type AdjustmentOutcome = 'relieved' | 'still_triggered' | 'not_measurable' | 'no_next_state';

export interface AdjustmentEffect {
  taskId: string;
  pathId: string | null;
  /** 本次调整的难度（基线 → 调整后） */
  baseline: number;
  adjusted: number;
  reasons: string[];
  measurableReasons: string[];
  applied: boolean;
  outcome: AdjustmentOutcome;
  stillTriggeredReasons: string[];
  /** 锚点当时的本路径状态（来自锚点证据） */
  lsbBefore: number | null;
  lfBefore: number | null;
  /** 下一条同路径状态 */
  lsbAfter: number | null;
  lfAfter: number | null;
  lsbDelta: number | null;
  lfDelta: number | null;
  nextTaskId: string | null;
  nextAt: Date | null;
}

const round = (value: number) => Math.round(value * 1000) / 1000;

export function evaluateAdjustmentEffect(input: {
  record: TaskDifficultyAdjustmentRecord;
  nextState: { metrics: TaskDifficultyMetricsSnapshot; taskId: string | null; calculatedAt: Date } | null;
  /** 复算路径级理由用的"本路径"状态（有路径时 = nextState.metrics） */
  nextPathState: TaskDifficultyMetricsSnapshot | null;
  globalLfAtNextState: number | null;
  globalLsbAtNextState: number | null;
}): AdjustmentEffect {
  const { record, nextState } = input;
  const measurableReasons = record.reasons.filter((reason) =>
    (METRIC_BASED_REASONS as readonly string[]).includes(reason)
  );
  const evidence = record.evidence as { lessonLss?: number; lessonLf?: number; lessonLsb?: number } | undefined;
  const lsbBefore = typeof evidence?.lessonLsb === 'number' ? evidence.lessonLsb : null;
  const lfBefore = typeof evidence?.lessonLf === 'number' ? evidence.lessonLf : null;

  const base = {
    taskId: record.taskId,
    pathId: record.pathId,
    baseline: record.baseline,
    adjusted: record.adjusted,
    reasons: record.reasons,
    measurableReasons,
    applied: record.applied,
    lsbBefore,
    lfBefore,
  };

  if (measurableReasons.length === 0) {
    return {
      ...base,
      outcome: 'not_measurable',
      stillTriggeredReasons: [],
      lsbAfter: null, lfAfter: null, lsbDelta: null, lfDelta: null,
      nextTaskId: null, nextAt: null,
    };
  }
  if (!nextState) {
    return {
      ...base,
      outcome: 'no_next_state',
      stillTriggeredReasons: [],
      lsbAfter: null, lfAfter: null, lsbDelta: null, lfDelta: null,
      nextTaskId: null, nextAt: null,
    };
  }

  const nowReasons = metricReasonsFromState({
    pathState: input.nextPathState,
    globalLf: input.globalLfAtNextState,
    globalLsb: input.globalLsbAtNextState,
  });
  const stillTriggeredReasons = measurableReasons.filter((reason) => nowReasons.includes(reason));

  return {
    ...base,
    outcome: stillTriggeredReasons.length === 0 ? 'relieved' : 'still_triggered',
    stillTriggeredReasons,
    lsbAfter: nextState.metrics.lsb,
    lfAfter: nextState.metrics.lf,
    lsbDelta: lsbBefore == null ? null : round(nextState.metrics.lsb - lsbBefore),
    lfDelta: lfBefore == null ? null : round(nextState.metrics.lf - lfBefore),
    nextTaskId: nextState.taskId,
    nextAt: nextState.calculatedAt,
  };
}

export interface AdjustmentEffectGroup {
  reason: string;
  applied: boolean;
  total: number;
  relieved: number;
  stillTriggered: number;
  relievedRate: number;
  avgLsbDelta: number | null;
  avgLfDelta: number | null;
}

export function summarizeAdjustmentEffects(effects: AdjustmentEffect[]): AdjustmentEffectGroup[] {
  const groups = new Map<string, AdjustmentEffectGroup>();
  for (const effect of effects) {
    if (effect.outcome === 'not_measurable' || effect.outcome === 'no_next_state') continue;
    for (const reason of effect.measurableReasons) {
      const key = `${reason}|${effect.applied}`;
      const group = groups.get(key) || {
        reason, applied: effect.applied, total: 0, relieved: 0, stillTriggered: 0, relievedRate: 0,
        avgLsbDelta: null, avgLfDelta: null,
      };
      group.total += 1;
      if (effect.outcome === 'relieved') group.relieved += 1;
      else group.stillTriggered += 1;
      groups.set(key, group);
    }
  }
  return [...groups.values()].map((group) => {
    const matching = effects.filter((effect) =>
      effect.measurableReasons.includes(group.reason) && effect.applied === group.applied
      && effect.outcome !== 'not_measurable' && effect.outcome !== 'no_next_state'
    );
    const lsbDeltas = matching.map((effect) => effect.lsbDelta).filter((value): value is number => value != null);
    const lfDeltas = matching.map((effect) => effect.lfDelta).filter((value): value is number => value != null);
    const avg = (values: number[]) => values.length === 0 ? null : round(values.reduce((sum, value) => sum + value, 0) / values.length);
    return {
      ...group,
      relievedRate: group.total === 0 ? 0 : round(group.relieved / group.total),
      avgLsbDelta: avg(lsbDeltas),
      avgLfDelta: avg(lfDeltas),
    };
  }).sort((a, b) => a.reason.localeCompare(b.reason) || Number(b.applied) - Number(a.applied));
}

/** 读取锚点 + 各自的下一条同路径状态 → 度量结果 */
export async function measureTaskDifficultyEffects(input: {
  userId: string;
  pathId?: string | null;
  since?: Date;
}): Promise<{ effects: AdjustmentEffect[]; groups: AdjustmentEffectGroup[] }> {
  const records = await listTaskDifficultyAdjustments(input);
  const effects: AdjustmentEffect[] = [];

  for (const record of records) {
    const nextRow = await prisma.learning_metrics.findFirst({
      where: {
        userId: record.userId,
        metricType: 'learning_state',
        calculatedAt: { gte: record.occurredAt },
        ...(record.pathId ? { pathId: record.pathId } : {}),
      },
      orderBy: { calculatedAt: 'asc' },
      select: { lss: true, ktl: true, lf: true, lsb: true, taskId: true, calculatedAt: true },
    });
    const nextState = nextRow
      ? {
          metrics: {
            lss: Number(nextRow.lss) || 0,
            ktl: Number(nextRow.ktl) || 0,
            lf: Number(nextRow.lf) || 0,
            lsb: Number(nextRow.lsb) || 0,
          },
          taskId: nextRow.taskId,
          calculatedAt: nextRow.calculatedAt,
        }
      : null;
    const aggregate = nextState
      ? await learningStateService.getAggregatedState(record.userId, { asOf: nextState.calculatedAt })
      : null;

    const nextPathState = record.pathId && nextState ? nextState.metrics : null;
    effects.push(evaluateAdjustmentEffect({
      record,
      nextState,
      nextPathState,
      globalLfAtNextState: aggregate ? aggregate.metrics.lf : null,
      globalLsbAtNextState: aggregate ? aggregate.metrics.lsb : null,
    }));
  }

  return { effects, groups: summarizeAdjustmentEffects(effects) };
}
