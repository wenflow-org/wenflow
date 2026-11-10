/**
 * 目标会话里「路径完成态」的权威投影（#228 残余修复）。
 *
 * 为什么需要它：会话快照 GET 与「已完成会话再发 /reply」的早退分支都要回答
 * 「学习路径生成好了吗」。而 `learning_paths.status` 在 stage design 窗口**恒为 `active`**
 * （core 落库的同一事务里就写 active，见 generation/path-generation.core.ts），只看 status
 * 必然在这 25-50 秒窗口里谎称「学习路径已生成」，与 `GET /api/learning/paths/:id/generation-status`
 * 的 lifecycle 直接打架。
 *
 * 真相在活动 run 的 phase 上：getPathGenerationLifecycle 依 run 推导出
 * `ready / core_processing / stage_design_processing / stage_design_failed / …`。
 * 本模块把「权威行（id/name/status）+ 该 lifecycle」一次投影出来，供两条分支共用同一口径。
 *
 * lifecycle 推导失败（行缺失 / 归属闸门 / 异常）时返回 null：调用方按 status 回退判定，
 * 绝不因为一次投影失败把只读快照打成 500。
 */
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import { getPathGenerationLifecycle } from './queries/path-views.queries';

export interface PathCompletionProjection {
  id: string;
  name: string | null;
  status: string;
  /** 活动 run 推导的 lifecycle；null = 拿不到（调用方退回 status 判定） */
  lifecycle: string | null;
}

/**
 * 取路径的完成态投影。调用方已按 goal_conversations.userId 校验过会话归属，
 * 这里用行自身 userId 通过 lifecycle 查询的归属闸门（本函数的职责是把 run 真相带出来，
 * 不是再授权一次）。
 */
export async function getPathCompletionProjection(pathId: string): Promise<PathCompletionProjection | null> {
  const path = await prisma.learning_paths.findFirst({ where: { id: pathId } });
  if (!path) return null;

  let lifecycle: string | null = null;
  try {
    lifecycle = (await getPathGenerationLifecycle(pathId, path.userId)).lifecycle;
  } catch (error) {
    logger.warn('[goal-conversation] 路径 lifecycle 投影失败，文案退回 status 判定', {
      pathId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    id: path.id,
    name: path.name || path.title || null,
    status: path.status,
    lifecycle,
  };
}
