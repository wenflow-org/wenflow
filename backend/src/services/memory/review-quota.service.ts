/**
 * ReviewQuotaService（每日温故配额 · 账本）
 *
 * 动机：会话级负担预算（`review-plan`）只管一节课，管不住"一天上三节课 = 9 次温故"——
 * 一天内反复开课会把当天的温故量放大三倍，正是 Anki 复盘出的"积压被一次性倒出"的翻版。
 * 这里补一个**按天的负担总额度**：跨会话共享，超额的部分**顺延到明天**（留在队列里按急迫度排队，
 * 而不是今天全倒出来）。
 *
 * 边界（刻意不做的事）：
 * - **不改排期**：不重写 memory_traces.dueAt（那属于 FSRS/调度域，由复习结果回写驱动）。
 *   "顺延"在这里 = 按日排队 + 不放大，而不是把到期时间往后挪。
 * - 只记账，不做教学决策：会话预算怎么裁仍由 review-plan 决定，这里只回答"今天还剩多少额度"。
 *
 * 账本落 `learner_projections(scope='review-quota')`，按 (userId, UTC 日期) 幂等；
 * 以 sessionId 去重，重复开课/重试不会重复计数。日期口径与 goal_scheduling_ledger 保持一致（UTC 日）。
 */
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import { simulatedNowOr } from '../virtual-lab/simulation-clock-context';
import { dayKeyOf } from '../time/day-boundary';

/** 每日温故负担上限（负担单位）：≈ 3 节课 × 会话基准预算 2.0 */
export const DEFAULT_DAILY_LOAD_LIMIT = 6.0;
export const REVIEW_DAILY_QUOTA_SCOPE = 'review-quota';
export const REVIEW_DAILY_QUOTA_KEY_PREFIX = 'review-daily-quota-v1';

export interface ReviewDailyQuotaPayload {
  schemaVersion: 'review-daily-quota-v1';
  /** UTC 日期（yyyy-mm-dd），与 goal_scheduling_ledger.date 同口径 */
  date: string;
  userId: string;
  /** 当日上限（记录当时取值，便于事后解释"为什么那天只接了 2 个"） */
  limitLoad: number;
  usedLoad: number;
  usedCount: number;
  sessions: Array<{
    sessionId: string;
    load: number;
    count: number;
    keys: string[];
    at: string;
  }>;
}

export interface ReviewDailyState {
  date: string;
  limitLoad: number;
  usedLoad: number;
  usedCount: number;
  remainingLoad: number;
  /** 当日已接过的概念键（用于同一概念不在一天里重复占额度） */
  reservedKeys: string[];
}

export interface ReviewQuotaDeps {
  read: (projectionKey: string) => Promise<{ payload: string } | null>;
  write: (args: Record<string, unknown>) => Promise<unknown>;
}

const defaultDeps: ReviewQuotaDeps = {
  read: (projectionKey) => prisma.learner_projections.findUnique({
    where: { projectionKey },
    select: { payload: true },
  }) as any,
  write: (args) => prisma.learner_projections.upsert(args as any) as any,
};

/** 当日额度上限：env 可覆盖（`REVIEW_DAILY_LOAD_LIMIT`），非法值回落默认 */
export function resolveDailyLoadLimit(): number {
  const raw = Number(process.env.REVIEW_DAILY_LOAD_LIMIT);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_DAILY_LOAD_LIMIT;
  return Math.min(raw, 100);
}

/** 应用时区（本地日）日期口径；走模拟时钟，与写侧同一口径。日界单一真理源见 services/time/day-boundary。 */
export function quotaDateKey(now: Date = simulatedNowOr()): string {
  return dayKeyOf(now);
}

export function reviewDailyQuotaKey(userId: string, date: string): string {
  return `${REVIEW_DAILY_QUOTA_KEY_PREFIX}:${userId}:${date}`;
}

/**
 * 读当日额度行，带**过渡兼容**：日界从 UTC 切到应用时区本地日（2026-09-22）后，
 * 切换当天新键可能还没有行、而旧 UTC 键存着当天已用额度——此时回退读旧键，
 * 避免"换口径当天额度被重置"。
 */
async function readQuotaRowWithLegacyFallback(
  userId: string,
  date: string,
  now: Date,
  deps: ReviewQuotaDeps,
): Promise<{ payload?: string } | null | undefined> {
  const row = await deps.read(reviewDailyQuotaKey(userId, date));
  if (row?.payload) return row;
  const legacyDate = now.toISOString().slice(0, 10);
  if (legacyDate === date) return row;
  return deps.read(reviewDailyQuotaKey(userId, legacyDate));
}

function emptyState(date: string, limitLoad: number): ReviewDailyState {
  return { date, limitLoad, usedLoad: 0, usedCount: 0, remainingLoad: limitLoad, reservedKeys: [] };
}

/** 读当日额度状态（读不到即"今天还没接过"）。失败也不抛错——配额读不到就退回"按会话预算走"。 */
export async function getDailyState(
  userId: string,
  options: { now?: Date; deps?: ReviewQuotaDeps; limitLoad?: number } = {},
): Promise<ReviewDailyState> {
  const deps = options.deps ?? defaultDeps;
  const now = options.now ?? simulatedNowOr();
  const date = quotaDateKey(now);
  const limitLoad = options.limitLoad ?? resolveDailyLoadLimit();
  try {
    const row = await readQuotaRowWithLegacyFallback(userId, date, now, deps);
    if (!row?.payload) return emptyState(date, limitLoad);
    const parsed = JSON.parse(row.payload) as ReviewDailyQuotaPayload;
    const usedLoad = Number(parsed?.usedLoad) || 0;
    return {
      date,
      limitLoad: Number(parsed?.limitLoad) || limitLoad,
      usedLoad: Math.round(usedLoad * 100) / 100,
      usedCount: Number(parsed?.usedCount) || 0,
      remainingLoad: Math.max(0, Math.round((limitLoad - usedLoad) * 100) / 100),
      reservedKeys: (parsed?.sessions ?? []).flatMap((session) => session.keys ?? []),
    };
  } catch {
    return emptyState(date, limitLoad);
  }
}

/**
 * 记账：把这次课接下的温故项计入当日额度（按 sessionId 幂等）。
 * 由编排层在会话创建成功后调用；失败只 warn（配额记账不该阻断开课）。
 */
export async function reserveDailyQuota(
  userId: string,
  input: { sessionId: string; load: number; keys: string[] },
  options: { now?: Date; deps?: ReviewQuotaDeps; limitLoad?: number } = {},
): Promise<ReviewDailyState | null> {
  const deps = options.deps ?? defaultDeps;
  const now = options.now ?? simulatedNowOr();
  const date = quotaDateKey(now);
  const limitLoad = options.limitLoad ?? resolveDailyLoadLimit();
  if (!input.keys.length || !(input.load > 0)) return getDailyState(userId, { now, deps, limitLoad });

  try {
    const row = await readQuotaRowWithLegacyFallback(userId, date, now, deps);
    const existing: ReviewDailyQuotaPayload = row?.payload
      ? JSON.parse(row.payload) as ReviewDailyQuotaPayload
      : {
          schemaVersion: 'review-daily-quota-v1',
          date,
          userId,
          limitLoad,
          usedLoad: 0,
          usedCount: 0,
          sessions: [],
        };
    // 幂等：同一会话重复开课/重试不重复计数
    if (existing.sessions.some((session) => session.sessionId === input.sessionId)) {
      return getDailyState(userId, { now, deps, limitLoad });
    }

    const next: ReviewDailyQuotaPayload = {
      ...existing,
      limitLoad,
      usedLoad: Math.round((Number(existing.usedLoad) + input.load) * 100) / 100,
      usedCount: (Number(existing.usedCount) || 0) + input.keys.length,
      sessions: [
        ...(existing.sessions ?? []),
        {
          sessionId: input.sessionId,
          load: input.load,
          count: input.keys.length,
          keys: input.keys,
          at: now.toISOString(),
        },
      ].slice(-40),
    };

    await deps.write({
      where: { projectionKey: reviewDailyQuotaKey(userId, date) },
      create: {
        id: `rdq_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        projectionKey: reviewDailyQuotaKey(userId, date),
        userId,
        scope: REVIEW_DAILY_QUOTA_SCOPE,
        version: 1,
        payload: JSON.stringify(next),
        generatedAt: now,
      },
      update: { version: { increment: 1 }, payload: JSON.stringify(next), generatedAt: now },
    });

    logger.info('[review-quota] 当日温故额度记账', {
      userId,
      date,
      sessionId: input.sessionId,
      load: input.load,
      count: input.keys.length,
      usedLoad: next.usedLoad,
      limitLoad,
    });

    return {
      date,
      limitLoad,
      usedLoad: next.usedLoad,
      usedCount: next.usedCount,
      remainingLoad: Math.max(0, Math.round((limitLoad - next.usedLoad) * 100) / 100),
      reservedKeys: next.sessions.flatMap((session) => session.keys ?? []),
    };
  } catch (error) {
    logger.warn('[review-quota] 额度记账失败（不影响开课）', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export const reviewQuotaService = {
  getDailyState,
  reserveDailyQuota,
  resolveDailyLoadLimit,
  quotaDateKey,
  reviewDailyQuotaKey,
};

export default reviewQuotaService;
