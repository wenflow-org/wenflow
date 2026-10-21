/**
 * 批量吞吐纯函数（2026-10-21）：从审计 CLI 抽到服务层，供管理端读侧复用同一口径。
 *
 * 背景：批量调度只报了「有没有在跑」，没有吞吐下限，复习批曾以 ~1–10 rpm 空转 7 小时
 * 仍显示正常。这里把 rpm 时间序列与「连续低于下限」告警显式算出来；调用方负责取数。
 */
export interface ThroughputAttempt {
  startedAt: Date;
  success: boolean;
  errorCategory: string | null;
}

export interface ThroughputMinute {
  /** ISO 分钟（UTC，分钟精度） */
  minute: string;
  calls: number;
  ok: number;
  rateLimit: number;
  /** 该分钟内每分钟调用数（窗口按 1 分钟切，故 = calls） */
  rpm: number;
  belowFloor: boolean;
}

export interface ThroughputReport {
  windowMinutes: number;
  minRpm: number;
  totalCalls: number;
  avgRpm: number;
  minutes: ThroughputMinute[];
  lowMinutes: number;
  longestLowRun: number;
  worstRpm: number;
  /** 是否触发「持续低吞吐」告警（连续低吞吐分钟数 ≥ lowRunAlertMinutes） */
  alert: boolean;
  alertReason: string | null;
}

export const LOW_RUN_ALERT_MINUTES = 5;

function minuteKey(date: Date): string {
  const d = new Date(date);
  d.setSeconds(0, 0);
  return d.toISOString().slice(0, 16);
}

/**
 * 纯函数：把调用记录聚合成分钟级 rpm，并标出低吞吐分钟与最长连续低吞吐段。
 * 窗口内没有记录的时刻也要计入 idle（rpm=0），否则「空转」会被平均掉。
 */
export function summarizeThroughput(
  attempts: readonly ThroughputAttempt[],
  opts: { windowMinutes: number; minRpm: number; now?: Date; lowRunAlertMinutes?: number },
): ThroughputReport {
  const windowMinutes = Math.max(1, Math.floor(opts.windowMinutes || 1));
  const minRpm = Number.isFinite(opts.minRpm) ? Math.max(0, opts.minRpm) : 20;
  const alertRun = Math.max(1, Math.floor(opts.lowRunAlertMinutes ?? LOW_RUN_ALERT_MINUTES));
  const now = opts.now ?? new Date();
  const end = new Date(now);
  end.setSeconds(0, 0);

  const buckets = new Map<string, { calls: number; ok: number; rateLimit: number }>();
  for (const attempt of attempts) {
    const key = minuteKey(attempt.startedAt);
    const bucket = buckets.get(key) ?? { calls: 0, ok: 0, rateLimit: 0 };
    bucket.calls += 1;
    if (attempt.success) bucket.ok += 1;
    if (attempt.errorCategory === 'rate_limit') bucket.rateLimit += 1;
    buckets.set(key, bucket);
  }

  const minutes: ThroughputMinute[] = [];
  for (let i = windowMinutes - 1; i >= 0; i -= 1) {
    const at = new Date(end.getTime() - i * 60_000);
    const key = minuteKey(at);
    const bucket = buckets.get(key) ?? { calls: 0, ok: 0, rateLimit: 0 };
    minutes.push({
      minute: key,
      calls: bucket.calls,
      ok: bucket.ok,
      rateLimit: bucket.rateLimit,
      rpm: bucket.calls,
      belowFloor: bucket.calls < minRpm,
    });
  }

  let longestLowRun = 0;
  let currentRun = 0;
  for (const m of minutes) {
    if (m.belowFloor) {
      currentRun += 1;
      longestLowRun = Math.max(longestLowRun, currentRun);
    } else {
      currentRun = 0;
    }
  }

  const totalCalls = minutes.reduce((sum, m) => sum + m.calls, 0);
  const lowMinutes = minutes.filter((m) => m.belowFloor).length;
  const worstRpm = minutes.reduce((min, m) => Math.min(min, m.rpm), Number.POSITIVE_INFINITY);
  const avgRpm = Math.round((totalCalls / windowMinutes) * 100) / 100;
  const alert = longestLowRun >= alertRun;
  return {
    windowMinutes,
    minRpm,
    totalCalls,
    avgRpm,
    minutes,
    lowMinutes,
    longestLowRun,
    worstRpm: Number.isFinite(worstRpm) ? worstRpm : 0,
    alert,
    alertReason: alert
      ? `连续 ${longestLowRun} 分钟低于 ${minRpm} rpm（窗口均值 ${avgRpm} rpm）`
      : null,
  };
}

/** 运行中会话的陈旧阈值：进程崩溃后 status 可能停在 running，超过窗口不再算活动信号 */
export const ACTIVE_SESSION_STALE_MINUTES = 30;
/** 跑批心跳的陈旧阈值：脚本每 30s 调一次 heartbeat，5 分钟没有心跳视为批次已死 */
export const BATCH_HEARTBEAT_STALE_MINUTES = 5;

export interface ThroughputActivity {
  /** 运行中的虚拟学习者会话数（批量跑批的主要信号） */
  activeSessions: number;
  /** 运行中/排队中的批量任务数（批次页写入；脚本跑批可能为 0） */
  activeBatches: number;
  /** 未过期实验租约数（实验编排信号） */
  activeLeases: number;
}

export interface ScopedThroughputReport extends ThroughputReport {
  activeSessions: number;
  activeBatches: number;
  activeLeases: number;
  /** 没有运行中的批次/会话：rpm 仍展示，但不按下限告警（空闲不是故障） */
  idle: boolean;
}

/**
 * 纯函数：把「是否有批次在跑」并入吞吐结论。
 * 20 rpm 下限只对跑批有意义；没有运行中的批次/会话时，真实用户的稀疏调用（管理端刷新、
 * 单节课）也会连续低于下限，直接告警会变成常驻假红灯。
 */
export function applyThroughputActivity(
  report: ThroughputReport,
  activity: ThroughputActivity,
): ScopedThroughputReport {
  const activeSessions = Math.max(0, Math.floor(activity.activeSessions || 0));
  const activeBatches = Math.max(0, Math.floor(activity.activeBatches || 0));
  const activeLeases = Math.max(0, Math.floor(activity.activeLeases || 0));
  const idle = activeSessions + activeBatches + activeLeases === 0;
  return {
    ...report,
    activeSessions,
    activeBatches,
    activeLeases,
    idle,
    alert: idle ? false : report.alert,
    alertReason: idle ? null : report.alertReason,
  };
}
