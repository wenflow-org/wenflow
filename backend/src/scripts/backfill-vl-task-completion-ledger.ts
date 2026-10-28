/* eslint-disable no-console -- 运维脚本：进度与统计走 stdout */
/**
 * 回填 VL 课堂 finalization 台账（2026-10-22 审计 P1-3）。
 *
 * 背景：VL assisted/blackbox 曾直调 completeTask + endSession(end_only)，
 * 任务已完成但 teachingState.finalization.taskCompletion 永久停在 not_started。
 * 现在新链路会在结算后补记 complete_task；本脚本处理存量。
 *
 * 安全边界：
 * - 只处理 isVirtualLearner=1 的 completed 课堂；
 * - 只处理 wrapup 非空、关联 task 已 completed 的会话；
 * - 默认 dry-run，只有 --apply 才写；
 * - 复用 recordDirectTaskCompletion 的 claim/lease/幂等键，重复跑不会重复记账。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/backfill-vl-task-completion-ledger.ts
 *   npx ts-node --transpile-only src/scripts/backfill-vl-task-completion-ledger.ts --limit=5 --apply
 *   npx ts-node --transpile-only src/scripts/backfill-vl-task-completion-ledger.ts --apply
 */
import 'dotenv/config';
import prisma from '../config/database';
import { getSessionFinalizationState } from '../services/ai-teaching/SessionFinalizationPolicy';
import { teachingSessionRepository } from '../services/ai-teaching/TeachingSessionRepository';

function argValue(name: string): string | null {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function parseTemplate(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw !== 'string') return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function main(): Promise<void> {
  const apply = hasFlag('apply');
  const limit = Math.max(0, Number(argValue('limit')) || 0);
  const source = argValue('source') || 'vl-assisted-backfill';

  const virtualUsers = await prisma.users.findMany({
    where: { isVirtualLearner: true },
    select: { id: true },
  });
  const virtualUserIds = virtualUsers.map((user) => user.id);
  if (virtualUserIds.length === 0) {
    console.log('[backfill-vl-ledger] 没有虚拟学习者，退出');
    return;
  }

  const sessions = await prisma.teaching_sessions.findMany({
    where: {
      status: 'completed',
      userId: { in: virtualUserIds },
      wrapup: { not: null },
    },
    orderBy: [{ createdAt: 'asc' }],
    select: {
      id: true,
      userId: true,
      taskId: true,
      revision: true,
      teachingState: true,
    },
  });

  const alreadyCompleted = sessions.filter((session) => {
    const state = getSessionFinalizationState(parseTemplate(session.teachingState));
    return state?.taskCompletion === 'completed';
  });
  const candidates = sessions.filter((session) => {
    const state = getSessionFinalizationState(parseTemplate(session.teachingState));
    return state?.taskCompletion !== 'completed' && typeof session.taskId === 'string' && session.taskId;
  });

  const taskIds = Array.from(new Set(candidates.map((session) => String(session.taskId))));
  const tasks = taskIds.length
    ? await prisma.subtasks.findMany({
        where: { id: { in: taskIds } },
        select: { id: true, status: true },
      })
    : [];
  const completedTaskIds = new Set(tasks.filter((task) => task.status === 'completed').map((task) => task.id));

  const eligible = candidates
    .filter((session) => completedTaskIds.has(String(session.taskId)))
    .slice(0, limit > 0 ? limit : undefined);

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    virtualLearners: virtualUserIds.length,
    completedSessions: sessions.length,
    alreadyLedgerCompleted: alreadyCompleted.length,
    candidates: candidates.length,
    taskNotCompleted: candidates.length - candidates.filter((s) => completedTaskIds.has(String(s.taskId))).length,
    eligible: eligible.length,
    limit: limit || null,
    source,
  }, null, 2));

  if (!apply || eligible.length === 0) {
    console.log('[backfill-vl-ledger] dry-run 结束（加 --apply 写库）');
    return;
  }

  let updated = 0;
  let processing = 0;
  const failed: Array<{ sessionId: string; error: string }> = [];
  for (let index = 0; index < eligible.length; index += 1) {
    const session = eligible[index];
    try {
      const status = await teachingSessionRepository.recordDirectTaskCompletion(
        session.id,
        session.userId,
        source,
        session.revision
      );
      if (status === 'completed') updated += 1;
      else processing += 1;
    } catch (error) {
      failed.push({
        sessionId: session.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if ((index + 1) % 50 === 0) {
      console.log(`[backfill-vl-ledger] ${index + 1}/${eligible.length} updated=${updated} processing=${processing} failed=${failed.length}`);
    }
  }

  console.log(JSON.stringify({
    applied: true,
    attempted: eligible.length,
    updated,
    processing,
    failed: failed.length,
    failures: failed.slice(0, 20),
  }, null, 2));
}

main()
  .catch((error) => {
    console.error('[backfill-vl-ledger] 失败', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
