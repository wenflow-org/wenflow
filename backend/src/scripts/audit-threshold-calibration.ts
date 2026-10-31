/**
 * 阈值校准表（**只读**，不调 LLM、不写库）——#96「阈值来源待真实数据拟合」的输入。
 *
 * 数据来源：`learner_evidence(type='checkpoint:result')` 的
 * `payload.predictedMastery / predictionSource / understanding`（2026-10-20 起落库）。
 * 只用**代码裁决**、非简答题的样本：model-reference 是模型自评，简答关键词判定会系统性低估。
 *
 * 输出：预测掌握度分桶 × 实际通过率的校准表（predicted mean / observed / gap），
 * 以及按题型、按预测来源的覆盖统计。gap>0 = 系统低估（实际比预测好），gap<0 = 高估。
 *
 * 用法（backend 目录）：
 *   npx ts-node --transpile-only src/scripts/audit-threshold-calibration.ts
 *   npx ts-node --transpile-only src/scripts/audit-threshold-calibration.ts --days=30 --user=<id>
 *   npx ts-node --transpile-only src/scripts/audit-threshold-calibration.ts --json
 */
import 'dotenv/config';
import prisma from '../config/database';
import { summarizeCalibration } from '../services/ai-teaching/checkpoint-prediction';

function arg(name: string): string | null {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

async function main() {
  const days = Math.max(1, Number(arg('days') ?? 90));
  const limit = Math.max(1, Number(arg('limit') ?? 5000));
  const userId = arg('user');
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await prisma.learner_evidence.findMany({
    where: {
      evidenceType: 'checkpoint:result',
      occurredAt: { gte: since },
      ...(userId ? { userId } : {}),
    },
    orderBy: { occurredAt: 'desc' },
    take: limit,
    select: { payload: true },
  });
  const summary = summarizeCalibration(rows);

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ windowDays: days, since: since.toISOString(), ...summary }, null, 2));
    return;
  }

  const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
  const num = (value: number | null) => (value === null ? '—' : value.toFixed(2));
  console.log(
    `[calibration] 窗口 ${days} 天（since ${since.toISOString()}）｜样本 ${summary.totalRows} 行` +
      `｜代码裁决 ${summary.codeJudged}｜可进校准表 ${summary.usable}（覆盖率 ${pct(summary.predictionCoverage)}）`,
  );
  console.log(`[calibration] 预测来源：${JSON.stringify(summary.bySource)}`);
  console.log('[calibration] 按题型：');
  for (const item of summary.byType) {
    console.log(
      `    · ${item.type.padEnd(14)} 共 ${String(item.total).padStart(4)}｜代码裁决 ${String(item.code).padStart(4)}` +
        `｜有预测 ${String(item.usable).padStart(4)}｜通过率 ${item.passRate === null ? '—' : pct(item.passRate)}`,
    );
  }
  console.log('[calibration] 校准表（预测掌握度 → 实际通过率；gap>0 低估，gap<0 高估）：');
  for (const bucket of summary.buckets) {
    console.log(
      `    · ${bucket.label}  n=${String(bucket.sample).padStart(4)}` +
        `｜预测均值 ${num(bucket.predictedMean)}｜实际 ${num(bucket.observedRate)}｜gap ${num(bucket.gap)}`,
    );
  }
  console.log('[calibration] 对照：模型自述 understanding → 实际通过率：');
  for (const bucket of summary.understandingBuckets) {
    console.log(
      `    · ${bucket.label}  n=${String(bucket.sample).padStart(4)}` +
        `｜understanding 均值 ${num(bucket.predictedMean)}｜实际 ${num(bucket.observedRate)}｜gap ${num(bucket.gap)}`,
    );
  }
  if (summary.usable === 0) {
    console.log(
      '[calibration] 无可校准样本：2026-10-20 前落库的 checkpoint:result 没有 predictedMastery；' +
        '需要跑一批新课堂（代码裁决检查点）后再看。',
    );
  }
}

main()
  .catch((error) => {
    console.error('[calibration] 失败：', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().catch(() => undefined));
