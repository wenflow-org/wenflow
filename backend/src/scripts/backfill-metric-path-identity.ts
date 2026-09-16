/**
 * 回填 `learning_metrics` 的路径身份（第 2 步之一：历史数据补维度）
 *
 * 背景：`SessionMetricsInput` 曾经没有 `pathId` 字段，`task-completion` 写入的状态行
 * `pathId` 全为 null（实测 67/67）→ 这些学习者的状态在**路径级**读取里不可见，
 * 也让"路径 A 的困难改写路径 B 的自适应"无法拆开。
 *
 * 为什么可以精确回填（不是猜）：
 *   指标行持有 `taskId`（= `subtasks.id`），而 `subtasks.milestoneId → milestones.learningPathId`
 *   是确定性外键链；且实测 67/67 全部可解析、`subtasks.userId` 与指标行 `userId` **零不一致**。
 *   任务/里程碑已被删除导致解析不到的，**保持 null**（不编造归属）。
 *
 * 同时把 `metadata.pathId` 按写入侧（`buildMetricCreateData`）的规范键序补上，
 * 使得回填后的行与今后新写入的行形状一致。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/backfill-metric-path-identity.ts --dry-run
 *   npx ts-node --transpile-only src/scripts/backfill-metric-path-identity.ts --apply
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import prisma from '../config/database';

export interface BackfillArgs {
  apply: boolean;
  limit: number;
}

export function parseArgs(argv: string[]): BackfillArgs {
  const args: BackfillArgs = { apply: false, limit: 20 };
  for (const arg of argv) {
    if (arg === '--dry-run') args.apply = false;
    else if (arg === '--apply') args.apply = true;
    else if (arg.startsWith('--limit=')) {
      const value = Number(arg.slice('--limit='.length));
      if (Number.isFinite(value) && value > 0) args.limit = Math.min(Math.floor(value), 500);
    } else if (arg) {
      throw new Error(`未知参数：${arg}`);
    }
  }
  return args;
}

/**
 * 把 `pathId` 按写入侧规范键序并入 metadata。
 * 规范键序（`buildMetricCreateData`）：version, committed, source, scale, pathId, taskId, sessionId。
 * 未知键保留在末尾，避免丢信息；`pathId` 已存在且不同则视为冲突（返回 null 由调用方处理）。
 */
export function mergePathIdIntoMetadata(
  metadata: string | null,
  pathId: string
): string | null {
  let parsed: Record<string, unknown> = {};
  if (metadata) {
    try {
      const value = JSON.parse(metadata);
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      parsed = value as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  const existing = parsed.pathId;
  if (existing != null && existing !== pathId) return null;

  const known = ['version', 'committed', 'source', 'scale', 'pathId', 'taskId', 'sessionId'];
  const merged: Record<string, unknown> = {};
  for (const key of known) {
    if (key === 'pathId') {
      merged.pathId = pathId;
      continue;
    }
    if (key in parsed) merged[key] = parsed[key];
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (!(key in merged)) merged[key] = value;
  }
  return JSON.stringify(merged);
}

interface Candidate {
  id: string;
  userId: string;
  taskId: string | null;
  pathId: string | null;
  metadata: string | null;
  calculatedAt: Date;
}

interface Resolved {
  candidate: Candidate;
  pathId: string;
  metadataAfter: string;
}

export async function resolveRows(rows: Candidate[]): Promise<{
  resolved: Resolved[];
  unresolved: Array<{ candidate: Candidate; reason: string }>;
  conflicts: Array<{ candidate: Candidate; reason: string }>;
}> {
  const resolved: Resolved[] = [];
  const unresolved: Array<{ candidate: Candidate; reason: string }> = [];
  const conflicts: Array<{ candidate: Candidate; reason: string }> = [];

  for (const candidate of rows) {
    if (!candidate.taskId) {
      unresolved.push({ candidate, reason: '无 taskId，无法定位' });
      continue;
    }
    const subtask = await prisma.subtasks.findUnique({
      where: { id: candidate.taskId },
      select: { userId: true, milestoneId: true },
    });
    if (!subtask) {
      unresolved.push({ candidate, reason: 'subtasks 记录不存在（可能已删除）' });
      continue;
    }
    if (subtask.userId !== candidate.userId) {
      conflicts.push({ candidate, reason: `任务归属用户不一致（${subtask.userId} ≠ ${candidate.userId}）` });
      continue;
    }
    const milestone = await prisma.milestones.findUnique({
      where: { id: subtask.milestoneId },
      select: { learningPathId: true },
    });
    if (!milestone?.learningPathId) {
      unresolved.push({ candidate, reason: 'milestones 记录不存在或无路径' });
      continue;
    }
    const metadataAfter = mergePathIdIntoMetadata(candidate.metadata, milestone.learningPathId);
    if (!metadataAfter) {
      conflicts.push({ candidate, reason: 'metadata 已存在不同的 pathId（拒绝覆盖）' });
      continue;
    }
    resolved.push({ candidate, pathId: milestone.learningPathId, metadataAfter });
  }

  return { resolved, unresolved, conflicts };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const rows = await prisma.learning_metrics.findMany({
    where: { metricType: 'learning_state', pathId: null },
    select: { id: true, userId: true, taskId: true, pathId: true, metadata: true, calculatedAt: true },
    orderBy: { calculatedAt: 'asc' },
  });

  console.log(`[backfill] 待回填行 ${rows.length} 行（mode=${args.apply ? 'apply' : 'dry-run'}）`);
  const { resolved, unresolved, conflicts } = await resolveRows(rows);

  const byPath = new Map<string, number>();
  const pathsByUser = new Map<string, Set<string>>();
  for (const item of resolved) {
    byPath.set(item.pathId, (byPath.get(item.pathId) || 0) + 1);
    if (!pathsByUser.has(item.candidate.userId)) pathsByUser.set(item.candidate.userId, new Set());
    pathsByUser.get(item.candidate.userId)!.add(item.pathId);
  }

  console.log(`[backfill] 可解析 ${resolved.length}｜不可解析 ${unresolved.length}｜冲突跳过 ${conflicts.length}`);
  console.log(`[backfill] 涉及 ${pathsByUser.size} 位学习者、${byPath.size} 条路径`);

  console.log('\n[backfill] 逐行对账（前 → 后）：');
  for (const item of resolved.slice(0, args.limit)) {
    console.log(`  ${item.candidate.calculatedAt.toISOString().slice(0, 16)} ${item.candidate.userId.slice(0, 8)}`
      + ` ${item.candidate.taskId?.slice(0, 22)} pathId null → ${item.pathId}`);
  }
  if (resolved.length > args.limit) console.log(`  …（其余 ${resolved.length - args.limit} 行省略，--limit 可调）`);

  for (const item of unresolved) {
    console.log(`[backfill][跳过] ${item.candidate.id} ${item.candidate.userId.slice(0, 8)}：${item.reason}（保持 null）`);
  }
  for (const item of conflicts) {
    console.log(`[backfill][冲突] ${item.candidate.id} ${item.candidate.userId.slice(0, 8)}：${item.reason}（保持 null）`);
  }

  const multiPathUsers = [...pathsByUser.entries()].filter(([, paths]) => paths.size > 1);
  console.log(`\n[backfill] 回填后会变为"多路径有身份历史"的学习者：${multiPathUsers.length} 位`);
  for (const [userId, paths] of multiPathUsers.slice(0, 10)) {
    console.log(`  ${userId.slice(0, 8)}: ${paths.size} 条路径`);
  }

  if (!args.apply) {
    console.log('\n[backfill] dry-run 结束（未写库）。确认对账表后再跑 --apply');
    return;
  }

  const backupDir = path.resolve(__dirname, '../../analysis_output');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `metric-path-backfill-${Date.now()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(resolved.map((item) => ({
    id: item.candidate.id,
    before: { pathId: item.candidate.pathId, metadata: item.candidate.metadata },
    after: { pathId: item.pathId, metadata: item.metadataAfter },
  })), null, 2), 'utf-8');
  console.log(`\n[backfill] 备份写入 ${backupPath}`);

  let updated = 0;
  for (const item of resolved) {
    await prisma.learning_metrics.update({
      where: { id: item.candidate.id },
      data: { pathId: item.pathId, metadata: item.metadataAfter },
    });
    updated += 1;
  }
  console.log(`[backfill] 已更新 ${updated} 行`);
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
