/**
 * 唤醒/收束**悬挂会话**（后端重启或本地验证中断后常留下 active/paused/finalizing 行）。
 *
 * 为什么要它：会话是按 `openKey(userId,taskId)` 复用的，悬挂行会让后续开课撞上
 * "状态已变化/缺 revision"这类冲突；而空闲巡检要等很久（paused 24h）才回收。
 *
 * 做法：**走应用自己的收束路径**（`SessionFinalizationService.finalize(action:'end_only')`），
 * 不直接改库——这样 wrapup / 状态提交 / 事件派发都照常发生，不产生"半截状态"。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/wake-hanging-sessions.ts [--user=<ID>] [--dry]
 */
import 'dotenv/config';
import prisma from '../config/database';
import { sessionFinalizationService } from '../services/ai-teaching/SessionFinalizationService';

function arg(name: string): string | null {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

async function main(): Promise<void> {
  const requested = arg('user');
  const dry = process.argv.includes('--dry');

  // finalizing 行由 reserve 的租约回收逻辑处理（进程中断后租约到点即可被 supersede），
  // 这里只收束 active/paused —— 它们会占着 openKey。
  const rows = await prisma.teaching_sessions.findMany({
    where: {
      status: { in: ['active', 'paused'] },
      ...(requested ? { userId: requested } : {}),
    },
    orderBy: { startTime: 'desc' },
    select: { id: true, userId: true, status: true, revision: true, startTime: true, taskId: true },
  });

  if (rows.length === 0) {
    console.log('[wake] 没有悬挂会话（active/paused）');
    return;
  }
  console.log(`[wake] 发现 ${rows.length} 个悬挂会话${dry ? '（--dry 只列不收束）' : ''}`);

  for (const row of rows) {
    const age = Math.round((Date.now() - new Date(row.startTime).getTime()) / 60000);
    console.log(`[wake]   ${row.id.slice(0, 46)} ${row.status} rev=${row.revision} 已开 ${age} 分钟`);
    if (dry) continue;
    try {
      const result: { status?: string } = await sessionFinalizationService.finalize({
        sessionId: row.id,
        userId: row.userId,
        action: 'end_only',
        operationId: `wake:${row.id}:${row.revision}`,
        revision: row.revision,
        endReason: 'manual-end',
      } as never);
      console.log(`[wake]   → 已收束（${result?.status ?? 'ok'}）`);
    } catch (error) {
      console.log(`[wake]   → 收束失败（留给空闲巡检）：${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
