/**
 * 记忆痕迹服务（记忆引擎 M2）
 *
 * 持久化层：memory_traces 表（userId × conceptKey 唯一）承载 ACT-R 幂律衰减模型。
 * - recordExtraction：每次提取/复习/课后评估更新痕迹（extractionCount+1、lastSeenAt、masteryScore）
 * - recordSessionOutcome：endSession 后按知识看板状态确定性回写内化强度（零 LLM）
 * - getDueTraces：惰性检查到期复习点（保留率阈值 / 计划间隔）
 * - getRetentionSnapshot：读取时计算保留率快照
 */
import prisma from '../../config/database';
import {
  reviewIntervalDays,
  clamp01,
  DEFAULT_RETENTION_THRESHOLD,
} from './actr';
import {
  fsrsSchedule,
  fsrsStateFromLegacy,
  fsrsEmptyState,
  fsrsRetrievability,
  type FsrsGradeCode,
  type FsrsMemoryState,
} from './fsrs';
import { getActiveForConcepts } from '../learner/misconception-ledger.service';

/** FSRS 统一保留率（#8 legacy 退役）：trace 有 FSRS 状态用 FSRS，否则 fsrsStateFromLegacy 推导 */
function fsrsRetentionOfTrace(
  trace: {
    fsrsStability: number | null;
    fsrsDifficulty: number | null;
    masteryScore: number;
    extractionCount: number;
    lastSeenAt: Date | null;
  },
  now: Date,
): number {
  if (!trace.lastSeenAt) return 1;
  const state: FsrsMemoryState = trace.fsrsStability !== null && trace.fsrsStability !== undefined
    ? {
        stability: trace.fsrsStability,
        difficulty: trace.fsrsDifficulty ?? 5,
        reps: trace.extractionCount,
        lapses: 0,
        lastReviewAt: trace.lastSeenAt,
      }
    : fsrsStateFromLegacy(trace.masteryScore, trace.extractionCount, trace.lastSeenAt);
  return fsrsRetrievability(state, now);
}

/** FSRS 间隔展示（#8 legacy 退役）：stability 天（有 FSRS 状态用 FSRS，否则 legacy 推导） */
function fsrsIntervalDaysOfTrace(
  trace: { fsrsStability: number | null; masteryScore: number; extractionCount: number; lastSeenAt: Date | null },
): number {
  if (trace.fsrsStability !== null && trace.fsrsStability !== undefined) {
    return Math.max(1, Math.round(trace.fsrsStability));
  }
  const state = fsrsStateFromLegacy(trace.masteryScore, trace.extractionCount, trace.lastSeenAt);
  return Math.max(1, Math.round(state.stability));
}

export type MemoryStability = 'unknown' | 'fragile' | 'developing' | 'stable';

const ALLOWED_STABILITY: MemoryStability[] = ['unknown', 'fragile', 'developing', 'stable'];

const DAY_MS = 24 * 60 * 60 * 1000;

export interface MemoryTraceInput {
  userId: string;
  conceptKey: string;
  label?: string | null;
  masteryScore: number;
  stability?: MemoryStability;
  source?: string;
  /** 下次到期时间（物化 dueAt；缺省按 ACT-R 间隔规则计算） */
  dueAt?: Date | null;
  /** 复习间隔因子（用于计算 dueAt；默认沿用现有 intervalFactor 语义） */
  intervalFactor?: number;
  /** FSRS 复习成绩（Again/Hard/Good/Easy）；提供时走 FSRS-6 DSR 调度，否则走 legacy ACT-R */
  fsrsGrade?: FsrsGradeCode;
}

export interface SessionKnowledgeOutcome {
  name: string;
  status: 'pending' | 'learning' | 'mastered' | 'review';
  progress: number;
}

/** knowledgeState 状态 → 内化强度（确定性映射，零 LLM；与 LearnerKnowledgeMemoryService 语义对齐） */
export function mapKnowledgeStatusToMastery(
  status: SessionKnowledgeOutcome['status'],
  progress: number,
  calibrationBias: 'overconfident' | 'accurate' | 'underconfident' = 'accurate',
): { masteryScore: number; stability: MemoryStability } {
  const p = Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0;
  let score: number;
  let stability: MemoryStability;
  switch (status) {
    case 'mastered':
      score = p >= 100 ? 0.9 : 0.85;
      stability = 'stable';
      break;
    case 'review':
      score = 0.5;
      stability = 'fragile';
      break;
    case 'learning':
      score = 0.35;
      stability = 'developing';
      break;
    case 'pending':
      score = 0.2;
      stability = 'unknown';
      break;
    default:
      score = 0.3;
      stability = 'developing';
      break;
  }
  // 元认知校准闭环：overconfident → 降权（自报掌握度不可信），underconfident → 微升
  if (calibrationBias === 'overconfident') score = Math.max(0.1, score - 0.1);
  else if (calibrationBias === 'underconfident') score = Math.min(0.95, score + 0.05);
  return { masteryScore: score, stability };
}

class MemoryTraceService {
  /** 默认睡眠窗口（保守估计：23:00-07:00），dueAt 不落在该区间内 */
  private static readonly SLEEP_START_HOUR = 23;
  private static readonly SLEEP_END_HOUR = 7;
  /** 活跃窗口起始（上午 9 点），dueAt 过早时锚定到此 */
  private static readonly ACTIVE_START_HOUR = 9;

  /** 将 dueAt 锚定到活跃窗口：跳过睡眠区间（23-07），不足 1 天时保证至少跨 1 个睡眠周期 */
  private snapToActiveWindow(dueAt: Date, now: Date, isFirstExtraction: boolean): Date {
    const due = new Date(dueAt);
    const hour = due.getHours();
    // 落在睡眠窗口 → 推到次日早晨
    if (hour >= MemoryTraceService.SLEEP_START_HOUR || hour < MemoryTraceService.SLEEP_END_HOUR) {
      due.setHours(MemoryTraceService.ACTIVE_START_HOUR, 0, 0, 0);
      if (hour >= MemoryTraceService.SLEEP_START_HOUR) {
        due.setDate(due.getDate() + 1);
      }
    }
    // 首次提取：确保至少跨 1 个睡眠周期（Rasch & Born 2013, Gais 2006）
    if (isFirstExtraction) {
      const minDue = new Date(now);
      minDue.setDate(minDue.getDate() + 1);
      minDue.setHours(MemoryTraceService.ACTIVE_START_HOUR, 0, 0, 0);
      if (due < minDue) return minDue;
    }
    return due;
  }

  /** 计算下次到期时间：now + intervalDays（ACT-R Cepeda 15% × factor），加睡眠窗口锚定 */
  private computeDueAt(input: MemoryTraceInput, now: Date, isFirstExtraction = false): Date | null {
    if (input.dueAt) return input.dueAt;
    const factor = Number.isFinite(input.intervalFactor) && (input.intervalFactor as number) > 0
      ? (input.intervalFactor as number)
      : 1;
    const intervalDays = reviewIntervalDays(DEFAULT_RETENTION_TARGET_DAYS, factor);
    const rawDue = new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000);
    return this.snapToActiveWindow(rawDue, now, isFirstExtraction);
  }

  /** 记录一次提取/评估：upsert 痕迹并累计提取次数；提供 fsrsGrade 时走 FSRS-6 DSR 调度 */
  async recordExtraction(input: MemoryTraceInput): Promise<void> {
    const masteryScore = clamp01(input.masteryScore);
    const stability = ALLOWED_STABILITY.includes(input.stability as MemoryStability)
      ? (input.stability as MemoryStability)
      : 'developing';
    const now = new Date();
    let dueAt = this.computeDueAt(input, now, false);  // legacy: 保守不判首次
    let fsrsStability: number | null = null;
    let fsrsDifficulty: number | null = null;

    if (input.fsrsGrade !== undefined) {
      const existing = await this.getTrace(input.userId, input.conceptKey);
      const isFirstExtraction = !existing || existing.extractionCount === 0;
      const prev: FsrsMemoryState | null = existing
        ? (existing.fsrsStability !== null && existing.fsrsStability !== undefined
          ? {
              stability: existing.fsrsStability,
              difficulty: existing.fsrsDifficulty ?? 5,
              reps: existing.extractionCount,
              lapses: 0,
              lastReviewAt: existing.lastSeenAt,
            }
          : fsrsStateFromLegacy(existing.masteryScore, existing.extractionCount, existing.lastSeenAt))
        : fsrsEmptyState();
      const result = fsrsSchedule(prev, input.fsrsGrade, now);
      fsrsStability = result.state.stability;
      fsrsDifficulty = result.state.difficulty;
      const rawDue = new Date(now.getTime() + result.intervalDays * DAY_MS);
      dueAt = this.snapToActiveWindow(rawDue, now, isFirstExtraction);
    }

    await prisma.memory_traces.upsert({
      where: {
        userId_conceptKey: { userId: input.userId, conceptKey: input.conceptKey },
      },
      create: {
        id: `mt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        userId: input.userId,
        conceptKey: input.conceptKey,
        label: input.label ?? null,
        masteryScore,
        stability,
        lastSeenAt: now,
        extractionCount: 1,
        source: input.source ?? 'derived',
        dueAt,
        fsrsStability,
        fsrsDifficulty,
      },
      update: {
        label: input.label ?? undefined,
        masteryScore,
        stability,
        lastSeenAt: now,
        extractionCount: { increment: 1 },
        source: input.source ?? undefined,
        dueAt,
        ...(fsrsStability !== null ? { fsrsStability } : {}),
        ...(fsrsDifficulty !== null ? { fsrsDifficulty } : {}),
      },
    });
  }

  /** endSession 后按知识看板状态确定性回写内化强度 */
  async recordSessionOutcome(
    userId: string,
    items: SessionKnowledgeOutcome[],
    source = 'derived',
    calibrationBias: 'overconfident' | 'accurate' | 'underconfident' = 'accurate',
  ): Promise<number> {
    let count = 0;
    for (const item of items) {
      if (!item?.name || !String(item.name).trim()) continue;
      const { masteryScore, stability } = mapKnowledgeStatusToMastery(item.status, item.progress, calibrationBias);
      await this.recordExtraction({
        userId,
        conceptKey: String(item.name).trim(),
        masteryScore,
        stability,
        source,
      });
      count += 1;
    }
    return count;
  }

  /** 惰性检查：返回当前到期的复习痕迹（保留率升序，最紧急在前） */
  async getDueTraces(
    userId: string,
    options: {
      retentionTargetDays?: number;
      retentionThreshold?: number;
      now?: Date;
      limit?: number;
    } = {},
  ): Promise<Array<{
    conceptKey: string;
    label: string | null;
    masteryScore: number;
    stability: MemoryStability;
    lastSeenAt: Date | null;
    extractionCount: number;
    retention: number;
    intervalDays: number;
    reason: 'below-threshold' | 'interval-elapsed' | 'never-seen' | 'not-due';
  }>> {
    const now = options.now ?? new Date();
    const retentionTargetDays = Number.isFinite(options.retentionTargetDays)
      ? (options.retentionTargetDays as number)
      : DEFAULT_RETENTION_TARGET_DAYS;
    const threshold = Number.isFinite(options.retentionThreshold)
      ? clamp01(options.retentionThreshold!)
      : DEFAULT_RETENTION_THRESHOLD;
    const limit = Number.isInteger(options.limit) && (options.limit as number) > 0 ? options.limit : 20;

    // 断链修复 P0-6：优先 SQL 直查 dueAt <= now（物化到期），解决全表扫；
    // 老数据 dueAt 为 null 的仍走惰性 isReviewDue 兜底合并。
    const [materialized, legacy] = await Promise.all([
      prisma.memory_traces.findMany({
        where: { userId, dueAt: { lte: now } },
        orderBy: { dueAt: 'asc' },
      }),
      prisma.memory_traces.findMany({
        where: { userId, dueAt: null },
        orderBy: { lastSeenAt: 'desc' },
      }),
    ]);

    const due = [
      ...materialized.map((trace) => ({
        conceptKey: trace.conceptKey,
        label: trace.label,
        masteryScore: trace.masteryScore,
        stability: trace.stability as MemoryStability,
        lastSeenAt: trace.lastSeenAt,
        extractionCount: trace.extractionCount,
        retention: fsrsRetentionOfTrace(trace, now),
        intervalDays: fsrsIntervalDaysOfTrace(trace),
        reason: 'interval-elapsed' as const,
      })),
      ...legacy
        .map((trace) => {
          const retention = fsrsRetentionOfTrace(trace, now);
          if (!trace.lastSeenAt) return null; // never-seen：从未提取不判到期
          if (retention >= threshold) return null; // 保留率未跌破阈值
          return {
            conceptKey: trace.conceptKey,
            label: trace.label,
            masteryScore: trace.masteryScore,
            stability: trace.stability as MemoryStability,
            lastSeenAt: trace.lastSeenAt,
            extractionCount: trace.extractionCount,
            retention,
            intervalDays: fsrsIntervalDaysOfTrace(trace),
            reason: 'below-threshold' as const,
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null),
    ]
      .sort((a, b) => a.retention - b.retention)
      .slice(0, limit);

    return due;
  }

  /** 保留率快照（读取时计算，不落库） */
  async getRetentionSnapshot(
    userId: string,
    now: Date = new Date(),
  ): Promise<Array<{
    conceptKey: string;
    label: string | null;
    masteryScore: number;
    stability: MemoryStability;
    lastSeenAt: Date | null;
    extractionCount: number;
    retention: number;
  }>> {
    const traces = await prisma.memory_traces.findMany({
      where: { userId },
      orderBy: { lastSeenAt: 'desc' },
    });
    return traces.map((trace) => ({
      conceptKey: trace.conceptKey,
      label: trace.label,
      masteryScore: trace.masteryScore,
      stability: trace.stability as MemoryStability,
      lastSeenAt: trace.lastSeenAt,
      extractionCount: trace.extractionCount,
      retention: fsrsRetentionOfTrace(trace, now),
    }));
  }

  async getTrace(userId: string, conceptKey: string) {    return prisma.memory_traces.findUnique({
      where: { userId_conceptKey: { userId, conceptKey } },
    });
  }

  /**
   * θ−d 知识状态 EMA：将 teaching-turn 的 ktEstimate.conceptMastery 以 α=0.2 滑动平均
   * 累积进 memory_traces.ktMasteryEma（跨会话知识状态的确定性通道，替代每轮 LLM 独立估计）。
   * 只更新 ktMasteryEma，不触碰 extractionCount/lastSeenAt/FSRS 状态（不干扰复习调度）。
   */
  async applyKtEstimate(
    userId: string,
    items: Array<{ conceptKey: string; mastery: number }>,
  ): Promise<void> {
    if (!items || items.length === 0) return;
    const ALPHA = 0.2;
    const now = new Date();
    for (const item of items) {
      const key = String(item.conceptKey || '').trim();
      if (!key) continue;
      const mastery = Number.isFinite(item.mastery) ? Math.max(0, Math.min(1, item.mastery)) : null;
      if (mastery === null) continue;
      const existing = await this.getTrace(userId, key);
      if (existing) {
        const prev = existing.ktMasteryEma ?? existing.masteryScore;
        const ema = Number.isFinite(prev) ? ALPHA * mastery + (1 - ALPHA) * (prev as number) : mastery;
        await prisma.memory_traces.updateMany({
          where: { userId, conceptKey: key },
          data: { ktMasteryEma: ema },
        });
      } else {
        // 无痕迹也记录 EMA（独立于 ACT-R/FSRS 调度的知识状态通道）
        await prisma.memory_traces.create({
          data: {
            id: `mt_${now.getTime()}_${Math.random().toString(36).slice(2, 10)}`,
            userId,
            conceptKey: key,
            masteryScore: 0.3,
            stability: 'unknown',
            ktMasteryEma: mastery,
            extractionCount: 0,
            source: 'kt-estimate',
          },
        });
      }
    }
  }

  /**
   * FSRS-6 调度更新：复习成功后按成绩更新 FSRS 状态（Dsr 稳定性/难度）；grade 未提供时走 legacy SM-2 ×2。
   */
  async bumpReviewInterval(userId: string, conceptKey: string, grade?: FsrsGradeCode): Promise<void> {
    if (grade !== undefined) {
      const trace = await this.getTrace(userId, conceptKey);
      if (!trace) return;
      const prev: FsrsMemoryState = trace.fsrsStability !== null && trace.fsrsStability !== undefined
        ? {
            stability: trace.fsrsStability,
            difficulty: trace.fsrsDifficulty ?? 5,
            reps: trace.extractionCount,
            lapses: 0,
            lastReviewAt: trace.lastSeenAt,
          }
        : fsrsStateFromLegacy(trace.masteryScore, trace.extractionCount, trace.lastSeenAt);
      const now = new Date();
      const result = fsrsSchedule(prev, grade, now);
      // 语义干扰矩阵：活跃误解 → 稳定性降低（下次复习更早，对比式纠错）
      const activeMisconceptions = await getActiveForConcepts(userId, [conceptKey], 1);
      const interferenceMultiplier = activeMisconceptions.length > 0 ? 0.85 : 1;
      const adjustedStability = result.state.stability * interferenceMultiplier;
      const rawDue = new Date(now.getTime() + Math.round(result.intervalDays * interferenceMultiplier) * DAY_MS);
      const isFirstExtraction = trace.extractionCount === 0;
      await prisma.memory_traces.updateMany({
        where: { userId, conceptKey },
        data: {
          fsrsStability: adjustedStability,
          fsrsDifficulty: result.state.difficulty,
          dueAt: this.snapToActiveWindow(rawDue, now, isFirstExtraction),
        },
      });
      return;
    }
    // legacy SM-2（intervalFactor ×2）已退役：FSRS 已全面接管，无 grade 时不再更新 legacy 间隔因子。
    // 唯一调用方 SessionFinalizationService 已恒传 grade，此分支为死代码。
  }
}

/** 默认复习目标保留时间（天）：路径跨度的保守估计，调用方可按路径时长覆盖 */
export const DEFAULT_RETENTION_TARGET_DAYS = 7;

export const memoryTraceService = new MemoryTraceService();
