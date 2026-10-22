/* eslint-disable no-console -- 运维脚本：进度与统计走 stdout */
/**
 * 清理「同课 twin」的 task-completion 占位指标（2026-10-22 审计 P2）。
 *
 * 背景：tasks 无主观难度时曾写 task-completion:<taskId> 占位行（LSS 恒按默认难度 5 合成）。
 * 同一节课还有 session-wrapup:<sessionId> 真实行时，读侧靠 dedupeLessonRows 折叠；
 * 现在写侧已不再产生新占位行，本脚本清理历史 twin（只删有真实 wrapup 配对的 synthetic 行）。
 *
 * 安全边界：
 * - 只删 metadata.synthetic === true 且 sourceKey 以 task-completion: 开头的行；
 * - 必须存在同 userId + taskId + 应用时区本地日 的 session-wrapup 行；
 * - 默认 dry-run，--apply 才写。
 */
import 'dotenv/config';
import prisma from '../config/database';
import { dayKeyOf } from '../services/time/day-boundary';

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function parseJson(raw: unknown): Record<string, any> {
  if (!raw || typeof raw !== 'string') return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function main(): Promise<void> {
  const apply = hasFlag('apply');
  const [taskRows, wrapupRows] = await Promise.all([
    prisma.learning_metrics.findMany({
      where: { sourceKey: { startsWith: 'task-completion:' } },
      select: { id: true, userId: true, taskId: true, sourceKey: true, calculatedAt: true, metadata: true },
    }),
    prisma.learning_metrics.findMany({
      where: { sourceKey: { startsWith: 'session-wrapup:' } },
      select: { userId: true, taskId: true, calculatedAt: true },
    }),
  ]);

  const wrapupKeys = new Set(
    wrapupRows
      .filter((row) => row.taskId)
      .map((row) => `${row.userId}|${row.taskId}|${dayKeyOf(row.calculatedAt)}`)
  );

  const twins = taskRows.filter((row) => {
    if (!row.taskId) return false;
    if (parseJson(row.metadata).synthetic !== true) return false;
    return wrapupKeys.has(`${row.userId}|${row.taskId}|${dayKeyOf(row.calculatedAt)}`);
  });

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    taskCompletionRows: taskRows.length,
    sessionWrapupRows: wrapupRows.length,
    syntheticTwins: twins.length,
  }, null, 2));

  if (!apply || twins.length === 0) {
    console.log('[cleanup-synthetic-task-metrics] dry-run 结束（加 --apply 删除）');
    return;
  }

  const result = await prisma.learning_metrics.deleteMany({
    where: { id: { in: twins.map((row) => row.id) } },
  });
  console.log(JSON.stringify({ deleted: result.count, attempted: twins.length }, null, 2));
}

main()
  .catch((error) => {
    console.error('[cleanup-synthetic-task-metrics] 失败', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
