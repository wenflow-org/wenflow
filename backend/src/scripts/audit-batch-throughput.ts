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
import {
  summarizeThroughput,
  applyThroughputActivity,
  ACTIVE_SESSION_STALE_MINUTES,
  type ThroughputAttempt,
  type ThroughputMinute,
  type ThroughputReport,
  LOW_RUN_ALERT_MINUTES,
} from '../services/ops/throughput';

export { summarizeThroughput, applyThroughputActivity, LOW_RUN_ALERT_MINUTES };
export type { ThroughputAttempt, ThroughputMinute, ThroughputReport };


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
  const now = new Date();
  const [rows, activeSessions, activeBatches, activeLeases] = await Promise.all([
    prisma.llm_execution_attempts.findMany({
      where: { startedAt: { gte: since } },
      select: { startedAt: true, success: true, errorCategory: true },
    }),
    prisma.virtual_sessions.count({
      where: {
        status: 'running',
        updatedAt: { gte: new Date(now.getTime() - ACTIVE_SESSION_STALE_MINUTES * 60_000) },
      },
    }),
    prisma.virtual_batch_jobs.count({ where: { status: { in: ['running', 'pending'] } } }),
    prisma.virtual_experiment_leases.count({ where: { expiresAt: { gt: now } } }),
  ]);
  const report = applyThroughputActivity(
    summarizeThroughput(
      rows.map((r) => ({ startedAt: r.startedAt, success: r.success, errorCategory: r.errorCategory ?? null })),
      { windowMinutes: args.windowMinutes, minRpm: args.minRpm },
    ),
    { activeSessions, activeBatches, activeLeases },
  );
  if (args.json) {
    console.log(JSON.stringify(report));
  } else {
    console.log(`吞吐窗口 ${report.windowMinutes} 分钟｜下限 ${report.minRpm} rpm`);
    console.log(`均值 ${report.avgRpm} rpm｜最低 ${report.worstRpm} rpm｜低于下限 ${report.lowMinutes} 分钟｜最长连续 ${report.longestLowRun} 分钟`);
    if (report.idle) console.log('✓ 空闲：没有运行中的批次或虚拟学习者会话（rpm 仅供参考）');
    else if (report.alert) console.log(`⚠ ${report.alertReason}`);
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
