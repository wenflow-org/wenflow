/* eslint-disable no-console -- 只读审计 CLI */
/**
 * audit-batch-throughput.ts — 批量吞吐审计（只读，零模型额度）
 *
 * 背景（2026-10-21 夜间跑批复盘）：批量调度只报了「有没有在跑」，没有吞吐下限，
 * 结果复习批以 ~1–10 rpm 空转了 7 小时仍显示正常。本脚本把 rpm 时间序列与
 * 「低于下限的分钟」显式算出来，供人/调度器判断是否该加道或换负载。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/audit-batch-throughput.ts
 *   npx ts-node --transpile-only src/scripts/audit-batch-throughput.ts --window=180 --min-rpm=20 --json
 */
import 'dotenv/config';
import prisma from '../config/database';

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

function parseArgs() {
  const out = { windowMinutes: 60, minRpm: 20, json: false, failOnAlert: false };
  for (const raw of process.argv.slice(2)) {
    const [k, v] = raw.replace(/^--/, '').split('=');
    if (k === 'window' && Number.isFinite(Number(v))) out.windowMinutes = Number(v);
    if (k === 'min-rpm' && Number.isFinite(Number(v))) out.minRpm = Number(v);
    if (k === 'json') out.json = true;
    if (k === 'fail-on-alert') out.failOnAlert = true;
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const since = new Date(Date.now() - args.windowMinutes * 60_000);
  const rows = await prisma.llm_execution_attempts.findMany({
    where: { startedAt: { gte: since } },
    select: { startedAt: true, success: true, errorCategory: true },
  });
  const report = summarizeThroughput(
    rows.map((r) => ({ startedAt: r.startedAt, success: r.success, errorCategory: r.errorCategory ?? null })),
    { windowMinutes: args.windowMinutes, minRpm: args.minRpm },
  );
  if (args.json) {
    console.log(JSON.stringify(report));
  } else {
    console.log(`吞吐窗口 ${report.windowMinutes} 分钟｜下限 ${report.minRpm} rpm`);
    console.log(`均值 ${report.avgRpm} rpm｜最低 ${report.worstRpm} rpm｜低于下限 ${report.lowMinutes} 分钟｜最长连续 ${report.longestLowRun} 分钟`);
    if (report.alert) console.log(`⚠ ${report.alertReason}`);
    else console.log('✓ 无持续低吞吐');
  }
  // 供调度器/CI 直接当告警信号：低吞吐时退出码 3（区别于脚本自身失败的 1）
  if (args.failOnAlert && report.alert) process.exitCode = 3;
}

if (require.main === module) {
  main()
    .catch((error: unknown) => {
      console.error('审计失败：', error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect().catch(() => undefined);
    });
}
