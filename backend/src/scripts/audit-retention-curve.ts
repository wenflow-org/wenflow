/**
 * 「保持率 × 间隔」回看（只读）——P0-3 最小结果测量层。
 *
 * 数据来源：`learner_evidence` 的 `review:completed`（课内温故 + 复习课同源），
 * 其 payload 里的 `elapsedDays` = 距上次接触的间隔（由 `ReviewCompletedConsumer` 写入）。
 *
 * ⚠️ 这是**观测性**曲线，不是因果实验：什么点在什么间隔被回顾由调度器与当日配额决定，
 * 与难度/掌握度相关。它只用于①描述现状 ②给 FSRS 参数本地化提供拟合数据 ③做随机实验的基线。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/audit-retention-curve.ts [--user=<ID>] [--days=90]
 */
import 'dotenv/config';
import prisma from '../config/database';
import {
  buildRetentionCurve,
  RETENTION_BUCKET_EXPLANATION,
  type RetentionObservation,
} from '../services/memory/retention-curve';

function arg(name: string): string | null {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

function parseObservation(payload: unknown): RetentionObservation | null {
  try {
    const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
    if (!parsed || typeof parsed !== 'object') return null;
    const rating = String((parsed as Record<string, unknown>).rating || '');
    if (!rating) return null;
    const rawDays = (parsed as Record<string, unknown>).elapsedDays;
    return {
      elapsedDays: rawDays === null || rawDays === undefined ? null : Number(rawDays),
      rating,
      masteryScore: Number((parsed as Record<string, unknown>).masteryScore) || null,
    };
  } catch {
    return null;
  }
}

function printCurve(title: string, observations: RetentionObservation[]): void {
  const curve = buildRetentionCurve(observations);
  const total = observations.length;
  console.log(`\n## ${title}｜样本 ${total} 条`);
  if (total === 0) {
    console.log('  （无样本：需要先在课内温故/复习课里真正回捞到结果）');
    return;
  }
  console.log('  间隔桶        样本  严口径成功  严成功率  宽口径成功  宽成功率  平均掌握度   说明');
  for (const stat of curve) {
    if (stat.total === 0) continue;
    const pct = (value: number | null) => (value === null ? '-' : `${(value * 100).toFixed(0)}%`);
    console.log(
      `  ${stat.bucket.padEnd(10)} ${String(stat.total).padStart(5)} ${String(stat.success).padStart(10)} ` +
        `${pct(stat.successRate).padStart(8)} ${String(stat.successLenient).padStart(10)} ` +
        `${pct(stat.successRateLenient).padStart(8)} ` +
        `${(stat.avgMastery === null ? '-' : stat.avgMastery.toFixed(3)).padStart(9)}   ${RETENTION_BUCKET_EXPLANATION[stat.bucket]}`
    );
  }
  console.log(
    '  口径：严 = 仅 good/easy 算"干净答出"（动态预算用的就是这个）；宽 = 仅 again 算失败（FSRS 语义，hard 也是回忆出来了）。\n' +
      '        两者都要看：learning（推进但未掌握）在严口径下被记成失败——会把"有进展的复习"读成退步。'
  );
  const withoutInterval = curve.find((stat) => stat.bucket === 'unknown');
  if (withoutInterval && withoutInterval.total > 0) {
    console.log(`  ⚠️ ${withoutInterval.total} 条没有 elapsedDays（首次接触或写入该字段之前的数据）`);
  }
}

async function main(): Promise<void> {
  const requested = arg('user');
  const days = Number(arg('days')) || 90;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  console.log('口径提醒：观测性数据，非随机实验——不要把"间隔越长成功率越低"直接读成因果。');

  if (requested) {
    const rows = await prisma.learner_evidence.findMany({
      where: { userId: requested, evidenceType: 'review:completed', occurredAt: { gte: since } },
      select: { payload: true, occurredAt: true },
    });
    printCurve(`学习者 ${requested.slice(0, 8)}（近 ${days} 天）`, rows.map((row) => parseObservation(row.payload)).filter(Boolean) as RetentionObservation[]);
    return;
  }

  const learnerIds = (await prisma.users.findMany({
    where: { isVirtualLearner: true },
    select: { id: true },
  })).map((learner) => learner.id);
  if (learnerIds.length === 0) {
    console.log('没有虚拟学习者');
    return;
  }
  const rows = await prisma.learner_evidence.findMany({
    where: {
      evidenceType: 'review:completed',
      occurredAt: { gte: since },
      userId: { in: learnerIds },
    },
    select: { payload: true, userId: true },
  });
  const observations = rows.map((row) => parseObservation(row.payload)).filter(Boolean) as RetentionObservation[];
  printCurve(`全部虚拟学习者（近 ${days} 天）`, observations);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
