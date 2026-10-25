/**
 * 已提交 learning_metrics 行的查询条件与快照复原助手（2026-10-24 架构优化批 1 拆分）。
 *
 * 从 learning-state.service.ts 迁出的**纯函数**：无类状态、不依赖门面方法——
 * 门面上的 spy（如 listCommittedSnapshots）不受影响，服务类与读侧（learning-state-reads.ts）
 * 都从这里取用，保证「已提交行口径」只有一份实现。
 */
import {
  type InternalBalance,
  type InternalTen,
  type LearningStateCommittedSnapshot,
  type LearningStateMetrics,
  toInternalBalance,
  toInternalTenScale,
} from './learning-state-types';
import { logger } from '../../utils/logger';

/** 已提交行读取的版本门禁（metricVersion 列；口径升级时旧种子/checkpoint 自愈） */
export const COMMITTED_METRIC_VERSION = 'state-v2';

/**
 * 已提交指标的读取条件。
 * `pathId` 是**可选维度**：不传 = 该学习者的全局序列（历史行为，跨路径合并）；
 * 传 pathId = 只读该路径的序列（路径级判断用，避免"路径 A 的困难改写路径 B 的自适应"）。
 */
export function committedMetricWhere(
  userId: string,
  since?: Date,
  excludedSourceKey?: string,
  asOf?: Date,
  pathId?: string | null,
  /**
   * 是否计入合成占位行（synthetic=true）。默认排除（#71 P-46）：占位值不能参与
   * 当前状态 / 趋势 / EWMA 前值；只有 PMC 重放需要包含（否则只有占位行的冷启动用户会读成
   * 「无状态」），且 PMC 内部另有 dedupeLessonRows 把「同课真实行 + 占位行」配对折叠。
   */
  includeSynthetic = false
) {
  return {
    userId,
    metricType: 'learning_state',
    // pathId === undefined → 不加维度（维持旧的全局读取）；null → 显式只读"无路径归属"的行
    ...(pathId === undefined ? {} : { pathId }),
    ...(excludedSourceKey ? { sourceKey: { not: excludedSourceKey } } : {}),
    // 2026-10-24 架构优化批 2a：committed/synthetic/version 走实列（迁移已回填存量），
    // 取代 metadata 字符串 LIKE——SQLite 下 LIKE 对每行全文子串匹配，索引完全用不上。
    committed: true,
    metricVersion: COMMITTED_METRIC_VERSION,
    ...(includeSynthetic ? {} : { synthetic: false }),
    ...(since || asOf ? {
      calculatedAt: {
        ...(since ? { gte: since } : {}),
        ...(asOf ? { lte: asOf } : {}),
      }
    } : {}),
  };
}

export function parseMetricMetadata(raw: string | null | undefined): Record<string, any> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function extractSnapshotTimestamp(value: unknown, fallback: Date): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return fallback;
}

/** 宽松复原：任意输入 → 归一后的 LearningStateMetrics（字段缺失/非法 → null） */
export function coerceMetricsInternal(
  input: any,
  fallbackTimestamp: Date
): LearningStateMetrics | null {
  if (!input || typeof input !== 'object') return null;

  const rawLss = typeof input.lss === 'number' ? input.lss : null;
  const rawKtl = typeof input.ktl === 'number' ? input.ktl : null;
  const rawLf = typeof input.lf === 'number' ? input.lf : null;
  const rawLsb = typeof input.lsb === 'number' ? input.lsb : null;

  if (rawLss === null || rawKtl === null || rawLf === null || rawLsb === null) {
    return null;
  }

  return {
    lss: toInternalTenScale(rawLss),
    ktl: toInternalTenScale(rawKtl),
    lf: toInternalTenScale(rawLf),
    lsb: toInternalBalance(rawLsb),
    timestamp: extractSnapshotTimestamp(input.timestamp, fallbackTimestamp),
  };
}

export function metricRecordToSnapshot(record: {
  lss: number | null;
  ktl: number | null;
  lf: number | null;
  lsb: number | null;
  calculatedAt: Date;
  pathId?: string | null;
}): LearningStateCommittedSnapshot | null {
  // 读取侧自检要在**归一之前**：归一会把 40 悄悄变成 4，脏数据就此隐形。
  // 这里只告警不改行为（值仍由 coerceMetricsInternal 归一），把"列里存了越界/异刻度值"暴露出来。
  reportRawScaleAnomaly(record, 'read:committed-metric-raw');
  const metrics = coerceMetricsInternal({
    lss: record.lss,
    ktl: record.ktl,
    lf: record.lf,
    lsb: record.lsb,
    timestamp: record.calculatedAt,
  }, record.calculatedAt);

  if (!metrics) return null;
  return {
    metrics,
    calculatedAt: record.calculatedAt,
    pathId: record.pathId ?? null,
  };
}

/** 读取侧：列里出现越界值（>10 / <-10 / 非有限数）→ 告警（异刻度或脏写入的可见化） */
export function reportRawScaleAnomaly(
  record: { lss: number | null; ktl: number | null; lf: number | null; lsb: number | null },
  context: string
): void {
  const inRange = (value: number | null, min: number, max: number) =>
    value == null || (Number.isFinite(value) && value >= min - 1e-9 && value <= max + 1e-9);
  const anomalies = [
    inRange(record.lss, 0, 10) ? null : 'lss',
    inRange(record.ktl, 0, 10) ? null : 'ktl',
    inRange(record.lf, 0, 10) ? null : 'lf',
    inRange(record.lsb, -10, 10) ? null : 'lsb',
  ].filter(Boolean) as string[];
  if (anomalies.length === 0) return;
  logger.warn('[scale-guard] 读取到越界的已提交指标（可能存了 0-100/0-1 等异刻度值）', {
    context,
    fields: anomalies,
    raw: { lss: record.lss, ktl: record.ktl, lf: record.lf, lsb: record.lsb },
  });
}

export function wrapupSessionToSnapshot(session: {
  wrapup: string | null;
  startTime: Date;
  endTime: Date | null;
}): LearningStateCommittedSnapshot | null {
  if (!session.wrapup) return null;

  try {
    const wrapup = JSON.parse(session.wrapup);
    const rawState = wrapup?.stateUpdate;
    const fallbackTimestamp = session.endTime || session.startTime;
    const metrics = coerceMetricsInternal(rawState, fallbackTimestamp);
    if (!metrics) return null;

    return {
      metrics,
      calculatedAt: metrics.timestamp,
    };
  } catch {
    return null;
  }
}

/** display 0-100 → 内部 0-10（display 写入口径换算，服务类同名薄方法的实现源） */
export function displayTenScaleToInternal(value: number | null | undefined): InternalTen {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return (Math.max(0, Math.min(100, numeric)) / 10) as InternalTen;
}

export function displayBalanceScaleToInternal(value: number | null | undefined): InternalBalance {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return (Math.max(-100, Math.min(100, numeric)) / 10) as InternalBalance;
}
