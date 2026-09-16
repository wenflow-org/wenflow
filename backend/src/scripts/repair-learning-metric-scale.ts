/**
 * 修复：重算 historical `learning_state` 行的量纲（task-completion 写入的 67 行被压成 0-1）
 *
 * 根因（取证结论）：
 * - `metrics/LearningMetricService.calculateLSS`（本地定义）返回 **0-100**；
 *   `learning-state.service.calculateLSS`（同名）返回 **0-10**。
 * - `97260fa`（2026-08-09「KTL/LF 三套收敛」）把回调改成 `lss10 = lssScore / 10`（按 0-100 理解，
 *   得到 0-10），但回调的输出契约是 **display 0-100**（commitDisplayMetrics 会再 /10）→ **多除一次**。
 * - 于是 `source=task-completion` 的行：lss 真实值 = 落库值 × 10；且新值项在 EWMA 里被少算 10 倍。
 *
 * 为什么能精确反推（不是拍脑袋 ×10）：
 *   设 λ 为 EWMA 系数、L = 真实 internal lss、p = 上一步真实 internal ktl：
 *   - 回调：ktl_cb = (p×10)×λ + L×(1−λ)      ← prev 用了 display（×10），新值用了 internal
 *   - 落库：ktl_stored = ktl_cb / 10 = p×λ + L×(1−λ)/10
 *   - 真实应为：p×λ + L×(1−λ)
 *   ⇒ 修复：ktl = ktl_stored + L×(1−λ)×0.9（lf 同理，λ 取 0.70）
 *   lss / lsb 是一次线性映射（无 EWMA）⇒ 直接 ×10。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/repair-learning-metric-scale.ts --dry-run
 *   npx ts-node --transpile-only src/scripts/repair-learning-metric-scale.ts --apply
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import prisma from '../config/database';
import { CONSUMER_THRESHOLDS } from './audit-learning-metrics-scale';

const KTL_LAMBDA = 0.95;
const LF_LAMBDA = 0.70;

interface Args {
  apply: boolean;
  limit: number;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, limit: 20 };
  for (const arg of argv) {
    if (arg === '--dry-run') args.apply = false;
    else if (arg === '--apply') args.apply = true;
    else if (arg.startsWith('--limit=')) {
      const value = Number(arg.slice('--limit='.length));
      if (Number.isFinite(value) && value > 0) args.limit = Math.min(Math.floor(value), 200);
    } else if (arg) {
      throw new Error(`未知参数：${arg}`);
    }
  }
  return args;
}

/** 判断某行是否受此缺陷影响：task-completion 写入、且四个指标都被压进 (0,1] */
export function isCorruptedRow(row: {
  metricType: string;
  lss: number | null;
  ktl: number | null;
  lf: number | null;
  lsb: number | null;
  metadata: string | null;
}): boolean {
  if (row.metricType !== 'learning_state') return false;
  let source = '';
  try {
    const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata ?? {});
    source = String(meta?.source || '');
  } catch {
    return false;
  }
  if (source !== 'task-completion') return false;
  const values = [row.lss, row.ktl, row.lf].map((value) => Number(value));
  if (values.some((value) => !Number.isFinite(value))) return false;
  return values.every((value) => value >= 0 && value <= 1) && values.some((value) => value > 0);
}

/** 反推真实 internal 刻度（见文件头推导） */
export function computeRepairedRow(row: {
  lss: number | null;
  ktl: number | null;
  lf: number | null;
  lsb: number | null;
}): { lss: number; ktl: number; lf: number; lsb: number } {
  const round = (value: number) => Math.round(value * 1000) / 1000;
  const lss = Math.max(0, Math.min(10, Number(row.lss) * 10));
  const ktl = Math.max(0, Math.min(10, Number(row.ktl) + lss * (1 - KTL_LAMBDA) * 0.9));
  const lf = Math.max(0, Math.min(10, Number(row.lf) + lss * (1 - LF_LAMBDA) * 0.9));
  return {
    lss: round(lss),
    ktl: round(ktl),
    lf: round(lf),
    lsb: round(Math.max(-10, Math.min(10, ktl - lf))),
  };
}

export function firedBranches(metrics: { lss: number; ktl: number; lf: number; lsb: number }): string[] {
  return CONSUMER_THRESHOLDS.filter((threshold) => threshold.test(metrics)).map((threshold) => threshold.key);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const rows = await prisma.learning_metrics.findMany({
    where: { metricType: 'learning_state' },
    select: { id: true, userId: true, metricType: true, lss: true, ktl: true, lf: true, lsb: true, metadata: true, calculatedAt: true },
    orderBy: [{ calculatedAt: 'asc' }],
  });
  const corrupted = rows.filter(isCorruptedRow);
  console.log(`[repair] 受影响行 ${corrupted.length} / ${rows.length}（mode=${args.apply ? 'apply' : 'dry-run'}）`);

  // 对账表
  console.log('\n[repair] 逐行对账（前 → 后）：');
  const planned = corrupted.map((row) => ({ row, repaired: computeRepairedRow(row) }));
  for (const item of planned.slice(0, args.limit)) {
    const { row, repaired } = item;
    console.log(`  ${new Date(row.calculatedAt).toISOString().slice(0, 16)} ${row.userId.slice(0, 8)}`
      + `  lss ${row.lss}→${repaired.lss}  ktl ${row.ktl}→${repaired.ktl}  lf ${row.lf}→${repaired.lf}  lsb ${row.lsb}→${repaired.lsb}`);
  }
  if (planned.length > args.limit) console.log(`  …（其余 ${planned.length - args.limit} 行省略，--limit 可调）`);

  // 按用户看"最新一行"修复前后的消费侧分支（验证：自适应是否被唤醒）
  const latestByUser = new Map<string, typeof rows[number]>();
  // rows 按 calculatedAt 升序 → 无条件覆盖，最终留下每个用户的**最新**一行
  for (const row of rows) latestByUser.set(row.userId, row);
  let beforeInert = 0;
  let afterInert = 0;
  const revived: string[] = [];
  for (const [userId, row] of latestByUser) {
    const before = { lss: Number(row.lss) || 0, ktl: Number(row.ktl) || 0, lf: Number(row.lf) || 0, lsb: Number(row.lsb) || 0 };
    const after = isCorruptedRow(row) ? computeRepairedRow(row) : before;
    const beforeFired = firedBranches(before);
    const afterFired = firedBranches(after);
    if (beforeFired.length === 0) beforeInert += 1;
    if (afterFired.length === 0) afterInert += 1;
    if (beforeFired.length === 0 && afterFired.length > 0) {
      revived.push(`${userId.slice(0, 8)}: ${afterFired.join(', ')}`);
    }
  }
  console.log(`\n[repair] 用户数 ${latestByUser.size}｜最新状态"所有分支都不触发"：修复前 ${beforeInert} 人 → 修复后 ${afterInert} 人`);
  console.log('[repair] 被唤醒的用户（分支名）：');
  for (const item of revived) console.log(`  ${item}`);

  if (!args.apply) {
    console.log('\n[repair] dry-run 结束（未写库）。确认对账表后再跑 --apply');
    return;
  }

  // 备份原始值（可追溯），再更新
  const backupDir = path.resolve(__dirname, '../../analysis_output');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `metric-scale-repair-${Date.now()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(planned.map((item) => ({ id: item.row.id, before: {
    lss: item.row.lss, ktl: item.row.ktl, lf: item.row.lf, lsb: item.row.lsb,
  }, after: item.repaired })), null, 2), 'utf-8');
  console.log(`\n[repair] 备份写入 ${backupPath}`);

  let updated = 0;
  for (const { row, repaired } of planned) {
    await prisma.learning_metrics.update({
      where: { id: row.id },
      data: { lss: repaired.lss, ktl: repaired.ktl, lf: repaired.lf, lsb: repaired.lsb },
    });
    updated += 1;
  }
  console.log(`[repair] 已更新 ${updated} 行`);
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
