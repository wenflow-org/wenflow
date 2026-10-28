/**
 * deadline 落后定时评估（2026-10-22 审计 P2）。
 *
 * 背景：deadline 判据/建议/通知三处都已接线，但评估只在访问状态页时发生——
 * 不访问页面的学习者永远不会被判「进度落后」。本调度器按固定节拍扫描有外部截止的
 * 活跃路径，刷新学习快照（内含 deadline × 进度失配判据）并走既有去重通知。
 *
 * 只做评估与通知，不自动重排（重排仍是确认制）。
 */
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import { learnerSnapshotRefreshService } from '../learner/LearnerSnapshotRefreshService';
import { notifyDeadlineBehindOnce } from '../learner/deadline-notify.service';

const DEFAULT_TICK_MS = 6 * 60 * 60 * 1000;

function tickMs(): number {
  const parsed = Number(process.env.DEADLINE_PACE_TICK_MS);
  return Number.isFinite(parsed) && parsed >= 60_000 ? parsed : DEFAULT_TICK_MS;
}

export async function evaluateDeadlinePaceOnce(now: Date = new Date()): Promise<{
  scanned: number;
  behind: number;
  notified: number;
  failed: number;
}> {
  const paths = await prisma.learning_paths.findMany({
    where: {
      status: 'active',
      deadline: { not: null },
      users: { isVirtualLearner: false },
    },
    orderBy: [{ updatedAt: 'asc' }],
    take: 200,
    select: {
      id: true,
      userId: true,
      title: true,
      deadline: true,
    },
  });

  let behind = 0;
  let notified = 0;
  let failed = 0;
  for (const path of paths) {
    try {
      const snapshot = await learnerSnapshotRefreshService.refresh({
        userId: path.userId,
        pathId: path.id,
        scope: 'path',
      });
      const signal = (snapshot as { replanSignal?: { shouldSuggest?: boolean; reasonCodes?: string[] } } | null)?.replanSignal;
      if (signal?.reasonCodes?.includes('deadline_pace_behind')) {
        behind += 1;
        const result = await notifyDeadlineBehindOnce({
          userId: path.userId,
          pathId: path.id,
          pathTitle: path.title ?? null,
          deadline: path.deadline ?? null,
          replanSignal: signal,
          now,
        });
        if (result.sent) notified += 1;
      }
    } catch (error) {
      failed += 1;
      logger.warn('[deadline-pace] 单条路径评估失败（跳过）', {
        pathId: path.id,
        userId: path.userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { scanned: paths.length, behind, notified, failed };
}

let started = false;
let timer: NodeJS.Timeout | null = null;

/** 启动周期评估（默认 6h；env DEADLINE_PACE_TICK_MS，最小 60s）。 */
export function startDeadlinePaceScheduler(): void {
  if (started) return;
  started = true;
  const run = () => {
    void evaluateDeadlinePaceOnce()
      .then((result) => {
        if (result.behind > 0 || result.failed > 0) {
          logger.info('[deadline-pace] 定时评估完成', result);
        }
      })
      .catch((error) => {
        logger.warn('[deadline-pace] 定时评估失败（下一轮继续）', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  };
  timer = setInterval(run, tickMs());
  timer.unref?.();
  // 启动后延迟首跑，避开启动期 DB/模型初始化争用
  const kickoff = setTimeout(run, 60_000);
  kickoff.unref?.();
}

/** 测试/优雅关闭用：停止定时器。 */
export function stopDeadlinePaceScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}
