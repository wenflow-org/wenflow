import prisma from '../../config/database';

/**
 * 学习路由前置查询仓储（routes/learning.ts 的取数层）。
 * 路由层的归属校验（G2）、路径摘要关联对话、重生成/调整前的路径读取。
 */

/** 路径摘要：按来源对话或 learningPathId 找关联的 goal 对话 */
export function findGoalConversationForPathSummary(
  sourceConversationId: string | null,
  learningPathId: string,
  userId: string
) {
  return prisma.goal_conversations.findFirst({
    where: sourceConversationId
      ? { id: sourceConversationId, userId }
      : { learningPathId, userId },
    select: {
      id: true,
      userId: true,
      description: true,
      stage: true,
      collectedData: true
    }
  });
}

/** G2 归属校验：pathId 必须归属当前用户 */
export function findOwnedLearningPathById(pathId: string, userId: string) {
  return prisma.learning_paths.findFirst({
    where: { id: pathId, userId }
  });
}

export function findLearningPathById(pathId: string) {
  return prisma.learning_paths.findUnique({
    where: { id: pathId }
  });
}

/** 重生成前置：路径 + 里程碑任务状态（完成度展示） */
export function findLearningPathWithMilestones(pathId: string) {
  return prisma.learning_paths.findUnique({
    where: { id: pathId },
    include: {
      milestones: {
        include: {
          subtasks: { select: { id: true, status: true } }
        }
      }
    }
  });
}

/** 调整范围前置：路径归属（仅取 userId） */
export function findLearningPathOwner(pathId: string) {
  return prisma.learning_paths.findUnique({
    where: { id: pathId },
    select: { userId: true }
  });
}

export function listMilestonesWithTaskIds(learningPathId: string) {
  return prisma.milestones.findMany({
    where: { learningPathId },
    include: { subtasks: { select: { id: true } } },
    orderBy: { stageNumber: 'asc' }
  });
}
