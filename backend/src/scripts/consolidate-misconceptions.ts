/* eslint-disable no-console -- 一次性归并 CLI：误解台账重复行 */
/**
 * 误解台账存量归并
 *
 * 问题：去重锚点原先是对 hypothesis **原文**做哈希，而 teaching-turn 每轮换一种说法表述
 * 同一个误解（实测同一概念下 12 条 hypothesis 文字各不相同）→ 行行新建、`occurrenceCount`
 * 恒为 1。某学习者跑完 6 节课攒了 22 行，按语义只有约 4 个误解。
 *
 * 本脚本按 **(conceptKey, 归一 canonicalLabel)** 归并重复行（无标签行退回归一文本）：
 * 保留最早观察到的那行，`occurrenceCount` 求和、`confidence` 取最大、`status` 只升不降，
 * 并把锚点改写为标签锚点（下一轮写入即直查命中）。被并掉的行**完整快照写进审计**
 * （`learner_projections` 的 `misconception-consolidation:<userId>`），可回溯。
 *
 * 纪律：**默认 dry-run（纯只读）**；`--apply` 才动数据。无标签且文本不同的行**不猜**
 * （实测词面相似度在"同误解/不同误解"两分布上重叠，无法据此判定），只报告残留。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/consolidate-misconceptions.ts --name="[case] 3-6岁"
 *   npx ts-node --transpile-only src/scripts/consolidate-misconceptions.ts --scope=virtual --apply
 */
import 'dotenv/config';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import {
  consolidateMisconceptions,
  type MisconceptionConsolidationPlan,
} from '../services/learner/misconception-ledger.service';

interface Args {
  scope: 'virtual' | 'all' | 'user';
  userId: string | null;
  name: string | null;
  apply: boolean;
  limit: number | null;
  verbose: boolean;
}

function parseArgs(): Args {
  const out: Args = { scope: 'virtual', userId: null, name: null, apply: false, limit: null, verbose: false };
  for (const raw of process.argv.slice(2)) {
    const [k, v] = raw.replace(/^--/, '').split('=');
    if (k === 'scope' && (v === 'virtual' || v === 'all' || v === 'user')) out.scope = v;
    if (k === 'user' && v) { out.userId = v.trim(); out.scope = 'user'; }
    if (k === 'name' && v) { out.name = v.trim(); out.scope = 'user'; }
    if (k === 'apply') out.apply = true;
    if (k === 'verbose') out.verbose = true;
    if (k === 'limit' && v && Number.isFinite(Number(v))) out.limit = Number(v);
  }
  return out;
}

async function resolveUserIds(args: Args): Promise<string[]> {
  if (args.userId) return [args.userId];
  if (args.name) {
    const users = await prisma.users.findMany({ where: { name: { contains: args.name } }, select: { id: true, name: true } });
    for (const u of users) console.log(`  · ${u.name} (${u.id})`);
    if (users.length === 0) throw new Error(`找不到匹配 --name=${args.name} 的用户`);
    return users.map((u) => u.id);
  }
  // 按台账里实际有行的用户取（无行的用户不必进）
  const grouped = await prisma.misconception_ledger.groupBy({ by: ['userId'], _count: { _all: true } });
  const ids = grouped
    .filter((row) => (row._count?._all ?? 0) > 1)
    .map((row) => row.userId);
  if (args.scope === 'virtual') {
    const virtual = await prisma.users.findMany({
      where: { id: { in: ids }, isVirtualLearner: true },
      select: { id: true },
    });
    return virtual.map((u) => u.id);
  }
  return args.limit ? ids.slice(0, args.limit) : ids;
}

function printPlan(plan: MisconceptionConsolidationPlan, verbose: boolean): void {
  console.log(`  扫过 ${plan.scannedRows} 行 → 归并 ${plan.groups.length} 组，删除 ${plan.deletedCount} 行，`
    + `残留待语义判定 ${plan.ungroupedRows} 行`);
  for (const g of plan.groups) {
    const label = g.canonicalLabel ?? '（无标签，按归一文本）';
    console.log(`    [${g.byLabel ? '标签' : '文本'}] x${g.deletedRows.length + 1} → 「${label}」`
      + ` occurrence=${g.mergedFields.occurrenceCount} status=${g.mergedFields.status} concept=${g.conceptKey.slice(0, 24)}`);
    if (verbose) {
      for (const d of g.deletedRows) console.log(`        - 并入：${String(d.hypothesis).slice(0, 60)}`);
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  const userIds = await resolveUserIds(args);
  console.log(`\n目标用户 ${userIds.length} 个｜模式=${args.apply ? 'APPLY（会改数据）' : 'DRY-RUN（只读）'}`);

  let totalDeleted = 0;
  let totalGroups = 0;
  for (const userId of userIds) {
    const user = await prisma.users.findUnique({ where: { id: userId }, select: { name: true } });
    console.log(`\n── ${user?.name ?? '?'} (${userId}) ──`);
    const plan = await consolidateMisconceptions(userId, { mode: args.apply ? 'apply' : 'observe' });
    if (!plan) { console.log('  （无台账行）'); continue; }
    printPlan(plan, args.verbose);
    totalDeleted += plan.deletedCount;
    totalGroups += plan.groups.length;
  }

  console.log(`\n合计：归并 ${totalGroups} 组，${args.apply ? '已删除' : '将删除'} ${totalDeleted} 行。`);
  if (!args.apply && totalDeleted > 0) console.log('这是 dry-run —— 加 --apply 才真正执行。');
}

main()
  .catch((error) => {
    logger.error('误解台账归并失败', { error: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
