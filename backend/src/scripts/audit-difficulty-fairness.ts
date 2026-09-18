/**
 * 难度分配公平审计（只读）：D_floor 的观测面（Q13）。
 *
 * 读 `learner_evidence: task:difficulty:adjustment`（难度台账），按学习者复算降档画像，
 * 标出"长期低于基线 / 总是降档 / 多数贴地板"的候选，供人工复核——**不做因果结论**。
 *
 * 口径与局限（务必随输出一起看）：
 * - 台账**只在出现理由时**写入 → "keep 且无理由"的任务不在样本里，覆盖率天然不完整；
 * - 真实用户无敏感属性/分层标签，这里只做**行为分层**（基线/降档画像），不是人口学公平审计；
 * - `floor`/`floorApplied` 仅含 D_floor 上线后（2026-09-18）新写入的数据才有值。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/audit-difficulty-fairness.ts [--days=90] [--user=<ID>] [--top=20] [--json] [--include-virtual]
 */
import 'dotenv/config';
import prisma from '../config/database';
import { ADJUSTMENT_EVIDENCE_TYPE, parseAdjustment } from '../services/learner/TaskDifficultyAdjustmentLedger';
import {
  auditDifficultyFairness,
  type DifficultyAdjustmentEvent,
} from '../services/learner/difficulty-fairness-audit';

function arg(name: string): string | null {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

const pct = (value: number) => `${(value * 100).toFixed(0)}%`;

async function main(): Promise<void> {
  const days = Number(arg('days')) || 90;
  const top = Number(arg('top')) || 20;
  const requestedUser = arg('user');
  const includeVirtual = hasFlag('include-virtual');
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await prisma.learner_evidence.findMany({
    where: { evidenceType: ADJUSTMENT_EVIDENCE_TYPE, occurredAt: { gte: since }, ...(requestedUser ? { userId: requestedUser } : {}) },
    orderBy: { occurredAt: 'asc' },
    select: { userId: true, occurredAt: true, payload: true },
  });

  const realUsers = await prisma.users.findMany({
    where: { isVirtualLearner: false, deletedAt: null },
    select: { id: true, name: true },
  });
  const nameById = new Map(realUsers.map((user) => [user.id, user.name || user.id]));
  const realIds = new Set(realUsers.map((user) => user.id));

  const events: DifficultyAdjustmentEvent[] = [];
  let droppedVirtual = 0;
  let unparsed = 0;
  for (const row of rows) {
    if (!includeVirtual && !realIds.has(row.userId)) {
      droppedVirtual += 1;
      continue;
    }
    const parsed = parseAdjustment(row.payload);
    if (!parsed) {
      unparsed += 1;
      continue;
    }
    const evidence = (parsed.evidence ?? {}) as Record<string, unknown>;
    events.push({
      userId: row.userId,
      occurredAt: row.occurredAt instanceof Date ? row.occurredAt.toISOString() : String(row.occurredAt),
      baseline: parsed.baseline,
      adjusted: parsed.adjusted,
      direction: parsed.direction,
      reasons: parsed.reasons,
      floor: typeof evidence.floor === 'number' ? evidence.floor : null,
      floorApplied: evidence.floorApplied === true,
    });
  }

  const report = auditDifficultyFairness(events);

  if (hasFlag('json')) {
    console.log(JSON.stringify({ windowDays: days, coverage: { rows: rows.length, used: events.length, droppedVirtual, unparsed }, report }, null, 2));
    return;
  }

  console.log(`\n难度分配公平审计｜近 ${days} 天｜样本 ${events.length} 条（原始 ${rows.length}；剔除虚拟 ${droppedVirtual}；解析失败 ${unparsed}）`);
  console.log('注意：观察性数据，非因果结论；台账只记"有理由"的任务，覆盖率不完整。\n');
  console.log(
    `总计：学习者 ${report.totals.learners}｜任务 ${report.totals.tasks}｜降档 ${report.totals.decreaseTasks}` +
      `｜升档 ${report.totals.increaseTasks}｜持平 ${report.totals.keepTasks}` +
      `｜平均 Δ=${report.totals.meanDelta.toFixed(2)}｜被地板抬回 ${report.totals.floorAppliedTasks}`
  );

  const sorted = [...report.learners].sort((a, b) => b.tasks - a.tasks).slice(0, top);
  console.log(`\n按任务数 Top ${Math.min(top, sorted.length)}：`);
  for (const item of sorted) {
    console.log(
      `  · ${(nameById.get(item.userId) || item.userId).slice(0, 18)}｜n=${item.tasks}` +
        ` 降档占比=${pct(item.tasks ? item.decreaseTasks / item.tasks : 0)}` +
        ` 平均Δ=${item.meanDelta.toFixed(2)}｜连续低于基线 max=${item.maxConsecutiveBelowBaseline}` +
        `｜贴地板 ${item.pinnedLowTasks}｜地板抬回 ${item.floorAppliedTasks}`
    );
  }

  console.log(`\n待人工复核（${report.flagged.length} 人）：`);
  for (const item of report.flagged) {
    console.log(`  ! ${(nameById.get(item.userId) || item.userId).slice(0, 18)} → [${item.flags.join(', ')}]`);
  }
  if (report.flagged.length === 0) console.log('  （无）');
  console.log('');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
