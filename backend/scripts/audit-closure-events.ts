#!/usr/bin/env node
/**
 * 收束事件统一观测（#105，只读）
 *
 * 数据源：`learner_evidence` 中 evidenceType='task:completed' | 'path:completed' 的投影行
 * （由 `LearnerEvidenceProjector` 从 domain_event_outbox 投影；事件本身由
 * `learningService.completeTask` 统一发出）。2026-10-18 起事件 payload 带
 * `track`（human / virtual-learner）与 `completionSource`；更早的行标 legacy。
 *
 * 用法：cd backend && npx ts-node --transpile-only scripts/audit-closure-events.ts [--days 14] [--json]
 * 注意：若 outbox 消费者未运行，learner_evidence 会落后于真实完成量——本脚本只反映已投影行。
 */
import prisma from '../src/config/database';
import {
  parseClosureObservation,
  summarizeClosureObservations,
} from '../src/services/learning/closure-observability';

const args = process.argv.slice(2);
const daysIndex = args.indexOf('--days');
const DAYS = daysIndex >= 0 ? Math.max(1, Number(args[daysIndex + 1]) || 14) : 14;
const AS_JSON = args.includes('--json');

async function main(): Promise<void> {
  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);
  const rows = await prisma.learner_evidence.findMany({
    where: {
      evidenceType: { in: ['task:completed', 'path:completed'] },
      occurredAt: { gte: since },
    },
    select: { evidenceType: true, payload: true, occurredAt: true, userId: true, pathId: true },
    orderBy: { occurredAt: 'desc' },
  });

  const observations = rows
    .map((row) => parseClosureObservation(row.evidenceType, row.payload))
    .filter((item): item is NonNullable<typeof item> => item !== null);
  const summary = summarizeClosureObservations(observations);

  if (AS_JSON) {
    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      windowDays: DAYS,
      projectedRows: rows.length,
      summary,
    }, null, 2));
    return;
  }

  console.log(`[closure:events] 近 ${DAYS} 天已投影收束事件 ${rows.length} 条（task/path completed）`);
  console.log(`  按轨道：${JSON.stringify(summary.byTrack)}`);
  console.log(`  按通道：${JSON.stringify(summary.bySource)}`);
  const matrixRows = Object.entries(summary.matrix).sort((a, b) => b[1] - a[1]);
  if (matrixRows.length) {
    console.log('  轨道×通道：');
    for (const [key, count] of matrixRows) {
      console.log(`    ${key} → ${count}`);
    }
  }
  if (summary.byTrack.legacy > 0) {
    console.log(`  （legacy ${summary.byTrack.legacy} 条为 2026-10-18 之前的无 track 行，不参与新口径对比）`);
  }
}

main()
  .catch((error) => {
    console.error('[closure:events] 失败', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
