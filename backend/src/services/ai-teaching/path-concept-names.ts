/**
 * 读取一条学习路径涉及的概念名（2026-11-03 拆出）。
 *
 * 用途：重排建议点名收窄——`learnerReplanProjection.mastery.strugglingConcepts` 是**全学习者**的
 * 投影，不按路径切；账号有多条路径时会把别的路径的卡点点名到本节课的评估页上（实测原文见
 * ReplanAdvisoryService.BuildInput.pathConceptNames 注释）。这里提供"本条路径上有哪些概念"。
 *
 * 拆出的原因：`teaching-session-lifecycle.ts` 已超基线且只许缩短（超大文件棘轮），
 * 而这段只读查询与收束主流程无关。
 *
 * 只读、容错：路径缺失或查询失败一律返回空数组（空 = 调用方不做收窄，行为退回旧口径），
 * 绝不让它阻断收束。
 */
import prisma from '../../config/database';
import { logger } from '../../utils/logger';

export async function loadPathConceptNames(learningPathId: string | null | undefined): Promise<string[]> {
  if (!learningPathId) return [];
  try {
    const milestones = await prisma.milestones.findMany({
      where: { learningPathId },
      select: { coreConceptName: true, subtasks: { select: { coreConcept: true, linkedConceptName: true } } },
    });
    const names = new Set<string>();
    for (const milestone of milestones as Array<Record<string, unknown>>) {
      if (milestone.coreConceptName) names.add(String(milestone.coreConceptName));
      for (const task of (milestone.subtasks as Array<Record<string, unknown>>) ?? []) {
        if (task.coreConcept) names.add(String(task.coreConcept));
        if (task.linkedConceptName) names.add(String(task.linkedConceptName));
      }
    }
    return [...names];
  } catch (error) {
    logger.warn('[AITeaching] 读取路径概念名失败，重排建议点名不做收窄', {
      learningPathId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
