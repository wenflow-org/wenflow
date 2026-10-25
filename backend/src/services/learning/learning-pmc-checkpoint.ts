/**
 * PMC 滚动 checkpoint（架构优化批 2b，2026-10-24）。
 *
 * 问题：当前状态读取（/state/current、趋势窗口的 currentState、预警、聚合全局量）此前每次
 * 从该用户第一行 learning_metrics **全量重放**——长期活跃用户每次打开状态页的成本随历史
 * 线性上涨（热路径调查结论 #4）。
 *
 * 方案：全局序列（scope=''）每满 `PMC_CHECKPOINT_INTERVAL_DAYS` 个日历日落一次「该日收盘态」
 * （KTL/LF + 截至该日的最后一节课信息）；读取时取 asOf 之前最新的 checkpoint 作种子，
 * 只拉取 checkpoint 日之后的行续放（空闲日回落照常参与）。
 *
 * 边界与诚实声明：
 * - **写在读路径上**（best-effort）：checkpoint 是缓存，写失败只 warn 不影响读取正确性；
 * - **口径升级自愈**：metricVersion 不匹配的种子直接作废，回退全量重放；
 * - **趋势全历史图不受益**：derivePmcDailySeries 需要窗口内每一天的值，保持全量重放
 *   （mode=recent 的 currentState 部分仍受益）；
 * - **路径维度不落 checkpoint**（v1）：getAggregatedState 的 perPath 重放仍走全量（行已预取共享）；
 * - 无外键：users 删除后的孤儿行无害（仅多占一行，读取按 userId 查询自然落空）。
 */
import { randomUUID } from 'crypto';
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import { dayKeyOf, addDaysToDayKey, parseDayKeyStart, endOfDay } from '../time/day-boundary';
import type { PmcReplaySeed, UserPmcSeries } from './learning-load-pmc.service';

export const PMC_CHECKPOINT_INTERVAL_DAYS = 30;
export const PMC_CHECKPOINT_METRIC_VERSION = 'state-v2';

/** v1 只做全局序列；预留路径 scope 扩展位 */
const GLOBAL_SCOPE = '';

export interface LoadedCheckpoint {
  dayKey: string;
  /** checkpoint 日的 23:59:59.999（行查询下界：since = dayEnd+1ms，只取此后的行） */
  rowsSince: Date;
  seed: PmcReplaySeed;
}

/** 取 asOf 之前（含当日）最新的有效 checkpoint；无/失效/读失败 → null（回退全量重放） */
export async function loadLatestCheckpoint(userId: string, asOf: Date): Promise<LoadedCheckpoint | null> {
  const asOfDayKey = dayKeyOf(asOf);
  if (!asOfDayKey) return null;
  try {
    const row = await prisma.learning_pmc_checkpoints.findFirst({
      where: {
        userId,
        scope: GLOBAL_SCOPE,
        dayKey: { lte: asOfDayKey },
        metricVersion: PMC_CHECKPOINT_METRIC_VERSION,
      },
      orderBy: { dayKey: 'desc' },
    });
    if (!row) return null;
    return {
      dayKey: row.dayKey,
      rowsSince: new Date(endOfDay(parseDayKeyStart(row.dayKey)).getTime() + 1),
      seed: {
        dayKey: row.dayKey,
        ktl: row.ktl,
        lf: row.lf,
        latestLessonLss: row.latestLessonLss,
        latestLessonAt: row.latestLessonAt,
      },
    };
  } catch (error) {
    logger.warn('[pmc-checkpoint] 读取失败（best-effort，回退全量重放）', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function dayKeyDistance(fromKey: string, toKey: string): number {
  const from = parseDayKeyStart(fromKey).getTime();
  const to = parseDayKeyStart(toKey).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.round((to - from) / 86_400_000);
}

/**
 * 满足间隔则落 checkpoint（best-effort，读路径调用）。
 * 写入时机在**重放完成之后**：series.daily/pmc 按索引对齐，末位即最后一天的收盘态；
 * series.latestLessonLss/At 已含种子携带的「截至当日的最后一节课」（无新课时回退种子值）。
 */
export async function maybeWriteCheckpoint(
  userId: string,
  series: UserPmcSeries,
  prevCheckpointDayKey: string | null,
): Promise<void> {
  try {
    if (!series.latest || series.daily.length === 0) return;
    const lastDay = series.daily[series.daily.length - 1].dayKey;
    // 距上一个 checkpoint 不足间隔不写；首次 checkpoint 要求历史跨度已满间隔
    // （避免新用户/短历史也落一行——那没有续放收益）
    const reference = prevCheckpointDayKey ?? series.daily[0].dayKey;
    if (dayKeyDistance(reference, lastDay) < PMC_CHECKPOINT_INTERVAL_DAYS) return;
    const pmcAtLastDay = series.pmc[series.pmc.length - 1];
    if (!pmcAtLastDay) return;

    await prisma.learning_pmc_checkpoints.upsert({
      where: { userId_scope_dayKey: { userId, scope: GLOBAL_SCOPE, dayKey: lastDay } },
      create: {
        id: randomUUID(),
        userId,
        scope: GLOBAL_SCOPE,
        dayKey: lastDay,
        ktl: pmcAtLastDay.ktl,
        lf: pmcAtLastDay.lf,
        latestLessonLss: series.latestLessonLss,
        latestLessonAt: series.latestLessonAt,
        metricVersion: PMC_CHECKPOINT_METRIC_VERSION,
      },
      update: {
        ktl: pmcAtLastDay.ktl,
        lf: pmcAtLastDay.lf,
        latestLessonLss: series.latestLessonLss,
        latestLessonAt: series.latestLessonAt,
      },
    });
  } catch (error) {
    logger.warn('[pmc-checkpoint] 写入失败（best-effort，不影响读取）', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** 供测试断言/清理 */
export const PMC_CHECKPOINT_GLOBAL_SCOPE = GLOBAL_SCOPE;
